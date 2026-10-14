begin;

select extensions.plan(9);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('95200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'reply-author@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'reply-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'reply-outsider@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('95200000-0000-4000-8000-000000000001', 'reply_author', 'Reply Author', '1990-01-01', false),
  ('95200000-0000-4000-8000-000000000002', 'reply_follower', 'Reply Follower', '1990-01-01', false),
  ('95200000-0000-4000-8000-000000000003', 'reply_outsider', 'Reply Outsider', '1990-01-01', false);

insert into public.user_settings (user_id, story_replies)
values ('95200000-0000-4000-8000-000000000001', 'followers')
on conflict (user_id) do update set story_replies = excluded.story_replies;

insert into public.follows (follower_id, following_id, status)
values ('95200000-0000-4000-8000-000000000002', '95200000-0000-4000-8000-000000000001', 'accepted');

insert into public.stories (id, author_id, kind, media_path, caption, audience, duration_ms, width, height)
values (
  '95300000-0000-4000-8000-000000000001',
  '95200000-0000-4000-8000-000000000001',
  'image',
  '95200000-0000-4000-8000-000000000001/95300000-0000-4000-8000-000000000001.jpg',
  'A story preview',
  'everyone',
  5000,
  1080,
  1920
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95200000-0000-4000-8000-000000000002', true);

select extensions.is(
  public.can_reply_to_story('95300000-0000-4000-8000-000000000001'),
  true,
  'accepted followers may reply when the author allows follower replies'
);
select extensions.is(
  public.send_story_reply('95300000-0000-4000-8000-000000000001', 'Nice story!') is not null,
  true,
  'story replies create or reuse a direct conversation'
);
select extensions.is(
  (select count(*) from public.messages where story_reply_story_id = '95300000-0000-4000-8000-000000000001'),
  1::bigint,
  'story reply metadata is attached to the chat message'
);
select extensions.is(
  (select story_reply_preview_path from public.messages where story_reply_story_id = '95300000-0000-4000-8000-000000000001'),
  '95200000-0000-4000-8000-000000000001/95300000-0000-4000-8000-000000000001.jpg',
  'the story reply preserves a media preview path'
);
select extensions.is(
  (select story_reply_caption from public.messages where story_reply_story_id = '95300000-0000-4000-8000-000000000001'),
  'A story preview',
  'the story reply preserves the original caption'
);

select set_config('request.jwt.claim.sub', '95200000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.can_reply_to_story('95300000-0000-4000-8000-000000000001'),
  false,
  'non-followers cannot reply when the author allows followers only'
);
select extensions.throws_ok(
  $$select public.send_story_reply('95300000-0000-4000-8000-000000000001', 'Unauthorized reply')$$,
  'You cannot reply to this story.',
  'the server rejects disallowed story replies'
);

reset role;
update public.user_settings set story_replies = 'off'
where user_id = '95200000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '95200000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.can_reply_to_story('95300000-0000-4000-8000-000000000001'),
  false,
  'authors can disable all story replies'
);

select set_config('request.jwt.claim.sub', '95200000-0000-4000-8000-000000000001', true);
select public.delete_story('95300000-0000-4000-8000-000000000001');
select extensions.is(
  public.story_reply_media_is_referenced('95200000-0000-4000-8000-000000000001/95300000-0000-4000-8000-000000000001.jpg'),
  true,
  'story reply media remains referenced after the author deletes the story'
);

select * from extensions.finish();
rollback;
