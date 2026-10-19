begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_extension('vector', 'pgvector extension is enabled');

select is(
  (select count(*)::integer from public.role_templates where is_active),
  3,
  'exactly three default role templates are active'
);

select is(
  (select count(*)::integer from public.strategy_versions where status = 'active'),
  1,
  'exactly one strategy version is active'
);

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in (
       'profiles',
       'roles',
       'persona_versions',
       'conversations',
       'messages',
       'memories',
       'plans',
       'plan_updates',
       'persona_feedback',
       'in_app_notifications'
     )),
  'all representative user-data tables have RLS enabled'
);

select has_function(
  'public',
  'append_mock_chat_turn',
  array['uuid', 'uuid', 'text', 'text'],
  'controlled mock chat-turn function exists'
);
select has_column(
  'public',
  'ai_runs',
  'attempt_no',
  'AI runs retain a server-controlled generation attempt number'
);
select has_column(
  'public',
  'ai_runs',
  'generation_lease_until',
  'AI runs retain a bounded generation lease'
);
select has_function(
  'public',
  'begin_ai_chat_turn',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text'],
  'service-only AI turn reservation function exists'
);
select has_function(
  'public',
  'complete_ai_chat_turn',
  array[
    'uuid', 'uuid', 'text', 'text', 'boolean', 'integer', 'integer', 'integer',
    'jsonb'
  ],
  'service-only AI turn completion function exists'
);
select has_function(
  'public',
  'fail_ai_chat_turn',
  array[
    'uuid', 'uuid', 'text', 'ai_run_status', 'text', 'integer', 'integer',
    'integer', 'jsonb'
  ],
  'service-only AI turn failure function exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_ai_chat_turn(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_ai_chat_turn(uuid,uuid,text,text,boolean,integer,integer,integer,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.fail_ai_chat_turn(uuid,uuid,text,ai_run_status,text,integer,integer,integer,jsonb)',
    'EXECUTE'
  ),
  'browser sessions cannot directly reserve, complete, or fail AI runs'
);
select has_function(
  'public',
  'schedule_strong_negative_emotion_followup',
  array['uuid', 'uuid', 'uuid', 'text', 'numeric', 'text'],
  'a service-only strong-negative emotion follow-up function exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.schedule_strong_negative_emotion_followup(uuid,uuid,uuid,text,numeric,text)',
    'EXECUTE'
  )
  and not has_table_privilege('authenticated', 'public.emotion_followups', 'INSERT')
  and not has_table_privilege('authenticated', 'public.emotion_followups', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.emotion_followups', 'DELETE'),
  'browsers cannot directly create or mutate emotion follow-ups'
);
select has_function(
  'public',
  'claim_due_emotion_followup',
  array['uuid', 'timestamp with time zone', 'integer'],
  'a future emotion delivery worker can atomically claim one explicit follow-up'
);
select has_function(
  'public',
  'complete_emotion_followup_delivery',
  array['uuid', 'uuid', 'text', 'uuid', 'text', 'timestamp with time zone'],
  'a future emotion delivery worker can terminally complete one claimed follow-up'
);
select has_function(
  'public',
  'persist_claimed_emotion_followup_message',
  array['uuid', 'uuid', 'text', 'timestamp with time zone'],
  'a future delivery composition root can persist one assistant message for a current claim'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_due_emotion_followup(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_emotion_followup_delivery(uuid,uuid,text,uuid,text,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.persist_claimed_emotion_followup_message(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.persist_claimed_emotion_followup_message(uuid,uuid,text,timestamp with time zone)',
    'EXECUTE'
  )
  and has_table_privilege('service_role', 'public.emotion_followups', 'SELECT')
  and not has_table_privilege(
    'service_role',
    'public.emotion_followups',
    'INSERT,UPDATE,DELETE'
  ),
  'only a service worker can inspect, claim, and persist a follow-up through controlled functions'
);
select has_table(
  'public',
  'emotion_signal_jobs',
  'future completed user messages enter a minimal durable emotion signal queue'
);
select has_function(
  'public',
  'claim_emotion_signal_job',
  array['uuid', 'timestamp with time zone', 'integer'],
  'an emotion worker can claim exactly one explicit event job'
);
select has_function(
  'public',
  'complete_emotion_signal_job',
  array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone'],
  'an emotion worker can complete or safely reschedule one claimed job'
);
select ok(
  not has_table_privilege('authenticated', 'public.emotion_signal_jobs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.emotion_signal_jobs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.emotion_signal_jobs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.emotion_signal_jobs', 'DELETE')
  and not has_function_privilege(
    'authenticated',
    'public.claim_emotion_signal_job(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_emotion_signal_job(uuid,uuid,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  and has_table_privilege('service_role', 'public.emotion_signal_jobs', 'SELECT')
  and not has_table_privilege(
    'service_role',
    'public.emotion_signal_jobs',
    'INSERT,UPDATE,DELETE'
  ),
  'only service workers can inspect emotion signal state, and mutations remain controlled'
);
select has_table(
  'public',
  'ai_run_memory_retrievals',
  'AI runs retain service-owned memory retrieval and final inclusion metadata'
);
select has_function(
  'public',
  'record_ai_run_memory_retrievals',
  array['uuid', 'uuid', 'text', 'uuid', 'text', 'text', 'boolean', 'jsonb'],
  'a controlled function records bounded AI-run memory retrieval metadata'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.ai_run_memory_retrievals',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'public.ai_run_memory_retrievals',
    'INSERT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_ai_run_memory_retrievals(uuid,uuid,text,uuid,text,text,boolean,jsonb)',
    'EXECUTE'
  ),
  'retrieval audits are unavailable to browsers and writable by service workers only through the controlled function'
);
select has_function(
  'public',
  'provision_default_roles',
  array['uuid'],
  'default role provisioning function exists'
);

select has_column(
  'public',
  'memory_candidates',
  'supersedes_memory_id',
  'memory candidates can retain a validated replacement target'
);

select has_function(
  'public',
  'confirm_memory_candidate',
  array['uuid', 'text', 'memory_scope', 'uuid', 'text'],
  'controlled memory candidate confirmation function exists'
);

select has_function(
  'public',
  'reject_memory_candidate',
  array['uuid', 'text'],
  'controlled memory candidate rejection function exists'
);

select has_function(
  'public',
  'replace_memory',
  array['uuid', 'text', 'memory_scope', 'uuid', 'text'],
  'controlled memory replacement function exists'
);

select has_function(
  'public',
  'delete_memory',
  array['uuid', 'text'],
  'controlled memory deletion function exists'
);

select has_table(
  'public',
  'memory_extraction_runs',
  'memory extraction attempts have an immutable service-owned audit boundary'
);

select has_function(
  'public',
  'persist_memory_extraction',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'jsonb'],
  'service-only memory extraction persistence function exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.persist_memory_extraction(uuid,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.memory_extraction_runs',
    'SELECT'
  ),
  'browser sessions cannot persist or inspect memory extraction runs'
);

select has_table(
  'public',
  'memory_extraction_jobs',
  'completed user messages enter a durable memory extraction queue'
);

select has_function(
  'public',
  'claim_memory_extraction_jobs',
  array['integer', 'timestamp with time zone', 'integer'],
  'a service worker can atomically claim a bounded extraction batch'
);

select has_function(
  'public',
  'claim_memory_extraction_job',
  array['uuid', 'timestamp with time zone', 'integer'],
  'an event worker can atomically claim exactly one extraction job'
);

select has_function(
  'public',
  'complete_memory_extraction_job',
  array['uuid', 'uuid', 'text', 'text', 'uuid', 'timestamp with time zone'],
  'a service worker can safely complete or reschedule a claimed extraction'
);

select has_function(
  'public',
  'set_memory_embedding',
  array[
    'uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'text', 'vector'
  ],
  'a service worker can persist a versioned 1536-dimensional memory embedding'
);

select has_function(
  'public',
  'match_memories_for_role',
  array[
    'uuid', 'uuid', 'vector', 'text', 'text', 'integer', 'double precision',
    'boolean', 'timestamp with time zone'
  ],
  'a service worker can retrieve a bounded role-filtered memory set'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.memory_extraction_jobs',
    'SELECT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_memory_extraction_jobs(integer,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_memory_extraction_job(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_memory_extraction_job(uuid,uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser sessions cannot inspect, claim, or complete extraction jobs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_memory_embedding(uuid,uuid,text,timestamp with time zone,text,text,extensions.vector)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.match_memories_for_role(uuid,uuid,extensions.vector,text,text,integer,double precision,boolean,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_column_privilege(
    'authenticated',
    'public.memories',
    'embedding',
    'SELECT'
  )
  and has_column_privilege(
    'authenticated',
    'public.memories',
    'content',
    'SELECT'
  ),
  'browser sessions can manage memory content without reading embeddings or vector RPCs'
);

select has_table(
  'public',
  'memory_embedding_jobs',
  'new active memories enter a durable embedding indexing queue'
);

select has_function(
  'public',
  'claim_memory_embedding_jobs',
  array['integer', 'timestamp with time zone', 'integer'],
  'an embedding worker can claim a bounded indexing batch'
);

select has_function(
  'public',
  'claim_memory_embedding_job',
  array['uuid', 'timestamp with time zone', 'integer'],
  'an event worker can claim exactly one embedding job'
);

select has_function(
  'public',
  'complete_memory_embedding_job',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'timestamp with time zone'],
  'an embedding worker can complete or safely reschedule a claimed job'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.memory_embedding_jobs',
    'SELECT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_memory_embedding_jobs(integer,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_memory_embedding_job(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_memory_embedding_job(uuid,uuid,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser sessions cannot inspect or operate embedding jobs'
);

select has_table(
  'public',
  'plan_extraction_runs',
  'plan classifications have an immutable service-owned audit boundary'
);

select has_table(
  'public',
  'plan_extraction_jobs',
  'future completed user messages enter a durable plan extraction queue'
);

select has_function(
  'public',
  'claim_plan_extraction_job',
  array['uuid', 'timestamp with time zone', 'integer'],
  'a plan worker can atomically claim exactly one explicit job'
);

select has_function(
  'public',
  'persist_plan_extraction_result',
  array[
    'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text',
    'plan_scope', 'numeric', 'text', 'text', 'jsonb', 'text[]', 'integer',
    'integer', 'integer', 'text'
  ],
  'a service-only function persists one policy-clean plan classification'
);

select has_function(
  'public',
  'complete_plan_extraction_job',
  array['uuid', 'uuid', 'text', 'text', 'uuid', 'timestamp with time zone'],
  'a plan worker can complete or safely reschedule one claimed job'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.plan_extraction_runs',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.plan_extraction_jobs',
    'SELECT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_plan_extraction_job(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.persist_plan_extraction_result(uuid,uuid,uuid,text,text,text,text,text,text,plan_scope,numeric,text,text,jsonb,text[],integer,integer,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_plan_extraction_job(uuid,uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser sessions cannot inspect or operate plan extraction jobs and runs'
);

select ok(
  has_table_privilege('service_role', 'public.plan_extraction_runs', 'SELECT')
  and has_table_privilege('service_role', 'public.plan_extraction_jobs', 'SELECT')
  and not has_table_privilege(
    'service_role',
    'public.plan_extraction_runs',
    'INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'service_role',
    'public.plan_extraction_jobs',
    'INSERT,UPDATE,DELETE'
  ),
  'service workers inspect plan state but mutate it only through controlled functions'
);

select has_table(
  'public',
  'plan_deletions',
  'plan deletions retain an idempotent audit record after the plan row is gone'
);

select has_table(
  'public',
  'plan_updates',
  'plan updates retain an idempotent audit record for editable details'
);

select has_column(
  'public',
  'plan_status_events',
  'idempotency_key',
  'plan status events retain their request idempotency key'
);

select has_column(
  'public',
  'plan_proposals',
  'idempotency_key',
  'plan proposals retain their creation idempotency key'
);

select has_column(
  'public',
  'plan_proposals',
  'confirmation_idempotency_key',
  'plan proposals retain their confirmation idempotency key'
);

select has_column(
  'public',
  'plan_proposals',
  'rejection_idempotency_key',
  'plan proposals retain their rejection idempotency key'
);

select has_column(
  'public',
  'plan_proposals',
  'suggested_title',
  'plan proposals retain the user-facing title shown by chat confirmation cards'
);

select has_column(
  'public',
  'plan_proposals',
  'original_time_text',
  'plan proposals retain the original time phrase shown by chat confirmation cards'
);

select has_function(
  'public',
  'create_manual_plan',
  array[
    'plan_scope', 'text', 'text', 'date', 'date', 'date', 'timestamp with time zone',
    'timestamp with time zone', 'text', 'uuid', 'text'
  ],
  'controlled manual plan creation function exists'
);

select has_function(
  'public',
  'change_plan_status',
  array['uuid', 'plan_status', 'plan_status', 'text'],
  'controlled plan status change function exists'
);

select has_function(
  'public',
  'delete_plan',
  array['uuid', 'text'],
  'controlled plan deletion function exists'
);

select has_function(
  'public',
  'update_plan_details',
  array['uuid', 'text', 'text', 'date', 'date', 'date', 'timestamp with time zone', 'text'],
  'controlled plan detail update function exists'
);

select has_function(
  'public',
  'create_plan_proposal',
  array['uuid', 'uuid', 'plan_scope', 'jsonb', 'text[]', 'numeric', 'text'],
  'controlled chat plan proposal creation function exists'
);

select has_function(
  'public',
  'create_plan_proposal_v2',
  array[
    'uuid', 'uuid', 'plan_scope', 'text', 'text', 'jsonb', 'text[]', 'numeric',
    'text'
  ],
  'controlled chat-card plan proposal creation function exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_plan_proposal_v2(uuid,uuid,plan_scope,text,text,jsonb,text[],numeric,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.create_plan_proposal_v2(uuid,uuid,plan_scope,text,text,jsonb,text[],numeric,text)',
    'EXECUTE'
  ),
  'only authenticated browser sessions can request a validated chat plan proposal'
);

select has_function(
  'public',
  'confirm_plan_proposal',
  array[
    'uuid', 'plan_scope', 'text', 'text', 'date', 'date', 'date',
    'timestamp with time zone', 'timestamp with time zone', 'text', 'uuid', 'text'
  ],
  'controlled plan proposal confirmation function exists'
);

select has_function(
  'public',
  'reject_plan_proposal',
  array['uuid', 'text'],
  'controlled plan proposal rejection function exists'
);

select has_function(
  'public',
  'sync_plan_reminder_job',
  array[]::text[],
  'daily plan reminders are synchronized into the controlled job queue'
);

select has_function(
  'public',
  'claim_due_notification_job',
  array['uuid', 'timestamp with time zone', 'integer'],
  'a service worker can atomically claim one due notification job with a lease'
);

select has_function(
  'public',
  'complete_notification_job',
  array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone'],
  'a service worker can complete only its claimed notification job'
);

select has_table(
  'public',
  'in_app_notifications',
  'in-app plan reminders have a user-readable durable inbox'
);

select has_column(
  'public',
  'notification_jobs',
  'available_at',
  'notification jobs retain their next eligible attempt time'
);

select has_column(
  'public',
  'notification_jobs',
  'claim_token',
  'notification jobs retain a claim token while running'
);

select has_column(
  'public',
  'notification_jobs',
  'lease_expires_at',
  'notification jobs retain a recoverable lease deadline'
);

select has_function(
  'public',
  'deliver_in_app_plan_reminder',
  array['uuid', 'uuid', 'timestamp with time zone'],
  'a service worker can idempotently record one in-app reminder'
);

select has_function(
  'public',
  'mark_in_app_notification_read',
  array['uuid', 'boolean', 'timestamp with time zone'],
  'an authenticated user can control the read state of an owned reminder'
);

select ok(
  has_table_privilege('authenticated', 'public.in_app_notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.in_app_notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.in_app_notifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.in_app_notifications', 'DELETE')
  and has_function_privilege(
    'authenticated',
    'public.mark_in_app_notification_read(uuid,boolean,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.mark_in_app_notification_read(uuid,boolean,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser sessions can read owned reminders and mutate read state only through the controlled function'
);

select ok(
  has_table_privilege('service_role', 'public.in_app_notifications', 'SELECT')
  and not has_table_privilege('service_role', 'public.in_app_notifications', 'INSERT')
  and not has_table_privilege('service_role', 'public.in_app_notifications', 'UPDATE')
  and not has_table_privilege('service_role', 'public.in_app_notifications', 'DELETE')
  and not has_function_privilege(
    'authenticated',
    'public.claim_due_notification_job(uuid,timestamp with time zone,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_notification_job(uuid,uuid,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.deliver_in_app_plan_reminder(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'notification delivery tables and lifecycle functions stay service-controlled'
);

-- Real behavior coverage starts with two isolated confirmed accounts.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'database-test-a@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"测试用户 A"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'database-test-b@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"测试用户 B"}'::jsonb,
    now(),
    now()
  );

create temporary table _test_ids (
  key text primary key,
  id uuid not null
);

create temporary table _test_persona (snapshot jsonb not null);
grant select on _test_ids, _test_persona to authenticated;
insert into _test_persona values (
  '{
    "identity": {
      "name": "自定义知夏",
      "role": "温柔的长期伙伴",
      "background": "熟悉创作压力，也尊重用户自己做决定。"
    },
    "coreTraits": ["温柔", "稳定", "诚实"],
    "speakingStyle": ["自然", "简洁", "先倾听后建议"],
    "supportStyle": "先确认感受，再询问是否需要一起拆解问题。",
    "reminderTone": "温和具体，不施压。",
    "boundaries": ["不编造用户经历", "不诱导排他依赖"],
    "preferences": ["清晰的下一步"],
    "values": ["诚实", "尊重自主"],
    "relationshipDefinition": "可信任但有清晰边界的长期伙伴",
    "proactiveLevel": "medium"
  }'::jsonb
);

select is(
  (select count(*)::integer
   from public.roles
   where user_id = '10000000-0000-4000-8000-000000000001'
     and template_id is not null),
  3,
  'a confirmed user is provisioned with exactly three default roles'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select lives_ok(
  $$select public.provision_default_roles('10000000-0000-4000-8000-000000000001')$$,
  'default role provisioning can be retried'
);
select is(
  (select count(*)::integer
   from public.roles
   where user_id = '10000000-0000-4000-8000-000000000001'
     and template_id is not null),
  3,
  'retrying default provisioning still leaves exactly three roles'
);

select is(
  public.consume_magic_link_request_slot(repeat('a', 64), repeat('b', 64)),
  0,
  'the first Magic Link request consumes an available slot'
);
select ok(
  public.consume_magic_link_request_slot(repeat('a', 64), repeat('b', 64))
    between 1 and 60,
  'an immediate duplicate Magic Link request receives a cooldown'
);
select ok(
  not has_table_privilege(
    'anon',
    'public.auth_magic_link_rate_limits',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.auth_magic_link_rate_limits',
    'INSERT'
  ),
  'browser roles cannot read or mutate the Magic Link limiter table'
);

insert into _test_ids (key, id)
select
  'custom_role',
  public.create_custom_role(
    '自定义知夏',
    (select snapshot from _test_persona),
    'custom-role-request-001'
  );

select is(
  public.create_custom_role(
    '被重复提交的名称',
    (select snapshot from _test_persona),
    'custom-role-request-001'
  ),
  (select id from _test_ids where key = 'custom_role'),
  'repeating custom-role creation returns the original role'
);
select is(
  (select count(*)::integer
   from public.roles
   where user_id = '10000000-0000-4000-8000-000000000001'
     and source = 'custom'),
  1,
  'custom-role idempotency creates only one role'
);
select is(
  (select count(*)::integer
   from public.persona_versions
   where role_id = (select id from _test_ids where key = 'custom_role')),
  1,
  'custom-role creation creates exactly one immutable v1'
);
select is(
  (select count(*)::integer
   from public.conversations
   where role_id = (select id from _test_ids where key = 'custom_role')),
  1,
  'custom-role creation creates exactly one continuous conversation'
);

insert into _test_ids (key, id)
select
  'persona_v1',
  current_persona_version_id
from public.roles
where id = (select id from _test_ids where key = 'custom_role');

select is(
  public.switch_current_role((select id from _test_ids where key = 'custom_role')),
  (select id from _test_ids where key = 'custom_role'),
  'switch_current_role accepts an active role owned by the current user'
);

insert into _test_ids (key, id)
select
  'custom_conversation',
  id
from public.conversations
where role_id = (select id from _test_ids where key = 'custom_role');

insert into _test_ids (key, id)
select
  'assistant_before_edit',
  assistant_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '请在更新人设前回复我。',
  'chat-before-persona-update-001'
);

insert into _test_ids (key, id)
select
  'persona_v2',
  public.create_persona_version(
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'persona_v1'),
    jsonb_set(
      (select snapshot from _test_persona),
      '{identity,name}',
      '"更新后的知夏"'::jsonb
    ),
    '修改：角色名称',
    'persona-update-request-001'
  );

select is(
  public.create_persona_version(
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'persona_v1'),
    jsonb_set(
      (select snapshot from _test_persona),
      '{identity,name}',
      '"更新后的知夏"'::jsonb
    ),
    '修改：角色名称',
    'persona-update-request-001'
  ),
  (select id from _test_ids where key = 'persona_v2'),
  'repeating a persona save returns the original new version'
);
select is(
  (select count(*)::integer
   from public.persona_versions
   where role_id = (select id from _test_ids where key = 'custom_role')),
  2,
  'a persona update adds one version and preserves v1'
);
select is(
  (select version_no
   from public.persona_versions
   where id = (select id from _test_ids where key = 'persona_v2')),
  2,
  'the immutable persona update is numbered v2'
);
select throws_ok(
  $$select public.create_persona_version(
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'persona_v1'),
      (select snapshot from _test_persona),
      '修改：过期覆盖',
      'persona-update-stale-002'
    )$$,
  '40001',
  'persona version conflict',
  'a stale expected persona version is rejected instead of overwriting v2'
);
select is(
  (select persona_version_id
   from public.messages
   where id = (select id from _test_ids where key = 'assistant_before_edit')),
  (select id from _test_ids where key = 'persona_v1'),
  'historical assistant messages keep the persona version used at creation'
);
select matches(
  (select compiled_system_prompt
   from public.persona_versions
   where id = (select id from _test_ids where key = 'persona_v2')),
  '身份背景：熟悉创作压力，也尊重用户自己做决定。.*价值观：诚实、尊重自主',
  'the server compiler includes background, values, and safety-relevant persona fields'
);

insert into _test_ids (key, id)
select
  'memory_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '以后我难过时请先听我说；我曾有一段严重低谷。',
  'memory-extraction-source-001'
);

insert into _test_ids (key, id)
select
  'plan_proposal_v2',
  public.create_plan_proposal_v2(
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'memory_source'),
    'day',
    '整理作品集首页',
    '今天晚上七点半',
    jsonb_build_object(
      'date', '2026-09-07',
      'scheduledAt', '2026-09-07T19:30:00+08:00',
      'reminderAt', '2026-09-07T19:00:00+08:00'
    ),
    array[]::text[],
    0.96,
    'plan-proposal-chat-card-001'
  );

select is(
  public.create_plan_proposal_v2(
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'memory_source'),
    'day',
    '重试时不能覆盖原标题',
    '重试时不能覆盖原时间',
    jsonb_build_object('date', '2026-09-08'),
    array['scheduledAt'],
    0.4,
    'plan-proposal-chat-card-001'
  ),
  (select id from _test_ids where key = 'plan_proposal_v2'),
  'repeating chat-card proposal creation returns the original proposal'
);

select is(
  (select suggested_title
   from public.plan_proposals
   where id = (select id from _test_ids where key = 'plan_proposal_v2')),
  '整理作品集首页',
  'proposal idempotency preserves the first user-facing title'
);

select is(
  (select original_time_text
   from public.plan_proposals
   where id = (select id from _test_ids where key = 'plan_proposal_v2')),
  '今天晚上七点半',
  'proposal idempotency preserves the first original time phrase'
);

select is(
  (select count(*)::integer
   from public.plan_proposals
   where user_id = '10000000-0000-4000-8000-000000000001'
     and idempotency_key = 'plan-proposal-chat-card-001'),
  1,
  'proposal retries create exactly one pending proposal'
);

select throws_ok(
  $$select public.create_plan_proposal_v2(
      (select id
       from public.roles
       where user_id = '10000000-0000-4000-8000-000000000001'
         and id <> (select id from _test_ids where key = 'custom_role')
       order by id
       limit 1),
      (select id from _test_ids where key = 'memory_source'),
      'day',
      '跨角色计划',
      null,
      jsonb_build_object('date', '2026-09-07'),
      array[]::text[],
      0.9,
      'plan-proposal-cross-role-001'
    )$$,
  'P0001',
  'plan proposal source role must be the current role',
  'a proposal cannot pair the current message with another role'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
   from public.plan_proposals
   where id = (select id from _test_ids where key = 'plan_proposal_v2')),
  0,
  'another user cannot read a pending chat plan proposal'
);

select throws_ok(
  $$select public.confirm_plan_proposal(
      (select id from _test_ids where key = 'plan_proposal_v2'),
      'day',
      '越权确认',
      null,
      date '2026-09-07',
      date '2026-09-07',
      null,
      timestamptz '2026-09-07T19:30:00+08:00',
      timestamptz '2026-09-07T19:00:00+08:00',
      'Asia/Shanghai',
      null,
      'plan-proposal-other-user-confirm-001'
    )$$,
  'P0001',
  'plan proposal not found',
  'another user cannot confirm an owned chat plan proposal'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

insert into _test_ids (key, id)
select
  'plan_from_proposal',
  public.confirm_plan_proposal(
    (select id from _test_ids where key = 'plan_proposal_v2'),
    'day',
    '整理作品集首页',
    '完成首屏信息结构',
    date '2026-09-07',
    date '2026-09-07',
    null,
    timestamptz '2026-09-07T19:30:00+08:00',
    timestamptz '2026-09-07T19:00:00+08:00',
    'Asia/Shanghai',
    null,
    'plan-proposal-confirm-001'
  );

select is(
  public.confirm_plan_proposal(
    (select id from _test_ids where key = 'plan_proposal_v2'),
    'day',
    '重试时不能创建第二份计划',
    null,
    date '2026-09-08',
    date '2026-09-08',
    null,
    null,
    null,
    'Asia/Shanghai',
    null,
    'plan-proposal-confirm-retry-002'
  ),
  (select id from _test_ids where key = 'plan_from_proposal'),
  'repeating proposal confirmation returns the first formal plan'
);

select is(
  (select count(*)::integer
   from public.plans
   where id = (select id from _test_ids where key = 'plan_from_proposal')
     and source = 'chat'
     and source_role_id = (select id from _test_ids where key = 'custom_role')),
  1,
  'confirming a proposal creates exactly one role-attributed chat plan'
);

insert into _test_ids (key, id)
select
  'rejected_plan_proposal_v2',
  public.create_plan_proposal_v2(
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'memory_source'),
    'week',
    '本周整理三个案例',
    '这周内',
    jsonb_build_object('weekStart', '2026-09-07'),
    array[]::text[],
    0.91,
    'plan-proposal-chat-card-reject-001'
  );

select is(
  public.reject_plan_proposal(
    (select id from _test_ids where key = 'rejected_plan_proposal_v2'),
    'plan-proposal-rejection-001'
  ),
  (select id from _test_ids where key = 'rejected_plan_proposal_v2'),
  'an owned pending proposal can be rejected'
);

select is(
  public.reject_plan_proposal(
    (select id from _test_ids where key = 'rejected_plan_proposal_v2'),
    'plan-proposal-rejection-001'
  ),
  (select id from _test_ids where key = 'rejected_plan_proposal_v2'),
  'repeating proposal rejection returns the original proposal'
);

select is(
  (select count(*)::integer
   from public.plan_proposals
   where id = (select id from _test_ids where key = 'rejected_plan_proposal_v2')
     and status = 'rejected'
     and confirmed_plan_id is null),
  1,
  'rejecting a proposal never creates or links a formal plan'
);

create temporary table _memory_extraction_result (result jsonb not null);
insert into _memory_extraction_result
select public.persist_memory_extraction(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'memory_source'),
  'v0.1',
  'memory-extraction-request-001',
  jsonb_build_array(
    jsonb_build_object(
      'candidateIndex', 0,
      'action', 'auto_write',
      'reason', 'normal_auto_write',
      'memory', jsonb_build_object(
        'sourceMessageId', (select id from _test_ids where key = 'memory_source'),
        'scope', 'role_private',
        'roleId', (select id from _test_ids where key = 'custom_role'),
        'category', 'agreement',
        'content', '用户难过时希望先被倾听。',
        'normalizedKey', 'support_when_sad',
        'sensitivity', 'normal',
        'confidence', 0.98,
        'supersedesMemoryId', null
      )
    ),
    jsonb_build_object(
      'candidateIndex', 1,
      'action', 'create_candidate',
      'reason', 'sensitive_requires_confirmation',
      'memory', jsonb_build_object(
        'sourceMessageId', (select id from _test_ids where key = 'memory_source'),
        'scope', 'role_private',
        'roleId', (select id from _test_ids where key = 'custom_role'),
        'category', 'sensitive',
        'content', '用户曾有一段严重情绪低谷。',
        'normalizedKey', 'important_emotional_history',
        'sensitivity', 'sensitive',
        'confidence', 0.96,
        'supersedesMemoryId', null
      )
    ),
    jsonb_build_object(
      'candidateIndex', 2,
      'action', 'discard',
      'reason', 'forbidden_content',
      'memory', null
    )
  )
);

select is(
  (select jsonb_array_length(result -> 'memoryIds') from _memory_extraction_result),
  1,
  'one normal grounded operation creates one formal memory'
);
select is(
  (select jsonb_array_length(result -> 'candidateIds') from _memory_extraction_result),
  1,
  'one sensitive operation creates one pending candidate'
);
select is(
  (select (result ->> 'discardedCount')::integer from _memory_extraction_result),
  1,
  'a forbidden operation is counted as discarded without storing its content'
);
select is(
  (select count(*)::integer
   from public.memories
   where extraction_run_id = (
     select (result ->> 'runId')::uuid from _memory_extraction_result
   )
     and status = 'active'
     and confirmed_by_user = false),
  1,
  'automatic extraction stores only a non-sensitive unconfirmed active memory'
);
select is(
  (select count(*)::integer
   from public.memory_candidates
   where extraction_run_id = (
     select (result ->> 'runId')::uuid from _memory_extraction_result
   )
     and status = 'pending'
     and sensitivity = 'sensitive'
     and role_id = (select id from _test_ids where key = 'custom_role')),
  1,
  'sensitive extraction remains pending and private to the source role'
);
select ok(
  (public.persist_memory_extraction(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'memory_source'),
    'v0.1',
    'memory-extraction-request-001',
    '[]'::jsonb
  ) ->> 'replayed')::boolean,
  'retrying the same extraction request returns its original result'
);
select is(
  (select count(*)::integer
   from public.memory_extraction_runs
   where source_message_id = (select id from _test_ids where key = 'memory_source')),
  1,
  'retrying an extraction never creates a duplicate run'
);

select is(
  (select count(*)::integer
   from public.memory_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'memory_source')),
  1,
  'a completed user message creates exactly one extraction job'
);

update public.messages
set status = 'completed'
where id = (select id from _test_ids where key = 'memory_source');

select is(
  (select count(*)::integer
   from public.memory_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'memory_source')),
  1,
  'replaying a completed message state does not duplicate its extraction job'
);

insert into _test_ids (key, id)
select
  'memory_retry_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '我每周三晚上会复盘本周进度。',
  'memory-extraction-retry-source-001'
);

insert into _test_ids (key, id)
select
  'memory_exact_claim_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '本地单任务领取测试：以后难过时请先听我说完。',
  'memory-extraction-exact-claim-source-001'
);

create temporary table _exact_memory_job_clock (now_at timestamptz not null);
insert into _exact_memory_job_clock values (clock_timestamp());

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table _exact_claimed_memory_job as
select *
from public.claim_memory_extraction_job(
  (select id
   from public.memory_extraction_jobs
   where source_message_id = (
     select id from _test_ids where key = 'memory_exact_claim_source'
   )),
  (select now_at from _exact_memory_job_clock),
  300
);

select is(
  (select count(*)::integer from _exact_claimed_memory_job),
  1,
  'an exact claim returns only the requested extraction job'
);

select is(
  (select status::text
   from public.memory_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
  'scheduled',
  'an exact claim does not mutate another scheduled extraction job'
);

create temporary table _exact_reclaimed_memory_job as
select *
from public.claim_memory_extraction_job(
  (select job_id from _exact_claimed_memory_job),
  (select now_at + interval '301 seconds' from _exact_memory_job_clock),
  300
);

select ok(
  (select claim_token from _exact_reclaimed_memory_job)
    is distinct from
  (select claim_token from _exact_claimed_memory_job),
  'an expired exact claim receives a fresh token'
);

select throws_ok(
  $$select public.complete_memory_extraction_job(
      (select job_id from _exact_claimed_memory_job),
      (select claim_token from _exact_claimed_memory_job),
      'permanent_failure',
      'invalid_input',
      null,
      (select now_at + interval '301 seconds' from _exact_memory_job_clock)
    )$$,
  'P0001',
  'memory extraction job claim is stale',
  'an old exact-claim token cannot overwrite a newer worker attempt'
);

select is(
  (public.complete_memory_extraction_job(
    (select job_id from _exact_reclaimed_memory_job),
    (select claim_token from _exact_reclaimed_memory_job),
    'permanent_failure',
    'invalid_input',
    null,
    (select now_at + interval '301 seconds' from _exact_memory_job_clock)
  ) ->> 'status'),
  'failed',
  'the current exact-claim token can finish its selected job'
);

create temporary table _memory_job_clock (now_at timestamptz not null);
insert into _memory_job_clock values (clock_timestamp());

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table _claimed_memory_jobs as
select *
from public.claim_memory_extraction_jobs(
  20,
  (select now_at from _memory_job_clock),
  300
);

select is(
  (select count(*)::integer
   from _claimed_memory_jobs
   where source_message_id = (select id from _test_ids where key = 'memory_source')),
  1,
  'the service worker claims the intended source job once'
);

select is(
  (public.complete_memory_extraction_job(
    (select job_id
     from _claimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_source')),
    (select claim_token
     from _claimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_source')),
    'succeeded',
    null,
    (select (result ->> 'runId')::uuid from _memory_extraction_result),
    (select now_at from _memory_job_clock)
  ) ->> 'status'),
  'succeeded',
  'a successful job can only attach its matching persisted extraction run'
);

select is(
  (public.complete_memory_extraction_job(
    (select job_id
     from _claimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
    (select claim_token
     from _claimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
    'retryable_failure',
    'extractor_unavailable',
    null,
    (select now_at from _memory_job_clock)
  ) ->> 'status'),
  'scheduled',
  'a retryable extraction failure is rescheduled with bounded backoff'
);

create temporary table _reclaimed_memory_jobs as
select *
from public.claim_memory_extraction_jobs(
  20,
  (select now_at + interval '31 seconds' from _memory_job_clock),
  300
);

select is(
  (select attempt_no
   from _reclaimed_memory_jobs
   where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
  2,
  'a due retry receives a fresh second attempt'
);

select throws_ok(
  $$select public.complete_memory_extraction_job(
      (select job_id
       from _reclaimed_memory_jobs
       where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
      (select claim_token
       from _claimed_memory_jobs
       where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
      'permanent_failure',
      'invalid_input',
      null,
      (select now_at + interval '31 seconds' from _memory_job_clock)
    )$$,
  'P0001',
  'memory extraction job claim is stale',
  'an expired claim token cannot overwrite a newer worker attempt'
);

select is(
  (public.complete_memory_extraction_job(
    (select job_id
     from _reclaimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
    (select claim_token
     from _reclaimed_memory_jobs
     where source_message_id = (select id from _test_ids where key = 'memory_retry_source')),
    'permanent_failure',
    'invalid_input',
    null,
    (select now_at + interval '31 seconds' from _memory_job_clock)
  ) ->> 'status'),
  'failed',
  'a permanent extraction error reaches a terminal failed state'
);

select set_config('request.jwt.claim.role', '', true);

insert into _test_ids (key, id)
select
  'plan_create_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '请帮我创建明天晚上七点半整理作品集首页的日计划。',
  'plan-extraction-create-source-001'
);

insert into _test_ids (key, id)
select
  'plan_retry_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '提醒我后天检查作品集链接。',
  'plan-extraction-retry-source-001'
);

insert into _test_ids (key, id)
select
  'plan_none_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '我已经整理完作品集首页了，不用建计划。',
  'plan-extraction-none-source-001'
);

insert into _test_ids (key, id)
select
  'plan_offer_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '这周可能要整理三个案例。',
  'plan-extraction-offer-source-001'
);

insert into _test_ids (key, id)
select
  'plan_clarify_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '明年我想让作品集变得更好。',
  'plan-extraction-clarify-source-001'
);

select is(
  (select count(*)::integer
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_create_source')),
  1,
  'a new completed user message creates exactly one plan extraction job'
);

update public.messages
set status = 'completed'
where id = (select id from _test_ids where key = 'plan_create_source');

select is(
  (select count(*)::integer
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_create_source')),
  1,
  'replaying completed state never duplicates a plan extraction job'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'plan_extraction_jobs'
     and column_name in ('content', 'message_content', 'prompt', 'raw_output')),
  0,
  'plan extraction jobs retain references but never copy message or prompt content'
);

create temporary table _plan_job_clock (now_at timestamptz not null);
insert into _plan_job_clock values (clock_timestamp());

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table _claimed_plan_create_job as
select *
from public.claim_plan_extraction_job(
  (select id
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_create_source')),
  (select now_at from _plan_job_clock),
  300
);

select is(
  (select count(*)::integer from _claimed_plan_create_job),
  1,
  'the plan worker claims only its explicitly requested create job'
);

select is(
  (select status::text
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_retry_source')),
  'scheduled',
  'an exact plan claim does not mutate another scheduled job'
);

insert into _test_ids (key, id)
select
  'plan_worker_current_role',
  id
from public.roles
where user_id = '10000000-0000-4000-8000-000000000001'
  and id <> (select id from _test_ids where key = 'custom_role')
  and status = 'active'
order by id
limit 1;

select is(
  public.switch_current_role(
    (select id from _test_ids where key = 'plan_worker_current_role')
  ),
  (select id from _test_ids where key = 'plan_worker_current_role'),
  'the user can switch roles before the asynchronous plan job finishes'
);

create temporary table _plan_create_result (result jsonb not null);
insert into _plan_create_result
select public.persist_plan_extraction_result(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'plan_create_source'),
  'v0.1',
  'plan-extraction-v0.1-grounded',
  'local-fixed',
  'plan-classifier-v0',
  'create',
  'show_confirmation_card',
  'day',
  1,
  '整理作品集首页',
  '明天晚上七点半',
  jsonb_build_object(
    'date', '2026-09-08',
    'scheduledAt', '2026-09-08T19:30:00+08:00'
  ),
  array[]::text[],
  0,
  0,
  0,
  (select idempotency_key
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_create_source'))
);

select ok(
  (select (result ->> 'proposalId')::uuid is not null from _plan_create_result),
  'an explicit create classification atomically creates a pending proposal'
);

select is(
  (select count(*)::integer
   from public.plan_proposals
   where id = (
     select (result ->> 'proposalId')::uuid from _plan_create_result
   )
     and status = 'pending'
     and confirmed_plan_id is null
     and suggested_title = '整理作品集首页'
     and original_time_text = '明天晚上七点半'),
  1,
  'the create proposal stores only editable policy-clean fields and is not a formal plan'
);

select ok(
  (public.persist_plan_extraction_result(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'plan_create_source'),
    'v0.1',
    'plan-extraction-v0.1-grounded',
    'local-fixed',
    'plan-classifier-v0',
    'create',
    'show_confirmation_card',
    'day',
    0.1,
    '重试不得覆盖原标题',
    null,
    jsonb_build_object('date', '2026-09-09'),
    array['scheduledAt'],
    null,
    null,
    null,
    (select idempotency_key
     from public.plan_extraction_jobs
     where source_message_id = (select id from _test_ids where key = 'plan_create_source'))
  ) ->> 'replayed')::boolean,
  'repeating a plan classification returns the original run and proposal'
);

select is(
  (select count(*)::integer
   from public.plan_extraction_runs
   where source_message_id = (select id from _test_ids where key = 'plan_create_source')),
  1,
  'plan extraction retries never duplicate the immutable run'
);

select is(
  (select count(*)::integer
   from public.plan_proposals
   where source_message_id = (select id from _test_ids where key = 'plan_create_source')),
  1,
  'plan extraction retries never duplicate the pending proposal'
);

create temporary table _plan_non_create_results (
  intent text primary key,
  result jsonb not null
);

insert into _plan_non_create_results values (
  'none',
  public.persist_plan_extraction_result(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'plan_none_source'),
    'v0.1',
    'plan-extraction-v0.1-grounded',
    'local-fixed',
    'plan-classifier-v0',
    'none',
    'none',
    null,
    1,
    null,
    null,
    '{}'::jsonb,
    array[]::text[],
    null,
    null,
    null,
    'plan-extraction-none-result-001'
  )
);

insert into _plan_non_create_results values (
  'offer',
  public.persist_plan_extraction_result(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'plan_offer_source'),
    'v0.1',
    'plan-extraction-v0.1-grounded',
    'local-fixed',
    'plan-classifier-v0',
    'offer',
    'ask_to_create',
    'week',
    0.8,
    '整理三个案例',
    '这周',
    jsonb_build_object('weekStart', '2026-09-07'),
    array[]::text[],
    null,
    null,
    null,
    'plan-extraction-offer-result-001'
  )
);

insert into _plan_non_create_results values (
  'clarify',
  public.persist_plan_extraction_result(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'plan_clarify_source'),
    'v0.1',
    'plan-extraction-v0.1-grounded',
    'local-fixed',
    'plan-classifier-v0',
    'clarify',
    'explore_first_step',
    'year',
    0.7,
    '改进作品集',
    '明年',
    jsonb_build_object('year', 2027),
    array['first_step'],
    null,
    null,
    null,
    'plan-extraction-clarify-result-001'
  )
);

select is(
  (select count(*)::integer
   from public.plan_extraction_runs
   where source_message_id in (
     (select id from _test_ids where key = 'plan_none_source'),
     (select id from _test_ids where key = 'plan_offer_source'),
     (select id from _test_ids where key = 'plan_clarify_source')
   )
     and proposal_id is null),
  3,
  'none, offer, and clarify retain only service-owned runs without proposals'
);

select is(
  (select count(*)::integer
   from public.plan_proposals
   where source_message_id in (
     (select id from _test_ids where key = 'plan_none_source'),
     (select id from _test_ids where key = 'plan_offer_source'),
     (select id from _test_ids where key = 'plan_clarify_source')
   )),
  0,
  'none, offer, and clarify never create pending plan proposals'
);

select throws_ok(
  $$select public.persist_plan_extraction_result(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'plan_offer_source'),
      'v0.1',
      'plan-extraction-v0.1-grounded',
      'local-fixed',
      'plan-classifier-v0',
      'offer',
      'ask_to_create',
      'week',
      0.8,
      '越界字段',
      null,
      jsonb_build_object('scheduledAt', '2026-09-08T19:30:00+08:00'),
      array[]::text[],
      null,
      null,
      null,
      'plan-extraction-invalid-payload-001'
    )$$,
  'P0001',
  'plan extraction payload contains unsupported fields',
  'scope policy rejects unsupported plan payload fields'
);

select throws_ok(
  $$select public.persist_plan_extraction_result(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'plan_worker_current_role'),
      (select id from _test_ids where key = 'plan_create_source'),
      'v0.1',
      'plan-extraction-v0.1-grounded',
      'local-fixed',
      'plan-classifier-v0',
      'none',
      'none',
      null,
      1,
      null,
      null,
      '{}'::jsonb,
      array[]::text[],
      null,
      null,
      null,
      'plan-extraction-cross-role-001'
    )$$,
  'P0001',
  'plan extraction source is unavailable',
  'a plan run cannot pair one role with another role message'
);

select throws_ok(
  $$select public.complete_plan_extraction_job(
      (select job_id from _claimed_plan_create_job),
      (select claim_token from _claimed_plan_create_job),
      'succeeded',
      null,
      (select (result ->> 'runId')::uuid
       from _plan_non_create_results
       where intent = 'none'),
      (select now_at from _plan_job_clock)
    )$$,
  'P0001',
  'plan extraction run does not match the claimed job',
  'job completion cannot attach another source message run'
);

select is(
  (public.complete_plan_extraction_job(
    (select job_id from _claimed_plan_create_job),
    (select claim_token from _claimed_plan_create_job),
    'succeeded',
    null,
    (select (result ->> 'runId')::uuid from _plan_create_result),
    (select now_at from _plan_job_clock)
  ) ->> 'status'),
  'succeeded',
  'a matching run safely completes its exact plan extraction job'
);

create temporary table _claimed_plan_retry_job as
select *
from public.claim_plan_extraction_job(
  (select id
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_retry_source')),
  (select now_at from _plan_job_clock),
  300
);

select is(
  (public.complete_plan_extraction_job(
    (select job_id from _claimed_plan_retry_job),
    (select claim_token from _claimed_plan_retry_job),
    'retryable_failure',
    'classifier_unavailable',
    null,
    (select now_at from _plan_job_clock)
  ) ->> 'status'),
  'scheduled',
  'a retryable plan classifier failure is rescheduled with bounded backoff'
);

create temporary table _reclaimed_plan_retry_job as
select *
from public.claim_plan_extraction_job(
  (select job_id from _claimed_plan_retry_job),
  (select now_at + interval '31 seconds' from _plan_job_clock),
  300
);

select is(
  (select attempt_no from _reclaimed_plan_retry_job),
  2,
  'a due exact plan retry receives a second attempt and fresh claim'
);

select throws_ok(
  $$select public.complete_plan_extraction_job(
      (select job_id from _claimed_plan_retry_job),
      (select claim_token from _claimed_plan_retry_job),
      'permanent_failure',
      'invalid_input',
      null,
      (select now_at + interval '31 seconds' from _plan_job_clock)
    )$$,
  'P0001',
  'plan extraction job claim is stale',
  'a stale plan claim token cannot overwrite the newer retry'
);

select is(
  (public.complete_plan_extraction_job(
    (select job_id from _reclaimed_plan_retry_job),
    (select claim_token from _reclaimed_plan_retry_job),
    'permanent_failure',
    'invalid_input',
    null,
    (select now_at + interval '31 seconds' from _plan_job_clock)
  ) ->> 'status'),
  'failed',
  'the current token can move an invalid plan job to terminal failure'
);

select is(
  public.switch_current_role((select id from _test_ids where key = 'custom_role')),
  (select id from _test_ids where key = 'custom_role'),
  'the original current role is restored after asynchronous plan processing'
);

insert into _test_ids (key, id)
select
  'plan_cancel_source',
  user_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '请创建一条稍后会失效的测试计划。',
  'plan-extraction-cancel-source-001'
);

update public.messages
set deleted_at = clock_timestamp()
where id = (select id from _test_ids where key = 'plan_cancel_source');

select is(
  (select count(*)::integer
   from public.claim_plan_extraction_job(
     (select id
      from public.plan_extraction_jobs
      where source_message_id = (select id from _test_ids where key = 'plan_cancel_source')),
     (select now_at from _plan_job_clock),
     300
   )),
  0,
  'an invalidated source cannot be claimed for plan extraction'
);

select is(
  (select status::text
   from public.plan_extraction_jobs
   where source_message_id = (select id from _test_ids where key = 'plan_cancel_source')),
  'cancelled',
  'claiming an invalidated source atomically cancels its plan job'
);

select set_config('request.jwt.claim.role', '', true);

insert into _test_ids (key, id)
select
  'sensitive_candidate',
  id
from public.memory_candidates
where extraction_run_id = (
  select (result ->> 'runId')::uuid from _memory_extraction_result
);

insert into _test_ids (key, id)
select
  'confirmed_sensitive_memory',
  public.confirm_memory_candidate(
    (select id from _test_ids where key = 'sensitive_candidate'),
    '用户曾有一段严重情绪低谷，且只希望当前角色使用。',
    'role_private',
    (select id from _test_ids where key = 'custom_role'),
    'memory-confirm-request-001'
  );

select is(
  public.confirm_memory_candidate(
    (select id from _test_ids where key = 'sensitive_candidate'),
    '不会在幂等重试中覆盖原确认内容',
    'role_private',
    (select id from _test_ids where key = 'custom_role'),
    'memory-confirm-request-001'
  ),
  (select id from _test_ids where key = 'confirmed_sensitive_memory'),
  'confirming a memory candidate is idempotent'
);
select ok(
  (select confirmed_by_user
   from public.memories
   where id = (select id from _test_ids where key = 'confirmed_sensitive_memory')),
  'a sensitive active memory always records explicit user confirmation'
);

select throws_ok(
  format(
    $$select public.confirm_memory_candidate(
      %L::uuid,
      null,
      'role_private',
      %L::uuid,
      'memory-confirm-wrong-role-001'
    )$$,
    (select id from _test_ids where key = 'sensitive_candidate'),
    (select id
     from public.roles
     where user_id = '10000000-0000-4000-8000-000000000001'
       and id <> (select id from _test_ids where key = 'custom_role')
     limit 1)
  ),
  'P0001',
  'memory candidate cannot move to another role',
  'candidate confirmation cannot move a source fact into another role'
);

select throws_ok(
  format(
    $$select public.replace_memory(
      %L::uuid,
      null,
      'role_private',
      %L::uuid,
      'memory-sensitive-wrong-role-001'
    )$$,
    (select id from _test_ids where key = 'confirmed_sensitive_memory'),
    (select id
     from public.roles
     where user_id = '10000000-0000-4000-8000-000000000001'
       and id <> (select id from _test_ids where key = 'custom_role')
     limit 1)
  ),
  'P0001',
  'sensitive memory must remain private to its original role',
  'sensitive formal memory cannot be moved to another role'
);

insert into _test_ids (key, id)
select
  'replaced_sensitive_memory',
  public.replace_memory(
    (select id from _test_ids where key = 'confirmed_sensitive_memory'),
    '用户确认更新后的重要情绪经历。',
    null,
    null,
    'memory-replace-request-001'
  );
select is(
  (select status
   from public.memories
   where id = (select id from _test_ids where key = 'confirmed_sensitive_memory')),
  'superseded'::public.memory_status,
  'editing a memory preserves the old state as superseded'
);
select is(
  public.delete_memory(
    (select id from _test_ids where key = 'replaced_sensitive_memory'),
    'memory-delete-request-001'
  ),
  (select id from _test_ids where key = 'replaced_sensitive_memory'),
  'an owned memory can be deleted through the controlled function'
);
select is(
  (select status
   from public.memories
   where id = (select id from _test_ids where key = 'replaced_sensitive_memory')),
  'deleted'::public.memory_status,
  'a deleted memory is immediately excluded from active-memory queries'
);
select is(
  (select status::text
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'replaced_sensitive_memory')),
  'cancelled',
  'deleting an active memory immediately cancels its pending embedding job'
);

select throws_ok(
  format(
    $$select public.persist_memory_extraction(
      '10000000-0000-4000-8000-000000000001',
      %L::uuid,
      %L::uuid,
      'v0.1',
      'memory-extraction-wrong-role-001',
      '[]'::jsonb
    )$$,
    (select id
     from public.roles
     where user_id = '10000000-0000-4000-8000-000000000001'
       and id <> (select id from _test_ids where key = 'custom_role')
     limit 1),
    (select id from _test_ids where key = 'memory_source')
  ),
  'P0001',
  'memory extraction source belongs to another role',
  'an extraction cannot attach a source message to another role'
);

create temporary table _ai_begin_result as
select *
from public.begin_ai_chat_turn(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '请帮我理清今天的工作。',
  'ai-chat-success-001',
  'minimax-development',
  'a1000000-0000-4000-8000-000000000001'
);

select ok(
  (select should_generate from _ai_begin_result),
  'the first AI turn reservation owns the generation lease'
);
select is(
  (select persona_version_id from _ai_begin_result),
  (select id from _test_ids where key = 'persona_v2'),
  'an AI turn pins the current immutable persona version'
);
select is(
  (
    select sv.version_key
    from public.strategy_versions sv
    where sv.id = (select strategy_version_id from _ai_begin_result)
  ),
  'v0.2-minimax-m3-development',
  'an AI turn pins the explicit development strategy'
);
select is(
  (
    select sv.ooc_config ->> 'max_checker_retries_per_draft'
    from public.strategy_versions sv
    where sv.id = (select strategy_version_id from _ai_begin_result)
  ),
  '0',
  'the development strategy does not retry a failed OOC provider call'
);

create temporary table _ai_duplicate_result as
select *
from public.begin_ai_chat_turn(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '请帮我理清今天的工作。',
  'ai-chat-success-001',
  'minimax-development',
  'a2000000-0000-4000-8000-000000000002'
);

select ok(
  not (select should_generate from _ai_duplicate_result),
  'a duplicate request cannot acquire a second active generation lease'
);
select is(
  (select count(*)::integer
   from public.messages
   where user_id = '10000000-0000-4000-8000-000000000001'
     and client_message_id = 'ai-chat-success-001'),
  1,
  'an AI turn retry does not duplicate the user message'
);
select is(
  (select count(*)::integer
   from public.messages
   where reply_to_message_id = (select user_message_id from _ai_begin_result)
     and sender = 'assistant'),
  1,
  'an AI turn retry does not duplicate the assistant placeholder'
);

select is(
  public.complete_ai_chat_turn(
    '10000000-0000-4000-8000-000000000001',
    (select ai_run_id from _ai_begin_result),
    'a1000000-0000-4000-8000-000000000001',
    '我在。我们先列出最影响你的两件事。',
    false,
    123,
    100,
    20,
    '[{
      "attempt_no": 1,
      "verdict": "pass",
      "overall_score": 1,
      "dimension_scores": {
        "identity": 1,
        "personality": 1,
        "speakingStyle": 1,
        "preference": 1,
        "memoryTruthfulness": 1,
        "boundarySafety": 1,
        "temporaryRoleplay": 1
      },
      "failure_labels": [],
      "latency_ms": 10
    }]'::jsonb
  ),
  (select assistant_message_id from _ai_begin_result),
  'the current lease holder can atomically complete a checked reply'
);
select is(
  (select status::text
   from public.ai_runs
   where id = (select ai_run_id from _ai_begin_result)),
  'completed',
  'a successful AI turn reaches the completed run state'
);
select is(
  (select count(*)::integer
   from public.ooc_checks
   where ai_run_id = (select ai_run_id from _ai_begin_result)),
  1,
  'a successful AI turn persists its validated OOC check metadata'
);
insert into _test_ids (key, id)
select
  'persona_feedback_ai_run',
  public.submit_persona_feedback(
    (select assistant_message_id from _ai_begin_result),
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'persona_v2'),
    array['fact_error'],
    '仅用于验证 AI Run 关联的合成反馈。',
    'context_menu',
    'feedback-ai-run-request-001'
  );
select is(
  (select ai_run_id
   from public.badcases
   where persona_feedback_id = (select id from _test_ids where key = 'persona_feedback_ai_run')),
  (select ai_run_id from _ai_begin_result),
  'feedback for a completed same-user AI reply links its exact AI run'
);
select results_eq(
  $$select
      source_type,
      message_id,
      ai_run_id,
      capability,
      severity,
      diagnosis,
      redacted_excerpt,
      status
    from public.badcases
    where persona_feedback_id = (select id from _test_ids where key = 'persona_feedback_ai_run')$$,
  $$values (
      'persona_feedback'::text,
      (select assistant_message_id from _ai_begin_result),
      (select ai_run_id from _ai_begin_result),
      'persona_feedback'::text,
      'medium'::text,
      '等待人工复核的人设反馈。'::text,
      null::text,
      'open'::public.feedback_status
    )$$,
  'AI-run-linked feedback badcases retain only fixed review metadata'
);
select throws_ok(
  $$select public.complete_ai_chat_turn(
      '10000000-0000-4000-8000-000000000001',
      (select ai_run_id from _ai_begin_result),
      'a2000000-0000-4000-8000-000000000002',
      '不能覆盖已经完成的回复',
      false,
      1,
      null,
      null,
      '[]'::jsonb
    )$$,
  'P0001',
  'ai generation lease is not current',
  'a stale lease cannot overwrite a completed assistant message'
);

create temporary table _ai_failed_first as
select *
from public.begin_ai_chat_turn(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '这条消息会先失败再重试。',
  'ai-chat-retry-001',
  'minimax-development',
  'b1000000-0000-4000-8000-000000000001'
);
select is(
  public.fail_ai_chat_turn(
    '10000000-0000-4000-8000-000000000001',
    (select ai_run_id from _ai_failed_first),
    'b1000000-0000-4000-8000-000000000001',
    'failed',
    'timeout',
    120000,
    10,
    0,
    '[]'::jsonb
  ),
  (select assistant_message_id from _ai_failed_first),
  'a provider failure safely closes the pending assistant message'
);

create temporary table _ai_failed_retry as
select *
from public.begin_ai_chat_turn(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'custom_conversation'),
  '这条消息会先失败再重试。',
  'ai-chat-retry-001',
  'minimax-development',
  'b2000000-0000-4000-8000-000000000002'
);
select ok(
  (select should_generate from _ai_failed_retry),
  'the same idempotency key can reacquire a failed run without new messages'
);
select is(
  (select user_message_id from _ai_failed_retry),
  (select user_message_id from _ai_failed_first),
  'a failed retry reuses the original user message'
);
select is(
  (select assistant_message_id from _ai_failed_retry),
  (select assistant_message_id from _ai_failed_first),
  'a failed retry reuses the original assistant placeholder'
);
select is(
  (select attempt_no
   from public.ai_runs
   where id = (select ai_run_id from _ai_failed_retry)),
  2,
  'a failed retry increments the server-controlled attempt number'
);
select throws_ok(
  $$select public.complete_ai_chat_turn(
      '10000000-0000-4000-8000-000000000001',
      (select ai_run_id from _ai_failed_retry),
      'b2000000-0000-4000-8000-000000000002',
      '不能绕过 OOC 直接完成',
      false,
      1,
      null,
      null,
      '[]'::jsonb
    )$$,
  'P0001',
  'minimax completion requires a final passing ooc check',
  'a MiniMax run cannot complete without a final passing OOC check'
);
select throws_ok(
  $$select public.fail_ai_chat_turn(
      '20000000-0000-4000-8000-000000000002',
      (select ai_run_id from _ai_failed_retry),
      'b2000000-0000-4000-8000-000000000002',
      'failed',
      'internal',
      1,
      null,
      null,
      '[]'::jsonb
    )$$,
  'P0001',
  'ai generation lease is not current',
  'another user cannot fail or mutate an owned AI run'
);

insert into _test_ids (key, id)
select
  'persona_feedback',
  public.submit_persona_feedback(
    (select id from _test_ids where key = 'assistant_before_edit'),
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'persona_v1'),
    array['tone_mismatch'],
    '这条语气不符合设定',
    'context_menu',
    'feedback-request-001'
  );

select is(
  (select id from _test_ids where key = 'persona_feedback'),
  (select id
   from public.persona_feedback
   where idempotency_key = 'feedback-request-001'),
  'persona feedback can be stored through the controlled function'
);
select is(
  (select count(*)::integer
   from public.badcases
   where persona_feedback_id = (select id from _test_ids where key = 'persona_feedback')),
  1,
  'a new persona-feedback record creates exactly one linked badcase'
);
select results_eq(
  $$select
      user_id,
      source_type,
      message_id,
      ai_run_id,
      capability,
      severity,
      diagnosis,
      redacted_excerpt,
      status
    from public.badcases
    where persona_feedback_id = (select id from _test_ids where key = 'persona_feedback')$$,
  $$values (
      '10000000-0000-4000-8000-000000000001'::uuid,
      'persona_feedback'::text,
      (select id from _test_ids where key = 'assistant_before_edit'),
      null::uuid,
      'persona_feedback'::text,
      'medium'::text,
      '等待人工复核的人设反馈。'::text,
      null::text,
      'open'::public.feedback_status
    )$$,
  'feedback-linked badcases retain only fixed review metadata and no excerpt'
);
select is(
  public.submit_persona_feedback(
    (select id from _test_ids where key = 'assistant_before_edit'),
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'persona_v1'),
    array['tone_mismatch'],
    '这条语气不符合设定',
    'context_menu',
    'feedback-request-001'
  ),
  (select id from _test_ids where key = 'persona_feedback'),
  'replaying persona feedback keeps its original feedback ID'
);
select is(
  (select count(*)::integer
   from public.badcases
   where persona_feedback_id = (select id from _test_ids where key = 'persona_feedback')),
  1,
  'replaying persona feedback cannot create a second linked badcase'
);
select ok(
  not has_table_privilege('authenticated', 'public.persona_feedback', 'INSERT'),
  'authenticated browsers no longer have direct persona-feedback INSERT'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
insert into _test_ids (key, id)
select 'user_b_role', current_role_id
from public.profiles
where id = '20000000-0000-4000-8000-000000000002';
insert into _test_ids (key, id)
select 'user_b_conversation', id
from public.conversations
where role_id = (select id from _test_ids where key = 'user_b_role');
insert into _test_ids (key, id)
select 'user_b_message', assistant_message_id
from public.append_mock_chat_turn(
  (select id from _test_ids where key = 'user_b_role'),
  (select id from _test_ids where key = 'user_b_conversation'),
  '这是用户 B 的私有时间线。',
  'user-b-private-chat-001'
);
select is(
  (select count(*)::integer
   from public.plan_extraction_jobs
   where user_id = '20000000-0000-4000-8000-000000000002'),
  1,
  'a future user B message creates one owner-scoped plan extraction job'
);
with inserted_memory as (
  insert into public.memories (
    user_id,
    scope,
    role_id,
    category,
    content,
    sensitivity,
    status,
    confirmed_by_user
  )
  values (
    '20000000-0000-4000-8000-000000000002',
    'role_private',
    (select id from _test_ids where key = 'user_b_role'),
    'preference',
    '用户 B 的角色专属记忆',
    'normal',
    'active',
    true
  )
  returning id
)
insert into _test_ids (key, id)
select 'user_b_memory', id from inserted_memory;

insert into _test_ids (key, id)
select
  'normal_extraction_memory',
  id
from public.memories
where extraction_run_id = (
  select (result ->> 'runId')::uuid from _memory_extraction_result
)
  and status = 'active'
  and sensitivity = 'normal';

with inserted_memory as (
  insert into public.memories (
    user_id,
    scope,
    role_id,
    category,
    content,
    sensitivity,
    status,
    confirmed_by_user
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    'role_private',
    (select id
     from public.roles
     where user_id = '10000000-0000-4000-8000-000000000001'
       and id <> (select id from _test_ids where key = 'custom_role')
     order by created_at, id
     limit 1),
    'preference',
    '同一用户另一个角色的记忆',
    'normal',
    'active',
    true
  )
  returning id
)
insert into _test_ids (key, id)
select 'other_role_vector_memory', id from inserted_memory;

with inserted_memory as (
  insert into public.memories (
    user_id,
    scope,
    role_id,
    category,
    content,
    sensitivity,
    status,
    confirmed_by_user
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    'role_private',
    (select id from _test_ids where key = 'custom_role'),
    'sensitive',
    '只在明确允许敏感召回时返回的已确认记忆',
    'sensitive',
    'active',
    true
  )
  returning id
)
insert into _test_ids (key, id)
select 'sensitive_vector_memory', id from inserted_memory;

create temporary table _memory_embedding_versions as
select id, updated_at
from public.memories
where id in (
  (select id from _test_ids where key = 'normal_extraction_memory'),
  (select id from _test_ids where key = 'other_role_vector_memory'),
  (select id from _test_ids where key = 'sensitive_vector_memory'),
  (select id from _test_ids where key = 'user_b_memory')
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table _emotion_followup_clock (base_at timestamptz not null);
insert into _emotion_followup_clock values (clock_timestamp());

with inserted_source as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '用于情绪回访取消边界的合成来源消息。',
    'completed',
    'emotion-followup-source-001',
    (select base_at + interval '1 second' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_source', id from inserted_source;

insert into _test_ids (key, id)
select
  'emotion_followup',
  followup_id
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_source'),
  'overwhelm',
  0.91,
  'emotion-followup-request-001'
);
select results_eq(
  $$select
      emotion_type,
      intensity,
      status,
      last_error_code,
      source_message_id,
      role_id
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup')$$,
  $$values (
      'overwhelm'::text,
      0.91::numeric,
      'scheduled'::public.job_status,
      null::text,
      (select id from _test_ids where key = 'emotion_followup_source'),
      (select id from _test_ids where key = 'custom_role')
    )$$,
  'a strong negative signal creates a minimal scheduled follow-up'
);
select is(
  (select
      (followup.scheduled_for at time zone settings.timezone)::date
      - (source_message.created_at at time zone settings.timezone)::date
   from public.emotion_followups as followup
   join public.user_settings as settings on settings.user_id = followup.user_id
   join public.messages as source_message on source_message.id = followup.source_message_id
   where followup.id = (select id from _test_ids where key = 'emotion_followup')),
  1,
  'a scheduled emotion follow-up is on the next account-local calendar day'
);
select is(
  (select
      (scheduled_for at time zone 'Asia/Shanghai')::time
   from public.emotion_followups
   where id = (select id from _test_ids where key = 'emotion_followup')),
  time '10:00',
  'a follow-up uses the controlled daytime default outside quiet hours'
);
select is(
  (select followup_id
   from public.schedule_strong_negative_emotion_followup(
     '10000000-0000-4000-8000-000000000001',
     (select id from _test_ids where key = 'custom_role'),
     (select id from _test_ids where key = 'emotion_followup_source'),
     'overwhelm',
     0.91,
     'emotion-followup-request-001'
   )),
  (select id from _test_ids where key = 'emotion_followup'),
  'replaying an emotion follow-up request returns the original record'
);
create temporary table _suppressed_emotion_followup as
select *
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_source'),
  'anxiety',
  0.88,
  'emotion-followup-request-002'
);
select is(
  (select status::text from _suppressed_emotion_followup),
  'cancelled',
  'a second outstanding follow-up is recorded as suppressed rather than scheduled'
);
select is(
  (select last_error_code
   from public.emotion_followups
   where id = (select followup_id from _suppressed_emotion_followup)),
  'outstanding_followup',
  'suppressed follow-ups retain only a safe machine reason'
);
select is(
  (select count(*)::integer
   from public.emotion_followups
   where user_id = '10000000-0000-4000-8000-000000000001'
     and status in ('scheduled'::public.job_status, 'running'::public.job_status)),
  1,
  'one user cannot have more than one outstanding emotion follow-up'
);
update public.user_settings
set quiet_hours_start = time '09:00', quiet_hours_end = time '11:00'
where user_id = '20000000-0000-4000-8000-000000000002';
create temporary table _quiet_hour_emotion_followup as
select *
from public.schedule_strong_negative_emotion_followup(
  '20000000-0000-4000-8000-000000000002',
  (select id from _test_ids where key = 'user_b_role'),
  (select reply_to_message_id
   from public.messages
   where id = (select id from _test_ids where key = 'user_b_message')),
  'sadness',
  0.9,
  'emotion-followup-user-b-001'
);
select is(
  (select
      (scheduled_for at time zone 'Asia/Shanghai')::time
   from _quiet_hour_emotion_followup),
  time '11:00',
  'quiet hours move a next-day follow-up to the controlled quiet-hours end'
);
select throws_ok(
  format(
    $$select * from public.schedule_strong_negative_emotion_followup(
        '20000000-0000-4000-8000-000000000002',
        %L::uuid,
        %L::uuid,
        'sadness',
        0.9,
        'emotion-followup-cross-user-001'
      )$$,
    (select id from _test_ids where key = 'custom_role'),
    (select id from _test_ids where key = 'emotion_followup_source')
  ),
  'P0001',
  'emotion follow-up source is unavailable',
  'a service caller cannot attach a follow-up to another user source or role'
);

-- A pending follow-up belongs only to the exact account and role that caused
-- it. Neither another role nor another account can consume it.
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  (select c.id
   from public.conversations as c
   where c.user_id = '10000000-0000-4000-8000-000000000001'
     and c.role_id <> (select id from _test_ids where key = 'custom_role')
   order by c.created_at, c.id
   limit 1),
  (select c.role_id
   from public.conversations as c
   where c.user_id = '10000000-0000-4000-8000-000000000001'
     and c.role_id <> (select id from _test_ids where key = 'custom_role')
   order by c.created_at, c.id
   limit 1),
  'user',
  '另一角色的合成后续消息。',
  'completed',
  'emotion-followup-other-role-001',
  (select base_at + interval '2 seconds' from _emotion_followup_clock)
);
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at
)
values (
  '20000000-0000-4000-8000-000000000002',
  (select c.id
   from public.conversations as c
   where c.user_id = '20000000-0000-4000-8000-000000000002'
     and c.role_id <> (select id from _test_ids where key = 'user_b_role')
   order by c.created_at, c.id
   limit 1),
  (select c.role_id
   from public.conversations as c
   where c.user_id = '20000000-0000-4000-8000-000000000002'
     and c.role_id <> (select id from _test_ids where key = 'user_b_role')
   order by c.created_at, c.id
   limit 1),
  'user',
  '另一账户的合成后续消息。',
  'completed',
  'emotion-followup-other-user-001',
  (select base_at + interval '2 seconds' from _emotion_followup_clock)
);
select is(
  (select status::text
   from public.emotion_followups
   where id = (select id from _test_ids where key = 'emotion_followup')),
  'scheduled',
  'another role or account cannot cancel a pending emotion follow-up'
);

-- Incomplete, deleted, and timestamp-earlier messages are not a response to
-- the source. Explicit timestamps make this contract stable inside pgtap's
-- single transaction as well as in normal production transactions.
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_conversation'),
  (select id from _test_ids where key = 'custom_role'),
  'user',
  '尚未完成的合成后续消息。',
  'pending',
  'emotion-followup-pending-001',
  (select base_at + interval '3 seconds' from _emotion_followup_clock)
);
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at,
  deleted_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_conversation'),
  (select id from _test_ids where key = 'custom_role'),
  'user',
  '已删除的合成后续消息。',
  'completed',
  'emotion-followup-deleted-001',
  (select base_at + interval '4 seconds' from _emotion_followup_clock),
  (select base_at + interval '4 seconds' from _emotion_followup_clock)
);
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_conversation'),
  (select id from _test_ids where key = 'custom_role'),
  'user',
  '时间早于来源的合成消息。',
  'completed',
  'emotion-followup-earlier-001',
  (select base_at from _emotion_followup_clock)
);
select is(
  (select status::text
   from public.emotion_followups
   where id = (select id from _test_ids where key = 'emotion_followup')),
  'scheduled',
  'unfinished, deleted, and earlier messages do not cancel a follow-up'
);

with inserted_response as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '同角色的有效合成后续消息。',
    'completed',
    'emotion-followup-response-001',
    (select base_at + interval '5 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_response', id from inserted_response;

select results_eq(
  $$select
      status,
      last_error_code,
      cancelled_by_message_id
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup')$$,
  $$values (
      'cancelled'::public.job_status,
      'user_responded'::text,
      (select id from _test_ids where key = 'emotion_followup_response')
    )$$,
  'a later completed user message atomically cancels only its scheduled role follow-up'
);
update public.messages
set status = 'completed'
where id = (select id from _test_ids where key = 'emotion_followup_response');
select is(
  (select count(*)::integer
   from public.emotion_followups
   where user_id = '10000000-0000-4000-8000-000000000001'
     and source_message_id = (select id from _test_ids where key = 'emotion_followup_source')
     and last_error_code = 'user_responded'),
  1,
  'replaying a completed user-message state does not create another cancellation side effect'
);

-- If the classifier finishes after the user has already answered, its own
-- insert guard records the same safe outcome rather than recreating work that
-- the message trigger could no longer observe.
with inserted_source as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '先被回应的合成情绪来源消息。',
    'completed',
    'emotion-followup-preanswered-source-001',
    (select base_at + interval '10 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_preanswered_source', id from inserted_source;
with inserted_response as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '已经回应来源的合成后续消息。',
    'completed',
    'emotion-followup-preanswered-response-001',
    (select base_at + interval '11 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_preanswered_response', id from inserted_response;
create temporary table _preanswered_emotion_followup as
select *
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_preanswered_source'),
  'loneliness',
  0.9,
  'emotion-followup-preanswered-001'
);
select results_eq(
  $$select
      followup.status,
      stored.last_error_code,
      stored.cancelled_by_message_id
    from _preanswered_emotion_followup as followup
    join public.emotion_followups as stored on stored.id = followup.followup_id$$,
  $$values (
      'cancelled'::public.job_status,
      'user_responded'::text,
      (select id from _test_ids where key = 'emotion_followup_preanswered_response')
    )$$,
  'a late classifier result cannot recreate a follow-up after the user has responded'
);

-- There is no delivery Worker in this phase. A future Worker must first mark
-- a job running under the same account lock; a later user response must not
-- rewrite that state as cancelled after dispatch has started.
update public.emotion_followups
set status = 'running'
where id = (select followup_id from _quiet_hour_emotion_followup);
insert into public.messages (
  user_id,
  conversation_id,
  role_id,
  sender,
  content,
  status,
  client_message_id,
  created_at
)
values (
  '20000000-0000-4000-8000-000000000002',
  (select c.id
   from public.conversations as c
   where c.user_id = '20000000-0000-4000-8000-000000000002'
     and c.role_id = (select id from _test_ids where key = 'user_b_role')
   order by c.created_at, c.id
   limit 1),
  (select id from _test_ids where key = 'user_b_role'),
  'user',
  '派送开始后的合成用户消息。',
  'completed',
  'emotion-followup-running-response-001',
  clock_timestamp() + interval '1 day'
);
select results_eq(
  $$select status, cancelled_by_message_id, last_error_code
    from public.emotion_followups
    where id = (select followup_id from _quiet_hour_emotion_followup)$$,
  $$values ('running'::public.job_status, null::uuid, null::text)$$,
  'a response never retroactively marks a running future delivery as cancelled'
);

-- The only available delivery operation is a service-only, exact-ID claim.
-- It exposes references and a bounded token, never source text or a draft.
with inserted_source as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '用于精确派送领取协议的合成来源消息。',
    'completed',
    'emotion-followup-delivery-source-001',
    (select base_at + interval '20 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_delivery_source', id from inserted_source;
insert into _test_ids (key, id)
select
  'emotion_followup_delivery',
  followup_id
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_delivery_source'),
  'anxiety',
  0.91,
  'emotion-followup-delivery-001'
);
create temporary table _emotion_followup_delivery_clock as
select scheduled_for + interval '1 second' as now_at
from public.emotion_followups
where id = (select id from _test_ids where key = 'emotion_followup_delivery');
create temporary table _claimed_emotion_followup as
select *
from public.claim_due_emotion_followup(
  (select id from _test_ids where key = 'emotion_followup_delivery'),
  (select now_at from _emotion_followup_delivery_clock),
  300
);
select is(
  (select count(*)::integer from _claimed_emotion_followup),
  1,
  'an exact due follow-up claim returns only the named pending follow-up'
);
select ok(
  (select
      followup_id = (select id from _test_ids where key = 'emotion_followup_delivery')
      and claim_token is not null
      and lease_expires_at = (
        select now_at + interval '300 seconds'
        from _emotion_followup_delivery_clock
      )
   from _claimed_emotion_followup),
  'an emotion delivery claim returns a bounded opaque token without message content'
);
select results_eq(
  $$select
      status,
      delivery_claim_token = (select claim_token from _claimed_emotion_followup),
      delivery_lease_expires_at = (select lease_expires_at from _claimed_emotion_followup),
      delivery_started_at = (select now_at from _emotion_followup_delivery_clock),
      last_error_code
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup_delivery')$$,
  $$values ('running'::public.job_status, true, true, true, null::text)$$,
  'a claim atomically records running state and its exact delivery lease'
);
select is(
  (select count(*)::integer
   from public.claim_due_emotion_followup(
     (select id from _test_ids where key = 'emotion_followup_delivery'),
     (select now_at from _emotion_followup_delivery_clock),
     300
   )),
  0,
  'a current lease cannot be claimed by another delivery attempt'
);
select is(
  public.persist_claimed_emotion_followup_message(
    (select id from _test_ids where key = 'emotion_followup_delivery'),
    (select claim_token from _claimed_emotion_followup),
    '租约截止时不得再持久化回访助手消息。',
    (select now_at + interval '300 seconds' from _emotion_followup_delivery_clock)
  ),
  null::uuid,
  'a lease at its exact deadline fails closed without writing a proactive message'
);
select is(
  (select count(*)::integer
   from public.claim_due_emotion_followup(
     (select id from _test_ids where key = 'emotion_followup_delivery'),
     (select now_at + interval '301 seconds' from _emotion_followup_delivery_clock),
     300
   )),
  0,
  'an expired delivery lease fails closed instead of retrying and duplicating a check-in'
);
select results_eq(
  $$select status, sent_message_id, delivery_claim_token, delivery_lease_expires_at, last_error_code
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup_delivery')$$,
  $$values ('failed'::public.job_status, null::uuid, null::uuid, null::timestamptz, 'delivery_lease_expired'::text)$$,
  'an expired exact delivery lease leaves only a minimal terminal state and no message reference'
);
select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'emotion_followups'
     and column_name in ('content', 'source_message', 'draft', 'raw_output', 'reasoning')),
  0,
  'emotion follow-up control state retains no message text, draft, raw output, or reasoning'
);

-- A current token can finish only by linking an already-completed assistant
-- message in the same account and role. This remains a persistence boundary;
-- the test does not call a model or an external delivery service.
with inserted_source as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '用于精确派送完成协议的合成来源消息。',
    'completed',
    'emotion-followup-completion-source-001',
    (select base_at + interval '30 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_completion_source', id from inserted_source;
insert into _test_ids (key, id)
select
  'emotion_followup_completion',
  followup_id
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_completion_source'),
  'grief',
  0.92,
  'emotion-followup-completion-001'
);
create temporary table _emotion_followup_completion_clock as
select scheduled_for + interval '1 second' as now_at
from public.emotion_followups
where id = (select id from _test_ids where key = 'emotion_followup_completion');
create temporary table _claimed_emotion_followup_completion as
select *
from public.claim_due_emotion_followup(
  (select id from _test_ids where key = 'emotion_followup_completion'),
  (select now_at from _emotion_followup_completion_clock),
  300
);
-- A same-scope assistant row is insufficient on its own: terminal success
-- must reference the row atomically bound by the current persistence claim.
-- This is a privileged test fixture only; browser write permissions are
-- verified separately above.
with inserted_unbound_message as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    persona_version_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'assistant',
    '仅用于验证未绑定助手消息拒绝逻辑的合成内容。',
    'completed',
    (select current_persona_version_id
     from public.roles
     where id = (select id from _test_ids where key = 'custom_role')),
    (select now_at + interval '1 second' from _emotion_followup_completion_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_unbound_message', id from inserted_unbound_message;
select throws_ok(
  $$select public.complete_emotion_followup_delivery(
      (select id from _test_ids where key = 'emotion_followup_completion'),
      (select claim_token from _claimed_emotion_followup_completion),
      'succeeded',
      (select id from _test_ids where key = 'emotion_followup_unbound_message'),
      null,
      (select now_at + interval '1 second' from _emotion_followup_completion_clock)
    )$$,
  'P0001',
  'emotion follow-up sent message is unavailable',
  'a same-scope but unbound assistant message cannot be presented as delivered'
);
create temporary table _persisted_emotion_followup_completion_message as
select public.persist_claimed_emotion_followup_message(
  (select id from _test_ids where key = 'emotion_followup_completion'),
  (select claim_token from _claimed_emotion_followup_completion),
  '仅用于验证受控回访消息持久化的合成助手消息。',
  (select now_at + interval '1 second' from _emotion_followup_completion_clock)
) as id;
insert into _test_ids (key, id)
select 'emotion_followup_completion_message', id
from _persisted_emotion_followup_completion_message;
select is(
  public.persist_claimed_emotion_followup_message(
    (select id from _test_ids where key = 'emotion_followup_completion'),
    (select claim_token from _claimed_emotion_followup_completion),
    '重试时不得生成第二条回访助手消息。',
    (select now_at + interval '1 second' from _emotion_followup_completion_clock)
  ),
  (select id from _test_ids where key = 'emotion_followup_completion_message'),
  'a persistence retry with the current token returns its already-bound message'
);
select is(
  (select count(*)::integer
   from public.messages
   where id = (select id from _test_ids where key = 'emotion_followup_completion_message')),
  1,
  'a persistence retry cannot create a duplicate proactive assistant message'
);
select results_eq(
  $$select
      message.user_id,
      message.conversation_id,
      message.role_id,
      message.sender,
      message.status,
      message.persona_version_id,
      message.created_at
    from public.messages as message
    where message.id = (select id from _test_ids where key = 'emotion_followup_completion_message')$$,
  $$values (
      '10000000-0000-4000-8000-000000000001'::uuid,
      (select id from _test_ids where key = 'custom_conversation'),
      (select id from _test_ids where key = 'custom_role'),
      'assistant'::public.message_sender,
      'completed'::public.message_status,
      (select current_persona_version_id
       from public.roles
       where id = (select id from _test_ids where key = 'custom_role')),
      (select now_at + interval '1 second' from _emotion_followup_completion_clock)
    )$$,
  'controlled persistence derives the owner, role, conversation, current persona, and message time from the current claim'
);
select results_eq(
  $$select status, sent_message_id, delivery_claim_token, delivery_lease_expires_at, last_error_code
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup_completion')$$,
  $$values (
      'running'::public.job_status,
      (select id from _test_ids where key = 'emotion_followup_completion_message'),
      (select claim_token from _claimed_emotion_followup_completion),
      (select lease_expires_at from _claimed_emotion_followup_completion),
      null::text
    )$$,
  'controlled persistence binds one message while retaining the active lease for explicit terminal completion'
);
select is(
  public.complete_emotion_followup_delivery(
    (select id from _test_ids where key = 'emotion_followup_completion'),
    (select claim_token from _claimed_emotion_followup_completion),
    'succeeded',
    (select id from _test_ids where key = 'emotion_followup_completion_message'),
    null,
    (select now_at + interval '1 second' from _emotion_followup_completion_clock)
  ) ->> 'status',
  'succeeded',
  'a current delivery token can terminally record one same-role assistant message'
);
select results_eq(
  $$select status, sent_message_id, delivery_claim_token, delivery_lease_expires_at, last_error_code
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup_completion')$$,
  $$values (
      'succeeded'::public.job_status,
      (select id from _test_ids where key = 'emotion_followup_completion_message'),
      null::uuid,
      null::timestamptz,
      null::text
    )$$,
  'terminal success clears the lease while retaining only the assistant-message reference'
);
select throws_ok(
  $$select public.complete_emotion_followup_delivery(
      (select id from _test_ids where key = 'emotion_followup_completion'),
      (select claim_token from _claimed_emotion_followup_completion),
      'succeeded',
      (select id from _test_ids where key = 'emotion_followup_completion_message'),
      null,
      (select now_at + interval '1 second' from _emotion_followup_completion_clock)
    )$$,
  'P0001',
  'emotion follow-up delivery claim is stale',
  'a terminal delivery cannot be overwritten by a stale token replay'
);

-- Completion must use the same boundary as persistence: the exact lease
-- deadline is already expired, even when a message was bound before it.
with inserted_source as (
  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id,
    created_at
  )
  values (
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'custom_conversation'),
    (select id from _test_ids where key = 'custom_role'),
    'user',
    '用于验证终结租约截止边界的合成来源消息。',
    'completed',
    'emotion-followup-deadline-source-001',
    (select base_at + interval '50 seconds' from _emotion_followup_clock)
  )
  returning id
)
insert into _test_ids (key, id)
select 'emotion_followup_deadline_source', id from inserted_source;
insert into _test_ids (key, id)
select
  'emotion_followup_deadline',
  followup_id
from public.schedule_strong_negative_emotion_followup(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  (select id from _test_ids where key = 'emotion_followup_deadline_source'),
  'sadness',
  0.9,
  'emotion-followup-deadline-001'
);
create temporary table _emotion_followup_deadline_clock as
select scheduled_for + interval '1 second' as now_at
from public.emotion_followups
where id = (select id from _test_ids where key = 'emotion_followup_deadline');
create temporary table _claimed_emotion_followup_deadline as
select *
from public.claim_due_emotion_followup(
  (select id from _test_ids where key = 'emotion_followup_deadline'),
  (select now_at from _emotion_followup_deadline_clock),
  300
);
create temporary table _emotion_followup_deadline_message as
select public.persist_claimed_emotion_followup_message(
  (select id from _test_ids where key = 'emotion_followup_deadline'),
  (select claim_token from _claimed_emotion_followup_deadline),
  '截止前已绑定但不得在截止时终结的合成回访消息。',
  (select now_at + interval '1 second' from _emotion_followup_deadline_clock)
) as id;
select is(
  public.complete_emotion_followup_delivery(
    (select id from _test_ids where key = 'emotion_followup_deadline'),
    (select claim_token from _claimed_emotion_followup_deadline),
    'succeeded',
    (select id from _emotion_followup_deadline_message),
    null,
    (select lease_expires_at from _claimed_emotion_followup_deadline)
  ) ->> 'status',
  'failed',
  'completion at the exact lease deadline fails closed instead of accepting success'
);
select results_eq(
  $$select status, sent_message_id, delivery_claim_token, delivery_lease_expires_at, last_error_code
    from public.emotion_followups
    where id = (select id from _test_ids where key = 'emotion_followup_deadline')$$,
  $$values (
      'failed'::public.job_status,
      (select id from _emotion_followup_deadline_message),
      null::uuid,
      null::timestamptz,
      'delivery_lease_expired'::text
    )$$,
  'an exact-deadline completion clears the lease while retaining the bound message reference for audit'
);

create temporary table _emotion_signal_job_clock (now_at timestamptz not null);
insert into _emotion_signal_job_clock values (clock_timestamp());

create temporary table _claimed_emotion_signal_job as
select *
from public.claim_emotion_signal_job(
  (select id
   from public.emotion_signal_jobs
   where user_id = '10000000-0000-4000-8000-000000000001'
     and source_message_id = (select user_message_id from _ai_begin_result)),
  (select now_at from _emotion_signal_job_clock),
  300
);
select is(
  (select count(*)::integer from _claimed_emotion_signal_job),
  1,
  'an exact emotion claim returns only the requested future-message job'
);
select ok(
  (select claim_token is not null
      and attempt_no = 1
      and lease_expires_at = (
        select now_at + interval '300 seconds' from _emotion_signal_job_clock
      )
   from _claimed_emotion_signal_job),
  'an emotion job claim returns a bounded lease and opaque token'
);
select is(
  (select count(*)::integer
   from public.emotion_signal_jobs
   where status = 'running'::public.job_status),
  1,
  'claiming one exact emotion task leaves every other queued task untouched'
);
select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'emotion_signal_jobs'
     and column_name in ('content', 'source_message', 'raw_output', 'reasoning')),
  0,
  'emotion signal queue stores references and machine state but no message text or model reasoning'
);
update public.messages
set status = 'completed'
where id = (select user_message_id from _ai_begin_result);
select is(
  (select count(*)::integer
   from public.emotion_signal_jobs
   where user_id = '10000000-0000-4000-8000-000000000001'
     and source_message_id = (select user_message_id from _ai_begin_result)),
  1,
  'replaying a completed-message transition does not create a second emotion task'
);
select is(
  public.complete_emotion_signal_job(
    (select job_id from _claimed_emotion_signal_job),
    (select claim_token from _claimed_emotion_signal_job),
    'succeeded',
    null,
    (select now_at from _emotion_signal_job_clock)
  ) ->> 'status',
  'succeeded',
  'the current emotion job lease can complete a classification without persisting its output'
);
select throws_ok(
  $$select public.complete_emotion_signal_job(
      (select job_id from _claimed_emotion_signal_job),
      (select claim_token from _claimed_emotion_signal_job),
      'succeeded',
      null,
      (select now_at from _emotion_signal_job_clock)
    )$$,
  'P0001',
  'emotion signal job claim is stale',
  'a completed emotion task cannot be overwritten by a stale retry'
);
select throws_ok(
  $$select public.complete_emotion_signal_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      null::text,
      'classifier_unavailable',
      clock_timestamp()
    )$$,
  'P0001',
  'emotion signal completion input is invalid',
  'a service caller cannot use a NULL outcome to bypass completion validation'
);

create temporary table _other_emotion_signal_job as
select candidate.id
from public.emotion_signal_jobs as candidate
join public.messages as source_message
  on source_message.id = candidate.source_message_id
  and source_message.user_id = candidate.user_id
  and source_message.role_id = candidate.role_id
  and source_message.sender = 'user'
  and source_message.status = 'completed'
  and source_message.deleted_at is null
join public.roles as source_role
  on source_role.id = candidate.role_id
  and source_role.user_id = candidate.user_id
  and source_role.status = 'active'
where candidate.id <> (select job_id from _claimed_emotion_signal_job)
  and candidate.status = 'scheduled'::public.job_status
order by candidate.created_at, candidate.id
limit 1;
select is(
  (select count(*)::integer from _other_emotion_signal_job),
  1,
  'a second future-message emotion task remains available for exact retry testing'
);
create temporary table _claimed_other_emotion_signal_job as
select *
from public.claim_emotion_signal_job(
  (select id from _other_emotion_signal_job),
  (select now_at from _emotion_signal_job_clock),
  300
);
select is(
  (select count(*)::integer from _claimed_other_emotion_signal_job),
  1,
  'a second valid emotion task can be claimed for retry testing'
);
select is(
  public.complete_emotion_signal_job(
    (select job_id from _claimed_other_emotion_signal_job),
    (select claim_token from _claimed_other_emotion_signal_job),
    'retryable_failure',
    'classifier_unavailable',
    (select now_at from _emotion_signal_job_clock)
  ) ->> 'status',
  'scheduled',
  'an unavailable emotion classifier returns only the exact task to its schedule'
);
select is(
  (select available_at
   from public.emotion_signal_jobs
   where id = (select id from _other_emotion_signal_job)),
  (select now_at + interval '30 seconds' from _emotion_signal_job_clock),
  'the first emotion classifier retry uses bounded backoff'
);
create temporary table _reclaimed_other_emotion_signal_job as
select *
from public.claim_emotion_signal_job(
  (select id from _other_emotion_signal_job),
  (select now_at + interval '31 seconds' from _emotion_signal_job_clock),
  300
);
select is(
  (select attempt_no from _reclaimed_other_emotion_signal_job),
  2,
  'an emotion job can be reclaimed with a new lease after its backoff'
);
select throws_ok(
  $$select public.complete_emotion_signal_job(
      (select job_id from _claimed_other_emotion_signal_job),
      (select claim_token from _claimed_other_emotion_signal_job),
      'succeeded',
      null,
      (select now_at + interval '31 seconds' from _emotion_signal_job_clock)
    )$$,
  'P0001',
  'emotion signal job claim is stale',
  'an old emotion job token cannot complete after the task is reclaimed'
);

create temporary table _memory_embedding_job_clock (now_at timestamptz not null);
insert into _memory_embedding_job_clock values (clock_timestamp());

create temporary table _claimed_memory_embedding_job as
select *
from public.claim_memory_embedding_job(
  (select id
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'normal_extraction_memory')),
  (select now_at from _memory_embedding_job_clock),
  300
);

select is(
  (select count(*)::integer from _claimed_memory_embedding_job),
  1,
  'an exact embedding claim returns only the requested active memory job'
);

select is(
  (select status::text
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'other_role_vector_memory')),
  'scheduled',
  'an exact embedding claim leaves another memory job scheduled'
);

select is(
  public.set_memory_embedding(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'normal_extraction_memory'),
    (select content
     from public.memories
     where id = (select id from _test_ids where key = 'normal_extraction_memory')),
    (select updated_at
     from _memory_embedding_versions
     where id = (select id from _test_ids where key = 'normal_extraction_memory')),
    'local-fixed',
    'deterministic-1536-v1',
    array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector
  ),
  (select id from _test_ids where key = 'normal_extraction_memory'),
  'a service worker can attach a versioned embedding to an active owned memory'
);

select is(
  (public.complete_memory_embedding_job(
    (select job_id from _claimed_memory_embedding_job),
    (select claim_token from _claimed_memory_embedding_job),
    'succeeded',
    null,
    'local-fixed',
    'deterministic-1536-v1',
    (select now_at from _memory_embedding_job_clock)
  ) ->> 'status'),
  'succeeded',
  'an embedding job succeeds only after its memory stores the matching model identity'
);

select is(
  (select count(*)::integer
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'normal_extraction_memory')),
  1,
  'embedding job enqueue and completion remain idempotent for one memory version'
);

create temporary table _first_embedding_retry_claim as
select *
from public.claim_memory_embedding_job(
  (select id
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'other_role_vector_memory')),
  (select now_at from _memory_embedding_job_clock),
  300
);

select is(
  (public.complete_memory_embedding_job(
    (select job_id from _first_embedding_retry_claim),
    (select claim_token from _first_embedding_retry_claim),
    'retryable_failure',
    'embedding_unavailable',
    null,
    null,
    (select now_at from _memory_embedding_job_clock)
  ) ->> 'status'),
  'scheduled',
  'a temporary embedding provider failure is rescheduled with bounded backoff'
);

create temporary table _second_embedding_retry_claim as
select *
from public.claim_memory_embedding_job(
  (select job_id from _first_embedding_retry_claim),
  (select now_at + interval '31 seconds' from _memory_embedding_job_clock),
  300
);

select is(
  (select attempt_no from _second_embedding_retry_claim),
  2,
  'a due embedding retry receives a fresh second attempt'
);

select throws_ok(
  $$select public.complete_memory_embedding_job(
      (select job_id from _first_embedding_retry_claim),
      (select claim_token from _first_embedding_retry_claim),
      'permanent_failure',
      'invalid_embedding',
      null,
      null,
      (select now_at + interval '31 seconds' from _memory_embedding_job_clock)
    )$$,
  'P0001',
  'memory embedding job claim is stale',
  'an old embedding claim token cannot overwrite a newer worker attempt'
);

select is(
  public.set_memory_embedding(
    '10000000-0000-4000-8000-000000000001',
    (select id from _test_ids where key = 'normal_extraction_memory'),
    (select content
     from public.memories
     where id = (select id from _test_ids where key = 'normal_extraction_memory')),
    (select updated_at
     from _memory_embedding_versions
     where id = (select id from _test_ids where key = 'normal_extraction_memory')),
    'local-fixed',
    'deterministic-1536-v1',
    array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector
  ),
  (select id from _test_ids where key = 'normal_extraction_memory'),
  'retrying the same provider and model is idempotent after updated_at changes'
);

select public.set_memory_embedding(
  memory.user_id,
  memory.id,
  memory.content,
  version.updated_at,
  'local-fixed',
  'deterministic-1536-v1',
  array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector
)
from public.memories as memory
join _memory_embedding_versions as version on version.id = memory.id
where memory.id in (
  (select id from _test_ids where key = 'other_role_vector_memory'),
  (select id from _test_ids where key = 'sensitive_vector_memory'),
  (select id from _test_ids where key = 'user_b_memory')
);

select is(
  (public.complete_memory_embedding_job(
    (select job_id from _second_embedding_retry_claim),
    (select claim_token from _second_embedding_retry_claim),
    'succeeded',
    null,
    'local-fixed',
    'deterministic-1536-v1',
    (select now_at + interval '31 seconds' from _memory_embedding_job_clock)
  ) ->> 'status'),
  'succeeded',
  'the current embedding retry can finish after storing the matching vector'
);

create temporary table _already_embedded_claim_result as
select *
from public.claim_memory_embedding_job(
  (select id
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'sensitive_vector_memory')),
  (select now_at from _memory_embedding_job_clock),
  300
);

select is(
  (select count(*)::integer from _already_embedded_claim_result),
  0,
  'a retry does not call the provider again when the vector was already stored'
);
select is(
  (select status::text
   from public.memory_embedding_jobs
   where memory_id = (select id from _test_ids where key = 'sensitive_vector_memory')),
  'succeeded',
  'a job is reconciled to succeeded after a worker stored the vector before losing completion'
);

create temporary table _normal_memory_matches as
select *
from public.match_memories_for_role(
  '10000000-0000-4000-8000-000000000001',
  (select id from _test_ids where key = 'custom_role'),
  array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector,
  'local-fixed',
  'deterministic-1536-v1',
  5,
  0.99,
  false,
  clock_timestamp()
);

select is(
  (select array_agg(memory_id order by memory_id) from _normal_memory_matches),
  array[(select id from _test_ids where key = 'normal_extraction_memory')],
  'vector retrieval filters another user, another role, and sensitive memory before ranking'
);

select is(
  (select count(*)::integer
   from public.match_memories_for_role(
     '10000000-0000-4000-8000-000000000001',
     (select id from _test_ids where key = 'custom_role'),
     array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector,
     'local-fixed',
     'deterministic-1536-v1',
     5,
     0.99,
     true,
     clock_timestamp()
   )),
  2,
  'an explicitly enabled sensitive search can include only confirmed sensitive memory'
);

select is(
  public.record_ai_run_memory_retrievals(
    '10000000-0000-4000-8000-000000000001',
    (select ai_run_id from _ai_failed_retry),
    'b2000000-0000-4000-8000-000000000002',
    (select id from _test_ids where key = 'custom_role'),
    'local-fixed',
    'deterministic-1536-v1',
    true,
    jsonb_build_array(
      jsonb_build_object(
        'memory_id',
        (select id from _test_ids where key = 'normal_extraction_memory'),
        'retrieval_rank',
        1,
        'similarity',
        0.99,
        'included_in_context',
        true
      ),
      jsonb_build_object(
        'memory_id',
        (select id from _test_ids where key = 'sensitive_vector_memory'),
        'retrieval_rank',
        2,
        'similarity',
        0.98,
        'included_in_context',
        false
      )
    )
  ),
  (select ai_run_id from _ai_failed_retry),
  'the current AI lease records retrieved and actually included memory IDs atomically'
);

select is(
  (select count(*)::integer
   from public.ai_run_memory_retrievals
   where ai_run_id = (select ai_run_id from _ai_failed_retry)),
  2,
  'one AI run stores at most one row per retrieved memory'
);

select is(
  (select count(*)::integer
   from public.ai_run_memory_retrievals
   where ai_run_id = (select ai_run_id from _ai_failed_retry)
     and included_in_context),
  1,
  'a retrieved memory dropped by the context budget is not marked as model-visible'
);

select is(
  (select min(ai_run_attempt_no)
   from public.ai_run_memory_retrievals
   where ai_run_id = (select ai_run_id from _ai_failed_retry)),
  2,
  'retrieval metadata is pinned to the current server-controlled AI attempt'
);

select throws_ok(
  $$select public.record_ai_run_memory_retrievals(
      '10000000-0000-4000-8000-000000000001',
      (select ai_run_id from _ai_failed_retry),
      'b2000000-0000-4000-8000-000000000002',
      (select id from _test_ids where key = 'custom_role'),
      'local-fixed',
      'deterministic-1536-v1',
      false,
      jsonb_build_array(
        jsonb_build_object(
          'memory_id',
          (select id from _test_ids where key = 'sensitive_vector_memory'),
          'retrieval_rank',
          1,
          'similarity',
          0.99,
          'included_in_context',
          true
        )
      )
    )$$,
  'P0001',
  'ai memory retrieval scope mismatch',
  'sensitive memory cannot be audited without explicit relevance authorization'
);

select throws_ok(
  $$select public.record_ai_run_memory_retrievals(
      '10000000-0000-4000-8000-000000000001',
      (select ai_run_id from _ai_failed_retry),
      'b2000000-0000-4000-8000-000000000002',
      (select id from _test_ids where key = 'custom_role'),
      'local-fixed',
      'deterministic-1536-v1',
      false,
      jsonb_build_array(
        jsonb_build_object(
          'memory_id',
          (select id from _test_ids where key = 'other_role_vector_memory'),
          'retrieval_rank',
          1,
          'similarity',
          0.99,
          'included_in_context',
          true
        )
      )
    )$$,
  'P0001',
  'ai memory retrieval scope mismatch',
  'another role private memory cannot be attached to the current AI run audit'
);

select throws_ok(
  $$select public.record_ai_run_memory_retrievals(
      '20000000-0000-4000-8000-000000000002',
      (select ai_run_id from _ai_failed_retry),
      'b2000000-0000-4000-8000-000000000002',
      (select id from _test_ids where key = 'custom_role'),
      'local-fixed',
      'deterministic-1536-v1',
      false,
      '[]'::jsonb
    )$$,
  'P0001',
  'ai memory retrieval run is not current',
  'another user cannot replace or clear an owned AI run retrieval audit'
);

select throws_ok(
  $$select public.set_memory_embedding(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'normal_extraction_memory'),
      '过期或错误的记忆正文',
      (select updated_at
       from _memory_embedding_versions
       where id = (select id from _test_ids where key = 'normal_extraction_memory')),
      'local-fixed',
      'deterministic-1536-v2',
      array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector
    )$$,
  '40001',
  'memory embedding content conflict',
  'an embedding cannot be attached to a stale or different memory body'
);

select throws_ok(
  $$select public.match_memories_for_role(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      array_cat(array[1::real], array_fill(0::real, array[1535]))::extensions.vector,
      'local-fixed',
      'deterministic-1536-v1',
      6,
      0.8,
      false,
      clock_timestamp()
    )$$,
  'P0001',
  'memory retrieval input is invalid',
  'vector retrieval never accepts more than five results'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer
   from public.profiles
   where id = '20000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot read user B profile'
);
select is(
  (select count(*)::integer
   from public.roles
   where user_id = '20000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot read user B roles or personas'
);
select is(
  (select count(*)::integer
   from public.messages
   where role_id = (select id from _test_ids where key = 'user_b_role')),
  0,
  'role B messages cannot enter user A or another role context'
);
select is(
  (select count(*)::integer
   from public.memories
   where role_id = (select id from _test_ids where key = 'user_b_role')),
  0,
  'role-private memories cannot cross users or roles'
);
select throws_ok(
  $$update public.profiles
    set current_role_id = null
    where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'authenticated clients cannot directly update the current role'
);
select throws_ok(
  $$insert into public.roles (user_id, source, display_name)
    values (
      '10000000-0000-4000-8000-000000000001',
      'custom',
      '绕过受控函数'
    )$$,
  '42501',
  'permission denied for table roles',
  'authenticated clients cannot directly insert roles'
);
select throws_ok(
  $$insert into public.persona_feedback (user_id)
    values ('10000000-0000-4000-8000-000000000001')$$,
  '42501',
  'permission denied for table persona_feedback',
  'authenticated clients cannot directly insert persona feedback'
);
select throws_ok(
  $$insert into public.in_app_notifications (
      user_id, notification_job_id, plan_id, delivered_at
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000091',
      '00000000-0000-4000-8000-000000000092',
      clock_timestamp()
    )$$,
  '42501',
  'permission denied for table in_app_notifications',
  'authenticated clients cannot directly insert in-app reminders'
);
select throws_ok(
  $$select public.claim_due_notification_job(
      '00000000-0000-4000-8000-000000000091',
      clock_timestamp(),
      300
    )$$,
  '42501',
  'permission denied for function claim_due_notification_job',
  'authenticated clients cannot claim notification jobs'
);
select throws_ok(
  $$select public.complete_notification_job(
      '00000000-0000-4000-8000-000000000091',
      '00000000-0000-4000-8000-000000000092',
      'succeeded',
      null,
      clock_timestamp()
    )$$,
  '42501',
  'permission denied for function complete_notification_job',
  'authenticated clients cannot complete notification jobs'
);
select throws_ok(
  $$select public.deliver_in_app_plan_reminder(
      '00000000-0000-4000-8000-000000000091',
      '00000000-0000-4000-8000-000000000092',
      clock_timestamp()
    )$$,
  '42501',
  'permission denied for function deliver_in_app_plan_reminder',
  'authenticated clients cannot deliver in-app reminders'
);
select throws_ok(
  $$insert into public.plan_proposals (
      user_id, source_role_id, source_message_id, intent, scope,
      parsed_payload, missing_fields, confidence
    ) values (
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'memory_source'),
      'create',
      'day',
      '{}'::jsonb,
      '{}'::text[],
      1
    )$$,
  '42501',
  'permission denied for table plan_proposals',
  'authenticated clients cannot directly insert plan proposals'
);
select throws_ok(
  $$update public.plan_proposals
    set status = 'rejected'
    where id = (select id from _test_ids where key = 'plan_proposal_v2')$$,
  '42501',
  'permission denied for table plan_proposals',
  'authenticated clients cannot directly update plan proposals'
);
select throws_ok(
  $$delete from public.plan_proposals
    where id = (select id from _test_ids where key = 'plan_proposal_v2')$$,
  '42501',
  'permission denied for table plan_proposals',
  'authenticated clients cannot directly delete plan proposals'
);
select throws_ok(
  $$insert into public.memory_candidates (
      user_id, role_id, source_message_id, suggested_scope, category,
      content, sensitivity, confidence
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'memory_source'),
      'role_private',
      'agreement',
      '绕过受控抽取写入候选',
      'normal',
      1
    )$$,
  '42501',
  'permission denied for table memory_candidates',
  'authenticated clients cannot directly insert memory candidates'
);
select throws_ok(
  $$insert into public.memories (
      user_id, scope, role_id, category, content, sensitivity
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'role_private',
      (select id from _test_ids where key = 'custom_role'),
      'agreement',
      '绕过受控函数写入正式记忆',
      'normal'
    )$$,
  '42501',
  'permission denied for table memories',
  'authenticated clients cannot directly insert formal memories'
);
select throws_ok(
  $$select public.persist_memory_extraction(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'memory_source'),
      'v0.1',
      'browser-memory-extraction-001',
      '[]'::jsonb
    )$$,
  '42501',
  'permission denied for function persist_memory_extraction',
  'authenticated clients cannot call service-only memory extraction persistence'
);
select throws_ok(
  $$select public.claim_memory_extraction_job(
      (select id from _test_ids where key = 'memory_exact_claim_source'),
      clock_timestamp(),
      300
    )$$,
  '42501',
  'permission denied for function claim_memory_extraction_job',
  'authenticated clients cannot claim an exact extraction job'
);
select throws_ok(
  $$insert into public.emotion_signal_jobs (
      user_id, role_id, source_message_id, idempotency_key
    ) values (
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select user_message_id from _ai_begin_result),
      'browser-emotion-signal-job-001'
    )$$,
  '42501',
  'permission denied for table emotion_signal_jobs',
  'authenticated clients cannot directly enqueue emotion signal work'
);
select throws_ok(
  $$select public.claim_emotion_signal_job(
      '10000000-0000-4000-8000-000000000001',
      clock_timestamp(),
      300
    )$$,
  '42501',
  'permission denied for function claim_emotion_signal_job',
  'authenticated clients cannot claim an exact emotion task'
);
select throws_ok(
  $$select public.complete_emotion_signal_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'succeeded',
      null,
      clock_timestamp()
    )$$,
  '42501',
  'permission denied for function complete_emotion_signal_job',
  'authenticated clients cannot complete emotion work through the service boundary'
);
select throws_ok(
  $$insert into public.plan_extraction_jobs (
      user_id, role_id, source_message_id, idempotency_key
    ) values (
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'plan_create_source'),
      'browser-plan-job-001'
    )$$,
  '42501',
  'permission denied for table plan_extraction_jobs',
  'authenticated clients cannot directly enqueue plan extraction jobs'
);
select throws_ok(
  $$select public.persist_plan_extraction_result(
      '10000000-0000-4000-8000-000000000001',
      (select id from _test_ids where key = 'custom_role'),
      (select id from _test_ids where key = 'plan_create_source'),
      'v0.1',
      'browser-prompt',
      'browser-provider',
      'browser-model',
      'none',
      'none',
      null,
      1,
      null,
      null,
      '{}'::jsonb,
      array[]::text[],
      null,
      null,
      null,
      'browser-plan-result-001'
    )$$,
  '42501',
  'permission denied for function persist_plan_extraction_result',
  'authenticated clients cannot persist plan classifier output'
);
select throws_ok(
  $$select public.claim_plan_extraction_job(
      (select id from _test_ids where key = 'plan_offer_source'),
      clock_timestamp(),
      300
    )$$,
  '42501',
  'permission denied for function claim_plan_extraction_job',
  'authenticated clients cannot claim an exact plan extraction job'
);
select throws_ok(
  $$select public.complete_plan_extraction_job(
      '00000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000098',
      'permanent_failure',
      'invalid_input',
      null,
      clock_timestamp()
    )$$,
  '42501',
  'permission denied for function complete_plan_extraction_job',
  'authenticated clients cannot complete a plan extraction job'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select throws_ok(
  $$select public.switch_current_role(
      (select id from _test_ids where key = 'user_b_role')
    )$$,
  'P0001',
  'role not found',
  'switch_current_role rejects another user role'
);

insert into public.eval_cases (
  case_key,
  capability,
  data_level,
  input_payload,
  expected_output
)
values (
  'database-contract-admin-case',
  'security',
  'L1',
  '{}'::jsonb,
  '{}'::jsonb
);
insert into public.admin_users (user_id, access_level)
values ('20000000-0000-4000-8000-000000000002', 'admin');

with inserted_badcase as (
  insert into public.badcases (
    source_type,
    capability,
    severity,
    diagnosis,
    redacted_excerpt
  )
  values (
    'manual',
    'badcase_review',
    'high',
    'synthetic diagnostic only',
    'synthetic redacted excerpt only'
  )
  returning id
)
insert into _test_ids (key, id)
select 'badcase_review', id
from inserted_badcase;

select has_function(
  'public',
  'update_badcase_review_status',
  array['uuid', 'feedback_status', 'integer', 'timestamp with time zone'],
  'a controlled Badcase review-status function exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_badcase_review_status(uuid,feedback_status,integer,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_table_privilege('authenticated', 'public.badcases', 'INSERT')
  and not has_table_privilege('authenticated', 'public.badcases', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.badcases', 'DELETE'),
  'browser sessions use the controlled Badcase function and cannot directly write Badcases'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (select count(*)::integer
   from public.eval_cases
   where case_key = 'database-contract-admin-case'),
  0,
  'an ordinary user cannot read admin evaluation data'
);
select throws_ok(
  $$insert into public.eval_cases (
      case_key,
      capability,
      data_level,
      input_payload,
      expected_output
    ) values (
      'ordinary-user-write',
      'security',
      'L1',
      '{}'::jsonb,
      '{}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "eval_cases"',
  'an ordinary user cannot directly write admin evaluation data'
);
select is(
  (select count(*)::integer
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase_review')),
  0,
  'an ordinary user cannot read Badcase diagnostics'
);
select throws_ok(
  $$select * from public.update_badcase_review_status(
      (select id from _test_ids where key = 'badcase_review'),
      'triaged',
      0,
      clock_timestamp()
    )$$,
  'P0001',
  'administrator access required',
  'an ordinary user cannot update a Badcase through the controlled function'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer
   from public.eval_cases
   where case_key = 'database-contract-admin-case'),
  1,
  'an active administrator can read evaluation data'
);
select is(
  (select count(*)::integer
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase_review')),
  1,
  'an active administrator can read Badcase diagnostics'
);
create temporary table _badcase_review_version (review_revision integer not null);
insert into _badcase_review_version
select review_revision
from public.update_badcase_review_status(
  (select id from _test_ids where key = 'badcase_review'),
  'triaged',
  (select review_revision from public.badcases where id = (select id from _test_ids where key = 'badcase_review')),
  clock_timestamp()
);
select is(
  (select status::text
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase_review')),
  'triaged',
  'an administrator can triage a Badcase through the controlled function'
);
select ok(
  (select resolved_at is null
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase_review')),
  'triaging a Badcase does not set a resolved timestamp'
);
select throws_ok(
  $$update public.badcases
    set status = 'resolved'
    where id = (select id from _test_ids where key = 'badcase_review')$$,
  '42501',
  'permission denied for table badcases',
  'administrator direct Badcase writes are blocked by table privileges'
);
select is(
  (select status::text
   from public.update_badcase_review_status(
     (select id from _test_ids where key = 'badcase_review'),
     'resolved',
     (select review_revision from _badcase_review_version),
     clock_timestamp()
   )),
  'resolved',
  'resolving a Badcase records the selected controlled status'
);
select ok(
  (select resolved_at is not null
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase_review')),
  'resolving a Badcase records a server-controlled resolved timestamp'
);
select throws_ok(
  $$select * from public.update_badcase_review_status(
      (select id from _test_ids where key = 'badcase_review'),
      'open',
      (select review_revision from _badcase_review_version),
      clock_timestamp()
    )$$,
  'P0001',
  'badcase has changed',
  'a stale administrator review cannot overwrite a newer Badcase status'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
insert into _test_ids (key, id)
select
  'year_parent',
  public.create_manual_plan(
    'year',
    '年度目标',
    null,
    date '2026-01-01',
    date '2026-12-31',
    date '2026-12-31',
    null,
    null,
    'Asia/Shanghai',
    null,
    'year-parent-plan-001'
  );
insert into _test_ids (key, id)
select
  'year_child',
  public.create_manual_plan(
    'year',
    '年度子目标',
    null,
    date '2026-01-01',
    date '2026-12-31',
    date '2026-09-30',
    null,
    null,
    'Asia/Shanghai',
    (select id from _test_ids where key = 'year_parent'),
    'year-child-plan-001'
  );
select is(
  public.create_manual_plan(
    'year',
    '重复提交不会新建',
    null,
    date '2026-01-01',
    date '2026-12-31',
    date '2026-09-30',
    null,
    null,
    'Asia/Shanghai',
    (select id from _test_ids where key = 'year_parent'),
    'year-child-plan-001'
  ),
  (select id from _test_ids where key = 'year_child'),
  'manual annual-plan creation is idempotent'
);
select is(
  (select parent_plan_id
   from public.plans
   where id = (select id from _test_ids where key = 'year_child')),
  (select id from _test_ids where key = 'year_parent'),
  'an annual subgoal retains its validated parent'
);

insert into _test_ids (key, id)
select
  'day_plan',
  public.create_manual_plan(
    'day',
    '带提醒的日计划',
    null,
    current_date,
    current_date,
    current_date,
    now() + interval '2 hours',
    now() + interval '1 hour',
    'Asia/Shanghai',
    null,
    'day-plan-reminder-001'
  );
select is(
  (select count(*)::integer
   from public.notification_jobs
   where plan_id = (select id from _test_ids where key = 'day_plan')
     and status = 'scheduled'),
  1,
  'creating a future reminder schedules exactly one notification job'
);
update public.plans
set reminder_at = now() + interval '30 minutes'
where id = (select id from _test_ids where key = 'day_plan');
select is(
  (select count(*)::integer
   from public.notification_jobs
   where plan_id = (select id from _test_ids where key = 'day_plan')
     and status = 'cancelled'),
  1,
  'changing a reminder cancels the old notification job'
);
select is(
  (select count(*)::integer
   from public.notification_jobs
   where plan_id = (select id from _test_ids where key = 'day_plan')
     and status = 'scheduled'),
  1,
  'changing a reminder schedules one replacement job'
);

insert into _test_ids (key, id)
select 'notification_job', id
from public.notification_jobs
where plan_id = (select id from _test_ids where key = 'day_plan')
  and status = 'scheduled';

insert into _test_ids (key, id)
select
  'notification_other_plan',
  public.create_manual_plan(
    'day',
    '另一条带提醒的日计划',
    null,
    current_date,
    current_date,
    current_date,
    now() + interval '3 hours',
    now() + interval '90 minutes',
    'Asia/Shanghai',
    null,
    'day-plan-reminder-other-001'
  );
insert into _test_ids (key, id)
select 'notification_other_job', id
from public.notification_jobs
where plan_id = (select id from _test_ids where key = 'notification_other_plan')
  and status = 'scheduled';

insert into _test_ids (key, id)
select
  'notification_exhausted_plan',
  public.create_manual_plan(
    'day',
    '达到重试上限的日计划',
    null,
    current_date,
    current_date,
    current_date,
    now() + interval '4 hours',
    now() + interval '2 hours',
    'Asia/Shanghai',
    null,
    'day-plan-reminder-exhausted-001'
  );
insert into _test_ids (key, id)
select 'notification_exhausted_job', id
from public.notification_jobs
where plan_id = (select id from _test_ids where key = 'notification_exhausted_plan')
  and status = 'scheduled';

create temporary table _notification_job_clock (now_at timestamptz not null);
insert into _notification_job_clock
select reminder_at + interval '1 second'
from public.plans
where id = (select id from _test_ids where key = 'day_plan');

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table _claimed_notification_job as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_job'),
  (select now_at from _notification_job_clock),
  300
);
select is(
  (select count(*)::integer from _claimed_notification_job),
  1,
  'an exact due notification job can be claimed once'
);
select ok(
  (select claim_token is not null
      and attempt_no = 1
      and lease_expires_at = (
        select now_at + interval '300 seconds' from _notification_job_clock
      )
   from _claimed_notification_job),
  'a notification claim returns its token, attempt, and bounded lease'
);
select is(
  (select status::text
   from public.notification_jobs
   where id = (select id from _test_ids where key = 'notification_other_job')),
  'scheduled',
  'claiming one exact notification job does not mutate another job'
);

insert into _test_ids (key, id)
select
  'in_app_notification',
  public.deliver_in_app_plan_reminder(
    (select job_id from _claimed_notification_job),
    (select claim_token from _claimed_notification_job),
    (select now_at from _notification_job_clock)
  );
select is(
  public.deliver_in_app_plan_reminder(
    (select job_id from _claimed_notification_job),
    (select claim_token from _claimed_notification_job),
    (select now_at from _notification_job_clock)
  ),
  (select id from _test_ids where key = 'in_app_notification'),
  'repeating delivery under the same claim returns the original reminder'
);
select is(
  (select count(*)::integer
   from public.in_app_notifications
   where notification_job_id = (
     select id from _test_ids where key = 'notification_job'
   )),
  1,
  'idempotent application delivery creates exactly one inbox item'
);

create temporary table _reclaimed_notification_job as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_job'),
  (select now_at + interval '301 seconds' from _notification_job_clock),
  300
);
select ok(
  (select attempt_no = 2
      and claim_token <> (select claim_token from _claimed_notification_job)
   from _reclaimed_notification_job),
  'an expired notification lease can be reclaimed with a new token'
);
select throws_ok(
  $$select public.deliver_in_app_plan_reminder(
      (select job_id from _claimed_notification_job),
      (select claim_token from _claimed_notification_job),
      (select now_at + interval '301 seconds' from _notification_job_clock)
    )$$,
  'P0001',
  'in-app reminder claim is stale',
  'an old notification token cannot deliver after the job is reclaimed'
);
select throws_ok(
  $$select public.complete_notification_job(
      (select job_id from _reclaimed_notification_job),
      '00000000-0000-4000-8000-000000000099',
      'succeeded',
      null,
      (select now_at + interval '302 seconds' from _notification_job_clock)
    )$$,
  'P0001',
  'notification job claim is stale',
  'an incorrect notification token cannot complete the job'
);
select is(
  public.deliver_in_app_plan_reminder(
    (select job_id from _reclaimed_notification_job),
    (select claim_token from _reclaimed_notification_job),
    (select now_at + interval '302 seconds' from _notification_job_clock)
  ),
  (select id from _test_ids where key = 'in_app_notification'),
  'delivery after crash recovery still returns the original inbox item'
);
select is(
  public.complete_notification_job(
    (select job_id from _reclaimed_notification_job),
    (select claim_token from _reclaimed_notification_job),
    'succeeded',
    null,
    (select now_at + interval '302 seconds' from _notification_job_clock)
  ) ->> 'status',
  'succeeded',
  'the current notification token can complete a delivered job'
);
select ok(
  (select status = 'succeeded'
      and claim_token is null
      and lease_expires_at is null
   from public.notification_jobs
   where id = (select id from _test_ids where key = 'notification_job')),
  'a completed notification job clears its lease state'
);

create temporary table _notification_other_clock (now_at timestamptz not null);
insert into _notification_other_clock
select reminder_at + interval '1 second'
from public.plans
where id = (select id from _test_ids where key = 'notification_other_plan');
create temporary table _claimed_notification_other_job as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_other_job'),
  (select now_at from _notification_other_clock),
  300
);
select is(
  public.complete_notification_job(
    (select job_id from _claimed_notification_other_job),
    (select claim_token from _claimed_notification_other_job),
    'retryable_failure',
    'delivery_unavailable',
    (select now_at from _notification_other_clock)
  ) ->> 'status',
  'scheduled',
  'a retryable notification failure returns to the schedule'
);
select is(
  (select available_at
   from public.notification_jobs
   where id = (select id from _test_ids where key = 'notification_other_job')),
  (select now_at + interval '30 seconds' from _notification_other_clock),
  'the first notification retry uses the bounded backoff time'
);
create temporary table _reclaimed_notification_other_job as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_other_job'),
  (select now_at + interval '31 seconds' from _notification_other_clock),
  300
);
select is(
  (select attempt_no from _reclaimed_notification_other_job),
  2,
  'a notification job can be reclaimed after its retry backoff'
);

create temporary table _notification_exhausted_clock (now_at timestamptz not null);
insert into _notification_exhausted_clock
select reminder_at + interval '1 second'
from public.plans
where id = (select id from _test_ids where key = 'notification_exhausted_plan');
create temporary table _notification_exhausted_claim_1 as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_exhausted_job'),
  (select now_at from _notification_exhausted_clock),
  300
);
select is(
  public.complete_notification_job(
    (select job_id from _notification_exhausted_claim_1),
    (select claim_token from _notification_exhausted_claim_1),
    'retryable_failure',
    'delivery_unavailable',
    (select now_at from _notification_exhausted_clock)
  ) ->> 'status',
  'scheduled',
  'the first unavailable attempt remains retryable'
);
create temporary table _notification_exhausted_claim_2 as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_exhausted_job'),
  (select now_at + interval '31 seconds' from _notification_exhausted_clock),
  300
);
select is(
  public.complete_notification_job(
    (select job_id from _notification_exhausted_claim_2),
    (select claim_token from _notification_exhausted_claim_2),
    'retryable_failure',
    'delivery_unavailable',
    (select now_at + interval '31 seconds' from _notification_exhausted_clock)
  ) ->> 'status',
  'scheduled',
  'the second unavailable attempt remains retryable'
);
create temporary table _notification_exhausted_claim_3 as
select *
from public.claim_due_notification_job(
  (select id from _test_ids where key = 'notification_exhausted_job'),
  (select now_at + interval '92 seconds' from _notification_exhausted_clock),
  300
);
select is(
  public.complete_notification_job(
    (select job_id from _notification_exhausted_claim_3),
    (select claim_token from _notification_exhausted_claim_3),
    'retryable_failure',
    'delivery_unavailable',
    (select now_at + interval '92 seconds' from _notification_exhausted_clock)
  ) ->> 'status',
  'failed',
  'a notification job fails closed after reaching its retry limit'
);
select is(
  (select count(*)::integer
   from public.claim_due_notification_job(
     (select id from _test_ids where key = 'notification_exhausted_job'),
     (select now_at + interval '10 minutes' from _notification_exhausted_clock),
     300
   )),
  0,
  'a failed exhausted notification job cannot be claimed again'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (select count(*)::integer
   from public.in_app_notifications
   where id = (select id from _test_ids where key = 'in_app_notification')),
  1,
  'user A can read their own in-app reminder'
);
select is(
  public.mark_in_app_notification_read(
    (select id from _test_ids where key = 'in_app_notification'),
    true,
    clock_timestamp()
  ),
  (select id from _test_ids where key = 'in_app_notification'),
  'user A can mark their own in-app reminder as read'
);
select ok(
  (select read_at is not null
   from public.in_app_notifications
   where id = (select id from _test_ids where key = 'in_app_notification')),
  'marking a reminder read stores a safe read timestamp'
);
select is(
  public.mark_in_app_notification_read(
    (select id from _test_ids where key = 'in_app_notification'),
    false,
    clock_timestamp()
  ),
  (select id from _test_ids where key = 'in_app_notification'),
  'user A can mark their own in-app reminder as unread'
);
select ok(
  (select read_at is null
   from public.in_app_notifications
   where id = (select id from _test_ids where key = 'in_app_notification')),
  'marking a reminder unread clears only its read timestamp'
);
select throws_ok(
  $$update public.in_app_notifications
    set read_at = null
    where id = (select id from _test_ids where key = 'in_app_notification')$$,
  '42501',
  'permission denied for table in_app_notifications',
  'authenticated clients cannot directly update in-app reminders'
);
select throws_ok(
  $$delete from public.in_app_notifications
    where id = (select id from _test_ids where key = 'in_app_notification')$$,
  '42501',
  'permission denied for table in_app_notifications',
  'authenticated clients cannot directly delete in-app reminders'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer
   from public.in_app_notifications
   where id = (select id from _test_ids where key = 'in_app_notification')),
  0,
  'user B cannot read user A in-app reminder'
);
select throws_ok(
  $$select public.mark_in_app_notification_read(
      (select id from _test_ids where key = 'in_app_notification'),
      true,
      clock_timestamp()
    )$$,
  'P0001',
  'in-app notification not found',
  'user B cannot change user A reminder read state'
);
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
update public.plans
set reminder_at = now() + interval '20 minutes'
where id = (select id from _test_ids where key = 'notification_other_plan');
select ok(
  (select status = 'cancelled'
      and claim_token is null
      and lease_expires_at is null
   from public.notification_jobs
   where id = (select id from _test_ids where key = 'notification_other_job')),
  'changing a reminder cancels a running old job and clears its lease'
);
select is(
  (select count(*)::integer
   from public.notification_jobs
   where plan_id = (select id from _test_ids where key = 'notification_other_plan')
     and status = 'scheduled'),
  1,
  'changing a running reminder schedules exactly one replacement job'
);
select is(
  (select count(*)::integer
   from public.notification_jobs
   where plan_id = (select id from _test_ids where key = 'year_parent')),
  0,
  'annual plans never create reminder jobs'
);

delete from public.plans
where id = (select id from _test_ids where key = 'day_plan');
select is(
  (select count(*)::integer
   from public.in_app_notifications
   where id = (select id from _test_ids where key = 'in_app_notification')),
  0,
  'deleting a plan cascades through its application reminders'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $$select public.create_manual_plan(
      'year',
      '跨用户子目标',
      null,
      date '2026-01-01',
      date '2026-12-31',
      date '2026-12-31',
      null,
      null,
      'Asia/Shanghai',
      (select id from _test_ids where key = 'year_parent'),
      'cross-user-year-child-001'
    )$$,
  'P0001',
  'annual parent goal must belong to the current user and year',
  'an annual subgoal cannot attach to another user parent'
);

with inserted_badcase as (
  insert into public.badcases (
    user_id,
    source_type,
    capability,
    severity,
    diagnosis,
    redacted_excerpt
  )
  values (
    '20000000-0000-4000-8000-000000000002',
    'manual',
    'privacy',
    'low',
    'account-deletion contract record',
    'synthetic-only excerpt'
  )
  returning id
)
insert into _test_ids (key, id)
select 'badcase', id
from inserted_badcase;

delete from auth.users
where id = '20000000-0000-4000-8000-000000000002';
select is(
  (
    (select count(*) from public.profiles
     where id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.roles
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.persona_versions
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.conversations
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.messages
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.memories
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.plan_proposals
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.plan_extraction_runs
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.plan_extraction_jobs
       where user_id = '20000000-0000-4000-8000-000000000002')
    + (select count(*) from public.emotion_signal_jobs
       where user_id = '20000000-0000-4000-8000-000000000002')
  )::integer,
  0,
  'deleting an account cascades through profile, role, chat, memory, and plan extraction data'
);
select is(
  (select count(*)::integer
   from public.badcases
   where id = (select id from _test_ids where key = 'badcase')),
  0,
  'deleting an account removes its potentially personal badcase excerpts'
);
select is(
  (select count(*)::integer
   from public.profiles
   where id = '10000000-0000-4000-8000-000000000001'),
  1,
  'deleting one account does not remove another account profile'
);

select * from finish();

rollback;
