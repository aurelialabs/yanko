-- Resolve the three pre-existing database lint findings without changing the
-- notification lifecycle or persona prompt output.

begin;

create or replace function public.claim_due_notification_job(
  p_job_id uuid,
  p_now timestamptz
)
returns table (
  job_id uuid,
  user_id uuid,
  plan_id uuid,
  scheduled_for timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  job_row public.notification_jobs%rowtype;
  plan_row public.plans%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null or p_now is null then
    raise exception 'notification job id and current time are required';
  end if;

  select notification_job.*
  into job_row
  from public.notification_jobs as notification_job
  where notification_job.id = p_job_id
  for update;

  if not found
    or job_row.status <> 'scheduled'
    or job_row.scheduled_for > p_now then
    return;
  end if;

  select plan.*
  into plan_row
  from public.plans as plan
  where plan.id = job_row.plan_id
    and plan.user_id = job_row.user_id
  for update;

  if not found
    or plan_row.scope <> 'day'
    or plan_row.status <> 'active'
    or plan_row.reminder_at is distinct from job_row.scheduled_for then
    update public.notification_jobs as cancelled_job
    set status = 'cancelled'
    where cancelled_job.id = job_row.id
      and cancelled_job.user_id = job_row.user_id
      and cancelled_job.status = 'scheduled';

    return;
  end if;

  update public.notification_jobs as claimed_job
  set
    status = 'running',
    attempt_count = claimed_job.attempt_count + 1,
    last_attempt_at = now(),
    last_error_code = null
  where claimed_job.id = job_row.id
    and claimed_job.user_id = job_row.user_id
    and claimed_job.status = 'scheduled';

  return query
  select job_row.id, job_row.user_id, job_row.plan_id, job_row.scheduled_for;
end;
$$;

create or replace function public.complete_notification_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_error_code text
)
returns public.job_status
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_job public.notification_jobs%rowtype;
  final_status public.job_status;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null or p_succeeded is null then
    raise exception 'notification completion input is required';
  end if;

  if (p_succeeded and p_error_code is not null)
    or (not p_succeeded and (
      p_error_code is null or char_length(btrim(p_error_code)) not between 1 and 120
    )) then
    raise exception 'notification completion result is invalid';
  end if;

  select notification_job.*
  into current_job
  from public.notification_jobs as notification_job
  where notification_job.id = p_job_id
  for update;

  if not found then
    raise exception 'notification job not found';
  end if;

  if current_job.status <> 'running' then
    return current_job.status;
  end if;

  final_status := (
    case when p_succeeded then 'succeeded' else 'failed' end
  )::public.job_status;

  update public.notification_jobs as completed_job
  set
    status = final_status,
    completed_at = case when p_succeeded then now() else null end,
    last_error_code = case when p_succeeded then null else btrim(p_error_code) end
  where completed_job.id = current_job.id
    and completed_job.status = 'running';

  return final_status;
end;
$$;

alter function public.compile_persona_prompt(jsonb) stable;

commit;
