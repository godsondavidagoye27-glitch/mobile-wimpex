begin;

select extensions.plan(41);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('83000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'badge-viewer@test.invalid', '', now(), '{}', '{}', now() - interval '90 days', now()),
  ('83000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'badge-owner@test.invalid', '', now(), '{}', '{}', now() - interval '90 days', now());

insert into public.profiles (id, username, display_name, date_of_birth, avatar_url, bio)
values
  ('83000000-0000-4000-8000-000000000001', 'badge_viewer', 'Badge Viewer', '1990-01-01', 'https://example.invalid/a.png', 'hello'),
  ('83000000-0000-4000-8000-000000000002', 'badge_owner', 'Badge Owner', '1990-01-01', 'https://example.invalid/b.png', 'hello');

insert into public.follows (follower_id, following_id, status)
values ('83000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'accepted');
insert into public.posts (id, author_id, caption, status, published_at)
values ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'Badge test post', 'published', now());
insert into public.post_likes (post_id, user_id)
values ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002');

update public.verification_rules set value = case rule_key
  when 'min_account_age_days' then '45'::jsonb
  when 'min_published_posts' then '1'::jsonb
  when 'min_qualified_followers' then '1'::jsonb
  when 'min_total_likes_received' then '1'::jsonb
  when 'min_active_days_last_30' then '1'::jsonb
  when 'require_profile_complete' then 'true'::jsonb
  when 'require_email_confirmed' then 'true'::jsonb
  when 'max_upheld_reports_90d' then '0'::jsonb
  when 'max_community_bans' then '0'::jsonb
  when 'min_qualified_follower_account_age_days' then '14'::jsonb
  when 'qualified_follower_requires_avatar' then 'true'::jsonb
  when 'min_following_for_qualified_engagement' then '1'::jsonb
end, updated_at = now();

select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), true, 'evaluation passes when the test profile meets every rule');
update public.verification_rules set value = '9999'::jsonb where rule_key = 'min_account_age_days';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'account age is evaluated');
update public.verification_rules set value = '45'::jsonb where rule_key = 'min_account_age_days';
update public.verification_rules set value = '2'::jsonb where rule_key = 'min_published_posts';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'published post count is evaluated');
update public.verification_rules set value = '1'::jsonb where rule_key = 'min_published_posts';
update public.verification_rules set value = '2'::jsonb where rule_key = 'min_qualified_followers';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'qualified follower count is evaluated');
update public.verification_rules set value = '1'::jsonb where rule_key = 'min_qualified_followers';
update public.verification_rules set value = '2'::jsonb where rule_key = 'min_total_likes_received';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'received qualifying likes are evaluated');
update public.verification_rules set value = '1'::jsonb where rule_key = 'min_total_likes_received';
update public.verification_rules set value = '2'::jsonb where rule_key = 'min_active_days_last_30';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'active days are evaluated');
update public.verification_rules set value = '1'::jsonb where rule_key = 'min_active_days_last_30';
update public.profiles set bio = null where id = '83000000-0000-4000-8000-000000000001';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'profile completeness is evaluated');
update public.profiles set bio = 'hello' where id = '83000000-0000-4000-8000-000000000001';
update auth.users set email_confirmed_at = null, phone_confirmed_at = null
where id = '83000000-0000-4000-8000-000000000001';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'confirmed contact is evaluated');
update auth.users set email_confirmed_at = now()
where id = '83000000-0000-4000-8000-000000000001';
insert into public.reports (reporter_id, target_type, target_id, reason, moderation_status)
values ('83000000-0000-4000-8000-000000000002', 'profile', '83000000-0000-4000-8000-000000000001', 'test', 'actioned');
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'actioned reports are evaluated');
delete from public.reports where target_id = '83000000-0000-4000-8000-000000000001';
insert into public.communities (slug, name, category, owner_id)
values ('badge-test-community', 'Badge Test', 'Other', '83000000-0000-4000-8000-000000000001');
insert into public.community_members (community_id, user_id, role, status)
select id, '83000000-0000-4000-8000-000000000001', 'member', 'banned'
from public.communities where slug = 'badge-test-community';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'active community bans are evaluated');
delete from public.community_members where user_id = '83000000-0000-4000-8000-000000000001';
update public.verification_rules set value = '999'::jsonb
where rule_key = 'min_qualified_follower_account_age_days';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'follower account age is enforced');
update public.verification_rules set value = '14'::jsonb
where rule_key = 'min_qualified_follower_account_age_days';
update public.profiles set avatar_url = null where id = '83000000-0000-4000-8000-000000000002';
select is((select passed from public.evaluate_verification('83000000-0000-4000-8000-000000000001')), false, 'follower avatar requirement is enforced');
update public.profiles set avatar_url = 'https://example.invalid/b.png'
where id = '83000000-0000-4000-8000-000000000002';

select ok(not has_table_privilege('authenticated', 'public.profile_badges', 'INSERT'), 'authenticated cannot insert badges');
select ok(not has_table_privilege('authenticated', 'public.profile_badges', 'UPDATE'), 'authenticated cannot update badges');
select ok(not has_table_privilege('authenticated', 'public.profile_badges', 'DELETE'), 'authenticated cannot delete badges');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_verified', 'INSERT'), 'authenticated cannot insert the verified flag');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_verified', 'UPDATE'), 'authenticated cannot update the verified flag');
select ok(not has_table_privilege('authenticated', 'public.verification_rules', 'SELECT'), 'authenticated cannot read rules');
select ok(not has_table_privilege('authenticated', 'public.verification_evaluations', 'SELECT'), 'authenticated cannot read evaluations');
select ok(not has_table_privilege('authenticated', 'public.badge_audit_log', 'SELECT'), 'authenticated cannot read audit history');
select ok(not has_column_privilege('authenticated', 'public.reports', 'moderation_status', 'INSERT'), 'authenticated cannot set report moderation status');
select ok(not has_table_privilege('anon', 'public.profile_badges', 'SELECT'), 'anon cannot read badges');
select ok(not has_table_privilege('anon', 'public.verification_rules', 'SELECT'), 'anon cannot read rules');
select ok(not has_table_privilege('anon', 'public.verification_evaluations', 'SELECT'), 'anon cannot read evaluations');
select ok(not has_table_privilege('anon', 'public.badge_audit_log', 'SELECT'), 'anon cannot read audit history');
select ok(
  not has_function_privilege('authenticated', 'public.admin_grant_badge(text,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_revoke_badge(text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_clear_badge_suppression(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_list_badges(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_verification_report(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.evaluate_verification(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.run_verification_evaluation(integer)', 'EXECUTE'),
  'no admin or evaluation function is callable by authenticated users'
);
select ok(
  not has_function_privilege('anon', 'public.admin_grant_badge(text,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_revoke_badge(text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_clear_badge_suppression(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_list_badges(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_verification_report(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.evaluate_verification(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.run_verification_evaluation(integer)', 'EXECUTE'),
  'no admin or evaluation function is callable by anon users'
);
select ok(
  has_function_privilege('service_role', 'public.admin_grant_badge(text,text,text,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_revoke_badge(text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_clear_badge_suppression(text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_list_badges(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_verification_report(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.evaluate_verification(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.run_verification_evaluation(integer)', 'EXECUTE'),
  'service_role can use the admin and evaluation functions'
);
select ok(has_function_privilege('service_role', 'public.run_verification_evaluation(integer)', 'EXECUTE'), 'service_role can run evaluations');

select public.admin_grant_badge('badge_owner', 'verified');
select is((select is_verified from public.profiles where username = 'badge_owner'), true, 'grant trigger sets profiles.is_verified');
select is((select source from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 'manual', 'owner grant is manual');
set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 1::bigint, 'authenticated users can read public badges');
reset role;
set local role service_role;
select * from public.run_verification_evaluation(10);
reset role;
select is((select count(*) from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 1::bigint, 'evaluation never removes a manual grant');
select lives_ok($$select public.admin_revoke_badge('badge_owner', 'verified', 'test revoke')$$, 'owner revoke adds suppression');
select is((select is_verified from public.profiles where username = 'badge_owner'), false, 'revoke trigger clears profiles.is_verified');
select ok(exists (
  select 1 from public.badge_suppressions where profile_id = '83000000-0000-4000-8000-000000000002' and badge_key = 'verified'
), 'manual revoke suppresses automatic re-grant');
update public.verification_rules set value = case rule_key
  when 'min_account_age_days' then '0'::jsonb
  when 'min_published_posts' then '0'::jsonb
  when 'min_qualified_followers' then '0'::jsonb
  when 'min_total_likes_received' then '0'::jsonb
  when 'min_active_days_last_30' then '0'::jsonb
  when 'require_profile_complete' then 'false'::jsonb
  when 'require_email_confirmed' then 'false'::jsonb
  when 'max_upheld_reports_90d' then '999'::jsonb
  when 'max_community_bans' then '999'::jsonb
  when 'min_qualified_follower_account_age_days' then '0'::jsonb
  when 'qualified_follower_requires_avatar' then 'false'::jsonb
  when 'min_following_for_qualified_engagement' then '0'::jsonb
end, updated_at = now();
insert into public.verification_queue (profile_id)
values ('83000000-0000-4000-8000-000000000002')
on conflict (profile_id) do update set queued_at = now();
set local role service_role;
select * from public.run_verification_evaluation(10);
reset role;
select is((select count(*) from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 0::bigint, 'evaluation honors manual revoke suppression even when criteria pass');

select public.admin_grant_badge('badge_owner', 'verified', 'expiring', now() - interval '1 second');
set local role service_role;
select * from public.run_verification_evaluation(10);
reset role;
select is((select count(*) from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 0::bigint, 'evaluation removes expired badges');
select is((select is_verified from public.profiles where username = 'badge_owner'), false, 'expiry refreshes the denormalized flag');

insert into public.blocks (blocker_id, blocked_id)
values ('83000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001');
select public.admin_grant_badge('badge_owner', 'verified');
set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.profile_badges where profile_id = '83000000-0000-4000-8000-000000000002'), 0::bigint, 'blocked viewer cannot see profile badges');
select is((select count(*) from public.badge_types where key = 'verified'), 1::bigint, 'authenticated users can read active public badge types');
reset role;

select * from extensions.finish();
rollback;
