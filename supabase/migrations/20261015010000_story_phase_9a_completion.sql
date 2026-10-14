alter table public.stories
  add constraint stories_caption_style_background
  check (
    caption_style is null
    or (
      jsonb_typeof(caption_style) = 'object'
      and caption_style ? 'background'
      and caption_style->>'background' in ('sky', 'green', 'gold', 'dark', 'light')
      and (caption_style - 'background') = '{}'::jsonb
    )
  ),
  add constraint stories_media_duration
  check (
    (kind = 'image' and duration_ms = 5000)
    or (kind = 'video' and duration_ms between 1 and 15000)
  ),
  add constraint stories_image_dimensions
  check (kind <> 'image' or (width <= 1080 and height <= 1920));

update public.user_settings settings
set story_replies = 'followers'
from public.profiles profile
where profile.id = settings.user_id
  and date_part('year', age(current_date, profile.date_of_birth)) < 18;

create table public.story_creation_rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index story_creation_rate_limits_user_created_idx
  on public.story_creation_rate_limits (user_id, created_at desc);

create table public.story_view_rate_limits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  called_at timestamptz not null default clock_timestamp()
);
create index story_view_rate_limits_user_called_idx
  on public.story_view_rate_limits (user_id, called_at desc);

revoke all on public.story_creation_rate_limits, public.story_view_rate_limits
  from public, anon, authenticated;

create or replace function public.set_story_expiration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  recent_count integer;
  active_count integer;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.author_id <> auth.uid() then
      raise exception 'You can create stories only for your account.';
    end if;

    new.created_at := clock_timestamp();
    new.expires_at := new.created_at + interval '24 hours';

    if new.media_path <> new.author_id::text || '/' || new.id::text
      || case when new.kind = 'image' then '.jpg' else '.mp4' end
      and not (
        new.kind = 'video'
        and new.media_path = new.author_id::text || '/' || new.id::text || '.mov'
      )
    then
      raise exception 'Story media must use the author and story identifiers.';
    end if;

    if new.thumb_path is not null
      and new.thumb_path <> new.author_id::text || '/' || new.id::text || '_thumb.jpg'
    then
      raise exception 'Story thumbnail must use the author and story identifiers.';
    end if;

    if auth.uid() is not null then
      perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 914));
      select count(*) into recent_count
      from public.story_creation_rate_limits
      where user_id = auth.uid()
        and created_at > clock_timestamp() - interval '24 hours';

      if recent_count >= 30 then
        raise exception 'rate_limited';
      end if;

      select count(*) into active_count
      from public.stories
      where author_id = auth.uid()
        and deleted_at is null
        and expires_at > clock_timestamp();

      if active_count >= 30 then
        raise exception 'You can have at most 30 active stories.';
      end if;

      insert into public.story_creation_rate_limits (user_id)
      values (auth.uid());
    end if;
  elsif new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or new.author_id is distinct from old.author_id
  then
    raise exception 'Story ownership and timestamps cannot be changed.';
  end if;

  return new;
end;
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
  if p_viewer_id is null or auth.uid() is distinct from p_viewer_id then
    return false;
  end if;

  select * into story
  from public.stories
  where id = p_story_id
    and deleted_at is null
    and expires_at > now();

  if not found then
    return false;
  end if;

  if story.author_id = p_viewer_id then
    return true;
  end if;

  if public.story_blocked_pair(story.author_id, p_viewer_id) then
    return false;
  end if;

  select p.is_private into author_is_private
  from public.profiles p
  where p.id = story.author_id;

  if author_is_private is null then
    return false;
  end if;

  if author_is_private and not exists (
    select 1
    from public.follows f
    where f.follower_id = p_viewer_id
      and f.following_id = story.author_id
      and f.status = 'accepted'
  ) then
    return false;
  end if;

  if story.audience = 'everyone' then
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

  return story.audience = 'close_friends' and exists (
    select 1
    from public.close_friends cf
    where cf.owner_id = story.author_id
      and cf.friend_id = p_viewer_id
  );
end;
$$;

drop function public.get_story_rail();
create function public.get_story_rail()
returns table (
  author_id uuid,
  display_name text,
  username text,
  avatar_url text,
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
           bool_or(not exists (
             select 1 from public.story_views sv
             where sv.story_id = s.id and sv.viewer_id = auth.uid()
           )) as has_unseen
    from public.stories s
    where s.deleted_at is null
      and s.expires_at > now()
      and public.can_view_story(s.id, auth.uid())
    group by s.author_id
  )
  select p.id,
         p.display_name,
         p.username,
         p.avatar_url,
         v.story_count,
         v.has_unseen,
         v.is_close_friends_audience,
         v.latest_created_at,
         p.id = auth.uid()
  from visible v
  join public.profiles p on p.id = v.author_id
  order by
    case when p.id = auth.uid() then 0 else 1 end,
    case when v.has_unseen then 0 else 1 end,
    v.latest_created_at desc;
$$;

drop function public.get_author_stories(uuid);
create function public.get_author_stories(p_author_id uuid)
returns table (
  id uuid,
  kind text,
  media_path text,
  thumb_path text,
  caption text,
  caption_style jsonb,
  audience text,
  duration_ms integer,
  width integer,
  height integer,
  created_at timestamptz,
  expires_at timestamptz,
  has_viewed boolean,
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
         s.caption_style,
         s.audience,
         s.duration_ms,
         s.width,
         s.height,
         s.created_at,
         s.expires_at,
         exists (
           select 1 from public.story_views sv
           where sv.story_id = s.id and sv.viewer_id = auth.uid()
         ),
         case when s.author_id = auth.uid() then count(sv.viewer_id)::bigint else null end
  from public.stories s
  left join public.story_views sv on sv.story_id = s.id
  where s.author_id = p_author_id
    and s.deleted_at is null
    and s.expires_at > now()
    and public.can_view_story(s.id, auth.uid())
  group by s.id
  order by s.created_at asc;
$$;

create or replace function public.mark_story_viewed(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  recent_count integer;
  story_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select author_id into story_author_id
  from public.stories
  where id = p_story_id;

  if story_author_id is null or not public.can_view_story(p_story_id, auth.uid()) then
    raise exception 'You cannot view that story.';
  end if;

  if story_author_id = auth.uid() then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 915));
  delete from public.story_view_rate_limits
  where user_id = auth.uid()
    and called_at < clock_timestamp() - interval '1 minute';

  select count(*) into recent_count
  from public.story_view_rate_limits
  where user_id = auth.uid()
    and called_at >= clock_timestamp() - interval '1 minute';

  if recent_count >= 120 then
    raise exception 'rate_limited';
  end if;

  insert into public.story_view_rate_limits (user_id)
  values (auth.uid());

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, auth.uid())
  on conflict (story_id, viewer_id) do nothing;
end;
$$;

create function public.get_story_viewers(p_story_id uuid, p_cursor_viewed_at timestamptz default null, p_cursor_viewer_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  total bigint;
  rows_json jsonb;
begin
  if not exists (
    select 1 from public.stories
    where id = p_story_id and author_id = auth.uid()
  ) then
    raise exception 'Only the author can view story viewers.';
  end if;

  select count(*) into total
  from public.story_views
  where story_id = p_story_id;

  select coalesce(jsonb_agg(to_jsonb(page_row) order by page_row.viewed_at desc, page_row.viewer_id), '[]'::jsonb)
  into rows_json
  from (
    select p.id as viewer_id,
           p.display_name,
           p.username,
           p.avatar_url,
           sv.viewed_at
    from public.story_views sv
    join public.profiles p on p.id = sv.viewer_id
    where sv.story_id = p_story_id
      and (
        p_cursor_viewed_at is null
        or sv.viewed_at < p_cursor_viewed_at
        or (sv.viewed_at = p_cursor_viewed_at and sv.viewer_id > p_cursor_viewer_id)
      )
    order by sv.viewed_at desc, sv.viewer_id
    limit 25
  ) page_row;

  return jsonb_build_object('total_count', total, 'viewers', rows_json);
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
  if auth.uid() is null or p_friend_id = auth.uid() then
    raise exception 'You cannot add yourself to close friends.';
  end if;

  if public.story_blocked_pair(auth.uid(), p_friend_id) then
    raise exception 'You cannot add a blocked account.';
  end if;

  if not exists (
    select 1 from public.follows f
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

drop policy "story views insert own" on public.story_views;
create policy "story views insert own" on public.story_views
for insert to authenticated
with check (
  viewer_id = auth.uid()
  and public.can_view_story(story_id, auth.uid())
  and not exists (
    select 1 from public.stories s
    where s.id = story_id and s.author_id = auth.uid()
  )
);

revoke all on public.stories, public.story_views, public.close_friends
  from public, anon, authenticated;
grant select on public.stories to authenticated;
grant insert (id, author_id, kind, media_path, thumb_path, caption, caption_style,
  audience, duration_ms, width, height) on public.stories to authenticated;

revoke all on function public.get_story_viewers(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.get_story_viewers(uuid, timestamptz, uuid) to authenticated;

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'stories',
  'stories',
  false,
  array['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'],
  26214400
)
on conflict (id) do update
set public = false,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Story media upload own folder" on storage.objects;
create policy "Story media upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Story media select visible story" on storage.objects;
create policy "Story media select visible story"
on storage.objects for select to authenticated
using (
  bucket_id = 'stories'
  and exists (
    select 1
    from public.stories s
    where (s.media_path = name or s.thumb_path = name)
      and public.can_view_story(s.id, auth.uid())
  )
);

drop policy if exists "Story media delete own folder" on storage.objects;
create policy "Story media delete own folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end;
$$;

create or replace function public.enforce_user_settings_age()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if public.chat_user_is_minor(new.user_id) then
    new.show_online_status := false;
    new.story_replies := 'followers';
  end if;
  return new;
end;
$$;

grant insert (user_id, story_replies) on public.user_settings to authenticated;
grant update (story_replies) on public.user_settings to authenticated;

revoke all on function public.get_story_viewers(uuid, timestamptz, uuid) from public, anon;
revoke all on function public.story_blocked_pair(uuid, uuid) from public, anon;
revoke all on function public.story_user_is_minor(uuid) from public, anon;
revoke all on function public.can_view_story(uuid, uuid) from public, anon;
grant execute on function public.can_view_story(uuid, uuid) to authenticated;
grant execute on function public.get_story_rail() to authenticated;
grant execute on function public.get_author_stories(uuid) to authenticated;
grant execute on function public.mark_story_viewed(uuid) to authenticated;
grant execute on function public.get_story_viewers(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.delete_story(uuid) to authenticated;
grant execute on function public.add_close_friend(uuid) to authenticated;
grant execute on function public.remove_close_friend(uuid) to authenticated;
grant execute on function public.get_close_friends(text, uuid) to authenticated;
grant execute on function public.get_close_friend_candidates(text, uuid) to authenticated;
