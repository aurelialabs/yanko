-- Idempotent, user-scoped persona feedback mutation.
-- This migration is intentionally not executed automatically by the app.

alter table public.persona_feedback
  add column idempotency_key text;

alter table public.persona_feedback
  add constraint persona_feedback_idempotency_key_length
  check (
    idempotency_key is null
    or char_length(btrim(idempotency_key)) between 8 and 200
  );

create unique index persona_feedback_user_idempotency_unique
  on public.persona_feedback(user_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.submit_persona_feedback(
  p_message_id uuid,
  p_role_id uuid,
  p_persona_version_id uuid,
  p_categories text[],
  p_additional_text text,
  p_entry_point text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  feedback_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_message_id is null
    or p_role_id is null
    or p_persona_version_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid persona feedback input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  if p_categories is null
    or cardinality(p_categories) not between 1 and 7
    or array_position(p_categories, null) is not null
    or not p_categories <@ array[
      'tone_mismatch',
      'identity_conflict',
      'fact_error',
      'memory_error',
      'too_cold',
      'boundary_violation',
      'other'
    ]::text[] then
    raise exception 'invalid persona feedback categories';
  end if;

  if p_entry_point is null
    or p_entry_point not in ('long_press', 'context_menu')
    or (p_additional_text is not null and char_length(btrim(p_additional_text)) > 2000) then
    raise exception 'invalid persona feedback fields';
  end if;

  select pf.id
  into feedback_id
  from public.persona_feedback pf
  where pf.user_id = current_user_id
    and pf.idempotency_key = p_idempotency_key;

  if feedback_id is not null then
    return feedback_id;
  end if;

  if not exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.user_id = current_user_id
      and m.role_id = p_role_id
      and m.persona_version_id = p_persona_version_id
      and m.sender = 'assistant'
      and m.status = 'completed'
      and m.deleted_at is null
  ) then
    raise exception 'feedback target must be a visible assistant message in the current scope';
  end if;

  insert into public.persona_feedback (
    user_id,
    message_id,
    role_id,
    persona_version_id,
    categories,
    additional_text,
    entry_point,
    idempotency_key
  )
  values (
    current_user_id,
    p_message_id,
    p_role_id,
    p_persona_version_id,
    p_categories,
    nullif(btrim(p_additional_text), ''),
    p_entry_point,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into feedback_id;

  if feedback_id is null then
    select pf.id
    into feedback_id
    from public.persona_feedback pf
    where pf.user_id = current_user_id
      and pf.idempotency_key = p_idempotency_key;
  end if;

  return feedback_id;
end;
$$;

revoke all on function public.submit_persona_feedback(uuid, uuid, uuid, text[], text, text, text) from public;
grant execute on function public.submit_persona_feedback(uuid, uuid, uuid, text[], text, text, text) to authenticated;
