create index profile_interests_interest_profile_idx
  on public.profile_interests (interest, profile_id);

create index posts_explore_published_at_author_idx
  on public.posts (published_at desc, author_id)
  where status = 'published';

create function public.explore_hashtags(
  p_window text default '7d',
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
  viewer_is_demo boolean;
  result_limit integer := coalesce(p_page_size, 20);
  window_start timestamptz;
begin
  if viewer_id is null then raise exception 'Sign in to explore hashtags.'; end if;
  if p_window is null or p_window not in ('24h', '7d') then raise exception 'Choose a 24-hour or 7-day window.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();
  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;
  window_start := now() - case when p_window = '24h' then interval '24 hours' else interval '7 days' end;

  return query
  with visible_posts as materialized (
    select post.id, post.hashtags
    from public.posts post
    join public.profiles author on author.id = post.author_id
    where post.status = 'published'
      and post.published_at >= window_start
      and not author.is_private
      and public.teen_profile_can_appear_in_discovery(author.id)
      and (viewer_is_demo or not author.is_demo)
      and not public.profile_blocked_pair(author.id, viewer_id)
      and public.can_view_post(post.id, viewer_id)
  ),
  ranked_tags as (
    select lower(trim(both '#' from btrim(hashtag))) as normalized_tag,
      count(distinct visible_posts.id)::bigint as uses
    from visible_posts
    cross join lateral unnest(visible_posts.hashtags) hashtag
    where nullif(trim(both '#' from btrim(hashtag)), '') is not null
    group by lower(trim(both '#' from btrim(hashtag)))
  )
  select ranked_tags.normalized_tag, ranked_tags.uses
  from ranked_tags
  where p_cursor_post_count is null
    or ranked_tags.uses < p_cursor_post_count
    or (ranked_tags.uses = p_cursor_post_count and ranked_tags.normalized_tag > p_cursor_tag)
  order by ranked_tags.uses desc, ranked_tags.normalized_tag
  limit result_limit;
end;
$$;

create function public.explore_popular_creators(
  p_window text default '7d',
  p_cursor_score bigint default null,
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
  popularity_score bigint,
  published_post_count bigint
)
language plpgsql
volatile
security invoker
set search_path = public, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  viewer_is_demo boolean;
  result_limit integer := coalesce(p_page_size, 20);
  window_start timestamptz;
begin
  if viewer_id is null then raise exception 'Sign in to explore creators.'; end if;
  if p_window is null or p_window not in ('24h', '7d') then raise exception 'Choose a 24-hour or 7-day window.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();
  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;
  window_start := now() - case when p_window = '24h' then interval '24 hours' else interval '7 days' end;

  return query
  with creator_activity as materialized (
    select post.author_id,
      sum(post.view_count::bigint + post.like_count::bigint)::bigint as score,
      count(*)::bigint as post_count
    from public.posts post
    join public.profiles author on author.id = post.author_id
    where post.status = 'published'
      and post.published_at >= window_start
      and not author.is_private
      and public.teen_profile_can_appear_in_discovery(author.id)
      and (viewer_is_demo or not author.is_demo)
      and not public.profile_blocked_pair(author.id, viewer_id)
      and public.can_view_post(post.id, viewer_id)
    group by post.author_id
  ),
  ranked_creators as (
    select profile.id as creator_id, profile.username as creator_username,
      profile.display_name as creator_display_name, profile.avatar_url as creator_avatar_url,
      profile.is_private as creator_is_private,
      profile.followers_count as creator_followers_count,
      activity.score as creator_score, activity.post_count as creator_post_count
    from creator_activity activity
    join public.profiles profile on profile.id = activity.author_id
    where profile.id <> viewer_id
      and (
        p_cursor_score is null
        or activity.score < p_cursor_score
        or (
          activity.score = p_cursor_score
          and (profile.username, profile.id) > (p_cursor_username, p_cursor_id)
        )
      )
  )
  select ranked.creator_id, ranked.creator_username, ranked.creator_display_name,
    ranked.creator_avatar_url, ranked.creator_is_private, ranked.creator_followers_count,
    ranked.creator_score, ranked.creator_post_count
  from ranked_creators ranked
  order by ranked.creator_score desc, ranked.creator_username, ranked.creator_id
  limit result_limit;
end;
$$;

create function public.explore_suggested_accounts(
  p_cursor_mutual_follows integer default null,
  p_cursor_shared_interests integer default null,
  p_cursor_followers integer default null,
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
  mutual_follows integer,
  shared_interests integer
)
language plpgsql
volatile
security invoker
set search_path = public, wimpex_private, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  viewer_is_demo boolean;
  result_limit integer := coalesce(p_page_size, 20);
begin
  if viewer_id is null then raise exception 'Sign in to find suggested accounts.'; end if;
  if result_limit < 1 or result_limit > 20 then raise exception 'Page size must be between 1 and 20.'; end if;
  perform wimpex_private.consume_search_rate_limit();
  select coalesce(profile.is_demo, false) into viewer_is_demo
  from public.profiles profile where profile.id = viewer_id;

  return query
  with eligible as materialized (
    select profile.id, profile.username, profile.display_name, profile.avatar_url, profile.is_private,
      profile.followers_count,
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
      and not profile.is_private
      and public.teen_profile_can_appear_in_discovery(profile.id)
      and (viewer_is_demo or not profile.is_demo)
      and not exists (
        select 1 from public.follows follow
        where follow.follower_id = viewer_id and follow.following_id = profile.id
      )
      and not public.profile_blocked_pair(profile.id, viewer_id)
  ),
  ranked as (
    select eligible.*
    from eligible
    where (eligible.mutual_count > 0 or eligible.interest_count > 0)
      and (
        p_cursor_mutual_follows is null
        or eligible.mutual_count < p_cursor_mutual_follows
        or (
          eligible.mutual_count = p_cursor_mutual_follows
          and eligible.interest_count < p_cursor_shared_interests
        )
        or (
          eligible.mutual_count = p_cursor_mutual_follows
          and eligible.interest_count = p_cursor_shared_interests
          and eligible.followers_count < p_cursor_followers
        )
        or (
          eligible.mutual_count = p_cursor_mutual_follows
          and eligible.interest_count = p_cursor_shared_interests
          and eligible.followers_count = p_cursor_followers
          and (eligible.username, eligible.id) > (p_cursor_username, p_cursor_id)
        )
      )
  )
  select ranked.id, ranked.username, ranked.display_name, ranked.avatar_url, ranked.is_private,
    ranked.followers_count, ranked.mutual_count, ranked.interest_count
  from ranked
  order by ranked.mutual_count desc, ranked.interest_count desc,
    ranked.followers_count desc, ranked.username, ranked.id
  limit result_limit;
end;
$$;

revoke all on function public.explore_hashtags(text, bigint, text, integer) from public, anon;
revoke all on function public.explore_popular_creators(text, bigint, text, uuid, integer) from public, anon;
revoke all on function public.explore_suggested_accounts(integer, integer, integer, text, uuid, integer) from public, anon;
grant execute on function public.explore_hashtags(text, bigint, text, integer) to authenticated;
grant execute on function public.explore_popular_creators(text, bigint, text, uuid, integer) to authenticated;
grant execute on function public.explore_suggested_accounts(integer, integer, integer, text, uuid, integer) to authenticated;
