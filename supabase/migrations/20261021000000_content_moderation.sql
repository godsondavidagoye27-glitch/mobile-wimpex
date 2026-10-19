alter table public.posts
  add column moderation_status text not null default 'clear'
    check (moderation_status in ('clear', 'hidden'));

create table public.moderation_jobs (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'done')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (content_type, content_id)
);
create index moderation_jobs_due_idx on public.moderation_jobs (available_at, created_at)
  where status in ('pending', 'retry');
alter table public.moderation_jobs enable row level security;
revoke all on public.moderation_jobs from public, anon, authenticated;
grant all on public.moderation_jobs to service_role;

create function public.retry_stale_moderation_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  affected integer;
begin
  update public.moderation_jobs
  set status = 'retry',
      processing_started_at = null,
      available_at = now(),
      last_error = 'Moderation worker did not complete.'
  where status = 'processing'
    and processing_started_at < now() - interval '10 minutes';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.retry_stale_moderation_jobs() from public, anon, authenticated;
grant execute on function public.retry_stale_moderation_jobs() to service_role;

create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  author_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('nudity', 'violence', 'spam', 'abuse')),
  score numeric(5, 4) not null check (score between 0 and 1),
  status text not null default 'review' check (status in ('review', 'approved', 'removed', 'warned', 'appealed')),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_type, content_id, category)
);
create index moderation_flags_queue_idx on public.moderation_flags (status, created_at desc);
create index moderation_flags_author_idx on public.moderation_flags (author_id, created_at desc);
alter table public.moderation_flags enable row level security;
revoke all on public.moderation_flags from public, anon, authenticated;
grant select on public.moderation_flags to authenticated;
create policy "Moderation flags are visible to staff and authors"
on public.moderation_flags for select to authenticated
using (
  author_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_official)
);

create or replace function public.can_view_post(p_post_id uuid, p_viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when auth.uid() is null or auth.uid() <> p_viewer_id then false
    else exists (
      select 1
      from public.posts p
      join public.profiles author on author.id = p.author_id
      where p.id = p_post_id
        and (p.author_id = p_viewer_id or (
          p.status = 'published'
          and p.moderation_status = 'clear'
          and not exists (
            select 1 from public.blocks b
            where (b.blocker_id = p_viewer_id and b.blocked_id = p.author_id)
               or (b.blocker_id = p.author_id and b.blocked_id = p_viewer_id)
          )
          and (
            (p.audience = 'everyone' and not author.is_private)
            or exists (
              select 1 from public.follows f
              where f.follower_id = p_viewer_id
                and f.following_id = p.author_id
                and f.status = 'accepted'
            )
          )
        ))
    )
  end;
$$;

create function public.enqueue_post_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    insert into public.moderation_jobs (content_type, content_id, requested_by)
    values ('post', new.id, new.author_id)
    on conflict (content_type, content_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_post_moderation() from public, anon, authenticated;
create trigger posts_enqueue_moderation
after insert or update of status on public.posts
for each row execute function public.enqueue_post_moderation();

create function public.enqueue_comment_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  insert into public.moderation_jobs (content_type, content_id, requested_by)
  values ('comment', new.id, new.author_id)
  on conflict (content_type, content_id) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_comment_moderation() from public, anon, authenticated;
create trigger comments_enqueue_moderation
after insert on public.comments
for each row execute function public.enqueue_comment_moderation();

create function public.review_moderation_flag(p_flag_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  flag public.moderation_flags%rowtype;
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
  if flag.content_type = 'post' then
    update public.posts set moderation_status = case
      when p_action = 'remove' or exists (
        select 1 from public.moderation_flags pending
        where pending.content_type = flag.content_type
          and pending.content_id = flag.content_id
          and pending.status in ('review', 'appealed')
      ) then 'hidden'
      else 'clear'
    end
    where id = flag.content_id;
  else
    update public.comments set moderation_status = case
      when p_action = 'remove' or exists (
        select 1 from public.moderation_flags pending
        where pending.content_type = flag.content_type
          and pending.content_id = flag.content_id
          and pending.status in ('review', 'appealed')
      ) then 'hidden'
      else 'clear'
    end
    where id = flag.content_id;
  end if;
end;
$$;

create function public.appeal_moderation_flag(p_flag_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.moderation_flags
  set status = 'appealed', decision_note = left(p_note, 500), updated_at = now()
  where id = p_flag_id and author_id = auth.uid() and status in ('review', 'removed', 'warned');
  if not found then raise exception 'This moderation decision cannot be appealed.'; end if;
end;
$$;

revoke all on function public.review_moderation_flag(uuid, text, text) from public, anon;
revoke all on function public.appeal_moderation_flag(uuid, text) from public, anon;
grant execute on function public.review_moderation_flag(uuid, text, text) to authenticated;
grant execute on function public.appeal_moderation_flag(uuid, text) to authenticated;
