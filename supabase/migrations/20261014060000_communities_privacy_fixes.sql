create or replace function public.get_community(p_slug text)
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
  if visible and public.profile_blocked_pair(target.owner_id, viewer_id) then
    visible := false;
  end if;
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
create or replace function public.discover_communities(
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
    case when ranked.visibility = 'private' and ranked.member_status is distinct from 'active'
      then '' else ranked.description end,
    ranked.category, ranked.visibility, ranked.is_adults_only, ranked.icon_path,
    ranked.member_count,
    case when ranked.visibility = 'private' and ranked.member_status is distinct from 'active'
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