-- Every newly submitted persona-feedback record represents a reviewable
-- product outcome. Create one narrow Badcase link at insert time without
-- copying the user's added text, the message body, or model artifacts.
--
-- This migration deliberately does not backfill historical feedback. Existing
-- data is neither scanned nor newly retained by this link.

begin;

create unique index badcases_persona_feedback_unique
  on public.badcases(persona_feedback_id)
  where persona_feedback_id is not null;

create function public.create_badcase_from_persona_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.badcases (
    user_id,
    source_type,
    persona_feedback_id,
    message_id,
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

drop trigger if exists persona_feedback_create_badcase on public.persona_feedback;

create trigger persona_feedback_create_badcase
after insert on public.persona_feedback
for each row execute function public.create_badcase_from_persona_feedback();

commit;
