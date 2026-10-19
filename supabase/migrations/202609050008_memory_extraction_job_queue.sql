-- Durable, service-role-only queue for future memory extraction workers.
-- Only messages completed after this migration are enqueued; existing chat
-- history is intentionally not backfilled.

begin;

create table public.memory_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null,
  source_message_id uuid not null,
  status public.job_status not null default 'scheduled',
  attempt_count integer not null default 0,
  max_attempts smallint not null default 3,
  available_at timestamptz not null default now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  extraction_run_id uuid references public.memory_extraction_runs(id) on delete set null,
  idempotency_key text not null,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source_message_id),
  unique (user_id, idempotency_key),
  constraint memory_extraction_jobs_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint memory_extraction_jobs_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint memory_extraction_jobs_attempt_count_check check (
    attempt_count between 0 and max_attempts
  ),
  constraint memory_extraction_jobs_max_attempts_check check (
    max_attempts between 1 and 5
  ),
  constraint memory_extraction_jobs_idempotency_key_length check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  constraint memory_extraction_jobs_error_code_check check (
    last_error_code is null
    or last_error_code ~ '^[a-z0-9_]{1,100}$'
  ),
  constraint memory_extraction_jobs_state_check check (
    (
      status = 'scheduled'
      and claim_token is null
      and lease_expires_at is null
      and extraction_run_id is null
      and completed_at is null
    )
    or (
      status = 'running'
      and claim_token is not null
      and lease_expires_at is not null
      and extraction_run_id is null
      and completed_at is null
    )
    or (
      status = 'succeeded'
      and claim_token is null
      and lease_expires_at is null
      and extraction_run_id is not null
      and completed_at is not null
    )
    or (
      status in ('failed', 'cancelled')
      and claim_token is null
      and lease_expires_at is null
      and extraction_run_id is null
      and completed_at is not null
    )
  )
);

alter table public.memory_extraction_jobs enable row level security;

create index memory_extraction_jobs_dispatch_idx
  on public.memory_extraction_jobs(status, available_at, created_at);

create index memory_extraction_jobs_role_created_idx
  on public.memory_extraction_jobs(role_id, created_at desc);

create trigger memory_extraction_jobs_set_updated_at
before update on public.memory_extraction_jobs
for each row execute function public.set_updated_at();

create function public.enqueue_completed_user_message_for_memory_extraction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.sender = 'user'
    and new.status = 'completed'
    and new.deleted_at is null then
    insert into public.memory_extraction_jobs (
      user_id,
      role_id,
      source_message_id,
      idempotency_key
    )
    values (
      new.user_id,
      new.role_id,
      new.id,
      'memory-extraction-job:' || new.id::text
    )
    on conflict (user_id, source_message_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger messages_enqueue_memory_extraction
after insert or update of status, deleted_at on public.messages
for each row execute function public.enqueue_completed_user_message_for_memory_extraction();

create function public.claim_memory_extraction_jobs(
  p_limit integer,
  p_now timestamptz,
  p_lease_seconds integer
)
returns table (
  job_id uuid,
  user_id uuid,
  role_id uuid,
  source_message_id uuid,
  claim_token uuid,
  idempotency_key text,
  attempt_no integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_limit is null
    or p_limit not between 1 and 20
    or p_now is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900 then
    raise exception 'memory extraction claim input is invalid';
  end if;

  update public.memory_extraction_jobs as exhausted_job
  set
    status = 'failed',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'lease_expired',
    completed_at = p_now
  where exhausted_job.status = 'running'
    and exhausted_job.lease_expires_at <= p_now
    and exhausted_job.attempt_count >= exhausted_job.max_attempts;

  with invalid_job as (
    select candidate.id
    from public.memory_extraction_jobs as candidate
    where (
        (candidate.status = 'scheduled' and candidate.available_at <= p_now)
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and (
        not exists (
          select 1
          from public.messages as source_message
          where source_message.id = candidate.source_message_id
            and source_message.user_id = candidate.user_id
            and source_message.role_id = candidate.role_id
            and source_message.sender = 'user'
            and source_message.status = 'completed'
            and source_message.deleted_at is null
        )
        or not exists (
          select 1
          from public.roles as source_role
          where source_role.id = candidate.role_id
            and source_role.user_id = candidate.user_id
            and source_role.status = 'active'
        )
      )
    order by candidate.available_at, candidate.created_at, candidate.id
    for update skip locked
    limit 100
  )
  update public.memory_extraction_jobs as cancelled_job
  set
    status = 'cancelled',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'source_unavailable',
    completed_at = p_now
  from invalid_job
  where cancelled_job.id = invalid_job.id;

  return query
  with eligible_job as (
    select candidate.id
    from public.memory_extraction_jobs as candidate
    join public.messages as source_message
      on source_message.id = candidate.source_message_id
      and source_message.user_id = candidate.user_id
      and source_message.role_id = candidate.role_id
      and source_message.sender = 'user'
      and source_message.status = 'completed'
      and source_message.deleted_at is null
    join public.roles as source_role
      on source_role.id = candidate.role_id
      and source_role.user_id = candidate.user_id
      and source_role.status = 'active'
    where (
        (candidate.status = 'scheduled' and candidate.available_at <= p_now)
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and candidate.attempt_count < candidate.max_attempts
    order by candidate.available_at, candidate.created_at, candidate.id
    for update of candidate skip locked
    limit p_limit
  ),
  claimed_job as (
    update public.memory_extraction_jobs as target_job
    set
      status = 'running',
      attempt_count = target_job.attempt_count + 1,
      claim_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      last_error_code = null,
      completed_at = null
    from eligible_job
    where target_job.id = eligible_job.id
    returning target_job.*
  )
  select
    claimed_job.id,
    claimed_job.user_id,
    claimed_job.role_id,
    claimed_job.source_message_id,
    claimed_job.claim_token,
    claimed_job.idempotency_key,
    claimed_job.attempt_count,
    claimed_job.lease_expires_at
  from claimed_job;
end;
$$;

create function public.complete_memory_extraction_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text,
  p_extraction_run_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_job public.memory_extraction_jobs%rowtype;
  final_status public.job_status;
  next_available_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null
    or p_claim_token is null
    or p_now is null
    or p_outcome not in ('succeeded', 'cancelled', 'retryable_failure', 'permanent_failure') then
    raise exception 'memory extraction completion input is invalid';
  end if;

  if (p_outcome = 'succeeded' and (p_error_code is not null or p_extraction_run_id is null))
    or (
      p_outcome <> 'succeeded'
      and (
        p_extraction_run_id is not null
        or p_error_code is null
        or p_error_code !~ '^[a-z0-9_]{1,100}$'
      )
    ) then
    raise exception 'memory extraction completion result is invalid';
  end if;

  select job.*
  into current_job
  from public.memory_extraction_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'memory extraction job not found';
  end if;

  if current_job.status <> 'running'
    or current_job.claim_token <> p_claim_token then
    raise exception 'memory extraction job claim is stale';
  end if;

  if p_outcome = 'succeeded'
    and not exists (
      select 1
      from public.memory_extraction_runs as extraction_run
      where extraction_run.id = p_extraction_run_id
        and extraction_run.user_id = current_job.user_id
        and extraction_run.role_id = current_job.role_id
        and extraction_run.source_message_id = current_job.source_message_id
    ) then
    raise exception 'memory extraction run does not match the claimed job';
  end if;

  if p_outcome = 'succeeded' then
    final_status := 'succeeded';
    next_available_at := current_job.available_at;
  elsif p_outcome = 'cancelled' then
    final_status := 'cancelled';
    next_available_at := current_job.available_at;
  elsif p_outcome = 'retryable_failure'
    and current_job.attempt_count < current_job.max_attempts then
    final_status := 'scheduled';
    next_available_at := p_now
      + interval '30 seconds' * power(2, greatest(current_job.attempt_count - 1, 0));
  else
    final_status := 'failed';
    next_available_at := current_job.available_at;
  end if;

  update public.memory_extraction_jobs as completed_job
  set
    status = final_status,
    available_at = next_available_at,
    claim_token = null,
    lease_expires_at = null,
    extraction_run_id = case
      when final_status = 'succeeded' then p_extraction_run_id
      else null
    end,
    last_error_code = case
      when final_status = 'succeeded' then null
      else p_error_code
    end,
    completed_at = case
      when final_status in ('succeeded', 'failed', 'cancelled') then p_now
      else null
    end
  where completed_job.id = current_job.id;

  return jsonb_build_object(
    'jobId', current_job.id,
    'status', final_status::text,
    'attemptCount', current_job.attempt_count,
    'availableAt', next_available_at
  );
end;
$$;

revoke all on table public.memory_extraction_jobs from public, anon, authenticated;
grant select on table public.memory_extraction_jobs to service_role;

revoke all on function public.enqueue_completed_user_message_for_memory_extraction()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_memory_extraction_jobs(integer, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.complete_memory_extraction_job(uuid, uuid, text, text, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_memory_extraction_jobs(integer, timestamptz, integer)
  to service_role;
grant execute on function public.complete_memory_extraction_job(uuid, uuid, text, text, uuid, timestamptz)
  to service_role;

commit;
