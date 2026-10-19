-- Controlled rejection for pending chat plan proposals.
-- This migration is intentionally not executed automatically by the app.

begin;

alter table public.plan_proposals
  add column rejection_idempotency_key text,
  add constraint plan_proposals_rejection_idempotency_key_length
    check (
      rejection_idempotency_key is null
      or char_length(btrim(rejection_idempotency_key)) between 8 and 200
    );

create unique index plan_proposals_user_rejection_idempotency_unique
  on public.plan_proposals(user_id, rejection_idempotency_key)
  where rejection_idempotency_key is not null;

create or replace function public.reject_plan_proposal(
  p_proposal_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  proposal_row public.plan_proposals%rowtype;
  replay_proposal_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_proposal_id is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'invalid plan proposal rejection input';
  end if;

  p_idempotency_key := btrim(p_idempotency_key);

  select pp.id
  into replay_proposal_id
  from public.plan_proposals pp
  where pp.user_id = current_user_id
    and pp.rejection_idempotency_key = p_idempotency_key;

  if replay_proposal_id is not null then
    if replay_proposal_id <> p_proposal_id then
      raise exception 'plan proposal rejection idempotency key is already in use';
    end if;

    return replay_proposal_id;
  end if;

  select *
  into proposal_row
  from public.plan_proposals pp
  where pp.id = p_proposal_id
    and pp.user_id = current_user_id
  for update;

  if not found then
    raise exception 'plan proposal not found';
  end if;

  if proposal_row.status = 'rejected' then
    return proposal_row.id;
  end if;

  if proposal_row.status <> 'pending' then
    raise exception 'plan proposal is no longer available for rejection';
  end if;

  if proposal_row.expires_at <= now() then
    update public.plan_proposals
    set status = 'expired'
    where id = proposal_row.id
      and user_id = current_user_id
      and status = 'pending';

    return null;
  end if;

  update public.plan_proposals
  set
    status = 'rejected',
    rejection_idempotency_key = p_idempotency_key
  where id = proposal_row.id
    and user_id = current_user_id
    and status = 'pending';

  return proposal_row.id;
end;
$$;

revoke all on function public.reject_plan_proposal(uuid, text) from public;
grant execute on function public.reject_plan_proposal(uuid, text) to authenticated;

commit;
