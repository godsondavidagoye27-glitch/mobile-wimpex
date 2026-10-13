create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null
    check (username = lower(username) and username ~ '^[a-z0-9._]{3,20}$'),
  display_name text not null,
  avatar_url text,
  bio text default '',
  link text,
  date_of_birth date not null,
  is_private boolean not null default false,
  dm_policy text not null default 'everyone'
    check (dm_policy in ('everyone', 'friends', 'none')),
  created_at timestamptz default now()
);

create table public.profile_interests (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  interest text not null,
  primary key (profile_id, interest)
);

create function public.apply_profile_age_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  account_age integer;
begin
  account_age := date_part('year', age(current_date, new.date_of_birth))::integer;

  if account_age < 13 then
    raise exception 'You must be 13 or older to join Wimpex.'
      using errcode = '23514';
  end if;

  if account_age < 18 then
    new.is_private := true;
    new.dm_policy := 'friends';
  end if;

  return new;
end;
$$;

create trigger profiles_apply_age_defaults
before insert on public.profiles
for each row execute function public.apply_profile_age_defaults();

create function public.is_username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from public.profiles
    where username = lower(name)
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.profile_interests enable row level security;

grant select, insert, update, delete on public.profiles, public.profile_interests to authenticated;

create policy "Signed-in users can read profiles"
on public.profiles for select to authenticated
using (auth.uid() is not null);

create policy "Users can insert their own profile"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can delete their own profile"
on public.profiles for delete to authenticated
using (auth.uid() = id);

create policy "Signed-in users can read profile interests"
on public.profile_interests for select to authenticated
using (auth.uid() is not null);

create policy "Users can insert their own interests"
on public.profile_interests for insert to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_interests.profile_id
      and profiles.id = auth.uid()
  )
);

create policy "Users can update their own interests"
on public.profile_interests for update to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_interests.profile_id
      and profiles.id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_interests.profile_id
      and profiles.id = auth.uid()
  )
);

create policy "Users can delete their own interests"
on public.profile_interests for delete to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_interests.profile_id
      and profiles.id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

create policy "Anyone can read avatars"
on storage.objects for select
using (bucket_id = 'avatars');

create policy "Users can upload their own avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can update their own avatars"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
