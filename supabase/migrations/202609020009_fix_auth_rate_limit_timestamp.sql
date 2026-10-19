-- Repair the Magic Link limiter in databases where migration 006 was already
-- applied. "current_time" is a PostgreSQL keyword and resolved as timetz.

create or replace function public.consume_magic_link_request_slot(
  p_email_hash text,
  p_ip_hash text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  previous_request timestamptz;
  request_time timestamptz := clock_timestamp();
  retry_after integer;
begin
  if p_email_hash is null
     or p_email_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null
     or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate-limit identifier';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_email_hash || ':' || p_ip_hash, 0)
  );

  select last_requested_at
  into previous_request
  from public.auth_magic_link_rate_limits
  where email_hash = p_email_hash
    and ip_hash = p_ip_hash
  for update;

  if previous_request is not null then
    retry_after := greatest(
      0,
      ceil(
        extract(
          epoch from (
            previous_request + interval '60 seconds' - request_time
          )
        )
      )::integer
    );

    if retry_after > 0 then
      return retry_after;
    end if;
  end if;

  insert into public.auth_magic_link_rate_limits (
    email_hash,
    ip_hash,
    last_requested_at
  )
  values (
    p_email_hash,
    p_ip_hash,
    request_time
  )
  on conflict (email_hash, ip_hash) do update
  set last_requested_at = excluded.last_requested_at;

  delete from public.auth_magic_link_rate_limits
  where last_requested_at < request_time - interval '24 hours';

  return 0;
end;
$$;

revoke all on function public.consume_magic_link_request_slot(text, text) from public;
grant execute on function public.consume_magic_link_request_slot(text, text)
  to anon, authenticated;
