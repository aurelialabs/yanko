-- Keep future Web Push scheduling in a database-owned, idempotent queue.
-- This migration is intentionally not executed automatically by the app.

begin;

alter table public.notification_jobs
  add constraint notification_jobs_idempotency_key_length
  check (char_length(btrim(idempotency_key)) between 8 and 200);

create or replace function public.sync_plan_reminder_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reminder_job_key text;
begin
  -- A changed reminder, a completed plan, or a cancelled plan must prevent
  -- every outstanding job for this plan from being delivered. A future worker
  -- will re-check this status immediately before sending any push message.
  update public.notification_jobs nj
  set status = 'cancelled'
  where nj.user_id = new.user_id
    and nj.plan_id = new.id
    and nj.status in ('scheduled', 'running');

  -- Formal weekly, monthly, and annual plans cannot carry reminders by their
  -- schema constraint. The explicit day check is retained here so the queue
  -- remains safe even if that constraint changes in a future migration.
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
    status,
    idempotency_key
  )
  values (
    new.user_id,
    new.id,
    new.reminder_at,
    'scheduled',
    reminder_job_key
  )
  on conflict (user_id, idempotency_key) do update
  set
    status = 'scheduled',
    external_job_id = null,
    attempt_count = 0,
    last_error_code = null,
    last_attempt_at = null,
    completed_at = null
  where public.notification_jobs.status in ('cancelled', 'failed');

  return new;
end;
$$;

drop trigger if exists plans_sync_reminder_job on public.plans;

create trigger plans_sync_reminder_job
  after insert or update of status, reminder_at
  on public.plans
  for each row
  execute function public.sync_plan_reminder_job();

revoke all on function public.sync_plan_reminder_job() from public;

commit;
