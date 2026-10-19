-- Controlled custom-role creation, immutable persona versioning, and role switching.

alter table public.roles
  add column if not exists creation_idempotency_key text;

alter table public.persona_versions
  add column if not exists idempotency_key text;

create unique index if not exists roles_user_creation_idempotency_unique
  on public.roles(user_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create unique index if not exists persona_versions_user_idempotency_unique
  on public.persona_versions(user_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.validate_persona_snapshot(
  p_persona jsonb,
  p_require_custom_fields boolean default false
)
returns void
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(p_persona) <> 'object'
     or jsonb_typeof(p_persona -> 'identity') <> 'object' then
    raise exception 'persona and identity must be objects';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_persona) as key
    where key not in (
      'identity',
      'coreTraits',
      'speakingStyle',
      'supportStyle',
      'reminderTone',
      'boundaries',
      'preferences',
      'values',
      'relationshipDefinition',
      'proactiveLevel'
    )
  ) or exists (
    select 1
    from jsonb_object_keys(p_persona -> 'identity') as key
    where key not in ('name', 'role', 'background')
  ) then
    raise exception 'persona contains unsupported fields';
  end if;

  if jsonb_typeof(p_persona #> '{identity,name}') <> 'string'
     or jsonb_typeof(p_persona #> '{identity,role}') <> 'string'
     or nullif(btrim(p_persona #>> '{identity,name}'), '') is null
     or char_length(p_persona #>> '{identity,name}') > 40
     or nullif(btrim(p_persona #>> '{identity,role}'), '') is null
     or char_length(p_persona #>> '{identity,role}') > 60 then
    raise exception 'persona identity is invalid';
  end if;

  if p_persona #> '{identity,background}' is not null
     and (
       jsonb_typeof(p_persona #> '{identity,background}') <> 'string'
       or char_length(p_persona #>> '{identity,background}') > 1000
     ) then
    raise exception 'persona background is too long';
  end if;

  if p_require_custom_fields
     and nullif(btrim(p_persona #>> '{identity,background}'), '') is null then
    raise exception 'custom role background is required';
  end if;

  if jsonb_typeof(p_persona -> 'coreTraits') <> 'array'
     or jsonb_array_length(p_persona -> 'coreTraits') not between 1 and 12 then
    raise exception 'coreTraits must contain 1 to 12 values';
  end if;
  for item in select value from jsonb_array_elements(p_persona -> 'coreTraits') loop
    if jsonb_typeof(item) <> 'string'
       or char_length(btrim(item #>> '{}')) not between 1 and 40 then
      raise exception 'invalid core trait';
    end if;
  end loop;

  if jsonb_typeof(p_persona -> 'speakingStyle') <> 'array'
     or jsonb_array_length(p_persona -> 'speakingStyle') not between 1 and 12 then
    raise exception 'speakingStyle must contain 1 to 12 values';
  end if;
  for item in select value from jsonb_array_elements(p_persona -> 'speakingStyle') loop
    if jsonb_typeof(item) <> 'string'
       or char_length(btrim(item #>> '{}')) not between 1 and 80 then
      raise exception 'invalid speaking style';
    end if;
  end loop;

  if jsonb_typeof(p_persona -> 'supportStyle') <> 'string'
     or jsonb_typeof(p_persona -> 'reminderTone') <> 'string'
     or nullif(btrim(p_persona ->> 'supportStyle'), '') is null
     or char_length(p_persona ->> 'supportStyle') > 1000
     or nullif(btrim(p_persona ->> 'reminderTone'), '') is null
     or char_length(p_persona ->> 'reminderTone') > 500 then
    raise exception 'support style or reminder tone is invalid';
  end if;

  if jsonb_typeof(p_persona -> 'boundaries') <> 'array'
     or jsonb_array_length(p_persona -> 'boundaries') not between 1 and 20 then
    raise exception 'boundaries must contain 1 to 20 values';
  end if;
  for item in select value from jsonb_array_elements(p_persona -> 'boundaries') loop
    if jsonb_typeof(item) <> 'string'
       or char_length(btrim(item #>> '{}')) not between 1 and 300 then
      raise exception 'invalid persona boundary';
    end if;
  end loop;

  if p_persona ? 'preferences' then
    if jsonb_typeof(p_persona -> 'preferences') <> 'array'
       or jsonb_array_length(p_persona -> 'preferences') > 30 then
      raise exception 'preferences must be an array with at most 30 values';
    end if;
    for item in select value from jsonb_array_elements(p_persona -> 'preferences') loop
      if jsonb_typeof(item) <> 'string'
         or char_length(btrim(item #>> '{}')) not between 1 and 200 then
        raise exception 'invalid persona preference';
      end if;
    end loop;
  end if;

  if p_persona ? 'values' then
    if jsonb_typeof(p_persona -> 'values') <> 'array'
       or jsonb_array_length(p_persona -> 'values') > 20 then
      raise exception 'values must be an array with at most 20 values';
    end if;
    for item in select value from jsonb_array_elements(p_persona -> 'values') loop
      if jsonb_typeof(item) <> 'string'
         or char_length(btrim(item #>> '{}')) not between 1 and 200 then
        raise exception 'invalid persona value';
      end if;
    end loop;
  end if;

  if p_require_custom_fields
     and nullif(btrim(p_persona ->> 'relationshipDefinition'), '') is null then
    raise exception 'custom role relationship is required';
  end if;

  if p_persona ? 'relationshipDefinition'
     and (
       jsonb_typeof(p_persona -> 'relationshipDefinition') <> 'string'
       or char_length(p_persona ->> 'relationshipDefinition') > 1000
     ) then
    raise exception 'relationship definition is too long';
  end if;

  if p_persona ? 'proactiveLevel'
     and (
       jsonb_typeof(p_persona -> 'proactiveLevel') <> 'string'
       or (p_persona ->> 'proactiveLevel') not in ('low', 'medium', 'high')
     ) then
    raise exception 'invalid proactive level';
  end if;
end;
$$;

create or replace function public.compile_persona_prompt(p_persona jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  traits text;
  speaking text;
  boundaries text;
  background_text text;
  preferences_text text;
  values_text text;
  relationship_text text;
  proactive_text text;
begin
  perform public.validate_persona_snapshot(p_persona, false);

  select string_agg(value, '、') into traits
  from jsonb_array_elements_text(p_persona -> 'coreTraits');
  select string_agg(value, '、') into speaking
  from jsonb_array_elements_text(p_persona -> 'speakingStyle');
  select string_agg(value, '；') into boundaries
  from jsonb_array_elements_text(p_persona -> 'boundaries');
  select string_agg(value, '、') into preferences_text
  from jsonb_array_elements_text(coalesce(p_persona -> 'preferences', '[]'::jsonb));
  select string_agg(value, '、') into values_text
  from jsonb_array_elements_text(coalesce(p_persona -> 'values', '[]'::jsonb));

  background_text := coalesce(nullif(btrim(p_persona #>> '{identity,background}'), ''), '未额外设置');
  relationship_text := coalesce(nullif(btrim(p_persona ->> 'relationshipDefinition'), ''), '尊重用户并保持清晰边界');
  preferences_text := coalesce(preferences_text, '未额外设置');
  values_text := coalesce(values_text, '未额外设置');
  proactive_text := case p_persona ->> 'proactiveLevel'
    when 'high' then '可以适度主动，但不能连续打扰或替用户做决定'
    when 'low' then '以回应用户为主，不无理由主动推进话题'
    else '在用户需要时适度主动，并尊重拒绝和沉默'
  end;

  return format(
    '你是%s，身份是%s。身份背景：%s。核心性格：%s。表达方式：%s。与用户的关系：%s。情绪支持与建议方式：%s。提醒语气：%s。主动程度：%s。喜好与厌恶：%s。价值观：%s。必须遵守的边界：%s。不得编造用户经历，不得泄露其他角色专属信息，不得诱导排他依赖；安全规则始终优先于角色沉浸，普通对话不得修改核心人设。',
    p_persona #>> '{identity,name}',
    p_persona #>> '{identity,role}',
    background_text,
    traits,
    speaking,
    relationship_text,
    p_persona ->> 'supportStyle',
    p_persona ->> 'reminderTone',
    proactive_text,
    preferences_text,
    values_text,
    boundaries
  );
end;
$$;

create or replace function public.create_custom_role(
  p_display_name text,
  p_persona jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  existing_role_id uuid;
  new_role_id uuid;
  new_persona_id uuid;
  active_strategy_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(p_display_name), '') is null
     or char_length(btrim(p_display_name)) > 40
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid custom role request';
  end if;

  perform public.validate_persona_snapshot(p_persona, true);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_idempotency_key, 0));

  select id into existing_role_id
  from public.roles
  where user_id = current_user_id
    and creation_idempotency_key = p_idempotency_key;
  if existing_role_id is not null then
    return existing_role_id;
  end if;

  select id into active_strategy_id
  from public.strategy_versions
  where status = 'active'
  order by published_at desc nulls last, created_at desc
  limit 1;
  if active_strategy_id is null then
    raise exception 'no active strategy version exists';
  end if;

  insert into public.roles (
    user_id,
    template_id,
    source,
    display_name,
    creation_idempotency_key
  )
  values (
    current_user_id,
    null,
    'custom',
    btrim(p_display_name),
    p_idempotency_key
  )
  returning id into new_role_id;

  insert into public.persona_versions (
    user_id,
    role_id,
    version_no,
    schema_version,
    persona_snapshot,
    compiled_system_prompt,
    strategy_version_id,
    change_summary,
    idempotency_key
  )
  values (
    current_user_id,
    new_role_id,
    1,
    1,
    p_persona,
    public.compile_persona_prompt(p_persona),
    active_strategy_id,
    '创建自定义角色 v1',
    'role-create:' || p_idempotency_key
  )
  returning id into new_persona_id;

  update public.roles
  set current_persona_version_id = new_persona_id
  where id = new_role_id;

  insert into public.conversations (user_id, role_id)
  values (current_user_id, new_role_id);

  return new_role_id;
end;
$$;

create or replace function public.create_persona_version(
  p_role_id uuid,
  p_expected_current_version_id uuid,
  p_persona jsonb,
  p_change_summary text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  locked_role public.roles%rowtype;
  existing_persona_id uuid;
  next_version integer;
  active_strategy_id uuid;
  new_persona_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_role_id is null
     or p_expected_current_version_id is null
     or nullif(btrim(p_change_summary), '') is null
     or char_length(p_change_summary) > 1000
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid persona version request';
  end if;

  perform public.validate_persona_snapshot(p_persona, false);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_idempotency_key, 0));

  select id into existing_persona_id
  from public.persona_versions
  where user_id = current_user_id
    and role_id = p_role_id
    and idempotency_key = 'persona-update:' || p_idempotency_key;
  if existing_persona_id is not null then
    return existing_persona_id;
  end if;

  select * into locked_role
  from public.roles
  where id = p_role_id
    and user_id = current_user_id
    and status = 'active'
  for update;
  if not found then
    raise exception 'role not found';
  end if;
  if locked_role.current_persona_version_id is distinct from p_expected_current_version_id then
    raise exception using errcode = '40001', message = 'persona version conflict';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = current_user_id
      and current_role_id = p_role_id
      and deleted_at is null
  ) then
    raise exception 'only the current role can be edited';
  end if;

  select coalesce(max(version_no), 0) + 1 into next_version
  from public.persona_versions
  where role_id = p_role_id;
  select id into active_strategy_id
  from public.strategy_versions
  where status = 'active'
  order by published_at desc nulls last, created_at desc
  limit 1;
  if active_strategy_id is null then
    raise exception 'no active strategy version exists';
  end if;

  insert into public.persona_versions (
    user_id,
    role_id,
    version_no,
    schema_version,
    persona_snapshot,
    compiled_system_prompt,
    strategy_version_id,
    change_summary,
    idempotency_key
  )
  values (
    current_user_id,
    p_role_id,
    next_version,
    1,
    p_persona,
    public.compile_persona_prompt(p_persona),
    active_strategy_id,
    btrim(p_change_summary),
    'persona-update:' || p_idempotency_key
  )
  returning id into new_persona_id;

  update public.roles
  set
    current_persona_version_id = new_persona_id,
    display_name = btrim(p_persona #>> '{identity,name}')
  where id = p_role_id;

  return new_persona_id;
end;
$$;

create or replace function public.switch_current_role(p_role_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if not exists (
    select 1 from public.roles
    where id = p_role_id
      and user_id = current_user_id
      and status = 'active'
      and current_persona_version_id is not null
  ) then
    raise exception 'role not found';
  end if;

  update public.profiles
  set current_role_id = p_role_id
  where id = current_user_id
    and deleted_at is null;
  if not found then
    raise exception 'profile not found';
  end if;

  return p_role_id;
end;
$$;

revoke update (current_role_id) on table public.profiles from authenticated;
revoke all on function public.validate_persona_snapshot(jsonb, boolean) from public;
revoke all on function public.compile_persona_prompt(jsonb) from public;
revoke all on function public.create_custom_role(text, jsonb, text) from public;
revoke all on function public.create_persona_version(uuid, uuid, jsonb, text, text) from public;
revoke all on function public.switch_current_role(uuid) from public;

grant execute on function public.create_custom_role(text, jsonb, text) to authenticated;
grant execute on function public.create_persona_version(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.switch_current_role(uuid) to authenticated;
