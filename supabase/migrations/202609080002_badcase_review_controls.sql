-- Badcase content is privileged diagnostic material. Administrators may review
-- the already-redacted DTO, but browser sessions must not mutate table rows
-- directly. Keep the status flow narrow, authorized, and conflict-aware.

begin;

revoke insert, update, delete on table public.badcases from authenticated;

create or replace function public.update_badcase_review_status(
  p_badcase_id uuid,
  p_status public.feedback_status,
  p_expected_updated_at timestamptz,
  p_now timestamptz
)
returns table (
  id uuid,
  status public.feedback_status,
  resolved_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_badcase public.badcases%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'administrator access required' using errcode = 'P0001';
  end if;

  select *
  into v_badcase
  from public.badcases as b
  where b.id = p_badcase_id
  for update;

  if not found then
    raise exception 'badcase not found' using errcode = 'P0001';
  end if;

  if v_badcase.updated_at <> p_expected_updated_at then
    -- Repeating a completed request is safe when the requested terminal state
    -- already matches. A different state must never overwrite a newer review.
    if v_badcase.status = p_status then
      return query
      select v_badcase.id, v_badcase.status, v_badcase.resolved_at, v_badcase.updated_at;
      return;
    end if;

    raise exception 'badcase has changed' using errcode = 'P0001';
  end if;

  return query
  update public.badcases as b
  set
    status = p_status,
    updated_at = p_now,
    resolved_at = case
      when p_status = 'resolved'::public.feedback_status then coalesce(v_badcase.resolved_at, p_now)
      else null
    end
  where b.id = v_badcase.id
  returning b.id, b.status, b.resolved_at, b.updated_at;
end;
$$;

revoke all on function public.update_badcase_review_status(
  uuid,
  public.feedback_status,
  timestamptz,
  timestamptz
) from public, anon, service_role;
grant execute on function public.update_badcase_review_status(
  uuid,
  public.feedback_status,
  timestamptz,
  timestamptz
) to authenticated;

commit;
