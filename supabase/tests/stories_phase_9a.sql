begin;

select extensions.plan(14);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'story-author@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'story-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('95000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'story-outsider@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('95000000-0000-4000-8000-000000000001', 'story_author', 'Story Author', '1990-01-01', false),
  ('95000000-0000-4000-8000-000000000002', 'story_follower', 'Story Follower', '1990-01-01', false),
  ('95000000-0000-4000-8000-000000000003', 'story_outsider', 'Story Outsider', '1990-01-01', false);

insert into public.follows (follower_id, following_id, status)
values ('95000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', 'accepted');

insert into public.stories (
  id, author_id, kind, media_path, caption, audience, duration_ms, width, height
)
values
  ('95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'image', '95000000-0000-4000-8000-000000000001/95100000-0000-4000-8000-000000000001.jpg', 'Public', 'everyone', 5000, 1080, 1920),
  ('95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', 'image', '95000000-0000-4000-8000-000000000001/95100000-0000-4000-8000-000000000002.jpg', 'Followers', 'followers', 5000, 1080, 1920),
  ('95100000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000001', 'image', '95000000-0000-4000-8000-000000000001/95100000-0000-4000-8000-000000000003.jpg', 'Close friends', 'close_friends', 5000, 1080, 1920);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000001'),
  true,
  'authors can view their own active stories'
);
select extensions.lives_ok(
  $$select public.add_close_friend('95000000-0000-4000-8000-000000000002')$$,
  'authors can add followed accounts to close friends'
);
select extensions.is(
  (select story_count from public.get_story_rail() where is_owner),
  3::bigint,
  'the story rail aggregates the author''s visible active stories'
);
select extensions.throws_ok(
  $$insert into public.stories (
      id, author_id, kind, media_path, audience, duration_ms, width, height, expires_at
    ) values (
      '95100000-0000-4000-8000-000000000004',
      auth.uid(),
      'image',
      auth.uid()::text || '/95100000-0000-4000-8000-000000000004.jpg',
      'everyone',
      5000,
      1080,
      1920,
      now() + interval '48 hours'
    )$$,
  '42501',
  null,
  'clients cannot set story expiry timestamps'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000001'),
  true,
  'everyone stories are visible to non-followers of public profiles'
);
select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000002'),
  false,
  'followers stories are hidden from non-followers'
);
select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000003'),
  false,
  'close friends stories are hidden from non-members'
);
select extensions.throws_ok(
  $$select public.get_story_viewers('95100000-0000-4000-8000-000000000001')$$,
  'Only the author can view story viewers.',
  'only the author can read story viewers'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000002'),
  true,
  'accepted followers can view follower stories'
);
select extensions.is(
  public.can_view_story('95100000-0000-4000-8000-000000000003'),
  true,
  'close friends can view close friends stories'
);
select public.mark_story_viewed('95100000-0000-4000-8000-000000000001');
select public.mark_story_viewed('95100000-0000-4000-8000-000000000001');
select extensions.is(
  (select has_viewed from public.get_author_stories('95000000-0000-4000-8000-000000000001')
   where id = '95100000-0000-4000-8000-000000000001'),
  true,
  'story views are recorded idempotently'
);
select extensions.throws_ok(
  $$insert into public.story_views (story_id, viewer_id)
    values ('95100000-0000-4000-8000-000000000001', auth.uid())$$,
  '42501',
  null,
  'story views are inserted only through the rate limited RPC'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.get_story_viewers('95100000-0000-4000-8000-000000000001')->>'total_count')::bigint,
  1::bigint,
  'story viewers are deduplicated and visible to the author'
);
select extensions.is(
  (select view_count from public.get_author_stories('95000000-0000-4000-8000-000000000001')
   where id = '95100000-0000-4000-8000-000000000001'),
  1::bigint,
  'only the author receives a story view count'
);

select * from extensions.finish();
rollback;
