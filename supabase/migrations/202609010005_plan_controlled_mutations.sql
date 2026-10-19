-- Controlled, owner-scoped plan mutations.
-- This migration is intentionally not executed automatically by the app.

begin;

alter table public.plans
  add constraint plans_idempotency_key_length
  check (char_length(btrim(idempotency_key)) between 8 and 200);

alter table public.plan_status_events
  add column idempotency_key text,
  add constraint plan_status_events_idempotency_key_length
  check (
    idempotency_key is null
    or char_length(btrim(idempotency_key)) between 8 and 200
  );

create unique index plan_status_events_user_idempotency_unique
  on public.plan_status_events(user_id, idempotency_key)
  where idempotency_key is not null;

create table public.plan_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null,
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.plan_deletions enable row level security;

-- Plans used to grant direct mutation rights to authenticated browser clients.
-- Remove those permissions after replacing them with the functions below.
drop policy if exists plans_insert_own on public.plans;
drop policy if exists plans_update_own on public.plans;
drop policy if exists plans_delete_own on public.plans;
revoke insert, update, delete on table public.plans from authenticated;

create or replace function public.record_plan_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.plan_status_events (
      user_id,
      plan_id,
      from_status,
      to_status,
      source,
      changed_by_user_id,
      idempotency_key
    )
    values (
      new.user_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      case when auth.uid() is null then 'system' else 'user' end,
      auth.uid(),
      nullif(current_setting('app.plan_status_idempotency_key', true), '')
    );
  end if;
  return new;
end;
$$;

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

create or replace function public.change_plan_status(
  p_plan_id uuid,
  p_expected_status public.plan_status,
  p_next_status public.plan_status,
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
  replay_plan_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_plan_id is null
    or p_expected_status is null
    or p_next_status is null
    or p_expected_status not in ('pending', 'active', 'completed', 'cancelled')
    or p_next_status not in ('active', 'completed', 'cancelled')
    or p_expected_status = p_next_status
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan status change input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select pse.plan_id
  into replay_plan_id
  from public.plan_status_events pse
  where pse.user_id = current_user_id
    and pse.idempotency_key = p_idempotency_key;

  if replay_plan_id is not null then
    return replay_plan_id;
  end if;

  select *
  into plan_row
  from public.plans p
  where p.id = p_plan_id
    and p.user_id = current_user_id
  for update;

  if not found then
    raise exception 'plan not found';
  end if;

  if plan_row.status <> p_expected_status then
    raise exception 'plan status changed before this request completed';
  end if;

  perform set_config('app.plan_status_idempotency_key', p_idempotency_key, true);

  update public.plans
  set status = p_next_status,
      completed_at = case when p_next_status = 'completed' then now() else null end
  where id = plan_row.id
    and user_id = current_user_id
    and status = p_expected_status;

  return plan_row.id;
end;
$$;

create or replace function public.delete_plan(
  p_plan_id uuid,
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
  replay_plan_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_plan_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan deletion input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select pd.plan_id
  into replay_plan_id
  from public.plan_deletions pd
  where pd.user_id = current_user_id
    and pd.idempotency_key = p_idempotency_key;

  if replay_plan_id is not null then
    return replay_plan_id;
  end if;

  select *
  into plan_row
  from public.plans p
  where p.id = p_plan_id
    and p.user_id = current_user_id
  for update;

  if not found then
    select pd.plan_id
    into replay_plan_id
    from public.plan_deletions pd
    where pd.user_id = current_user_id
      and pd.idempotency_key = p_idempotency_key;

    if replay_plan_id is not null then
      return replay_plan_id;
    end if;

    raise exception 'plan not found';
  end if;

  insert into public.plan_deletions (user_id, plan_id, idempotency_key)
  values (current_user_id, plan_row.id, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing;

  select pd.plan_id
  into replay_plan_id
  from public.plan_deletions pd
  where pd.user_id = current_user_id
    and pd.idempotency_key = p_idempotency_key;

  if replay_plan_id is distinct from plan_row.id then
    raise exception 'plan deletion idempotency key conflict';
  end if;

  delete from public.plans
  where id = plan_row.id
    and user_id = current_user_id;

  return plan_row.id;
end;
$$;

revoke all on table public.plan_deletions from public;
revoke all on function public.create_manual_plan(
  public.plan_scope, text, text, date, date, date, timestamptz, timestamptz,
  text, uuid, text
) from public;
revoke all on function public.change_plan_status(
  uuid, public.plan_status, public.plan_status, text
) from public;
revoke all on function public.delete_plan(uuid, text) from public;

grant execute on function public.create_manual_plan(
  public.plan_scope, text, text, date, date, date, timestamptz, timestamptz,
  text, uuid, text
) to authenticated;
grant execute on function public.change_plan_status(
  uuid, public.plan_status, public.plan_status, text
) to authenticated;
grant execute on function public.delete_plan(uuid, text) to authenticated;

commit;
