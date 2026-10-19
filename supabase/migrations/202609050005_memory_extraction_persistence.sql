-- Service-only persistence for policy-approved memory extraction operations.
-- The browser can read its own candidates and memories through RLS, but it
-- cannot create extraction runs or invoke this mutation directly.

begin;

create table public.memory_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null,
  source_message_id uuid not null,
  policy_version text not null,
  idempotency_key text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  unique (user_id, source_message_id),
  constraint memory_extraction_runs_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint memory_extraction_runs_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint memory_extraction_runs_policy_version_length check (
    char_length(btrim(policy_version)) between 1 and 100
  ),
  constraint memory_extraction_runs_idempotency_key_length check (
    char_length(btrim(idempotency_key)) between 8 and 200
  ),
  constraint memory_extraction_runs_result_object check (
    jsonb_typeof(result) = 'object'
  )
);

alter table public.memory_extraction_runs enable row level security;

alter table public.memory_candidates
  add column extraction_run_id uuid references public.memory_extraction_runs(id) on delete set null,
  add column extraction_candidate_index smallint;

alter table public.memory_candidates
  add constraint memory_candidates_extraction_index_check check (
    extraction_candidate_index is null
    or extraction_candidate_index between 0 and 19
  ),
  add constraint memory_candidates_extraction_pair_check check (
    (extraction_run_id is null and extraction_candidate_index is null)
    or
    (extraction_run_id is not null and extraction_candidate_index is not null)
  );

alter table public.memories
  add column extraction_run_id uuid references public.memory_extraction_runs(id) on delete set null,
  add column extraction_candidate_index smallint;

alter table public.memories
  add constraint memories_extraction_index_check check (
    extraction_candidate_index is null
    or extraction_candidate_index between 0 and 19
  ),
  add constraint memories_extraction_pair_check check (
    (extraction_run_id is null and extraction_candidate_index is null)
    or
    (extraction_run_id is not null and extraction_candidate_index is not null)
  );

create unique index memory_candidates_extraction_operation_unique
  on public.memory_candidates(extraction_run_id, extraction_candidate_index)
  where extraction_run_id is not null;

create unique index memories_extraction_operation_unique
  on public.memories(extraction_run_id, extraction_candidate_index)
  where extraction_run_id is not null;

create index memory_extraction_runs_user_created_idx
  on public.memory_extraction_runs(user_id, created_at desc);

create or replace function public.persist_memory_extraction(
  p_user_id uuid,
  p_role_id uuid,
  p_source_message_id uuid,
  p_policy_version text,
  p_idempotency_key text,
  p_operations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  existing_run public.memory_extraction_runs%rowtype;
  extraction_run_id uuid;
  operation_row jsonb;
  memory_row jsonb;
  operation_index integer;
  operation_action text;
  target_scope public.memory_scope;
  target_role_id uuid;
  target_category text;
  target_content text;
  target_normalized_key text;
  target_sensitivity public.memory_sensitivity;
  target_confidence numeric;
  target_supersedes_id uuid;
  previous_memory public.memories%rowtype;
  new_id uuid;
  candidate_ids uuid[] := '{}'::uuid[];
  memory_ids uuid[] := '{}'::uuid[];
  seen_indexes integer[] := '{}'::integer[];
  discarded_count integer := 0;
  operation_count integer;
  final_result jsonb;
begin
  if p_user_id is null
     or p_role_id is null
     or p_source_message_id is null
     or p_policy_version is null
     or char_length(btrim(p_policy_version)) not between 1 and 100
     or p_idempotency_key is null
     or char_length(btrim(p_idempotency_key)) not between 8 and 200
     or p_operations is null
     or jsonb_typeof(p_operations) <> 'array' then
    raise exception 'invalid memory extraction input';
  end if;

  p_policy_version := btrim(p_policy_version);
  p_idempotency_key := btrim(p_idempotency_key);
  operation_count := jsonb_array_length(p_operations);

  if operation_count > 20 then
    raise exception 'memory extraction exceeds operation limit';
  end if;

  -- Serialize every attempt for the same owned source message. This makes a
  -- retry safe even if a worker changes its request idempotency key.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_source_message_id::text, 0)
  );

  select *
  into existing_run
  from public.memory_extraction_runs mer
  where mer.user_id = p_user_id
    and mer.idempotency_key = p_idempotency_key;

  if found then
    if existing_run.role_id <> p_role_id
       or existing_run.source_message_id <> p_source_message_id then
      raise exception 'memory extraction idempotency key is already in use';
    end if;

    return existing_run.result || jsonb_build_object('replayed', true);
  end if;

  select *
  into existing_run
  from public.memory_extraction_runs mer
  where mer.user_id = p_user_id
    and mer.source_message_id = p_source_message_id;

  if found then
    if existing_run.role_id <> p_role_id then
      raise exception 'memory extraction source belongs to another role';
    end if;

    return existing_run.result || jsonb_build_object('replayed', true);
  end if;

  if not exists (
    select 1
    from public.roles r
    where r.id = p_role_id
      and r.user_id = p_user_id
      and r.status = 'active'
  ) then
    raise exception 'active memory extraction role not found';
  end if;

  if not exists (
    select 1
    from public.messages m
    where m.id = p_source_message_id
      and m.user_id = p_user_id
      and m.role_id = p_role_id
      and m.sender = 'user'
      and m.status = 'completed'
      and m.deleted_at is null
  ) then
    raise exception 'memory extraction source message is not available';
  end if;

  insert into public.memory_extraction_runs (
    user_id,
    role_id,
    source_message_id,
    policy_version,
    idempotency_key
  )
  values (
    p_user_id,
    p_role_id,
    p_source_message_id,
    p_policy_version,
    p_idempotency_key
  )
  returning id into extraction_run_id;

  for operation_row in
    select value from jsonb_array_elements(p_operations)
  loop
    if jsonb_typeof(operation_row) <> 'object'
       or jsonb_typeof(operation_row -> 'candidateIndex') <> 'number'
       or jsonb_typeof(operation_row -> 'action') <> 'string' then
      raise exception 'invalid memory extraction operation';
    end if;

    operation_index := (operation_row ->> 'candidateIndex')::integer;
    operation_action := operation_row ->> 'action';

    if operation_index not between 0 and 19
       or operation_index = any(seen_indexes)
       or operation_action not in ('auto_write', 'create_candidate', 'discard') then
      raise exception 'invalid memory extraction operation';
    end if;

    seen_indexes := array_append(seen_indexes, operation_index);

    if operation_action = 'discard' then
      if operation_row -> 'memory' <> 'null'::jsonb then
        raise exception 'discarded memory operation must not carry content';
      end if;
      discarded_count := discarded_count + 1;
      continue;
    end if;

    memory_row := operation_row -> 'memory';
    if memory_row is null or jsonb_typeof(memory_row) <> 'object' then
      raise exception 'persisted memory operation requires content';
    end if;

    if memory_row ->> 'sourceMessageId' is distinct from p_source_message_id::text then
      raise exception 'memory operation source does not match extraction source';
    end if;

    target_scope := (memory_row ->> 'scope')::public.memory_scope;
    target_role_id := nullif(memory_row ->> 'roleId', '')::uuid;
    target_category := btrim(memory_row ->> 'category');
    target_content := btrim(memory_row ->> 'content');
    target_normalized_key := nullif(btrim(memory_row ->> 'normalizedKey'), '');
    target_sensitivity := (memory_row ->> 'sensitivity')::public.memory_sensitivity;
    target_confidence := (memory_row ->> 'confidence')::numeric;
    target_supersedes_id := nullif(memory_row ->> 'supersedesMemoryId', '')::uuid;

    if target_category is null
       or char_length(target_category) not between 1 and 100
       or target_content is null
       or char_length(target_content) not between 1 and 5000
       or (target_normalized_key is not null and char_length(target_normalized_key) > 300)
       or target_confidence is null
       or target_confidence not between 0 and 1
       or target_sensitivity = 'forbidden' then
      raise exception 'invalid persisted memory content';
    end if;

    if target_scope = 'user_shared' then
      if target_role_id is not null or target_sensitivity = 'sensitive' then
        raise exception 'shared extraction memory has invalid role or sensitivity';
      end if;
    elsif target_role_id is distinct from p_role_id then
      raise exception 'role-private extraction memory must target the source role';
    end if;

    if target_supersedes_id is not null then
      select *
      into previous_memory
      from public.memories m
      where m.id = target_supersedes_id
        and m.user_id = p_user_id
      for update;

      if not found
         or previous_memory.status <> 'active'
         or previous_memory.deleted_at is not null
         or previous_memory.scope <> target_scope
         or previous_memory.role_id is distinct from target_role_id
         or nullif(btrim(previous_memory.normalized_key), '')
           is distinct from target_normalized_key then
        raise exception 'memory extraction replacement target is not active in the same scope';
      end if;
    elsif target_normalized_key is not null and exists (
      select 1
      from public.memories m
      where m.user_id = p_user_id
        and m.status = 'active'
        and m.deleted_at is null
        and m.scope = target_scope
        and m.role_id is not distinct from target_role_id
        and nullif(btrim(m.normalized_key), '') = target_normalized_key
    ) then
      raise exception 'memory extraction has an unresolved active conflict';
    end if;

    if operation_action = 'create_candidate' then
      insert into public.memory_candidates (
        user_id,
        role_id,
        source_message_id,
        suggested_scope,
        category,
        content,
        normalized_key,
        sensitivity,
        confidence,
        supersedes_memory_id,
        extraction_run_id,
        extraction_candidate_index
      )
      values (
        p_user_id,
        target_role_id,
        p_source_message_id,
        target_scope,
        target_category,
        target_content,
        target_normalized_key,
        target_sensitivity,
        target_confidence,
        target_supersedes_id,
        extraction_run_id,
        operation_index
      )
      returning id into new_id;

      candidate_ids := array_append(candidate_ids, new_id);
      continue;
    end if;

    if target_sensitivity <> 'normal' then
      raise exception 'automatic memory writes must be non-sensitive';
    end if;

    if target_supersedes_id is not null and previous_memory.confirmed_by_user then
      raise exception 'user-confirmed memory requires a confirmation candidate';
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
      extraction_run_id,
      extraction_candidate_index
    )
    values (
      p_user_id,
      target_scope,
      target_role_id,
      target_category,
      target_content,
      target_normalized_key,
      target_sensitivity,
      'active',
      p_source_message_id,
      false,
      now(),
      target_supersedes_id,
      extraction_run_id,
      operation_index
    )
    returning id into new_id;

    if target_supersedes_id is not null then
      update public.memories
      set status = 'superseded',
          valid_to = now()
      where id = target_supersedes_id
        and user_id = p_user_id
        and status = 'active'
        and deleted_at is null;
    end if;

    memory_ids := array_append(memory_ids, new_id);
  end loop;

  final_result := jsonb_build_object(
    'runId', extraction_run_id,
    'candidateIds', to_jsonb(candidate_ids),
    'memoryIds', to_jsonb(memory_ids),
    'discardedCount', discarded_count,
    'replayed', false
  );

  update public.memory_extraction_runs
  set result = final_result
  where id = extraction_run_id
    and user_id = p_user_id;

  return final_result;
end;
$$;

revoke all on table public.memory_extraction_runs from public, anon, authenticated;
grant select on table public.memory_extraction_runs to service_role;

revoke all on function public.persist_memory_extraction(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_memory_extraction(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

commit;
