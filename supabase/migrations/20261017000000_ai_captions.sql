alter table public.posts
  add column captions_status text not null default 'none'
    check (captions_status in ('none', 'queued', 'processing', 'ready', 'failed', 'no_speech', 'disabled')),
  add column captions_language text,
  add column captions_updated_at timestamptz,
  add column captions_attempts integer not null default 0
    check (captions_attempts between 0 and 3);

update public.posts
set captions_status = case
      when auto_captions and video_path is not null and status = 'published' then 'queued'
      when not auto_captions then 'disabled'
      else 'none'
    end,
    captions_updated_at = case
      when auto_captions and video_path is not null and status = 'published' then now()
      else captions_updated_at
    end;

revoke insert (captions_path) on public.posts from authenticated;
revoke update (captions_path, captions_status, captions_language, captions_updated_at, captions_attempts)
  on public.posts from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captions', 'captions', false, 204800, array['text/vtt'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Visible post captions can be read"
on storage.objects for select to authenticated
using (
  bucket_id = 'captions'
  and exists (
    select 1
    from public.posts p
    where p.captions_path = storage.objects.name
      and p.captions_status = 'ready'
      and public.can_view_post(p.id, auth.uid())
  )
);

create table public.caption_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts (id) on delete cascade,
  provider text not null,
  provider_job_id text,
  status text not null check (status in ('queued', 'processing', 'ready', 'failed', 'no_speech', 'disabled')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.caption_jobs enable row level security;
revoke all on public.caption_jobs from public, anon, authenticated;
grant all on public.caption_jobs to service_role;

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  feature text not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day, feature)
);

create table public.ai_global_usage (
  day date not null,
  feature text not null,
  count integer not null default 0 check (count >= 0),
  primary key (day, feature)
);

create table public.ai_minute_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null,
  feature text not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, minute, feature)
);

create table public.ai_global_minute_usage (
  minute timestamptz not null,
  feature text not null,
  count integer not null default 0 check (count >= 0),
  primary key (minute, feature)
);

create table public.ai_circuit (
  feature text primary key,
  open_until timestamptz not null,
  reason text not null
);

alter table public.ai_usage enable row level security;
alter table public.ai_global_usage enable row level security;
alter table public.ai_minute_usage enable row level security;
alter table public.ai_global_minute_usage enable row level security;
alter table public.ai_circuit enable row level security;

revoke all on public.ai_usage, public.ai_global_usage, public.ai_minute_usage,
  public.ai_global_minute_usage, public.ai_circuit
  from public, anon, authenticated;
grant all on public.ai_usage, public.ai_global_usage, public.ai_minute_usage,
  public.ai_global_minute_usage, public.ai_circuit
  to service_role;

create function public.ai_consume(
  p_user_id uuid,
  p_feature text,
  p_user_daily_cap integer,
  p_user_minute_cap integer,
  p_global_daily_cap integer,
  p_global_minute_cap integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_day date := current_date;
  current_minute timestamptz := date_trunc('minute', clock_timestamp());
begin
  if p_user_id is null or p_feature is null or btrim(p_feature) = ''
    or p_user_daily_cap < 1 or p_user_minute_cap < 1
    or p_global_daily_cap < 1 or p_global_minute_cap < 1
  then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_consume:' || p_feature, 0));

  if exists (
    select 1 from public.ai_circuit
    where feature = p_feature and open_until > clock_timestamp()
  ) then
    return false;
  end if;

  if coalesce((
    select count from public.ai_usage
    where user_id = p_user_id and day = current_day and feature = p_feature
  ), 0) >= p_user_daily_cap
    or coalesce((
      select count from public.ai_minute_usage
      where user_id = p_user_id and minute = current_minute and feature = p_feature
    ), 0) >= p_user_minute_cap
    or coalesce((
      select count from public.ai_global_usage
      where day = current_day and feature = p_feature
    ), 0) >= p_global_daily_cap
    or coalesce((
      select count from public.ai_global_minute_usage
      where minute = current_minute and feature = p_feature
    ), 0) >= p_global_minute_cap
  then
    return false;
  end if;

  insert into public.ai_usage (user_id, day, feature, count)
  values (p_user_id, current_day, p_feature, 1)
  on conflict (user_id, day, feature) do update set count = ai_usage.count + 1;

  insert into public.ai_minute_usage (user_id, minute, feature, count)
  values (p_user_id, current_minute, p_feature, 1)
  on conflict (user_id, minute, feature) do update set count = ai_minute_usage.count + 1;

  insert into public.ai_global_usage (day, feature, count)
  values (current_day, p_feature, 1)
  on conflict (day, feature) do update set count = ai_global_usage.count + 1;

  insert into public.ai_global_minute_usage (minute, feature, count)
  values (current_minute, p_feature, 1)
  on conflict (minute, feature) do update set count = ai_global_minute_usage.count + 1;

  return true;
end;
$$;

revoke all on function public.ai_consume(uuid, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_consume(uuid, text, integer, integer, integer, integer)
  to service_role;

create table public.caption_request_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null,
  primary key (user_id, minute)
);
alter table public.caption_request_limits enable row level security;
revoke all on public.caption_request_limits from public, anon, authenticated;
grant insert on public.caption_request_limits to authenticated;
create policy "Users can record their own caption request limit"
on public.caption_request_limits for insert to authenticated
with check (user_id = auth.uid());

create function public.queue_post_captions(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  post_author_id uuid;
  post_auto_captions boolean;
  post_status text;
  post_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request captions.';
  end if;

  select author_id, auto_captions, captions_status, captions_attempts
  into post_author_id, post_auto_captions, post_status, post_attempts
  from public.posts
  where id = p_post_id
  for update;

  if not found or post_author_id <> auth.uid() then
    raise exception 'You can only request captions for your own video.';
  end if;
  if not post_auto_captions then
    raise exception 'Turn captions on before requesting them.';
  end if;
  if post_status not in ('failed', 'no_speech', 'disabled') then
    raise exception 'Captions cannot be requested in the current state.';
  end if;
  if post_attempts >= 3 then
    raise exception 'Captions have reached the retry limit.';
  end if;

  insert into public.caption_request_limits (user_id, minute)
  values (auth.uid(), date_trunc('minute', clock_timestamp()))
  on conflict do nothing;
  if not found then
    raise exception 'Please wait before requesting captions again.';
  end if;

  update public.posts
  set captions_status = 'queued',
      captions_updated_at = clock_timestamp()
  where id = p_post_id;
end;
$$;

revoke all on function public.queue_post_captions(uuid) from public, anon;
grant execute on function public.queue_post_captions(uuid) to authenticated;

create function public.request_captions(post_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  post_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request captions.';
  end if;
  select author_id into post_author_id
  from public.posts
  where id = request_captions.post_id;
  if not found or post_author_id <> auth.uid() then
    raise exception 'You can only request captions for your own video.';
  end if;
  perform public.queue_post_captions(request_captions.post_id);
end;
$$;

create function public.set_post_captions_enabled(post_id uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  post_author_id uuid;
  post_attempts integer;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change caption settings.';
  end if;

  select author_id, captions_attempts into post_author_id, post_attempts
  from public.posts
  where id = set_post_captions_enabled.post_id
  for update;

  if not found or post_author_id <> auth.uid() then
    raise exception 'You can only change captions for your own video.';
  end if;

  if not enabled then
    update public.posts
    set auto_captions = false,
        captions_status = 'disabled',
        captions_updated_at = clock_timestamp()
    where id = set_post_captions_enabled.post_id;
    update public.caption_jobs
    set status = 'disabled',
        last_error = 'captions_disabled',
        updated_at = clock_timestamp()
    where post_id = set_post_captions_enabled.post_id
      and status in ('queued', 'processing');
    return;
  end if;

  next_status := case
    when (select captions_status from public.posts where id = set_post_captions_enabled.post_id) = 'disabled'
      and post_attempts < 3 then 'queued'
    when (select captions_status from public.posts where id = set_post_captions_enabled.post_id) = 'disabled'
      then 'failed'
    else (select captions_status from public.posts where id = set_post_captions_enabled.post_id)
  end;

  update public.posts
  set auto_captions = true,
      captions_status = next_status,
      captions_updated_at = clock_timestamp()
  where id = set_post_captions_enabled.post_id;
end;
$$;

revoke all on function public.request_captions(uuid) from public, anon;
grant execute on function public.request_captions(uuid) to authenticated;
revoke all on function public.set_post_captions_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_post_captions_enabled(uuid, boolean) to authenticated;

create or replace function public.finalize_post(post_id uuid)
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
  post_auto_captions boolean;
begin
  select p.author_id, p.video_path, p.status, p.auto_captions
  into post_author_id, post_video_path, post_status, post_auto_captions
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
  set status = 'published',
      published_at = now(),
      captions_status = case when post_auto_captions then 'queued' else 'disabled' end,
      captions_updated_at = now()
  where id = finalize_post.post_id;
end;
$$;

revoke all on function public.finalize_post(uuid) from public, anon;
grant execute on function public.finalize_post(uuid) to authenticated;
