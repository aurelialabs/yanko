-- A strong, non-immediate negative signal may create at most one outstanding
-- next-day follow-up. This boundary is service-only and stores normalized
-- signal metadata plus references; it never stores source text or model output.

begin;

alter table public.emotion_followups
  add constraint emotion_followups_emotion_type_check
  check (emotion_type in (
    'sadness',
    'anxiety',
    'anger',
    'grief',
    'loneliness',
    'overwhelm',
    'other'
  ));

alter table public.emotion_followups
  add constraint emotion_followups_strong_intensity_check
  check (intensity >= 0.8 and intensity <= 1);

create unique index emotion_followups_one_open_per_user
  on public.emotion_followups(user_id)
  where status in ('scheduled'::public.job_status, 'running'::public.job_status);

create function public.schedule_strong_negative_emotion_followup(
  p_user_id uuid,
  p_role_id uuid,
  p_source_message_id uuid,
  p_emotion_type text,
  p_intensity numeric,
  p_idempotency_key text
)
returns table (
  followup_id uuid,
  status public.job_status,
  scheduled_for timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  source_created_at timestamptz;
  account_timezone text;
  quiet_start time;
  quiet_end time;
  scheduled_local timestamp;
  scheduled_local_time time;
  calculated_scheduled_for timestamptz;
  existing_followup public.emotion_followups%rowtype;
  created_followup public.emotion_followups%rowtype;
  desired_status public.job_status;
  desired_error_code text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_user_id is null
    or p_role_id is null
    or p_source_message_id is null
    or p_emotion_type is null
    or p_emotion_type not in (
      'sadness',
      'anxiety',
      'anger',
      'grief',
      'loneliness',
      'overwhelm',
      'other'
    )
    or p_intensity is null
    or p_intensity < 0.8
    or p_intensity > 1
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid emotion follow-up input';
  end if;

  p_emotion_type := btrim(p_emotion_type);
  p_idempotency_key := btrim(p_idempotency_key);

  -- Serializing per account makes the one-outstanding-follow-up rule reliable
  -- across distinct classifier idempotency keys.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select followup.*
  into existing_followup
  from public.emotion_followups as followup
  where followup.user_id = p_user_id
    and followup.idempotency_key = p_idempotency_key
  for update;
  if found then
    return query
    select
      existing_followup.id,
      existing_followup.status,
      existing_followup.scheduled_for;
    return;
  end if;

  select
    source_message.created_at,
    settings.timezone,
    settings.quiet_hours_start,
    settings.quiet_hours_end
  into
    source_created_at,
    account_timezone,
    quiet_start,
    quiet_end
  from public.messages as source_message
  join public.roles as source_role
    on source_role.id = p_role_id
    and source_role.user_id = p_user_id
    and source_role.status = 'active'
  join public.user_settings as settings
    on settings.user_id = p_user_id
  where source_message.id = p_source_message_id
    and source_message.user_id = p_user_id
    and source_message.role_id = p_role_id
    and source_message.sender = 'user'
    and source_message.status = 'completed'
    and source_message.deleted_at is null
  for update of source_message;
  if not found then
    raise exception 'emotion follow-up source is unavailable';
  end if;

  scheduled_local_time := time '10:00';
  if quiet_start is not null and quiet_end is not null and (
    (quiet_start < quiet_end
      and scheduled_local_time >= quiet_start
      and scheduled_local_time < quiet_end)
    or (quiet_start > quiet_end
      and (scheduled_local_time >= quiet_start or scheduled_local_time < quiet_end))
  ) then
    scheduled_local_time := quiet_end;
  end if;

  scheduled_local :=
    ((source_created_at at time zone account_timezone)::date + 1) + scheduled_local_time;
  calculated_scheduled_for := scheduled_local at time zone account_timezone;

  if exists (
    select 1
    from public.emotion_followups as outstanding
    where outstanding.user_id = p_user_id
      and outstanding.status in ('scheduled'::public.job_status, 'running'::public.job_status)
  ) then
    desired_status := 'cancelled';
    desired_error_code := 'outstanding_followup';
  else
    desired_status := 'scheduled';
    desired_error_code := null;
  end if;

  insert into public.emotion_followups (
    user_id,
    source_message_id,
    role_id,
    emotion_type,
    intensity,
    scheduled_for,
    status,
    idempotency_key,
    last_error_code
  )
  values (
    p_user_id,
    p_source_message_id,
    p_role_id,
    p_emotion_type,
    p_intensity,
    calculated_scheduled_for,
    desired_status,
    p_idempotency_key,
    desired_error_code
  )
  returning * into created_followup;

  return query
  select
    created_followup.id,
    created_followup.status,
    created_followup.scheduled_for;
end;
$$;

revoke insert, update, delete on table public.emotion_followups from authenticated;

revoke all on function public.schedule_strong_negative_emotion_followup(
  uuid, uuid, uuid, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.schedule_strong_negative_emotion_followup(
  uuid, uuid, uuid, text, numeric, text
) to service_role;

commit;
