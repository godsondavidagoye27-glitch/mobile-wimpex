create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 150),
  hashtags text[] not null default '{}',
  video_path text,
  thumb_path text,
  captions_path text,
  duration_ms integer check (duration_ms is null or duration_ms between 1 and 60000),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  audience text not null default 'everyone' check (audience in ('everyone', 'followers')),
  allow_comments boolean not null default true,
  auto_captions boolean not null default true,
  status text not null default 'uploading' check (status in ('uploading', 'published', 'failed')),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  save_count integer not null default 0 check (save_count >= 0),
  share_count integer not null default 0 check (share_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index posts_status_published_at_id_idx
  on public.posts (status, published_at desc, id desc);
create index posts_author_published_at_idx
  on public.posts (author_id, published_at desc);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.post_saves (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_saves_user_idx on public.post_saves (user_id);

create table public.post_views (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_views_user_idx on public.post_views (user_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  like_count integer not null default 0 check (like_count >= 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index comments_post_created_idx
  on public.comments (post_id, created_at, id);
create index comments_author_idx on public.comments (author_id);
create index comments_parent_idx on public.comments (parent_id);

create table public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_likes_user_idx on public.comment_likes (user_id);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('accepted', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index follows_following_idx on public.follows (following_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index reports_reporter_idx on public.reports (reporter_id);

revoke all on public.posts, public.post_likes, public.post_saves, public.post_views,
  public.comments, public.comment_likes, public.follows, public.blocks, public.reports
  from anon, authenticated;

create function public.can_view_post(p_post_id uuid, p_viewer_id uuid)
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
      from public.posts p
      join public.profiles author on author.id = p.author_id
      where p.id = p_post_id
        and (
          p.author_id = p_viewer_id
          or (
            p.status = 'published'
            and not exists (
              select 1
              from public.blocks b
              where (b.blocker_id = p_viewer_id and b.blocked_id = p.author_id)
                 or (b.blocker_id = p.author_id and b.blocked_id = p_viewer_id)
            )
            and (
              (p.audience = 'everyone' and not author.is_private)
              or exists (
                select 1
                from public.follows f
                where f.follower_id = p_viewer_id
                  and f.following_id = p.author_id
                  and f.status = 'accepted'
              )
            )
          )
        )
    )
  end;
$$;

revoke all on function public.can_view_post(uuid, uuid) from public, anon;
grant execute on function public.can_view_post(uuid, uuid) to authenticated;

create function public.set_follow_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  select case when p.is_private then 'pending' else 'accepted' end
  into new.status
  from public.profiles p
  where p.id = new.following_id;

  if new.status is null then
    raise exception 'The profile to follow does not exist.';
  end if;
  return new;
end;
$$;

create trigger follows_set_status
before insert on public.follows
for each row execute function public.set_follow_status();

create function public.update_post_counter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_post_id uuid;
  counter_delta integer;
  counter_column text;
begin
  if tg_op = 'DELETE' then
    counter_delta := -1;
    if tg_table_name = 'comments' then
      affected_post_id := old.post_id;
    else
      affected_post_id := old.post_id;
    end if;
  else
    counter_delta := 1;
    if tg_table_name = 'comments' then
      affected_post_id := new.post_id;
    else
      affected_post_id := new.post_id;
    end if;
  end if;

  counter_column := case tg_table_name
    when 'post_likes' then 'like_count'
    when 'post_saves' then 'save_count'
    when 'post_views' then 'view_count'
    when 'comments' then 'comment_count'
  end;

  execute format(
    'update public.posts set %I = greatest(0, %I + $1) where id = $2',
    counter_column,
    counter_column
  ) using counter_delta, affected_post_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger post_likes_update_count
after insert or delete on public.post_likes
for each row execute function public.update_post_counter();
create trigger post_saves_update_count
after insert or delete on public.post_saves
for each row execute function public.update_post_counter();
create trigger post_views_update_count
after insert or delete on public.post_views
for each row execute function public.update_post_counter();
create trigger comments_update_count
after insert or delete on public.comments
for each row execute function public.update_post_counter();

create function public.update_comment_like_counter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected_comment_id uuid;
  counter_delta integer;
begin
  if tg_op = 'DELETE' then
    affected_comment_id := old.comment_id;
    counter_delta := -1;
  else
    affected_comment_id := new.comment_id;
    counter_delta := 1;
  end if;

  update public.comments
  set like_count = greatest(0, like_count + counter_delta)
  where id = affected_comment_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger comment_likes_update_count
after insert or delete on public.comment_likes
for each row execute function public.update_comment_like_counter();

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.post_views enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

grant select, delete on public.posts to authenticated;
grant insert (
  author_id, caption, hashtags, video_path, thumb_path, captions_path,
  duration_ms, width, height, audience, allow_comments, auto_captions
) on public.posts to authenticated;
grant update (caption, hashtags, audience, allow_comments, auto_captions)
  on public.posts to authenticated;

grant select, insert, delete on public.post_likes, public.post_saves to authenticated;
grant select, insert on public.post_views to authenticated;
grant select, delete on public.comments to authenticated;
grant insert (post_id, author_id, parent_id, body) on public.comments to authenticated;
grant update (body, deleted_at) on public.comments to authenticated;
grant select, insert, delete on public.comment_likes to authenticated;
grant select, delete on public.follows to authenticated;
grant insert (follower_id, following_id) on public.follows to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert on public.reports to authenticated;

revoke update on public.posts from authenticated;
grant update (caption, hashtags, audience, allow_comments, auto_captions)
  on public.posts to authenticated;
revoke insert, update, delete on public.post_views from authenticated;
grant insert on public.post_views to authenticated;

create policy "Visible posts can be read"
on public.posts for select to authenticated
using (public.can_view_post(id, auth.uid()));

create policy "Users can create their own posts"
on public.posts for insert to authenticated
with check (author_id = auth.uid());

create policy "Users can update their own posts"
on public.posts for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "Users can delete their own posts"
on public.posts for delete to authenticated
using (author_id = auth.uid());

create policy "Users can read their own post likes"
on public.post_likes for select to authenticated
using (user_id = auth.uid());
create policy "Users can like visible posts"
on public.post_likes for insert to authenticated
with check (user_id = auth.uid() and public.can_view_post(post_id, auth.uid()));
create policy "Users can remove their own post likes"
on public.post_likes for delete to authenticated
using (user_id = auth.uid());

create policy "Users can read their own saved posts"
on public.post_saves for select to authenticated
using (user_id = auth.uid());
create policy "Users can save visible posts"
on public.post_saves for insert to authenticated
with check (user_id = auth.uid() and public.can_view_post(post_id, auth.uid()));
create policy "Users can remove their own saved posts"
on public.post_saves for delete to authenticated
using (user_id = auth.uid());

create policy "Users can read their own post views"
on public.post_views for select to authenticated
using (user_id = auth.uid());
create policy "Users can record views of visible posts"
on public.post_views for insert to authenticated
with check (user_id = auth.uid() and public.can_view_post(post_id, auth.uid()));

create policy "Comments are visible with their post"
on public.comments for select to authenticated
using (public.can_view_post(post_id, auth.uid()));
create policy "Users can comment on visible posts"
on public.comments for insert to authenticated
with check (
  author_id = auth.uid()
  and public.can_view_post(post_id, auth.uid())
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id and p.allow_comments
  )
);
create policy "Users can update their own comments"
on public.comments for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());
create policy "Users can delete their own comments"
on public.comments for delete to authenticated
using (author_id = auth.uid());

create policy "Users can read their own comment likes"
on public.comment_likes for select to authenticated
using (user_id = auth.uid());
create policy "Users can like comments on visible posts"
on public.comment_likes for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.comments c
    where c.id = comment_likes.comment_id
      and public.can_view_post(c.post_id, auth.uid())
  )
);
create policy "Users can remove their own comment likes"
on public.comment_likes for delete to authenticated
using (user_id = auth.uid());

create policy "Users can read follows involving themselves"
on public.follows for select to authenticated
using (follower_id = auth.uid() or following_id = auth.uid());
create policy "Users can follow from their own account"
on public.follows for insert to authenticated
with check (follower_id = auth.uid());
create policy "Users can unfollow from their own account"
on public.follows for delete to authenticated
using (follower_id = auth.uid());

create function public.get_follow_counts(profile_id uuid)
returns table (follower_count bigint, following_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select
    count(*) filter (where f.following_id = profile_id and f.status = 'accepted'),
    count(*) filter (where f.follower_id = profile_id and f.status = 'accepted')
  from public.follows f
  where auth.uid() is not null
    and (f.following_id = profile_id or f.follower_id = profile_id);
$$;

revoke all on function public.get_follow_counts(uuid) from public, anon;
grant execute on function public.get_follow_counts(uuid) to authenticated;

create policy "Users can read their own blocks"
on public.blocks for select to authenticated
using (blocker_id = auth.uid());
create policy "Users can block from their own account"
on public.blocks for insert to authenticated
with check (blocker_id = auth.uid());
create policy "Users can unblock from their own account"
on public.blocks for delete to authenticated
using (blocker_id = auth.uid());

create policy "Users can read their own reports"
on public.reports for select to authenticated
using (reporter_id = auth.uid());
create policy "Users can submit reports from their own account"
on public.reports for insert to authenticated
with check (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos', 'videos', false, 52428800, array['video/mp4', 'video/quicktime']),
  ('thumbnails', 'thumbnails', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners and viewers can read post videos"
on storage.objects for select to authenticated
using (
  bucket_id = 'videos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.posts p
      where p.video_path = storage.objects.name
    )
  )
);

create policy "Owners and viewers can read post thumbnails"
on storage.objects for select to authenticated
using (
  bucket_id = 'thumbnails'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.posts p
      where p.thumb_path = storage.objects.name
    )
  )
);

create policy "Users can upload videos to their own folder"
on storage.objects for insert to authenticated
with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update videos in their own folder"
on storage.objects for update to authenticated
using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete videos in their own folder"
on storage.objects for delete to authenticated
using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload thumbnails to their own folder"
on storage.objects for insert to authenticated
with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update thumbnails in their own folder"
on storage.objects for update to authenticated
using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete thumbnails in their own folder"
on storage.objects for delete to authenticated
using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

create function public.get_feed(
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
  result_limit integer := coalesce(page_size, 10);
begin
  if viewer_id is null then
    raise exception 'Sign in to load the feed.';
  end if;
  if mode not in ('for_you', 'following') then
    raise exception 'Feed mode must be for_you or following.';
  end if;
  if result_limit < 1 or result_limit > 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;

  return query
  with eligible as materialized (
    select p.*
    from public.posts p
    where p.status = 'published'
      and p.author_id <> viewer_id
      and public.can_view_post(p.id, viewer_id)
      and (
        cursor_published_at is null
        or (p.published_at, p.id) < (cursor_published_at, cursor_id)
      )
      and (
        mode = 'for_you'
        or exists (
          select 1
          from public.follows f
          where f.follower_id = viewer_id
            and f.following_id = p.author_id
            and f.status = 'accepted'
        )
      )
  ),
  unseen as materialized (
    select e.*
    from eligible e
    where mode = 'following'
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
    where mode = 'for_you'
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

create function public.finalize_post(post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  post_author_id uuid;
  post_video_path text;
  post_status text;
begin
  select p.author_id, p.video_path, p.status
  into post_author_id, post_video_path, post_status
  from public.posts p
  where p.id = finalize_post.post_id;

  if not found then
    raise exception 'Post not found.';
  end if;
  if post_author_id <> auth.uid() then
    raise exception 'You can only publish your own post.';
  end if;
  if post_video_path is null or not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'videos' and o.name = post_video_path
  ) then
    raise exception 'The uploaded video could not be found.';
  end if;
  if post_status = 'published' then
    return;
  end if;
  if post_status not in ('uploading', 'failed') then
    raise exception 'This post cannot be published in its current state.';
  end if;

  update public.posts
  set status = 'published', published_at = now()
  where id = finalize_post.post_id;
end;
$$;

revoke all on function public.finalize_post(uuid) from public, anon;
grant execute on function public.finalize_post(uuid) to authenticated;

create function public.increment_share(post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.can_view_post(increment_share.post_id, auth.uid()) then
    raise exception 'This post is not available.';
  end if;

  update public.posts
  set share_count = share_count + 1
  where id = increment_share.post_id;
end;
$$;

revoke all on function public.increment_share(uuid) from public, anon;
grant execute on function public.increment_share(uuid) to authenticated;
