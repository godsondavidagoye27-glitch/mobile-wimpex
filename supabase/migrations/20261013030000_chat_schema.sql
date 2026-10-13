alter table public.profiles
  add column is_demo boolean not null default false,
  add column is_official boolean not null default false;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  avatar_path text,
  created_by uuid not null references auth.users (id) on delete cascade,
  read_only boolean not null default false,
  is_demo boolean not null default false,
  direct_key text unique,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (type = 'direct' and direct_key is not null)
    or (type = 'group' and direct_key is null)
  ),
  check (type <> 'group' or nullif(btrim(title), '') is not null)
);

create index conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last, id desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  is_demo boolean not null default false,
  last_read_message_id uuid,
  unread_count integer not null default 0 check (unread_count >= 0),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_active_idx
  on public.conversation_members (user_id, conversation_id)
  where left_at is null;

create function public.chat_is_active_member_internal(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_user_id is not null and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
  );
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  kind text not null check (kind in ('text', 'image', 'video', 'voice', 'call', 'system')),
  is_demo boolean not null default false,
  body text check (body is null or char_length(body) <= 2000),
  media_path text,
  media_duration_ms integer check (media_duration_ms is null or media_duration_ms >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  reply_to_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (sender_id, client_id),
  check (reply_to_id is null or reply_to_id <> id)
);

create index messages_conversation_order_idx
  on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

alter table public.conversations
  add constraint conversations_last_message_fk
  foreign key (last_message_id) references public.messages (id) on delete set null;
alter table public.conversation_members
  add constraint conversation_members_last_read_fk
  foreign key (last_read_message_id) references public.messages (id) on delete set null;

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  is_demo boolean not null default false,
  primary key (message_id, user_id, emoji)
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default true,
  notify_likes boolean not null default true,
  notify_comments boolean not null default true,
  notify_followers boolean not null default true,
  notify_messages boolean not null default true,
  notify_live boolean not null default true,
  show_online_status boolean not null default true
);

create table public.chat_message_rate_limits (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default clock_timestamp()
);
create index chat_message_rate_limits_sender_sent_idx
  on public.chat_message_rate_limits (sender_id, sent_at desc);

revoke all on public.chat_message_rate_limits from anon, authenticated;

create function public.chat_is_active_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_user_id is not null
    and (auth.uid() is null or p_user_id = auth.uid())
    and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
  );
$$;

create function public.chat_are_mutual_friends(p_first_id uuid, p_second_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.follows f
    where f.follower_id = p_first_id
      and f.following_id = p_second_id
      and f.status = 'accepted'
  ) and exists (
    select 1 from public.follows f
    where f.follower_id = p_second_id
      and f.following_id = p_first_id
      and f.status = 'accepted'
  );
$$;

create function public.chat_user_is_minor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and date_part('year', age(current_date, p.date_of_birth)) < 18
  );
$$;

create function public.chat_users_share_active_conversation(p_first_id uuid, p_second_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_first_id is not null
    and p_second_id is not null
    and auth.uid() in (p_first_id, p_second_id)
    and exists (
    select 1
    from public.conversation_members first_member
    join public.conversation_members second_member
      on second_member.conversation_id = first_member.conversation_id
    where first_member.user_id = p_first_id
      and second_member.user_id = p_second_id
      and first_member.left_at is null
      and second_member.left_at is null
  );
$$;

create function public.chat_user_shares_online(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select (p_user_id = auth.uid() or public.chat_users_share_active_conversation(auth.uid(), p_user_id))
    and not public.chat_user_is_minor(p_user_id)
    and coalesce((
      select settings.show_online_status
      from public.user_settings settings
      where settings.user_id = p_user_id
    ), true);
$$;

create function public.chat_check_minor_group_pairs(p_member_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  participant record;
  other_id uuid;
begin
  for participant in
    select distinct unnest(p_member_ids) as user_id
  loop
    if public.chat_user_is_minor(participant.user_id) then
      foreach other_id in array p_member_ids loop
        if participant.user_id <> other_id
          and not public.chat_are_mutual_friends(participant.user_id, other_id)
        then
          raise exception 'A mutual accepted follow is required before adding a person under 18 to this group.';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

create function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_id uuid := auth.uid();
  recipient public.profiles%rowtype;
  pair_key text;
  conversation_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to start a conversation.';
  end if;
  if other_user is null or other_user = caller_id then
    raise exception 'Choose another person to start a conversation.';
  end if;

  select * into recipient from public.profiles p where p.id = other_user;
  if not found then
    raise exception 'This profile is no longer available.';
  end if;
  if recipient.is_official then
    raise exception 'You cannot start a conversation with the official account.';
  end if;
  if exists (
    select 1 from public.blocks b
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
  insert into public.conversations (type, created_by, direct_key)
  values ('direct', caller_id, pair_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning id into conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conversation_id, caller_id, 'member'), (conversation_id, other_user, 'member')
  on conflict (conversation_id, user_id) do update
    set left_at = null;

  return conversation_id;
end;
$$;

create function public.create_group(group_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_id uuid := auth.uid();
  participants uuid[];
  participant_count integer;
  conversation_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to create a group.';
  end if;
  if nullif(btrim(group_title), '') is null or char_length(btrim(group_title)) > 80 then
    raise exception 'Group names must be between 1 and 80 characters.';
  end if;

  select array_agg(distinct user_id order by user_id)
  into participants
  from unnest(coalesce(member_ids, '{}'::uuid[]) || array[caller_id]) as user_id;
  participant_count := coalesce(cardinality(participants), 0);
  if participant_count < 2 or participant_count > 50 then
    raise exception 'Groups must have between 2 and 50 members.';
  end if;
  if exists (
    select 1 from unnest(participants) participant_id
    where not exists (select 1 from public.profiles p where p.id = participant_id)
  ) then
    raise exception 'One or more selected profiles are no longer available.';
  end if;
  if exists (
    select 1 from public.blocks b
    where b.blocker_id = any(participants) and b.blocked_id = any(participants)
  ) then
    raise exception 'A blocked relationship prevents these people from joining the same group.';
  end if;
  perform public.chat_check_minor_group_pairs(participants);

  insert into public.conversations (type, title, created_by)
  values ('group', btrim(group_title), caller_id)
  returning id into conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  select conversation_id, participant_id,
    case when participant_id = caller_id then 'owner' else 'member' end
  from unnest(participants) participant_id;

  return conversation_id;
end;
$$;

create function public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_id uuid := auth.uid();
  current_members uuid[];
  added_ids uuid[];
  existing_count integer;
begin
  if caller_id is null then raise exception 'You must be signed in.'; end if;
  if not exists (
    select 1 from public.conversations c
    join public.conversation_members cm on cm.conversation_id = c.id
    where c.id = p_conversation_id and c.type = 'group'
      and cm.user_id = caller_id and cm.left_at is null and cm.role in ('owner', 'admin')
  ) then
    raise exception 'Only a group owner or admin can add members.';
  end if;

  select array_agg(cm.user_id), count(*)
  into current_members, existing_count
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id and cm.left_at is null;
  select array_agg(distinct id order by id)
  into added_ids from unnest(coalesce(p_member_ids, '{}'::uuid[])) id
  where not (id = any(coalesce(current_members, '{}'::uuid[])));

  if coalesce(cardinality(added_ids), 0) = 0 then return; end if;
  if existing_count + cardinality(added_ids) > 50 then
    raise exception 'Groups can have no more than 50 active members.';
  end if;
  if exists (
    select 1 from unnest(added_ids) id
    where not exists (select 1 from public.profiles p where p.id = id)
  ) then
    raise exception 'One or more selected profiles are no longer available.';
  end if;
  if exists (
    select 1 from unnest(added_ids) id
    join public.conversation_members cm on cm.conversation_id = p_conversation_id and cm.left_at is null
    join public.blocks b on (b.blocker_id = id and b.blocked_id = cm.user_id)
      or (b.blocker_id = cm.user_id and b.blocked_id = id)
  ) then
    raise exception 'A blocked relationship prevents this person from joining the group.';
  end if;
  perform public.chat_check_minor_group_pairs(coalesce(current_members, '{}'::uuid[]) || added_ids);

  insert into public.conversation_members (conversation_id, user_id, role, left_at, joined_at)
  select p_conversation_id, id, 'member', null, now()
  from unnest(added_ids) id
  on conflict (conversation_id, user_id) do update
    set left_at = null, joined_at = now(), role = 'member';
end;
$$;

create function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_role text;
  target_role text;
begin
  select cm.role into caller_role
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid()
    and cm.left_at is null and c.type = 'group';
  if caller_role is null then raise exception 'Only a group owner or admin can remove members.'; end if;
  select role into target_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id and left_at is null;
  if target_role is null then raise exception 'This person is not an active group member.'; end if;
  if caller_role <> 'owner' and (caller_role <> 'admin' or target_role in ('owner', 'admin')) then
    raise exception 'You do not have permission to remove this group member.';
  end if;
  if target_role = 'owner' then raise exception 'The group owner must transfer ownership before leaving.'; end if;
  update public.conversation_members
  set left_at = now()
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

create function public.leave_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text;
  successor_id uuid;
begin
  select cm.role into caller_role
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation_id and cm.user_id = caller_id
    and cm.left_at is null and c.type = 'group';
  if caller_role is null then raise exception 'You are not an active member of this group.'; end if;
  if caller_role = 'owner' then
    select user_id into successor_id
    from public.conversation_members
    where conversation_id = p_conversation_id and user_id <> caller_id and left_at is null
    order by case role when 'admin' then 0 else 1 end, joined_at, user_id
    limit 1;
    if successor_id is null then
      delete from public.conversations where id = p_conversation_id;
      return;
    end if;
    update public.conversation_members set role = 'owner'
    where conversation_id = p_conversation_id and user_id = successor_id;
  end if;
  update public.conversation_members
  set left_at = now()
  where conversation_id = p_conversation_id and user_id = caller_id;
end;
$$;

create function public.enforce_chat_message_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  conversation public.conversations%rowtype;
  sender_is_official boolean;
  recent_count integer;
begin
  select * into conversation from public.conversations c where c.id = new.conversation_id;
  if not found then raise exception 'Conversation not found.'; end if;
  if exists (
    select 1 from public.messages m
    where m.sender_id = new.sender_id and m.client_id = new.client_id
  ) then
    return new;
  end if;
  select coalesce(p.is_official, false) into sender_is_official
  from public.profiles p where p.id = new.sender_id;
  if sender_is_official is null then
    raise exception 'Message sender profile not found.';
  end if;
  if not public.chat_is_active_member_internal(new.conversation_id, new.sender_id) then
    raise exception 'You are not an active member of this conversation.';
  end if;
  if conversation.read_only and not sender_is_official then
    raise exception 'This conversation is read only.';
  end if;
  if new.kind = 'system' and not sender_is_official then
    raise exception 'Only the official account can send system messages.';
  end if;
  if exists (
    select 1
    from public.conversation_members cm
    join public.blocks b on
      (b.blocker_id = new.sender_id and b.blocked_id = cm.user_id)
      or (b.blocker_id = cm.user_id and b.blocked_id = new.sender_id)
    where cm.conversation_id = new.conversation_id
      and cm.left_at is null
      and cm.user_id <> new.sender_id
  ) then
    raise exception 'You cannot message someone who has blocked you or whom you have blocked.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 0));
  delete from public.chat_message_rate_limits
  where sender_id = new.sender_id and sent_at <= clock_timestamp() - interval '1 minute';
  select count(*)::integer into recent_count
  from public.chat_message_rate_limits
  where sender_id = new.sender_id
    and sent_at > clock_timestamp() - interval '1 minute';
  if recent_count >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into public.chat_message_rate_limits (sender_id) values (new.sender_id);

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'The reply target must be a message in this conversation.';
  end if;
  return new;
end;
$$;

create trigger messages_enforce_rules
before insert on public.messages
for each row execute function public.enforce_chat_message_rules();

create function public.update_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.conversations
  set last_message_id = new.id, last_message_at = new.created_at
  where id = new.conversation_id;

  update public.conversation_members
  set unread_count = unread_count + 1
  where conversation_id = new.conversation_id
    and user_id <> new.sender_id
    and left_at is null;

  return new;
end;
$$;

create trigger messages_update_conversation
after insert on public.messages
for each row execute function public.update_conversation_after_message();

create function public.mark_read(p_conversation_id uuid, p_up_to_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  caller_id uuid := auth.uid();
  read_at timestamptz;
  unread integer;
begin
  if caller_id is null or not public.chat_is_active_member(p_conversation_id, caller_id) then
    raise exception 'You are not an active member of this conversation.';
  end if;
  select m.created_at into read_at from public.messages m
  where m.id = p_up_to_message_id and m.conversation_id = p_conversation_id;
  if read_at is null then
    raise exception 'The read position must refer to a message in this conversation.';
  end if;

  select count(*)::integer into unread
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> caller_id
    and (m.created_at, m.id) > (read_at, p_up_to_message_id);
  update public.conversation_members
  set last_read_message_id = p_up_to_message_id, unread_count = unread
  where conversation_members.conversation_id = p_conversation_id
    and user_id = caller_id and left_at is null;
end;
$$;

create function public.enforce_user_settings_age()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if public.chat_user_is_minor(new.user_id) then
    new.show_online_status := false;
  end if;
  return new;
end;
$$;

create trigger user_settings_enforce_age
before insert or update on public.user_settings
for each row execute function public.enforce_user_settings_age();

create function public.chat_can_access_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
set row_security = off
as $$
declare
  path_parts text[];
  message_part text;
  conversation_uuid uuid;
  message_uuid uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 1 then return false; end if;
  begin
    conversation_uuid := path_parts[1]::uuid;
    message_part := split_part(storage.filename(object_name), '.', 1);
    message_uuid := message_part::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.chat_is_active_member_internal(conversation_uuid, auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_uuid
        and m.conversation_id = conversation_uuid
        and m.sender_id = auth.uid()
        and m.media_path = object_name
    );
end;
$$;

create function public.create_welcome_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  official_id uuid;
  conversation_id uuid;
  conversation_key text;
begin
  if new.is_official then return new; end if;
  select id into official_id from public.profiles where username = 'wimpex' and is_official;
  if official_id is null then
    raise warning 'Welcome chat was not created: official Wimpex profile is unavailable.';
    return new;
  end if;

  conversation_key := least(official_id::text, new.id::text) || ':' || greatest(official_id::text, new.id::text);
  insert into public.conversations (type, created_by, read_only, direct_key)
  values ('direct', official_id, true, conversation_key)
  on conflict (direct_key) do nothing
  returning id into conversation_id;
  if conversation_id is null then
    select id into conversation_id from public.conversations where direct_key = conversation_key;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conversation_id, official_id, 'member'), (conversation_id, new.id, 'member')
  on conflict (conversation_id, user_id) do update set left_at = null;

  if not exists (select 1 from public.messages m where m.conversation_id = conversation_id) then
    insert into public.messages (conversation_id, sender_id, client_id, kind, body)
    values (
      conversation_id,
      official_id,
      gen_random_uuid(),
      'system',
      format(
        'Welcome to Wimpex, %s. Post your first video, follow people you know and say hello in chats. You can mute this chat at any time.',
        new.display_name
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'Welcome chat could not be created for profile %: %', new.id, sqlerrm;
  return new;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'f0a4c8b2-91d3-4a67-8b5c-1234567890ab',
  'authenticated',
  'authenticated',
  'official@wimpex.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"],"is_official":true}'::jsonb,
  '{"is_official":true}'::jsonb,
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, date_of_birth, dm_policy, is_official)
values (
  'f0a4c8b2-91d3-4a67-8b5c-1234567890ab',
  'wimpex',
  'Wimpex',
  date '1980-01-01',
  'none',
  true
)
on conflict (username) do update
set display_name = excluded.display_name, is_official = true
where public.profiles.id = excluded.id;

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = 'f0a4c8b2-91d3-4a67-8b5c-1234567890ab' and is_official
  ) then
    raise exception 'The username wimpex is already assigned to a different account.';
  end if;
end;
$$;

create trigger profiles_create_welcome_conversation
after insert on public.profiles
for each row execute function public.create_welcome_conversation();

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.user_settings enable row level security;

revoke all on public.conversations, public.conversation_members, public.messages,
  public.message_reactions, public.user_settings
  from anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages,
  public.message_reactions, public.user_settings to authenticated;
grant insert (conversation_id, sender_id, client_id, kind, body, media_path,
  media_duration_ms, width, height, reply_to_id)
  on public.messages to authenticated;
grant update (deleted_at) on public.messages to authenticated;
grant insert (message_id, user_id, emoji) on public.message_reactions to authenticated;
grant delete on public.message_reactions to authenticated;
grant insert (user_id, push_enabled, notify_likes, notify_comments, notify_followers,
  notify_messages, notify_live, show_online_status)
  on public.user_settings to authenticated;
grant update (push_enabled, notify_likes, notify_comments, notify_followers,
  notify_messages, notify_live, show_online_status)
  on public.user_settings to authenticated;
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, bio, link, date_of_birth, is_private, dm_policy)
  on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
grant insert (id, username, display_name, avatar_url, bio, link, date_of_birth,
  is_private, dm_policy, created_at)
  on public.profiles to authenticated;

create policy "Active conversation members can read conversations"
on public.conversations for select to authenticated
using (public.chat_is_active_member(id));

create policy "Active conversation members can read membership"
on public.conversation_members for select to authenticated
using (public.chat_is_active_member(conversation_id));

create policy "Active conversation members can read messages"
on public.messages for select to authenticated
using (public.chat_is_active_member(conversation_id));

create policy "Members send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.chat_is_active_member(conversation_id)
  and (
    not exists (select 1 from public.conversations c where c.id = conversation_id and c.read_only)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_official)
  )
);

create policy "Senders can soft delete their own messages"
on public.messages for update to authenticated
using (sender_id = auth.uid() and public.chat_is_active_member(conversation_id))
with check (
  sender_id = auth.uid()
  and deleted_at is not null
  and public.chat_is_active_member(conversation_id)
);

create policy "Members can read reactions"
on public.message_reactions for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_id and public.chat_is_active_member(m.conversation_id)
));

create policy "Members add their own reactions"
on public.message_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_id and public.chat_is_active_member(m.conversation_id)
  )
);

create policy "Members remove their own reactions"
on public.message_reactions for delete to authenticated
using (user_id = auth.uid() and exists (
  select 1 from public.messages m
  where m.id = message_id and public.chat_is_active_member(m.conversation_id)
));

create policy "Users read their own settings"
on public.user_settings for select to authenticated
using (user_id = auth.uid());

create policy "Users create their own settings"
on public.user_settings for insert to authenticated
with check (user_id = auth.uid());

create policy "Users update their own settings"
on public.user_settings for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on function public.chat_is_active_member(uuid, uuid) from public, anon;
revoke all on function public.chat_is_active_member_internal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_are_mutual_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_user_is_minor(uuid) from public, anon, authenticated;
revoke all on function public.chat_users_share_active_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_user_shares_online(uuid) from public, anon, authenticated;
revoke all on function public.chat_check_minor_group_pairs(uuid[]) from public, anon, authenticated;
revoke all on function public.enforce_chat_message_rules() from public, anon, authenticated;
revoke all on function public.update_conversation_after_message() from public, anon, authenticated;
revoke all on function public.enforce_user_settings_age() from public, anon, authenticated;
revoke all on function public.chat_can_access_media(text) from public, anon, authenticated;
revoke all on function public.create_welcome_conversation() from public, anon, authenticated;
revoke all on function public.start_direct_conversation(uuid) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
revoke all on function public.mark_read(uuid, uuid) from public, anon;
grant execute on function public.chat_is_active_member(uuid, uuid) to authenticated;
grant execute on function public.chat_users_share_active_conversation(uuid, uuid) to authenticated;
grant execute on function public.chat_user_shares_online(uuid) to authenticated;
grant execute on function public.chat_can_access_media(text) to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.mark_read(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mp4', 'audio/x-m4a']
)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Conversation members read chat media"
on storage.objects for select to authenticated
using (bucket_id = 'chat-media' and public.chat_can_access_media(name));

create policy "Conversation members upload chat media"
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-media' and public.chat_can_access_media(name));

create policy "Uploaders update chat media"
on storage.objects for update to authenticated
using (bucket_id = 'chat-media' and public.chat_can_access_media(name))
with check (bucket_id = 'chat-media' and public.chat_can_access_media(name));

create policy "Uploaders delete chat media"
on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and public.chat_can_access_media(name));

create policy "Active members receive chat broadcasts and presence"
on realtime.messages for select to authenticated
using (
  extension in ('broadcast', 'presence')
  and realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
  and public.chat_is_active_member(substring(realtime.topic() from 6)::uuid)
);

create policy "Active members send chat broadcasts and presence"
on realtime.messages for insert to authenticated
with check (
  extension in ('broadcast', 'presence')
  and realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
  and public.chat_is_active_member(substring(realtime.topic() from 6)::uuid)
);

create policy "Chat peers receive permitted online presence"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() ~ '^presence:[0-9a-fA-F-]{36}$'
  and (
    substring(realtime.topic() from 10)::uuid = auth.uid()
    or (
      public.chat_users_share_active_conversation(
        auth.uid(),
        substring(realtime.topic() from 10)::uuid
      )
      and public.chat_user_shares_online(substring(realtime.topic() from 10)::uuid)
    )
  )
);

create policy "Users track only their permitted online presence"
on realtime.messages for insert to authenticated
with check (
  extension = 'presence'
  and realtime.topic() ~ '^presence:[0-9a-fA-F-]{36}$'
  and substring(realtime.topic() from 10)::uuid = auth.uid()
  and public.chat_user_shares_online(auth.uid())
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
    ) then
      alter publication supabase_realtime add table public.conversation_members;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
    ) then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end;
$$;
