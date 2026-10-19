-- Controlled, owner-scoped mutations for long-term memory.
-- This migration is intentionally not executed automatically by the app.

begin;

alter table public.memory_candidates
  add column supersedes_memory_id uuid
  references public.memories(id) on delete set null,
  add column decision_idempotency_key text;

alter table public.memory_candidates
  add constraint memory_candidates_decision_idempotency_key_length
  check (
    decision_idempotency_key is null
    or char_length(btrim(decision_idempotency_key)) between 8 and 200
  );

alter table public.memories
  add column mutation_idempotency_key text,
  add column deletion_idempotency_key text;

alter table public.memories
  add constraint memories_mutation_idempotency_key_length
  check (
    mutation_idempotency_key is null
    or char_length(btrim(mutation_idempotency_key)) between 8 and 200
  ),
  add constraint memories_deletion_idempotency_key_length
  check (
    deletion_idempotency_key is null
    or char_length(btrim(deletion_idempotency_key)) between 8 and 200
  );

create unique index memory_candidates_user_decision_idempotency_unique
  on public.memory_candidates(user_id, decision_idempotency_key)
  where decision_idempotency_key is not null;

create unique index memories_user_mutation_idempotency_unique
  on public.memories(user_id, mutation_idempotency_key)
  where mutation_idempotency_key is not null;

create unique index memories_user_deletion_idempotency_unique
  on public.memories(user_id, deletion_idempotency_key)
  where deletion_idempotency_key is not null;

create index memory_candidates_supersedes_idx
  on public.memory_candidates(supersedes_memory_id)
  where supersedes_memory_id is not null;

-- Keep candidate-side checks in step with the controlled mutation functions.
-- A role-private candidate must originate from a visible user turn in that
-- exact role, and a dynamic replacement may only target its own scope.
create or replace function public.validate_memory_candidate_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_memory public.memories%rowtype;
begin
  if new.suggested_scope = 'user_shared' and new.role_id is not null then
    raise exception 'user-shared memory candidate cannot carry role_id';
  end if;

  if new.suggested_scope = 'role_private' and new.role_id is null then
    raise exception 'role-private memory candidate requires role_id';
  end if;

  if new.sensitivity = 'sensitive' and new.suggested_scope <> 'role_private' then
    raise exception 'sensitive memory candidate must be role-private';
  end if;

  if not exists (
    select 1
    from public.messages m
    where m.id = new.source_message_id
      and m.user_id = new.user_id
      and m.sender = 'user'
  ) then
    raise exception 'memory candidate source must be a user message owned by the same user';
  end if;

  if new.role_id is not null and not exists (
    select 1
    from public.roles r
    where r.id = new.role_id
      and r.user_id = new.user_id
  ) then
    raise exception 'memory candidate role must belong to the same user';
  end if;

  if new.suggested_scope = 'role_private' and not exists (
    select 1
    from public.messages m
    where m.id = new.source_message_id
      and m.user_id = new.user_id
      and m.role_id = new.role_id
      and m.sender = 'user'
  ) then
    raise exception 'role-private memory candidate source must be in the same role';
  end if;

  if new.supersedes_memory_id is not null then
    select *
    into previous_memory
    from public.memories m
    where m.id = new.supersedes_memory_id;

    if not found
       or previous_memory.user_id <> new.user_id
       or previous_memory.scope <> new.suggested_scope
       or previous_memory.role_id is distinct from new.role_id
       or (
         new.status = 'pending'
         and (previous_memory.status <> 'active' or previous_memory.deleted_at is not null)
       ) then
      raise exception 'memory candidate supersession target must be an active memory in the same user and scope';
    end if;
  end if;

  if new.confirmed_memory_id is not null and not exists (
    select 1
    from public.memories m
    where m.id = new.confirmed_memory_id
      and m.user_id = new.user_id
  ) then
    raise exception 'confirmed memory must belong to the same user';
  end if;

  return new;
end;
$$;

create or replace function public.confirm_memory_candidate(
  p_candidate_id uuid,
  p_edited_content text,
  p_edited_scope public.memory_scope,
  p_edited_role_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  candidate_row public.memory_candidates%rowtype;
  previous_memory public.memories%rowtype;
  new_memory_id uuid;
  target_scope public.memory_scope;
  target_role_id uuid;
  target_content text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_candidate_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid memory candidate confirmation input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into candidate_row
  from public.memory_candidates mc
  where mc.id = p_candidate_id
    and mc.user_id = current_user_id
  for update;

  if not found then
    raise exception 'memory candidate not found';
  end if;

  if candidate_row.decision_idempotency_key is not null then
    if candidate_row.decision_idempotency_key = p_idempotency_key
       and candidate_row.status = 'confirmed'
       and candidate_row.confirmed_memory_id is not null then
      return candidate_row.confirmed_memory_id;
    end if;

    raise exception 'memory candidate has already been decided';
  end if;

  if candidate_row.status <> 'pending' then
    raise exception 'memory candidate is not pending';
  end if;

  if candidate_row.expires_at <= now() then
    update public.memory_candidates
    set status = 'expired'
    where id = candidate_row.id;
    raise exception 'memory candidate has expired';
  end if;

  if not exists (
    select 1
    from public.messages m
    where m.id = candidate_row.source_message_id
      and m.user_id = current_user_id
      and m.sender = 'user'
      and m.status = 'completed'
      and m.deleted_at is null
  ) then
    raise exception 'memory candidate source is no longer available';
  end if;

  if p_edited_content is not null
     and char_length(btrim(p_edited_content)) not between 1 and 5000 then
    raise exception 'invalid memory content';
  end if;

  target_content := coalesce(nullif(btrim(p_edited_content), ''), candidate_row.content);
  target_scope := coalesce(p_edited_scope, candidate_row.suggested_scope);

  if target_scope = 'user_shared' then
    if p_edited_role_id is not null then
      raise exception 'user-shared memory cannot carry role_id';
    end if;
    target_role_id := null;
  else
    target_role_id := coalesce(p_edited_role_id, candidate_row.role_id);

    if target_role_id is null or not exists (
      select 1
      from public.roles r
      where r.id = target_role_id
        and r.user_id = current_user_id
    ) then
      raise exception 'role-private memory must target an owned role';
    end if;
  end if;

  if candidate_row.sensitivity = 'forbidden' then
    raise exception 'forbidden memory candidate cannot be confirmed';
  end if;

  if candidate_row.sensitivity = 'sensitive'
     and (
       target_scope <> 'role_private'
       or target_role_id is distinct from candidate_row.role_id
     ) then
    raise exception 'sensitive memory must remain private to its source role';
  end if;

  if candidate_row.supersedes_memory_id is not null then
    select *
    into previous_memory
    from public.memories m
    where m.id = candidate_row.supersedes_memory_id
      and m.user_id = current_user_id
    for update;

    if not found
       or previous_memory.status <> 'active'
       or previous_memory.deleted_at is not null
       or previous_memory.scope <> target_scope
       or previous_memory.role_id is distinct from target_role_id then
      raise exception 'memory replacement target is no longer active in the same scope';
    end if;
  elsif nullif(btrim(candidate_row.normalized_key), '') is not null
        and exists (
          select 1
          from public.memories m
          where m.user_id = current_user_id
            and m.status = 'active'
            and m.deleted_at is null
            and m.scope = target_scope
            and m.role_id is not distinct from target_role_id
            and m.normalized_key = candidate_row.normalized_key
        ) then
    raise exception 'memory candidate has an unresolved active conflict';
  end if;

  insert into public.memories (
    user_id,
    scope,
    role_id,
    category,
    content,
    normalized_key,
    sensitivity,
    status,
    source_message_id,
    confirmed_by_user,
    valid_from,
    supersedes_memory_id
  )
  values (
    current_user_id,
    target_scope,
    target_role_id,
    candidate_row.category,
    target_content,
    nullif(btrim(candidate_row.normalized_key), ''),
    candidate_row.sensitivity,
    'active',
    candidate_row.source_message_id,
    true,
    now(),
    candidate_row.supersedes_memory_id
  )
  returning id into new_memory_id;

  if candidate_row.supersedes_memory_id is not null then
    update public.memories
    set status = 'superseded',
        valid_to = now()
    where id = candidate_row.supersedes_memory_id
      and user_id = current_user_id
      and status = 'active'
      and deleted_at is null;
  end if;

  update public.memory_candidates
  set status = 'confirmed',
      confirmed_memory_id = new_memory_id,
      decision_idempotency_key = p_idempotency_key
  where id = candidate_row.id
    and user_id = current_user_id;

  return new_memory_id;
end;
$$;

create or replace function public.reject_memory_candidate(
  p_candidate_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  candidate_row public.memory_candidates%rowtype;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_candidate_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid memory candidate rejection input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into candidate_row
  from public.memory_candidates mc
  where mc.id = p_candidate_id
    and mc.user_id = current_user_id
  for update;

  if not found then
    raise exception 'memory candidate not found';
  end if;

  if candidate_row.decision_idempotency_key is not null then
    if candidate_row.decision_idempotency_key = p_idempotency_key
       and candidate_row.status = 'rejected' then
      return candidate_row.id;
    end if;

    raise exception 'memory candidate has already been decided';
  end if;

  if candidate_row.status <> 'pending' then
    raise exception 'memory candidate is not pending';
  end if;

  if candidate_row.expires_at <= now() then
    update public.memory_candidates
    set status = 'expired'
    where id = candidate_row.id;
    raise exception 'memory candidate has expired';
  end if;

  update public.memory_candidates
  set status = 'rejected',
      decision_idempotency_key = p_idempotency_key
  where id = candidate_row.id
    and user_id = current_user_id;

  return candidate_row.id;
end;
$$;

create or replace function public.replace_memory(
  p_memory_id uuid,
  p_content text,
  p_scope public.memory_scope,
  p_role_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_memory public.memories%rowtype;
  replacement_memory_id uuid;
  target_scope public.memory_scope;
  target_role_id uuid;
  target_content text;
  scope_changed boolean;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_memory_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid memory replacement input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select m.id
  into replacement_memory_id
  from public.memories m
  where m.user_id = current_user_id
    and m.mutation_idempotency_key = p_idempotency_key;

  if replacement_memory_id is not null then
    return replacement_memory_id;
  end if;

  if p_content is not null
     and char_length(btrim(p_content)) not between 1 and 5000 then
    raise exception 'invalid memory content';
  end if;

  select *
  into current_memory
  from public.memories m
  where m.id = p_memory_id
    and m.user_id = current_user_id
  for update;

  if not found or current_memory.status <> 'active' or current_memory.deleted_at is not null then
    raise exception 'active memory not found';
  end if;

  target_content := coalesce(nullif(btrim(p_content), ''), current_memory.content);
  target_scope := coalesce(p_scope, current_memory.scope);

  if target_scope = 'user_shared' then
    if p_role_id is not null then
      raise exception 'user-shared memory cannot carry role_id';
    end if;
    target_role_id := null;
  else
    target_role_id := coalesce(p_role_id, current_memory.role_id);

    if target_role_id is null or not exists (
      select 1
      from public.roles r
      where r.id = target_role_id
        and r.user_id = current_user_id
    ) then
      raise exception 'role-private memory must target an owned role';
    end if;
  end if;

  if current_memory.sensitivity = 'sensitive' and target_scope <> 'role_private' then
    raise exception 'sensitive memory cannot become user-shared';
  end if;

  if current_memory.content = target_content
     and current_memory.scope = target_scope
     and current_memory.role_id is not distinct from target_role_id then
    return current_memory.id;
  end if;

  scope_changed := current_memory.scope <> target_scope
    or current_memory.role_id is distinct from target_role_id;

  if nullif(btrim(current_memory.normalized_key), '') is not null
     and exists (
       select 1
       from public.memories m
       where m.user_id = current_user_id
         and m.id <> current_memory.id
         and m.status = 'active'
         and m.deleted_at is null
         and m.scope = target_scope
         and m.role_id is not distinct from target_role_id
         and m.normalized_key = current_memory.normalized_key
     ) then
    raise exception 'target memory scope already has an active conflict';
  end if;

  insert into public.memories (
    user_id,
    scope,
    role_id,
    category,
    content,
    normalized_key,
    sensitivity,
    status,
    source_message_id,
    confirmed_by_user,
    valid_from,
    supersedes_memory_id,
    mutation_idempotency_key
  )
  values (
    current_user_id,
    target_scope,
    target_role_id,
    current_memory.category,
    target_content,
    current_memory.normalized_key,
    current_memory.sensitivity,
    'active',
    current_memory.source_message_id,
    true,
    now(),
    case when scope_changed then null else current_memory.id end,
    p_idempotency_key
  )
  returning id into replacement_memory_id;

  if scope_changed then
    update public.memories
    set status = 'deleted',
        deleted_at = now(),
        valid_to = now()
    where id = current_memory.id
      and user_id = current_user_id
      and status = 'active'
      and deleted_at is null;
  else
    update public.memories
    set status = 'superseded',
        valid_to = now()
    where id = current_memory.id
      and user_id = current_user_id
      and status = 'active'
      and deleted_at is null;
  end if;

  return replacement_memory_id;
end;
$$;

create or replace function public.delete_memory(
  p_memory_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  memory_row public.memories%rowtype;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_memory_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid memory deletion input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select *
  into memory_row
  from public.memories m
  where m.id = p_memory_id
    and m.user_id = current_user_id
  for update;

  if not found then
    raise exception 'memory not found';
  end if;

  if memory_row.status = 'deleted' then
    if memory_row.deletion_idempotency_key = p_idempotency_key then
      return memory_row.id;
    end if;

    raise exception 'memory has already been deleted';
  end if;

  update public.memories
  set status = 'deleted',
      deleted_at = now(),
      valid_to = coalesce(valid_to, now()),
      deletion_idempotency_key = p_idempotency_key
  where id = memory_row.id
    and user_id = current_user_id
    and status <> 'deleted';

  return memory_row.id;
end;
$$;

revoke all on function public.confirm_memory_candidate(
  uuid, text, public.memory_scope, uuid, text
) from public;
revoke all on function public.reject_memory_candidate(uuid, text) from public;
revoke all on function public.replace_memory(
  uuid, text, public.memory_scope, uuid, text
) from public;
revoke all on function public.delete_memory(uuid, text) from public;

grant execute on function public.confirm_memory_candidate(
  uuid, text, public.memory_scope, uuid, text
) to authenticated;
grant execute on function public.reject_memory_candidate(uuid, text) to authenticated;
grant execute on function public.replace_memory(
  uuid, text, public.memory_scope, uuid, text
) to authenticated;
grant execute on function public.delete_memory(uuid, text) to authenticated;

commit;
