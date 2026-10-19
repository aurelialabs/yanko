-- A hard deletion from auth.users cascades through the ordinary personal-data
-- graph. Badcases deliberately used ON DELETE SET NULL for historical admin
-- review, but their redacted excerpts can still be personal data. Remove the
-- user's associated badcases in the same profile-deletion transaction instead
-- of retaining an anonymous diagnostic after account deletion.

begin;

create or replace function public.delete_profile_owned_badcases()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.badcases
  where user_id = old.id;

  return old;
end;
$$;

drop trigger if exists profiles_delete_owned_badcases on public.profiles;

create trigger profiles_delete_owned_badcases
before delete on public.profiles
for each row
execute function public.delete_profile_owned_badcases();

revoke all on function public.delete_profile_owned_badcases() from public, anon, authenticated, service_role;

commit;
