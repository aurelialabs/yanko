-- Forward-only compatibility fix for databases that compiled 202609050001
-- before its qualified ooc_checks reference was corrected. Fresh databases
-- still receive the explicit column qualification in the original migration.

begin;

do $$
declare
  function_definition text;
  ambiguous_statement constant text :=
    'delete from public.ooc_checks where ai_run_id = existing_run.id;';
  qualified_statement constant text :=
    'delete from public.ooc_checks as stored_check where stored_check.ai_run_id = existing_run.id;';
begin
  select pg_get_functiondef(
    'public.begin_ai_chat_turn(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  )
  into function_definition;

  if position(ambiguous_statement in function_definition) > 0 then
    execute replace(
      function_definition,
      ambiguous_statement,
      qualified_statement
    );
  end if;
end;
$$;

commit;
