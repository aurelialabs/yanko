-- Service-only audit boundary for vector memories considered and actually
-- included in one AI run. Query text, query vectors, prompts, drafts, and
-- provider response bodies are intentionally not persisted.

begin;

create table public.ai_run_memory_retrievals (
  ai_run_id uuid not null
    references public.ai_runs(id)
    on delete cascade,
  user_id uuid not null
    references public.profiles(id)
    on delete cascade,
  role_id uuid not null,
  memory_id uuid not null,
  ai_run_attempt_no integer not null
    check (ai_run_attempt_no > 0),
  retrieval_rank integer not null
    check (retrieval_rank between 1 and 5),
  similarity double precision not null
    check (similarity between 0 and 1),
  embedding_provider text not null
    check (char_length(btrim(embedding_provider)) between 1 and 100),
  embedding_model text not null
    check (char_length(btrim(embedding_model)) between 1 and 200),
  sensitive_retrieval_authorized boolean not null default false,
  included_in_context boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (ai_run_id, memory_id),
  unique (ai_run_id, retrieval_rank),
  constraint ai_run_memory_retrievals_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint ai_run_memory_retrievals_memory_owner_fk
    foreign key (memory_id, user_id)
    references public.memories(id, user_id)
    on delete cascade
);

create index ai_run_memory_retrievals_memory_idx
  on public.ai_run_memory_retrievals(memory_id);

alter table public.ai_run_memory_retrievals enable row level security;

revoke all on table public.ai_run_memory_retrievals
  from public, anon, authenticated, service_role;

create function public.record_ai_run_memory_retrievals(
  p_user_id uuid,
  p_ai_run_id uuid,
  p_trace_id text,
  p_role_id uuid,
  p_embedding_provider text,
  p_embedding_model text,
  p_include_sensitive boolean,
  p_retrievals jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  locked_attempt_no integer;
  locked_role_id uuid;
  locked_status public.ai_run_status;
  locked_trace_id text;
  retrieval_count integer;
  retrieval_row record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_user_id is null
    or p_ai_run_id is null
    or p_trace_id is null
    or p_trace_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_role_id is null
    or p_embedding_provider is null
    or char_length(btrim(p_embedding_provider)) not between 1 and 100
    or p_embedding_model is null
    or char_length(btrim(p_embedding_model)) not between 1 and 200
    or p_include_sensitive is null
    or p_retrievals is null
    or jsonb_typeof(p_retrievals) <> 'array'
    or jsonb_array_length(p_retrievals) > 5 then
    raise exception 'invalid ai memory retrieval audit';
  end if;

  select
    ai_run.attempt_no,
    conversation.role_id,
    ai_run.status,
    ai_run.trace_id
  into
    locked_attempt_no,
    locked_role_id,
    locked_status,
    locked_trace_id
  from public.ai_runs as ai_run
  join public.conversations as conversation
    on conversation.id = ai_run.conversation_id
   and conversation.user_id = ai_run.user_id
  where ai_run.id = p_ai_run_id
    and ai_run.user_id = p_user_id
  for update of ai_run;

  if not found
    or locked_status <> 'running'
    or locked_trace_id <> p_trace_id
    or locked_role_id <> p_role_id then
    raise exception 'ai memory retrieval run is not current';
  end if;

  retrieval_count := jsonb_array_length(p_retrievals);
  if retrieval_count = 0 then
    delete from public.ai_run_memory_retrievals as stored
    where stored.ai_run_id = p_ai_run_id;
    return p_ai_run_id;
  end if;

  for retrieval_row in
    select *
    from jsonb_to_recordset(p_retrievals) as retrieval(
      memory_id uuid,
      retrieval_rank integer,
      similarity double precision,
      included_in_context boolean
    )
  loop
    if retrieval_row.memory_id is null
      or retrieval_row.retrieval_rank is null
      or retrieval_row.retrieval_rank not between 1 and retrieval_count
      or retrieval_row.similarity is null
      or retrieval_row.similarity not between 0 and 1
      or retrieval_row.included_in_context is null then
      raise exception 'invalid ai memory retrieval record';
    end if;

    if not exists (
      select 1
      from public.memories as memory
      where memory.id = retrieval_row.memory_id
        and memory.user_id = p_user_id
        and memory.status = 'active'
        and memory.deleted_at is null
        and memory.embedding is not null
        and memory.embedding_provider = btrim(p_embedding_provider)
        and memory.embedding_model = btrim(p_embedding_model)
        and (memory.valid_from is null or memory.valid_from <= now())
        and (memory.valid_to is null or memory.valid_to >= now())
        and (
          (memory.scope = 'user_shared' and memory.role_id is null)
          or
          (memory.scope = 'role_private' and memory.role_id = p_role_id)
        )
        and (
          memory.sensitivity = 'normal'
          or (
            p_include_sensitive
            and memory.sensitivity = 'sensitive'
            and memory.confirmed_by_user
          )
        )
    ) then
      raise exception 'ai memory retrieval scope mismatch';
    end if;
  end loop;

  if (
    select count(distinct retrieval.memory_id) <> retrieval_count
      or count(distinct retrieval.retrieval_rank) <> retrieval_count
      or min(retrieval.retrieval_rank) <> 1
      or max(retrieval.retrieval_rank) <> retrieval_count
    from jsonb_to_recordset(p_retrievals) as retrieval(
      memory_id uuid,
      retrieval_rank integer,
      similarity double precision,
      included_in_context boolean
    )
  ) then
    raise exception 'duplicate ai memory retrieval record';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_retrievals) as current_retrieval(
      memory_id uuid,
      retrieval_rank integer,
      similarity double precision,
      included_in_context boolean
    )
    join jsonb_to_recordset(p_retrievals) as previous_retrieval(
      memory_id uuid,
      retrieval_rank integer,
      similarity double precision,
      included_in_context boolean
    )
      on previous_retrieval.retrieval_rank =
        current_retrieval.retrieval_rank - 1
    where previous_retrieval.similarity < current_retrieval.similarity
  ) then
    raise exception 'ai memory retrieval ranking is invalid';
  end if;

  delete from public.ai_run_memory_retrievals as stored
  where stored.ai_run_id = p_ai_run_id;

  insert into public.ai_run_memory_retrievals (
    ai_run_id,
    user_id,
    role_id,
    memory_id,
    ai_run_attempt_no,
    retrieval_rank,
    similarity,
    embedding_provider,
    embedding_model,
    sensitive_retrieval_authorized,
    included_in_context
  )
  select
    p_ai_run_id,
    p_user_id,
    p_role_id,
    retrieval.memory_id,
    locked_attempt_no,
    retrieval.retrieval_rank,
    retrieval.similarity,
    btrim(p_embedding_provider),
    btrim(p_embedding_model),
    p_include_sensitive,
    retrieval.included_in_context
  from jsonb_to_recordset(p_retrievals) as retrieval(
    memory_id uuid,
    retrieval_rank integer,
    similarity double precision,
    included_in_context boolean
  );

  return p_ai_run_id;
end;
$$;

revoke all on function public.record_ai_run_memory_retrievals(
  uuid, uuid, text, uuid, text, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.record_ai_run_memory_retrievals(
  uuid, uuid, text, uuid, text, text, boolean, jsonb
) to service_role;

commit;
