create table public.teen_safety_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '07:00',
  daily_reminder_minutes integer
    check (daily_reminder_minutes is null or daily_reminder_minutes in (30, 60, 90, 120)),
  hide_restricted_content boolean not null default true,
  time_zone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

alter table public.teen_safety_settings enable row level security;
revoke all on public.teen_safety_settings from public, anon, authenticated;

create function public.teen_age_is_minor(p_date_of_birth date, p_as_of date)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_date_of_birth is not null
    and date_part('year', age(p_as_of, p_date_of_birth)) < 18;
$$;

create function public.teen_user_is_minor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id
      and public.teen_age_is_minor(profile.date_of_birth, current_date)
  );
$$;
revoke all on function public.teen_user_is_minor(uuid) from public, anon, authenticated;
grant execute on function public.teen_user_is_minor(uuid) to service_role;

create function public.teen_profile_can_appear_in_discovery(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select not public.teen_user_is_minor(p_profile_id);
$$;
revoke all on function public.teen_profile_can_appear_in_discovery(uuid) from public, anon;
grant execute on function public.teen_profile_can_appear_in_discovery(uuid) to authenticated, service_role;

create function public.teen_profile_is_discoverable(p_is_minor boolean)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select not coalesce(p_is_minor, false);
$$;
revoke all on function public.teen_profile_is_discoverable(boolean) from public, anon;
grant execute on function public.teen_profile_is_discoverable(boolean) to authenticated;

create function public.teen_dm_pair_allowed(
  p_first_is_minor boolean,
  p_second_is_minor boolean,
  p_mutual_accepted_follows boolean
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select not (coalesce(p_first_is_minor, false) or coalesce(p_second_is_minor, false))
    or coalesce(p_mutual_accepted_follows, false);
$$;

create function public.teen_quiet_hours_match(p_local_time time, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_start = p_end then false
    when p_start < p_end then p_local_time >= p_start and p_local_time < p_end
    else p_local_time >= p_start or p_local_time < p_end
  end;
$$;

create function public.teen_restricted_flag(
  p_category text,
  p_score numeric,
  p_status text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_category in ('nudity', 'violence')
    and p_score >= 0.5
    and p_status in ('review', 'appealed', 'warned');
$$;

revoke all on function public.teen_age_is_minor(date, date) from public, anon, authenticated;
revoke all on function public.teen_dm_pair_allowed(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.teen_quiet_hours_match(time, time, time) from public, anon, authenticated;
revoke all on function public.teen_restricted_flag(text, numeric, text) from public, anon, authenticated;

drop policy "Signed-in users can read profiles without block relations" on public.profiles;
create policy "Signed-in users can read profiles without block relations"
on public.profiles for select to authenticated
using (
  auth.uid() is not null
  and not public.profile_blocked_pair(id, auth.uid())
  and (
    id = auth.uid()
    or public.teen_profile_can_appear_in_discovery(id)
    or exists (
      select 1 from public.follows follow
      where follow.follower_id = auth.uid()
        and follow.following_id = id
        and follow.status = 'accepted'
    )
  )
);

create or replace function public.search_people(
  p_query text,
  p_cursor_username text default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_private boolean,
  followers_count integer,
  follow_status text
)
language plpgsql
volatile
security invoker
set search_path = public, extensions, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  query_text text := lower(btrim(coalesce(p_query, '')));
  result_limit integer := coalesce(p_page_size, 20);
  viewer_is_demo boolean;
begin
  if viewer_id is null then raise exception 'Sign in to search.'; end if;
  if char_length(query_text) < 2 then raise exception 'Search terms must contain at least 2 characters.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  select profile.id, profile.username, profile.display_name, profile.avatar_url,
         profile.is_private, profile.followers_count, coalesce(follow.status, 'none')
  from public.profiles profile
  left join public.follows follow
    on follow.follower_id = viewer_id and follow.following_id = profile.id
  where profile.id <> viewer_id
    and public.teen_profile_can_appear_in_discovery(profile.id)
    and (viewer_is_demo or not profile.is_demo)
    and (profile.username ilike '%' || query_text || '%' or profile.display_name ilike '%' || query_text || '%')
    and (p_cursor_username is null or (profile.username, profile.id) > (p_cursor_username, p_cursor_id))
    and not public.profile_blocked_pair(profile.id, viewer_id)
  order by profile.username, profile.id
  limit result_limit;
end;
$$;

create or replace function public.search_videos(
  p_query text,
  p_hashtag text default null,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
)
returns table (
  post jsonb,
  author jsonb,
  is_liked boolean,
  is_saved boolean,
  is_following boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  query_text text := lower(btrim(coalesce(p_query, '')));
  hashtag_text text := lower(trim(both '#' from btrim(coalesce(p_hashtag, ''))));
  result_limit integer := coalesce(p_page_size, 20);
  viewer_is_demo boolean;
begin
  if viewer_id is null then raise exception 'Sign in to search.'; end if;
  if char_length(query_text) < 2 then raise exception 'Search terms must contain at least 2 characters.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  with selected_posts as materialized (
    select post.*
    from public.posts post
    join public.profiles author on author.id = post.author_id
    where post.status = 'published'
      and post.published_at is not null
      and public.can_view_post(post.id, viewer_id)
      and public.teen_profile_can_appear_in_discovery(author.id)
      and (viewer_is_demo or not author.is_demo)
      and (p_cursor_published_at is null
        or (post.published_at, post.id) < (p_cursor_published_at, p_cursor_id))
      and (
        (hashtag_text <> '' and exists (
          select 1 from unnest(post.hashtags) hashtag where lower(hashtag) = hashtag_text
        ))
        or (
          hashtag_text = ''
          and (
            post.caption_search @@ websearch_to_tsquery('simple', query_text)
            or post.caption ilike '%' || query_text || '%'
            or post.hashtags @> array[query_text]
            or exists (
              select 1 from unnest(post.hashtags) hashtag
              where lower(hashtag) like '%' || query_text || '%'
            )
          )
        )
      )
    order by post.published_at desc, post.id desc
    limit result_limit
  )
  select
    to_jsonb(post),
    jsonb_build_object('username', author.username, 'display_name', author.display_name, 'avatar_url', author.avatar_url),
    exists (select 1 from public.post_likes likes where likes.post_id = post.id and likes.user_id = viewer_id),
    exists (select 1 from public.post_saves saves where saves.post_id = post.id and saves.user_id = viewer_id),
    exists (
      select 1 from public.follows follow
      where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted'
    )
  from selected_posts post
  join public.profiles author on author.id = post.author_id
  order by post.published_at desc, post.id desc;
end;
$$;

create or replace function public.search_hashtags(
  p_query text,
  p_exact boolean default false,
  p_cursor_post_count bigint default null,
  p_cursor_tag text default null,
  p_page_size integer default 20
)
returns table (tag text, post_count bigint)
language plpgsql
volatile
security invoker
set search_path = public, extensions, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  query_text text := lower(trim(both '#' from btrim(coalesce(p_query, ''))));
  result_limit integer := coalesce(p_page_size, 20);
  viewer_is_demo boolean;
begin
  if viewer_id is null then raise exception 'Sign in to search.'; end if;
  if char_length(query_text) < 2 then raise exception 'Search terms must contain at least 2 characters.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  with visible_tags as (
    select lower(hashtag) as normalized_tag, count(distinct post.id)::bigint as uses
    from public.posts post
    join public.profiles author on author.id = post.author_id
    cross join lateral unnest(post.hashtags) hashtag
    where post.status = 'published'
      and public.can_view_post(post.id, viewer_id)
      and public.teen_profile_can_appear_in_discovery(author.id)
      and (viewer_is_demo or not author.is_demo)
      and (p_exact or post.published_at >= now() - interval '30 days')
      and public.hashtags_search_text(post.hashtags) like '%' || query_text || '%'
      and (
        (p_exact and lower(hashtag) = query_text)
        or (not p_exact and lower(hashtag) like '%' || query_text || '%')
      )
    group by lower(hashtag)
  )
  select visible_tags.normalized_tag, visible_tags.uses
  from visible_tags
  where p_cursor_post_count is null
     or visible_tags.uses < p_cursor_post_count
     or (visible_tags.uses = p_cursor_post_count and visible_tags.normalized_tag > p_cursor_tag)
  order by visible_tags.uses desc, visible_tags.normalized_tag
  limit result_limit;
end;
$$;

create or replace function public.trending_hashtags()
returns table (tag text, post_count bigint)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  viewer_is_demo boolean;
begin
  if viewer_id is null then raise exception 'Sign in to view trending hashtags.'; end if;
  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  select lower(hashtag), count(distinct post.id)::bigint
  from public.posts post
  join public.profiles author on author.id = post.author_id
  cross join lateral unnest(post.hashtags) hashtag
  where post.status = 'published'
    and post.published_at >= now() - interval '7 days'
    and public.can_view_post(post.id, viewer_id)
    and public.teen_profile_can_appear_in_discovery(author.id)
    and (viewer_is_demo or not author.is_demo)
  group by lower(hashtag)
  order by count(distinct post.id) desc, lower(hashtag)
  limit 10;
end;
$$;

create or replace function public.suggested_people()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_private boolean,
  followers_count integer,
  mutual_follows integer,
  shared_interests integer
)
language plpgsql
stable
security invoker
set search_path = public, extensions, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  viewer_is_demo boolean;
begin
  if viewer_id is null then raise exception 'Sign in to load suggested people.'; end if;
  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  with eligible as materialized (
    select profile.*,
      wimpex_private.search_mutual_follow_count(profile.id) as mutual_count,
      (
        select count(*)::integer
        from public.profile_interests viewer_interest
        join public.profile_interests candidate_interest
          on candidate_interest.interest = viewer_interest.interest
         and candidate_interest.profile_id = profile.id
        where viewer_interest.profile_id = viewer_id
      ) as interest_count
    from public.profiles profile
    where profile.id <> viewer_id
      and public.teen_profile_can_appear_in_discovery(profile.id)
      and (viewer_is_demo or not profile.is_demo)
      and not exists (
        select 1 from public.follows follow
        where follow.follower_id = viewer_id and follow.following_id = profile.id
      )
      and not public.profile_blocked_pair(profile.id, viewer_id)
  )
  select eligible.id, eligible.username, eligible.display_name, eligible.avatar_url,
         eligible.is_private, eligible.followers_count, eligible.mutual_count, eligible.interest_count
  from eligible
  where eligible.mutual_count > 0 or eligible.interest_count > 0
  order by eligible.mutual_count desc, eligible.interest_count desc,
    eligible.followers_count desc, eligible.username, eligible.id
  limit 20;
end;
$$;

create function public.get_my_teen_safety_settings()
returns table (
  quiet_hours_enabled boolean,
  quiet_hours_start time,
  quiet_hours_end time,
  daily_reminder_minutes integer,
  hide_restricted_content boolean,
  time_zone text
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to open Teen safety settings.'; end if;
  if not public.teen_user_is_minor(auth.uid()) then
    raise exception 'Teen safety settings are available only to people under 18.';
  end if;

  insert into public.teen_safety_settings (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  return query
  select settings.quiet_hours_enabled, settings.quiet_hours_start, settings.quiet_hours_end,
         settings.daily_reminder_minutes, settings.hide_restricted_content, settings.time_zone
  from public.teen_safety_settings settings
  where settings.user_id = auth.uid();
end;
$$;

create or replace function public.start_direct_conversation(other_user uuid)
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
  if caller_id is null then raise exception 'You must be signed in to start a conversation.'; end if;
  if other_user is null or other_user = caller_id then
    raise exception 'Choose another person to start a conversation.';
  end if;

  select * into recipient from public.profiles profile where profile.id = other_user;
  if not found then raise exception 'This profile is no longer available.'; end if;
  if recipient.is_official then raise exception 'You cannot start a conversation with the official account.'; end if;
  if exists (
    select 1 from public.blocks block
    where (block.blocker_id = caller_id and block.blocked_id = other_user)
       or (block.blocker_id = other_user and block.blocked_id = caller_id)
  ) then
    raise exception 'A conversation cannot be started because one of you has blocked the other.';
  end if;
  if recipient.dm_policy = 'none' then raise exception 'This person does not accept direct messages.'; end if;
  if recipient.dm_policy = 'friends'
    or not public.teen_dm_pair_allowed(
      public.teen_user_is_minor(caller_id),
      public.teen_user_is_minor(other_user),
      public.chat_are_mutual_friends(caller_id, other_user)
    )
  then
    raise exception 'A mutual accepted follow is required to message this person.';
  end if;

  pair_key := least(caller_id::text, other_user::text) || ':' || greatest(caller_id::text, other_user::text);
  insert into public.conversations (type, created_by, direct_key)
  values ('direct', caller_id, pair_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning id into conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conversation_id, caller_id, 'member'), (conversation_id, other_user, 'member')
  on conflict (conversation_id, user_id) do update set left_at = null;

  return conversation_id;
end;
$$;

create function public.update_my_teen_safety_settings(
  p_quiet_hours_enabled boolean,
  p_quiet_hours_start time,
  p_quiet_hours_end time,
  p_daily_reminder_minutes integer,
  p_hide_restricted_content boolean,
  p_time_zone text
)
returns table (
  quiet_hours_enabled boolean,
  quiet_hours_start time,
  quiet_hours_end time,
  daily_reminder_minutes integer,
  hide_restricted_content boolean,
  time_zone text
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to update Teen safety settings.'; end if;
  if not public.teen_user_is_minor(auth.uid()) then
    raise exception 'Teen safety settings are available only to people under 18.';
  end if;
  if p_quiet_hours_start is null or p_quiet_hours_end is null
    or (p_quiet_hours_enabled and p_quiet_hours_start = p_quiet_hours_end)
  then
    raise exception 'Choose different start and end times for quiet hours.';
  end if;
  if p_daily_reminder_minutes is not null
    and p_daily_reminder_minutes not in (30, 60, 90, 120)
  then
    raise exception 'Choose a supported daily reminder duration.';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_time_zone
  ) then
    raise exception 'Choose a valid time zone.';
  end if;

  insert into public.teen_safety_settings (
    user_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
    daily_reminder_minutes, hide_restricted_content, time_zone, updated_at
  )
  values (
    auth.uid(), p_quiet_hours_enabled, p_quiet_hours_start, p_quiet_hours_end,
    p_daily_reminder_minutes, p_hide_restricted_content, p_time_zone, now()
  )
  on conflict (user_id) do update set
    quiet_hours_enabled = excluded.quiet_hours_enabled,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    daily_reminder_minutes = excluded.daily_reminder_minutes,
    hide_restricted_content = excluded.hide_restricted_content,
    time_zone = excluded.time_zone,
    updated_at = excluded.updated_at;

  return query
  select settings.quiet_hours_enabled, settings.quiet_hours_start, settings.quiet_hours_end,
         settings.daily_reminder_minutes, settings.hide_restricted_content, settings.time_zone
  from public.teen_safety_settings settings
  where settings.user_id = auth.uid();
end;
$$;

create function public.teen_should_suppress_push(p_user_id uuid, p_now timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  settings public.teen_safety_settings%rowtype;
  local_time time;
begin
  if not public.teen_user_is_minor(p_user_id) then return false; end if;
  select * into settings from public.teen_safety_settings where user_id = p_user_id;
  if not found or not settings.quiet_hours_enabled then return false; end if;
  local_time := (p_now at time zone settings.time_zone)::time;

  return public.teen_quiet_hours_match(
    local_time,
    settings.quiet_hours_start,
    settings.quiet_hours_end
  );
end;
$$;

create function public.teen_should_hide_restricted_post(p_viewer_id uuid, p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.teen_user_is_minor(p_viewer_id)
    and coalesce((
      select settings.hide_restricted_content
      from public.teen_safety_settings settings
      where settings.user_id = p_viewer_id
    ), true)
    and exists (
      select 1 from public.moderation_flags flag
      where flag.content_type = 'post'
        and flag.content_id = p_post_id
        and public.teen_restricted_flag(flag.category, flag.score, flag.status)
    );
$$;

revoke all on function public.get_my_teen_safety_settings() from public, anon;
revoke all on function public.update_my_teen_safety_settings(boolean, time, time, integer, boolean, text)
  from public, anon;
revoke all on function public.teen_should_suppress_push(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.teen_should_hide_restricted_post(uuid, uuid) from public, anon;
grant execute on function public.get_my_teen_safety_settings() to authenticated;
grant execute on function public.update_my_teen_safety_settings(boolean, time, time, integer, boolean, text)
  to authenticated;
grant execute on function public.teen_should_suppress_push(uuid, timestamptz) to service_role;
grant execute on function public.teen_should_hide_restricted_post(uuid, uuid) to authenticated, service_role;

create or replace function public.can_view_post(p_post_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when auth.uid() is null or auth.uid() <> p_viewer_id then false
    else exists (
      select 1
      from public.posts post
      join public.profiles author on author.id = post.author_id
      where post.id = p_post_id
        and (
          post.author_id = p_viewer_id
          or (
            post.status = 'published'
            and post.moderation_status = 'clear'
            and not public.teen_should_hide_restricted_post(p_viewer_id, post.id)
            and not exists (
              select 1 from public.blocks block
              where (block.blocker_id = p_viewer_id and block.blocked_id = post.author_id)
                 or (block.blocker_id = post.author_id and block.blocked_id = p_viewer_id)
            )
            and (
              (post.audience = 'everyone' and not author.is_private)
              or exists (
                select 1 from public.follows follow
                where follow.follower_id = p_viewer_id
                  and follow.following_id = post.author_id
                  and follow.status = 'accepted'
              )
            )
          )
        )
    )
  end;
$$;

create or replace function public.get_feed(
  mode text,
  cursor_published_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 10
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
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  result_limit integer := coalesce(get_feed.page_size, 10);
begin
  if viewer_id is null then raise exception 'Sign in to load the feed.'; end if;
  if get_feed.mode not in ('for_you', 'following') then raise exception 'Invalid feed mode.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Invalid page size.'; end if;

  return query
  with candidate_pool as not materialized (
    select post.*
    from public.posts post
    join public.profiles author on author.id = post.author_id
    where post.status = 'published'
      and post.author_id <> viewer_id
      and (
        get_feed.mode <> 'for_you'
        or public.teen_profile_can_appear_in_discovery(post.author_id)
      )
      and (get_feed.cursor_published_at is null
        or (post.published_at, post.id) < (get_feed.cursor_published_at, get_feed.cursor_id))
      and not exists (
        select 1 from public.blocks block
        where (block.blocker_id = viewer_id and block.blocked_id = post.author_id)
          or (block.blocker_id = post.author_id and block.blocked_id = viewer_id)
      )
      and (
        (post.audience = 'everyone' and not author.is_private)
        or exists (
          select 1 from public.follows follow
          where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted'
        )
      )
      and (
        get_feed.mode = 'for_you'
        or exists (
          select 1 from public.follows follow
          where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted'
        )
      )
    order by post.published_at desc, post.id desc
  ),
  unseen as materialized (
    select candidate.*
    from candidate_pool candidate
    where get_feed.mode = 'following'
      or not exists (select 1 from public.post_views view_row
        where view_row.post_id = candidate.id and view_row.user_id = viewer_id)
    order by candidate.published_at desc, candidate.id desc
    limit result_limit
  ),
  unseen_count as (select count(*)::integer as count from unseen),
  seen_fill as (
    select candidate.*
    from candidate_pool candidate
    where get_feed.mode = 'for_you'
      and (select count from unseen_count) < result_limit
      and exists (select 1 from public.post_views view_row
        where view_row.post_id = candidate.id and view_row.user_id = viewer_id)
      and not exists (select 1 from unseen row_seen where row_seen.id = candidate.id)
    order by candidate.published_at desc, candidate.id desc
    limit greatest(0, result_limit - (select count from unseen_count))
  ),
  selected as (select * from unseen union all select * from seen_fill)
  select
    to_jsonb(post),
    jsonb_build_object(
      'username', author.username,
      'display_name', author.display_name,
      'avatar_url', author.avatar_url,
      'is_verified', author.is_verified
    ),
    exists (select 1 from public.post_likes post_like
      where post_like.post_id = post.id and post_like.user_id = viewer_id),
    exists (select 1 from public.post_saves saved
      where saved.post_id = post.id and saved.user_id = viewer_id),
    exists (select 1 from public.follows follow
      where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted')
  from selected post
  join public.profiles author on author.id = post.author_id
  order by post.published_at desc, post.id desc
  limit result_limit;
end;
$$;

revoke all on function public.get_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_feed(text, timestamptz, uuid, integer) to authenticated;
