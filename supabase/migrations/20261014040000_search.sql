create extension if not exists pg_trgm with schema extensions;

alter table public.posts
  add column caption_search tsvector
  generated always as (to_tsvector('simple', coalesce(caption, ''))) stored;

create index profiles_username_trgm_idx
  on public.profiles using gin (username extensions.gin_trgm_ops);
create index profiles_display_name_trgm_idx
  on public.profiles using gin (display_name extensions.gin_trgm_ops);
create index posts_caption_search_idx
  on public.posts using gin (caption_search);
create index posts_hashtags_gin_idx
  on public.posts using gin (hashtags);
create function public.hashtags_search_text(p_hashtags text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(pg_catalog.array_to_string(p_hashtags, ' '));
$$;
grant execute on function public.hashtags_search_text(text[]) to authenticated, service_role;

create index posts_hashtags_trgm_idx
  on public.posts using gin (public.hashtags_search_text(hashtags) extensions.gin_trgm_ops);

create schema if not exists wimpex_private;
revoke all on schema wimpex_private from public, anon, authenticated;
grant usage on schema wimpex_private to authenticated;

create table wimpex_private.search_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);
revoke all on wimpex_private.search_rate_limits from public, anon, authenticated;

create function wimpex_private.consume_search_rate_limit()
returns void
language plpgsql
security definer
set search_path = public, wimpex_private, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  current_count integer;
begin
  if viewer_id is null then
    raise exception 'Sign in to search.';
  end if;

  insert into wimpex_private.search_rate_limits as limits (
    user_id, window_started_at, request_count
  )
  values (viewer_id, clock_timestamp(), 1)
  on conflict (user_id) do update
  set window_started_at = case
        when limits.window_started_at <= clock_timestamp() - interval '1 minute'
          then clock_timestamp()
        else limits.window_started_at
      end,
      request_count = case
        when limits.window_started_at <= clock_timestamp() - interval '1 minute'
          then 1
        else limits.request_count + 1
      end
  returning request_count into current_count;

  if current_count > 60 then
    raise exception 'Search rate limit exceeded.' using errcode = 'P0001';
  end if;
end;
$$;

create function wimpex_private.search_mutual_follow_count(p_candidate_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when auth.uid() is null or p_candidate_id is null or p_candidate_id = auth.uid()
      or public.profile_blocked_pair(p_candidate_id, auth.uid())
    then 0
    else (
      select count(*)::integer
      from public.follows viewer_follow
      join public.follows candidate_follow
        on candidate_follow.following_id = viewer_follow.following_id
       and candidate_follow.follower_id = p_candidate_id
       and candidate_follow.status = 'accepted'
      where viewer_follow.follower_id = auth.uid()
        and viewer_follow.status = 'accepted'
    )
  end;
$$;

revoke all on function wimpex_private.consume_search_rate_limit() from public, anon;
revoke all on function wimpex_private.search_mutual_follow_count(uuid) from public, anon;
grant execute on function wimpex_private.consume_search_rate_limit() to authenticated;
grant execute on function wimpex_private.search_mutual_follow_count(uuid) to authenticated;

create function public.search_people(
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
  if viewer_id is null then
    raise exception 'Sign in to search.';
  end if;
  if char_length(query_text) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if result_limit < 1 or result_limit > 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(p.is_demo, false)
  into viewer_is_demo
  from public.profiles p
  where p.id = viewer_id;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.is_private,
    p.followers_count,
    coalesce(f.status, 'none')
  from public.profiles p
  left join public.follows f
    on f.follower_id = viewer_id
   and f.following_id = p.id
  where p.id <> viewer_id
    and (viewer_is_demo or not p.is_demo)
    and (p.username ilike '%' || query_text || '%' or p.display_name ilike '%' || query_text || '%')
    and (
      p_cursor_username is null
      or (p.username, p.id) > (p_cursor_username, p_cursor_id)
    )
    and not public.profile_blocked_pair(p.id, viewer_id)
  order by p.username, p.id
  limit result_limit;
end;
$$;

create function public.search_videos(
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
  if viewer_id is null then
    raise exception 'Sign in to search.';
  end if;
  if char_length(query_text) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if result_limit < 1 or result_limit > 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(p.is_demo, false)
  into viewer_is_demo
  from public.profiles p
  where p.id = viewer_id;

  return query
  with selected_posts as materialized (
    select p.*
    from public.posts p
    join public.profiles author on author.id = p.author_id
    where p.status = 'published'
      and p.published_at is not null
      and public.can_view_post(p.id, viewer_id)
      and (viewer_is_demo or not author.is_demo)
      and (
        p_cursor_published_at is null
        or (p.published_at, p.id) < (p_cursor_published_at, p_cursor_id)
      )
      and (
        (hashtag_text <> '' and exists (
          select 1 from unnest(p.hashtags) hashtag
          where lower(hashtag) = hashtag_text
        ))
        or (
          hashtag_text = ''
          and (
            p.caption_search @@ websearch_to_tsquery('simple', query_text)
            or p.caption ilike '%' || query_text || '%'
            or p.hashtags @> array[query_text]
            or exists (
              select 1 from unnest(p.hashtags) hashtag
              where lower(hashtag) like '%' || query_text || '%'
            )
          )
        )
      )
    order by p.published_at desc, p.id desc
    limit result_limit
  )
  select
    to_jsonb(p),
    jsonb_build_object(
      'username', author.username,
      'display_name', author.display_name,
      'avatar_url', author.avatar_url
    ),
    exists (
      select 1 from public.post_likes likes
      where likes.post_id = p.id and likes.user_id = viewer_id
    ),
    exists (
      select 1 from public.post_saves saves
      where saves.post_id = p.id and saves.user_id = viewer_id
    ),
    exists (
      select 1 from public.follows follows
      where follows.follower_id = viewer_id
        and follows.following_id = p.author_id
        and follows.status = 'accepted'
    )
  from selected_posts p
  join public.profiles author on author.id = p.author_id
  order by p.published_at desc, p.id desc;
end;
$$;

create function public.search_hashtags(
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
  if viewer_id is null then
    raise exception 'Sign in to search.';
  end if;
  if char_length(query_text) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if result_limit < 1 or result_limit > 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  perform wimpex_private.consume_search_rate_limit();

  select coalesce(p.is_demo, false)
  into viewer_is_demo
  from public.profiles p
  where p.id = viewer_id;

  return query
  with visible_tags as (
    select lower(hashtag) as normalized_tag, count(distinct p.id)::bigint as uses
    from public.posts p
    join public.profiles author on author.id = p.author_id
    cross join lateral unnest(p.hashtags) hashtag
    where p.status = 'published'
      and public.can_view_post(p.id, viewer_id)
      and (viewer_is_demo or not author.is_demo)
      and (p_exact or p.published_at >= now() - interval '30 days')
          and public.hashtags_search_text(p.hashtags) like '%' || query_text || '%'
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

create function public.trending_hashtags()
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
  if viewer_id is null then
    raise exception 'Sign in to view trending hashtags.';
  end if;

  select coalesce(p.is_demo, false)
  into viewer_is_demo
  from public.profiles p
  where p.id = viewer_id;

  return query
  select lower(hashtag), count(distinct p.id)::bigint
  from public.posts p
  join public.profiles author on author.id = p.author_id
  cross join lateral unnest(p.hashtags) hashtag
  where p.status = 'published'
    and p.published_at >= now() - interval '7 days'
    and public.can_view_post(p.id, viewer_id)
    and (viewer_is_demo or not author.is_demo)
  group by lower(hashtag)
  order by count(distinct p.id) desc, lower(hashtag)
  limit 10;
end;
$$;

create function public.suggested_people()
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
  if viewer_id is null then
    raise exception 'Sign in to load suggested people.';
  end if;

  select coalesce(p.is_demo, false)
  into viewer_is_demo
  from public.profiles p
  where p.id = viewer_id;

  return query
  with eligible as materialized (
    select
      p.*,
      wimpex_private.search_mutual_follow_count(p.id) as mutual_count,
      (
        select count(*)::integer
        from public.profile_interests viewer_interest
        join public.profile_interests candidate_interest
          on candidate_interest.interest = viewer_interest.interest
         and candidate_interest.profile_id = p.id
        where viewer_interest.profile_id = viewer_id
      ) as interest_count
    from public.profiles p
    where p.id <> viewer_id
      and (viewer_is_demo or not p.is_demo)
      and not exists (
        select 1 from public.follows f
        where f.follower_id = viewer_id and f.following_id = p.id
      )
      and not public.profile_blocked_pair(p.id, viewer_id)
  )
  select
    eligible.id,
    eligible.username,
    eligible.display_name,
    eligible.avatar_url,
    eligible.is_private,
    eligible.followers_count,
    eligible.mutual_count,
    eligible.interest_count
  from eligible
  where eligible.mutual_count > 0 or eligible.interest_count > 0
  order by eligible.mutual_count desc, eligible.interest_count desc,
    eligible.followers_count desc, eligible.username, eligible.id
  limit 20;
end;
$$;

revoke all on function public.search_people(text, text, uuid, integer) from public, anon;
revoke all on function public.search_videos(text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.search_hashtags(text, boolean, bigint, text, integer) from public, anon;
revoke all on function public.trending_hashtags() from public, anon;
revoke all on function public.suggested_people() from public, anon;
grant execute on function public.search_people(text, text, uuid, integer) to authenticated;
grant execute on function public.search_videos(text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.search_hashtags(text, boolean, bigint, text, integer) to authenticated;
grant execute on function public.trending_hashtags() to authenticated;
grant execute on function public.suggested_people() to authenticated;
