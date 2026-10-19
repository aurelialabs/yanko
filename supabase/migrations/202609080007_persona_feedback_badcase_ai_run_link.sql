-- Preserve a narrow, server-derived AI Run reference for a future feedback
-- record only when its target is a successfully completed response from the
-- same account. This does not backfill historical feedback and does not copy
-- OOC details, message content, user-supplied notes, or model artifacts.

begin;

create or replace function public.create_badcase_from_persona_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  linked_ai_run_id uuid;
begin
  select ar.id
  into linked_ai_run_id
  from public.ai_runs as ar
  where ar.user_id = new.user_id
    and ar.assistant_message_id = new.message_id
    and ar.status = 'completed'::public.ai_run_status
  order by ar.completed_at desc nulls last, ar.id desc
  limit 1;

  insert into public.badcases (
    user_id,
    source_type,
    persona_feedback_id,
    message_id,
    ai_run_id,
    capability,
    severity,
    diagnosis,
    redacted_excerpt,
    status
  )
  values (
    new.user_id,
    'persona_feedback',
    new.id,
    new.message_id,
    linked_ai_run_id,
    'persona_feedback',
    'medium',
    '等待人工复核的人设反馈。',
    null,
    'open'
  )
  on conflict (persona_feedback_id) where persona_feedback_id is not null do nothing;

  return new;
end;
$$;

revoke all on function public.create_badcase_from_persona_feedback()
  from public, anon, authenticated, service_role;

commit;
