-- The initial review function intentionally uses updated_at as its optimistic
-- version. Make that version advance inside the narrow controlled mutation so
-- a stale administrator request cannot overwrite a later status change.

begin;

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

  select b.*
  into v_badcase
  from public.badcases as b
  where b.id = p_badcase_id
  for update;

  if not found then
    raise exception 'badcase not found' using errcode = 'P0001';
  end if;

  if v_badcase.updated_at <> p_expected_updated_at then
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

commit;
