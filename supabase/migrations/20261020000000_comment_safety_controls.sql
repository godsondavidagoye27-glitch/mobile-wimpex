create extension if not exists unaccent with schema extensions;

create table public.comment_hidden_words (
  user_id uuid not null references auth.users (id) on delete cascade,
  phrase text not null check (char_length(btrim(phrase)) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (user_id, phrase)
);
alter table public.comment_hidden_words enable row level security;
revoke all on public.comment_hidden_words from public, anon, authenticated;
grant select, insert, delete on public.comment_hidden_words to authenticated;
create policy "Users manage their own hidden comment words"
on public.comment_hidden_words for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create function public.enforce_comment_hidden_word_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if not exists (
    select 1 from public.comment_hidden_words
    where user_id = new.user_id and lower(phrase) = lower(new.phrase)
  ) and (
    select count(*) from public.comment_hidden_words where user_id = new.user_id
  ) >= 100 then
    raise exception 'You can save up to 100 hidden words or phrases.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_comment_hidden_word_limit() from public, anon, authenticated;
create trigger comment_hidden_word_limit
before insert on public.comment_hidden_words
for each row execute function public.enforce_comment_hidden_word_limit();

create table public.comment_restrictions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  restricted_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, restricted_user_id),
  check (owner_id <> restricted_user_id)
);
alter table public.comment_restrictions enable row level security;
revoke all on public.comment_restrictions from public, anon, authenticated;
grant select, insert, delete on public.comment_restrictions to authenticated;
create policy "Users manage their own comment restrictions"
on public.comment_restrictions for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

alter table public.comments
  add column visibility_state text not null default 'visible'
    check (visibility_state in ('visible', 'hidden_word', 'restricted_pending')),
  add column moderation_status text not null default 'clear'
    check (moderation_status in ('pending', 'clear', 'hidden')),
  add column moderation_category text;
alter table public.comments alter column moderation_status set default 'pending';

create function public.filter_comment_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set row_security = off
as $$
declare
  post_owner uuid;
  normalized_body text;
  hidden_phrase text;
begin
  select author_id into post_owner from public.posts where id = new.post_id;
  if post_owner is null then return new; end if;
  if exists (
    select 1 from public.comment_restrictions
    where owner_id = post_owner and restricted_user_id = new.author_id
  ) then
    new.visibility_state := 'restricted_pending';
    return new;
  end if;

  normalized_body := ' ' || trim(regexp_replace(
    extensions.unaccent(lower(new.body)), '[^[:alnum:]]+', ' ', 'g'
  )) || ' ';
  select phrase into hidden_phrase
  from public.comment_hidden_words
  where user_id = post_owner
    and position(
      ' ' || trim(regexp_replace(extensions.unaccent(lower(phrase)), '[^[:alnum:]]+', ' ', 'g')) || ' '
      in normalized_body
    ) > 0
  limit 1;
  if hidden_phrase is not null then
    new.visibility_state := 'hidden_word';
  end if;
  return new;
end;
$$;
revoke all on function public.filter_comment_before_insert() from public, anon, authenticated;
create trigger comments_filter_before_insert
before insert on public.comments
for each row execute function public.filter_comment_before_insert();

drop policy if exists "Comments are visible with their post" on public.comments;
create policy "Visible comments and owner-review comments are readable"
on public.comments for select to authenticated
using (
  public.can_view_post(post_id, auth.uid())
  and moderation_status <> 'hidden'
  and (
    (visibility_state = 'visible' and moderation_status = 'clear')
    or author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = comments.post_id and p.author_id = auth.uid()
    )
  )
);

drop trigger if exists comments_update_count on public.comments;
create function public.recount_visible_post_comments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_post_id uuid;
begin
  target_post_id := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  update public.posts p
  set comment_count = (
    select count(*) from public.comments c
    where c.post_id = target_post_id
      and c.deleted_at is null
      and c.visibility_state = 'visible'
      and c.moderation_status = 'clear'
  )
  where p.id = target_post_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.recount_visible_post_comments() from public, anon, authenticated;
create trigger comments_recount_visible_count
after insert or delete or update of visibility_state, moderation_status, deleted_at on public.comments
for each row execute function public.recount_visible_post_comments();

create or replace function public.notify_comment()
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
  if tg_op = 'UPDATE'
    and old.deleted_at is null
    and old.visibility_state = 'visible'
    and old.moderation_status = 'clear' then
    return new;
  end if;
  if new.deleted_at is not null
    or new.visibility_state <> 'visible'
    or new.moderation_status <> 'clear' then
    return new;
  end if;
  if new.parent_id is null then
    select author_id into recipient_id from public.posts where id = new.post_id;
    notification_type := 'comment';
  else
    select author_id into recipient_id from public.comments where id = new.parent_id;
    notification_type := 'reply';
  end if;
  if recipient_id is not null and recipient_id <> new.author_id then
    perform public.create_notification(recipient_id, new.author_id, notification_type, new.post_id, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_comment() from public, anon, authenticated;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
after insert or update of visibility_state, moderation_status on public.comments
for each row execute function public.notify_comment();

create function public.review_hidden_comment(p_comment_id uuid, p_unhide boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.comments c
  set visibility_state = case when p_unhide then 'visible' else c.visibility_state end
  from public.posts p
  where c.id = p_comment_id
    and p.id = c.post_id
    and p.author_id = auth.uid()
    and c.visibility_state in ('hidden_word', 'restricted_pending')
    and c.moderation_status <> 'hidden';
  if not found then
    raise exception 'This hidden comment is unavailable for review.';
  end if;
end;
$$;
revoke all on function public.review_hidden_comment(uuid, boolean) from public, anon;
grant execute on function public.review_hidden_comment(uuid, boolean) to authenticated;

create function public.get_my_hidden_comment_words()
returns table (phrase text)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select w.phrase
  from public.comment_hidden_words w
  where w.user_id = auth.uid()
  order by w.created_at, w.phrase;
$$;

create function public.add_my_hidden_comment_word(p_phrase text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change comment filters.'; end if;
  insert into public.comment_hidden_words (user_id, phrase)
  values (auth.uid(), btrim(p_phrase))
  on conflict (user_id, phrase) do nothing;
  update public.comments c
  set visibility_state = 'hidden_word'
  from public.posts p
  where p.id = c.post_id
    and p.author_id = auth.uid()
    and c.visibility_state = 'visible'
    and c.deleted_at is null
    and position(
      ' ' || trim(regexp_replace(
        extensions.unaccent(lower(btrim(p_phrase))), '[^[:alnum:]]+', ' ', 'g'
      )) || ' '
      in ' ' || trim(regexp_replace(
        extensions.unaccent(lower(c.body)), '[^[:alnum:]]+', ' ', 'g'
      )) || ' '
    ) > 0;
end;
$$;

create function public.remove_my_hidden_comment_word(p_phrase text)
returns void
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  delete from public.comment_hidden_words
  where user_id = auth.uid() and phrase = p_phrase;
$$;

create function public.get_my_hidden_comments()
returns table (
  id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  visibility_state text,
  author_username text,
  author_display_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select c.id, c.post_id, c.author_id, c.body, c.created_at, c.visibility_state,
    profile.username, profile.display_name
  from public.comments c
  join public.posts p on p.id = c.post_id
  join public.profiles profile on profile.id = c.author_id
  where p.author_id = auth.uid()
    and c.visibility_state in ('hidden_word', 'restricted_pending')
    and c.moderation_status <> 'hidden'
    and c.deleted_at is null
  order by c.created_at desc
  limit 200;
$$;

create function public.set_comment_restriction(p_user_id uuid, p_restrict boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or p_user_id = auth.uid() then
    raise exception 'This account cannot be restricted.';
  end if;
  if p_restrict then
    insert into public.comment_restrictions (owner_id, restricted_user_id)
    values (auth.uid(), p_user_id)
    on conflict do nothing;
    update public.comments c
    set visibility_state = 'restricted_pending'
    from public.posts p
    where p.id = c.post_id
      and p.author_id = auth.uid()
      and c.author_id = p_user_id
      and c.visibility_state = 'visible';
  else
    delete from public.comment_restrictions
    where owner_id = auth.uid() and restricted_user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.get_my_hidden_comment_words() from public, anon;
revoke all on function public.add_my_hidden_comment_word(text) from public, anon;
revoke all on function public.remove_my_hidden_comment_word(text) from public, anon;
revoke all on function public.get_my_hidden_comments() from public, anon;
revoke all on function public.set_comment_restriction(uuid, boolean) from public, anon;
grant execute on function public.get_my_hidden_comment_words() to authenticated;
grant execute on function public.add_my_hidden_comment_word(text) to authenticated;
grant execute on function public.remove_my_hidden_comment_word(text) to authenticated;
grant execute on function public.get_my_hidden_comments() to authenticated;
grant execute on function public.set_comment_restriction(uuid, boolean) to authenticated;
