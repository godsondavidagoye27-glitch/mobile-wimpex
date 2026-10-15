begin;

create or replace function public.get_follow_requests(
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null,
  p_page_size integer default 30
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  requested_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  result_limit integer := coalesce(p_page_size, 30);
begin
  if auth.uid() is null then
    raise exception 'Sign in to view follow requests.';
  end if;
  if result_limit < 1 or result_limit > 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.created_at
  from public.follows as f
  join public.profiles as p on p.id = f.follower_id
  where f.following_id = auth.uid()
    and f.status = 'pending'
    and not public.profile_blocked_pair(p.id, auth.uid())
    and (
      p_cursor_created_at is null
      or (f.created_at, p.id) < (p_cursor_created_at, p_cursor_user_id)
    )
  order by f.created_at desc, p.id desc
  limit result_limit;
end;
$function$;

revoke all on function public.get_follow_requests(timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_follow_requests(timestamptz, uuid, integer) to authenticated;

grant select, insert on realtime.messages to authenticated;

drop policy if exists "Users can read their own online presence topic" on realtime.messages;
create policy "Users can read their own online presence topic"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'presence:' || auth.uid()::text
);

drop policy if exists "Users can track their own online presence topic" on realtime.messages;
create policy "Users can track their own online presence topic"
on realtime.messages for insert to authenticated
with check (
  extension = 'presence'
  and realtime.topic() = 'presence:' || auth.uid()::text
);

commit;
