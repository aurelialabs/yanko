-- Keep candidate confirmation bound to its source role, and prevent a
-- sensitive formal memory from being moved into another persona timeline.

begin;

alter function public.confirm_memory_candidate(
  uuid, text, public.memory_scope, uuid, text
) rename to confirm_memory_candidate_internal;

revoke all on function public.confirm_memory_candidate_internal(
  uuid, text, public.memory_scope, uuid, text
) from public, anon, authenticated, service_role;

create function public.confirm_memory_candidate(
  p_candidate_id uuid,
  p_edited_content text,
  p_edited_scope public.memory_scope,
  p_edited_role_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  candidate_row public.memory_candidates%rowtype;
  source_role_id uuid;
  target_scope public.memory_scope;
  target_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select mc.*
  into candidate_row
  from public.memory_candidates mc
  where mc.id = p_candidate_id
    and mc.user_id = current_user_id;

  if not found then
    raise exception 'memory candidate not found';
  end if;

  select m.role_id
  into source_role_id
  from public.messages m
  where m.id = candidate_row.source_message_id
    and m.user_id = current_user_id;

  if source_role_id is null then
    raise exception 'memory candidate source is no longer available';
  end if;

  target_scope := coalesce(p_edited_scope, candidate_row.suggested_scope);
  if target_scope = 'user_shared' then
    if p_edited_role_id is not null then
      raise exception 'user-shared memory cannot carry role_id';
    end if;
  else
    target_role_id := coalesce(
      p_edited_role_id,
      candidate_row.role_id,
      source_role_id
    );
    if target_role_id is distinct from source_role_id then
      raise exception 'memory candidate cannot move to another role';
    end if;
  end if;

  return public.confirm_memory_candidate_internal(
    p_candidate_id,
    p_edited_content,
    p_edited_scope,
    p_edited_role_id,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.confirm_memory_candidate(
  uuid, text, public.memory_scope, uuid, text
) from public, anon;
grant execute on function public.confirm_memory_candidate(
  uuid, text, public.memory_scope, uuid, text
) to authenticated;

alter function public.replace_memory(
  uuid, text, public.memory_scope, uuid, text
) rename to replace_memory_internal;

revoke all on function public.replace_memory_internal(
  uuid, text, public.memory_scope, uuid, text
) from public, anon, authenticated, service_role;

create function public.replace_memory(
  p_memory_id uuid,
  p_content text,
  p_scope public.memory_scope,
  p_role_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  current_memory public.memories%rowtype;
  existing_replacement_id uuid;
  target_scope public.memory_scope;
  target_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select m.id
  into existing_replacement_id
  from public.memories m
  where m.user_id = current_user_id
    and m.mutation_idempotency_key = btrim(p_idempotency_key);

  if existing_replacement_id is not null then
    return existing_replacement_id;
  end if;

  select *
  into current_memory
  from public.memories m
  where m.id = p_memory_id
    and m.user_id = current_user_id;

  if not found then
    raise exception 'active memory not found';
  end if;

  target_scope := coalesce(p_scope, current_memory.scope);
  target_role_id := case
    when target_scope = 'user_shared' then null
    else coalesce(p_role_id, current_memory.role_id)
  end;

  if current_memory.sensitivity = 'sensitive'
     and (
       target_scope <> 'role_private'
       or target_role_id is distinct from current_memory.role_id
     ) then
    raise exception 'sensitive memory must remain private to its original role';
  end if;

  return public.replace_memory_internal(
    p_memory_id,
    p_content,
    p_scope,
    p_role_id,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.replace_memory(
  uuid, text, public.memory_scope, uuid, text
) from public, anon;
grant execute on function public.replace_memory(
  uuid, text, public.memory_scope, uuid, text
) to authenticated;

commit;
