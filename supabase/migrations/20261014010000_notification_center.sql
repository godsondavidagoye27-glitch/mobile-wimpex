create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'like', 'comment', 'reply', 'follow', 'follow_request', 'live'
  )),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id <> actor_id),
  unique nulls not distinct (user_id, actor_id, type, post_id, comment_id)
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_unread_user_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "Users read their own notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid());

create policy "Users mark their own notifications as read"
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and read_at is not null);

create function public.create_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_post_id uuid default null,
  p_comment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  should_notify boolean;
begin
  if p_user_id is null or p_actor_id is null or p_user_id = p_actor_id then
    return;
  end if;

  select case
    when p_type = 'like' then settings.notify_likes
    when p_type in ('comment', 'reply') then settings.notify_comments
    when p_type in ('follow', 'follow_request') then settings.notify_followers
    when p_type = 'live' then settings.notify_live
    else false
  end
  into should_notify
  from public.user_settings settings
  where settings.user_id = p_user_id;

  if not coalesce(should_notify, true) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (p_user_id, p_actor_id, p_type, p_post_id, p_comment_id)
  on conflict do nothing;
end;
$$;

create function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  post_author_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.notifications
    where user_id = (select author_id from public.posts where id = old.post_id)
      and actor_id = old.user_id
      and type = 'like'
      and post_id = old.post_id;
    return old;
  end if;

  select author_id into post_author_id
  from public.posts
  where id = new.post_id;

  perform public.create_notification(post_author_id, new.user_id, 'like', new.post_id);
  return new;
end;
$$;

create trigger post_likes_notify
after insert or delete on public.post_likes
for each row execute function public.notify_post_like();

create function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  recipient_id uuid;
  notification_type text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  if new.parent_id is null then
    select author_id into recipient_id from public.posts where id = new.post_id;
    notification_type := 'comment';
  else
    select author_id into recipient_id from public.comments where id = new.parent_id;
    notification_type := 'reply';
  end if;

  perform public.create_notification(
    recipient_id,
    new.author_id,
    notification_type,
    new.post_id,
    new.id
  );
  return new;
end;
$$;

create trigger comments_notify
after insert on public.comments
for each row execute function public.notify_comment();

create function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.create_notification(
      new.following_id,
      new.follower_id,
      'follow_request'
    );
  elsif tg_op = 'INSERT' and new.status = 'accepted' then
    perform public.create_notification(
      new.following_id,
      new.follower_id,
      'follow'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public.create_notification(
      new.follower_id,
      new.following_id,
      'follow'
    );
  end if;
  return new;
end;
$$;

create trigger follows_notify
after insert or update of status on public.follows
for each row execute function public.notify_follow();

revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.notify_post_like() from public, anon, authenticated;
revoke all on function public.notify_comment() from public, anon, authenticated;
revoke all on function public.notify_follow() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
