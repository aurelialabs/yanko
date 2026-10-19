-- Allow the authenticated owner to create plans and update completion state.
-- RLS remains the data boundary; application actions also re-check ownership.

begin;

grant insert on table public.plans to authenticated;
grant update (status, completed_at) on table public.plans to authenticated;
grant delete on table public.plans to authenticated;

create policy plans_insert_own
  on public.plans
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy plans_update_own
  on public.plans
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy plans_delete_own
  on public.plans
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

commit;
