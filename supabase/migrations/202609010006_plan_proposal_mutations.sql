-- Controlled plan-proposal creation and confirmation.
-- This migration is intentionally not executed automatically by the app.

begin;

alter table public.plan_proposals
  add column idempotency_key text,
  add column confirmation_idempotency_key text,
  add constraint plan_proposals_idempotency_key_length
    check (
      idempotency_key is null
      or char_length(btrim(idempotency_key)) between 8 and 200
    ),
  add constraint plan_proposals_confirmation_idempotency_key_length
    check (
      confirmation_idempotency_key is null
      or char_length(btrim(confirmation_idempotency_key)) between 8 and 200
    ),
  add constraint plan_proposals_expiry_after_creation
    check (expires_at > created_at);

create unique index plan_proposals_user_idempotency_unique
  on public.plan_proposals(user_id, idempotency_key)
  where idempotency_key is not null;

create unique index plan_proposals_user_confirmation_idempotency_unique
  on public.plan_proposals(user_id, confirmation_idempotency_key)
  where confirmation_idempotency_key is not null;

-- No browser client may insert, change, or confirm a proposal by writing the
-- table directly. The owner-scoped RPCs below are the only mutation path.
drop policy if exists plan_proposals_insert_own on public.plan_proposals;
drop policy if exists plan_proposals_update_own on public.plan_proposals;
drop policy if exists plan_proposals_delete_own on public.plan_proposals;
revoke insert, update, delete on table public.plan_proposals from authenticated;

create or replace function public.create_plan_proposal(
  p_source_role_id uuid,
  p_source_message_id uuid,
  p_scope public.plan_scope,
  p_parsed_payload jsonb,
  p_missing_fields text[],
  p_confidence numeric,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_role_id uuid;
  proposal_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_source_role_id is null
    or p_source_message_id is null
    or p_scope is null
    or p_parsed_payload is null
    or jsonb_typeof(p_parsed_payload) <> 'object'
    or octet_length(p_parsed_payload::text) > 10000
    or p_missing_fields is null
    or coalesce(array_length(p_missing_fields, 1), 0) > 20
    or exists (
      select 1
      from unnest(p_missing_fields) as field_name
      where field_name is null
        or char_length(btrim(field_name)) not between 1 and 100
    )
    or p_confidence is null
    or p_confidence < 0
    or p_confidence > 1
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan proposal input';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_parsed_payload) as payload_key
    where (p_scope = 'day' and payload_key not in ('date', 'scheduledAt', 'reminderAt'))
       or (p_scope = 'week' and payload_key not in ('weekStart', 'dueDate'))
       or (p_scope = 'month' and payload_key not in ('month', 'dueDate'))
       or (p_scope = 'year' and payload_key not in ('year', 'parentPlanId', 'dueDate'))
  ) then
    raise exception 'plan proposal payload contains unsupported fields';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select p.current_role_id
  into current_role_id
  from public.profiles p
  where p.id = current_user_id;

  if current_role_id is distinct from p_source_role_id then
    raise exception 'plan proposal source role must be the current role';
  end if;

  if not exists (
    select 1
    from public.messages m
    where m.id = p_source_message_id
      and m.user_id = current_user_id
      and m.role_id = p_source_role_id
      and m.sender = 'user'
      and m.status = 'completed'
      and m.deleted_at is null
  ) then
    raise exception 'plan proposal source must be a completed user message in the current role';
  end if;

  select pp.id
  into proposal_id
  from public.plan_proposals pp
  where pp.user_id = current_user_id
    and pp.idempotency_key = p_idempotency_key;

  if proposal_id is not null then
    return proposal_id;
  end if;

  insert into public.plan_proposals (
    user_id,
    source_role_id,
    source_message_id,
    intent,
    scope,
    parsed_payload,
    missing_fields,
    confidence,
    idempotency_key
  )
  values (
    current_user_id,
    p_source_role_id,
    p_source_message_id,
    'create',
    p_scope,
    p_parsed_payload,
    p_missing_fields,
    p_confidence,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into proposal_id;

  if proposal_id is null then
    select pp.id
    into proposal_id
    from public.plan_proposals pp
    where pp.user_id = current_user_id
      and pp.idempotency_key = p_idempotency_key;
  end if;

  return proposal_id;
end;
$$;

create or replace function public.confirm_plan_proposal(
  p_proposal_id uuid,
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
  proposal_row public.plan_proposals%rowtype;
  created_plan_id uuid;
  existing_plan_id uuid;
  next_sort_order numeric(12, 4);
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_proposal_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan proposal confirmation input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into proposal_row
  from public.plan_proposals pp
  where pp.id = p_proposal_id
    and pp.user_id = current_user_id
  for update;

  if not found then
    raise exception 'plan proposal not found';
  end if;

  -- Confirmation is idempotent at the proposal level: a replay cannot create
  -- another formal plan even if a stale client resubmits different fields.
  if proposal_row.status = 'confirmed' then
    if proposal_row.confirmed_plan_id is null then
      raise exception 'confirmed plan proposal is missing its formal plan';
    end if;

    return proposal_row.confirmed_plan_id;
  end if;

  if proposal_row.status <> 'pending' then
    raise exception 'plan proposal is no longer available for confirmation';
  end if;

  if proposal_row.expires_at <= now() then
    update public.plan_proposals
    set status = 'expired'
    where id = proposal_row.id
      and user_id = current_user_id
      and status = 'pending';

    return null;
  end if;

  if proposal_row.intent <> 'create' then
    raise exception 'only an explicit create proposal can be confirmed';
  end if;

  if p_scope is null
    or p_scope <> proposal_row.scope
    or p_title is null
    or char_length(btrim(p_title)) not between 1 and 200
    or (p_notes is not null and char_length(btrim(p_notes)) > 5000)
    or p_period_start is null
    or p_period_end is null
    or p_timezone is null
    or char_length(btrim(p_timezone)) not between 1 and 64
    or (p_reminder_at is not null and (
      p_scheduled_at is null or p_reminder_at > p_scheduled_at
    )) then
    raise exception 'invalid final plan input';
  end if;

  if (p_scope = 'day' and (p_parent_plan_id is not null or p_due_date is not null))
    or (p_scope in ('week', 'month') and (
      p_parent_plan_id is not null
      or p_scheduled_at is not null
      or p_reminder_at is not null
    ))
    or (p_scope = 'year' and (
      p_scheduled_at is not null or p_reminder_at is not null
    )) then
    raise exception 'final plan fields do not match the selected scope';
  end if;

  select p.id
  into existing_plan_id
  from public.plans p
  where p.user_id = current_user_id
    and p.idempotency_key = p_idempotency_key;

  if existing_plan_id is not null then
    raise exception 'plan confirmation idempotency key is already in use';
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
    'chat',
    proposal_row.source_role_id,
    next_sort_order,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into created_plan_id;

  if created_plan_id is null then
    raise exception 'plan confirmation idempotency key is already in use';
  end if;

  update public.plan_proposals as pp
  set
    status = 'confirmed',
    confirmed_plan_id = created_plan_id,
    confirmation_idempotency_key = p_idempotency_key
  where pp.id = proposal_row.id
    and pp.user_id = current_user_id
    and pp.status = 'pending';

  return created_plan_id;
end;
$$;

revoke all on function public.create_plan_proposal(
  uuid, uuid, public.plan_scope, jsonb, text[], numeric, text
) from public;
revoke all on function public.confirm_plan_proposal(
  uuid, public.plan_scope, text, text, date, date, date, timestamptz,
  timestamptz, text, uuid, text
) from public;

grant execute on function public.create_plan_proposal(
  uuid, uuid, public.plan_scope, jsonb, text[], numeric, text
) to authenticated;
grant execute on function public.confirm_plan_proposal(
  uuid, public.plan_scope, text, text, date, date, date, timestamptz,
  timestamptz, text, uuid, text
) to authenticated;

commit;
