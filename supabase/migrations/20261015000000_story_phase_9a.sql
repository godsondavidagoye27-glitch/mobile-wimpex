-- =====================================================================
-- Stories feature (fixed, re-runnable)
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  media_path text not null,
  thumb_path text,
  caption text check (char_length(caption) <= 120),
  caption_style jsonb,
  audience text not null default 'everyone' check (audience in ('everyone', 'followers', 'close_friends')),
  duration_ms integer not null check (duration_ms > 0 and duration_ms <= 15000),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz
);

create index if not exists stories_author_created_idx
  on public.stories (author_id, created_at desc);

create index if not exists stories_expiry_idx
  on public.stories (expires_at);

create table if not exists public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists story_views_viewer_idx
  on public.story_views (viewer_id);

create table if not exists public.close_friends (
  owner_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);

create index if not exists close_friends_friend_idx
  on public.close_friends (friend_id);

alter table public.user_settings
  add column if not exists story_replies text not null default 'everyone'
  check (story_replies in ('everyone', 'followers', 'off'));

-- ---------- Helper functions ----------
create or replace function public.story_blocked_pair(p_first_id uuid, p_second_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.blocks b
    where (b.blocker_id = p_first_id and b.blocked_id = p_second_id)
       or (b.blocker_id = p_second_id and b.blocked_id = p_first_id)
  );
$$;

create or replace function public.story_user_is_minor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.date_of_birth is not null
      and date_part('year', age(current_date, p.date_of_birth)) < 18
  );
$$;

create or replace function public.can_view_story(p_story_id uuid, p_viewer_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  story public.stories%rowtype;
  author_is_private boolean;
begin
  if p_viewer_id is null then
    return false;
  end if;

  -- Callers may only ask about themselves (service role is exempt).
  if p_viewer_id is distinct from auth.uid()
     and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  select * into story
  from public.stories
  where id = p_story_id
    and deleted_at is null;

  if not found then
    return false;
  end if;

  if story.expires_at <= now() then
    return false;
  end if;

  if story.author_id = p_viewer_id then
    return true;
  end if;

  if public.story_blocked_pair(story.author_id, p_viewer_id) then
    return false;
  end if;

  if story.audience = 'everyone' then
    select p.is_private into author_is_private
    from public.profiles p
    where p.id = story.author_id;

    -- Public account: anyone. Private account: accepted followers only.
    if coalesce(author_is_private, false) then
      return exists (
        select 1
        from public.follows f
        where f.follower_id = p_viewer_id
          and f.following_id = story.author_id
          and f.status = 'accepted'
      );
    end if;

    return true;
  end if;

  if story.audience = 'followers' then
    return exists (
      select 1
      from public.follows f
      where f.follower_id = p_viewer_id
        and f.following_id = story.author_id
        and f.status = 'accepted'
    );
  end if;

  if story.audience = 'close_friends' then
    return exists (
      select 1
      from public.close_friends cf
      where cf.owner_id = story.author_id
        and cf.friend_id = p_viewer_id
    );
  end if;

  return false;
end;
$$;

-- ---------- Expiration trigger ----------
create or replace function public.set_story_expiration()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.expires_at := now() + interval '24 hours';
  elsif tg_op = 'UPDATE' then
    if new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at
       or new.author_id is distinct from old.author_id then
      raise exception 'expires_at, created_at and author_id cannot be modified';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stories_set_expiration on public.stories;
create trigger stories_set_expiration
before insert or update on public.stories
for each row execute function public.set_story_expiration();

-- ---------- RPCs ----------
drop function if exists public.get_story_rail();
create function public.get_story_rail()
returns table (
  author_id uuid,
  display_name text,
  username text,
  story_count bigint,
  has_unseen boolean,
  is_close_friends_audience boolean,
  latest_created_at timestamptz,
  is_owner boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  with visible as (
    select s.author_id,
           count(*)::bigint as story_count,
           max(s.created_at) as latest_created_at,
           bool_or(s.audience = 'close_friends') as is_close_friends_audience,
           bool_or(
             s.author_id <> auth.uid()
             and not exists (
               select 1 from public.story_views sv
               where sv.story_id = s.id and sv.viewer_id = auth.uid()
             )
           ) as has_unseen
    from public.stories s
    where s.deleted_at is null
      and s.expires_at > now()
      and public.can_view_story(s.id, auth.uid())
    group by s.author_id
  )
  select p.id as author_id,
         p.display_name,
         p.username,
         v.story_count,
         coalesce(v.has_unseen, false) as has_unseen,
         coalesce(v.is_close_friends_audience, false) as is_close_friends_audience,
         v.latest_created_at,
         (p.id = auth.uid()) as is_owner
  from visible v
  join public.profiles p on p.id = v.author_id
  order by
    case when p.id = auth.uid() then 0 else 1 end,
    case when coalesce(v.has_unseen, false) then 0 else 1 end,
    v.latest_created_at desc;
$$;

create or replace function public.mark_story_viewed(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not public.can_view_story(p_story_id, auth.uid()) then
    raise exception 'You cannot view that story.';
  end if;

  if exists (
    select 1 from public.stories s
    where s.id = p_story_id
      and s.author_id = auth.uid()
  ) then
    return;
  end if;

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, auth.uid())
  on conflict (story_id, viewer_id) do nothing;
end;
$$;

drop function if exists public.get_author_stories(uuid);
create function public.get_author_stories(p_author_id uuid)
returns table (
  id uuid,
  kind text,
  media_path text,
  thumb_path text,
  caption text,
  duration_ms integer,
  is_viewed boolean,
  view_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select s.id,
         s.kind,
         s.media_path,
         s.thumb_path,
         s.caption,
         s.duration_ms,
         (s.author_id = auth.uid()
          or exists (
            select 1
            from public.story_views v
            where v.story_id = s.id
              and v.viewer_id = auth.uid()
          )) as is_viewed,
         case
           when s.author_id = auth.uid() then
             (select count(*) from public.story_views c where c.story_id = s.id)::bigint
           else null
         end as view_count
  from public.stories s
  where s.author_id = p_author_id
    and s.deleted_at is null
    and s.expires_at > now()
    and public.can_view_story(s.id, auth.uid())
  order by s.created_at asc;
$$;

create or replace function public.delete_story(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.stories
  set deleted_at = now()
  where id = p_story_id
    and author_id = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Only the author can delete a story.';
  end if;
end;
$$;

create or replace function public.add_close_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if p_friend_id = auth.uid() then
    raise exception 'You cannot add yourself to close friends.';
  end if;

  if public.story_blocked_pair(auth.uid(), p_friend_id) then
    raise exception 'You cannot add a blocked account.';
  end if;

  if not exists (
    select 1
    from public.follows f
    where f.follower_id = auth.uid()
      and f.following_id = p_friend_id
      and f.status = 'accepted'
  ) then
    raise exception 'You can add only followed accounts.';
  end if;

  insert into public.close_friends (owner_id, friend_id)
  values (auth.uid(), p_friend_id)
  on conflict (owner_id, friend_id) do nothing;
end;
$$;

create or replace function public.remove_close_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  delete from public.close_friends
  where owner_id = auth.uid()
    and friend_id = p_friend_id;
end;
$$;

drop function if exists public.get_close_friends(text, uuid);
create function public.get_close_friends(p_query text default '', p_cursor uuid default null)
returns table (
  friend_id uuid,
  display_name text,
  username text
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p.id as friend_id,
         p.display_name,
         p.username
  from public.close_friends cf
  join public.profiles p on p.id = cf.friend_id
  where cf.owner_id = auth.uid()
    and (
      coalesce(p_query, '') = ''
      or p.username ilike '%' || p_query || '%'
      or p.display_name ilike '%' || p_query || '%'
    )
    and (p_cursor is null or p.id > p_cursor)
  order by p.id
  limit 25;
$$;

drop function if exists public.get_close_friend_candidates(text, uuid);
create function public.get_close_friend_candidates(p_query text default '', p_cursor uuid default null)
returns table (
  user_id uuid,
  display_name text,
  username text
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p.id as user_id,
         p.display_name,
         p.username
  from public.profiles p
  where p.id <> auth.uid()
    and exists (
      select 1
      from public.follows f
      where f.follower_id = auth.uid()
        and f.following_id = p.id
        and f.status = 'accepted'
    )
    and not exists (
      select 1 from public.close_friends cf
      where cf.owner_id = auth.uid() and cf.friend_id = p.id
    )
    and not public.story_blocked_pair(auth.uid(), p.id)
    and (
      coalesce(p_query, '') = ''
      or p.username ilike '%' || p_query || '%'
      or p.display_name ilike '%' || p_query || '%'
    )
    and (p_cursor is null or p.id > p_cursor)
  order by p.id
  limit 25;
$$;

-- ---------- Row level security ----------
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.close_friends enable row level security;

drop policy if exists "stories select visible" on public.stories;
create policy "stories select visible" on public.stories
for select to authenticated
using (
  deleted_at is null
  and expires_at > now()
  and public.can_view_story(id, auth.uid())
);

drop policy if exists "stories insert own" on public.stories;
create policy "stories insert own" on public.stories
for insert to authenticated
with check (author_id = auth.uid() and deleted_at is null);

drop policy if exists "stories update own" on public.stories;
create policy "stories update own" on public.stories
for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "stories delete own" on public.stories;
create policy "stories delete own" on public.stories
for delete to authenticated
using (author_id = auth.uid());

drop policy if exists "story views insert own" on public.story_views;
create policy "story views insert own" on public.story_views
for insert to authenticated
with check (
  viewer_id = auth.uid()
  and public.can_view_story(story_views.story_id, auth.uid())
);

drop policy if exists "story views select own or author" on public.story_views;
create policy "story views select own or author" on public.story_views
for select to authenticated
using (
  viewer_id = auth.uid()
  or exists (
    select 1 from public.stories s
    where s.id = story_views.story_id
      and s.author_id = auth.uid()
  )
);

drop policy if exists "close friends select own" on public.close_friends;
create policy "close friends select own" on public.close_friends
for select to authenticated
using (owner_id = auth.uid());

-- Inserts go through add_close_friend() so its follow/block checks can't be bypassed.
drop policy if exists "close friends insert own" on public.close_friends;

drop policy if exists "close friends delete own" on public.close_friends;
create policy "close friends delete own" on public.close_friends
for delete to authenticated
using (owner_id = auth.uid());

-- ---------- Grants ----------
revoke all on function public.story_blocked_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.story_user_is_minor(uuid) from public, anon, authenticated;
revoke all on function public.can_view_story(uuid, uuid) from public, anon;
revoke all on function public.set_story_expiration() from public, anon, authenticated;
revoke all on function public.get_story_rail() from public, anon;
revoke all on function public.mark_story_viewed(uuid) from public, anon;
revoke all on function public.get_author_stories(uuid) from public, anon;
revoke all on function public.delete_story(uuid) from public, anon;
revoke all on function public.add_close_friend(uuid) from public, anon;
revoke all on function public.remove_close_friend(uuid) from public, anon;
revoke all on function public.get_close_friends(text, uuid) from public, anon;
revoke all on function public.get_close_friend_candidates(text, uuid) from public, anon;

-- story_blocked_pair / story_user_is_minor / set_story_expiration are internal only:
-- they run inside SECURITY DEFINER functions or triggers, so clients don't need execute.
grant execute on function public.can_view_story(uuid, uuid) to authenticated;
grant execute on function public.get_story_rail() to authenticated;
grant execute on function public.mark_story_viewed(uuid) to authenticated;
grant execute on function public.get_author_stories(uuid) to authenticated;
grant execute on function public.delete_story(uuid) to authenticated;
grant execute on function public.add_close_friend(uuid) to authenticated;
grant execute on function public.remove_close_friend(uuid) to authenticated;
grant execute on function public.get_close_friends(text, uuid) to authenticated;
grant execute on function public.get_close_friend_candidates(text, uuid) to authenticated;