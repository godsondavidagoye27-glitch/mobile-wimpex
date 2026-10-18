create table public.post_shares (
  user_id uuid not null references auth.users(id) on delete cascade,
  share_id uuid not null,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, share_id)
);

create index post_shares_post_id_idx on public.post_shares(post_id);

alter table public.post_shares enable row level security;
revoke all on public.post_shares from public, anon, authenticated;

drop function if exists public.increment_share(uuid);

create function public.increment_share(post_id uuid, share_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null
    or increment_share.share_id is null
    or not public.can_view_post(increment_share.post_id, viewer_id) then
    raise exception 'This post is not available.';
  end if;

  insert into public.post_shares (user_id, share_id, post_id)
  values (viewer_id, increment_share.share_id, increment_share.post_id)
  on conflict (user_id, share_id) do nothing;

  if found then
    update public.posts
    set share_count = share_count + 1
    where id = increment_share.post_id;
  end if;
end;
$$;

revoke all on function public.increment_share(uuid, uuid) from public, anon;
grant execute on function public.increment_share(uuid, uuid) to authenticated;

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
  if viewer_id is null then
    raise exception 'Sign in to load the feed.';
  end if;
  if get_feed.mode not in ('for_you', 'following') then
    raise exception 'Feed mode must be for_you or following.';
  end if;
  if result_limit < 1 or result_limit > 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;

  return query
  with candidate_pool as not materialized (
    select p.*
    from public.posts p
    join public.profiles author on author.id = p.author_id
    where p.status = 'published'
      and p.author_id <> viewer_id
      and (
        get_feed.cursor_published_at is null
        or (p.published_at, p.id) < (get_feed.cursor_published_at, get_feed.cursor_id)
      )
      and not exists (
        select 1
        from public.blocks b
        where (b.blocker_id = viewer_id and b.blocked_id = p.author_id)
           or (b.blocker_id = p.author_id and b.blocked_id = viewer_id)
      )
      and (
        (p.audience = 'everyone' and not author.is_private)
        or exists (
          select 1
          from public.follows f
          where f.follower_id = viewer_id
            and f.following_id = p.author_id
            and f.status = 'accepted'
        )
      )
      and (
        get_feed.mode = 'for_you'
        or exists (
          select 1
          from public.follows f
          where f.follower_id = viewer_id
            and f.following_id = p.author_id
            and f.status = 'accepted'
        )
      )
    order by p.published_at desc, p.id desc
  ),
  eligible as not materialized (
    select * from candidate_pool
  ),
  unseen as materialized (
    select e.*
    from eligible e
    where get_feed.mode = 'following'
      or not exists (
        select 1 from public.post_views v
        where v.post_id = e.id and v.user_id = viewer_id
      )
    order by e.published_at desc, e.id desc
    limit result_limit
  ),
  unseen_count as (
    select count(*)::integer as count from unseen
  ),
  seen_fill as (
    select e.*
    from eligible e
    where get_feed.mode = 'for_you'
      and (select count from unseen_count) < result_limit
      and exists (
        select 1 from public.post_views v
        where v.post_id = e.id and v.user_id = viewer_id
      )
      and not exists (select 1 from unseen u where u.id = e.id)
    order by e.published_at desc, e.id desc
    limit greatest(0, result_limit - (select count from unseen_count))
  ),
  selected as (
    select * from unseen
    union all
    select * from seen_fill
  )
  select
    to_jsonb(p),
    jsonb_build_object(
      'username', author.username,
      'display_name', author.display_name,
      'avatar_url', author.avatar_url
    ),
    exists (
      select 1 from public.post_likes l
      where l.post_id = p.id and l.user_id = viewer_id
    ),
    exists (
      select 1 from public.post_saves s
      where s.post_id = p.id and s.user_id = viewer_id
    ),
    exists (
      select 1 from public.follows f
      where f.follower_id = viewer_id
        and f.following_id = p.author_id
        and f.status = 'accepted'
    )
  from selected p
  join public.profiles author on author.id = p.author_id
  order by p.published_at desc, p.id desc
  limit result_limit;
end;
$$;

revoke all on function public.get_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_feed(text, timestamptz, uuid, integer) to authenticated;
