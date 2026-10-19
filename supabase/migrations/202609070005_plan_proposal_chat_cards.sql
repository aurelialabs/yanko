-- Preserve the user-facing title and original time phrase needed by chat
-- confirmation cards. The existing proposal RPC stays available for forward
-- compatibility; new product code uses the v2 wrapper.

begin;

alter table public.plan_proposals
  add column suggested_title text
    check (
      suggested_title is null
      or char_length(btrim(suggested_title)) between 1 and 200
    ),
  add column original_time_text text
    check (
      original_time_text is null
      or char_length(btrim(original_time_text)) between 1 and 500
    );

create function public.create_plan_proposal_v2(
  p_source_role_id uuid,
  p_source_message_id uuid,
  p_scope public.plan_scope,
  p_suggested_title text,
  p_original_time_text text,
  p_parsed_payload jsonb,
  p_missing_fields text[],
  p_confidence numeric,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  proposal_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if (p_suggested_title is not null
      and char_length(btrim(p_suggested_title)) not between 1 and 200)
    or (p_original_time_text is not null
      and char_length(btrim(p_original_time_text)) not between 1 and 500) then
    raise exception 'invalid plan proposal display fields';
  end if;

  proposal_id := public.create_plan_proposal(
    p_source_role_id,
    p_source_message_id,
    p_scope,
    p_parsed_payload,
    p_missing_fields,
    p_confidence,
    p_idempotency_key
  );

  if proposal_id is null then
    raise exception 'plan proposal could not be created';
  end if;

  update public.plan_proposals as proposal
  set
    suggested_title = coalesce(
      proposal.suggested_title,
      nullif(btrim(p_suggested_title), '')
    ),
    original_time_text = coalesce(
      proposal.original_time_text,
      nullif(btrim(p_original_time_text), '')
    )
  where proposal.id = proposal_id
    and proposal.user_id = current_user_id;

  if not found then
    raise exception 'plan proposal ownership mismatch';
  end if;

  return proposal_id;
end;
$$;

revoke all on function public.create_plan_proposal_v2(
  uuid, uuid, public.plan_scope, text, text, jsonb, text[], numeric, text
) from public, anon;
grant execute on function public.create_plan_proposal_v2(
  uuid, uuid, public.plan_scope, text, text, jsonb, text[], numeric, text
) to authenticated;

commit;
