-- Atomic, service-role-only notification job dispatch lifecycle.
-- This migration is intentionally safe for local application with no reset.

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
set search_path = public, auth
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

  select *
  into job_row
  from public.notification_jobs nj
  where nj.id = p_job_id
  for update;

  if not found
    or job_row.status <> 'scheduled'
    or job_row.scheduled_for > p_now then
    return;
  end if;

  select *
  into plan_row
  from public.plans p
  where p.id = job_row.plan_id
    and p.user_id = job_row.user_id
  for update;

  if not found
    or plan_row.scope <> 'day'
    or plan_row.status <> 'active'
    or plan_row.reminder_at is distinct from job_row.scheduled_for then
    update public.notification_jobs
    set status = 'cancelled'
    where id = job_row.id
      and user_id = job_row.user_id
      and status = 'scheduled';

    return;
  end if;

  update public.notification_jobs
  set
    status = 'running',
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    last_error_code = null
  where id = job_row.id
    and user_id = job_row.user_id
    and status = 'scheduled';

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
set search_path = public, auth
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

  select *
  into current_job
  from public.notification_jobs nj
  where nj.id = p_job_id
  for update;

  if not found then
    raise exception 'notification job not found';
  end if;

  if current_job.status <> 'running' then
    return current_job.status;
  end if;

  final_status := case when p_succeeded then 'succeeded' else 'failed' end;

  update public.notification_jobs
  set
    status = final_status,
    completed_at = case when p_succeeded then now() else null end,
    last_error_code = case when p_succeeded then null else btrim(p_error_code) end
  where id = current_job.id
    and status = 'running';

  return final_status;
end;
$$;

revoke all on function public.claim_due_notification_job(uuid, timestamptz) from public;
revoke all on function public.complete_notification_job(uuid, boolean, text) from public;

grant execute on function public.claim_due_notification_job(uuid, timestamptz) to service_role;
grant execute on function public.complete_notification_job(uuid, boolean, text) to service_role;

commit;
