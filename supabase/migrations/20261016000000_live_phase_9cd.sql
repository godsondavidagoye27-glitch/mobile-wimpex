begin;

create table public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  room_name text not null unique,
  title text not null default '' check (char_length(btrim(title)) <= 100),
  status text not null default 'starting'
    check (status in ('starting', 'live', 'ended')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index live_streams_one_active_host_idx
  on public.live_streams (host_id)
  where status in ('starting', 'live');
create index live_streams_live_started_idx
  on public.live_streams (started_at desc, id)
  where status = 'live';

create table public.live_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index live_messages_stream_created_idx
  on public.live_messages (stream_id, created_at, id);

create table public.live_mutes (
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (stream_id, user_id),
  check (user_id <> muted_by)
);
create index live_mutes_expiry_idx on public.live_mutes (expires_at);

create table public.live_bans (
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  banned_by uuid not null references public.profiles (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 300),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (stream_id, user_id),
  check (user_id <> banned_by)
);
create index live_bans_expiry_idx on public.live_bans (expires_at)
  where expires_at is not null;

alter table public.notifications
  add column live_stream_id uuid references public.live_streams (id) on delete cascade;
alter table public.notifications
  drop constraint if exists notifications_dedupe_key;
alter table public.notifications
  drop constraint if exists notifications_user_id_actor_id_type_post_id_comment_id_key;
alter table public.notifications
  add constraint notifications_dedupe_key
  unique nulls not distinct (
    user_id, actor_id, type, post_id, comment_id, community_id, live_stream_id
  );

alter table public.live_streams enable row level security;
alter table public.live_messages enable row level security;
alter table public.live_mutes enable row level security;
alter table public.live_bans enable row level security;

revoke all on public.live_streams, public.live_messages, public.live_mutes, public.live_bans
  from anon, authenticated;
grant select on public.live_streams, public.live_messages to authenticated;

create function public.can_view_live(
  p_stream_id uuid,
  p_viewer_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select coalesce(
    auth.uid() = p_viewer_id
      or auth.role() = 'service_role',
    false
  )
  and exists (
    select 1
    from public.live_streams stream
    join public.profiles host on host.id = stream.host_id
    left join public.profiles viewer on viewer.id = p_viewer_id
    where stream.id = p_stream_id
      and viewer.id is not null
      and (
        (
          stream.host_id = p_viewer_id
          and stream.status in ('starting', 'live')
        )
        or (
          stream.status = 'live'
          and (
            not host.is_private
            or exists (
              select 1 from public.follows follow
              where follow.follower_id = p_viewer_id
                and follow.following_id = stream.host_id
                and follow.status = 'accepted'
            )
          )
          and not exists (
            select 1 from public.blocks block_pair
            where (block_pair.blocker_id = stream.host_id and block_pair.blocked_id = p_viewer_id)
               or (block_pair.blocker_id = p_viewer_id and block_pair.blocked_id = stream.host_id)
          )
          and not exists (
            select 1 from public.live_bans ban
            where ban.stream_id = stream.id
              and ban.user_id = p_viewer_id
              and (ban.expires_at is null or ban.expires_at > now())
          )
        )
      )
  );
$$;

create policy "Hosts and eligible viewers can read live streams"
on public.live_streams for select to authenticated
using (host_id = auth.uid() or public.can_view_live(id, auth.uid()));

create policy "Eligible viewers can read live messages"
on public.live_messages for select to authenticated
using (
  public.can_view_live(stream_id, auth.uid())
  and exists (
    select 1 from public.live_streams stream
    where stream.id = live_messages.stream_id and stream.status = 'live'
  )
);

create function public.attach_live_notification_stream()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  context_stream_id uuid;
begin
  if new.type = 'live' and new.live_stream_id is null then
    context_stream_id := nullif(current_setting('app.live_stream_id', true), '')::uuid;
    if context_stream_id is not null and exists (
      select 1 from public.live_streams stream
      where stream.id = context_stream_id
        and stream.host_id = new.actor_id
        and stream.status = 'live'
    ) then
      new.live_stream_id := context_stream_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_attach_live_stream
before insert on public.notifications
for each row execute function public.attach_live_notification_stream();

create function public.start_live(p_title text default '')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  stream_id uuid;
begin
  if current_user_id is null then raise exception 'Sign in to start a live stream.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) > 100 then
    raise exception 'Live titles must be 100 characters or fewer.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = current_user_id
      and not profile.is_demo
      and not profile.is_official
      and date_part('year', age(current_date, profile.date_of_birth)) between 18 and 120
  ) then
    raise exception 'Live streaming is currently limited to adult accounts.';
  end if;

  insert into public.live_streams (host_id, room_name, title)
  values (
    current_user_id,
    'live-' || gen_random_uuid()::text,
    btrim(coalesce(p_title, ''))
  )
  returning id into stream_id;
  return stream_id;
exception
  when unique_violation then
    raise exception 'You already have an active live stream.';
end;
$$;

create function public.mark_live_started(p_stream_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Sign in to start a live stream.'; end if;
  update public.live_streams
  set status = 'live', started_at = now(), heartbeat_at = now()
  where id = p_stream_id and host_id = current_user_id and status = 'starting';
  if not found then raise exception 'This live stream cannot be started.'; end if;

  perform set_config('app.live_stream_id', p_stream_id::text, true);
  perform public.create_notification(follow.follower_id, current_user_id, 'live')
  from public.follows follow
  where follow.following_id = current_user_id
    and follow.status = 'accepted'
    and not exists (
      select 1 from public.blocks block_pair
      where (block_pair.blocker_id = current_user_id and block_pair.blocked_id = follow.follower_id)
         or (block_pair.blocker_id = follow.follower_id and block_pair.blocked_id = current_user_id)
    );
  return true;
end;
$$;

create function public.live_heartbeat(p_stream_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to continue a live stream.'; end if;
  update public.live_streams
  set heartbeat_at = now()
  where id = p_stream_id and host_id = auth.uid() and status = 'live';
  if not found then raise exception 'This live stream is no longer active.'; end if;
  return true;
end;
$$;

create function public.end_live(p_stream_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to end a live stream.'; end if;
  update public.live_streams
  set status = 'ended', ended_at = now()
  where id = p_stream_id and host_id = auth.uid() and status in ('starting', 'live');
  if found then return true; end if;
  if exists (
    select 1 from public.live_streams
    where id = p_stream_id and host_id = auth.uid() and status = 'ended'
  ) then return false; end if;
  raise exception 'You cannot end this live stream.';
end;
$$;

create function public.get_live_streams(p_limit integer default 50)
returns table (
  stream_id uuid,
  host_id uuid,
  title text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  host_username text,
  host_display_name text,
  host_avatar_url text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view live streams.'; end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Choose a live stream page size from 1 to 100.';
  end if;
  return query
  select stream.id, stream.host_id, stream.title, stream.status, stream.created_at,
    stream.started_at, host.username, host.display_name, host.avatar_url
  from public.live_streams stream
  join public.profiles host on host.id = stream.host_id
  where stream.status = 'live'
    and public.can_view_live(stream.id, auth.uid())
  order by stream.started_at desc, stream.id
  limit p_limit;
end;
$$;

create function public.get_live_stream(p_stream_id uuid)
returns table (
  stream_id uuid,
  host_id uuid,
  title text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  host_username text,
  host_display_name text,
  host_avatar_url text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view this live stream.'; end if;
  return query
  select stream.id, stream.host_id, stream.title, stream.status, stream.created_at,
    stream.started_at, host.username, host.display_name, host.avatar_url
  from public.live_streams stream
  join public.profiles host on host.id = stream.host_id
  where stream.id = p_stream_id
    and stream.status = 'live'
    and public.can_view_live(stream.id, auth.uid());
end;
$$;

create function public.send_live_message(p_stream_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  message_id uuid;
begin
  if current_user_id is null then raise exception 'Sign in to chat in a live stream.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'Live messages must contain 1 to 500 characters.';
  end if;
  if not public.can_view_live(p_stream_id, current_user_id) then
    raise exception 'This live stream is not available to you.';
  end if;

  perform 1 from public.live_streams
  where id = p_stream_id and status = 'live'
  for update;
  if not found then raise exception 'This live stream is no longer active.'; end if;
  if exists (
    select 1 from public.live_mutes mute
    where mute.stream_id = p_stream_id
      and mute.user_id = current_user_id
      and mute.expires_at > now()
  ) then
    raise exception 'You are muted in this live stream.';
  end if;

  insert into public.live_messages (stream_id, author_id, body)
  values (p_stream_id, current_user_id, btrim(p_body))
  returning id into message_id;
  return message_id;
end;
$$;

create function public.delete_live_message(p_stream_id uuid, p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Sign in to delete a live message.'; end if;
  update public.live_messages message
  set body = 'Message deleted', deleted_at = now()
  from public.live_streams stream
  where message.id = p_message_id
    and message.deleted_at is null
    and stream.id = message.stream_id
    and stream.id = p_stream_id
    and stream.status = 'live'
    and (
      message.author_id = current_user_id
      or stream.host_id = current_user_id
    );
  if not found then raise exception 'You cannot delete this live message.'; end if;
  return true;
end;
$$;

create function public.mute_live_user(
  p_stream_id uuid,
  p_user_id uuid,
  p_duration_seconds integer default 300
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  mute_expires_at timestamptz;
begin
  if current_user_id is null then raise exception 'Sign in to moderate a live stream.'; end if;
  if p_user_id = current_user_id then raise exception 'You cannot mute yourself.'; end if;
  if p_duration_seconds is null or p_duration_seconds not between 1 and 86400 then
    raise exception 'Mute duration must be between 1 second and 24 hours.';
  end if;
  if not exists (
    select 1 from public.live_streams stream
    where stream.id = p_stream_id
      and stream.host_id = current_user_id
      and stream.status = 'live'
  ) then
    raise exception 'Only the host can moderate an active live stream.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This profile is unavailable.';
  end if;

  mute_expires_at := now() + make_interval(secs => p_duration_seconds);
  insert into public.live_mutes (stream_id, user_id, muted_by, expires_at)
  values (p_stream_id, p_user_id, current_user_id, mute_expires_at)
  on conflict (stream_id, user_id) do update
  set muted_by = excluded.muted_by, expires_at = excluded.expires_at, created_at = now();
  return mute_expires_at;
end;
$$;

create function public.ban_live_user(
  p_stream_id uuid,
  p_user_id uuid,
  p_reason text default null,
  p_duration_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  ban_expires_at timestamptz;
begin
  if current_user_id is null then raise exception 'Sign in to moderate a live stream.'; end if;
  if p_user_id = current_user_id then raise exception 'You cannot ban yourself.'; end if;
  if p_duration_seconds is not null and p_duration_seconds not between 1 and 2592000 then
    raise exception 'Ban duration must be between 1 second and 30 days.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) > 300 then
    raise exception 'Ban reasons must be 300 characters or fewer.';
  end if;
  if not exists (
    select 1 from public.live_streams stream
    where stream.id = p_stream_id
      and stream.host_id = current_user_id
      and stream.status = 'live'
  ) then
    raise exception 'Only the host can moderate an active live stream.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This profile is unavailable.';
  end if;

  ban_expires_at := case
    when p_duration_seconds is null then null
    else now() + make_interval(secs => p_duration_seconds)
  end;
  insert into public.live_bans (stream_id, user_id, banned_by, reason, expires_at)
  values (p_stream_id, p_user_id, current_user_id, nullif(btrim(p_reason), ''), ban_expires_at)
  on conflict (stream_id, user_id) do update
  set banned_by = excluded.banned_by, reason = excluded.reason,
    expires_at = excluded.expires_at, created_at = now();
  delete from public.live_mutes where stream_id = p_stream_id and user_id = p_user_id;
  return true;
end;
$$;

create function public.reap_stale_lives()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  ended_count integer;
begin
  if auth.uid() is not null then
    raise exception 'Only a scheduled server process can reap live streams.';
  end if;
  update public.live_streams
  set status = 'ended', ended_at = now()
  where status = 'starting' and created_at < now() - interval '2 minutes'
     or status = 'live' and heartbeat_at < now() - interval '90 seconds';
  get diagnostics ended_count = row_count;
  return ended_count;
end;
$$;

revoke all on function public.can_view_live(uuid, uuid) from public, anon;
revoke all on function public.attach_live_notification_stream() from public, anon, authenticated;
revoke all on function public.start_live(text) from public, anon;
revoke all on function public.mark_live_started(uuid) from public, anon;
revoke all on function public.live_heartbeat(uuid) from public, anon;
revoke all on function public.end_live(uuid) from public, anon;
revoke all on function public.get_live_streams(integer) from public, anon;
revoke all on function public.get_live_stream(uuid) from public, anon;
revoke all on function public.send_live_message(uuid, text) from public, anon;
revoke all on function public.delete_live_message(uuid, uuid) from public, anon;
revoke all on function public.mute_live_user(uuid, uuid, integer) from public, anon;
revoke all on function public.ban_live_user(uuid, uuid, text, integer) from public, anon;
revoke all on function public.reap_stale_lives() from public, anon, authenticated;

grant execute on function public.can_view_live(uuid, uuid) to authenticated, service_role;
grant execute on function public.start_live(text) to authenticated;
grant execute on function public.mark_live_started(uuid) to authenticated;
grant execute on function public.live_heartbeat(uuid) to authenticated;
grant execute on function public.end_live(uuid) to authenticated;
grant execute on function public.get_live_streams(integer) to authenticated;
grant execute on function public.get_live_stream(uuid) to authenticated;
grant execute on function public.send_live_message(uuid, text) to authenticated;
grant execute on function public.delete_live_message(uuid, uuid) to authenticated;
grant execute on function public.mute_live_user(uuid, uuid, integer) to authenticated;
grant execute on function public.ban_live_user(uuid, uuid, text, integer) to authenticated;
grant execute on function public.reap_stale_lives() to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_streams'
    ) then
      alter publication supabase_realtime add table public.live_streams;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_messages'
    ) then
      alter publication supabase_realtime add table public.live_messages;
    end if;
  end if;
end;
$$;

commit;
