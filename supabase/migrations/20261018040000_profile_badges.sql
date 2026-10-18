alter table public.profiles
  add column is_verified boolean not null default false;

create table public.badge_types (
  key text primary key,
  label text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  show_publicly boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.badge_types (key, label, sort_order)
values ('verified', 'Verified', 10)
on conflict (key) do update set label = excluded.label;

create table public.profile_badges (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null references public.badge_types(key),
  source text not null check (source in ('manual', 'auto')),
  granted_at timestamptz not null default now(),
  granted_by text,
  expires_at timestamptz,
  note text,
  primary key (profile_id, badge_key)
);
create index profile_badges_active_idx
  on public.profile_badges (badge_key, expires_at, profile_id);

create table public.badge_audit_log (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null references public.badge_types(key),
  action text not null check (action in ('grant', 'revoke', 'auto_grant', 'auto_revoke')),
  source text not null check (source in ('manual', 'auto')),
  actor text not null,
  reason_code text,
  created_at timestamptz not null default now()
);
create index badge_audit_profile_created_idx
  on public.badge_audit_log (profile_id, badge_key, created_at desc);

create table public.verification_rules (
  rule_key text primary key,
  value jsonb not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.verification_evaluations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  score numeric not null,
  passed boolean not null,
  reasons jsonb not null,
  evaluated_at timestamptz not null default now()
);
create index verification_evaluations_recent_idx
  on public.verification_evaluations (evaluated_at, profile_id);

create table public.badge_suppressions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null references public.badge_types(key),
  suppressed_by text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (profile_id, badge_key)
);

create table public.verification_flags (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.verification_queue (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  queued_at timestamptz not null default now()
);
create index verification_queue_queued_idx on public.verification_queue (queued_at, profile_id);
insert into public.verification_queue (profile_id)
select profile.id from public.profiles profile
on conflict (profile_id) do nothing;

alter table public.badge_types enable row level security;
alter table public.profile_badges enable row level security;
alter table public.badge_audit_log enable row level security;
alter table public.verification_rules enable row level security;
alter table public.verification_evaluations enable row level security;
alter table public.badge_suppressions enable row level security;
alter table public.verification_flags enable row level security;
alter table public.verification_queue enable row level security;

revoke all on public.badge_types, public.profile_badges, public.badge_audit_log,
  public.verification_rules, public.verification_evaluations,
  public.badge_suppressions, public.verification_flags, public.verification_queue
  from public, anon, authenticated;
grant select on public.badge_types to authenticated;
grant select (profile_id, badge_key, granted_at) on public.profile_badges to authenticated;
grant all on public.badge_types, public.profile_badges, public.badge_audit_log,
  public.verification_rules, public.verification_evaluations,
  public.badge_suppressions, public.verification_flags to service_role;
grant select, insert, delete on public.verification_queue to service_role;
revoke update, delete on public.badge_audit_log from service_role;
grant select, insert on public.badge_audit_log to service_role;
revoke truncate on public.badge_audit_log from service_role;
grant usage, select on sequence public.badge_audit_log_id_seq to service_role;
create index profile_badges_expiry_idx
  on public.profile_badges (expires_at, profile_id, badge_key)
  where expires_at is not null;

create policy "Authenticated users read active public badge types"
on public.badge_types for select to authenticated
using (is_active and show_publicly);

create policy "Authenticated users read visible unexpired profile badges"
on public.profile_badges for select to authenticated
using (
  (expires_at is null or expires_at > now())
  and exists (
    select 1 from public.badge_types badge_type
    where badge_type.key = profile_badges.badge_key
      and badge_type.is_active
      and badge_type.show_publicly
  )
  and auth.uid() is not null
  and not public.profile_blocked_pair(profile_id, auth.uid())
);

alter table public.reports
  add column moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'actioned', 'dismissed'));
revoke insert on public.reports from authenticated;
grant insert (reporter_id, target_type, target_id, reason) on public.reports to authenticated;
create index reports_actioned_profile_created_idx
  on public.reports (target_id, created_at desc)
  where target_type = 'profile' and moderation_status = 'actioned';

create function public.enqueue_verification_for_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_id uuid;
  post_id uuid;
begin
  if tg_table_name = 'verification_rules' then
    insert into public.verification_queue (profile_id)
    select profile.id from public.profiles profile
    on conflict (profile_id) do update set queued_at = now();
  elsif tg_table_name in ('posts', 'comments', 'stories') then
    target_id := coalesce(new.author_id, old.author_id);
  elsif tg_table_name = 'follows' then
    target_id := coalesce(new.following_id, old.following_id);
  elsif tg_table_name = 'post_likes' then
    post_id := coalesce(new.post_id, old.post_id);
    select post.author_id into target_id from public.posts post where post.id = post_id;
  elsif tg_table_name = 'community_members' then
    target_id := coalesce(new.user_id, old.user_id);
  elsif tg_table_name = 'reports' then
    if coalesce(new.target_type, old.target_type) = 'profile' then
      target_id := coalesce(new.target_id, old.target_id);
    end if;
  elsif tg_table_name = 'live_bans' then
    target_id := coalesce(new.user_id, old.user_id);
  elsif tg_table_name = 'profiles' then
    target_id := coalesce(new.id, old.id);
  end if;

  if target_id is not null then
    insert into public.verification_queue (profile_id)
    values (target_id)
    on conflict (profile_id) do update set queued_at = now();
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.enqueue_verification_for_change() from public, anon, authenticated;

create trigger profiles_enqueue_verification
after insert or update of avatar_url, bio on public.profiles
for each row execute function public.enqueue_verification_for_change();
create trigger posts_enqueue_verification
after insert or update or delete on public.posts
for each row execute function public.enqueue_verification_for_change();
create trigger comments_enqueue_verification
after insert or update or delete on public.comments
for each row execute function public.enqueue_verification_for_change();
create trigger stories_enqueue_verification
after insert or update or delete on public.stories
for each row execute function public.enqueue_verification_for_change();
create trigger follows_enqueue_verification
after insert or update or delete on public.follows
for each row execute function public.enqueue_verification_for_change();
create trigger post_likes_enqueue_verification
after insert or delete on public.post_likes
for each row execute function public.enqueue_verification_for_change();
create trigger community_members_enqueue_verification
after insert or update or delete on public.community_members
for each row execute function public.enqueue_verification_for_change();
create trigger reports_enqueue_verification
after insert or update of moderation_status on public.reports
for each row execute function public.enqueue_verification_for_change();
create trigger live_bans_enqueue_verification
after insert or update or delete on public.live_bans
for each row execute function public.enqueue_verification_for_change();
create trigger verification_rules_enqueue_all
after update on public.verification_rules
for each row execute function public.enqueue_verification_for_change();

insert into public.verification_rules (rule_key, value) values
  ('min_account_age_days', '45'::jsonb),
  ('min_published_posts', '12'::jsonb),
  ('min_qualified_followers', '750'::jsonb),
  ('min_total_likes_received', '2500'::jsonb),
  ('min_active_days_last_30', '8'::jsonb),
  ('require_profile_complete', 'true'::jsonb),
  ('require_email_confirmed', 'true'::jsonb),
  ('max_upheld_reports_90d', '0'::jsonb),
  ('max_community_bans', '0'::jsonb),
  ('min_qualified_follower_account_age_days', '14'::jsonb),
  ('qualified_follower_requires_avatar', 'true'::jsonb),
  ('min_following_for_qualified_engagement', '5'::jsonb)
on conflict (rule_key) do nothing;

create function public.sync_profile_verified_flag(p_profile_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  update public.profiles profile
  set is_verified = exists (
    select 1
    from public.profile_badges badge
    join public.badge_types badge_type on badge_type.key = badge.badge_key
    where badge.profile_id = p_profile_id
      and badge.badge_key = 'verified'
      and badge_type.is_active
      and badge_type.show_publicly
      and (badge.expires_at is null or badge.expires_at > now())
  )
  where profile.id = p_profile_id;
$$;
revoke all on function public.sync_profile_verified_flag(uuid) from public, anon, authenticated;

create function public.prepare_profile_badge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  new.granted_at := coalesce(new.granted_at, now());
  new.granted_by := coalesce(
    nullif(new.granted_by, ''),
    case when new.source = 'auto' then 'auto-evaluator' else 'owner' end
  );
  return new;
end;
$$;
revoke all on function public.prepare_profile_badge() from public, anon, authenticated;

create function public.handle_profile_badge_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.badge_audit_log (profile_id, badge_key, action, source, actor, reason_code)
    values (
      old.profile_id, old.badge_key,
      case when old.source = 'auto' then 'auto_revoke' else 'revoke' end,
      old.source, coalesce(old.granted_by, 'owner'), 'badge_removed'
    );
    perform public.sync_profile_verified_flag(old.profile_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.badge_audit_log (profile_id, badge_key, action, source, actor, reason_code)
    values (
      new.profile_id, new.badge_key,
      case when new.source = 'auto' then 'auto_grant' else 'grant' end,
      new.source, new.granted_by, 'badge_granted_or_updated'
    );
  elsif tg_op = 'UPDATE' and (
    old.source is distinct from new.source
    or old.expires_at is distinct from new.expires_at
  ) then
    insert into public.badge_audit_log (profile_id, badge_key, action, source, actor, reason_code)
    values (
      new.profile_id, new.badge_key,
      case when new.source = 'auto' then 'auto_grant' else 'grant' end,
      new.source, new.granted_by, 'badge_granted_or_updated'
    );
  end if;

  perform public.sync_profile_verified_flag(new.profile_id);
  return new;
end;
$$;
revoke all on function public.handle_profile_badge_change() from public, anon, authenticated;

create trigger profile_badges_prepare
before insert or update on public.profile_badges
for each row execute function public.prepare_profile_badge();

create trigger profile_badges_audit_and_sync
after insert or update or delete on public.profile_badges
for each row execute function public.handle_profile_badge_change();

create function public.handle_badge_type_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if old.is_active is distinct from new.is_active
    or old.show_publicly is distinct from new.show_publicly then
    update public.profiles profile
    set is_verified = exists (
      select 1
      from public.profile_badges badge
      join public.badge_types badge_type on badge_type.key = badge.badge_key
      where badge.profile_id = profile.id
        and badge.badge_key = 'verified'
        and badge_type.is_active
        and badge_type.show_publicly
        and (badge.expires_at is null or badge.expires_at > now())
    )
    where exists (
      select 1 from public.profile_badges badge
      where badge.profile_id = profile.id and badge.badge_key = old.key
    );
  end if;
  return new;
end;
$$;
revoke all on function public.handle_badge_type_change() from public, anon, authenticated;
create trigger badge_types_sync_profiles
after update of is_active, show_publicly on public.badge_types
for each row execute function public.handle_badge_type_change();

create function public.evaluate_verification(p_profile_id uuid)
returns table (score numeric, passed boolean, reasons jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  rule_values jsonb;
  profile_row public.profiles%rowtype;
  account_created_at timestamptz;
  account_age_days integer;
  published_posts integer;
  qualified_followers integer;
  qualified_likes integer;
  active_days integer;
  actioned_reports integer;
  community_bans integer;
  profile_complete boolean;
  contact_confirmed boolean;
  age_min integer;
  posts_min integer;
  followers_min integer;
  likes_min integer;
  active_min integer;
  profile_required boolean;
  contact_required boolean;
  reports_max integer;
  bans_max integer;
  follower_age_min integer;
  follower_avatar_required boolean;
  following_min integer;
  rule_results jsonb;
  passed_count integer;
  active_rule_count integer;
begin
  select jsonb_object_agg(rule.rule_key, rule.value)
  into rule_values
  from public.verification_rules rule;
  if rule_values is null then
    raise exception 'Verification rules are unavailable.';
  end if;

  select * into profile_row
  from public.profiles profile
  where profile.id = p_profile_id;
  if not found then
    raise exception 'Profile is unavailable.';
  end if;

  select auth_user.created_at, (auth_user.email_confirmed_at is not null
      or auth_user.phone_confirmed_at is not null)
  into account_created_at, contact_confirmed
  from auth.users auth_user
  where auth_user.id = p_profile_id;
  account_age_days := greatest(0, floor(extract(epoch from (now() - account_created_at)) / 86400)::integer);

  age_min := (rule_values ->> 'min_account_age_days')::integer;
  posts_min := (rule_values ->> 'min_published_posts')::integer;
  followers_min := (rule_values ->> 'min_qualified_followers')::integer;
  likes_min := (rule_values ->> 'min_total_likes_received')::integer;
  active_min := (rule_values ->> 'min_active_days_last_30')::integer;
  profile_required := (rule_values ->> 'require_profile_complete')::boolean;
  contact_required := (rule_values ->> 'require_email_confirmed')::boolean;
  reports_max := (rule_values ->> 'max_upheld_reports_90d')::integer;
  bans_max := (rule_values ->> 'max_community_bans')::integer;
  follower_age_min := (rule_values ->> 'min_qualified_follower_account_age_days')::integer;
  follower_avatar_required := (rule_values ->> 'qualified_follower_requires_avatar')::boolean;
  following_min := (rule_values ->> 'min_following_for_qualified_engagement')::integer;

  select count(*) into published_posts
  from public.posts post
  where post.author_id = p_profile_id and post.status = 'published' and post.published_at is not null;

  select count(*) into qualified_followers
  from public.follows follow
  join public.profiles follower on follower.id = follow.follower_id
  join auth.users follower_auth on follower_auth.id = follower.id
  where follow.following_id = p_profile_id and follow.status = 'accepted'
    and follower_auth.created_at <= now() - make_interval(days => follower_age_min)
    and (not follower_avatar_required or nullif(btrim(follower.avatar_url), '') is not null)
    and not exists (
      select 1 from public.verification_flags flag where flag.profile_id = follower.id
    )
    and (select count(*) from public.follows reciprocal
      where reciprocal.follower_id = follower.id and reciprocal.status = 'accepted') >= following_min;

  select count(*) into qualified_likes
  from public.post_likes post_like
  join public.posts post on post.id = post_like.post_id
  join public.profiles liker on liker.id = post_like.user_id
  where post.author_id = p_profile_id and post.status = 'published'
    and post_like.user_id <> p_profile_id
    and not exists (
      select 1 from public.verification_flags flag where flag.profile_id = liker.id
    )
    and (select count(*) from public.follows engagement_follow
      where engagement_follow.follower_id = liker.id and engagement_follow.status = 'accepted') >= following_min;

  select count(distinct activity.day)::integer into active_days
  from (
    select post.published_at::date as day
    from public.posts post
    where post.author_id = p_profile_id and post.status = 'published'
      and post.published_at >= now() - interval '30 days'
    union
    select comment.created_at::date
    from public.comments comment
    where comment.author_id = p_profile_id and comment.deleted_at is null
      and comment.created_at >= now() - interval '30 days'
    union
    select story.created_at::date
    from public.stories story
    where story.author_id = p_profile_id and story.deleted_at is null
      and story.created_at >= now() - interval '30 days'
  ) activity;

  select count(*) into actioned_reports
  from public.reports report
  where report.target_type = 'profile' and report.target_id = p_profile_id
    and report.moderation_status = 'actioned'
    and report.created_at >= now() - interval '90 days';

  select (
    (select count(*) from public.community_members member
     where member.user_id = p_profile_id and member.status = 'banned')
    + (select count(*) from public.live_bans ban
       where ban.user_id = p_profile_id and (ban.expires_at is null or ban.expires_at > now()))
  )::integer into community_bans;

  profile_complete := nullif(btrim(profile_row.avatar_url), '') is not null
    and nullif(btrim(profile_row.bio), '') is not null;

  rule_results := jsonb_build_object(
    'min_account_age_days', jsonb_build_object('observed', account_age_days, 'required', age_min, 'passed', account_age_days >= age_min),
    'min_published_posts', jsonb_build_object('observed', published_posts, 'required', posts_min, 'passed', published_posts >= posts_min),
    'min_qualified_followers', jsonb_build_object('observed', qualified_followers, 'required', followers_min, 'passed', qualified_followers >= followers_min),
    'min_total_likes_received', jsonb_build_object('observed', qualified_likes, 'required', likes_min, 'passed', qualified_likes >= likes_min),
    'min_active_days_last_30', jsonb_build_object('observed', active_days, 'required', active_min, 'passed', active_days >= active_min),
    'require_profile_complete', jsonb_build_object('observed', profile_complete, 'required', profile_required, 'passed', not profile_required or profile_complete),
    'require_email_confirmed', jsonb_build_object('observed', contact_confirmed, 'required', contact_required, 'passed', not contact_required or contact_confirmed),
    'max_upheld_reports_90d', jsonb_build_object('observed', actioned_reports, 'required', reports_max, 'passed', actioned_reports <= reports_max),
    'max_community_bans', jsonb_build_object('observed', community_bans, 'required', bans_max, 'passed', community_bans <= bans_max)
  );

  select count(*) filter (where (result.value ->> 'passed')::boolean),
         count(*)
  into passed_count, active_rule_count
  from jsonb_each(rule_results) result
  join public.verification_rules rule on rule.rule_key = result.key and rule.enabled;

  return query select
    coalesce(passed_count::numeric / nullif(active_rule_count, 0), 0),
    coalesce(passed_count = active_rule_count and active_rule_count > 0, false),
    rule_results;
end;
$$;
revoke all on function public.evaluate_verification(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_verification(uuid) to service_role;

create function public.admin_grant_badge(
  p_username text,
  p_badge text default 'verified',
  p_note text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_id uuid;
begin
  select profile.id into target_id from public.profiles profile
  where profile.username = lower(btrim(p_username));
  if target_id is null then raise exception 'Profile not found.'; end if;
  if not exists (select 1 from public.badge_types where key = p_badge) then
    raise exception 'Badge type not found.';
  end if;
  delete from public.badge_suppressions where profile_id = target_id and badge_key = p_badge;
  insert into public.profile_badges (profile_id, badge_key, source, granted_by, expires_at, note)
  values (target_id, p_badge, 'manual', 'owner', p_expires_at, p_note)
  on conflict (profile_id, badge_key) do update
    set source = 'manual', granted_at = now(), granted_by = 'owner',
        expires_at = excluded.expires_at, note = excluded.note;
end;
$$;

create function public.admin_revoke_badge(
  p_username text,
  p_badge text default 'verified',
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_id uuid;
begin
  select profile.id into target_id from public.profiles profile
  where profile.username = lower(btrim(p_username));
  if target_id is null then raise exception 'Profile not found.'; end if;
  insert into public.badge_suppressions (profile_id, badge_key, suppressed_by, reason)
  values (target_id, p_badge, 'owner', p_note)
  on conflict (profile_id, badge_key) do update
    set suppressed_by = excluded.suppressed_by, reason = excluded.reason, created_at = now();
  delete from public.profile_badges where profile_id = target_id and badge_key = p_badge;
end;
$$;

create function public.admin_clear_badge_suppression(p_username text, p_badge text default 'verified')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target_id uuid;
begin
  select profile.id into target_id from public.profiles profile
  where profile.username = lower(btrim(p_username));
  if target_id is null then raise exception 'Profile not found.'; end if;
  delete from public.badge_suppressions where profile_id = target_id and badge_key = p_badge;
end;
$$;

create function public.admin_list_badges(p_username text default null)
returns table (
  username text,
  badge_key text,
  label text,
  source text,
  granted_at timestamptz,
  expires_at timestamptz,
  granted_by text,
  note text
)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select profile.username, badge.badge_key, badge_type.label, badge.source,
         badge.granted_at, badge.expires_at, badge.granted_by, badge.note
  from public.profile_badges badge
  join public.profiles profile on profile.id = badge.profile_id
  join public.badge_types badge_type on badge_type.key = badge.badge_key
  where (p_username is null or profile.username = lower(btrim(p_username)))
    and (badge.expires_at is null or badge.expires_at > now())
  order by profile.username, badge_type.sort_order, badge.badge_key;
$$;

create function public.admin_verification_report(p_username text)
returns table (username text, score numeric, passed boolean, reasons jsonb, evaluated_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select profile.username, evaluation.score, evaluation.passed, evaluation.reasons, evaluation.evaluated_at
  from public.profiles profile
  join public.verification_evaluations evaluation on evaluation.profile_id = profile.id
  where profile.username = lower(btrim(p_username));
$$;

create function public.run_verification_evaluation(p_batch integer default 500)
returns table (evaluated integer, granted integer, revoked integer, expired integer)
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  target record;
  result record;
  current_badge public.profile_badges%rowtype;
  batch_size integer := greatest(1, least(coalesce(p_batch, 500), 2000));
  evaluated_count integer := 0;
  granted_count integer := 0;
  revoked_count integer := 0;
  expired_count integer := 0;
  should_revoke boolean;
begin
  for target in
    select candidate.profile_id as id
    from (
      select queue.profile_id, queue.queued_at as order_at, 0 as source_order
      from public.verification_queue queue
      union all
      select evaluation.profile_id, evaluation.evaluated_at as order_at, 1 as source_order
      from public.verification_evaluations evaluation
      where evaluation.evaluated_at < now() - interval '1 day'
        and not exists (
          select 1 from public.verification_queue queue
          where queue.profile_id = evaluation.profile_id
        )
    ) candidate
    order by candidate.source_order, candidate.order_at, candidate.profile_id
    limit batch_size
  loop
    delete from public.verification_queue queue where queue.profile_id = target.id;
    select * into result from public.evaluate_verification(target.id);
    insert into public.verification_evaluations (profile_id, score, passed, reasons, evaluated_at)
    values (target.id, result.score, result.passed, result.reasons, now())
    on conflict (profile_id) do update
      set score = excluded.score, passed = excluded.passed,
          reasons = excluded.reasons, evaluated_at = excluded.evaluated_at;
    evaluated_count := evaluated_count + 1;

    select * into current_badge
    from public.profile_badges badge
    where badge.profile_id = target.id and badge.badge_key = 'verified';

    if not found then
      if result.passed and not exists (
        select 1 from public.badge_suppressions suppression
        where suppression.profile_id = target.id and suppression.badge_key = 'verified'
      ) then
        insert into public.profile_badges (profile_id, badge_key, source, granted_by)
        values (target.id, 'verified', 'auto', 'auto-evaluator');
        granted_count := granted_count + 1;
      end if;
    elsif current_badge.source = 'auto' and not result.passed then
      should_revoke :=
        not coalesce((result.reasons -> 'max_upheld_reports_90d' ->> 'passed')::boolean, true)
        or not coalesce((result.reasons -> 'max_community_bans' ->> 'passed')::boolean, true)
        or coalesce((result.reasons -> 'min_qualified_followers' ->> 'observed')::numeric, 0)
          < coalesce((result.reasons -> 'min_qualified_followers' ->> 'required')::numeric, 0) * 0.8
        or coalesce((result.reasons -> 'min_total_likes_received' ->> 'observed')::numeric, 0)
          < coalesce((result.reasons -> 'min_total_likes_received' ->> 'required')::numeric, 0) * 0.8;
      if should_revoke then
        delete from public.profile_badges
        where profile_id = target.id and badge_key = 'verified' and source = 'auto';
        revoked_count := revoked_count + 1;
      end if;
    end if;
  end loop;

  with expired_badges as (
    select badge.profile_id, badge.badge_key
    from public.profile_badges badge
    where badge.expires_at is not null and badge.expires_at <= now()
    order by badge.expires_at
    limit batch_size
  )
  delete from public.profile_badges badge
  using expired_badges expired
  where badge.profile_id = expired.profile_id and badge.badge_key = expired.badge_key;
  get diagnostics expired_count = row_count;

  return query select evaluated_count, granted_count, revoked_count, expired_count;
end;
$$;

revoke all on function public.admin_grant_badge(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_revoke_badge(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_clear_badge_suppression(text, text) from public, anon, authenticated;
revoke all on function public.admin_list_badges(text) from public, anon, authenticated;
revoke all on function public.admin_verification_report(text) from public, anon, authenticated;
revoke all on function public.run_verification_evaluation(integer) from public, anon, authenticated;
grant execute on function public.admin_grant_badge(text, text, text, timestamptz) to service_role;
grant execute on function public.admin_revoke_badge(text, text, text) to service_role;
grant execute on function public.admin_clear_badge_suppression(text, text) to service_role;
grant execute on function public.admin_list_badges(text) to service_role;
grant execute on function public.admin_verification_report(text) to service_role;
grant execute on function public.run_verification_evaluation(integer) to service_role;

create or replace function public.get_feed(
  mode text,
  cursor_published_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 10
)
returns table (
  post jsonb,
  author jsonb,
  is_liked boolean,
  is_saved boolean,
  is_following boolean
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
  result_limit integer := coalesce(get_feed.page_size, 10);
begin
  if viewer_id is null then raise exception 'Sign in to load the feed.'; end if;
  if get_feed.mode not in ('for_you', 'following') then raise exception 'Invalid feed mode.'; end if;
  if result_limit < 1 or result_limit > 50 then raise exception 'Invalid page size.'; end if;

  return query
  with candidate_pool as not materialized (
    select post.*
    from public.posts post
    join public.profiles author on author.id = post.author_id
    where post.status = 'published'
      and post.author_id <> viewer_id
      and (get_feed.cursor_published_at is null
        or (post.published_at, post.id) < (get_feed.cursor_published_at, get_feed.cursor_id))
      and not exists (
        select 1 from public.blocks block
        where (block.blocker_id = viewer_id and block.blocked_id = post.author_id)
          or (block.blocker_id = post.author_id and block.blocked_id = viewer_id)
      )
      and (
        (post.audience = 'everyone' and not author.is_private)
        or exists (
          select 1 from public.follows follow
          where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted'
        )
      )
      and (
        get_feed.mode = 'for_you'
        or exists (
          select 1 from public.follows follow
          where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted'
        )
      )
    order by post.published_at desc, post.id desc
  ),
  unseen as materialized (
    select candidate.*
    from candidate_pool candidate
    where get_feed.mode = 'following'
      or not exists (select 1 from public.post_views view_row
        where view_row.post_id = candidate.id and view_row.user_id = viewer_id)
    order by candidate.published_at desc, candidate.id desc
    limit result_limit
  ),
  unseen_count as (select count(*)::integer as count from unseen),
  seen_fill as (
    select candidate.*
    from candidate_pool candidate
    where get_feed.mode = 'for_you'
      and (select count from unseen_count) < result_limit
      and exists (select 1 from public.post_views view_row
        where view_row.post_id = candidate.id and view_row.user_id = viewer_id)
      and not exists (select 1 from unseen row_seen where row_seen.id = candidate.id)
    order by candidate.published_at desc, candidate.id desc
    limit greatest(0, result_limit - (select count from unseen_count))
  ),
  selected as (select * from unseen union all select * from seen_fill)
  select
    to_jsonb(post),
    jsonb_build_object(
      'username', author.username,
      'display_name', author.display_name,
      'avatar_url', author.avatar_url,
      'is_verified', author.is_verified
    ),
    exists (select 1 from public.post_likes post_like
      where post_like.post_id = post.id and post_like.user_id = viewer_id),
    exists (select 1 from public.post_saves saved
      where saved.post_id = post.id and saved.user_id = viewer_id),
    exists (select 1 from public.follows follow
      where follow.follower_id = viewer_id and follow.following_id = post.author_id and follow.status = 'accepted')
  from selected post
  join public.profiles author on author.id = post.author_id
  order by post.published_at desc, post.id desc
  limit result_limit;
end;
$$;
revoke all on function public.get_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_feed(text, timestamptz, uuid, integer) to authenticated;

revoke insert, update on public.profiles from authenticated;
grant insert (id, username, display_name, avatar_url, bio, link, date_of_birth, dm_policy)
  on public.profiles to authenticated;
grant update (id, username, display_name, avatar_url, bio, link, date_of_birth, dm_policy)
  on public.profiles to authenticated;
