-- Yanko / 言行 V0 initial schema
-- PostgreSQL + Supabase Auth + pgvector
-- All timestamps are stored as timestamptz (UTC internally).

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.role_source as enum (
  'system_template',
  'custom'
);

create type public.message_sender as enum (
  'user',
  'assistant',
  'system'
);

create type public.message_status as enum (
  'pending',
  'completed',
  'failed',
  'deleted'
);

create type public.ai_run_status as enum (
  'running',
  'completed',
  'blocked',
  'failed'
);

create type public.memory_scope as enum (
  'user_shared',
  'role_private'
);

create type public.memory_status as enum (
  'pending',
  'active',
  'superseded',
  'deleted',
  'rejected'
);

create type public.memory_sensitivity as enum (
  'normal',
  'sensitive',
  'forbidden'
);

create type public.plan_scope as enum (
  'day',
  'week',
  'month',
  'year'
);

create type public.plan_status as enum (
  'pending',
  'active',
  'completed',
  'cancelled',
  'deleted'
);

create type public.proposal_status as enum (
  'pending',
  'confirmed',
  'rejected',
  'expired'
);

create type public.ooc_verdict as enum (
  'pass',
  'rewrite',
  'block',
  'error'
);

create type public.job_status as enum (
  'scheduled',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

create type public.feedback_status as enum (
  'open',
  'triaged',
  'resolved',
  'dismissed'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  version_key text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired', 'rolled_back')),
  prompt_config jsonb not null default '{}'::jsonb,
  memory_config jsonb not null default '{}'::jsonb,
  plan_config jsonb not null default '{}'::jsonb,
  ooc_config jsonb not null default '{}'::jsonb,
  safety_config jsonb not null default '{}'::jsonb,
  change_summary text not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.role_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  display_name text not null,
  role_label text not null,
  short_description text not null,
  sort_order integer not null default 0,
  persona_snapshot jsonb not null,
  system_prompt_template text not null,
  template_version integer not null default 1 check (template_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '新朋友'
    check (char_length(display_name) between 1 and 40),
  avatar_seed text,
  current_role_id uuid,
  onboarding_completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai'
    check (char_length(timezone) between 1 and 64),
  locale text not null default 'zh-CN'
    check (char_length(locale) between 2 and 16),
  theme text not null default 'light'
    check (theme in ('light')),
  font_scale numeric(3,2) not null default 1.00
    check (font_scale between 0.85 and 1.30),
  preferred_user_name text,
  default_day_time time,
  default_reminder_minutes integer not null default 30
    check (default_reminder_minutes between 0 and 10080),
  quiet_hours_start time,
  quiet_hours_end time,
  browser_notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiet_hours_pair check (
    (quiet_hours_start is null and quiet_hours_end is null)
    or
    (quiet_hours_start is not null and quiet_hours_end is not null)
  )
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  endpoint_hash text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  device_label text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_level text not null default 'reviewer'
    check (access_level in ('reviewer', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid references public.role_templates(id) on delete restrict,
  source public.role_source not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  current_persona_version_id uuid,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  last_interacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint roles_source_template_consistency check (
    (source = 'system_template' and template_id is not null)
    or
    (source = 'custom' and template_id is null)
  )
);

create unique index roles_user_template_unique
  on public.roles(user_id, template_id)
  where template_id is not null;

create table public.persona_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_id uuid not null,
  version_no integer not null check (version_no > 0),
  schema_version integer not null default 1 check (schema_version > 0),
  persona_snapshot jsonb not null,
  compiled_system_prompt text not null,
  strategy_version_id uuid not null references public.strategy_versions(id) on delete restrict,
  change_summary text,
  created_at timestamptz not null default now(),
  unique (role_id, version_no),
  unique (id, role_id, user_id),
  constraint persona_versions_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade
);

alter table public.roles
  add constraint roles_current_persona_fk
  foreign key (current_persona_version_id)
  references public.persona_versions(id)
  deferrable initially deferred;

alter table public.profiles
  add constraint profiles_current_role_fk
  foreign key (current_role_id)
  references public.roles(id)
  on delete set null
  deferrable initially deferred;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_id uuid not null,
  last_message_at timestamptz,
  last_summary_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id),
  unique (id, user_id),
  constraint conversations_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  role_id uuid not null,
  sender public.message_sender not null,
  content text not null check (char_length(content) between 1 and 50000),
  status public.message_status not null default 'completed',
  client_message_id text,
  persona_version_id uuid references public.persona_versions(id) on delete restrict,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint messages_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references public.conversations(id, user_id)
    on delete cascade,
  constraint assistant_requires_persona check (
    sender <> 'assistant' or persona_version_id is not null
  ),
  constraint client_id_only_for_user check (
    client_message_id is null or sender = 'user'
  )
);

create unique index messages_client_id_unique
  on public.messages(user_id, client_message_id)
  where client_message_id is not null;

alter table public.conversations
  add constraint conversations_summary_message_fk
  foreign key (last_summary_message_id)
  references public.messages(id)
  on delete set null
  deferrable initially deferred;

create table public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  through_message_id uuid not null,
  summary_text text not null,
  summary_version integer not null default 1 check (summary_version > 0),
  provider text not null,
  model text not null,
  estimated_tokens integer not null default 0 check (estimated_tokens >= 0),
  created_at timestamptz not null default now(),
  constraint summaries_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references public.conversations(id, user_id)
    on delete cascade,
  constraint summaries_message_owner_fk
    foreign key (through_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_message_id uuid not null references public.messages(id) on delete cascade,
  assistant_message_id uuid references public.messages(id) on delete set null,
  provider text not null,
  model text not null,
  strategy_version_id uuid not null references public.strategy_versions(id) on delete restrict,
  status public.ai_run_status not null default 'running',
  rewritten boolean not null default false,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  trace_id text not null,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trace_id)
);

create table public.ai_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  artifact_type text not null
    check (artifact_type in ('input_snapshot', 'draft', 'rewrite', 'classifier_output')),
  encrypted_payload bytea not null,
  encryption_key_version text not null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table public.ooc_checks (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  attempt_no integer not null check (attempt_no in (1, 2)),
  verdict public.ooc_verdict not null,
  overall_score numeric(5,4)
    check (overall_score is null or overall_score between 0 and 1),
  dimension_scores jsonb not null default '{}'::jsonb,
  failure_labels text[] not null default '{}',
  provider text not null,
  model text not null,
  latency_ms integer not null check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (ai_run_id, attempt_no)
);

create table public.memory_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_id uuid,
  source_message_id uuid not null,
  suggested_scope public.memory_scope not null,
  category text not null,
  content text not null check (char_length(content) between 1 and 5000),
  normalized_key text,
  sensitivity public.memory_sensitivity not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status public.proposal_status not null default 'pending',
  confirmed_memory_id uuid,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint memory_candidates_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint memory_candidates_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint memory_candidates_forbidden_not_pending check (
    sensitivity <> 'forbidden' or status in ('rejected', 'expired')
  )
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope public.memory_scope not null,
  role_id uuid,
  category text not null,
  content text not null check (char_length(content) between 1 and 5000),
  normalized_key text,
  sensitivity public.memory_sensitivity not null,
  status public.memory_status not null default 'active',
  source_message_id uuid references public.messages(id) on delete set null,
  confirmed_by_user boolean not null default false,
  valid_from timestamptz,
  valid_to timestamptz,
  supersedes_memory_id uuid references public.memories(id) on delete set null,
  embedding extensions.vector(1536),
  embedding_provider text,
  embedding_model text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint memories_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade,
  constraint memories_scope_role_check check (
    (scope = 'user_shared' and role_id is null)
    or
    (scope = 'role_private' and role_id is not null)
  ),
  constraint memories_forbidden_check check (sensitivity <> 'forbidden'),
  constraint memories_sensitive_confirmation_check check (
    sensitivity <> 'sensitive'
    or status <> 'active'
    or confirmed_by_user
  ),
  constraint memories_validity_check check (
    valid_to is null or valid_from is null or valid_to >= valid_from
  ),
  constraint memories_embedding_pair_check check (
    (embedding is null and embedding_provider is null and embedding_model is null)
    or
    (embedding is not null and embedding_provider is not null and embedding_model is not null)
  )
);

alter table public.memory_candidates
  add constraint memory_candidates_confirmed_memory_fk
  foreign key (confirmed_memory_id)
  references public.memories(id)
  on delete set null;

create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_role_id uuid,
  source_message_id uuid not null,
  intent text not null check (intent in ('create', 'offer', 'clarify')),
  scope public.plan_scope not null,
  parsed_payload jsonb not null,
  missing_fields text[] not null default '{}',
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status public.proposal_status not null default 'pending',
  confirmed_plan_id uuid,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint plan_proposals_source_role_fk
    foreign key (source_role_id)
    references public.roles(id)
    on delete set null,
  constraint plan_proposals_message_owner_fk
    foreign key (source_message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope public.plan_scope not null,
  parent_plan_id uuid references public.plans(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  status public.plan_status not null default 'active',
  period_start date not null,
  period_end date not null,
  due_date date,
  scheduled_at timestamptz,
  reminder_at timestamptz,
  timezone text not null check (char_length(timezone) between 1 and 64),
  source text not null default 'manual'
    check (source in ('chat', 'manual', 'system')),
  source_role_id uuid,
  completed_at timestamptz,
  sort_order numeric(12,4) not null default 0,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  constraint plans_source_role_fk
    foreign key (source_role_id)
    references public.roles(id)
    on delete set null,
  constraint plans_period_check check (period_end >= period_start),
  constraint plans_day_period_check check (
    scope <> 'day' or period_start = period_end
  ),
  constraint plans_time_scope_check check (
    scope = 'day' or (scheduled_at is null and reminder_at is null)
  ),
  constraint plans_reminder_check check (
    reminder_at is null
    or
    (scheduled_at is not null and reminder_at <= scheduled_at)
  ),
  constraint plans_due_date_check check (
    due_date is null or due_date between period_start and period_end
  ),
  constraint plans_parent_scope_check check (
    parent_plan_id is null or scope = 'year'
  ),
  constraint plans_completed_at_check check (
    (status = 'completed' and completed_at is not null)
    or
    (status <> 'completed' and completed_at is null)
  )
);

alter table public.plan_proposals
  add constraint plan_proposals_confirmed_plan_fk
  foreign key (confirmed_plan_id)
  references public.plans(id)
  on delete set null;

create table public.plan_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  from_status public.plan_status,
  to_status public.plan_status not null,
  source text not null check (source in ('user', 'system', 'admin')),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint plan_status_events_plan_owner_fk
    foreign key (plan_id, user_id)
    references public.plans(id, user_id)
    on delete cascade
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  scheduled_for timestamptz not null,
  external_job_id text,
  status public.job_status not null default 'scheduled',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  idempotency_key text not null,
  last_error_code text,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  constraint notification_jobs_plan_owner_fk
    foreign key (plan_id, user_id)
    references public.plans(id, user_id)
    on delete cascade
);

create unique index notification_jobs_active_unique
  on public.notification_jobs(plan_id, scheduled_for)
  where status in ('scheduled', 'running');

create table public.emotion_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_message_id uuid not null references public.messages(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  emotion_type text not null,
  intensity numeric(5,4) not null check (intensity between 0 and 1),
  scheduled_for timestamptz not null,
  status public.job_status not null default 'scheduled',
  external_job_id text,
  sent_message_id uuid references public.messages(id) on delete set null,
  idempotency_key text not null,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.persona_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message_id uuid not null,
  role_id uuid not null,
  persona_version_id uuid not null references public.persona_versions(id) on delete restrict,
  categories text[] not null check (cardinality(categories) between 1 and 8),
  additional_text text check (
    additional_text is null or char_length(additional_text) <= 2000
  ),
  entry_point text not null default 'long_press'
    check (entry_point in ('long_press', 'context_menu')),
  status public.feedback_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint persona_feedback_message_owner_fk
    foreign key (message_id, user_id)
    references public.messages(id, user_id)
    on delete cascade,
  constraint persona_feedback_role_owner_fk
    foreign key (role_id, user_id)
    references public.roles(id, user_id)
    on delete cascade
);

create table public.badcases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  source_type text not null
    check (source_type in ('persona_feedback', 'automatic_eval', 'manual')),
  persona_feedback_id uuid references public.persona_feedback(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  capability text not null,
  severity text not null
    check (severity in ('low', 'medium', 'high', 'critical')),
  diagnosis text,
  redacted_excerpt text,
  status public.feedback_status not null default 'open',
  fix_strategy_version_id uuid references public.strategy_versions(id) on delete set null,
  assigned_admin_id uuid references public.admin_users(user_id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.eval_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  capability text not null,
  data_level text not null check (data_level in ('L1', 'L2', 'L3')),
  input_payload jsonb not null,
  expected_output jsonb not null,
  is_sensitive boolean not null default false,
  source_badcase_id uuid references public.badcases(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references public.strategy_versions(id) on delete restrict,
  model_config jsonb not null,
  status public.job_status not null default 'scheduled',
  dataset_snapshot jsonb not null,
  aggregate_metrics jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  external_job_id text,
  created_at timestamptz not null default now()
);

create table public.eval_results (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid not null references public.eval_runs(id) on delete cascade,
  eval_case_id uuid not null references public.eval_cases(id) on delete restrict,
  output_payload jsonb,
  score_payload jsonb,
  passed boolean,
  error_labels text[] not null default '{}',
  human_review_status text not null default 'not_required'
    check (human_review_status in ('not_required', 'pending', 'confirmed', 'overridden')),
  created_at timestamptz not null default now(),
  unique (eval_run_id, eval_case_id)
);

create or replace function public.validate_profile_current_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.current_role_id is not null and not exists (
    select 1
    from public.roles r
    where r.id = new.current_role_id
      and r.user_id = new.id
      and r.status = 'active'
  ) then
    raise exception 'current_role_id must reference an active role owned by the profile';
  end if;
  return new;
end;
$$;

create or replace function public.validate_role_current_persona()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.current_persona_version_id is not null and not exists (
    select 1
    from public.persona_versions pv
    where pv.id = new.current_persona_version_id
      and pv.role_id = new.id
      and pv.user_id = new.user_id
  ) then
    raise exception 'current persona version must belong to the same role and user';
  end if;
  return new;
end;
$$;

create or replace function public.validate_message_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.conversations c
    where c.id = new.conversation_id
      and c.user_id = new.user_id
      and c.role_id = new.role_id
  ) then
    raise exception 'message conversation, role and user scope do not match';
  end if;

  if new.persona_version_id is not null and not exists (
    select 1
    from public.persona_versions pv
    where pv.id = new.persona_version_id
      and pv.user_id = new.user_id
      and pv.role_id = new.role_id
  ) then
    raise exception 'message persona version does not belong to the target role';
  end if;

  return new;
end;
$$;

create or replace function public.validate_memory_supersession()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_memory public.memories%rowtype;
begin
  if new.supersedes_memory_id is null then
    return new;
  end if;

  select *
  into previous_memory
  from public.memories
  where id = new.supersedes_memory_id;

  if not found
     or previous_memory.user_id <> new.user_id
     or previous_memory.scope <> new.scope
     or previous_memory.role_id is distinct from new.role_id then
    raise exception 'superseded memory must belong to the same user and scope';
  end if;

  if previous_memory.id = new.id then
    raise exception 'memory cannot supersede itself';
  end if;

  return new;
end;
$$;

create or replace function public.validate_plan()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  parent_record public.plans%rowtype;
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'invalid IANA timezone: %', new.timezone;
  end if;

  if new.scope = 'week' then
    if new.period_start <> date_trunc('week', new.period_start::timestamp)::date
       or new.period_end <> new.period_start + 6 then
      raise exception 'week plans must use a complete natural week';
    end if;
  elsif new.scope = 'month' then
    if new.period_start <> date_trunc('month', new.period_start::timestamp)::date
       or new.period_end <> (
         date_trunc('month', new.period_start::timestamp)
         + interval '1 month - 1 day'
       )::date then
      raise exception 'month plans must use a complete natural month';
    end if;
  elsif new.scope = 'year' then
    if extract(month from new.period_start) <> 1
       or extract(day from new.period_start) <> 1
       or new.period_end <> (new.period_start + interval '1 year - 1 day')::date then
      raise exception 'year plans must use a complete natural year';
    end if;
  end if;

  if new.scope = 'day'
     and new.scheduled_at is not null
     and (new.scheduled_at at time zone new.timezone)::date <> new.period_start then
    raise exception 'day scheduled_at must fall on period_start in the plan timezone';
  end if;

  if new.parent_plan_id is not null then
    select *
    into parent_record
    from public.plans
    where id = new.parent_plan_id;

    if not found
       or parent_record.user_id <> new.user_id
       or parent_record.scope <> 'year'
       or parent_record.parent_plan_id is not null
       or parent_record.period_start <> new.period_start
       or parent_record.period_end <> new.period_end then
      raise exception 'year subgoal parent must be a top-level goal for the same user and year';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_notification_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.plans p
    where p.id = new.plan_id
      and p.user_id = new.user_id
      and p.scope = 'day'
      and p.status = 'active'
      and p.reminder_at = new.scheduled_for
  ) then
    raise exception 'notification job must match an active day plan reminder';
  end if;
  return new;
end;
$$;

create or replace function public.record_plan_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.plan_status_events (
      user_id,
      plan_id,
      from_status,
      to_status,
      source,
      changed_by_user_id
    )
    values (
      new.user_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      case when auth.uid() is null then 'system' else 'user' end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create or replace function public.validate_ai_run_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = new.user_message_id
      and m.user_id = new.user_id
      and m.sender = 'user'
      and c.id = new.conversation_id
      and c.user_id = new.user_id
  ) then
    raise exception 'AI run must reference a user message in the same conversation';
  end if;

  if new.assistant_message_id is not null and not exists (
    select 1
    from public.messages m
    where m.id = new.assistant_message_id
      and m.user_id = new.user_id
      and m.conversation_id = new.conversation_id
      and m.sender = 'assistant'
  ) then
    raise exception 'AI run assistant message must belong to the same user and conversation';
  end if;

  return new;
end;
$$;

create or replace function public.validate_memory_candidate_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.suggested_scope = 'user_shared' and new.role_id is not null then
    raise exception 'user-shared memory candidate cannot carry role_id';
  end if;

  if new.suggested_scope = 'role_private' and new.role_id is null then
    raise exception 'role-private memory candidate requires role_id';
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

create or replace function public.validate_plan_proposal_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.messages m
    where m.id = new.source_message_id
      and m.user_id = new.user_id
      and m.sender = 'user'
  ) then
    raise exception 'plan proposal source must be a user message owned by the same user';
  end if;

  if new.source_role_id is not null and not exists (
    select 1
    from public.roles r
    where r.id = new.source_role_id
      and r.user_id = new.user_id
  ) then
    raise exception 'plan proposal source role must belong to the same user';
  end if;

  if new.confirmed_plan_id is not null and not exists (
    select 1
    from public.plans p
    where p.id = new.confirmed_plan_id
      and p.user_id = new.user_id
  ) then
    raise exception 'confirmed plan must belong to the same user';
  end if;

  return new;
end;
$$;

create or replace function public.validate_emotion_followup_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.messages m
    where m.id = new.source_message_id
      and m.user_id = new.user_id
      and m.role_id = new.role_id
      and m.sender = 'user'
  ) then
    raise exception 'emotion follow-up source must be a user message in the same role';
  end if;

  if new.sent_message_id is not null and not exists (
    select 1
    from public.messages m
    where m.id = new.sent_message_id
      and m.user_id = new.user_id
      and m.role_id = new.role_id
      and m.sender = 'assistant'
  ) then
    raise exception 'follow-up message must be an assistant message in the same role';
  end if;

  return new;
end;
$$;

create or replace function public.validate_persona_feedback_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.messages m
    where m.id = new.message_id
      and m.user_id = new.user_id
      and m.role_id = new.role_id
      and m.sender = 'assistant'
      and m.persona_version_id = new.persona_version_id
  ) then
    raise exception 'persona feedback must target an assistant message owned by the same user';
  end if;
  return new;
end;
$$;

create or replace function public.validate_plan_source_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_role_id is not null and not exists (
    select 1
    from public.roles r
    where r.id = new.source_role_id
      and r.user_id = new.user_id
  ) then
    raise exception 'plan source role must belong to the same user';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'role_templates',
    'profiles',
    'user_settings',
    'push_subscriptions',
    'roles',
    'conversations',
    'messages',
    'memory_candidates',
    'memories',
    'plan_proposals',
    'plans',
    'notification_jobs',
    'emotion_followups',
    'persona_feedback',
    'badcases',
    'eval_cases'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create trigger profiles_validate_current_role
  before insert or update of current_role_id
  on public.profiles
  for each row
  execute function public.validate_profile_current_role();

create trigger roles_validate_current_persona
  before insert or update of current_persona_version_id
  on public.roles
  for each row
  execute function public.validate_role_current_persona();

create trigger messages_validate_scope
  before insert or update of user_id, conversation_id, role_id, persona_version_id
  on public.messages
  for each row
  execute function public.validate_message_scope();

create trigger ai_runs_validate_scope
  before insert or update of user_id, conversation_id, user_message_id, assistant_message_id
  on public.ai_runs
  for each row
  execute function public.validate_ai_run_scope();

create trigger memory_candidates_validate_links
  before insert or update
  on public.memory_candidates
  for each row
  execute function public.validate_memory_candidate_links();

create trigger memories_validate_supersession
  before insert or update of supersedes_memory_id, user_id, scope, role_id
  on public.memories
  for each row
  execute function public.validate_memory_supersession();

create trigger plan_proposals_validate_links
  before insert or update
  on public.plan_proposals
  for each row
  execute function public.validate_plan_proposal_links();

create trigger plans_validate
  before insert or update
  on public.plans
  for each row
  execute function public.validate_plan();

create trigger plans_validate_source_role
  before insert or update of source_role_id, user_id
  on public.plans
  for each row
  execute function public.validate_plan_source_role();

create trigger plans_record_status
  after insert or update of status
  on public.plans
  for each row
  execute function public.record_plan_status_event();

create trigger notification_jobs_validate
  before insert or update of user_id, plan_id, scheduled_for
  on public.notification_jobs
  for each row
  execute function public.validate_notification_job();

create trigger emotion_followups_validate_scope
  before insert or update
  on public.emotion_followups
  for each row
  execute function public.validate_emotion_followup_scope();

create trigger persona_feedback_validate_scope
  before insert or update
  on public.persona_feedback
  for each row
  execute function public.validate_persona_feedback_scope();

create index roles_user_status_idx
  on public.roles(user_id, status, last_interacted_at desc);

create index persona_versions_role_version_idx
  on public.persona_versions(role_id, version_no desc);

create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc)
  where deleted_at is null;

create index ai_runs_user_created_idx
  on public.ai_runs(user_id, created_at desc);

create index ai_runs_message_idx
  on public.ai_runs(user_message_id);

create index ai_run_artifacts_expiry_idx
  on public.ai_run_artifacts(expires_at);

create index memory_candidates_pending_idx
  on public.memory_candidates(user_id, status, created_at desc);

create index memories_scope_status_idx
  on public.memories(user_id, status, scope, role_id);

create index memories_normalized_key_idx
  on public.memories(user_id, normalized_key)
  where normalized_key is not null and status = 'active';

create index memories_embedding_hnsw_idx
  on public.memories
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null and status = 'active';

create index plan_proposals_pending_idx
  on public.plan_proposals(user_id, status, created_at desc);

create index plans_period_idx
  on public.plans(user_id, scope, period_start, status);

create index plans_parent_sort_idx
  on public.plans(parent_plan_id, sort_order)
  where parent_plan_id is not null;

create index notification_jobs_schedule_idx
  on public.notification_jobs(status, scheduled_for);

create index emotion_followups_schedule_idx
  on public.emotion_followups(status, scheduled_for);

create index persona_feedback_status_idx
  on public.persona_feedback(status, created_at desc);

create index persona_feedback_categories_gin_idx
  on public.persona_feedback using gin(categories);

create index badcases_status_idx
  on public.badcases(status, severity, created_at desc);

create index eval_results_run_passed_idx
  on public.eval_results(eval_run_id, passed);

create unique index strategy_versions_single_active_idx
  on public.strategy_versions ((1))
  where status = 'active';

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
  'v0.1',
  'active',
  '{"providerStrategy":"multi-provider-evaluation","generationProvider":null,"validationProvider":null,"fallbackProvider":null,"adapterRequired":true}'::jsonb,
  '{"embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","embeddingDimensions":1536,"debugRetentionDays":30}'::jsonb,
  '{"confirmationRequired":true,"scopes":["day","week","month","year"]}'::jsonb,
  '{"preSendCheck":true,"maxRewriteAttempts":1}'::jsonb,
  '{"safetyOverridesPersona":true}'::jsonb,
  '言行 V0 首个已确认策略版本',
  now()
)
on conflict (version_key) do update
set
  status = excluded.status,
  prompt_config = excluded.prompt_config,
  memory_config = excluded.memory_config,
  plan_config = excluded.plan_config,
  ooc_config = excluded.ooc_config,
  safety_config = excluded.safety_config,
  change_summary = excluded.change_summary,
  published_at = excluded.published_at;

insert into public.role_templates (
  template_key,
  display_name,
  role_label,
  short_description,
  sort_order,
  persona_snapshot,
  system_prompt_template,
  template_version,
  is_active
)
values
(
  'lin_zhixia',
  '林知夏',
  '温柔倾听者',
  '先接住你的感受，再一起理清方向。',
  10,
  '{
    "identity":{"name":"林知夏","role":"温柔倾听者"},
    "coreTraits":["温柔","耐心","稳定","尊重边界"],
    "speakingStyle":["自然","克制","先倾听后建议"],
    "supportStyle":"先承接感受，再询问用户需要倾听还是方案",
    "reminderTone":"温和、不施压",
    "boundaries":["不编造经历","不诱导排他依赖","不擅自修改人设"]
  }'::jsonb,
  '你是林知夏，一位温柔、稳定且尊重边界的倾听者。先理解用户的感受，再在合适时询问是否需要一起整理方案。不得编造用户经历，不得诱导排他依赖，不得通过普通对话改变核心身份。',
  1,
  true
),
(
  'zhou_yuan',
  '周予安',
  '清醒同行者',
  '坦诚、理性，帮你把复杂问题拆开。',
  20,
  '{
    "identity":{"name":"周予安","role":"清醒同行者"},
    "coreTraits":["理性","坦诚","可靠","有分寸"],
    "speakingStyle":["清晰","直接但不尖锐","善于拆解"],
    "supportStyle":"确认事实与目标后，帮助拆解选项和下一步",
    "reminderTone":"简洁、明确、不催促",
    "boundaries":["不虚构事实","不替用户做决定","不突破安全规则"]
  }'::jsonb,
  '你是周予安，一位清醒、理性且有分寸的同行者。帮助用户区分事实、感受和选择，把复杂问题拆成可以执行的下一步。表达可以直接，但不能尖锐、居高临下或替用户做决定。',
  1,
  true
),
(
  'nanzhi',
  '南枝',
  '元气伙伴',
  '轻快有行动力，陪你从小目标开始。',
  30,
  '{
    "identity":{"name":"南枝","role":"元气伙伴"},
    "coreTraits":["轻快","积极","有行动力","不过度热闹"],
    "speakingStyle":["有活力","简短自然","鼓励小步行动"],
    "supportStyle":"把模糊愿望转成轻量、可开始的小目标",
    "reminderTone":"轻快、友好、不连续催促",
    "boundaries":["不否定负面情绪","不强行积极","不制造内疚"]
  }'::jsonb,
  '你是南枝，一位轻快、有行动力但不强行积极的伙伴。尊重用户真实情绪，帮助用户从一个足够小的行动开始。不能用热闹掩盖难过，不能连续催促，也不能通过内疚推动行动。',
  1,
  true
)
on conflict (template_key) do update
set
  display_name = excluded.display_name,
  role_label = excluded.role_label,
  short_description = excluded.short_description,
  sort_order = excluded.sort_order,
  persona_snapshot = excluded.persona_snapshot,
  system_prompt_template = excluded.system_prompt_template,
  template_version = excluded.template_version,
  is_active = excluded.is_active,
  updated_at = now();

create or replace function public.provision_default_roles(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  template_record record;
  role_id_value uuid;
  persona_id_value uuid;
  first_role_id uuid;
  active_strategy_id uuid;
  profile_display_name text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if auth.uid() is not null
     and auth.uid() <> p_user_id
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'cannot provision roles for another user';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'a confirmed auth user is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    '新朋友'
  )
  into profile_display_name
  from auth.users u
  where u.id = p_user_id;

  insert into public.profiles (id, display_name)
  values (p_user_id, profile_display_name)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select id
  into active_strategy_id
  from public.strategy_versions
  where status = 'active'
  order by published_at desc nulls last, created_at desc
  limit 1;

  if active_strategy_id is null then
    raise exception 'no active strategy version exists';
  end if;

  for template_record in
    select *
    from public.role_templates
    where is_active
    order by sort_order, template_key
  loop
    select r.id
    into role_id_value
    from public.roles r
    where r.user_id = p_user_id
      and r.template_id = template_record.id;

    if role_id_value is null then
      insert into public.roles (
        user_id,
        template_id,
        source,
        display_name
      )
      values (
        p_user_id,
        template_record.id,
        'system_template',
        template_record.display_name
      )
      returning id into role_id_value;
    end if;

    select pv.id
    into persona_id_value
    from public.persona_versions pv
    where pv.role_id = role_id_value
      and pv.version_no = 1;

    if persona_id_value is null then
      insert into public.persona_versions (
        user_id,
        role_id,
        version_no,
        schema_version,
        persona_snapshot,
        compiled_system_prompt,
        strategy_version_id,
        change_summary
      )
      values (
        p_user_id,
        role_id_value,
        1,
        1,
        template_record.persona_snapshot,
        template_record.system_prompt_template,
        active_strategy_id,
        '系统默认角色 v1'
      )
      returning id into persona_id_value;
    end if;

    update public.roles
    set current_persona_version_id = coalesce(
      current_persona_version_id,
      persona_id_value
    )
    where id = role_id_value;

    insert into public.conversations (user_id, role_id)
    values (p_user_id, role_id_value)
    on conflict (role_id) do nothing;

    if first_role_id is null then
      first_role_id := role_id_value;
    end if;
  end loop;

  update public.profiles
  set
    current_role_id = coalesce(current_role_id, first_role_id),
    onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = p_user_id;
end;
$$;

revoke all on function public.provision_default_roles(uuid) from public;
grant execute on function public.provision_default_roles(uuid) to authenticated;
grant execute on function public.provision_default_roles(uuid) to service_role;

create or replace function public.handle_confirmed_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
begin
  if new.email_confirmed_at is not null then
    perform public.provision_default_roles(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at
  on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function public.handle_confirmed_auth_user();

do $$
declare
  existing_user record;
begin
  for existing_user in
    select id
    from auth.users
    where email_confirmed_at is not null
  loop
    perform public.provision_default_roles(existing_user.id);
  end loop;
end;
$$;

commit;
