begin;

select extensions.plan(12);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notify-alice@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('51000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'notify-bob@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('51000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'notify-cara@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('51000000-0000-4000-8000-000000000001', 'notify_alice', 'Alice', '1990-01-01', false),
  ('51000000-0000-4000-8000-000000000002', 'notify_bob', 'Bob', '1990-01-01', false),
  ('51000000-0000-4000-8000-000000000003', 'notify_cara', 'Cara', '1990-01-01', false);

insert into public.posts (id, author_id, status, video_path, published_at)
values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'published',
  'notification-test.mp4',
  now()
);

insert into public.comments (id, post_id, author_id, body)
values (
  '53000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  'A top-level comment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);

insert into public.post_likes (post_id, user_id)
values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001');
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'like'),
  0::bigint,
  'liking your own post does not create a notification'
);

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
insert into public.post_likes (post_id, user_id)
values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002');
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'like'),
  1::bigint,
  'liking another account post notifies the owner'
);
insert into public.post_likes (post_id, user_id)
values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')
on conflict do nothing;
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'like'),
  1::bigint,
  'duplicate likes do not duplicate notification rows'
);

delete from public.post_likes
where post_id = '52000000-0000-4000-8000-000000000001'
  and user_id = '51000000-0000-4000-8000-000000000002';
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'like'),
  0::bigint,
  'unliking removes the matching like notification'
);

insert into public.post_likes (post_id, user_id)
values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002');
insert into public.comments (id, post_id, author_id, body)
values (
  '53000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  'Another comment'
);
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'like'),
  1::bigint,
  'a new like after unlike creates one fresh notification'
);
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'comment'),
  2::bigint,
  'each comment notifies the post owner'
);

reset role;
update public.profiles set is_private = true
where id = '51000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000003', true);
insert into public.comments (post_id, author_id, parent_id, body)
values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003',
  '53000000-0000-4000-8000-000000000001',
  'A reply'
);
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000002' and type = 'reply'),
  1::bigint,
  'a reply notifies the parent comment author'
);

insert into public.follows (follower_id, following_id)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001');
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'follow_request'),
  1::bigint,
  'following a private account creates a follow request notification'
);

reset role;
update public.profiles set is_private = false
where id = '51000000-0000-4000-8000-000000000001';
insert into public.follows (follower_id, following_id)
values ('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001');
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'follow'),
  1::bigint,
  'following a public account creates a follow notification'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001'),
  0::bigint,
  'users cannot read another account notification rows'
);
select extensions.throws_ok(
  $$insert into public.notifications (user_id, actor_id, type)
    values ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'follow')$$,
  'authenticated users cannot forge notification rows'
);

select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
update public.notifications set read_at = now()
where user_id = '51000000-0000-4000-8000-000000000001' and type = 'follow_request';
select extensions.is(
  (select count(*) from public.notifications where user_id = '51000000-0000-4000-8000-000000000001' and type = 'follow_request' and read_at is not null),
  1::bigint,
  'users can mark their own notifications as read'
);

select * from extensions.finish();
rollback;
