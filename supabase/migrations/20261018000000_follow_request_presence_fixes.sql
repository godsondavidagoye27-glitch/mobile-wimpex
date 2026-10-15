begin;

create or replace function public.get_follow_requests(
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null,
  p_page_size integer default 30
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  requested_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  result_limit integer := coalesce(p_page_size, 30);
begin
  if auth.uid() is null then
    raise exception 'Sign in to view follow requests.';
  end if;
  if result_limit < 1 or result_limit > 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.created_at
  from public.follows as f
  join public.profiles as p on p.id = f.follower_id
  where f.following_id = auth.uid()
    and f.status = 'pending'
    and not public.profile_blocked_pair(p.id, auth.uid())
    and (
      p_cursor_created_at is null
      or (f.created_at, p.id) < (p_cursor_created_at, p_cursor_user_id)
    )
  order by f.created_at desc, p.id desc
  limit result_limit;
end;
$function$;

revoke all on function public.get_follow_requests(timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_follow_requests(timestamptz, uuid, integer) to authenticated;

create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $function$
declare
  caller_id uuid := auth.uid();
  recipient public.profiles%rowtype;
  pair_key text;
  new_conversation_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to start a conversation.';
  end if;
  if other_user is null or other_user = caller_id then
    raise exception 'Choose another person to start a conversation.';
  end if;

  select p.* into recipient
  from public.profiles as p
  where p.id = other_user;
  if not found then
    raise exception 'This profile is no longer available.';
  end if;
  if recipient.is_official then
    raise exception 'You cannot start a conversation with the official account.';
  end if;
  if exists (
    select 1 from public.blocks as b
    where (b.blocker_id = caller_id and b.blocked_id = other_user)
       or (b.blocker_id = other_user and b.blocked_id = caller_id)
  ) then
    raise exception 'A conversation cannot be started because one of you has blocked the other.';
  end if;
  if recipient.dm_policy = 'none' then
    raise exception 'This person does not accept direct messages.';
  end if;
  if (
    recipient.dm_policy = 'friends'
    or public.chat_user_is_minor(caller_id)
    or public.chat_user_is_minor(other_user)
  ) and not public.chat_are_mutual_friends(caller_id, other_user) then
    raise exception 'A mutual accepted follow is required to message this person.';
  end if;

  pair_key := least(caller_id::text, other_user::text) || ':' || greatest(caller_id::text, other_user::text);
  insert into public.conversations as c (type, created_by, direct_key)
  values ('direct', caller_id, pair_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning c.id into new_conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (new_conversation_id, caller_id, 'member'), (new_conversation_id, other_user, 'member')
  on conflict (conversation_id, user_id) do update
    set left_at = null;

  return new_conversation_id;
end;
$function$;

revoke all on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid) to authenticated;

grant select, insert on realtime.messages to authenticated;

drop policy if exists "Users can read their own online presence topic" on realtime.messages;
create policy "Users can read their own online presence topic"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'presence:' || auth.uid()::text
);

drop policy if exists "Users can track their own online presence topic" on realtime.messages;
create policy "Users can track their own online presence topic"
on realtime.messages for insert to authenticated
with check (
  extension = 'presence'
  and realtime.topic() = 'presence:' || auth.uid()::text
);

commit;
