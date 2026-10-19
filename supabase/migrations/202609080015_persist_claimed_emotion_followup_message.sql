-- An approved future delivery composition root may persist exactly one
-- proactive assistant message for a currently claimed follow-up. This is a
-- storage boundary only: it has no model, prompt, scheduler, HTTP route, or
-- external delivery side effect.

begin;

create function public.persist_claimed_emotion_followup_message(
  p_followup_id uuid,
  p_claim_token uuid,
  p_content text,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  target_user_id uuid;
  target_followup public.emotion_followups%rowtype;
  target_conversation_id uuid;
  current_persona_version_id uuid;
  created_message_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_followup_id is null
    or p_claim_token is null
    or p_content is null
    or char_length(btrim(p_content)) not between 1 and 20000
    or p_now is null then
    raise exception 'emotion follow-up message input is invalid';
  end if;

  select followup.user_id
  into target_user_id
  from public.emotion_followups as followup
  where followup.id = p_followup_id;
  if target_user_id is null then
    raise exception 'emotion follow-up not found';
  end if;

  -- Preserve the same ordering as claim and response cancellation. Once the
  -- claim owns running state, this function can atomically bind one message
  -- to that exact lease without creating a duplicate on a retry.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  select followup.*
  into target_followup
  from public.emotion_followups as followup
  where followup.id = p_followup_id
  for update;
  if not found then
    raise exception 'emotion follow-up not found';
  end if;

  if target_followup.status <> 'running'::public.job_status
    or target_followup.delivery_claim_token <> p_claim_token then
    raise exception 'emotion follow-up delivery claim is stale';
  end if;

  -- A lease boundary is terminal. Do not raise after this update: an
  -- exception would roll the update back and leave a stale running lease.
  if target_followup.delivery_lease_expires_at is null
    or target_followup.delivery_lease_expires_at <= p_now then
    update public.emotion_followups
    set
      status = 'failed',
      delivery_claim_token = null,
      delivery_lease_expires_at = null,
      last_error_code = 'delivery_lease_expired'
    where id = target_followup.id;
    return null;
  end if;

  if target_followup.sent_message_id is not null then
    return target_followup.sent_message_id;
  end if;

  select conversation.id, role.current_persona_version_id
  into target_conversation_id, current_persona_version_id
  from public.roles as role
  join public.conversations as conversation
    on conversation.user_id = target_followup.user_id
    and conversation.role_id = target_followup.role_id
  where role.id = target_followup.role_id
    and role.user_id = target_followup.user_id
    and role.status = 'active'
    and role.current_persona_version_id is not null
  order by conversation.created_at asc, conversation.id asc
  limit 1
  for update of role, conversation;
  if target_conversation_id is null or current_persona_version_id is null then
    -- This can happen only if the target was removed or archived after claim.
    -- Persist a minimal terminal state instead of leaving a running lease.
    update public.emotion_followups
    set
      status = 'cancelled',
      delivery_claim_token = null,
      delivery_lease_expires_at = null,
      last_error_code = 'source_unavailable'
    where id = target_followup.id;
    return null;
  end if;

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
    target_followup.user_id,
    target_conversation_id,
    target_followup.role_id,
    'assistant',
    btrim(p_content),
    'completed',
    current_persona_version_id,
    p_now
  )
  returning id into created_message_id;

  update public.emotion_followups
  set sent_message_id = created_message_id
  where id = target_followup.id;

  return created_message_id;
end;
$$;

create or replace function public.complete_emotion_followup_delivery(
  p_followup_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_sent_message_id uuid,
  p_error_code text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  target_followup public.emotion_followups%rowtype;
  responding_message_id uuid;
  final_status public.job_status;
  final_error_code text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_followup_id is null
    or p_claim_token is null
    or p_now is null
    or p_outcome not in ('succeeded', 'cancelled', 'permanent_failure') then
    raise exception 'emotion follow-up completion input is invalid';
  end if;

  if (p_outcome = 'succeeded' and (p_sent_message_id is null or p_error_code is not null))
    or (
      p_outcome <> 'succeeded'
      and (
        p_sent_message_id is not null
        or p_error_code is null
        or p_error_code !~ '^[a-z0-9_]{1,100}$'
      )
    ) then
    raise exception 'emotion follow-up completion result is invalid';
  end if;

  select followup.*
  into target_followup
  from public.emotion_followups as followup
  where followup.id = p_followup_id
  for update;
  if not found then
    raise exception 'emotion follow-up not found';
  end if;

  if target_followup.status <> 'running'::public.job_status
    or target_followup.delivery_claim_token <> p_claim_token then
    raise exception 'emotion follow-up delivery claim is stale';
  end if;

  if target_followup.delivery_lease_expires_at is null
    or target_followup.delivery_lease_expires_at <= p_now then
    update public.emotion_followups
    set
      status = 'failed',
      delivery_claim_token = null,
      delivery_lease_expires_at = null,
      last_error_code = 'delivery_lease_expired'
    where id = target_followup.id;

    return jsonb_build_object(
      'followupId', target_followup.id,
      'status', 'failed',
      'sentMessageId', null
    );
  end if;

  if p_outcome = 'succeeded' then
    if target_followup.sent_message_id is distinct from p_sent_message_id
      or not exists (
        select 1
        from public.messages as sent_message
        where sent_message.id = p_sent_message_id
          and sent_message.user_id = target_followup.user_id
          and sent_message.role_id = target_followup.role_id
          and sent_message.sender = 'assistant'
          and sent_message.status = 'completed'
          and sent_message.deleted_at is null
          and sent_message.created_at >= target_followup.delivery_started_at
      ) then
      raise exception 'emotion follow-up sent message is unavailable';
    end if;

    final_status := 'succeeded';
    final_error_code := null;
  elsif p_outcome = 'cancelled' then
    if p_error_code = 'user_responded' then
      select response_message.id
      into responding_message_id
      from public.messages as source_message
      join public.messages as response_message
        on response_message.user_id = target_followup.user_id
        and response_message.role_id = target_followup.role_id
        and response_message.sender = 'user'
        and response_message.status = 'completed'
        and response_message.deleted_at is null
        and (response_message.created_at, response_message.id)
          > (source_message.created_at, source_message.id)
      where source_message.id = target_followup.source_message_id
      order by response_message.created_at asc, response_message.id asc
      limit 1;
      if responding_message_id is null then
        raise exception 'emotion follow-up response is unavailable';
      end if;
    elsif p_error_code <> 'source_unavailable' then
      raise exception 'emotion follow-up cancellation reason is invalid';
    end if;

    final_status := 'cancelled';
    final_error_code := p_error_code;
  else
    final_status := 'failed';
    final_error_code := p_error_code;
  end if;

  update public.emotion_followups
  set
    status = final_status,
    sent_message_id = case when final_status = 'succeeded' then p_sent_message_id else null end,
    cancelled_by_message_id = case
      when final_status = 'cancelled' and final_error_code = 'user_responded'
        then responding_message_id
      else cancelled_by_message_id
    end,
    delivery_claim_token = null,
    delivery_lease_expires_at = null,
    last_error_code = final_error_code
  where id = target_followup.id;

  return jsonb_build_object(
    'followupId', target_followup.id,
    'status', final_status::text,
    'sentMessageId', case when final_status = 'succeeded' then p_sent_message_id else null end
  );
end;
$$;

revoke all on function public.persist_claimed_emotion_followup_message(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.persist_claimed_emotion_followup_message(
  uuid, uuid, text, timestamptz
) to service_role;

commit;
