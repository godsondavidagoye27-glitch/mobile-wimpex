create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  media_path text,
  media_kind text check (media_kind in ('image', 'video')),
  pinned_at timestamptz,
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or media_path is not null),
  check ((media_path is null) = (media_kind is null)),
  check ((removed_at is null) = (removed_by is null))
);

create index community_posts_feed_idx
  on public.community_posts (community_id, pinned_at desc nulls last, created_at desc, id desc)
  where removed_at is null;
create unique index community_posts_one_pin_per_community_idx
  on public.community_posts (community_id)
  where pinned_at is not null and removed_at is null;

create table public.community_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual_content', 'violence', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_by is not null and resolved_at is not null))
);

create unique index community_post_reports_one_open_per_reporter_idx
  on public.community_post_reports (post_id, reporter_id)
  where status = 'open';
create index community_post_reports_open_idx
  on public.community_post_reports (created_at, id)
  where status = 'open';

create table public.community_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index community_messages_feed_idx
  on public.community_messages (community_id, created_at desc, id desc);

alter table public.community_posts enable row level security;
alter table public.community_post_reports enable row level security;
alter table public.community_messages enable row level security;

revoke all on public.community_posts, public.community_post_reports, public.community_messages
  from public, anon, authenticated;
grant select on public.community_posts, public.community_messages to authenticated;

create function public.community_content_visible(
  p_community_id uuid,
  p_author_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() is not null
    and public.can_view_community(p_community_id, auth.uid())
    and not exists (
      select 1 from public.communities community
      where community.id = p_community_id
        and public.profile_blocked_pair(community.owner_id, auth.uid())
    )
    and (
      p_author_id is null
      or not public.profile_blocked_pair(p_author_id, auth.uid())
    );
$$;
revoke all on function public.community_content_visible(uuid, uuid) from public, anon;
grant execute on function public.community_content_visible(uuid, uuid) to authenticated;

create policy "Visible community members can read posts"
on public.community_posts for select to authenticated
using (
  removed_at is null
  and public.community_content_visible(community_id, author_id)
);

create policy "Active community members can read chat"
on public.community_messages for select to authenticated
using (
  exists (
    select 1
    from public.community_members member
    where member.community_id = community_messages.community_id
      and member.user_id = auth.uid()
      and member.status = 'active'
  )
  and public.community_content_visible(community_id, author_id)
);

create policy "Managers can read reports"
on public.community_post_reports for select to authenticated
using (
  exists (
    select 1
    from public.community_posts post
    where post.id = post_id
      and public.community_is_manager(post.community_id, auth.uid())
  )
);

create function public.update_community_post_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_community uuid;
  delta integer := 0;
begin
  if tg_op = 'DELETE' then
    target_community := old.community_id;
  else
    target_community := new.community_id;
  end if;
  if tg_op = 'INSERT' and new.removed_at is null then
    delta := 1;
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    delta := -1;
  elsif tg_op = 'UPDATE' and old.removed_at is not null and new.removed_at is null then
    delta := 1;
  elsif tg_op = 'DELETE' and old.removed_at is null then
    delta := -1;
  end if;
  if delta <> 0 then
    update public.communities
    set post_count = greatest(0, post_count + delta)
    where id = target_community;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger community_posts_update_count
after insert or update of removed_at or delete on public.community_posts
for each row execute function public.update_community_post_count();

create function public.create_community_post(
  p_community_id uuid,
  p_body text,
  p_media_path text default null,
  p_media_kind text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  created_id uuid := gen_random_uuid();
  media_extension text;
begin
  if viewer_id is null then raise exception 'Sign in to post.'; end if;
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id
      and user_id = viewer_id
      and status = 'active'
  ) or not public.can_view_community(p_community_id, viewer_id) then
    raise exception 'Join this community before posting.';
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'Community posts must be 2000 characters or fewer.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 and p_media_path is null then
    raise exception 'Add text or media before posting.';
  end if;
  if (p_media_path is null) <> (p_media_kind is null)
    or p_media_kind not in ('image', 'video') and p_media_kind is not null then
    raise exception 'Choose a valid image or video attachment.';
  end if;
  if p_media_path is not null then
    if p_media_path !~ (
      '^' || p_community_id::text || '/' || created_id::text || '\.(jpg|jpeg|png|webp|mp4|mov)$'
    ) then
      raise exception 'Community media must use the community and post identifiers.';
    end if;
    media_extension := lower(split_part(p_media_path, '.', 2));
    if (p_media_kind = 'image' and media_extension not in ('jpg', 'jpeg', 'png', 'webp'))
      or (p_media_kind = 'video' and media_extension not in ('mp4', 'mov')) then
      raise exception 'The media file type does not match the attachment.';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'community-posts' and name = p_media_path
    ) then
      raise exception 'Upload the community media before posting.';
    end if;
  end if;

  insert into public.community_posts (id, community_id, author_id, body, media_path, media_kind)
  values (created_id, p_community_id, viewer_id, btrim(coalesce(p_body, '')), p_media_path, p_media_kind);
  return created_id;
end;
$$;

create function public.get_community_posts(
  p_community_id uuid,
  p_page_size integer default 30
)
returns table (
  id uuid,
  community_id uuid,
  author_id uuid,
  username text,
  display_name text,
  avatar_url text,
  body text,
  media_path text,
  media_kind text,
  pinned_at timestamptz,
  created_at timestamptz,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view community posts.'; end if;
  if not public.can_view_community(p_community_id, auth.uid()) then
    raise exception 'You cannot view this community.';
  end if;
  if coalesce(p_page_size, 30) not between 1 and 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;
  return query
  select post.id, post.community_id, post.author_id,
    profile.username, profile.display_name, profile.avatar_url,
    post.body, post.media_path, post.media_kind, post.pinned_at, post.created_at,
    post.author_id = auth.uid()
  from public.community_posts post
  join public.profiles profile on profile.id = post.author_id
  where post.community_id = p_community_id
    and post.removed_at is null
    and public.community_content_visible(post.community_id, post.author_id)
  order by post.pinned_at desc nulls last, post.created_at desc, post.id desc
  limit coalesce(p_page_size, 30);
end;
$$;

create function public.moderate_community_post(p_post_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target public.community_posts%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to moderate posts.'; end if;
  select * into target from public.community_posts where id = p_post_id for update;
  if not found then raise exception 'Community post not found.'; end if;
  if not public.community_is_manager(target.community_id, auth.uid()) then
    raise exception 'Only community managers can moderate posts.';
  end if;
  if target.removed_at is not null then raise exception 'This post has already been removed.'; end if;

  if p_action = 'remove' then
    update public.community_posts
    set removed_at = clock_timestamp(), removed_by = auth.uid(), pinned_at = null
    where id = p_post_id;
  elsif p_action = 'pin' then
    update public.community_posts
    set pinned_at = null
    where community_id = target.community_id
      and pinned_at is not null and id <> p_post_id;
    update public.community_posts
    set pinned_at = case when pinned_at is null then clock_timestamp() else null end
    where id = p_post_id;
  else
    raise exception 'Choose remove or pin.';
  end if;
end;
$$;

create function public.report_community_post(
  p_post_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  report_id uuid;
  target public.community_posts%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to report a post.'; end if;
  select * into target from public.community_posts
  where id = p_post_id and removed_at is null;
  if not found or not public.community_content_visible(target.community_id, target.author_id) then
    raise exception 'This post cannot be reported.';
  end if;
  if target.author_id = auth.uid() then raise exception 'You cannot report your own post.'; end if;
  if p_reason not in ('spam', 'harassment', 'hate', 'sexual_content', 'violence', 'other') then
    raise exception 'Choose a valid report reason.';
  end if;
  if char_length(coalesce(p_details, '')) > 500 then
    raise exception 'Report details must be 500 characters or fewer.';
  end if;
  insert into public.community_post_reports (post_id, reporter_id, reason, details)
  values (p_post_id, auth.uid(), p_reason, btrim(coalesce(p_details, '')))
  on conflict (post_id, reporter_id) where status = 'open' do nothing
  returning id into report_id;
  if report_id is null then
    select id into report_id from public.community_post_reports
    where post_id = p_post_id and reporter_id = auth.uid() and status = 'open';
  end if;
  return report_id;
end;
$$;

create function public.get_community_post_reports(p_community_id uuid, p_page_size integer default 50)
returns table (
  id uuid,
  post_id uuid,
  post_body text,
  reporter_id uuid,
  reporter_username text,
  reason text,
  details text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not public.community_is_manager(p_community_id, auth.uid()) then
    raise exception 'Only community managers can view reports.';
  end if;
  if coalesce(p_page_size, 50) not between 1 and 100 then
    raise exception 'Page size must be between 1 and 100.';
  end if;
  return query
  select report.id, post.id, post.body, report.reporter_id, profile.username,
    report.reason, report.details, report.created_at
  from public.community_post_reports report
  join public.community_posts post on post.id = report.post_id
  join public.profiles profile on profile.id = report.reporter_id
  where post.community_id = p_community_id and report.status = 'open'
  order by report.created_at, report.id
  limit coalesce(p_page_size, 50);
end;
$$;

create function public.resolve_community_post_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_community uuid;
begin
  select post.community_id into target_community
  from public.community_post_reports report
  join public.community_posts post on post.id = report.post_id
  where report.id = p_report_id and report.status = 'open';
  if target_community is null or not public.community_is_manager(target_community, auth.uid()) then
    raise exception 'Only community managers can resolve this report.';
  end if;
  update public.community_post_reports
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp()
  where id = p_report_id and status = 'open';
end;
$$;

create function public.send_community_message(p_community_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  message_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to chat.'; end if;
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid() and status = 'active'
  ) or not public.can_view_community(p_community_id, auth.uid()) then
    raise exception 'Active community membership is required to chat.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Community messages must contain 1 to 1000 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_community_id::text, 918));
  if (
    select count(*) from public.community_messages
    where author_id = auth.uid()
      and community_id = p_community_id
      and created_at > clock_timestamp() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into public.community_messages (community_id, author_id, body)
  values (p_community_id, auth.uid(), btrim(p_body))
  returning id into message_id;
  return message_id;
end;
$$;

create function public.get_community_messages(p_community_id uuid, p_page_size integer default 50)
returns table (
  id uuid,
  community_id uuid,
  author_id uuid,
  username text,
  display_name text,
  body text,
  created_at timestamptz,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to read community chat.'; end if;
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid() and status = 'active'
  ) or not public.can_view_community(p_community_id, auth.uid()) then
    raise exception 'Active community membership is required to read chat.';
  end if;
  if coalesce(p_page_size, 50) not between 1 and 100 then
    raise exception 'Page size must be between 1 and 100.';
  end if;
  return query
  select message.id, message.community_id, message.author_id,
    profile.username, profile.display_name, message.body, message.created_at,
    message.author_id = auth.uid()
  from public.community_messages message
  join public.profiles profile on profile.id = message.author_id
  where message.community_id = p_community_id
    and public.community_content_visible(message.community_id, message.author_id)
  order by message.created_at desc, message.id desc
  limit coalesce(p_page_size, 50);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-posts',
  'community-posts',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Active members upload community post media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-posts'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov)$'
  and exists (
    select 1
    from public.community_members member
    where member.community_id::text = (storage.foldername(name))[1]
      and member.user_id = auth.uid()
      and member.status = 'active'
  )
);

create policy "Visible community post media can be read"
on storage.objects for select to authenticated
using (
  bucket_id = 'community-posts'
  and exists (
    select 1 from public.community_posts post
    where post.media_path = name
      and post.removed_at is null
      and public.community_content_visible(post.community_id, post.author_id)
  )
);

create policy "Authors and managers delete community post media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'community-posts'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1
      from public.community_posts post
      where post.media_path = name
        and (
          post.author_id = auth.uid()
          or public.community_is_manager(post.community_id, auth.uid())
        )
      )
    )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_posts'
  ) then
    alter publication supabase_realtime add table public.community_posts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'community_messages'
  ) then
    alter publication supabase_realtime add table public.community_messages;
  end if;
end;
$$;

revoke all on function public.create_community_post(uuid, text, text, text) from public, anon;
revoke all on function public.get_community_posts(uuid, integer) from public, anon;
revoke all on function public.moderate_community_post(uuid, text) from public, anon;
revoke all on function public.report_community_post(uuid, text, text) from public, anon;
revoke all on function public.get_community_post_reports(uuid, integer) from public, anon;
revoke all on function public.resolve_community_post_report(uuid) from public, anon;
revoke all on function public.send_community_message(uuid, text) from public, anon;
revoke all on function public.get_community_messages(uuid, integer) from public, anon;
grant execute on function public.create_community_post(uuid, text, text, text) to authenticated;
grant execute on function public.get_community_posts(uuid, integer) to authenticated;
grant execute on function public.moderate_community_post(uuid, text) to authenticated;
grant execute on function public.report_community_post(uuid, text, text) to authenticated;
grant execute on function public.get_community_post_reports(uuid, integer) to authenticated;
grant execute on function public.resolve_community_post_report(uuid) to authenticated;
grant execute on function public.send_community_message(uuid, text) to authenticated;
grant execute on function public.get_community_messages(uuid, integer) to authenticated;
