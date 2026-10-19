-- Temporary message-turn function for the V0 pre-model phase.
-- It persists a user message and a fixed, role-aware placeholder reply in one
-- transaction. A later Model Adapter will replace the reply generation only.

begin;

create or replace function public.append_mock_chat_turn(
  p_role_id uuid,
  p_conversation_id uuid,
  p_content text,
  p_client_message_id text
)
returns table (
  user_message_id uuid,
  assistant_message_id uuid
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  current_user_id uuid := auth.uid();
  current_persona_id uuid;
  role_name text;
  existing_user_message_id uuid;
  existing_assistant_message_id uuid;
  created_user_message_id uuid;
  created_assistant_message_id uuid;
  reply_content text;
begin
  if current_user_id is null then
    raise exception 'authenticated user is required';
  end if;

  if p_content is null
     or char_length(btrim(p_content)) not between 1 and 20000
     or p_client_message_id is null
     or char_length(btrim(p_client_message_id)) not between 8 and 200 then
    raise exception 'invalid message input';
  end if;

  select m.id
  into existing_user_message_id
  from public.messages m
  where m.user_id = current_user_id
    and m.client_message_id = p_client_message_id
  limit 1;

  if existing_user_message_id is not null then
    select m.id
    into existing_assistant_message_id
    from public.messages m
    where m.user_id = current_user_id
      and m.reply_to_message_id = existing_user_message_id
      and m.sender = 'assistant'
    order by m.created_at asc
    limit 1;

    return query
    select existing_user_message_id, existing_assistant_message_id;
    return;
  end if;

  select r.current_persona_version_id, r.display_name
  into current_persona_id, role_name
  from public.profiles p
  join public.roles r
    on r.id = p_role_id
   and r.user_id = p.id
   and r.status = 'active'
  where p.id = current_user_id
    and p.current_role_id = p_role_id;

  if current_persona_id is null then
    raise exception 'current role and persona are required';
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.user_id = current_user_id
      and c.role_id = p_role_id
  ) then
    raise exception 'conversation must belong to the current role';
  end if;

  reply_content := case role_name
    when '周予安' then
      '我收到了。我们先把最需要处理的一件事说清楚，再一起决定下一步。'
    when '南枝' then
      '收到！先别把它们全扛在一起。挑一个最小、现在就能开始的动作，我们一起做。'
    else
      '我在。先不用急着一次理清全部，想从眼下最让你在意的一件事开始说吗？'
  end;

  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    client_message_id
  )
  values (
    current_user_id,
    p_conversation_id,
    p_role_id,
    'user',
    btrim(p_content),
    'completed',
    p_client_message_id
  )
  returning id into created_user_message_id;

  insert into public.messages (
    user_id,
    conversation_id,
    role_id,
    sender,
    content,
    status,
    persona_version_id,
    reply_to_message_id
  )
  values (
    current_user_id,
    p_conversation_id,
    p_role_id,
    'assistant',
    reply_content,
    'completed',
    current_persona_id,
    created_user_message_id
  )
  returning id into created_assistant_message_id;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id
    and user_id = current_user_id
    and role_id = p_role_id;

  return query
  select created_user_message_id, created_assistant_message_id;
end;
$$;

revoke all on function public.append_mock_chat_turn(uuid, uuid, text, text) from public;
grant execute on function public.append_mock_chat_turn(uuid, uuid, text, text)
  to authenticated;

commit;
