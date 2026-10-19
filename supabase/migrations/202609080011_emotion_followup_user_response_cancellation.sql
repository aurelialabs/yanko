-- A completed user message in the same role suppresses a not-yet-dispatched
-- follow-up. This is deliberately a database-owned boundary: chat clients,
-- model workers, and future schedulers cannot race it by assembling their own
-- cross-table updates. No delivery worker is introduced by this migration.

begin;

alter table public.emotion_followups
  add column cancelled_by_message_id uuid
    references public.messages(id) on delete set null;

alter table public.emotion_followups
  add constraint emotion_followups_user_response_cancellation_check check (
    cancelled_by_message_id is null
    or (
      status = 'cancelled'::public.job_status
      and last_error_code = 'user_responded'
    )
  );

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

  if new.cancelled_by_message_id is not null and not exists (
    select 1
    from public.messages m
    where m.id = new.cancelled_by_message_id
      and m.user_id = new.user_id
      and m.role_id = new.role_id
      and m.sender = 'user'
  ) then
    raise exception 'follow-up cancellation must be a user message in the same role';
  end if;

  return new;
end;
$$;

-- This pre-insert guard closes the inverse ordering of the race: a response
-- may already have committed before the emotion classifier finishes and asks
-- to create its next-day follow-up. It stores only the responding message ID
-- and a fixed machine reason, never message text or classifier output.
create function public.cancel_new_emotion_followup_after_known_user_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  response_message_id uuid;
begin
  if new.status not in ('scheduled'::public.job_status, 'cancelled'::public.job_status)
    or new.source_message_id is null then
    return new;
  end if;

  select response_message.id
  into response_message_id
  from public.messages as source_message
  join public.messages as response_message
    on response_message.user_id = new.user_id
    and response_message.role_id = new.role_id
    and response_message.sender = 'user'
    and response_message.status = 'completed'
    and response_message.deleted_at is null
    and (response_message.created_at, response_message.id)
      > (source_message.created_at, source_message.id)
  where source_message.id = new.source_message_id
    and source_message.user_id = new.user_id
    and source_message.role_id = new.role_id
    and source_message.sender = 'user'
  order by response_message.created_at asc, response_message.id asc
  limit 1;

  if response_message_id is not null then
    new.status := 'cancelled';
    new.cancelled_by_message_id := response_message_id;
    new.last_error_code := 'user_responded';
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

create trigger emotion_followups_cancel_new_after_known_user_response
before insert on public.emotion_followups
for each row execute function public.cancel_new_emotion_followup_after_known_user_response();

-- The matching forward ordering shares schedule_strong_negative_emotion_followup's
-- per-account advisory lock. Whichever transaction obtains the lock first
-- establishes the honest state: a completed response cancels a scheduled
-- follow-up; a scheduler that already transitioned a future job to running is
-- left intact so a later delivery implementation never records "cancelled"
-- after it has started dispatch. A delivery worker must take this same account
-- lock before changing scheduled work to running.
create function public.cancel_scheduled_emotion_followups_after_user_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.sender <> 'user'
    or new.status <> 'completed'
    or new.deleted_at is not null
    or (
      tg_op = 'UPDATE'
      and old.sender = 'user'
      and old.status = 'completed'
      and old.deleted_at is null
    ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  update public.emotion_followups as followup
  set
    status = 'cancelled',
    cancelled_by_message_id = new.id,
    last_error_code = 'user_responded',
    completed_at = coalesce(followup.completed_at, now())
  from public.messages as source_message
  where followup.user_id = new.user_id
    and followup.role_id = new.role_id
    and followup.status = 'scheduled'::public.job_status
    and source_message.id = followup.source_message_id
    and (new.created_at, new.id) > (source_message.created_at, source_message.id);

  return new;
end;
$$;

create trigger messages_cancel_scheduled_emotion_followups_after_user_response
after insert or update of status, deleted_at on public.messages
for each row execute function public.cancel_scheduled_emotion_followups_after_user_response();

revoke all on function public.cancel_new_emotion_followup_after_known_user_response()
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_scheduled_emotion_followups_after_user_response()
  from public, anon, authenticated, service_role;

commit;
