alter table public.posts add column edited_at timestamptz;

create function public.set_post_edited_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.caption is distinct from old.caption
    or new.hashtags is distinct from old.hashtags then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.set_post_edited_at() from public, anon, authenticated;
create trigger posts_set_edited_at
before update of caption, hashtags, audience, allow_comments, auto_captions on public.posts
for each row execute function public.set_post_edited_at();

create function public.enqueue_post_caption_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.caption is distinct from old.caption then
    new.moderation_status := 'hidden';
    update public.moderation_flags
    set status = 'approved',
        decision_note = 'Superseded by an edited version',
        updated_at = now()
    where content_type = 'post'
      and content_id = new.id
      and status in ('review', 'appealed', 'removed');
    insert into public.moderation_jobs (content_type, content_id, requested_by)
    values ('post', new.id, new.author_id)
    on conflict (content_type, content_id) do update
      set requested_by = excluded.requested_by,
          status = 'pending',
          attempts = 0,
          available_at = now(),
          last_error = null;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_post_caption_moderation() from public, anon, authenticated;
create trigger posts_recheck_caption_moderation
before update of caption on public.posts
for each row execute function public.enqueue_post_caption_moderation();
