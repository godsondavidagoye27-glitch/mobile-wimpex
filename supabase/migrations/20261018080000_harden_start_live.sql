create or replace function public.start_live(p_title text default '')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  stream_id uuid;
  profile_row public.profiles%rowtype;
begin
  if current_user_id is null then raise exception 'Sign in to start a live stream.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) > 100 then
    raise exception 'Live titles must be 100 characters or fewer.';
  end if;

  select * into profile_row
  from public.profiles profile
  where profile.id = current_user_id;
  if not found then
    raise exception 'Complete your profile before starting a live stream.';
  end if;
  if profile_row.is_demo then
    raise exception 'Demo accounts cannot host live streams.';
  end if;
  if profile_row.is_official then
    raise exception 'Official accounts cannot host live streams.';
  end if;
  if profile_row.date_of_birth is null
    or date_part('year', age(current_date, profile_row.date_of_birth)) not between 18 and 120 then
    raise exception 'Live streaming is currently limited to adult accounts.';
  end if;

  update public.live_streams
  set status = 'ended', ended_at = now()
  where host_id = current_user_id
    and (
      (status = 'starting' and created_at < now() - interval '2 minutes')
      or (status = 'live' and heartbeat_at < now() - interval '90 seconds')
    );

  insert into public.live_streams (host_id, room_name, title)
  values (
    current_user_id,
    'live-' || gen_random_uuid()::text,
    btrim(coalesce(p_title, ''))
  )
  returning id into stream_id;
  return stream_id;
exception
  when unique_violation then
    raise exception 'You already have an active live stream.';
end;
$$;

revoke all on function public.start_live(text) from public, anon;
grant execute on function public.start_live(text) to authenticated;
