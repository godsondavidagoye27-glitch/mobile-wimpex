begin;

select extensions.plan(18);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'content-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'content-member@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'content-moderator@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'content-outsider@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'content-private-member@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('94000000-0000-4000-8000-000000000001', 'content_owner', 'Content Owner', '1990-01-01', false),
  ('94000000-0000-4000-8000-000000000002', 'content_member', 'Content Member', '1990-01-01', false),
  ('94000000-0000-4000-8000-000000000003', 'content_mod', 'Content Moderator', '1990-01-01', false),
  ('94000000-0000-4000-8000-000000000004', 'content_outsider', 'Content Outsider', '1990-01-01', false),
  ('94000000-0000-4000-8000-000000000005', 'content_private', 'Private Member', '1990-01-01', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select public.create_community('content-public-test', 'Content Public', '', 'Tech', 'public');
select public.create_community('content-private-test', 'Content Private', '', 'Art', 'private');

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select public.join_community((select id from public.communities where slug = 'content-public-test'));
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select public.join_community((select id from public.communities where slug = 'content-public-test'));
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select public.set_member_role(
  (select id from public.communities where slug = 'content-public-test'),
  '94000000-0000-4000-8000-000000000003',
  'moderator'
);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000005', true);
select public.join_community((select id from public.communities where slug = 'content-private-test'));
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select public.respond_join_request(
  (select id from public.communities where slug = 'content-private-test'),
  '94000000-0000-4000-8000-000000000005',
  true
);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select public.create_community_post(
  (select id from public.communities where slug = 'content-private-test'),
  'Visible only to private community members'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select set_config(
  'test.community_post_id',
  public.create_community_post(
    (select id from public.communities where slug = 'content-public-test'),
    'Member-created public post'
  )::text,
  true
);
select extensions.is(
  (select post_count from public.communities where slug = 'content-public-test'),
  1,
  'creating a post updates the community post count'
);
select extensions.throws_ok(
  $$select public.moderate_community_post(current_setting('test.community_post_id')::uuid, 'pin')$$,
  'Only community managers can moderate posts.',
  'ordinary members cannot pin or remove posts'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select public.moderate_community_post(current_setting('test.community_post_id')::uuid, 'pin')$$,
  'a community moderator can pin a post'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (select count(*)::integer
   from public.get_community_posts((select id from public.communities where slug = 'content-public-test'))),
  1,
  'nonmembers can view posts in a public community'
);
select extensions.throws_ok(
  $$select * from public.get_community_posts(
      (select id from public.communities where slug = 'content-private-test')
    )$$,
  'You cannot view this community.',
  'nonmembers cannot view private community posts'
);
select set_config(
  'test.community_report_id',
  public.report_community_post(current_setting('test.community_post_id')::uuid, 'spam')::text,
  true
);
select extensions.is(
  public.report_community_post(current_setting('test.community_post_id')::uuid, 'spam')::text,
  current_setting('test.community_report_id'),
  'repeated reports by the same person return one open report'
);
select extensions.throws_ok(
  $$select * from public.get_community_post_reports(
      (select id from public.communities where slug = 'content-public-test')
    )$$,
  'Only community managers can view reports.',
  'nonmanagers cannot read moderation reports'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (select count(*)::integer
   from public.get_community_post_reports((select id from public.communities where slug = 'content-public-test'))),
  1,
  'moderators can review reports for their community'
);
select extensions.lives_ok(
  $$select public.resolve_community_post_report(current_setting('test.community_report_id')::uuid)$$,
  'moderators can resolve a post report'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (select count(*)::integer
   from public.community_messages
   where community_id = (select id from public.communities where slug = 'content-public-test')),
  0,
  'public community nonmembers cannot query chat messages directly'
);
select extensions.throws_ok(
  $$select public.send_community_message(
      (select id from public.communities where slug = 'content-public-test'),
      'Not a member'
    )$$,
  'Active community membership is required to chat.',
  'nonmembers cannot send community chat messages'
);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select public.send_community_message(
      (select id from public.communities where slug = 'content-public-test'),
      'Visible to active members'
    )$$,
  'active members can send community chat messages'
);
select extensions.is(
  (select count(*)::integer
   from public.get_community_messages((select id from public.communities where slug = 'content-public-test'))),
  1,
  'active members can read synchronized community chat'
);
select public.leave_community((select id from public.communities where slug = 'content-public-test'));
select extensions.throws_ok(
  $$select * from public.get_community_messages(
      (select id from public.communities where slug = 'content-public-test')
    )$$,
  'Active community membership is required to read chat.',
  'departed members immediately lose chat access'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select public.moderate_community_post(current_setting('test.community_post_id')::uuid, 'remove')$$,
  'community owners can remove a post'
);
select extensions.is(
  (select count(*)::integer
   from public.get_community_posts((select id from public.communities where slug = 'content-public-test'))),
  0,
  'removed posts are no longer visible'
);
select extensions.is(
  (select post_count from public.communities where slug = 'content-public-test'),
  0,
  'removing a post decrements the community post count'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000005', true);
select extensions.is(
  (select count(*)::integer
   from public.get_community_posts((select id from public.communities where slug = 'content-private-test'))),
  1,
  'active members can view the private community post feed'
);

select * from extensions.finish();
rollback;
