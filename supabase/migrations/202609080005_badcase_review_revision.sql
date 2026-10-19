-- `updated_at` is maintained by a transaction-time trigger and therefore is
-- not a reliable optimistic-lock value for two updates inside one transaction.
-- Use a dedicated monotonic review revision for administrator status changes.

begin;

alter table public.badcases
  add column if not exists review_revision integer not null default 0
  check (review_revision >= 0);

drop function if exists public.update_badcase_review_status(
  uuid,
  public.feedback_status,
  timestamptz,
  timestamptz
);

create function public.update_badcase_review_status(
  p_badcase_id uuid,
  p_status public.feedback_status,
  p_expected_revision integer,
  p_now timestamptz
)
returns table (
  id uuid,
  status public.feedback_status,
  resolved_at timestamptz,
  updated_at timestamptz,
  review_revision integer
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

  if v_badcase.review_revision <> p_expected_revision then
    if v_badcase.status = p_status then
      return query
      select
        v_badcase.id,
        v_badcase.status,
        v_badcase.resolved_at,
        v_badcase.updated_at,
        v_badcase.review_revision;
      return;
    end if;

    raise exception 'badcase has changed' using errcode = 'P0001';
  end if;

  return query
  update public.badcases as b
  set
    status = p_status,
    updated_at = p_now,
    review_revision = v_badcase.review_revision + 1,
    resolved_at = case
      when p_status = 'resolved'::public.feedback_status then coalesce(v_badcase.resolved_at, p_now)
      else null
    end
  where b.id = v_badcase.id
  returning b.id, b.status, b.resolved_at, b.updated_at, b.review_revision;
end;
$$;

revoke all on function public.update_badcase_review_status(
  uuid,
  public.feedback_status,
  integer,
  timestamptz
) from public, anon, service_role;
grant execute on function public.update_badcase_review_status(
  uuid,
  public.feedback_status,
  integer,
  timestamptz
) to authenticated;

commit;
