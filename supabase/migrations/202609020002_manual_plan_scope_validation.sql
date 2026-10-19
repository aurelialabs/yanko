-- Validate time scopes and parent-goal ownership inside the controlled plan RPC.
-- This protects direct RPC callers as well as the web form.

begin;

create or replace function public.create_manual_plan(
  p_scope public.plan_scope,
  p_title text,
  p_notes text,
  p_period_start date,
  p_period_end date,
  p_due_date date,
  p_scheduled_at timestamptz,
  p_reminder_at timestamptz,
  p_timezone text,
  p_parent_plan_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  created_plan_id uuid;
  next_sort_order numeric(12, 4);
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_scope is null
    or p_title is null
    or char_length(btrim(p_title)) not between 1 and 200
    or (p_notes is not null and char_length(btrim(p_notes)) > 5000)
    or p_period_start is null
    or p_period_end is null
    or p_timezone is null
    or char_length(btrim(p_timezone)) not between 1 and 64
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid manual plan input';
  end if;

  if (p_scope = 'day' and p_period_start <> p_period_end)
    or (p_scope = 'week' and (
      extract(isodow from p_period_start) <> 1
      or p_period_end <> p_period_start + 6
    ))
    or (p_scope = 'month' and (
      p_period_start <> date_trunc('month', p_period_start)::date
      or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date
    ))
    or (p_scope = 'year' and (
      p_period_start <> make_date(extract(year from p_period_start)::integer, 1, 1)
      or p_period_end <> make_date(extract(year from p_period_start)::integer, 12, 31)
    )) then
    raise exception 'invalid plan period for scope';
  end if;

  if p_due_date is not null
    and (p_due_date < p_period_start or p_due_date > p_period_end) then
    raise exception 'due date must be inside the plan period';
  end if;

  if p_scope <> 'day' and (p_scheduled_at is not null or p_reminder_at is not null) then
    raise exception 'only daily plans can have a scheduled time or reminder';
  end if;

  if p_parent_plan_id is not null and p_scope <> 'year' then
    raise exception 'only annual plans can have a parent goal';
  end if;

  if p_parent_plan_id is not null and not exists (
    select 1
    from public.plans parent_plan
    where parent_plan.id = p_parent_plan_id
      and parent_plan.user_id = current_user_id
      and parent_plan.scope = 'year'
      and parent_plan.parent_plan_id is null
      and parent_plan.period_start = p_period_start
      and parent_plan.period_end = p_period_end
  ) then
    raise exception 'annual parent goal must belong to the current user and year';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select p.id
  into created_plan_id
  from public.plans p
  where p.user_id = current_user_id
    and p.idempotency_key = p_idempotency_key;

  if created_plan_id is not null then
    return created_plan_id;
  end if;

  select coalesce(max(p.sort_order), 0) + 1
  into next_sort_order
  from public.plans p
  where p.user_id = current_user_id
    and p.scope = p_scope
    and p.period_start = p_period_start
    and p.parent_plan_id is not distinct from p_parent_plan_id;

  insert into public.plans (
    user_id,
    scope,
    parent_plan_id,
    title,
    notes,
    status,
    period_start,
    period_end,
    due_date,
    scheduled_at,
    reminder_at,
    timezone,
    source,
    source_role_id,
    sort_order,
    idempotency_key
  )
  values (
    current_user_id,
    p_scope,
    p_parent_plan_id,
    btrim(p_title),
    nullif(btrim(p_notes), ''),
    'active',
    p_period_start,
    p_period_end,
    p_due_date,
    p_scheduled_at,
    p_reminder_at,
    btrim(p_timezone),
    'manual',
    null,
    next_sort_order,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into created_plan_id;

  if created_plan_id is null then
    select p.id
    into created_plan_id
    from public.plans p
    where p.user_id = current_user_id
      and p.idempotency_key = p_idempotency_key;
  end if;

  return created_plan_id;
end;
$$;

commit;
