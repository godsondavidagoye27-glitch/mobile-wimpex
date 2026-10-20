begin;

create table public.story_stickers (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null unique references public.stories (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('poll', 'question')),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 120),
  option_one text,
  option_two text,
  position_x numeric(4, 3) not null default 0.500 check (position_x between 0 and 1),
  position_y numeric(4, 3) not null default 0.650 check (position_y between 0 and 1),
  scale numeric(3, 2) not null default 1.00 check (scale between 0.70 and 1.50),
  created_at timestamptz not null default now(),
  check (
    (kind = 'poll'
      and option_one is not null and char_length(btrim(option_one)) between 1 and 40
      and option_two is not null and char_length(btrim(option_two)) between 1 and 40)
    or (kind = 'question' and option_one is null and option_two is null)
  )
);

create table public.story_poll_votes (
  sticker_id uuid not null references public.story_stickers (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  option_number smallint not null check (option_number in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (sticker_id, voter_id)
);

create index story_poll_votes_voter_idx
  on public.story_poll_votes (voter_id, created_at desc);

create table public.story_question_replies (
  id uuid primary key default gen_random_uuid(),
  sticker_id uuid not null references public.story_stickers (id) on delete cascade,
  responder_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  visibility_state text not null default 'visible'
    check (visibility_state in ('visible', 'hidden_word')),
  moderation_status text not null default 'clear'
    check (moderation_status in ('clear', 'hidden')),
  created_at timestamptz not null default now()
);

create index story_question_replies_sticker_created_idx
  on public.story_question_replies (sticker_id, created_at desc, id desc);

alter table public.story_stickers enable row level security;
alter table public.story_poll_votes enable row level security;
alter table public.story_question_replies enable row level security;

revoke all on public.story_stickers, public.story_poll_votes, public.story_question_replies
  from public, anon, authenticated;
grant select on public.story_stickers to authenticated;

create function public.story_sticker_pair_allowed(p_author_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_author_id is not null
    and p_viewer_id is not null
    and not public.story_blocked_pair(p_author_id, p_viewer_id)
    and (
      (not public.chat_user_is_minor(p_author_id) and not public.chat_user_is_minor(p_viewer_id))
      or public.chat_are_mutual_friends(p_author_id, p_viewer_id)
    );
$$;

create policy "Viewers read stickers attached to visible stories"
on public.story_stickers for select to authenticated
using (
  public.can_view_story(story_id, auth.uid())
  and public.story_sticker_pair_allowed(author_id, auth.uid())
);

create function public.create_story_with_sticker(
  p_story_id uuid,
  p_kind text,
  p_media_path text,
  p_caption text,
  p_caption_style jsonb,
  p_audience text,
  p_duration_ms integer,
  p_width integer,
  p_height integer,
  p_sticker_kind text default null,
  p_sticker_prompt text default null,
  p_option_one text default null,
  p_option_two text default null,
  p_position_x numeric default 0.500,
  p_position_y numeric default 0.650,
  p_scale numeric default 1.00
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Sign in before sharing a story.'; end if;
  if p_media_path is null or split_part(p_media_path, '/', 1) <> viewer_id::text then
    raise exception 'Story media must belong to your account.';
  end if;
  if (p_sticker_kind is null) <> (p_sticker_prompt is null) then
    raise exception 'A sticker type and prompt must be provided together.';
  end if;
  if p_sticker_kind is not null and p_sticker_kind not in ('poll', 'question') then
    raise exception 'Choose a poll or question sticker.';
  end if;

  insert into public.stories (
    id, author_id, kind, media_path, caption, caption_style, audience,
    duration_ms, width, height
  )
  values (
    p_story_id, viewer_id, p_kind, p_media_path, nullif(btrim(p_caption), ''),
    p_caption_style, p_audience, p_duration_ms, p_width, p_height
  );

  if p_sticker_kind is not null then
    insert into public.story_stickers (
      story_id, author_id, kind, prompt, option_one, option_two,
      position_x, position_y, scale
    )
    values (
      p_story_id, viewer_id, p_sticker_kind, btrim(p_sticker_prompt),
      nullif(btrim(p_option_one), ''), nullif(btrim(p_option_two), ''),
      p_position_x, p_position_y, p_scale
    );
  end if;

  return p_story_id;
end;
$$;

create function public.get_story_poll_results(p_sticker_id uuid)
returns table (
  option_one_count bigint,
  option_two_count bigint,
  total_votes bigint,
  viewer_option smallint,
  can_view_results boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  sticker public.story_stickers%rowtype;
  viewer_id uuid := auth.uid();
  viewer_option_value smallint;
begin
  if viewer_id is null then raise exception 'Sign in to view poll results.'; end if;
  select * into sticker from public.story_stickers where id = p_sticker_id and kind = 'poll';
  if not found
    or not public.can_view_story(sticker.story_id, viewer_id)
    or not public.story_sticker_pair_allowed(sticker.author_id, viewer_id)
  then
    raise exception 'This poll is no longer available.';
  end if;

  select vote.option_number into viewer_option_value
  from public.story_poll_votes vote
  where vote.sticker_id = p_sticker_id and vote.voter_id = viewer_id;
  if sticker.author_id <> viewer_id and viewer_option_value is null then
    return query select null::bigint, null::bigint, null::bigint, null::smallint, false;
    return;
  end if;

  return query
  select
    count(*) filter (where vote.option_number = 1),
    count(*) filter (where vote.option_number = 2),
    count(*),
    viewer_option_value,
    true
  from public.story_poll_votes vote
  where vote.sticker_id = p_sticker_id
    and not public.story_blocked_pair(sticker.author_id, vote.voter_id);
end;
$$;

create function public.vote_on_story_poll(p_sticker_id uuid, p_option_number smallint)
returns table (
  option_one_count bigint,
  option_two_count bigint,
  total_votes bigint,
  viewer_option smallint,
  can_view_results boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  sticker public.story_stickers%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to vote in this poll.'; end if;
  if p_option_number is null or p_option_number not in (1, 2) then
    raise exception 'Choose one of the poll options.';
  end if;
  select * into sticker from public.story_stickers where id = p_sticker_id and kind = 'poll';
  if not found
    or sticker.author_id = auth.uid()
    or not public.can_view_story(sticker.story_id, auth.uid())
    or not public.story_sticker_pair_allowed(sticker.author_id, auth.uid())
  then
    raise exception 'You cannot vote in this poll.';
  end if;

  insert into public.story_poll_votes (sticker_id, voter_id, option_number)
  values (p_sticker_id, auth.uid(), p_option_number)
  on conflict (sticker_id, voter_id) do nothing;

  return query select * from public.get_story_poll_results(p_sticker_id);
end;
$$;

create function public.filter_story_question_reply()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set row_security = off
as $$
declare
  sticker_author uuid;
  normalized_body text;
begin
  select sticker.author_id into sticker_author
  from public.story_stickers sticker
  where sticker.id = new.sticker_id and sticker.kind = 'question';
  if sticker_author is null then return new; end if;

  normalized_body := ' ' || trim(regexp_replace(
    extensions.unaccent(lower(new.body)), '[^[:alnum:]]+', ' ', 'g'
  )) || ' ';
  if exists (
    select 1
    from public.comment_hidden_words word
    where word.user_id = sticker_author
      and position(
        ' ' || trim(regexp_replace(extensions.unaccent(lower(word.phrase)), '[^[:alnum:]]+', ' ', 'g')) || ' '
        in normalized_body
      ) > 0
  ) then
    new.visibility_state := 'hidden_word';
  end if;
  return new;
end;
$$;

create trigger story_question_replies_filter_before_insert
before insert on public.story_question_replies
for each row execute function public.filter_story_question_reply();

create function public.reply_to_story_question(p_sticker_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  sticker public.story_stickers%rowtype;
  reply_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to reply to a story question.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Replies must contain 1 to 1000 characters.';
  end if;
  select * into sticker from public.story_stickers where id = p_sticker_id and kind = 'question';
  if not found
    or sticker.author_id = auth.uid()
    or not public.can_view_story(sticker.story_id, auth.uid())
    or not public.story_sticker_pair_allowed(sticker.author_id, auth.uid())
  then
    raise exception 'You cannot reply to this story question.';
  end if;

  insert into public.story_question_replies (sticker_id, responder_id, body)
  values (p_sticker_id, auth.uid(), btrim(p_body))
  returning id into reply_id;

  insert into public.moderation_jobs (content_type, content_id, requested_by)
  values ('story_question_reply', reply_id, auth.uid());

  return reply_id;
end;
$$;

create function public.get_story_question_replies(p_sticker_id uuid)
returns table (id uuid, responder_id uuid, username text, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view story replies.'; end if;
  if not exists (
    select 1 from public.story_stickers sticker
    join public.stories story on story.id = sticker.story_id
    where sticker.id = p_sticker_id
      and sticker.kind = 'question'
      and sticker.author_id = auth.uid()
      and story.deleted_at is null
      and story.expires_at > now()
  ) then
    raise exception 'These story replies are not available.';
  end if;

  return query
  select reply.id, reply.responder_id, profile.username, reply.body, reply.created_at
  from public.story_question_replies reply
  join public.profiles profile on profile.id = reply.responder_id
  where reply.sticker_id = p_sticker_id
    and reply.visibility_state = 'visible'
    and reply.moderation_status = 'clear'
    and not public.story_blocked_pair(sticker.author_id, reply.responder_id)
  order by reply.created_at desc, reply.id desc
  limit 100;
end;
$$;

alter table public.moderation_jobs
  drop constraint moderation_jobs_content_type_check;
alter table public.moderation_jobs
  add constraint moderation_jobs_content_type_check
  check (content_type in ('post', 'comment', 'story_question_reply'));

alter table public.moderation_flags
  drop constraint moderation_flags_content_type_check;
alter table public.moderation_flags
  add constraint moderation_flags_content_type_check
  check (content_type in ('post', 'comment', 'story_question_reply'));

create or replace function public.review_moderation_flag(
  p_flag_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  flag public.moderation_flags%rowtype;
  next_status text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_official) then
    raise exception 'Only authorized reviewers can make moderation decisions.';
  end if;
  if p_action is null or p_action not in ('approve', 'remove', 'warn') then
    raise exception 'Choose approve, remove, or warn.';
  end if;
  select * into flag from public.moderation_flags where id = p_flag_id for update;
  if not found then raise exception 'This moderation item is unavailable.'; end if;

  update public.moderation_flags
  set status = case p_action when 'approve' then 'approved' when 'remove' then 'removed' else 'warned' end,
      decision_note = left(p_note, 500),
      updated_at = now()
  where id = p_flag_id;

  next_status := case
    when p_action = 'remove' or exists (
      select 1 from public.moderation_flags pending
      where pending.content_type = flag.content_type
        and pending.content_id = flag.content_id
        and pending.id <> flag.id
        and pending.status in ('review', 'appealed')
    ) then 'hidden'
    else 'clear'
  end;

  if flag.content_type = 'post' then
    update public.posts set moderation_status = next_status where id = flag.content_id;
  elsif flag.content_type = 'comment' then
    update public.comments set moderation_status = next_status where id = flag.content_id;
  else
    update public.story_question_replies set moderation_status = next_status where id = flag.content_id;
  end if;
end;
$$;

revoke all on function public.review_moderation_flag(uuid, text, text) from public, anon;
grant execute on function public.review_moderation_flag(uuid, text, text) to authenticated;

revoke all on function public.story_sticker_pair_allowed(uuid, uuid) from public, anon;
revoke all on function public.create_story_with_sticker(uuid, text, text, text, jsonb, text, integer, integer, integer, text, text, text, text, numeric, numeric, numeric) from public, anon;
revoke all on function public.get_story_poll_results(uuid) from public, anon;
revoke all on function public.vote_on_story_poll(uuid, smallint) from public, anon;
revoke all on function public.filter_story_question_reply() from public, anon, authenticated;
revoke all on function public.reply_to_story_question(uuid, text) from public, anon;
revoke all on function public.get_story_question_replies(uuid) from public, anon;

grant execute on function public.story_sticker_pair_allowed(uuid, uuid) to authenticated;
grant execute on function public.create_story_with_sticker(uuid, text, text, text, jsonb, text, integer, integer, integer, text, text, text, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.get_story_poll_results(uuid) to authenticated;
grant execute on function public.vote_on_story_poll(uuid, smallint) to authenticated;
grant execute on function public.reply_to_story_question(uuid, text) to authenticated;
grant execute on function public.get_story_question_replies(uuid) to authenticated;

commit;
