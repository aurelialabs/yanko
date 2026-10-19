-- Extend controlled plan edits to the plan's time range and optional schedule.
-- The plan scope and hierarchy remain immutable.

begin;

alter table public.plan_updates
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists due_date date,
  add column if not exists scheduled_at timestamptz;

drop function if exists public.update_plan_details(uuid, text, text, text);

create or replace function public.update_plan_details(
  p_plan_id uuid,
  p_title text,
  p_notes text,
  p_period_start date,
  p_period_end date,
  p_due_date date,
  p_scheduled_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  plan_row public.plans%rowtype;
  replay_update public.plan_updates%rowtype;
  normalized_title text;
  normalized_notes text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  normalized_title := btrim(p_title);
  normalized_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if p_plan_id is null
    or normalized_title is null
    or char_length(normalized_title) not between 1 and 200
    or (normalized_notes is not null and char_length(normalized_notes) > 5000)
    or p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan update input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into plan_row
  from public.plans p
  where p.id = p_plan_id
    and p.user_id = current_user_id
  for update;

  if not found then
    raise exception 'plan not found';
  end if;

  if plan_row.scope = 'day' then
    if p_period_end <> p_period_start then
      raise exception 'day plan period must be one day';
    end if;
  elsif plan_row.scope = 'week' then
    if extract(isodow from p_period_start) <> 1
      or p_period_end <> p_period_start + 6 then
      raise exception 'week plan period must be seven days';
    end if;
  elsif plan_row.scope = 'month' then
    if p_period_start <> date_trunc('month', p_period_start)::date
      or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date then
      raise exception 'month plan period must cover one calendar month';
    end if;
  elsif plan_row.scope = 'year' then
    if p_period_start <> make_date(extract(year from p_period_start)::integer, 1, 1)
      or p_period_end <> make_date(extract(year from p_period_start)::integer, 12, 31) then
      raise exception 'year plan period must cover one calendar year';
    end if;
  end if;

  if p_due_date is not null
    and (p_due_date < p_period_start or p_due_date > p_period_end) then
    raise exception 'plan due date is outside its period';
  end if;

  if plan_row.scope <> 'day' and p_scheduled_at is not null then
    raise exception 'only day plans can have a scheduled time';
  end if;

  select *
  into replay_update
  from public.plan_updates pu
  where pu.user_id = current_user_id
    and pu.idempotency_key = p_idempotency_key;

  if replay_update.id is not null then
    if replay_update.plan_id <> p_plan_id
      or replay_update.title <> normalized_title
      or replay_update.notes is distinct from normalized_notes
      or replay_update.period_start is distinct from p_period_start
      or replay_update.period_end is distinct from p_period_end
      or replay_update.due_date is distinct from p_due_date
      or replay_update.scheduled_at is distinct from p_scheduled_at then
      raise exception 'plan update idempotency key conflict';
    end if;
    return replay_update.plan_id;
  end if;

  insert into public.plan_updates (
    user_id,
    plan_id,
    idempotency_key,
    title,
    notes,
    period_start,
    period_end,
    due_date,
    scheduled_at
  )
  values (
    current_user_id,
    plan_row.id,
    p_idempotency_key,
    normalized_title,
    normalized_notes,
    p_period_start,
    p_period_end,
    p_due_date,
    p_scheduled_at
  )
  on conflict (user_id, idempotency_key) do nothing;

  select *
  into replay_update
  from public.plan_updates pu
  where pu.user_id = current_user_id
    and pu.idempotency_key = p_idempotency_key;

  if replay_update.plan_id <> p_plan_id
    or replay_update.title <> normalized_title
    or replay_update.notes is distinct from normalized_notes
    or replay_update.period_start is distinct from p_period_start
    or replay_update.period_end is distinct from p_period_end
    or replay_update.due_date is distinct from p_due_date
    or replay_update.scheduled_at is distinct from p_scheduled_at then
    raise exception 'plan update idempotency key conflict';
  end if;

  update public.plans
  set title = normalized_title,
      notes = normalized_notes,
      period_start = p_period_start,
      period_end = p_period_end,
      due_date = p_due_date,
      scheduled_at = p_scheduled_at,
      reminder_at = null
  where id = plan_row.id
    and user_id = current_user_id;

  return plan_row.id;
end;
$$;

revoke all on function public.update_plan_details(
  uuid, text, text, date, date, date, timestamptz, text
) from public;
grant execute on function public.update_plan_details(
  uuid, text, text, date, date, date, timestamptz, text
) to authenticated;

commit;
