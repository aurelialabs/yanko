-- Forward-only hardening for databases that applied the initial AI runtime
-- before MiniMax completion required a final passing OOC record. Fresh
-- databases already contain the same guard in 202609050001.

begin;

do $$
declare
  function_definition text;
  original_fragment constant text := $fragment$
  if not found
     or locked_run.status <> 'running'
     or locked_run.trace_id <> p_trace_id
     or locked_run.assistant_message_id is null then
    raise exception 'ai generation lease is not current';
  end if;

  perform public.store_ai_run_ooc_checks(
    locked_run.id,
    case
$fragment$;
  hardened_fragment constant text := $fragment$
  if not found
     or locked_run.status <> 'running'
     or locked_run.trace_id <> p_trace_id
     or locked_run.assistant_message_id is null then
    raise exception 'ai generation lease is not current';
  end if;

  if locked_run.provider = 'minimax'
     and (
       jsonb_typeof(coalesce(p_ooc_checks, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_ooc_checks, '[]'::jsonb)) not between 1 and 2
       or coalesce(
         coalesce(p_ooc_checks, '[]'::jsonb)
           -> (jsonb_array_length(coalesce(p_ooc_checks, '[]'::jsonb)) - 1)
           ->> 'verdict',
         ''
       ) <> 'pass'
     ) then
    raise exception 'minimax completion requires a final passing ooc check';
  end if;

  perform public.store_ai_run_ooc_checks(
    locked_run.id,
    case
$fragment$;
begin
  select pg_get_functiondef(
    'public.complete_ai_chat_turn(uuid,uuid,text,text,boolean,integer,integer,integer,jsonb)'::regprocedure
  )
  into function_definition;

  if position(original_fragment in function_definition) > 0 then
    execute replace(
      function_definition,
      original_fragment,
      hardened_fragment
    );
  end if;
end;
$$;

commit;
