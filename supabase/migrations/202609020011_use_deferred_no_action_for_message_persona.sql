-- PostgreSQL RESTRICT remains immediate even on a declared deferrable
-- constraint. Rebuild the already-migrated FK as deferred NO ACTION.

alter table public.messages
  drop constraint messages_persona_version_id_fkey;

alter table public.messages
  add constraint messages_persona_version_id_fkey
  foreign key (persona_version_id)
  references public.persona_versions(id)
  on delete no action
  deferrable initially deferred;
