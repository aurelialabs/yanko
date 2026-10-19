-- Service-only, versioned memory embeddings and scope-first vector retrieval.
-- No provider is called here; this migration only establishes the trusted
-- persistence and search boundary for a future explicitly configured worker.

begin;

alter table public.memories
  add constraint memories_embedding_identity_length_check check (
    embedding is null
    or (
      char_length(btrim(embedding_provider)) between 1 and 100
      and char_length(btrim(embedding_model)) between 1 and 200
    )
  );

create function public.set_memory_embedding(
  p_user_id uuid,
  p_memory_id uuid,
  p_expected_content text,
  p_expected_updated_at timestamptz,
  p_embedding_provider text,
  p_embedding_model text,
  p_embedding extensions.vector(1536)
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  current_memory public.memories%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_user_id is null
    or p_memory_id is null
    or p_expected_content is null
    or char_length(p_expected_content) not between 1 and 5000
    or p_expected_updated_at is null
    or p_embedding_provider is null
    or char_length(btrim(p_embedding_provider)) not between 1 and 100
    or p_embedding_model is null
    or char_length(btrim(p_embedding_model)) not between 1 and 200
    or p_embedding is null
    or vector_dims(p_embedding) <> 1536
    or vector_norm(p_embedding) <= 0 then
    raise exception 'memory embedding input is invalid';
  end if;

  select memory.*
  into current_memory
  from public.memories as memory
  where memory.id = p_memory_id
    and memory.user_id = p_user_id
    and memory.status = 'active'
    and memory.deleted_at is null
  for update;

  if not found then
    raise exception 'active memory not found';
  end if;

  if current_memory.content is distinct from p_expected_content then
    raise exception using
      errcode = '40001',
      message = 'memory embedding content conflict';
  end if;

  if current_memory.embedding is not null
    and current_memory.embedding_provider = btrim(p_embedding_provider)
    and current_memory.embedding_model = btrim(p_embedding_model) then
    return current_memory.id;
  end if;

  if current_memory.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'memory embedding version conflict';
  end if;

  update public.memories as memory
  set
    embedding = p_embedding,
    embedding_provider = btrim(p_embedding_provider),
    embedding_model = btrim(p_embedding_model)
  where memory.id = current_memory.id
    and memory.user_id = current_memory.user_id;

  return current_memory.id;
end;
$$;

create function public.match_memories_for_role(
  p_user_id uuid,
  p_role_id uuid,
  p_query_embedding extensions.vector(1536),
  p_embedding_provider text,
  p_embedding_model text,
  p_limit integer,
  p_min_similarity double precision,
  p_include_sensitive boolean,
  p_now timestamptz
)
returns table (
  memory_id uuid,
  scope public.memory_scope,
  role_id uuid,
  category text,
  content text,
  sensitivity public.memory_sensitivity,
  confirmed_by_user boolean,
  similarity double precision
)
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_user_id is null
    or p_role_id is null
    or p_query_embedding is null
    or vector_dims(p_query_embedding) <> 1536
    or vector_norm(p_query_embedding) <= 0
    or p_embedding_provider is null
    or char_length(btrim(p_embedding_provider)) not between 1 and 100
    or p_embedding_model is null
    or char_length(btrim(p_embedding_model)) not between 1 and 200
    or p_limit is null
    or p_limit not between 1 and 5
    or p_min_similarity is null
    or p_min_similarity not between 0 and 1
    or p_include_sensitive is null
    or p_now is null then
    raise exception 'memory retrieval input is invalid';
  end if;

  if not exists (
    select 1
    from public.roles as role
    where role.id = p_role_id
      and role.user_id = p_user_id
      and role.status = 'active'
  ) then
    raise exception 'active role not found';
  end if;

  return query
  with eligible_memory as materialized (
    select
      memory.id,
      memory.scope,
      memory.role_id,
      memory.category,
      memory.content,
      memory.sensitivity,
      memory.confirmed_by_user,
      memory.embedding
    from public.memories as memory
    where memory.user_id = p_user_id
      and memory.status = 'active'
      and memory.deleted_at is null
      and memory.embedding is not null
      and memory.embedding_provider = btrim(p_embedding_provider)
      and memory.embedding_model = btrim(p_embedding_model)
      and (memory.valid_from is null or memory.valid_from <= p_now)
      and (memory.valid_to is null or memory.valid_to >= p_now)
      and (
        (memory.scope = 'user_shared' and memory.role_id is null)
        or (memory.scope = 'role_private' and memory.role_id = p_role_id)
      )
      and (
        memory.sensitivity = 'normal'
        or (
          p_include_sensitive
          and memory.sensitivity = 'sensitive'
          and memory.confirmed_by_user
        )
      )
  ),
  scored_memory as (
    select
      eligible_memory.*,
      1 - (eligible_memory.embedding <=> p_query_embedding) as similarity
    from eligible_memory
  )
  select
    scored_memory.id,
    scored_memory.scope,
    scored_memory.role_id,
    scored_memory.category,
    scored_memory.content,
    scored_memory.sensitivity,
    scored_memory.confirmed_by_user,
    scored_memory.similarity
  from scored_memory
  where scored_memory.similarity >= p_min_similarity
  order by scored_memory.similarity desc, scored_memory.id
  limit p_limit;
end;
$$;

-- The browser can read its memory management DTO fields, but raw embeddings
-- and provider/model internals stay behind the service boundary.
revoke select on table public.memories from authenticated;
grant select (
  id,
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
  valid_to,
  supersedes_memory_id,
  deleted_at,
  created_at,
  updated_at
) on table public.memories to authenticated;

revoke all on function public.set_memory_embedding(
  uuid, uuid, text, timestamptz, text, text, extensions.vector
) from public, anon, authenticated;
revoke all on function public.match_memories_for_role(
  uuid, uuid, extensions.vector, text, text, integer, double precision, boolean, timestamptz
) from public, anon, authenticated;

grant execute on function public.set_memory_embedding(
  uuid, uuid, text, timestamptz, text, text, extensions.vector
) to service_role;
grant execute on function public.match_memories_for_role(
  uuid, uuid, extensions.vector, text, text, integer, double precision, boolean, timestamptz
) to service_role;

commit;
