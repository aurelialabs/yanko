-- Add a recoverable exact-job lease to plan reminders and a browser-readable,
-- controlled-write in-app fallback. This does not send Web Push and does not
-- connect a scheduler.

begin;

alter table public.notification_jobs
  add column max_attempts smallint not null default 3
    check (max_attempts between 1 and 5),
  add column available_at timestamptz,
  add column claim_token uuid,
  add column lease_expires_at timestamptz,
  add constraint notification_jobs_id_user_unique unique (id, user_id);

-- Legacy workers had no recoverable lease. Requeue any interrupted local job
-- once so it can enter the new token-protected lifecycle.
update public.notification_jobs
set
  status = 'scheduled',
  available_at = greatest(scheduled_for, now()),
  last_error_code = 'lease_migration_requeued',
  completed_at = null
where status = 'running';

update public.notification_jobs
set available_at = case
  when status = 'scheduled' then scheduled_for
  else coalesce(last_attempt_at, scheduled_for)
end
where available_at is null;

alter table public.notification_jobs
  alter column available_at set not null,
  add constraint notification_jobs_claim_state_check check (
    (
      status = 'running'
      and claim_token is not null
      and lease_expires_at is not null
    )
    or (
      status <> 'running'
      and claim_token is null
      and lease_expires_at is null
    )
  );

create index notification_jobs_available_idx
  on public.notification_jobs(status, available_at, scheduled_for);

create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_job_id uuid not null,
  plan_id uuid not null,
  kind text not null default 'plan_reminder'
    check (kind = 'plan_reminder'),
  delivered_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, notification_job_id),
  constraint in_app_notifications_job_owner_fk
    foreign key (notification_job_id, user_id)
    references public.notification_jobs(id, user_id)
    on delete cascade,
  constraint in_app_notifications_plan_owner_fk
    foreign key (plan_id, user_id)
    references public.plans(id, user_id)
    on delete cascade,
  constraint in_app_notifications_read_time_check check (
    read_at is null or read_at >= delivered_at
  )
);

alter table public.in_app_notifications enable row level security;

create index in_app_notifications_user_delivered_idx
  on public.in_app_notifications(user_id, delivered_at desc, id desc);

create policy in_app_notifications_select_own
  on public.in_app_notifications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop function if exists public.claim_due_notification_job(uuid, timestamptz);
drop function if exists public.complete_notification_job(uuid, boolean, text);

create function public.claim_due_notification_job(
  p_job_id uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns table (
  job_id uuid,
  user_id uuid,
  plan_id uuid,
  scheduled_for timestamptz,
  claim_token uuid,
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
    raise exception 'notification claim input is invalid';
  end if;

  update public.notification_jobs as exhausted_job
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
    from public.notification_jobs as candidate
    where candidate.id = p_job_id
      and candidate.scheduled_for <= p_now
      and candidate.available_at <= p_now
      and (
        candidate.status = 'scheduled'
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and not exists (
        select 1
        from public.plans as plan
        where plan.id = candidate.plan_id
          and plan.user_id = candidate.user_id
          and plan.scope = 'day'
          and plan.status = 'active'
          and plan.reminder_at = candidate.scheduled_for
      )
    for update of candidate skip locked
  )
  update public.notification_jobs as cancelled_job
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
    from public.notification_jobs as candidate
    join public.plans as plan
      on plan.id = candidate.plan_id
      and plan.user_id = candidate.user_id
      and plan.scope = 'day'
      and plan.status = 'active'
      and plan.reminder_at = candidate.scheduled_for
    where candidate.id = p_job_id
      and candidate.scheduled_for <= p_now
      and candidate.available_at <= p_now
      and candidate.attempt_count < candidate.max_attempts
      and (
        candidate.status = 'scheduled'
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
        )
      )
    for update of candidate skip locked
  ),
  claimed_job as (
    update public.notification_jobs as target_job
    set
      status = 'running',
      attempt_count = target_job.attempt_count + 1,
      claim_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      last_attempt_at = p_now,
      last_error_code = null,
      completed_at = null
    from eligible_job
    where target_job.id = eligible_job.id
    returning target_job.*
  )
  select
    claimed_job.id,
    claimed_job.user_id,
    claimed_job.plan_id,
    claimed_job.scheduled_for,
    claimed_job.claim_token,
    claimed_job.attempt_count,
    claimed_job.lease_expires_at
  from claimed_job;
end;
$$;

create function public.complete_notification_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_job public.notification_jobs%rowtype;
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
    raise exception 'notification completion input is invalid';
  end if;

  if (p_outcome = 'succeeded' and p_error_code is not null)
    or (p_outcome <> 'succeeded' and (
      p_error_code is null
      or p_error_code !~ '^[a-z0-9_]{1,100}$'
    )) then
    raise exception 'notification completion result is invalid';
  end if;

  select job.*
  into current_job
  from public.notification_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'notification job not found';
  end if;

  if current_job.status <> 'running'
    or current_job.claim_token <> p_claim_token then
    raise exception 'notification job claim is stale';
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

  update public.notification_jobs as completed_job
  set
    status = final_status,
    available_at = next_available_at,
    claim_token = null,
    lease_expires_at = null,
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

create function public.deliver_in_app_plan_reminder(
  p_job_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_job public.notification_jobs%rowtype;
  notification_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null or p_claim_token is null or p_now is null then
    raise exception 'in-app reminder delivery input is invalid';
  end if;

  select job.*
  into current_job
  from public.notification_jobs as job
  where job.id = p_job_id
  for update;

  if not found
    or current_job.status <> 'running'
    or current_job.claim_token <> p_claim_token
    or current_job.lease_expires_at <= p_now then
    raise exception 'in-app reminder claim is stale';
  end if;

  if current_job.scheduled_for > p_now
    or not exists (
      select 1
      from public.plans as plan
      where plan.id = current_job.plan_id
        and plan.user_id = current_job.user_id
        and plan.scope = 'day'
        and plan.status = 'active'
        and plan.reminder_at = current_job.scheduled_for
    ) then
    raise exception 'in-app reminder source is unavailable';
  end if;

  insert into public.in_app_notifications (
    user_id,
    notification_job_id,
    plan_id,
    delivered_at
  )
  values (
    current_job.user_id,
    current_job.id,
    current_job.plan_id,
    p_now
  )
  on conflict (user_id, notification_job_id) do nothing
  returning id into notification_id;

  if notification_id is null then
    select notification.id
    into notification_id
    from public.in_app_notifications as notification
    where notification.user_id = current_job.user_id
      and notification.notification_job_id = current_job.id;
  end if;

  return notification_id;
end;
$$;

create function public.mark_in_app_notification_read(
  p_notification_id uuid,
  p_read boolean,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  notification_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_notification_id is null or p_read is null or p_now is null then
    raise exception 'in-app notification input is invalid';
  end if;

  update public.in_app_notifications as notification
  set read_at = case
    when p_read then coalesce(notification.read_at, greatest(p_now, notification.delivered_at))
    else null
  end
  where notification.id = p_notification_id
    and notification.user_id = current_user_id
  returning notification.id into notification_id;

  if notification_id is null then
    raise exception 'in-app notification not found';
  end if;

  return notification_id;
end;
$$;

create or replace function public.sync_plan_reminder_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  reminder_job_key text;
begin
  update public.notification_jobs as job
  set
    status = 'cancelled',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'reminder_changed',
    completed_at = now()
  where job.user_id = new.user_id
    and job.plan_id = new.id
    and job.status in ('scheduled', 'running');

  if new.scope <> 'day'
    or new.status <> 'active'
    or new.reminder_at is null
    or new.reminder_at <= now() then
    return new;
  end if;

  reminder_job_key := format('plan-reminder:%s:%s', new.id, new.reminder_at::text);

  insert into public.notification_jobs (
    user_id,
    plan_id,
    scheduled_for,
    available_at,
    status,
    idempotency_key
  )
  values (
    new.user_id,
    new.id,
    new.reminder_at,
    new.reminder_at,
    'scheduled',
    reminder_job_key
  )
  on conflict (user_id, idempotency_key) do update
  set
    status = 'scheduled',
    available_at = excluded.available_at,
    external_job_id = null,
    attempt_count = 0,
    claim_token = null,
    lease_expires_at = null,
    last_error_code = null,
    last_attempt_at = null,
    completed_at = null
  where public.notification_jobs.status in ('cancelled', 'failed');

  return new;
end;
$$;

revoke all on table public.in_app_notifications
  from public, anon, authenticated, service_role;
grant select on table public.in_app_notifications to authenticated, service_role;

revoke all on function public.claim_due_notification_job(
  uuid, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.complete_notification_job(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.deliver_in_app_plan_reminder(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.mark_in_app_notification_read(
  uuid, boolean, timestamptz
) from public, anon;

grant execute on function public.claim_due_notification_job(
  uuid, timestamptz, integer
) to service_role;
grant execute on function public.complete_notification_job(
  uuid, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.deliver_in_app_plan_reminder(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.mark_in_app_notification_read(
  uuid, boolean, timestamptz
) to authenticated;

commit;
