-- Reserve a single due follow-up before any future delivery implementation
-- prepares or sends content. The function is exact-ID-only, returns no text,
-- and deliberately has no dispatcher or message-generation side effect.

begin;

alter table public.emotion_followups
  add column delivery_claim_token uuid,
  add column delivery_lease_expires_at timestamptz,
  add column delivery_started_at timestamptz;

create index emotion_followups_delivery_claim_idx
  on public.emotion_followups(id, status, scheduled_for);

create function public.claim_due_emotion_followup(
  p_followup_id uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns table (
  followup_id uuid,
  user_id uuid,
  role_id uuid,
  source_message_id uuid,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  target_user_id uuid;
  target_followup public.emotion_followups%rowtype;
  responding_message_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_followup_id is null
    or p_now is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900 then
    raise exception 'emotion follow-up claim input is invalid';
  end if;

  select followup.user_id
  into target_user_id
  from public.emotion_followups as followup
  where followup.id = p_followup_id;
  if target_user_id is null then
    raise exception 'emotion follow-up not found';
  end if;

  -- Match the user-response trigger and the schedule function's lock order.
  -- If a response arrives first it owns cancellation; if this claim arrives
  -- first it owns the transition to running and cannot later be relabelled as
  -- a cancelled, never-dispatched follow-up.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  select followup.*
  into target_followup
  from public.emotion_followups as followup
  where followup.id = p_followup_id
  for update;
  if not found then
    raise exception 'emotion follow-up not found';
  end if;

  -- A lease is deliberately terminal rather than retryable. A worker that
  -- crashes after an external side effect must not cause a duplicate check-in
  -- through automatic redelivery. Future manual review can inspect only its
  -- machine state and references.
  if target_followup.status = 'running'::public.job_status
    and target_followup.delivery_lease_expires_at <= p_now then
    update public.emotion_followups
    set
      status = 'failed',
      delivery_claim_token = null,
      delivery_lease_expires_at = null,
      last_error_code = 'delivery_lease_expired'
    where id = target_followup.id;
    return;
  end if;

  if target_followup.status <> 'scheduled'::public.job_status
    or target_followup.scheduled_for > p_now then
    return;
  end if;

  if not exists (
    select 1
    from public.messages as source_message
    join public.roles as source_role
      on source_role.id = target_followup.role_id
      and source_role.user_id = target_followup.user_id
      and source_role.status = 'active'
    where source_message.id = target_followup.source_message_id
      and source_message.user_id = target_followup.user_id
      and source_message.role_id = target_followup.role_id
      and source_message.sender = 'user'
      and source_message.status = 'completed'
      and source_message.deleted_at is null
  ) then
    update public.emotion_followups
    set
      status = 'cancelled',
      last_error_code = 'source_unavailable'
    where id = target_followup.id;
    return;
  end if;

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

  if responding_message_id is not null then
    update public.emotion_followups
    set
      status = 'cancelled',
      cancelled_by_message_id = responding_message_id,
      last_error_code = 'user_responded'
    where id = target_followup.id;
    return;
  end if;

  update public.emotion_followups as claimed_followup
  set
    status = 'running',
    delivery_claim_token = gen_random_uuid(),
    delivery_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    delivery_started_at = p_now,
    last_error_code = null
  where claimed_followup.id = target_followup.id
  returning
    claimed_followup.id,
    claimed_followup.user_id,
    claimed_followup.role_id,
    claimed_followup.source_message_id,
    claimed_followup.delivery_claim_token,
    claimed_followup.delivery_lease_expires_at
  into
    followup_id,
    user_id,
    role_id,
    source_message_id,
    claim_token,
    lease_expires_at;

  return next;
end;
$$;

revoke insert, update, delete on table public.emotion_followups from service_role;
grant select on table public.emotion_followups to service_role;

revoke all on function public.claim_due_emotion_followup(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_emotion_followup(uuid, timestamptz, integer)
  to service_role;

commit;
