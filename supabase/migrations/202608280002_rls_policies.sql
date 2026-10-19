-- Yanko / 言行 V0 Row Level Security and grants

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.revoked_at is null
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.strategy_versions enable row level security;
alter table public.role_templates enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.admin_users enable row level security;
alter table public.roles enable row level security;
alter table public.persona_versions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_run_artifacts enable row level security;
alter table public.ooc_checks enable row level security;
alter table public.memory_candidates enable row level security;
alter table public.memories enable row level security;
alter table public.plan_proposals enable row level security;
alter table public.plans enable row level security;
alter table public.plan_status_events enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.emotion_followups enable row level security;
alter table public.persona_feedback enable row level security;
alter table public.badcases enable row level security;
alter table public.eval_cases enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_results enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;

grant select on table public.role_templates to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.user_settings to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select on table public.roles to authenticated;
grant select on table public.persona_versions to authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.messages to authenticated;
grant select on table public.conversation_summaries to authenticated;
grant select on table public.memory_candidates to authenticated;
grant select on table public.memories to authenticated;
grant select on table public.plan_proposals to authenticated;
grant select on table public.plans to authenticated;
grant select on table public.plan_status_events to authenticated;
grant select on table public.notification_jobs to authenticated;
grant select on table public.emotion_followups to authenticated;
grant select, insert on table public.persona_feedback to authenticated;
grant select on table public.admin_users to authenticated;

grant update (display_name, avatar_seed, current_role_id)
  on table public.profiles
  to authenticated;

grant update
  on table public.user_settings
  to authenticated;

grant select on table
  public.ai_runs,
  public.ooc_checks,
  public.badcases,
  public.eval_cases,
  public.eval_runs,
  public.eval_results
to authenticated;

grant insert, update, delete on table
  public.badcases,
  public.eval_cases,
  public.eval_runs,
  public.eval_results
to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy user_settings_select_own
  on public.user_settings
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy user_settings_update_own
  on public.user_settings
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own
  on public.push_subscriptions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy role_templates_select_active
  on public.role_templates
  for select
  to authenticated
  using (is_active);

create policy roles_select_own
  on public.roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy persona_versions_select_own
  on public.persona_versions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy conversations_select_own
  on public.conversations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy messages_select_own
  on public.messages
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy conversation_summaries_select_own
  on public.conversation_summaries
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy memory_candidates_select_own
  on public.memory_candidates
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy memories_select_own
  on public.memories
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy plan_proposals_select_own
  on public.plan_proposals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy plans_select_own
  on public.plans
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy plan_status_events_select_own
  on public.plan_status_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy notification_jobs_select_own
  on public.notification_jobs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy emotion_followups_select_own
  on public.emotion_followups
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy persona_feedback_select_own
  on public.persona_feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy persona_feedback_insert_own
  on public.persona_feedback
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = persona_feedback.message_id
        and m.user_id = (select auth.uid())
        and m.role_id = persona_feedback.role_id
        and m.sender = 'assistant'
        and m.persona_version_id = persona_feedback.persona_version_id
    )
  );

create policy admin_users_select_self
  on public.admin_users
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
  );

create policy ai_runs_admin_select
  on public.ai_runs
  for select
  to authenticated
  using ((select public.is_admin()));

create policy ooc_checks_admin_select
  on public.ooc_checks
  for select
  to authenticated
  using ((select public.is_admin()));

create policy badcases_admin_all
  on public.badcases
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy eval_cases_admin_all
  on public.eval_cases
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy eval_runs_admin_all
  on public.eval_runs
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy eval_results_admin_all
  on public.eval_results
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ai_run_artifacts intentionally has no authenticated policy or grant.
-- Raw encrypted model artifacts are only available to trusted server jobs.

commit;
