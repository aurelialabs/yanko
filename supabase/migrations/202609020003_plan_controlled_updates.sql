-- Controlled, owner-scoped plan detail updates.
-- Only title and notes are editable; scope, period, parent and status remain immutable.

begin;

create table public.plan_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null,
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.plan_updates enable row level security;
revoke all on table public.plan_updates from public, anon, authenticated;

create or replace function public.update_plan_details(
  p_plan_id uuid,
  p_title text,
  p_notes text,
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
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan update input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into replay_update
  from public.plan_updates pu
  where pu.user_id = current_user_id
    and pu.idempotency_key = p_idempotency_key;

  if replay_update.id is not null then
    if replay_update.plan_id <> p_plan_id
      or replay_update.title <> normalized_title
      or replay_update.notes is distinct from normalized_notes then
      raise exception 'plan update idempotency key conflict';
    end if;
    return replay_update.plan_id;
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

  insert into public.plan_updates (
    user_id,
    plan_id,
    idempotency_key,
    title,
    notes
  )
  values (
    current_user_id,
    plan_row.id,
    p_idempotency_key,
    normalized_title,
    normalized_notes
  )
  on conflict (user_id, idempotency_key) do nothing;

  select *
  into replay_update
  from public.plan_updates pu
  where pu.user_id = current_user_id
    and pu.idempotency_key = p_idempotency_key;

  if replay_update.plan_id <> p_plan_id
    or replay_update.title <> normalized_title
    or replay_update.notes is distinct from normalized_notes then
    raise exception 'plan update idempotency key conflict';
  end if;

  update public.plans
  set title = normalized_title,
      notes = normalized_notes
  where id = plan_row.id
    and user_id = current_user_id;

  return plan_row.id;
end;
$$;

revoke all on function public.update_plan_details(uuid, text, text, text) from public;
grant execute on function public.update_plan_details(uuid, text, text, text) to authenticated;

commit;
