begin;

select extensions.plan(26);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'community-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'community-member@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'community-moderator@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'community-other-moderator@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'community-private-requester@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'community-minor@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'community-cap-owner@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('93000000-0000-4000-8000-000000000001', 'community_owner', 'Community Owner', '1990-01-01', false),
  ('93000000-0000-4000-8000-000000000002', 'community_member', 'Community Member', '1990-01-01', false),
  ('93000000-0000-4000-8000-000000000003', 'community_moderator', 'Community Moderator', '1990-01-01', false),
  ('93000000-0000-4000-8000-000000000004', 'community_other_mod', 'Community Other Moderator', '1990-01-01', false),
  ('93000000-0000-4000-8000-000000000005', 'community_requester', 'Community Requester', '1990-01-01', false),
  ('93000000-0000-4000-8000-000000000006', 'community_minor', 'Community Minor', '2012-01-01', true),
  ('93000000-0000-4000-8000-000000000007', 'community_cap_owner', 'Community Cap Owner', '1990-01-01', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

select public.create_community(
  'community-core-public', 'Core Public', 'A public test community.', 'Music', 'public', false, '["Be kind"]'
);
select public.create_community(
  'community-core-private', 'Core Private', 'A private test community.', 'Art', 'private', false, '[]'
);
select public.create_community(
  'community-core-adults', 'Core Adults', 'An adults only test community.', 'Learning', 'public', true, '[]'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.join_community((select id from public.communities where slug = 'community-core-public')),
  'active',
  'public community joins are immediate'
);
select extensions.throws_ok(
  $$select public.ban_member(
    (select id from public.communities where slug = 'community-core-public'),
    '93000000-0000-4000-8000-000000000001'
  )$$,
  'Only community moderators can ban members.',
  'members cannot ban community members'
);
select extensions.throws_ok(
  $$select public.respond_join_request(
    (select id from public.communities where slug = 'community-core-private'),
    '93000000-0000-4000-8000-000000000005',
    true
  )$$,
  'Only community moderators can manage requests.',
  'only an owner or moderator can respond to a join request'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
select public.join_community((select id from public.communities where slug = 'community-core-public'));
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select public.set_member_role(
  (select id from public.communities where slug = 'community-core-public'),
  '93000000-0000-4000-8000-000000000003',
  'moderator'
);
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000004', true);
select public.join_community((select id from public.communities where slug = 'community-core-public'));
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select public.set_member_role(
  (select id from public.communities where slug = 'community-core-public'),
  '93000000-0000-4000-8000-000000000004',
  'moderator'
);

select extensions.is(
  (select member_count from public.communities where slug = 'community-core-public'),
  4,
  'active member count is maintained by a trigger'
);
select extensions.throws_ok(
  $$update public.communities set member_count = 90
    where slug = 'community-core-public'$$,
  '42501',
  null,
  'clients cannot write community counters'
);
select extensions.throws_ok(
  $$insert into public.community_members (community_id, user_id)
    select id, '93000000-0000-4000-8000-000000000005'
    from public.communities where slug = 'community-core-public'$$,
  '42501',
  null,
  'clients cannot write community membership rows directly'
);
select extensions.throws_ok(
  $$select public.leave_community(
    (select id from public.communities where slug = 'community-core-public')
  )$$,
  'Transfer ownership before you leave.',
  'the owner must transfer ownership before leaving'
);
select extensions.throws_ok(
  $$select public.delete_community(
    (select id from public.communities where slug = 'community-core-public')
  )$$,
  'Only the owner can delete this community.',
  'moderators cannot delete communities'
);
select extensions.throws_ok(
  $$select public.ban_member(
    (select id from public.communities where slug = 'community-core-public'),
    '93000000-0000-4000-8000-000000000001'
  )$$,
  'You cannot ban this member.',
  'moderators cannot ban the owner'
);
select extensions.throws_ok(
  $$select public.ban_member(
    (select id from public.communities where slug = 'community-core-public'),
    '93000000-0000-4000-8000-000000000004'
  )$$,
  'You cannot ban this member.',
  'moderators cannot ban another moderator'
);
select public.ban_member(
  (select id from public.communities where slug = 'community-core-public'),
  '93000000-0000-4000-8000-000000000002'
);
select extensions.is(
  (select member_count from public.communities where slug = 'community-core-public'),
  3,
  'banning a member decrements the active member count'
);
select public.unban_member(
  (select id from public.communities where slug = 'community-core-public'),
  '93000000-0000-4000-8000-000000000002'
);
select extensions.is(
  (select status from public.community_members
    where community_id = (select id from public.communities where slug = 'community-core-public')
      and user_id = '93000000-0000-4000-8000-000000000002'),
  'active',
  'unbanning restores active membership'
);
select extensions.is(
  (select member_count from public.communities where slug = 'community-core-public'),
  4,
  'unbanning restores the active member count'
);
select extensions.throws_ok(
  $$select public.transfer_ownership(
    (select id from public.communities where slug = 'community-core-public'),
    '93000000-0000-4000-8000-000000000002'
  )$$,
  'Only the owner can transfer ownership.',
  'only the owner can transfer ownership'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000005', true);
select extensions.is(
  public.join_community((select id from public.communities where slug = 'community-core-private')),
  'pending',
  'private community join requests start as pending'
);
select extensions.is(
  (select status from public.community_members
    where user_id = auth.uid()
      and community_id = (select id from public.communities where slug = 'community-core-private')),
  'pending',
  'private community request status is stored'
);
select extensions.is(
  (select description from public.get_community('community-core-private')),
  null::text,
  'private community details are hidden from nonmembers'
);
select extensions.throws_ok(
  $$select * from public.get_community_members('community-core-private')$$,
  'Community not found.',
  'private community members are hidden from nonmembers'
);
select extensions.ok(
  exists (
    select 1 from public.discover_communities(null, 'Core Private')
    where slug = 'community-core-private'
      and description = ''
      and member_count = 1
  ),
  'private communities are discoverable with limited fields'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select public.respond_join_request(
  (select id from public.communities where slug = 'community-core-private'),
  '93000000-0000-4000-8000-000000000005',
  true
);
select extensions.is(
  (select status from public.community_members
    where user_id = '93000000-0000-4000-8000-000000000005'
      and community_id = (select id from public.communities where slug = 'community-core-private')),
  'active',
  'the community owner can approve a join request'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000006', true);
select extensions.ok(
  not exists (
    select 1 from public.discover_communities()
    where slug = 'community-core-adults'
  ),
  'minors cannot discover adults only communities'
);
select extensions.throws_ok(
  $$select public.join_community(
    (select id from public.communities where slug = 'community-core-adults')
  )$$,
  'This community is for adults only.',
  'minors cannot join adults only communities'
);
select extensions.throws_ok(
  $$select public.create_community(
    'minor-adults-club', 'Minor Adults Club', '', 'Other', 'public', true, '[]'
  )$$,
  'Only adults can create adults only communities.',
  'minors cannot create adults only communities'
);
select extensions.is(
  (select count(*) from public.get_community('community-core-adults')),
  0::bigint,
  'minors cannot open adults only communities by deep link'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.invite_member(
    (select id from public.communities where slug = 'community-core-adults'),
    '93000000-0000-4000-8000-000000000006'
  )$$,
  'This community is for adults only.',
  'minors cannot be invited to adults only communities'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000007', true);
select public.create_community('cap-first', 'Cap First', '', 'Other', 'public');
select public.create_community('cap-second', 'Cap Second', '', 'Other', 'public');
select public.create_community('cap-third', 'Cap Third', '', 'Other', 'public');
select public.create_community('cap-fourth', 'Cap Fourth', '', 'Other', 'public');
select public.create_community('cap-fifth', 'Cap Fifth', '', 'Other', 'public');
select extensions.throws_ok(
  $$select public.create_community('cap-sixth', 'Cap Sixth', '', 'Other', 'public')$$,
  'You can create up to 5 communities.',
  'community creation is limited to five owned communities'
);

select * from extensions.finish();
rollback;
