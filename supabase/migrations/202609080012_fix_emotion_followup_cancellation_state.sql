-- The original emotion_followups table predates the lease-backed queues and
-- has no completed_at column. Keep the cancellation audit minimal: status,
-- fixed reason, and (when retained) the responding message ID.

begin;

create or replace function public.cancel_new_emotion_followup_after_known_user_response()
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
  end if;

  return new;
end;
$$;

create or replace function public.cancel_scheduled_emotion_followups_after_user_response()
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
    last_error_code = 'user_responded'
  from public.messages as source_message
  where followup.user_id = new.user_id
    and followup.role_id = new.role_id
    and followup.status = 'scheduled'::public.job_status
    and source_message.id = followup.source_message_id
    and (new.created_at, new.id) > (source_message.created_at, source_message.id);

  return new;
end;
$$;

commit;
