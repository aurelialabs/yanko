-- Claim exactly one durable memory extraction job without scanning or
-- mutating unrelated queued messages. This supports event-driven workers and
-- isolated local integration verification.

begin;

create function public.claim_memory_extraction_job(
  p_job_id uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns table (
  job_id uuid,
  user_id uuid,
  role_id uuid,
  source_message_id uuid,
  claim_token uuid,
  idempotency_key text,
  attempt_no integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null
    or p_now is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900 then
    raise exception 'memory extraction claim input is invalid';
  end if;

  update public.memory_extraction_jobs as exhausted_job
  set
    status = 'failed',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'lease_expired',
    completed_at = p_now
  where exhausted_job.id = p_job_id
    and exhausted_job.status = 'running'
    and exhausted_job.lease_expires_at <= p_now
    and exhausted_job.attempt_count >= exhausted_job.max_attempts;

  with invalid_job as (
    select candidate.id
    from public.memory_extraction_jobs as candidate
    where candidate.id = p_job_id
      and (
        (candidate.status = 'scheduled' and candidate.available_at <= p_now)
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and (
        not exists (
          select 1
          from public.messages as source_message
          where source_message.id = candidate.source_message_id
            and source_message.user_id = candidate.user_id
            and source_message.role_id = candidate.role_id
            and source_message.sender = 'user'
            and source_message.status = 'completed'
            and source_message.deleted_at is null
        )
        or not exists (
          select 1
          from public.roles as source_role
          where source_role.id = candidate.role_id
            and source_role.user_id = candidate.user_id
            and source_role.status = 'active'
        )
      )
    for update of candidate skip locked
  )
  update public.memory_extraction_jobs as cancelled_job
  set
    status = 'cancelled',
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'source_unavailable',
    completed_at = p_now
  from invalid_job
  where cancelled_job.id = invalid_job.id;

  return query
  with eligible_job as (
    select candidate.id
    from public.memory_extraction_jobs as candidate
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
    where candidate.id = p_job_id
      and (
        (candidate.status = 'scheduled' and candidate.available_at <= p_now)
        or (
          candidate.status = 'running'
          and candidate.lease_expires_at <= p_now
          and candidate.attempt_count < candidate.max_attempts
        )
      )
      and candidate.attempt_count < candidate.max_attempts
    for update of candidate skip locked
  ),
  claimed_job as (
    update public.memory_extraction_jobs as target_job
    set
      status = 'running',
      attempt_count = target_job.attempt_count + 1,
      claim_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      last_error_code = null,
      completed_at = null
    from eligible_job
    where target_job.id = eligible_job.id
    returning target_job.*
  )
  select
    claimed_job.id,
    claimed_job.user_id,
    claimed_job.role_id,
    claimed_job.source_message_id,
    claimed_job.claim_token,
    claimed_job.idempotency_key,
    claimed_job.attempt_count,
    claimed_job.lease_expires_at
  from claimed_job;
end;
$$;

revoke all on function public.claim_memory_extraction_job(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_memory_extraction_job(uuid, timestamptz, integer)
  to service_role;

commit;
