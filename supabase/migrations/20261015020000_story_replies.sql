begin;

alter table public.messages
  add column story_reply_story_id uuid references public.stories (id) on delete set null,
  add column story_reply_preview_path text,
  add column story_reply_caption text;

alter table public.messages
  add constraint messages_story_reply_preview_path
  check (
    story_reply_preview_path is null
    or story_reply_preview_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(_thumb\.jpg|\.(jpg|mp4|mov))$'
  ),
  add constraint messages_story_reply_caption
  check (story_reply_caption is null or char_length(story_reply_caption) <= 120);

create function public.can_reply_to_story(p_story_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  story_author_id uuid;
  reply_policy text;
  author_dm_policy text;
begin
  if auth.uid() is null then return false; end if;

  select s.author_id, coalesce(settings.story_replies, 'everyone'), profile.dm_policy
  into story_author_id, reply_policy, author_dm_policy
  from public.stories s
  join public.profiles profile on profile.id = s.author_id
  left join public.user_settings settings on settings.user_id = s.author_id
  where s.id = p_story_id
    and s.deleted_at is null
    and s.expires_at > now();

  if story_author_id is null
    or story_author_id = auth.uid()
    or not public.can_view_story(p_story_id, auth.uid())
    or public.story_blocked_pair(auth.uid(), story_author_id)
    or reply_policy = 'off'
    or author_dm_policy = 'none'
  then
    return false;
  end if;

  if reply_policy = 'followers' and not exists (
    select 1 from public.follows f
    where f.follower_id = auth.uid()
      and f.following_id = story_author_id
      and f.status = 'accepted'
  ) then
    return false;
  end if;

  if (
    author_dm_policy = 'friends'
    or public.chat_user_is_minor(auth.uid())
    or public.chat_user_is_minor(story_author_id)
  ) and not public.chat_are_mutual_friends(auth.uid(), story_author_id) then
    return false;
  end if;

  return true;
end;
$$;

create function public.send_story_reply(p_story_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  story public.stories%rowtype;
  conversation_id uuid;
  preview_path text;
begin
  if auth.uid() is null then raise exception 'Sign in to reply to a story.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Story replies must contain 1 to 2000 characters.';
  end if;

  select * into story
  from public.stories
  where id = p_story_id
    and deleted_at is null
    and expires_at > now();
  if not found or not public.can_reply_to_story(p_story_id) then
    raise exception 'You cannot reply to this story.';
  end if;

  conversation_id := public.start_direct_conversation(story.author_id);
  preview_path := coalesce(story.thumb_path, story.media_path);

  insert into public.messages (
    conversation_id,
    sender_id,
    client_id,
    kind,
    body,
    story_reply_story_id,
    story_reply_preview_path,
    story_reply_caption
  )
  values (
    conversation_id,
    auth.uid(),
    gen_random_uuid(),
    'text',
    btrim(p_body),
    story.id,
    preview_path,
    story.caption
  );

  return conversation_id;
end;
$$;

create function public.story_reply_media_is_referenced(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() is not null
    and split_part(coalesce(p_path, ''), '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.messages m
      where m.story_reply_preview_path = p_path
        and m.deleted_at is null
    );
$$;

drop policy if exists "Story replies can read referenced story media" on storage.objects;
create policy "Story replies can read referenced story media"
on storage.objects for select to authenticated
using (
  bucket_id = 'stories'
  and exists (
    select 1
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where m.story_reply_preview_path = name
      and m.deleted_at is null
  )
);

revoke all on function public.can_reply_to_story(uuid) from public, anon;
revoke all on function public.send_story_reply(uuid, text) from public, anon;
revoke all on function public.story_reply_media_is_referenced(text) from public, anon;
grant execute on function public.can_reply_to_story(uuid) to authenticated;
grant execute on function public.send_story_reply(uuid, text) to authenticated;
grant execute on function public.story_reply_media_is_referenced(text) to authenticated;

commit;
