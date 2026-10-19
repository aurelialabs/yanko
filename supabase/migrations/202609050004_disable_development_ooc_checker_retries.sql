-- Keep the development strategy aligned with the product runtime: malformed
-- or unavailable OOC checks fail closed without an automatic provider retry.

begin;

do $$
declare
  updated_count integer;
begin
  update public.strategy_versions
  set
    ooc_config = jsonb_set(
      coalesce(ooc_config, '{}'::jsonb),
      '{max_checker_retries_per_draft}',
      '0'::jsonb,
      true
    ),
    change_summary =
      'MiniMax 开发链路的 OOC 校验失败后安全关闭，不自动重发同一校验请求。'
  where version_key = 'v0.2-minimax-m3-development'
    and status = 'draft';

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'development strategy draft is unavailable';
  end if;
end;
$$;

commit;
