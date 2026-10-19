-- Durable, service-role-only plan classification for future completed user
-- messages. Existing chat history is intentionally not backfilled. Workers
-- can claim only one explicit job ID and never scan unrelated conversations.

begin;

create table public.plan_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null,
  source_message_id uuid not null,
  policy_version text not null,
  prompt_version text not null,
  provider text not null,
  model text not null,
  intent text not null
    check (intent in ('none', 'create', 'offer', 'clarify')),
  flow_action text not null
    check (
      flow_action in (
        'none',
        'show_confirmation_card',
        'ask_to_create',
        'explore_first_step'
      )
    ),
  scope public.plan_scope,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  suggested_title text,
  original_time_text text,
  parsed_payload jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}',
  proposal_id uuid,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source_message_id),
  unique (user_id, idempotency_key),
  constraint plan_extraction_runs_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint plan_extraction_runs_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint plan_extraction_runs_proposal_fk
    foreign key (proposal_id, user_id)
    references public.plan_proposals(id, user_id)
    on delete cascade,
  constraint plan_extraction_runs_version_fields_check check (
    char_length(btrim(policy_version)) between 1 and 100
    and char_length(btrim(prompt_version)) between 1 and 100
    and char_length(btrim(provider)) between 1 and 100
    and char_length(btrim(model)) between 1 and 200
  ),
  constraint plan_extraction_runs_title_check check (
    suggested_title is null
    or char_length(btrim(suggested_title)) between 1 and 200
  ),
  constraint plan_extraction_runs_original_time_check check (
    original_time_text is null
    or char_length(btrim(original_time_text)) between 1 and 500
  ),
  constraint plan_extraction_runs_payload_check check (
    jsonb_typeof(parsed_payload) = 'object'
    and octet_length(parsed_payload::text) <= 10000
  ),
  constraint plan_extraction_runs_missing_fields_check check (
    coalesce(array_length(missing_fields, 1), 0) <= 20
  ),
  constraint plan_extraction_runs_idempotency_key_check check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  constraint plan_extraction_runs_result_shape_check check (
    (
      intent = 'none'
      and flow_action = 'none'
      and scope is null
      and suggested_title is null
      and original_time_text is null
      and parsed_payload = '{}'::jsonb
      and coalesce(array_length(missing_fields, 1), 0) = 0
      and proposal_id is null
    )
    or (
      intent = 'create'
      and flow_action = 'show_confirmation_card'
      and scope is not null
      and proposal_id is not null
    )
    or (
      intent = 'offer'
      and flow_action = 'ask_to_create'
      and scope is not null
      and proposal_id is null
    )
    or (
      intent = 'clarify'
      and flow_action = 'explore_first_step'
      and scope is not null
      and proposal_id is null
    )
  )
);

alter table public.plan_extraction_runs enable row level security;

create index plan_extraction_runs_role_created_idx
  on public.plan_extraction_runs(role_id, created_at desc);

create table public.plan_extraction_jobs (
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
  extraction_run_id uuid,
  idempotency_key text not null,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source_message_id),
  unique (user_id, idempotency_key),
  constraint plan_extraction_jobs_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint plan_extraction_jobs_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint plan_extraction_jobs_run_owner_fk
    foreign key (extraction_run_id, user_id)
    references public.plan_extraction_runs(id, user_id)
    on delete cascade,
  constraint plan_extraction_jobs_attempt_count_check check (
    attempt_count between 0 and max_attempts
  ),
  constraint plan_extraction_jobs_max_attempts_check check (
    max_attempts between 1 and 5
  ),
  constraint plan_extraction_jobs_idempotency_key_check check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  constraint plan_extraction_jobs_error_code_check check (
    last_error_code is null
    or last_error_code ~ '^[a-z0-9_]{1,100}$'
  ),
  constraint plan_extraction_jobs_state_check check (
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

alter table public.plan_extraction_jobs enable row level security;

create index plan_extraction_jobs_dispatch_idx
  on public.plan_extraction_jobs(status, available_at, created_at);

create trigger plan_extraction_jobs_set_updated_at
before update on public.plan_extraction_jobs
for each row execute function public.set_updated_at();

create function public.enqueue_completed_user_message_for_plan_extraction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.sender = 'user'
    and new.status = 'completed'
    and new.deleted_at is null then
    insert into public.plan_extraction_jobs (
      user_id,
      role_id,
      source_message_id,
      idempotency_key
    )
    values (
      new.user_id,
      new.role_id,
      new.id,
      'plan-extraction-job:' || new.id::text
    )
    on conflict (user_id, source_message_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger messages_enqueue_plan_extraction
after insert or update of status, deleted_at on public.messages
for each row execute function public.enqueue_completed_user_message_for_plan_extraction();

create function public.claim_plan_extraction_job(
  p_job_id uuid,
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

  if p_job_id is null
    or p_now is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900 then
    raise exception 'plan extraction claim input is invalid';
  end if;

  update public.plan_extraction_jobs as exhausted_job
  set
    status = 'failed',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'lease_expired',
    completed_at = p_now
  where exhausted_job.id = p_job_id
    and exhausted_job.status = 'running'
    and exhausted_job.lease_expires_at <= p_now
    and exhausted_job.attempt_count >= exhausted_job.max_attempts;

  with invalid_job as (
    select candidate.id
    from public.plan_extraction_jobs as candidate
    where candidate.id = p_job_id
      and (
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
    for update of candidate skip locked
  )
  update public.plan_extraction_jobs as cancelled_job
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
    from public.plan_extraction_jobs as candidate
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
    where candidate.id = p_job_id
      and (
        (candidate.status = 'scheduled' and candidate.available_at <= p_now)
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and candidate.attempt_count < candidate.max_attempts
    for update of candidate skip locked
  ),
  claimed_job as (
    update public.plan_extraction_jobs as target_job
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

create function public.persist_plan_extraction_result(
  p_user_id uuid,
  p_role_id uuid,
  p_source_message_id uuid,
  p_policy_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_intent text,
  p_flow_action text,
  p_scope public.plan_scope,
  p_confidence numeric,
  p_suggested_title text,
  p_original_time_text text,
  p_parsed_payload jsonb,
  p_missing_fields text[],
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  existing_run public.plan_extraction_runs%rowtype;
  created_run_id uuid;
  created_proposal_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_user_id is null
    or p_role_id is null
    or p_source_message_id is null
    or p_policy_version is null
    or char_length(btrim(p_policy_version)) not between 1 and 100
    or p_prompt_version is null
    or char_length(btrim(p_prompt_version)) not between 1 and 100
    or p_provider is null
    or char_length(btrim(p_provider)) not between 1 and 100
    or p_model is null
    or char_length(btrim(p_model)) not between 1 and 200
    or p_intent is null
    or p_intent not in ('none', 'create', 'offer', 'clarify')
    or p_flow_action is null
    or p_flow_action not in (
      'none',
      'show_confirmation_card',
      'ask_to_create',
      'explore_first_step'
    )
    or p_confidence is null
    or p_confidence < 0
    or p_confidence > 1
    or p_parsed_payload is null
    or jsonb_typeof(p_parsed_payload) <> 'object'
    or octet_length(p_parsed_payload::text) > 10000
    or p_missing_fields is null
    or coalesce(array_length(p_missing_fields, 1), 0) > 20
    or exists (
      select 1
      from unnest(p_missing_fields) as missing_field
      where missing_field is null
        or char_length(btrim(missing_field)) not between 1 and 100
    )
    or (p_suggested_title is not null
      and char_length(btrim(p_suggested_title)) not between 1 and 200)
    or (p_original_time_text is not null
      and char_length(btrim(p_original_time_text)) not between 1 and 500)
    or (p_latency_ms is not null and p_latency_ms < 0)
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'plan extraction result input is invalid';
  end if;

  if (p_intent = 'none' and (
      p_flow_action <> 'none'
      or p_scope is not null
      or p_suggested_title is not null
      or p_original_time_text is not null
      or p_parsed_payload <> '{}'::jsonb
      or coalesce(array_length(p_missing_fields, 1), 0) <> 0
    ))
    or (p_intent = 'create' and (
      p_flow_action <> 'show_confirmation_card' or p_scope is null
    ))
    or (p_intent = 'offer' and (
      p_flow_action <> 'ask_to_create' or p_scope is null
    ))
    or (p_intent = 'clarify' and (
      p_flow_action <> 'explore_first_step' or p_scope is null
    )) then
    raise exception 'plan extraction result shape is invalid';
  end if;

  if p_scope is not null and exists (
    select 1
    from jsonb_object_keys(p_parsed_payload) as payload_key
    where (p_scope = 'day' and payload_key not in ('date', 'scheduledAt', 'reminderAt'))
       or (p_scope = 'week' and payload_key not in ('weekStart', 'dueDate'))
       or (p_scope = 'month' and payload_key not in ('month', 'dueDate'))
       or (p_scope = 'year' and payload_key not in ('year', 'parentPlanId', 'dueDate'))
  ) then
    raise exception 'plan extraction payload contains unsupported fields';
  end if;

  perform 1
  from public.messages as source_message
  join public.roles as source_role
    on source_role.id = p_role_id
    and source_role.user_id = p_user_id
    and source_role.status = 'active'
  where source_message.id = p_source_message_id
    and source_message.user_id = p_user_id
    and source_message.role_id = p_role_id
    and source_message.sender = 'user'
    and source_message.status = 'completed'
    and source_message.deleted_at is null
  for update of source_message;

  if not found then
    raise exception 'plan extraction source is unavailable';
  end if;

  p_policy_version := btrim(p_policy_version);
  p_prompt_version := btrim(p_prompt_version);
  p_provider := btrim(p_provider);
  p_model := btrim(p_model);
  p_idempotency_key := btrim(p_idempotency_key);

  select extraction_run.*
  into existing_run
  from public.plan_extraction_runs as extraction_run
  where extraction_run.user_id = p_user_id
    and (
      extraction_run.source_message_id = p_source_message_id
      or extraction_run.idempotency_key = p_idempotency_key
    )
  order by extraction_run.created_at, extraction_run.id
  limit 1;

  if found then
    if existing_run.role_id <> p_role_id
      or existing_run.source_message_id <> p_source_message_id then
      raise exception 'plan extraction idempotency key is already in use';
    end if;

    return jsonb_build_object(
      'runId', existing_run.id,
      'proposalId', existing_run.proposal_id,
      'replayed', true
    );
  end if;

  if p_intent = 'create' then
    insert into public.plan_proposals (
      user_id,
      source_role_id,
      source_message_id,
      intent,
      scope,
      suggested_title,
      original_time_text,
      parsed_payload,
      missing_fields,
      confidence,
      idempotency_key
    )
    values (
      p_user_id,
      p_role_id,
      p_source_message_id,
      'create',
      p_scope,
      nullif(btrim(p_suggested_title), ''),
      nullif(btrim(p_original_time_text), ''),
      p_parsed_payload,
      p_missing_fields,
      p_confidence,
      p_idempotency_key
    )
    returning id into created_proposal_id;
  end if;

  insert into public.plan_extraction_runs (
    user_id,
    role_id,
    source_message_id,
    policy_version,
    prompt_version,
    provider,
    model,
    intent,
    flow_action,
    scope,
    confidence,
    suggested_title,
    original_time_text,
    parsed_payload,
    missing_fields,
    proposal_id,
    latency_ms,
    input_tokens,
    output_tokens,
    idempotency_key
  )
  values (
    p_user_id,
    p_role_id,
    p_source_message_id,
    p_policy_version,
    p_prompt_version,
    p_provider,
    p_model,
    p_intent,
    p_flow_action,
    p_scope,
    p_confidence,
    nullif(btrim(p_suggested_title), ''),
    nullif(btrim(p_original_time_text), ''),
    p_parsed_payload,
    p_missing_fields,
    created_proposal_id,
    p_latency_ms,
    p_input_tokens,
    p_output_tokens,
    p_idempotency_key
  )
  returning id into created_run_id;

  return jsonb_build_object(
    'runId', created_run_id,
    'proposalId', created_proposal_id,
    'replayed', false
  );
end;
$$;

create function public.complete_plan_extraction_job(
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
  current_job public.plan_extraction_jobs%rowtype;
  final_status public.job_status;
  next_available_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null
    or p_claim_token is null
    or p_now is null
    or p_outcome not in (
      'succeeded',
      'cancelled',
      'retryable_failure',
      'permanent_failure'
    ) then
    raise exception 'plan extraction completion input is invalid';
  end if;

  if (p_outcome = 'succeeded' and (
      p_error_code is not null or p_extraction_run_id is null
    ))
    or (p_outcome <> 'succeeded' and (
      p_extraction_run_id is not null
      or p_error_code is null
      or p_error_code !~ '^[a-z0-9_]{1,100}$'
    )) then
    raise exception 'plan extraction completion result is invalid';
  end if;

  select job.*
  into current_job
  from public.plan_extraction_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'plan extraction job not found';
  end if;

  if current_job.status <> 'running'
    or current_job.claim_token <> p_claim_token then
    raise exception 'plan extraction job claim is stale';
  end if;

  if p_outcome = 'succeeded'
    and not exists (
      select 1
      from public.plan_extraction_runs as extraction_run
      where extraction_run.id = p_extraction_run_id
        and extraction_run.user_id = current_job.user_id
        and extraction_run.role_id = current_job.role_id
        and extraction_run.source_message_id = current_job.source_message_id
    ) then
    raise exception 'plan extraction run does not match the claimed job';
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

  update public.plan_extraction_jobs as completed_job
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

revoke all on table public.plan_extraction_runs
  from public, anon, authenticated, service_role;
grant select on table public.plan_extraction_runs to service_role;

revoke all on table public.plan_extraction_jobs
  from public, anon, authenticated, service_role;
grant select on table public.plan_extraction_jobs to service_role;

revoke all on function public.enqueue_completed_user_message_for_plan_extraction()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_plan_extraction_job(uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.persist_plan_extraction_result(
  uuid, uuid, uuid, text, text, text, text, text, text, public.plan_scope,
  numeric, text, text, jsonb, text[], integer, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.complete_plan_extraction_job(
  uuid, uuid, text, text, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_plan_extraction_job(uuid, timestamptz, integer)
  to service_role;
grant execute on function public.persist_plan_extraction_result(
  uuid, uuid, uuid, text, text, text, text, text, text, public.plan_scope,
  numeric, text, text, jsonb, text[], integer, integer, integer, text
) to service_role;
grant execute on function public.complete_plan_extraction_job(
  uuid, uuid, text, text, uuid, timestamptz
) to service_role;

commit;
