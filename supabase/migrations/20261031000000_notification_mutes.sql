begin;

create table public.notification_mutes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'community', 'conversation')),
  target_id uuid not null,
  muted_until timestamptz,
  mute_calls boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, target_type, target_id),
  check (target_type = 'user' or not mute_calls),
  check (target_type <> 'user' or owner_id <> target_id)
);

create index notification_mutes_owner_active_idx
  on public.notification_mutes (owner_id, target_type, target_id, muted_until);

alter table public.notification_mutes enable row level security;
revoke all on public.notification_mutes from public, anon, authenticated;
grant select on public.notification_mutes to authenticated;

create policy "Users read their own notification mutes"
on public.notification_mutes for select to authenticated
using (owner_id = auth.uid());

create function public.is_notification_muted(
  p_owner_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_calls_only boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_owner_id is not null
    and p_target_type in ('user', 'community', 'conversation')
    and p_target_id is not null
    and p_owner_id = auth.uid()
    and exists (
      select 1
      from public.notification_mutes mute
      where mute.owner_id = p_owner_id
        and mute.target_type = p_target_type
        and mute.target_id = p_target_id
        and (mute.muted_until is null or mute.muted_until > now())
        and (not p_calls_only or mute.mute_calls)
    );
$$;

create function public.mute_notification_target(
  p_target_type text,
  p_target_id uuid,
  p_duration_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Sign in to mute notifications.'; end if;
  if p_target_type not in ('user', 'community', 'conversation') or p_target_id is null then
    raise exception 'Choose a valid account, community, or conversation.';
  end if;
  if p_duration_minutes is not null and p_duration_minutes not in (60, 480, 10080) then
    raise exception 'Choose 1 hour, 8 hours, 1 week, or until you turn it back on.';
  end if;
  if p_target_type = 'user' and (
    p_target_id = owner_id
    or not exists (select 1 from public.profiles profile where profile.id = p_target_id)
  ) then
    raise exception 'This account cannot be muted.';
  end if;
  if p_target_type = 'community' and not public.can_view_community(p_target_id, owner_id) then
    raise exception 'You cannot mute notifications for this community.';
  end if;
  if p_target_type = 'conversation' and not public.chat_is_active_member(p_target_id, owner_id) then
    raise exception 'You cannot mute notifications for this conversation.';
  end if;

  insert into public.notification_mutes (owner_id, target_type, target_id, muted_until)
  values (
    owner_id,
    p_target_type,
    p_target_id,
    case when p_duration_minutes is null then null
      else now() + make_interval(mins => p_duration_minutes)
    end
  )
  on conflict (owner_id, target_type, target_id) do update
  set muted_until = excluded.muted_until,
      mute_calls = case
        when notification_mutes.muted_until is null or notification_mutes.muted_until > now()
          then notification_mutes.mute_calls
        else false
      end,
      updated_at = now();
end;
$$;

create function public.unmute_notification_target(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change notification mutes.'; end if;
  delete from public.notification_mutes
  where owner_id = auth.uid()
    and target_type = p_target_type
    and target_id = p_target_id;
end;
$$;

create function public.set_muted_user_calls(p_target_id uuid, p_mute_calls boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change call mutes.'; end if;
  update public.notification_mutes
  set mute_calls = p_mute_calls,
      updated_at = now()
  where owner_id = auth.uid()
    and target_type = 'user'
    and target_id = p_target_id
    and (muted_until is null or muted_until > now());
  if not found then raise exception 'Mute this account first to change its call setting.'; end if;
end;
$$;

create function public.get_my_notification_mutes()
returns table (
  target_type text,
  target_id uuid,
  muted_until timestamptz,
  mute_calls boolean,
  target_label text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view muted notifications.'; end if;
  return query
  select mute.target_type, mute.target_id, mute.muted_until, mute.mute_calls,
    case mute.target_type
      when 'user' then coalesce((
        select profile.display_name || ' · @' || profile.username
        from public.profiles profile where profile.id = mute.target_id
      ), 'Account')
      when 'community' then coalesce((
        select community.name from public.communities community where community.id = mute.target_id
      ), 'Community')
      else coalesce((
        select conversation.title
        from public.conversations conversation
        where conversation.id = mute.target_id
      ), (
        select profile.display_name
        from public.conversation_members member
        join public.profiles profile on profile.id = member.user_id
        where member.conversation_id = mute.target_id
          and member.user_id <> auth.uid()
          and member.left_at is null
        order by member.joined_at
        limit 1
      ), 'Conversation')
    end
  from public.notification_mutes mute
  where mute.owner_id = auth.uid()
    and (mute.muted_until is null or mute.muted_until > now())
  order by mute.target_type, mute.updated_at desc;
end;
$$;

create function public.filter_muted_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if exists (
    select 1 from public.notification_mutes mute
    where mute.owner_id = new.user_id
      and mute.target_type = 'user'
      and mute.target_id = new.actor_id
      and (mute.muted_until is null or mute.muted_until > now())
  ) then
    return null;
  end if;
  if new.community_id is not null and exists (
    select 1 from public.notification_mutes mute
    where mute.owner_id = new.user_id
      and mute.target_type = 'community'
      and mute.target_id = new.community_id
      and (mute.muted_until is null or mute.muted_until > now())
  ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger notifications_filter_muted_before_insert
before insert on public.notifications
for each row execute function public.filter_muted_notifications();

drop policy "Users read their own notifications" on public.notifications;
create policy "Users read their unmuted notifications"
on public.notifications for select to authenticated
using (
  user_id = auth.uid()
  and not public.is_notification_muted(user_id, 'user', actor_id)
  and (
    community_id is null
    or not public.is_notification_muted(user_id, 'community', community_id)
  )
);

revoke all on function public.is_notification_muted(uuid, text, uuid, boolean) from public, anon;
revoke all on function public.mute_notification_target(text, uuid, integer) from public, anon;
revoke all on function public.unmute_notification_target(text, uuid) from public, anon;
revoke all on function public.set_muted_user_calls(uuid, boolean) from public, anon;
revoke all on function public.get_my_notification_mutes() from public, anon;
revoke all on function public.filter_muted_notifications() from public, anon, authenticated;
grant execute on function public.is_notification_muted(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.mute_notification_target(text, uuid, integer) to authenticated;
grant execute on function public.unmute_notification_target(text, uuid) to authenticated;
grant execute on function public.set_muted_user_calls(uuid, boolean) to authenticated;
grant execute on function public.get_my_notification_mutes() to authenticated;

commit;
