create table public.post_watch_samples (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  session_id uuid not null,
  sampled_at timestamptz not null,
  watch_ms integer not null check (watch_ms between 1 and 10000),
  duration_ms integer not null check (duration_ms between 1 and 60000),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, post_id, sampled_at)
);

alter table public.post_watch_samples enable row level security;
revoke all on public.post_watch_samples from public, anon, authenticated;

create index post_watch_samples_post_time_idx
  on public.post_watch_samples (post_id, sampled_at desc);
create index post_watch_samples_user_time_idx
  on public.post_watch_samples (user_id, sampled_at desc);
create index post_shares_post_created_idx
  on public.post_shares (post_id, created_at desc);
create index post_likes_post_created_idx
  on public.post_likes (post_id, created_at desc);
create index follows_following_created_idx
  on public.follows (following_id, created_at desc)
  where status = 'accepted';

create function public.record_post_watch_batch(p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  event jsonb;
  post_key uuid;
  session_key uuid;
  watched_ms integer;
  was_completed boolean;
  post_duration integer;
  bucket_at timestamptz;
  recent_samples integer;
  recent_watch_ms bigint;
begin
  if viewer_id is null then
    raise exception 'Sign in to record video analytics.';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'A watch batch must be a JSON array.';
  end if;
  if jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 50 then
    raise exception 'A watch batch must contain between 1 and 50 samples.';
  end if;

  for event in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(event) is distinct from 'object'
      or jsonb_typeof(event->'post_id') is distinct from 'string'
      or jsonb_typeof(event->'session_id') is distinct from 'string'
      or jsonb_typeof(event->'watch_ms') is distinct from 'number'
      or jsonb_typeof(event->'completed') is distinct from 'boolean' then
      raise exception 'A watch sample has an invalid shape.';
    end if;

    post_key := (event->>'post_id')::uuid;
    session_key := (event->>'session_id')::uuid;
    watched_ms := (event->>'watch_ms')::integer;
    was_completed := (event->>'completed')::boolean;
    if watched_ms < 1 or watched_ms > 10000 then
      raise exception 'Watch samples must be between 1 and 10000 milliseconds.';
    end if;
    if not public.can_view_post(post_key, viewer_id) then
      raise exception 'This video is not available.';
    end if;

    select p.duration_ms
    into post_duration
    from public.posts p
    where p.id = post_key
      and p.status = 'published'
      and p.moderation_status = 'clear';
    if post_duration is null then
      raise exception 'This video is not available for analytics.';
    end if;

    select count(*), coalesce(sum(s.watch_ms), 0)
    into recent_samples, recent_watch_ms
    from public.post_watch_samples s
    where s.user_id = viewer_id
      and s.created_at >= now() - interval '1 minute';
    if recent_samples >= 60 or recent_watch_ms + watched_ms > 60000 then
      raise exception 'Video watch analytics are rate limited.';
    end if;

    bucket_at := to_timestamp(floor(extract(epoch from now()) / 10) * 10);
    insert into public.post_watch_samples (
      user_id, post_id, session_id, sampled_at, watch_ms, duration_ms, completed
    )
    values (viewer_id, post_key, session_key, bucket_at, watched_ms, post_duration, was_completed)
    on conflict (user_id, session_id, post_id, sampled_at)
    do update set
      watch_ms = least(10000, public.post_watch_samples.watch_ms + excluded.watch_ms),
      completed = public.post_watch_samples.completed or excluded.completed;
  end loop;
end;
$$;
revoke all on function public.record_post_watch_batch(jsonb) from public, anon;
grant execute on function public.record_post_watch_batch(jsonb) to authenticated;

create function public.get_creator_analytics(p_period_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  owner_id uuid := auth.uid();
  period_start timestamptz;
  result jsonb;
begin
  if owner_id is null then
    raise exception 'Sign in to view creator analytics.';
  end if;
  if p_period_days is null or p_period_days not in (7, 28, 90) then
    raise exception 'Choose a 7, 28, or 90 day analytics period.';
  end if;
  period_start := now() - make_interval(days => p_period_days);

  with owner_posts as (
    select p.id, p.caption, p.duration_ms
    from public.posts p
    where p.author_id = owner_id
      and p.status = 'published'
  ),
  samples as (
    select s.*
    from public.post_watch_samples s
    join owner_posts p on p.id = s.post_id
    where s.sampled_at >= period_start
  ),
  sessions as (
    select s.post_id, s.user_id, s.session_id,
      sum(s.watch_ms)::bigint as watch_ms,
      max(s.duration_ms)::integer as duration_ms,
      bool_or(s.completed) as completed,
      min(s.sampled_at) as first_sample_at
    from samples s
    group by s.post_id, s.user_id, s.session_id
  ),
  post_watch as (
    select post_id,
      count(*)::integer as views,
      count(distinct user_id)::integer as unique_viewers,
      coalesce(sum(watch_ms), 0)::bigint as watch_ms,
      coalesce(round(avg(least(100::numeric, watch_ms * 100.0 / nullif(duration_ms, 0)))), 0)::integer
        as average_watch_percent
    from sessions
    group by post_id
  ),
  post_likes_count as (
    select l.post_id, count(*)::integer as likes
    from public.post_likes l
    join owner_posts p on p.id = l.post_id
    where l.created_at >= period_start
    group by l.post_id
  ),
  post_comments_count as (
    select c.post_id, count(*)::integer as comments
    from public.comments c
    join owner_posts p on p.id = c.post_id
    where c.created_at >= period_start
      and c.deleted_at is null
      and c.visibility_state = 'visible'
      and c.moderation_status = 'clear'
    group by c.post_id
  ),
  post_shares_count as (
    select s.post_id, count(*)::integer as shares
    from public.post_shares s
    join owner_posts p on p.id = s.post_id
    where s.created_at >= period_start
    group by s.post_id
  ),
  daily_counts as (
    select s.sampled_at::date as day,
      count(distinct (s.post_id, s.session_id))::integer as views,
      coalesce(sum(s.watch_ms), 0)::bigint as watch_ms
    from samples s
    group by s.sampled_at::date
  ),
  daily_series as (
    select generated.day::date as day,
      coalesce(d.views, 0)::integer as views,
      coalesce(d.watch_ms, 0)::bigint as watch_ms
    from generate_series(
      date_trunc('day', period_start),
      date_trunc('day', now()),
      interval '1 day'
    ) as generated(day)
    left join daily_counts d on d.day = generated.day::date
  ),
  post_metrics as (
    select p.id as post_id,
      p.caption,
      coalesce(w.views, 0) as views,
      coalesce(w.unique_viewers, 0) as unique_viewers,
      coalesce(w.watch_ms, 0) as watch_ms,
      coalesce(w.average_watch_percent, 0) as average_watch_percent,
      coalesce(l.likes, 0) as likes,
      coalesce(c.comments, 0) as comments,
      coalesce(sh.shares, 0) as shares
    from owner_posts p
    left join post_watch w on w.post_id = p.id
    left join post_likes_count l on l.post_id = p.id
    left join post_comments_count c on c.post_id = p.id
    left join post_shares_count sh on sh.post_id = p.id
  )
  select jsonb_build_object(
    'period_days', p_period_days,
    'views', coalesce((select sum(views) from post_watch), 0),
    'unique_viewers', coalesce((select count(distinct user_id) from samples), 0),
    'watch_ms', coalesce((select sum(watch_ms) from sessions), 0),
    'average_watch_percent', coalesce(
      (select round(avg(least(100::numeric, watch_ms * 100.0 / nullif(duration_ms, 0)))::numeric)::integer from sessions),
      0
    ),
    'followers_gained', (
      select count(*)::integer from public.follows f
      where f.following_id = owner_id
        and f.status = 'accepted'
        and f.created_at >= period_start
    ),
    'likes', coalesce((select sum(likes) from post_metrics), 0),
    'comments', coalesce((select sum(comments) from post_metrics), 0),
    'shares', coalesce((select sum(shares) from post_metrics), 0),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', day, 'views', views, 'watch_ms', watch_ms
    ) order by day) from daily_series), '[]'::jsonb),
    'top_posts', coalesce((select jsonb_agg(to_jsonb(top_post) order by top_post.views desc, top_post.watch_ms desc)
      from (select * from post_metrics order by views desc, watch_ms desc limit 5) top_post), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;
revoke all on function public.get_creator_analytics(integer) from public, anon;
grant execute on function public.get_creator_analytics(integer) to authenticated;

create function public.purge_post_watch_samples()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  removed_count bigint;
begin
  delete from public.post_watch_samples
  where sampled_at < now() - interval '180 days';
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;
revoke all on function public.purge_post_watch_samples() from public, anon, authenticated;
grant execute on function public.purge_post_watch_samples() to service_role;
