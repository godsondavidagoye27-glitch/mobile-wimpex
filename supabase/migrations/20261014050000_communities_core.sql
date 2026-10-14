create extension if not exists pg_trgm with schema extensions;
create function public.community_rules_valid(p_rules jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_rules) = 'array'
      then jsonb_array_length(p_rules) <= 10
        and not exists (
          select 1 from jsonb_array_elements(p_rules) as rules(value)
          where jsonb_typeof(value) <> 'string'
            or char_length(btrim(value #>> '{}')) not between 1 and 120
        )
    else false
  end;
$$;
revoke all on function public.community_rules_valid(jsonb) from public, anon, authenticated;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 3 and 40),
  description text not null default '' check (char_length(description) <= 300),
  category text not null check (category in (
    'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art', 'Tech', 'Fashion',
    'Learning', 'Health', 'Comedy', 'Other'
  )),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  is_adults_only boolean not null default false,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  icon_path text,
  rules jsonb not null default '[]'::jsonb check (public.community_rules_valid(rules)),
  member_count integer not null default 0 check (member_count >= 0),
  post_count integer not null default 0 check (post_count >= 0),
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index communities_name_lower_uidx on public.communities (lower(name));
create index communities_discovery_idx
  on public.communities (category, member_count desc, id)
  where not is_archived;
create index communities_owner_idx on public.communities (owner_id);

do $$
declare
  opclass_schema text;
begin
  select n.nspname into opclass_schema
  from pg_opclass o
  join pg_am am on am.oid = o.opcmethod and am.amname = 'gin'
  join pg_namespace n on n.oid = o.opcnamespace
  where o.opcname = 'gin_trgm_ops';

  execute format(
    'create index communities_name_trgm_idx on public.communities using gin (name %I.gin_trgm_ops)',
    opclass_schema
  );
end;
$$;

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'invited', 'banned')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_status_idx
  on public.community_members (user_id, status, community_id);
create index community_members_community_status_role_idx
  on public.community_members (community_id, status, role, joined_at, user_id);

alter table public.notifications
  add column community_id uuid references public.communities (id) on delete cascade;
alter table public.notifications
  drop constraint notifications_user_id_actor_id_type_post_id_comment_id_key;
alter table public.notifications
  add constraint notifications_dedupe_key
  unique nulls not distinct (user_id, actor_id, type, post_id, comment_id, community_id);

revoke all on public.communities, public.community_members from anon, authenticated;
grant select on public.communities, public.community_members to authenticated;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;

create function public.can_view_community(p_community_id uuid, p_viewer_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = p_viewer_id
    and exists (
      select 1
      from public.communities c
      left join public.profiles viewer on viewer.id = p_viewer_id
      where c.id = p_community_id
        and not c.is_archived
        and not (
          c.is_adults_only
          and date_part('year', age(current_date, viewer.date_of_birth)) < 18
        )
        and (
          c.visibility = 'public'
          or exists (
            select 1
            from public.community_members cm
            where cm.community_id = c.id
              and cm.user_id = p_viewer_id
              and cm.status = 'active'
          )
        )
    );
$$;
revoke all on function public.can_view_community(uuid, uuid) from public, anon;
grant execute on function public.can_view_community(uuid, uuid) to authenticated;

create policy "Visible communities can be read"
on public.communities for select to authenticated
using (public.can_view_community(id, auth.uid()));

create function public.community_user_is_adult(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and date_part('year', age(current_date, p.date_of_birth)) >= 18
  );
$$;
revoke all on function public.community_user_is_adult(uuid) from public, anon, authenticated;

create function public.community_is_manager(p_community_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() = p_user_id
    and exists (
      select 1 from public.community_members cm
      where cm.community_id = p_community_id
        and cm.user_id = p_user_id
        and cm.status = 'active'
        and cm.role in ('owner', 'moderator')
    );
$$;
revoke all on function public.community_is_manager(uuid, uuid) from public, anon;
grant execute on function public.community_is_manager(uuid, uuid) to authenticated;

create policy "Community members are visible to eligible viewers"
on public.community_members for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.can_view_community(community_id, auth.uid())
    and (
      status = 'active'
      or public.community_is_manager(community_id, auth.uid())
    )
  )
);

create function public.community_can_create_adults_only()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() is not null and public.community_user_is_adult(auth.uid());
$$;
revoke all on function public.community_can_create_adults_only() from public, anon;
grant execute on function public.community_can_create_adults_only() to authenticated;

create function public.update_community_member_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_community uuid;
  change_count integer := 0;
begin
  if tg_op <> 'INSERT' then
    target_community := old.community_id;
    if old.status = 'active' then change_count := change_count - 1; end if;
  end if;
  if tg_op <> 'DELETE' then
    target_community := new.community_id;
    if new.status = 'active' then change_count := change_count + 1; end if;
  end if;
  if change_count <> 0 then
    update public.communities
    set member_count = greatest(0, member_count + change_count)
    where id = target_community;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger community_members_update_count
after insert or delete or update of status on public.community_members
for each row execute function public.update_community_member_count();

create function public.notify_community(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_community_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if p_user_id is null or p_actor_id is null or p_user_id = p_actor_id then
    return;
  end if;
  if not coalesce((
    select settings.notify_followers
    from public.user_settings settings
    where settings.user_id = p_user_id
  ), true) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, community_id)
  values (p_user_id, p_actor_id, p_type, p_community_id)
  on conflict do nothing;
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'reply', 'follow', 'follow_request', 'live',
    'community_invite', 'community_join_request', 'community_request_approved'
  ));

create function public.create_community(
  p_slug text,
  p_name text,
  p_description text,
  p_category text,
  p_visibility text,
  p_is_adults_only boolean default false,
  p_rules jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  created_id uuid;
begin
  if viewer_id is null then raise exception 'Sign in to create a community.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer_id::text, 0));
  if (select count(*) from public.communities where owner_id = viewer_id) >= 5 then
    raise exception 'You can create up to 5 communities.';
  end if;
  if p_is_adults_only and not public.community_user_is_adult(viewer_id) then
    raise exception 'Only adults can create adults only communities.';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'Community name must be 3 to 40 characters.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 3 and 40 then
    raise exception 'Community name must be 3 to 40 characters.';
  end if;
  if p_description is null or char_length(p_description) > 300 then
    raise exception 'Description must be 300 characters or fewer.';
  end if;
  if p_category not in (
    'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art', 'Tech', 'Fashion',
    'Learning', 'Health', 'Comedy', 'Other'
  ) then raise exception 'Choose a valid category.'; end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'Choose public or private visibility.';
  end if;
  if not public.community_rules_valid(p_rules) then
    raise exception 'Rules must contain up to 10 items of 120 characters or fewer.';
  end if;

  insert into public.communities (
    slug, name, description, category, visibility, is_adults_only, owner_id, rules
  )
  values (
    lower(btrim(p_slug)), btrim(p_name), btrim(p_description), p_category,
    p_visibility, p_is_adults_only, viewer_id, p_rules
  )
  returning id into created_id;

  insert into public.community_members (community_id, user_id, role, status)
  values (created_id, viewer_id, 'owner', 'active');
  return created_id;
exception
  when unique_violation then
    raise exception 'That community name is taken.';
end;
$$;

create function public.community_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select auth.uid() is not null
    and char_length(btrim(coalesce(p_name, ''))) between 3 and 40
    and not exists (
      select 1 from public.communities c
      where lower(c.name) = lower(btrim(p_name))
    );
$$;

create function public.join_community(p_community_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  target public.communities%rowtype;
  existing_status text;
  next_status text;
begin
  if viewer_id is null then raise exception 'Sign in to join a community.'; end if;
  select * into target from public.communities
  where id = p_community_id and not is_archived;
  if not found then raise exception 'Community not found.'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = viewer_id and b.blocked_id = target.owner_id)
       or (b.blocker_id = target.owner_id and b.blocked_id = viewer_id)
  ) then raise exception 'You cannot join this community.'; end if;
  if target.is_adults_only and not public.community_user_is_adult(viewer_id) then
    raise exception 'This community is for adults only.';
  end if;
  select status into existing_status from public.community_members
  where community_id = target.id and user_id = viewer_id;
  if existing_status = 'banned' then raise exception 'You cannot join this community.'; end if;
  if existing_status = 'invited' then
    update public.community_members set status = 'active', joined_at = now()
    where community_id = target.id and user_id = viewer_id;
    return 'active';
  end if;
  if existing_status = 'active' then return 'active'; end if;
  if existing_status = 'pending' then return 'pending'; end if;
  next_status := case when target.visibility = 'public' then 'active' else 'pending' end;
  insert into public.community_members (community_id, user_id, role, status)
  values (target.id, viewer_id, 'member', next_status);
  if next_status = 'pending' then
    perform public.notify_community(manager.user_id, viewer_id, 'community_join_request', target.id)
    from public.community_members manager
    where manager.community_id = target.id
      and manager.status = 'active'
      and manager.role in ('owner', 'moderator');
  end if;
  return next_status;
end;
$$;

create function public.leave_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Sign in to leave a community.'; end if;
  if exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = viewer_id
      and role = 'owner' and status = 'active'
  ) then raise exception 'Transfer ownership before you leave.'; end if;
  delete from public.community_members
  where community_id = p_community_id and user_id = viewer_id
    and status in ('active', 'pending', 'invited');
end;
$$;

create function public.cancel_join_request(p_community_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  delete from public.community_members
  where community_id = p_community_id
    and user_id = auth.uid()
    and status = 'pending';
$$;

create function public.respond_join_request(
  p_community_id uuid,
  p_user_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null or not exists (
    select 1 from public.community_members manager
    where manager.community_id = p_community_id
      and manager.user_id = viewer_id
      and manager.status = 'active'
      and manager.role in ('owner', 'moderator')
  ) then raise exception 'Only community moderators can manage requests.'; end if;
  if p_accept and exists (
    select 1 from public.communities c
    where c.id = p_community_id and c.is_adults_only
      and not public.community_user_is_adult(p_user_id)
  ) then raise exception 'This community is for adults only.'; end if;
  if p_accept then
    update public.community_members
    set status = 'active', joined_at = now()
    where community_id = p_community_id and user_id = p_user_id and status = 'pending';
    if not found then raise exception 'Join request not found.'; end if;
    perform public.notify_community(p_user_id, viewer_id, 'community_request_approved', p_community_id);
  else
    delete from public.community_members
    where community_id = p_community_id and user_id = p_user_id and status = 'pending';
    if not found then raise exception 'Join request not found.'; end if;
  end if;
end;
$$;

create function public.invite_member(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null or not exists (
    select 1 from public.community_members manager
    where manager.community_id = p_community_id and manager.user_id = viewer_id
      and manager.status = 'active' and manager.role in ('owner', 'moderator')
  ) then raise exception 'Only community moderators can invite people.'; end if;
  if exists (
    select 1 from public.communities c
    where c.id = p_community_id and c.is_adults_only
      and not public.community_user_is_adult(p_user_id)
  ) then raise exception 'This community is for adults only.'; end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = viewer_id and b.blocked_id = p_user_id)
       or (b.blocker_id = p_user_id and b.blocked_id = viewer_id)
  ) then raise exception 'You cannot invite this person.'; end if;
  insert into public.community_members (community_id, user_id, role, status)
  values (p_community_id, p_user_id, 'member', 'invited')
  on conflict (community_id, user_id) do update
    set status = 'invited', role = 'member'
    where public.community_members.status in ('pending');
  if not found then raise exception 'This person cannot be invited.'; end if;
  perform public.notify_community(p_user_id, viewer_id, 'community_invite', p_community_id);
end;
$$;

create function public.respond_invite(p_community_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  adults_only boolean;
begin
  if viewer_id is null then raise exception 'Sign in to respond to an invite.'; end if;
  select is_adults_only into adults_only from public.communities
  where id = p_community_id and not is_archived;
  if not found then raise exception 'Community not found.'; end if;
  if p_accept and adults_only and not public.community_user_is_adult(viewer_id) then
    raise exception 'This community is for adults only.';
  end if;
  if p_accept then
    update public.community_members set status = 'active', joined_at = now()
    where community_id = p_community_id and user_id = viewer_id and status = 'invited';
  else
    delete from public.community_members
    where community_id = p_community_id and user_id = viewer_id and status = 'invited';
  end if;
  if not found then raise exception 'Community invite not found.'; end if;
end;
$$;

create function public.set_member_role(
  p_community_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid()
      and role = 'owner' and status = 'active'
  ) then raise exception 'Only the owner can change moderator roles.'; end if;
  if p_role not in ('moderator', 'member') then raise exception 'Choose a valid role.'; end if;
  update public.community_members set role = p_role
  where community_id = p_community_id and user_id = p_user_id
    and status = 'active' and role <> 'owner';
  if not found then raise exception 'Active member not found.'; end if;
end;
$$;

create function public.transfer_ownership(p_community_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null or not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = viewer_id
      and role = 'owner' and status = 'active'
  ) then raise exception 'Only the owner can transfer ownership.'; end if;
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = p_new_owner
      and status = 'active' and p_new_owner <> viewer_id
  ) then raise exception 'Choose an active member.'; end if;
  update public.community_members set role = 'moderator'
  where community_id = p_community_id and user_id = viewer_id;
  update public.community_members set role = 'owner'
  where community_id = p_community_id and user_id = p_new_owner;
  update public.communities set owner_id = p_new_owner where id = p_community_id;
end;
$$;

create function public.ban_member(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  manager_role text;
  target_role text;
begin
  select role into manager_role from public.community_members
  where community_id = p_community_id and user_id = auth.uid()
    and status = 'active' and role in ('owner', 'moderator');
  if manager_role is null then raise exception 'Only community moderators can ban members.'; end if;
  select role into target_role from public.community_members
  where community_id = p_community_id and user_id = p_user_id and status = 'active';
  if target_role is null then raise exception 'Active member not found.'; end if;
  if target_role = 'owner' or (manager_role = 'moderator' and target_role = 'moderator') then
    raise exception 'You cannot ban this member.';
  end if;
  update public.community_members set status = 'banned'
  where community_id = p_community_id and user_id = p_user_id;
end;
$$;

create function public.unban_member(p_community_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  manager_role text;
begin
  select role into manager_role from public.community_members
  where community_id = p_community_id and user_id = auth.uid()
    and status = 'active' and role in ('owner', 'moderator');
  if manager_role is null then raise exception 'Only community moderators can unban members.'; end if;
  update public.community_members set status = 'active'
  where community_id = p_community_id and user_id = p_user_id and status = 'banned';
  if not found then raise exception 'Banned member not found.'; end if;
end;
$$;

create function public.update_community(
  p_community_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_visibility text,
  p_is_adults_only boolean,
  p_icon_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  manager_role text;
begin
  select role into manager_role from public.community_members
  where community_id = p_community_id and user_id = auth.uid()
    and status = 'active' and role in ('owner', 'moderator');
  if manager_role is null then raise exception 'Only community moderators can edit details.'; end if;
  if manager_role <> 'owner' and p_is_adults_only is distinct from (
    select is_adults_only from public.communities where id = p_community_id
  ) then raise exception 'Only the owner can change the age setting.'; end if;
  if p_is_adults_only and not public.community_user_is_adult(auth.uid()) then
    raise exception 'Only adults can create adults only communities.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 3 and 40 then
    raise exception 'Community name must be 3 to 40 characters.';
  end if;
  if p_description is null or char_length(p_description) > 300 then
    raise exception 'Description must be 300 characters or fewer.';
  end if;
  if p_category not in (
    'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art', 'Tech', 'Fashion',
    'Learning', 'Health', 'Comedy', 'Other'
  ) then raise exception 'Choose a valid category.'; end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'Choose public or private visibility.';
  end if;
  update public.communities
  set name = btrim(p_name), description = btrim(p_description), category = p_category,
      visibility = p_visibility, is_adults_only = p_is_adults_only,
      icon_path = coalesce(p_icon_path, icon_path)
  where id = p_community_id;
  if not found then raise exception 'Community not found.'; end if;
exception
  when unique_violation then raise exception 'That community name is taken.';
end;
$$;

create function public.update_rules(p_community_id uuid, p_rules jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid()
      and status = 'active' and role in ('owner', 'moderator')
  ) then raise exception 'Only community moderators can update rules.'; end if;
  if not public.community_rules_valid(p_rules) then
    raise exception 'Rules must contain up to 10 items of 120 characters or fewer.';
  end if;
  update public.communities set rules = p_rules where id = p_community_id;
  if not found then raise exception 'Community not found.'; end if;
end;
$$;

create function public.delete_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.community_members
    where community_id = p_community_id and user_id = auth.uid()
      and status = 'active' and role = 'owner'
  ) then raise exception 'Only the owner can delete this community.'; end if;
  delete from public.communities where id = p_community_id;
end;
$$;

create function public.get_community(p_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  visibility text,
  is_adults_only boolean,
  icon_path text,
  rules jsonb,
  member_count integer,
  post_count integer,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  created_at timestamptz,
  role text,
  status text,
  can_post boolean,
  can_moderate boolean,
  is_adults_only_hidden boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  target public.communities%rowtype;
  member_role text;
  member_status text;
  visible boolean;
  hidden boolean;
begin
  if viewer_id is null then raise exception 'Sign in to view communities.'; end if;
  select * into target from public.communities c
  where c.slug = lower(btrim(p_slug)) and not c.is_archived;
  if not found then return; end if;
  hidden := target.is_adults_only and not public.community_user_is_adult(viewer_id);
  if hidden then return; end if;
  select cm.role, cm.status into member_role, member_status
  from public.community_members cm
  where cm.community_id = target.id and cm.user_id = viewer_id;
  visible := target.visibility = 'public' or (member_role is not null and member_status = 'active');
  if visible and exists (
    select 1 from public.blocks b
    join public.community_members target_member
      on target_member.community_id = target.id
     and target_member.status = 'active'
    where public.profile_blocked_pair(target_member.user_id, viewer_id)
  ) then visible := false; end if;
  id := target.id;
  slug := target.slug;
  name := target.name;
  description := case when visible then target.description else null end;
  category := target.category;
  visibility := target.visibility;
  is_adults_only := target.is_adults_only;
  icon_path := target.icon_path;
  rules := case when visible then target.rules else '[]'::jsonb end;
  member_count := target.member_count;
  post_count := case when visible then target.post_count else 0 end;
  owner_id := case when visible then target.owner_id else null end;
  select p.username, p.display_name into owner_username, owner_display_name
  from public.profiles p where p.id = target.owner_id and visible;
  created_at := target.created_at;
  role := member_role;
  status := member_status;
  can_post := visible and member_status = 'active';
  can_moderate := visible and member_status = 'active' and member_role in ('owner', 'moderator');
  is_adults_only_hidden := hidden;
  return next;
end;
$$;

create function public.get_community_members(
  p_slug text,
  p_query text default '',
  p_cursor_status text default null,
  p_cursor_joined_at timestamptz default null,
  p_cursor_user_id uuid default null,
  p_page_size integer default 20
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  target_id uuid;
begin
  if viewer_id is null then raise exception 'Sign in to view members.'; end if;
  if char_length(btrim(coalesce(p_query, ''))) > 0
    and char_length(btrim(p_query)) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if coalesce(p_page_size, 20) not between 1 and 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  select c.id into target_id from public.communities c
  where c.slug = lower(btrim(p_slug)) and not c.is_archived
    and public.can_view_community(c.id, viewer_id)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = viewer_id and b.blocked_id = c.owner_id)
         or (b.blocker_id = c.owner_id and b.blocked_id = viewer_id)
    );
  if target_id is null then raise exception 'Community not found.'; end if;
  if exists (
    select 1 from public.communities c
    where c.id = target_id and c.visibility = 'private'
  ) and not exists (
    select 1 from public.community_members
    where community_id = target_id and user_id = viewer_id and status = 'active'
  ) then raise exception 'Join this private community to view its members.'; end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_url, cm.role, cm.status, cm.joined_at
  from public.community_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.community_id = target_id
    and not public.profile_blocked_pair(p.id, viewer_id)
    and (
      cm.status = 'active'
      or (
        cm.status in ('pending', 'banned')
        and exists (
          select 1 from public.community_members manager
          where manager.community_id = target_id and manager.user_id = viewer_id
            and manager.status = 'active' and manager.role in ('owner', 'moderator')
        )
      )
    )
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or p.username ilike '%' || btrim(p_query) || '%'
      or p.display_name ilike '%' || btrim(p_query) || '%'
    )
    and (
      p_cursor_joined_at is null
      or case
        when cm.status = 'pending' then 0
        when cm.status = 'banned' then 1
        else 2
      end > case
        when p_cursor_status = 'pending' then 0
        when p_cursor_status = 'banned' then 1
        else 2
      end
      or (
        case
          when cm.status = 'pending' then 0
          when cm.status = 'banned' then 1
          else 2
        end = case
          when p_cursor_status = 'pending' then 0
          when p_cursor_status = 'banned' then 1
          else 2
        end
        and (cm.joined_at, cm.user_id) < (p_cursor_joined_at, p_cursor_user_id)
      )
    )
  order by
    case
      when cm.status = 'pending' then 0
      when cm.status = 'banned' then 1
      else 2
    end,
    cm.joined_at desc,
    cm.user_id desc
  limit coalesce(p_page_size, 20);
end;
$$;

create function public.community_invite_candidates(
  p_community_id uuid,
  p_query text,
  p_cursor_username text default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_private boolean,
  followers_count integer,
  follow_status text
)
language plpgsql
volatile
security definer
set search_path = public, wimpex_private, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  adults_only boolean;
begin
  if viewer_id is null or not public.community_is_manager(p_community_id, viewer_id) then
    raise exception 'Only community moderators can invite people.';
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if coalesce(p_page_size, 20) not between 1 and 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  perform wimpex_private.consume_search_rate_limit();
  select c.is_adults_only into adults_only from public.communities c
  where c.id = p_community_id and not c.is_archived;
  if not found then raise exception 'Community not found.'; end if;

  return query
  select p.id, p.username, p.display_name, p.avatar_url, p.is_private,
    p.followers_count, coalesce(f.status, 'none')
  from public.profiles p
  left join public.follows f
    on f.follower_id = viewer_id and f.following_id = p.id
  where p.id <> viewer_id
    and (not adults_only or public.community_user_is_adult(p.id))
    and (p.username ilike '%' || btrim(p_query) || '%'
      or p.display_name ilike '%' || btrim(p_query) || '%')
    and (p_cursor_username is null or (p.username, p.id) > (p_cursor_username, p_cursor_id))
    and not public.profile_blocked_pair(p.id, viewer_id)
    and not exists (
      select 1 from public.community_members cm
      where cm.community_id = p_community_id and cm.user_id = p.id
    )
    and (coalesce((select viewer.is_demo from public.profiles viewer where viewer.id = viewer_id), false)
      or not p.is_demo)
  order by p.username, p.id
  limit coalesce(p_page_size, 20);
end;
$$;

create function public.my_communities()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  visibility text,
  is_adults_only boolean,
  icon_path text,
  member_count integer,
  post_count integer,
  role text,
  status text
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select c.id, c.slug, c.name, c.description, c.category, c.visibility,
    c.is_adults_only, c.icon_path, c.member_count, c.post_count, cm.role, cm.status
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = auth.uid()
    and cm.status in ('active', 'pending', 'invited')
    and not c.is_archived
    and not (c.is_adults_only and not public.community_user_is_adult(auth.uid()))
  order by cm.joined_at desc, c.name;
$$;

create function public.discover_communities(
  p_category text default null,
  p_query text default '',
  p_cursor_rank integer default null,
  p_cursor_members integer default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  visibility text,
  is_adults_only boolean,
  icon_path text,
  member_count integer,
  post_count integer,
  role text,
  status text,
  interest_match integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Sign in to discover communities.'; end if;
  if char_length(btrim(coalesce(p_query, ''))) > 0 and char_length(btrim(p_query)) < 2 then
    raise exception 'Search terms must contain at least 2 characters.';
  end if;
  if coalesce(p_page_size, 20) not between 1 and 20 then
    raise exception 'Page size must be between 1 and 20.';
  end if;
  if nullif(btrim(coalesce(p_query, '')), '') is not null then
    perform wimpex_private.consume_search_rate_limit();
  end if;
  return query
  with ranked as materialized (
    select c.*,
      count(distinct interest.interest)::integer as matched_interests,
      cm.role as member_role,
      cm.status as member_status
    from public.communities c
    left join public.community_members cm
      on cm.community_id = c.id and cm.user_id = viewer_id
    left join public.profile_interests interest
      on interest.profile_id = viewer_id and exists (
        select 1 from public.profile_interests community_interest
        where community_interest.profile_id = c.owner_id
          and community_interest.interest = interest.interest
      )
    where not c.is_archived
      and (p_category is null or c.category = p_category)
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or c.name ilike '%' || btrim(p_query) || '%'
        or c.description ilike '%' || btrim(p_query) || '%'
      )
      and not (c.is_adults_only and not public.community_user_is_adult(viewer_id))
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = viewer_id and b.blocked_id = c.owner_id)
           or (b.blocker_id = c.owner_id and b.blocked_id = viewer_id)
      )
      and (cm.status is null or cm.status <> 'banned')
    group by c.id, cm.role, cm.status
  )
  select ranked.id, ranked.slug, ranked.name,
    case when ranked.visibility = 'private' and ranked.member_status <> 'active'
      then '' else ranked.description end,
    ranked.category, ranked.visibility, ranked.is_adults_only, ranked.icon_path,
    ranked.member_count,
    case when ranked.visibility = 'private' and ranked.member_status <> 'active'
      then 0 else ranked.post_count end,
    ranked.member_role, ranked.member_status, ranked.matched_interests
  from ranked
  where (
      p_cursor_rank is null
      or (ranked.matched_interests, ranked.member_count, ranked.id)
        < (p_cursor_rank, p_cursor_members, p_cursor_id)
    )
  order by ranked.matched_interests desc, ranked.member_count desc, ranked.id desc
  limit coalesce(p_page_size, 20);
end;
$$;

create function public.suggested_communities()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  visibility text,
  is_adults_only boolean,
  icon_path text,
  member_count integer,
  post_count integer,
  role text,
  status text,
  interest_match integer
)
language sql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select * from public.discover_communities(null, '', null, null, null, 10);
$$;

create function public.community_notification_route(p_community_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select c.slug
  from public.communities c
  where c.id = p_community_id
    and not c.is_archived
    and not (c.is_adults_only and not public.community_user_is_adult(auth.uid()))
    and (
      c.visibility = 'public'
      or exists (
        select 1 from public.community_members cm
        where cm.community_id = c.id and cm.user_id = auth.uid()
          and cm.status in ('active', 'pending', 'invited')
      )
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = c.owner_id)
         or (b.blocker_id = c.owner_id and b.blocked_id = auth.uid())
    );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-icons', 'community-icons', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Community icons are public"
on storage.objects for select to public
using (bucket_id = 'community-icons');
create policy "Moderators upload community icons"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-icons'
  and array_length(storage.foldername(name), 1) = 1
  and name = (storage.foldername(name))[1] || '/icon.jpg'
  and exists (
    select 1 from public.community_members cm
    where cm.community_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'moderator')
  )
);
create policy "Moderators update community icons"
on storage.objects for update to authenticated
using (
  bucket_id = 'community-icons'
  and name = (storage.foldername(name))[1] || '/icon.jpg'
  and exists (
    select 1 from public.community_members cm
    where cm.community_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'moderator')
  )
)
with check (
  bucket_id = 'community-icons'
  and name = (storage.foldername(name))[1] || '/icon.jpg'
  and exists (
    select 1 from public.community_members cm
    where cm.community_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'moderator')
  )
);
create policy "Moderators delete community icons"
on storage.objects for delete to authenticated
using (
  bucket_id = 'community-icons'
  and name = (storage.foldername(name))[1] || '/icon.jpg'
  and exists (
    select 1 from public.community_members cm
    where cm.community_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'moderator')
  )
);

revoke all on function public.notify_community(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.create_community(text, text, text, text, text, boolean, jsonb) from public, anon;
revoke all on function public.community_name_available(text) from public, anon;
revoke all on function public.join_community(uuid) from public, anon;
revoke all on function public.leave_community(uuid) from public, anon;
revoke all on function public.cancel_join_request(uuid) from public, anon;
revoke all on function public.respond_join_request(uuid, uuid, boolean) from public, anon;
revoke all on function public.invite_member(uuid, uuid) from public, anon;
revoke all on function public.respond_invite(uuid, boolean) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
revoke all on function public.ban_member(uuid, uuid) from public, anon;
revoke all on function public.unban_member(uuid, uuid) from public, anon;
revoke all on function public.update_community(uuid, text, text, text, text, boolean, text)
  from public, anon;
revoke all on function public.update_rules(uuid, jsonb) from public, anon;
revoke all on function public.delete_community(uuid) from public, anon;
revoke all on function public.get_community(text) from public, anon;
revoke all on function public.get_community_members(text, text, text, timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.community_invite_candidates(uuid, text, text, uuid, integer)
  from public, anon;
revoke all on function public.my_communities() from public, anon;
revoke all on function public.discover_communities(text, text, integer, integer, uuid, integer)
  from public, anon;
revoke all on function public.suggested_communities() from public, anon;
revoke all on function public.community_notification_route(uuid) from public, anon;

grant execute on function public.create_community(text, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.community_name_available(text) to authenticated;
grant execute on function public.join_community(uuid) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;
grant execute on function public.cancel_join_request(uuid) to authenticated;
grant execute on function public.respond_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.invite_member(uuid, uuid) to authenticated;
grant execute on function public.respond_invite(uuid, boolean) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.ban_member(uuid, uuid) to authenticated;
grant execute on function public.unban_member(uuid, uuid) to authenticated;
grant execute on function public.update_community(uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.update_rules(uuid, jsonb) to authenticated;
grant execute on function public.delete_community(uuid) to authenticated;
grant execute on function public.get_community(text) to authenticated;
grant execute on function public.get_community_members(text, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.community_invite_candidates(uuid, text, text, uuid, integer) to authenticated;
grant execute on function public.my_communities() to authenticated;
grant execute on function public.discover_communities(text, text, integer, integer, uuid, integer) to authenticated;
grant execute on function public.suggested_communities() to authenticated;
grant execute on function public.community_notification_route(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_members'
    )
  then
    alter publication supabase_realtime add table public.community_members;
  end if;
end;
$$;
