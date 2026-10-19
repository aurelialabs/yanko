-- Account deletion cascades roles/personas and conversations/messages through
-- separate ownership paths. Defer the restrictive persona reference until the
-- transaction ends so the complete account cascade can settle first, while a
-- standalone deletion of a referenced immutable persona version still fails.

alter table public.messages
  drop constraint messages_persona_version_id_fkey;

alter table public.messages
  add constraint messages_persona_version_id_fkey
  foreign key (persona_version_id)
  references public.persona_versions(id)
  on delete no action
  deferrable initially deferred;
