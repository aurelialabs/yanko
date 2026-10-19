-- Development-only MiniMax-M3 chat runtime.
--
-- The provider call remains outside PostgreSQL. These functions atomically
-- reserve one generation attempt, pin its persona/strategy, and then accept
-- only a matching lease holder's safe final result. Raw prompts, drafts,
-- provider response bodies, credentials, and reasoning are never stored here.

begin;

alter table public.ai_runs
  add column attempt_no integer not null default 1
    check (attempt_no > 0),
  add column generation_lease_until timestamptz;

create unique index ai_runs_user_message_unique
  on public.ai_runs(user_message_id);

insert into public.strategy_versions (
  version_key,
  status,
  prompt_config,
  memory_config,
  plan_config,
  ooc_config,
  safety_config,
  change_summary,
  published_at
)
values (
  'v0.2-minimax-m3-development',
  'draft',
  jsonb_build_object(
    'runtime', 'development-only',
    'generation_provider', 'minimax',
    'generation_model', 'MiniMax-M3',
    'validation_provider', 'minimax',
    'validation_model', 'MiniMax-M3',
    'fallback', null
  ),
  jsonb_build_object(
    'confirmed_memory_only', true,
    'sensitive_memory_retrieval', 'disabled'
  ),
  '{}'::jsonb,
  jsonb_build_object(
    'policy_version', 'v0.1',
    'max_content_rewrites', 1,
    'max_checker_retries_per_draft', 1
  ),
  jsonb_build_object(
    'high_risk_deterministic_boundary', 'v0.1',
    'production_approved', false
  ),
  '开发阶段选择 MiniMax-M3；不代表生产合规批准，冻结 test 尚未运行。',
  null
)
on conflict (version_key) do nothing;

create or replace function public.store_ai_run_ooc_checks(
  p_ai_run_id uuid,
  p_provider text,
  p_model text,
  p_checks jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  check_row record;
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'array'
     or jsonb_array_length(p_checks) > 2 then
    raise exception 'invalid ooc check records';
  end if;

  delete from public.ooc_checks where ai_run_id = p_ai_run_id;

  for check_row in
    select *
    from jsonb_to_recordset(p_checks) as value(
      attempt_no integer,
      verdict text,
      overall_score numeric,
      dimension_scores jsonb,
      failure_labels text[],
      latency_ms integer
    )
  loop
    if check_row.attempt_no not in (1, 2)
       or check_row.verdict not in ('pass', 'rewrite', 'block', 'error')
       or check_row.overall_score is null
       or check_row.overall_score < 0
       or check_row.overall_score > 1
       or check_row.dimension_scores is null
       or jsonb_typeof(check_row.dimension_scores) <> 'object'
       or (
         select count(*)
         from jsonb_object_keys(check_row.dimension_scores)
       ) <> 7
       or not check_row.dimension_scores ?& array[
         'identity',
         'personality',
         'speakingStyle',
         'preference',
         'memoryTruthfulness',
         'boundarySafety',
         'temporaryRoleplay'
       ]
       or check_row.failure_labels is null
       or cardinality(check_row.failure_labels) > 20
       or exists (
         select 1
         from unnest(check_row.failure_labels) as label
         where label is null or char_length(label) not between 1 and 100
       )
       or check_row.latency_ms is null
       or check_row.latency_ms < 0 then
      raise exception 'invalid ooc check record';
    end if;

    if exists (
      select 1
      from jsonb_each(check_row.dimension_scores) as dimension
      where jsonb_typeof(dimension.value) <> 'number'
    ) then
      raise exception 'invalid ooc dimension score';
    end if;

    if exists (
      select 1
      from jsonb_each(check_row.dimension_scores) as dimension
      where (dimension.value #>> '{}')::numeric not between 0 and 1
    ) then
      raise exception 'invalid ooc dimension score';
    end if;

    insert into public.ooc_checks (
      ai_run_id,
      attempt_no,
      verdict,
      overall_score,
      dimension_scores,
      failure_labels,
      provider,
      model,
      latency_ms
    )
    values (
      p_ai_run_id,
      check_row.attempt_no,
      check_row.verdict::public.ooc_verdict,
      check_row.overall_score,
      check_row.dimension_scores,
      check_row.failure_labels,
      p_provider,
      p_model,
      check_row.latency_ms
    );
  end loop;
end;
$$;

revoke all on function public.store_ai_run_ooc_checks(
  uuid, text, text, jsonb
) from public;

create or replace function public.begin_ai_chat_turn(
  p_user_id uuid,
  p_role_id uuid,
  p_conversation_id uuid,
  p_content text,
  p_client_message_id text,
  p_runtime text,
  p_trace_id text
)
returns table (
  user_message_id uuid,
  assistant_message_id uuid,
  ai_run_id uuid,
  persona_version_id uuid,
  strategy_version_id uuid,
  provider text,
  model text,
  run_status public.ai_run_status,
  should_generate boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := p_user_id;
  current_persona_id uuid;
  selected_strategy_id uuid;
  selected_provider text;
  selected_model text;
  existing_user_message public.messages%rowtype;
  existing_assistant_message public.messages%rowtype;
  existing_run public.ai_runs%rowtype;
  created_user_message_id uuid;
  created_assistant_message_id uuid;
  created_run_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_role_id is null
     or p_conversation_id is null
     or p_content is null
     or char_length(btrim(p_content)) not between 1 and 20000
     or p_client_message_id is null
     or char_length(btrim(p_client_message_id)) not between 8 and 200
     or p_trace_id is null
     or p_trace_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid ai chat request';
  end if;

  if p_runtime = 'minimax-development' then
    selected_provider := 'minimax';
    selected_model := 'MiniMax-M3';
  elsif p_runtime = 'deterministic-safety' then
    selected_provider := 'deterministic-safety';
    selected_model := 'zh-v0.1';
  else
    raise exception 'unsupported ai chat runtime';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || btrim(p_client_message_id), 0)
  );

  select r.current_persona_version_id
  into current_persona_id
  from public.profiles p
  join public.roles r
    on r.id = p_role_id
   and r.user_id = p.id
   and r.status = 'active'
  where p.id = current_user_id
    and p.deleted_at is null
    and p.current_role_id = p_role_id;
  if current_persona_id is null then
    raise exception 'current role and persona are required';
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.user_id = current_user_id
      and c.role_id = p_role_id
  ) then
    raise exception 'conversation must belong to the current role';
  end if;

  select sv.id
  into selected_strategy_id
  from public.strategy_versions sv
  where sv.version_key = 'v0.2-minimax-m3-development'
    and sv.status in ('draft', 'active')
  limit 1;
  if selected_strategy_id is null then
    raise exception 'development strategy is unavailable';
  end if;

  select m.*
  into existing_user_message
  from public.messages m
  where m.user_id = current_user_id
    and m.client_message_id = btrim(p_client_message_id)
  for update;

  if found then
    if existing_user_message.sender <> 'user'
       or existing_user_message.conversation_id <> p_conversation_id
       or existing_user_message.role_id <> p_role_id
       or existing_user_message.content <> btrim(p_content)
       or existing_user_message.deleted_at is not null then
      raise exception 'client message id belongs to another message';
    end if;
    created_user_message_id := existing_user_message.id;
  else
    insert into public.messages (
      user_id,
      conversation_id,
      role_id,
      sender,
      content,
      status,
      client_message_id
    )
    values (
      current_user_id,
      p_conversation_id,
      p_role_id,
      'user',
      btrim(p_content),
      'completed',
      btrim(p_client_message_id)
    )
    returning id into created_user_message_id;
  end if;

  select m.*
  into existing_assistant_message
  from public.messages m
  where m.user_id = current_user_id
    and m.conversation_id = p_conversation_id
    and m.role_id = p_role_id
    and m.sender = 'assistant'
    and m.reply_to_message_id = created_user_message_id
    and m.deleted_at is null
  order by m.created_at asc, m.id asc
  limit 1
  for update;

  if found then
    created_assistant_message_id := existing_assistant_message.id;
    current_persona_id := existing_assistant_message.persona_version_id;
  else
    insert into public.messages (
      user_id,
      conversation_id,
      role_id,
      sender,
      content,
      status,
      persona_version_id,
      reply_to_message_id
    )
    values (
      current_user_id,
      p_conversation_id,
      p_role_id,
      'assistant',
      '回复生成中…',
      'pending',
      current_persona_id,
      created_user_message_id
    )
    returning id into created_assistant_message_id;
  end if;

  select ar.*
  into existing_run
  from public.ai_runs ar
  where ar.user_id = current_user_id
    and ar.user_message_id = created_user_message_id
  for update;

  if found then
    if existing_run.assistant_message_id <> created_assistant_message_id
       or existing_run.conversation_id <> p_conversation_id then
      raise exception 'ai run scope mismatch';
    end if;

    if existing_run.status in ('completed', 'blocked') then
      return query
      select
        created_user_message_id,
        created_assistant_message_id,
        existing_run.id,
        current_persona_id,
        existing_run.strategy_version_id,
        existing_run.provider,
        existing_run.model,
        existing_run.status,
        false;
      return;
    end if;

    if existing_run.status = 'running'
       and existing_run.generation_lease_until is not null
       and existing_run.generation_lease_until > now() then
      return query
      select
        created_user_message_id,
        created_assistant_message_id,
        existing_run.id,
        current_persona_id,
        existing_run.strategy_version_id,
        existing_run.provider,
        existing_run.model,
        existing_run.status,
        false;
      return;
    end if;

    update public.ai_runs
    set
      provider = selected_provider,
      model = selected_model,
      strategy_version_id = selected_strategy_id,
      status = 'running',
      rewritten = false,
      latency_ms = null,
      input_tokens = null,
      output_tokens = null,
      trace_id = p_trace_id,
      error_code = null,
      started_at = now(),
      completed_at = null,
      attempt_no = attempt_no + 1,
      generation_lease_until = now() + interval '3 minutes'
    where id = existing_run.id;

    update public.messages
    set content = '回复生成中…', status = 'pending'
    where id = created_assistant_message_id
      and user_id = current_user_id;

    delete from public.ooc_checks as stored_check
    where stored_check.ai_run_id = existing_run.id;
    created_run_id := existing_run.id;
  else
    if existing_assistant_message.id is not null
       and existing_assistant_message.status = 'completed' then
      return query
      select
        created_user_message_id,
        created_assistant_message_id,
        null::uuid,
        current_persona_id,
        selected_strategy_id,
        selected_provider,
        selected_model,
        'completed'::public.ai_run_status,
        false;
      return;
    end if;

    insert into public.ai_runs (
      user_id,
      conversation_id,
      user_message_id,
      assistant_message_id,
      provider,
      model,
      strategy_version_id,
      status,
      trace_id,
      generation_lease_until
    )
    values (
      current_user_id,
      p_conversation_id,
      created_user_message_id,
      created_assistant_message_id,
      selected_provider,
      selected_model,
      selected_strategy_id,
      'running',
      p_trace_id,
      now() + interval '3 minutes'
    )
    returning id into created_run_id;
  end if;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id
    and user_id = current_user_id
    and role_id = p_role_id;

  return query
  select
    created_user_message_id,
    created_assistant_message_id,
    created_run_id,
    current_persona_id,
    selected_strategy_id,
    selected_provider,
    selected_model,
    'running'::public.ai_run_status,
    true;
end;
$$;

revoke all on function public.begin_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.begin_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.complete_ai_chat_turn(
  p_user_id uuid,
  p_ai_run_id uuid,
  p_trace_id text,
  p_content text,
  p_rewritten boolean,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_ooc_checks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := p_user_id;
  locked_run public.ai_runs%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_ai_run_id is null
     or p_trace_id is null
     or p_content is null
     or char_length(btrim(p_content)) not between 1 and 50000
     or p_latency_ms is null
     or p_latency_ms < 0
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'invalid ai completion';
  end if;

  select ar.*
  into locked_run
  from public.ai_runs ar
  where ar.id = p_ai_run_id
    and ar.user_id = current_user_id
  for update;
  if not found
     or locked_run.status <> 'running'
     or locked_run.trace_id <> p_trace_id
     or locked_run.assistant_message_id is null then
    raise exception 'ai generation lease is not current';
  end if;

  if locked_run.provider = 'minimax'
     and (
       jsonb_typeof(coalesce(p_ooc_checks, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_ooc_checks, '[]'::jsonb)) not between 1 and 2
       or coalesce(
         coalesce(p_ooc_checks, '[]'::jsonb)
           -> (jsonb_array_length(coalesce(p_ooc_checks, '[]'::jsonb)) - 1)
           ->> 'verdict',
         ''
       ) <> 'pass'
     ) then
    raise exception 'minimax completion requires a final passing ooc check';
  end if;

  perform public.store_ai_run_ooc_checks(
    locked_run.id,
    case
      when locked_run.provider = 'minimax' then locked_run.provider
      else 'minimax'
    end,
    case
      when locked_run.provider = 'minimax' then locked_run.model
      else 'MiniMax-M3'
    end,
    coalesce(p_ooc_checks, '[]'::jsonb)
  );

  update public.messages
  set content = btrim(p_content), status = 'completed'
  where id = locked_run.assistant_message_id
    and user_id = current_user_id
    and conversation_id = locked_run.conversation_id
    and sender = 'assistant'
    and status = 'pending';
  if not found then
    raise exception 'pending assistant message is unavailable';
  end if;

  update public.ai_runs
  set
    status = 'completed',
    rewritten = coalesce(p_rewritten, false),
    latency_ms = p_latency_ms,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    error_code = null,
    completed_at = now(),
    generation_lease_until = null
  where id = locked_run.id;

  update public.conversations
  set last_message_at = now()
  where id = locked_run.conversation_id
    and user_id = current_user_id;

  return locked_run.assistant_message_id;
end;
$$;

revoke all on function public.complete_ai_chat_turn(
  uuid, uuid, text, text, boolean, integer, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_ai_chat_turn(
  uuid, uuid, text, text, boolean, integer, integer, integer, jsonb
) to service_role;

create or replace function public.fail_ai_chat_turn(
  p_user_id uuid,
  p_ai_run_id uuid,
  p_trace_id text,
  p_run_status public.ai_run_status,
  p_error_code text,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_ooc_checks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := p_user_id;
  locked_run public.ai_runs%rowtype;
  safe_content text;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_ai_run_id is null
     or p_trace_id is null
     or p_run_status is null
     or p_run_status not in ('blocked', 'failed')
     or p_error_code is null
     or p_error_code not in (
       'aborted',
       'configuration',
       'context-unavailable',
       'internal',
       'invalid-output',
       'not-found',
       'ooc-checker-unavailable',
       'ooc-rewrite-unavailable',
       'rate-limited',
       'rejected',
       'safety-blocked',
       'timeout',
       'unavailable'
     )
     or p_latency_ms is null
     or p_latency_ms < 0
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'invalid ai failure';
  end if;

  select ar.*
  into locked_run
  from public.ai_runs ar
  where ar.id = p_ai_run_id
    and ar.user_id = current_user_id
  for update;
  if not found
     or locked_run.status <> 'running'
     or locked_run.trace_id <> p_trace_id
     or locked_run.assistant_message_id is null then
    raise exception 'ai generation lease is not current';
  end if;

  perform public.store_ai_run_ooc_checks(
    locked_run.id,
    'minimax',
    'MiniMax-M3',
    coalesce(p_ooc_checks, '[]'::jsonb)
  );

  safe_content := case
    when p_run_status = 'blocked'
      then '这次回复未通过安全检查，请换一种说法后再试。'
    else '回复暂时不可用，可使用原消息重试。'
  end;

  update public.messages
  set content = safe_content, status = 'failed'
  where id = locked_run.assistant_message_id
    and user_id = current_user_id
    and conversation_id = locked_run.conversation_id
    and sender = 'assistant'
    and status = 'pending';
  if not found then
    raise exception 'pending assistant message is unavailable';
  end if;

  update public.ai_runs
  set
    status = p_run_status,
    rewritten = false,
    latency_ms = p_latency_ms,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    error_code = p_error_code,
    completed_at = now(),
    generation_lease_until = null
  where id = locked_run.id;

  update public.conversations
  set last_message_at = now()
  where id = locked_run.conversation_id
    and user_id = current_user_id;

  return locked_run.assistant_message_id;
end;
$$;

revoke all on function public.fail_ai_chat_turn(
  uuid, uuid, text, public.ai_run_status, text, integer, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.fail_ai_chat_turn(
  uuid, uuid, text, public.ai_run_status, text, integer, integer, integer, jsonb
) to service_role;

commit;
