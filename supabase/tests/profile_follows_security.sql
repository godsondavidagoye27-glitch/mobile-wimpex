begin;

select extensions.plan(30);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'profile-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'profile-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'profile-outsider@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'profile-minor@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('81000000-0000-4000-8000-000000000001', 'profile_follower', 'Follower', '1990-01-01', false),
  ('81000000-0000-4000-8000-000000000002', 'profile_owner', 'Owner', '1990-01-01', true),
  ('81000000-0000-4000-8000-000000000003', 'profile_outsider', 'Outsider', '1990-01-01', false),
  ('81000000-0000-4000-8000-000000000004', 'profile_minor', 'Minor', '2012-01-01', true);

update public.profiles
set username_changed_at = now()
where id = '81000000-0000-4000-8000-000000000002';

insert into public.user_settings (user_id, show_liked_videos)
values ('81000000-0000-4000-8000-000000000002', false);

insert into public.posts (
  id, author_id, caption, audience, status, published_at
)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'Private profile video', 'everyone', 'published', now()),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'Follower video', 'everyone', 'published', now()),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', 'Pin test one', 'everyone', 'published', now()),
  ('82000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000002', 'Pin test two', 'everyone', 'published', now()),
  ('82000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000002', 'Pin test three', 'everyone', 'published', now()),
  ('82000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000002', 'Pin test four', 'everyone', 'published', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

select extensions.is(
  public.follow_user('81000000-0000-4000-8000-000000000002'),
  'pending',
  'following a private profile creates a pending request'
);
select extensions.is(
  (select following_count from public.profiles where id = auth.uid()),
  0,
  'pending requests do not increment the follower count'
);
select extensions.is(
  (select followers_count from public.profiles where id = '81000000-0000-4000-8000-000000000002'),
  0,
  'pending requests do not increment the followed profile count'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (select count(*) from public.get_follow_requests()),
  0::bigint,
  'a third party cannot read another profile owner''s follow requests'
);
select extensions.throws_ok(
  $$select public.respond_follow_request(
    '81000000-0000-4000-8000-000000000001',
    true
  )$$,
  'a third party cannot accept another profile owner''s follow request'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select count(*) from public.get_follow_requests()),
  1::bigint,
  'the profile owner can read their pending follow request'
);
select public.respond_follow_request('81000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select following_count from public.profiles where id = '81000000-0000-4000-8000-000000000001'),
  1,
  'accepting a request increments the follower''s following count'
);
select extensions.is(
  (select followers_count from public.profiles where id = auth.uid()),
  1,
  'accepting a request increments the profile owner''s follower count'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*) from public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'liked'
  )),
  0::bigint,
  'liked videos stay hidden until the profile owner enables sharing'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
insert into public.post_likes (post_id, user_id)
values ('82000000-0000-4000-8000-000000000002', auth.uid());
update public.user_settings set show_liked_videos = true where user_id = auth.uid();
insert into public.post_saves (post_id, user_id)
values ('82000000-0000-4000-8000-000000000002', auth.uid());
select extensions.is(
  (select count(*) from public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'saved'
  )),
  1::bigint,
  'a profile owner can read their own saved videos'
);
select extensions.is(
  (select count(*) from public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'liked'
  )),
  1::bigint,
  'liked videos are visible after the profile owner enables sharing'
);
select public.pin_post('82000000-0000-4000-8000-000000000003', true);
select public.pin_post('82000000-0000-4000-8000-000000000004', true);
select public.pin_post('82000000-0000-4000-8000-000000000005', true);
select extensions.is(
  (select count(*) from public.posts where author_id = auth.uid() and pinned_at is not null),
  3::bigint,
  'a profile can have three pinned videos'
);
select extensions.throws_ok(
  $$select public.pin_post('82000000-0000-4000-8000-000000000006', true)$$,
  'a profile cannot pin a fourth video'
);
select public.pin_post('82000000-0000-4000-8000-000000000003', false);
select public.pin_post('82000000-0000-4000-8000-000000000006', true);
select extensions.is(
  (select count(*) from public.posts where author_id = auth.uid() and pinned_at is not null),
  3::bigint,
  'unpinning a video makes room for another pin'
);
select extensions.throws_ok(
  $$update public.profiles set username = 'owner_new' where id = auth.uid()$$,
  'a username cannot be changed during the cooldown'
);
select extensions.throws_ok(
  $$update public.profiles set followers_count = 99 where id = auth.uid()$$,
  'a client cannot write profile counters'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.is_username_available('admin'),
  false,
  'reserved usernames are reported as unavailable'
);
select extensions.is(
  public.is_username_available('unique_profile_handle'),
  true,
  'an unused non-reserved username is available'
);
select extensions.throws_ok(
  $$update public.profiles set username = 'admin' where id = auth.uid()$$,
  'reserved usernames cannot be saved'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.set_account_privacy(false)$$,
  'an under-18 profile cannot be made public'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'saved'
  )$$,
  'another account cannot read a profile owner''s saved videos'
);
select extensions.is(
  (select count(*) from public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'liked'
  )),
  1::bigint,
  'a follower can read liked videos only when the owner shares them'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select public.block_user('81000000-0000-4000-8000-000000000001');
select extensions.is(
  (select followers_count from public.profiles where id = auth.uid()),
  0,
  'blocking a follower removes the accepted follow and decrements the owner count'
);
select extensions.is(
  (select following_count from public.profiles where id = '81000000-0000-4000-8000-000000000001'),
  0,
  'blocking removes the reciprocal following count'
);
select extensions.is(
  (select count(*) from public.blocks where blocker_id = auth.uid()),
  1::bigint,
  'the blocker can read their own block entry'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*) from public.get_profile('profile_owner')),
  0::bigint,
  'a blocked viewer cannot read the blocked profile'
);
select extensions.is(
  (select count(*) from public.get_profile_posts(
    '81000000-0000-4000-8000-000000000002',
    'posts'
  )),
  0::bigint,
  'a blocked viewer cannot read the blocked profile''s posts'
);
select extensions.throws_ok(
  $$select public.follow_user('81000000-0000-4000-8000-000000000002')$$,
  'a blocked viewer cannot follow the blocked profile again'
);
select extensions.throws_ok(
  $$insert into public.follows (follower_id, following_id)
    values (auth.uid(), '81000000-0000-4000-8000-000000000002')$$,
  'row security prevents bypassing the blocked-follow check'
);
select extensions.throws_ok(
  $$select public.follow_user(auth.uid())$$,
  'a user cannot follow themselves'
);

select * from extensions.finish();
rollback;
