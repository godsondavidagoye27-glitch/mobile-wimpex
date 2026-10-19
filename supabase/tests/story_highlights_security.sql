begin;

select extensions.plan(14);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('95400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'highlight-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'highlight-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'highlight-outsider@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95400000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'highlight-blocked@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('95400000-0000-4000-8000-000000000001', 'highlight_owner', 'Highlight Owner', '1990-01-01', true),
  ('95400000-0000-4000-8000-000000000002', 'highlight_follower', 'Highlight Follower', '1990-01-01', false),
  ('95400000-0000-4000-8000-000000000003', 'highlight_outsider', 'Highlight Outsider', '1990-01-01', false),
  ('95400000-0000-4000-8000-000000000004', 'highlight_blocked', 'Highlight Blocked', '1990-01-01', false);

insert into public.follows (follower_id, following_id, status)
values
  ('95400000-0000-4000-8000-000000000002', '95400000-0000-4000-8000-000000000001', 'accepted'),
  ('95400000-0000-4000-8000-000000000004', '95400000-0000-4000-8000-000000000001', 'accepted');
insert into public.close_friends (owner_id, friend_id)
values ('95400000-0000-4000-8000-000000000001', '95400000-0000-4000-8000-000000000002');
insert into public.blocks (blocker_id, blocked_id)
values ('95400000-0000-4000-8000-000000000001', '95400000-0000-4000-8000-000000000004');

insert into public.story_highlights (id, owner_id, title, audience, sort_order)
values
  ('95500000-0000-4000-8000-000000000001', '95400000-0000-4000-8000-000000000001', 'Public', 'everyone', 0),
  ('95500000-0000-4000-8000-000000000002', '95400000-0000-4000-8000-000000000001', 'Followers', 'followers', 1),
  ('95500000-0000-4000-8000-000000000003', '95400000-0000-4000-8000-000000000001', 'Close friends', 'close_friends', 2);

insert into public.stories (id, author_id, kind, media_path, caption, audience, duration_ms, width, height)
values (
  '95600000-0000-4000-8000-000000000001',
  '95400000-0000-4000-8000-000000000001',
  'image',
  '95400000-0000-4000-8000-000000000001/95600000-0000-4000-8000-000000000001.jpg',
  'Saved story',
  'everyone',
  5000,
  1080,
  1920
);

insert into public.story_highlight_items (
  id, highlight_id, source_story_id, media_path, kind, source_audience,
  duration_ms, width, height, source_created_at
)
values (
  '95700000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001',
  '95600000-0000-4000-8000-000000000001',
  '95400000-0000-4000-8000-000000000001/95500000-0000-4000-8000-000000000001/95700000-0000-4000-8000-000000000001.jpg',
  'image',
  'close_friends',
  5000,
  1080,
  1920,
  now()
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.story_highlights'::regclass),
  'RLS is enabled on story highlights'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.story_highlight_items'::regclass),
  'RLS is enabled on highlight media references'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95400000-0000-4000-8000-000000000002', true);
select extensions.ok(public.can_view_story_highlight('95500000-0000-4000-8000-000000000001'), 'accepted followers can view a private profile public-audience highlight');
select extensions.ok(public.can_view_story_highlight('95500000-0000-4000-8000-000000000002'), 'accepted followers can view follower-only highlights');
select extensions.ok(public.can_view_story_highlight('95500000-0000-4000-8000-000000000003'), 'close friends can view close-friends highlights');
select extensions.ok(public.can_view_story_highlight_item('95700000-0000-4000-8000-000000000001'), 'close friends can view a saved close-friends story');

select set_config('request.jwt.claim.sub', '95400000-0000-4000-8000-000000000003', true);
select extensions.is(public.can_view_story_highlight('95500000-0000-4000-8000-000000000001'), false, 'private profiles hide highlights from non-followers');
select extensions.is(public.can_view_story_highlight('95500000-0000-4000-8000-000000000002'), false, 'non-followers cannot view follower highlights');
select extensions.is(public.can_view_story_highlight('95500000-0000-4000-8000-000000000003'), false, 'non-close-friends cannot view close-friends highlights');
reset role;
update public.profiles set is_private = false where id = '95400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '95400000-0000-4000-8000-000000000003', true);
select extensions.is(public.can_view_story_highlight_item('95700000-0000-4000-8000-000000000001'), false, 'public profile highlights do not expose saved close-friends stories');

select set_config('request.jwt.claim.sub', '95400000-0000-4000-8000-000000000004', true);
select extensions.is(public.can_view_story_highlight('95500000-0000-4000-8000-000000000001'), false, 'blocked users cannot view highlights');
select extensions.is(public.can_view_story_highlight_item('95700000-0000-4000-8000-000000000001'), false, 'blocked users cannot view saved story media');

select set_config('request.jwt.claim.sub', '95400000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.add_story_to_highlight('95500000-0000-4000-8000-000000000001', '95600000-0000-4000-8000-000000000001', '95700000-0000-4000-8000-000000000002')$$,
  'Upload the copied story media before adding it to the highlight.',
  'the server refuses highlight records without a copied object'
);
select extensions.throws_ok(
  $$select public.add_story_to_highlight('95500000-0000-4000-8000-000000000001', '95600000-0000-4000-8000-000000000099', '95700000-0000-4000-8000-000000000003')$$,
  'Only your active stories can be added to a highlight.',
  'the server requires the source story to be owned and active'
);

select * from extensions.finish();
rollback;
