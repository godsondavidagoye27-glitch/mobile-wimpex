create table public.story_highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 40),
  audience text not null default 'everyone'
    check (audience in ('everyone', 'followers', 'close_friends')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index story_highlights_owner_order_idx
  on public.story_highlights (owner_id, sort_order, created_at);

create table public.story_highlight_items (
  id uuid primary key,
  highlight_id uuid not null references public.story_highlights (id) on delete cascade,
  source_story_id uuid not null,
  media_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  source_audience text not null check (source_audience in ('everyone', 'followers', 'close_friends')),
  caption text,
  duration_ms integer not null check (duration_ms between 1 and 15000),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  source_created_at timestamptz not null,
  added_at timestamptz not null default now(),
  unique (highlight_id, source_story_id)
);

create index story_highlight_items_order_idx
  on public.story_highlight_items (highlight_id, added_at, id);

alter table public.story_highlights enable row level security;
alter table public.story_highlight_items enable row level security;
revoke all on public.story_highlights, public.story_highlight_items from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'highlights',
  'highlights',
  false,
  52428800,
  array['image/jpeg', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_story_highlight(p_highlight_id uuid, p_viewer_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  highlight public.story_highlights%rowtype;
  profile_is_private boolean;
  is_follower boolean;
begin
  if p_viewer_id is null or auth.uid() is distinct from p_viewer_id then
    return false;
  end if;

  select * into highlight
  from public.story_highlights
  where id = p_highlight_id;
  if not found then return false; end if;
  if highlight.owner_id = p_viewer_id then return true; end if;
  if public.profile_blocked_pair(highlight.owner_id, p_viewer_id) then return false; end if;

  select profile.is_private into profile_is_private
  from public.profiles profile
  where profile.id = highlight.owner_id;
  if profile_is_private is null then return false; end if;

  select exists (
    select 1 from public.follows follow
    where follow.follower_id = p_viewer_id
      and follow.following_id = highlight.owner_id
      and follow.status = 'accepted'
  ) into is_follower;

  if profile_is_private and not is_follower then return false; end if;
  if highlight.audience = 'everyone' then return true; end if;
  if highlight.audience = 'followers' then return is_follower; end if;

  return exists (
    select 1 from public.close_friends friend
    where friend.owner_id = highlight.owner_id
      and friend.friend_id = p_viewer_id
  );
end;
$$;
revoke all on function public.can_view_story_highlight(uuid, uuid) from public, anon;
grant execute on function public.can_view_story_highlight(uuid, uuid) to authenticated;

create function public.can_view_story_highlight_item(p_item_id uuid, p_viewer_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  item_audience text;
  highlight_owner uuid;
  highlight_key uuid;
begin
  if p_viewer_id is null or auth.uid() is distinct from p_viewer_id then
    return false;
  end if;

  select item.source_audience, highlight.owner_id, item.highlight_id
  into item_audience, highlight_owner, highlight_key
  from public.story_highlight_items item
  join public.story_highlights highlight on highlight.id = item.highlight_id
  where item.id = p_item_id;
  if not found or not public.can_view_story_highlight(highlight_key, p_viewer_id) then
    return false;
  end if;
  if highlight_owner = p_viewer_id or item_audience = 'everyone' then
    return true;
  end if;

  if item_audience = 'followers' then
    return exists (
      select 1 from public.follows follow
      where follow.follower_id = p_viewer_id
        and follow.following_id = highlight_owner
        and follow.status = 'accepted'
    );
  end if;

  return exists (
    select 1 from public.close_friends friend
    where friend.owner_id = highlight_owner
      and friend.friend_id = p_viewer_id
  );
end;
$$;
revoke all on function public.can_view_story_highlight_item(uuid, uuid) from public, anon;
grant execute on function public.can_view_story_highlight_item(uuid, uuid) to authenticated;

create function public.get_profile_story_highlights(p_owner_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  title text,
  audience text,
  sort_order integer,
  item_count bigint,
  cover_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select highlight.id,
         highlight.owner_id,
         highlight.title,
         highlight.audience,
         highlight.sort_order,
         count(item.id) filter (
           where public.can_view_story_highlight_item(item.id, auth.uid())
         )::bigint,
         (array_agg(item.media_path order by item.added_at, item.id)
           filter (
             where item.id is not null
               and public.can_view_story_highlight_item(item.id, auth.uid())
           ))[1],
         highlight.created_at
  from public.story_highlights highlight
  left join public.story_highlight_items item on item.highlight_id = highlight.id
  where auth.uid() is not null
    and p_owner_id is not null
    and highlight.owner_id = p_owner_id
    and public.can_view_story_highlight(highlight.id, auth.uid())
  group by highlight.id
  having highlight.owner_id = auth.uid()
    or count(item.id) filter (
      where public.can_view_story_highlight_item(item.id, auth.uid())
    ) > 0
  order by highlight.sort_order, highlight.created_at, highlight.id;
$$;
revoke all on function public.get_profile_story_highlights(uuid) from public, anon;
grant execute on function public.get_profile_story_highlights(uuid) to authenticated;

create function public.get_story_highlight_items(p_highlight_id uuid)
returns table (
  id uuid,
  media_path text,
  kind text,
  caption text,
  duration_ms integer,
  width integer,
  height integer,
  source_created_at timestamptz,
  added_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select item.id, item.media_path, item.kind, item.caption, item.duration_ms,
         item.width, item.height, item.source_created_at, item.added_at
  from public.story_highlight_items item
  where item.highlight_id = p_highlight_id
    and public.can_view_story_highlight_item(item.id, auth.uid())
  order by item.added_at, item.id;
$$;
revoke all on function public.get_story_highlight_items(uuid) from public, anon;
grant execute on function public.get_story_highlight_items(uuid) to authenticated;

create function public.create_story_highlight(p_title text, p_audience text default 'everyone')
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  new_id uuid;
begin
  if viewer_id is null then raise exception 'Sign in to create a highlight.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 40 then
    raise exception 'Highlight names must be between 1 and 40 characters.';
  end if;
  if p_audience not in ('everyone', 'followers', 'close_friends') then
    raise exception 'Choose a valid highlight audience.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(viewer_id::text, 2810));
  if (select count(*) from public.story_highlights where owner_id = viewer_id) >= 20 then
    raise exception 'You can create up to 20 highlights.';
  end if;

  insert into public.story_highlights (owner_id, title, audience, sort_order)
  select viewer_id, btrim(p_title), p_audience, coalesce(max(sort_order) + 1, 0)
  from public.story_highlights
  where owner_id = viewer_id
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.create_story_highlight(text, text) from public, anon;
grant execute on function public.create_story_highlight(text, text) to authenticated;

create function public.rename_story_highlight(p_highlight_id uuid, p_title text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to rename a highlight.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 40 then
    raise exception 'Highlight names must be between 1 and 40 characters.';
  end if;
  update public.story_highlights
  set title = btrim(p_title), updated_at = now()
  where id = p_highlight_id and owner_id = auth.uid();
  if not found then raise exception 'This highlight is unavailable.'; end if;
end;
$$;
revoke all on function public.rename_story_highlight(uuid, text) from public, anon;
grant execute on function public.rename_story_highlight(uuid, text) to authenticated;

create function public.reorder_story_highlight(p_highlight_id uuid, p_new_order integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  highlight_count integer;
  current_order integer;
begin
  if viewer_id is null then raise exception 'Sign in to reorder highlights.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer_id::text, 2810));
  select sort_order into current_order
  from public.story_highlights
  where id = p_highlight_id and owner_id = viewer_id
  for update;
  if not found then raise exception 'This highlight is unavailable.'; end if;

  select count(*) into highlight_count
  from public.story_highlights where owner_id = viewer_id;
  if p_new_order < 0 or p_new_order >= highlight_count then
    raise exception 'Choose a valid highlight position.';
  end if;

  with ordered as (
    select id,
      row_number() over (
        order by
          case
            when id = p_highlight_id then p_new_order
            when current_order < p_new_order
              and sort_order > current_order and sort_order <= p_new_order then sort_order - 1
            when current_order > p_new_order
              and sort_order >= p_new_order and sort_order < current_order then sort_order + 1
            else sort_order
          end,
          created_at,
          id
      ) - 1 as new_order
    from public.story_highlights
    where owner_id = viewer_id
  )
  update public.story_highlights highlight
  set sort_order = ordered.new_order::integer,
      updated_at = now()
  from ordered
  where highlight.id = ordered.id;
end;
$$;
revoke all on function public.reorder_story_highlight(uuid, integer) from public, anon;
grant execute on function public.reorder_story_highlight(uuid, integer) to authenticated;

create function public.add_story_to_highlight(p_highlight_id uuid, p_story_id uuid, p_item_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  selected_highlight public.story_highlights%rowtype;
  source_story public.stories%rowtype;
  item_count integer;
  suffix text;
  copied_path text;
begin
  if viewer_id is null then raise exception 'Sign in to add a story to a highlight.'; end if;
  select * into selected_highlight
  from public.story_highlights
  where id = p_highlight_id and owner_id = viewer_id
  for update;
  if not found then raise exception 'This highlight is unavailable.'; end if;

  select * into source_story
  from public.stories story
  where story.id = p_story_id
    and story.author_id = viewer_id
    and story.deleted_at is null
    and story.expires_at > now();
  if not found then raise exception 'Only your active stories can be added to a highlight.'; end if;

  select count(*) into item_count from public.story_highlight_items
  where highlight_id = p_highlight_id;
  if item_count >= 100 then raise exception 'A highlight can contain up to 100 stories.'; end if;

  suffix := split_part(source_story.media_path, '.', 2);
  if suffix not in ('jpg', 'mp4', 'mov') then
    raise exception 'This story media type cannot be added to a highlight.';
  end if;
  copied_path := viewer_id::text || '/' || p_highlight_id::text || '/' || p_item_id::text || '.' || suffix;
  if not exists (
    select 1 from storage.objects stored_object
    where stored_object.bucket_id = 'highlights' and stored_object.name = copied_path
  ) then
    raise exception 'Upload the copied story media before adding it to the highlight.';
  end if;

  insert into public.story_highlight_items (
    id, highlight_id, source_story_id, media_path, kind, source_audience, caption,
    duration_ms, width, height, source_created_at
  ) values (
    p_item_id, p_highlight_id, p_story_id, copied_path, source_story.kind,
    source_story.audience, source_story.caption,
    source_story.duration_ms, source_story.width, source_story.height, source_story.created_at
  );
  return copied_path;
end;
$$;
revoke all on function public.add_story_to_highlight(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_story_to_highlight(uuid, uuid, uuid) to authenticated;

create function public.delete_story_highlight(p_highlight_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to delete a highlight.'; end if;
  delete from public.story_highlights
  where id = p_highlight_id and owner_id = auth.uid();
  if not found then raise exception 'This highlight is unavailable.'; end if;
end;
$$;
revoke all on function public.delete_story_highlight(uuid) from public, anon;
grant execute on function public.delete_story_highlight(uuid) to authenticated;

drop policy if exists "Highlight media upload to own folder" on storage.objects;
create policy "Highlight media upload to own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'highlights'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) = 2
);

drop policy if exists "Highlight media read when highlight is visible" on storage.objects;
create policy "Highlight media read when highlight is visible"
on storage.objects for select to authenticated
using (
  bucket_id = 'highlights'
  and exists (
    select 1
    from public.story_highlight_items item
    where item.media_path = storage.objects.name
      and public.can_view_story_highlight(item.highlight_id, auth.uid())
      and public.can_view_story_highlight_item(item.id, auth.uid())
  )
);

drop policy if exists "Highlight media delete own folder" on storage.objects;
create policy "Highlight media delete own folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'highlights'
  and (storage.foldername(name))[1] = auth.uid()::text
);
