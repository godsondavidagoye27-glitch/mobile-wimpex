alter table public.profiles
  add column followers_count integer not null default 0,
  add column following_count integer not null default 0,
  add column likes_received_count integer not null default 0,
  add column username_changed_at timestamptz;

alter table public.posts
  add column pinned_at timestamptz;

alter table public.user_settings
  add column show_liked_videos boolean not null default false,
  add column personalized_recommendations boolean not null default true;

alter table public.profiles
  add constraint profiles_bio_max_length
    check (bio is null or char_length(bio) <= 150) not valid,
  add constraint profiles_https_link_max_length
    check (link is null or (char_length(link) <= 100 and link ~* '^https://')) not valid,
  add constraint profiles_reserved_username
    check (username <> all (array[
      'wimpex', 'admin', 'support', 'help', 'official', 'moderator', 'null', 'undefined',
      'api', 'login', 'logout', 'signup', 'sign-up', 'register', 'account', 'profile',
      'settings', 'notifications', 'notification', 'message', 'messages', 'chat', 'chats',
      'search', 'discover', 'explore', 'about', 'terms', 'privacy', 'report', 'block',
      'follow', 'followers', 'following', 'live', 'video', 'videos', 'post', 'posts',
      'community', 'communities', 'create', 'verify', 'email', 'auth', 'feed', 'home'
    ])) not valid;

update public.profiles p
set followers_count = counts.followers,
    following_count = counts.following
from (
  select profile_id,
    count(*) filter (where following_id = profile_id and status = 'accepted')::integer as followers,
    count(*) filter (where follower_id = profile_id and status = 'accepted')::integer as following
  from (
    select following_id as profile_id, follower_id, following_id, status from public.follows
    union all
    select follower_id as profile_id, follower_id, following_id, status from public.follows
  ) relations
  group by profile_id
) counts
where p.id = counts.profile_id;

update public.profiles p
set likes_received_count = counts.likes
from (
  select posts.author_id, count(*)::integer as likes
  from public.post_likes likes
  join public.posts on posts.id = likes.post_id
  group by posts.author_id
) counts
where p.id = counts.author_id;

create function public.profile_blocked_pair(p_profile_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = p_viewer_id and exists (
    select 1
    from public.blocks b
    where (b.blocker_id = p_profile_id and b.blocked_id = p_viewer_id)
       or (b.blocker_id = p_viewer_id and b.blocked_id = p_profile_id)
  );
$$;

create function public.profile_lists_visible(p_profile_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = p_viewer_id
    and exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id
        and (
          p.id = p_viewer_id
          or not p.is_private
          or exists (
            select 1 from public.follows f
            where f.follower_id = p_viewer_id
              and f.following_id = p_profile_id
              and f.status = 'accepted'
          )
        )
        and not exists (
          select 1 from public.blocks b
          where (b.blocker_id = p_profile_id and b.blocked_id = p_viewer_id)
             or (b.blocker_id = p_viewer_id and b.blocked_id = p_profile_id)
        )
    );
$$;

create function public.profile_likes_visible(p_profile_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = p_viewer_id
    and exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id
        and (
          p.id = p_viewer_id
          or (
            not p.is_private
            or exists (
              select 1 from public.follows f
              where f.follower_id = p_viewer_id
                and f.following_id = p_profile_id
                and f.status = 'accepted'
            )
          )
        )
        and not exists (
          select 1 from public.blocks b
          where (b.blocker_id = p_profile_id and b.blocked_id = p_viewer_id)
             or (b.blocker_id = p_viewer_id and b.blocked_id = p_profile_id)
        )
        and (
          p.id = p_viewer_id
          or exists (
            select 1 from public.user_settings s
            where s.user_id = p_profile_id
              and s.show_liked_videos
          )
        )
    );
$$;

revoke all on function public.profile_blocked_pair(uuid, uuid) from public, anon;
revoke all on function public.profile_lists_visible(uuid, uuid) from public, anon;
revoke all on function public.profile_likes_visible(uuid, uuid) from public, anon;
grant execute on function public.profile_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.profile_lists_visible(uuid, uuid) to authenticated;
grant execute on function public.profile_likes_visible(uuid, uuid) to authenticated;

create function public.protect_profile_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  reserved_names text[] := array[
    'wimpex', 'admin', 'support', 'help', 'official', 'moderator', 'null', 'undefined',
    'api', 'login', 'logout', 'signup', 'sign-up', 'register', 'account', 'profile',
    'settings', 'notifications', 'notification', 'message', 'messages', 'chat', 'chats',
    'search', 'discover', 'explore', 'about', 'terms', 'privacy', 'report', 'block',
    'follow', 'followers', 'following', 'live', 'video', 'videos', 'post', 'posts',
    'community', 'communities', 'create', 'verify', 'email', 'auth', 'feed', 'home'
  ];
  changed_at timestamptz;
begin
  if new.username <> lower(new.username) or new.username = any(reserved_names) then
    raise exception 'That username is reserved or unavailable.';
  end if;
  if new.bio is not null and char_length(new.bio) > 150 then
    raise exception 'Bio must be 150 characters or fewer.';
  end if;
  if new.link is not null and (
    char_length(new.link) > 100 or new.link !~* '^https://'
  ) then
    raise exception 'Enter a link that starts with https://';
  end if;

  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    changed_at := old.username_changed_at;
    if changed_at is not null and changed_at > now() - interval '14 days' then
      raise exception 'You can change your username again on %.',
        to_char(changed_at + interval '14 days', 'FMMonth DD, YYYY');
    end if;
    new.username_changed_at := now();
  end if;

  if tg_op = 'UPDATE' and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'Date of birth cannot be changed.';
  end if;

  if tg_op = 'UPDATE' and new.is_private is distinct from old.is_private
    and date_part('year', age(current_date, new.date_of_birth)) < 18
    and not new.is_private
  then
    raise exception 'Accounts under 18 stay private.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_changes
before insert or update on public.profiles
for each row execute function public.protect_profile_changes();

create function public.update_profile_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  old_active boolean := false;
  new_active boolean := false;
  follower uuid;
  followed uuid;
begin
  if tg_op <> 'INSERT' then
    old_active := old.status = 'accepted';
    follower := old.follower_id;
    followed := old.following_id;
  end if;
  if tg_op <> 'DELETE' then
    new_active := new.status = 'accepted';
    follower := new.follower_id;
    followed := new.following_id;
  end if;

  if old_active and not new_active then
    update public.profiles set following_count = greatest(0, following_count - 1) where id = follower;
    update public.profiles set followers_count = greatest(0, followers_count - 1) where id = followed;
  elsif new_active and not old_active then
    update public.profiles set following_count = following_count + 1 where id = follower;
    update public.profiles set followers_count = followers_count + 1 where id = followed;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger follows_update_profile_counts
after insert or update or delete on public.follows
for each row execute function public.update_profile_follow_counts();

create function public.update_profile_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_post_id uuid;
  affected_user_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_post_id := old.post_id;
  else
    affected_post_id := new.post_id;
  end if;
  select author_id into affected_user_id
  from public.posts where id = affected_post_id;
  if affected_user_id is not null then
    if tg_op = 'DELETE' then
      update public.profiles
      set likes_received_count = greatest(0, likes_received_count - 1)
      where id = affected_user_id;
    else
      update public.profiles
      set likes_received_count = likes_received_count + 1
      where id = affected_user_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger post_likes_update_profile_count
after insert or delete on public.post_likes
for each row execute function public.update_profile_like_count();

create function public.enforce_profile_pin_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pinned_at is not null then
    if tg_op = 'INSERT' or old.pinned_at is null then
      perform 1 from public.profiles p
      where p.id = new.author_id
      for update;
      if (
        select count(*) from public.posts p
        where p.author_id = new.author_id
          and p.pinned_at is not null
          and p.id <> new.id
      ) >= 3 then
        raise exception 'You can pin up to 3 videos.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger posts_enforce_profile_pin_limit
before insert or update of pinned_at on public.posts
for each row execute function public.enforce_profile_pin_limit();

create function public.remove_deleted_post_likes_from_profile_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.profiles
  set likes_received_count = greatest(
    0,
    likes_received_count - (
      select count(*)::integer from public.post_likes l where l.post_id = old.id
    )
  )
  where id = old.author_id;
  return old;
end;
$$;

create trigger posts_remove_deleted_likes_from_profile_count
before delete on public.posts
for each row execute function public.remove_deleted_post_likes_from_profile_count();

create or replace function public.is_username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select lower(name) !~ '^(wimpex|admin|support|help|official|moderator|null|undefined|api|login|logout|signup|sign-up|register|account|profile|settings|notifications|notification|message|messages|chat|chats|search|discover|explore|about|terms|privacy|report|block|follow|followers|following|live|video|videos|post|posts|community|communities|create|verify|email|auth|feed|home)$'
    and not exists (
      select 1 from public.profiles p where p.username = lower(name)
    );
$$;

create or replace function public.get_profile(p_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  link text,
  is_private boolean,
  dm_policy text,
  followers_count integer,
  following_count integer,
  likes_received_count integer,
  username_changed_at timestamptz,
  is_me boolean,
  is_following boolean,
  follow_status text,
  follows_me boolean,
  is_blocked_by_me boolean,
  has_blocked_me boolean,
  can_view_posts boolean,
  can_view_liked boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.link,
    p.is_private,
    p.dm_policy,
    p.followers_count,
    p.following_count,
    p.likes_received_count,
    p.username_changed_at,
    p.id = auth.uid(),
    coalesce(f.status = 'accepted', false),
    coalesce(f.status, 'none'),
    exists (
      select 1 from public.follows inbound
      where inbound.follower_id = p.id
        and inbound.following_id = auth.uid()
        and inbound.status = 'accepted'
    ),
    exists (
      select 1 from public.blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = p.id
    ),
    public.profile_blocked_pair(p.id, auth.uid())
      and exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid()),
    p.id = auth.uid()
      or (
        (not p.is_private or f.status = 'accepted')
        and not public.profile_blocked_pair(p.id, auth.uid())
      ),
    public.profile_likes_visible(p.id, auth.uid())
  from public.profiles p
  left join public.follows f
    on f.follower_id = auth.uid()
   and f.following_id = p.id
  where (
      (p_username is null and p.id = auth.uid())
      or lower(p.username) = lower(trim(p_username))
    )
    and auth.uid() is not null
    and not (
      public.profile_blocked_pair(p.id, auth.uid())
      and exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid())
    );
$$;

create function public.get_profile_posts(
  p_user_id uuid,
  p_tab text,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 24,
  p_cursor_pinned boolean default null
)
returns table (
  post jsonb,
  author jsonb,
  is_liked boolean,
  is_saved boolean,
  is_following boolean
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result_limit integer := coalesce(p_page_size, 24);
begin
  if auth.uid() is null then raise exception 'Sign in to view profiles.'; end if;
  if p_tab not in ('posts', 'liked', 'saved') then raise exception 'Profile tab is invalid.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Page size must be between 1 and 50.'; end if;
  if p_tab = 'saved' and p_user_id <> auth.uid() then raise exception 'Saved videos are private.'; end if;

  return query
  select
    to_jsonb(p),
    jsonb_build_object(
      'username', profile.username,
      'display_name', profile.display_name,
      'avatar_url', profile.avatar_url
    ),
    exists (
      select 1 from public.post_likes l
      where l.post_id = p.id and l.user_id = auth.uid()
    ),
    exists (
      select 1 from public.post_saves s
      where s.post_id = p.id and s.user_id = auth.uid()
    ),
    exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid()
        and f.following_id = p.author_id
        and f.status = 'accepted'
    )
  from public.posts p
  join public.profiles profile on profile.id = p.author_id
  where p.author_id = p_user_id
    and p.status = 'published'
    and public.can_view_post(p.id, auth.uid())
    and (
      p_tab = 'posts'
      or (
        p_tab = 'liked'
        and public.profile_likes_visible(p_user_id, auth.uid())
        and exists (
          select 1 from public.post_likes l
          where l.post_id = p.id and l.user_id = p_user_id
        )
      )
      or (
        p_tab = 'saved'
        and exists (
          select 1 from public.post_saves s
          where s.post_id = p.id and s.user_id = auth.uid()
        )
      )
    )
    and (
      p_cursor_created_at is null
      or (
        (p_tab = 'posts' and p.pinned_at is not null) < coalesce(p_cursor_pinned, false)
      )
      or (
        (p_tab = 'posts' and p.pinned_at is not null) = coalesce(p_cursor_pinned, false)
        and (p.published_at, p.id) < (p_cursor_created_at, p_cursor_id)
      )
    )
  order by (p_tab = 'posts' and p.pinned_at is not null) desc, p.published_at desc, p.id desc
  limit result_limit;
end;
$$;

create function public.get_follow_list(
  p_user_id uuid,
  p_kind text,
  p_query text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null,
  p_page_size integer default 30
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_following boolean,
  follow_status text,
  followed_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result_limit integer := coalesce(p_page_size, 30);
begin
  if auth.uid() is null then raise exception 'Sign in to view follow lists.'; end if;
  if p_kind not in ('followers', 'following') then raise exception 'Follow list type is invalid.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Page size must be between 1 and 50.'; end if;
  if not public.profile_lists_visible(p_user_id, auth.uid()) then
    raise exception 'This account is private.';
  end if;

  return query
  select
    other.id,
    other.username,
    other.display_name,
    other.avatar_url,
    coalesce(my_follow.status = 'accepted', false),
    coalesce(my_follow.status, 'none'),
    relation.created_at
  from public.follows relation
  join public.profiles other
    on other.id = case when p_kind = 'followers' then relation.follower_id else relation.following_id end
  left join public.follows my_follow
    on my_follow.follower_id = auth.uid()
   and my_follow.following_id = other.id
  where case when p_kind = 'followers'
    then relation.following_id = p_user_id and relation.status = 'accepted'
    else relation.follower_id = p_user_id and relation.status = 'accepted'
  end
    and not public.profile_blocked_pair(other.id, auth.uid())
    and (
      coalesce(trim(p_query), '') = ''
      or other.username ilike '%' || trim(p_query) || '%'
      or other.display_name ilike '%' || trim(p_query) || '%'
    )
    and (
      p_cursor_created_at is null
      or (relation.created_at, other.id) < (p_cursor_created_at, p_cursor_user_id)
    )
  order by relation.created_at desc, other.id desc
  limit result_limit;
end;
$$;

create function public.follow_user(p_target uuid)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  result_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to follow people.'; end if;
  if p_target = auth.uid() then raise exception 'You cannot follow yourself.'; end if;
  if public.profile_blocked_pair(p_target, auth.uid()) then raise exception 'This profile is unavailable.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'This profile is unavailable.';
  end if;

  insert into public.follows (follower_id, following_id)
  values (auth.uid(), p_target)
  on conflict (follower_id, following_id) do nothing;

  select f.status into result_status
  from public.follows f
  where f.follower_id = auth.uid() and f.following_id = p_target;
  return coalesce(result_status, 'none');
end;
$$;

create function public.unfollow_user(p_target uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to unfollow people.'; end if;
  delete from public.follows
  where follower_id = auth.uid()
    and following_id = p_target
    and status = 'accepted';
end;
$$;

create function public.cancel_follow_request(p_target uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to cancel a follow request.'; end if;
  delete from public.follows
  where follower_id = auth.uid()
    and following_id = p_target
    and status = 'pending';
end;
$$;

create function public.respond_follow_request(p_follower uuid, p_accept boolean)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  affected_rows integer;
begin
  if auth.uid() is null then raise exception 'Sign in to respond to follow requests.'; end if;
  if p_accept then
    update public.follows
    set status = 'accepted'
    where follower_id = p_follower
      and following_id = auth.uid()
      and status = 'pending';
  else
    delete from public.follows
    where follower_id = p_follower
      and following_id = auth.uid()
      and status = 'pending';
  end if;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then raise exception 'Follow request is no longer available.'; end if;
end;
$$;

create function public.get_follow_requests(
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
as $$
declare
  result_limit integer := coalesce(p_page_size, 30);
begin
  if auth.uid() is null then raise exception 'Sign in to view follow requests.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Page size must be between 1 and 50.'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.id = f.follower_id
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
$$;

create function public.set_account_privacy(p_is_private boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  born_on date;
begin
  if viewer_id is null then raise exception 'Sign in to update your privacy setting.'; end if;
  select date_of_birth into born_on from public.profiles where id = viewer_id;
  if born_on is null then raise exception 'Your profile could not be found.'; end if;
  if not p_is_private and date_part('year', age(current_date, born_on)) < 18 then
    raise exception 'Accounts under 18 stay private.';
  end if;
  update public.profiles set is_private = p_is_private where id = viewer_id;
  if not p_is_private then
    update public.follows
    set status = 'accepted'
    where following_id = viewer_id and status = 'pending';
  end if;
end;
$$;

alter table public.blocks
  add column blocked_username text not null default '',
  add column blocked_display_name text not null default '',
  add column blocked_avatar_url text;

update public.blocks b
set blocked_username = p.username,
    blocked_display_name = p.display_name,
    blocked_avatar_url = p.avatar_url
from public.profiles p
where p.id = b.blocked_id;

create function public.sync_blocked_profile_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.username is distinct from old.username
    or new.display_name is distinct from old.display_name
    or new.avatar_url is distinct from old.avatar_url
  then
    update public.blocks
    set blocked_username = new.username,
        blocked_display_name = new.display_name,
        blocked_avatar_url = new.avatar_url
    where blocked_id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_blocked_snapshot
after update of username, display_name, avatar_url on public.profiles
for each row execute function public.sync_blocked_profile_snapshot();

create function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Sign in to block people.'; end if;
  if p_target is null or p_target = viewer_id then raise exception 'You cannot block this account.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'This profile is unavailable.';
  end if;

  insert into public.blocks (
    blocker_id, blocked_id, blocked_username, blocked_display_name, blocked_avatar_url
  )
  select viewer_id, p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p where p.id = p_target
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.follows
  where (follower_id = viewer_id and following_id = p_target)
     or (follower_id = p_target and following_id = viewer_id);
end;
$$;

create function public.unblock_user(p_target uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to unblock people.'; end if;
  delete from public.blocks
  where blocker_id = auth.uid() and blocked_id = p_target;
end;
$$;

create function public.get_blocked_users(
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null,
  p_page_size integer default 30
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  blocked_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result_limit integer := coalesce(p_page_size, 30);
begin
  if auth.uid() is null then raise exception 'Sign in to view blocked accounts.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Page size must be between 1 and 50.'; end if;
  return query
  select b.blocked_id, b.blocked_username, b.blocked_display_name, b.blocked_avatar_url, b.created_at
  from public.blocks b
  where b.blocker_id = auth.uid()
    and (
      p_cursor_created_at is null
      or (b.created_at, b.blocked_id) < (p_cursor_created_at, p_cursor_user_id)
    )
  order by b.created_at desc, b.blocked_id desc
  limit result_limit;
end;
$$;

create function public.pin_post(p_post_id uuid, p_pinned boolean)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  changed_rows integer;
begin
  if auth.uid() is null then raise exception 'Sign in to pin videos.'; end if;
  update public.posts
  set pinned_at = case when p_pinned then now() else null end
  where id = p_post_id and author_id = auth.uid() and status = 'published';
  get diagnostics changed_rows = row_count;
  if changed_rows = 0 then raise exception 'This video is unavailable.'; end if;
end;
$$;

drop policy "Signed-in users can read profiles" on public.profiles;
create policy "Signed-in users can read profiles without block relations"
on public.profiles for select to authenticated
using (
  auth.uid() is not null
  and not public.profile_blocked_pair(id, auth.uid())
);

drop policy "Users can read follows involving themselves" on public.follows;
create policy "Users read visible follow relationships"
on public.follows for select to authenticated
using (
  follower_id = auth.uid()
  or following_id = auth.uid()
  or public.profile_lists_visible(following_id, auth.uid())
);

drop policy "Users can follow from their own account" on public.follows;
create policy "Users can follow from their own account"
on public.follows for insert to authenticated
with check (
  follower_id = auth.uid()
  and following_id <> auth.uid()
  and not public.profile_blocked_pair(following_id, auth.uid())
);

create policy "Profile owners respond to pending follows"
on public.follows for update to authenticated
using (following_id = auth.uid() and status = 'pending')
with check (following_id = auth.uid() and status = 'accepted');

create policy "Profile owners decline pending follows"
on public.follows for delete to authenticated
using (following_id = auth.uid() and status = 'pending');

drop policy "Users can read their own post likes" on public.post_likes;
create policy "Users read visible post likes"
on public.post_likes for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.profile_likes_visible(user_id, auth.uid())
    and public.can_view_post(post_id, auth.uid())
  )
);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, username, display_name, avatar_url, bio, link, date_of_birth, dm_policy)
  on public.profiles to authenticated;
grant update (id, username, display_name, avatar_url, bio, link, date_of_birth, dm_policy)
  on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

revoke insert, update on public.follows from authenticated;
grant insert (follower_id, following_id) on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant delete on public.follows to authenticated;

grant select, delete on public.blocks to authenticated;
revoke insert, update on public.blocks from authenticated;
grant update (show_liked_videos, personalized_recommendations)
  on public.user_settings to authenticated;
grant insert (user_id, show_liked_videos, personalized_recommendations)
  on public.user_settings to authenticated;

grant update (pinned_at) on public.posts to authenticated;
grant execute on function public.get_profile(text) to authenticated;
grant execute on function public.get_profile_posts(uuid, text, timestamptz, uuid, integer, boolean) to authenticated;
grant execute on function public.get_follow_list(uuid, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.cancel_follow_request(uuid) to authenticated;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;
grant execute on function public.get_follow_requests(timestamptz, uuid, integer) to authenticated;
grant execute on function public.set_account_privacy(boolean) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.get_blocked_users(timestamptz, uuid, integer) to authenticated;
grant execute on function public.pin_post(uuid, boolean) to authenticated;

revoke all on function public.protect_profile_changes() from public, anon, authenticated;
revoke all on function public.update_profile_follow_counts() from public, anon, authenticated;
revoke all on function public.update_profile_like_count() from public, anon, authenticated;
revoke all on function public.enforce_profile_pin_limit() from public, anon, authenticated;
revoke all on function public.remove_deleted_post_likes_from_profile_count() from public, anon, authenticated;
revoke all on function public.sync_blocked_profile_snapshot() from public, anon, authenticated;
revoke all on function public.get_profile(text) from public, anon;
revoke all on function public.get_profile_posts(uuid, text, timestamptz, uuid, integer, boolean) from public, anon;
revoke all on function public.get_follow_list(uuid, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_follow_requests(timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_blocked_users(timestamptz, uuid, integer) from public, anon;
revoke all on function public.follow_user(uuid) from public, anon;
revoke all on function public.unfollow_user(uuid) from public, anon;
revoke all on function public.cancel_follow_request(uuid) from public, anon;
revoke all on function public.respond_follow_request(uuid, boolean) from public, anon;
revoke all on function public.set_account_privacy(boolean) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.pin_post(uuid, boolean) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'follows'
    )
  then
    alter publication supabase_realtime add table public.follows;
  end if;
end;
$$;
