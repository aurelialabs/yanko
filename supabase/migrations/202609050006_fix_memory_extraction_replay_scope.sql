-- Re-check role and source scope before returning a replayed extraction.
-- The original transaction implementation stays private behind this wrapper.

begin;

alter function public.persist_memory_extraction(
  uuid, uuid, uuid, text, text, jsonb
) rename to persist_memory_extraction_internal;

revoke all on function public.persist_memory_extraction_internal(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

create function public.persist_memory_extraction(
  p_user_id uuid,
  p_role_id uuid,
  p_source_message_id uuid,
  p_policy_version text,
  p_idempotency_key text,
  p_operations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  existing_run public.memory_extraction_runs%rowtype;
begin
  select *
  into existing_run
  from public.memory_extraction_runs mer
  where mer.user_id = p_user_id
    and mer.idempotency_key = btrim(p_idempotency_key);

  if found and (
    existing_run.role_id <> p_role_id
    or existing_run.source_message_id <> p_source_message_id
  ) then
    raise exception 'memory extraction idempotency key is already in use';
  end if;

  select *
  into existing_run
  from public.memory_extraction_runs mer
  where mer.user_id = p_user_id
    and mer.source_message_id = p_source_message_id;

  if found and existing_run.role_id <> p_role_id then
    raise exception 'memory extraction source belongs to another role';
  end if;

  return public.persist_memory_extraction_internal(
    p_user_id,
    p_role_id,
    p_source_message_id,
    p_policy_version,
    p_idempotency_key,
    p_operations
  );
end;
$$;

revoke all on function public.persist_memory_extraction(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_memory_extraction(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

commit;
