-- `NULL NOT IN (...)` is unknown in PostgreSQL. Explicitly reject a NULL
-- completion outcome rather than allowing it to fall through to `failed`.

begin;

create or replace function public.complete_emotion_signal_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_job public.emotion_signal_jobs%rowtype;
  final_status public.job_status;
  next_available_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_job_id is null
    or p_claim_token is null
    or p_outcome is null
    or p_now is null
    or p_outcome not in ('succeeded', 'cancelled', 'retryable_failure', 'permanent_failure') then
    raise exception 'emotion signal completion input is invalid';
  end if;

  if (p_outcome = 'succeeded' and p_error_code is not null)
    or (
      p_outcome <> 'succeeded'
      and (
        p_error_code is null
        or p_error_code !~ '^[a-z0-9_]{1,100}$'
      )
    ) then
    raise exception 'emotion signal completion result is invalid';
  end if;

  select job.*
  into current_job
  from public.emotion_signal_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception 'emotion signal job not found';
  end if;

  if current_job.status <> 'running'
    or current_job.claim_token <> p_claim_token then
    raise exception 'emotion signal job claim is stale';
  end if;

  if p_outcome = 'succeeded' then
    final_status := 'succeeded';
    next_available_at := current_job.available_at;
  elsif p_outcome = 'cancelled' then
    final_status := 'cancelled';
    next_available_at := current_job.available_at;
  elsif p_outcome = 'retryable_failure'
    and current_job.attempt_count < current_job.max_attempts then
    final_status := 'scheduled';
    next_available_at := p_now
      + interval '30 seconds' * power(2, greatest(current_job.attempt_count - 1, 0));
  else
    final_status := 'failed';
    next_available_at := current_job.available_at;
  end if;

  update public.emotion_signal_jobs as completed_job
  set
    status = final_status,
    available_at = next_available_at,
    claim_token = null,
    lease_expires_at = null,
    last_error_code = case
      when final_status = 'succeeded' then null
      else p_error_code
    end,
    completed_at = case
      when final_status in ('succeeded', 'failed', 'cancelled') then p_now
      else null
    end
  where completed_job.id = current_job.id;

  return jsonb_build_object(
    'jobId', current_job.id,
    'status', final_status::text,
    'attemptCount', current_job.attempt_count,
    'availableAt', next_available_at
  );
end;
$$;

revoke all on function public.complete_emotion_signal_job(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_emotion_signal_job(uuid, uuid, text, text, timestamptz)
  to service_role;

commit;
