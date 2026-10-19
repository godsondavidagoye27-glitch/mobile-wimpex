alter table public.posts
  add column scheduled_at timestamptz;

alter table public.posts
  drop constraint if exists posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status in ('uploading', 'scheduled', 'published', 'failed', 'cancelled'));

create index posts_scheduled_due_idx
  on public.posts (scheduled_at, id)
  where status = 'scheduled';
create index posts_author_scheduled_idx
  on public.posts (author_id, scheduled_at)
  where status = 'scheduled';

grant insert (scheduled_at) on public.posts to authenticated;

create function public.validate_scheduled_post_time()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.scheduled_at is not null
    and new.scheduled_at not between now() + interval '10 minutes' and now() + interval '30 days'
  then
    raise exception 'Schedule a post between 10 minutes and 30 days from now.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_scheduled_post_time() from public, anon, authenticated;

create trigger posts_validate_scheduled_time
before insert or update of scheduled_at on public.posts
for each row execute function public.validate_scheduled_post_time();

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
  post_scheduled_at timestamptz;
  post_auto_captions boolean;
begin
  select p.author_id, p.video_path, p.status, p.scheduled_at, p.auto_captions
  into post_author_id, post_video_path, post_status, post_scheduled_at, post_auto_captions
  from public.posts p
  where p.id = finalize_post.post_id
  for update;

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
  if post_status in ('published', 'scheduled') and
    (post_status = 'published' or post_scheduled_at > now())
  then
    return;
  end if;
  if post_status not in ('uploading', 'failed', 'scheduled') then
    raise exception 'This post cannot be published in its current state.';
  end if;

  update public.posts
  set status = case
        when post_scheduled_at is not null and post_scheduled_at > now() then 'scheduled'
        else 'published'
      end,
      published_at = case
        when post_scheduled_at is not null and post_scheduled_at > now() then null
        else now()
      end,
      captions_status = case
        when post_scheduled_at is not null and post_scheduled_at > now() then captions_status
        when post_auto_captions then 'queued'
        else 'disabled'
      end,
      captions_updated_at = case
        when post_scheduled_at is not null and post_scheduled_at > now() then captions_updated_at
        else now()
      end
  where id = finalize_post.post_id;
end;
$$;

revoke all on function public.finalize_post(uuid) from public, anon;
grant execute on function public.finalize_post(uuid) to authenticated;

create function public.reschedule_post(p_post_id uuid, p_scheduled_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to reschedule this post.';
  end if;
  if p_scheduled_at is null
    or p_scheduled_at not between now() + interval '10 minutes' and now() + interval '30 days'
  then
    raise exception 'Schedule a post between 10 minutes and 30 days from now.';
  end if;

  update public.posts
  set scheduled_at = p_scheduled_at
  where id = p_post_id
    and author_id = auth.uid()
    and status = 'scheduled';
  if not found then
    raise exception 'This scheduled post is no longer available.';
  end if;
end;
$$;

revoke all on function public.reschedule_post(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_post(uuid, timestamptz) to authenticated;

create function public.publish_scheduled_post_now(p_post_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to publish this post.';
  end if;

  update public.posts
  set status = 'uploading', scheduled_at = null
  where id = p_post_id
    and author_id = auth.uid()
    and status = 'scheduled';
  if not found then
    raise exception 'This scheduled post is no longer available.';
  end if;

  perform public.finalize_post(p_post_id);
  return p_post_id;
end;
$$;

revoke all on function public.publish_scheduled_post_now(uuid) from public, anon;
grant execute on function public.publish_scheduled_post_now(uuid) to authenticated;

create function public.cancel_scheduled_post(p_post_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  cancelled_video_path text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to cancel this post.';
  end if;

  update public.posts
  set status = 'cancelled', scheduled_at = null
  where id = p_post_id
    and author_id = auth.uid()
    and status = 'scheduled'
  returning video_path into cancelled_video_path;
  if not found then
    raise exception 'This scheduled post is no longer available.';
  end if;
  return cancelled_video_path;
end;
$$;

revoke all on function public.cancel_scheduled_post(uuid) from public, anon;
grant execute on function public.cancel_scheduled_post(uuid) to authenticated;

create function public.publish_due_scheduled_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  post_author_id uuid;
  previous_sub text;
  previous_claims text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the scheduled-post worker may publish due posts.';
  end if;

  select author_id into post_author_id
  from public.posts
  where id = p_post_id
    and status = 'scheduled'
    and scheduled_at <= now()
  for update;
  if not found then
    return false;
  end if;

  previous_sub := current_setting('request.jwt.claim.sub', true);
  previous_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', post_author_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', post_author_id::text, 'role', 'authenticated')::text,
    true
  );
  perform public.finalize_post(p_post_id);
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
  return true;
end;
$$;

revoke all on function public.publish_due_scheduled_post(uuid) from public, anon, authenticated;
grant execute on function public.publish_due_scheduled_post(uuid) to service_role;
