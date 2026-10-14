begin;

select extensions.plan(17);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'search-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'search-public@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'search-private@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'search-blocked@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'search-demo@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'search-common@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'search-suggested@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'search-demo-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'search-blocker@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private, is_demo)
values
  ('91000000-0000-4000-8000-000000000001', 'search_owner', 'Search Owner', '1990-01-01', false, false),
  ('91000000-0000-4000-8000-000000000002', 'dance_daisy', 'Daisy Dancer', '1990-01-01', false, false),
  ('91000000-0000-4000-8000-000000000003', 'private_dance', 'Private Dancer', '1990-01-01', true, false),
  ('91000000-0000-4000-8000-000000000004', 'blocked_dance', 'Blocked Dancer', '1990-01-01', false, false),
  ('91000000-0000-4000-8000-000000000005', 'demo_dance', 'Demo Dancer', '1990-01-01', false, true),
  ('91000000-0000-4000-8000-000000000006', 'common_dancer', 'Common Dancer', '1990-01-01', false, false),
  ('91000000-0000-4000-8000-000000000007', 'suggested_friend', 'Suggested Friend', '1990-01-01', false, false),
  ('91000000-0000-4000-8000-000000000008', 'search_demo_owner', 'Demo Search Owner', '1990-01-01', false, true),
  ('91000000-0000-4000-8000-000000000009', 'blocker_dance', 'Blocker Dancer', '1990-01-01', false, false);

insert into public.blocks (blocker_id, blocked_id)
values
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001');

insert into public.follows (follower_id, following_id, status)
values
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000006', 'accepted'),
  ('91000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000006', 'accepted');

insert into public.profile_interests (profile_id, interest)
values
  ('91000000-0000-4000-8000-000000000001', 'dance'),
  ('91000000-0000-4000-8000-000000000007', 'dance');

insert into public.posts (id, author_id, caption, hashtags, status, published_at)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Morning dance', array['dance', 'morning'], 'published', now() - interval '1 day'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'Private dance', array['dance'], 'published', now() - interval '1 day'),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000004', 'Blocked dance', array['dance'], 'published', now() - interval '1 day'),
  ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000005', 'Demo dance', array['dance'], 'published', now() - interval '1 day'),
  ('92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000002', 'Older dance', array['dance'], 'published', now() - interval '8 days');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

select extensions.ok(
  exists (
    select 1 from public.search_people('dance')
    where id = '91000000-0000-4000-8000-000000000002'
  ),
  'people search returns matching profiles'
);
select extensions.ok(
  not exists (
    select 1 from public.search_people('dance')
    where id = '91000000-0000-4000-8000-000000000004'
  ),
  'people search excludes blocked profiles'
);
select extensions.ok(
  not exists (
    select 1 from public.search_people('dance')
    where id = '91000000-0000-4000-8000-000000000009'
  ),
  'people search excludes profiles that blocked the viewer'
);
select extensions.ok(
  not exists (
    select 1 from public.search_people('dance')
    where id = '91000000-0000-4000-8000-000000000005'
  ),
  'non-demo viewers do not see demo profiles in search'
);
select extensions.is(
  (select count(*) from public.search_videos('dance')),
  2::bigint,
  'video search includes visible matching posts only'
);
select extensions.ok(
  not exists (
    select 1 from public.search_videos('dance') rows
    where rows.post ->> 'id' in (
      '92000000-0000-4000-8000-000000000002',
      '92000000-0000-4000-8000-000000000003',
      '92000000-0000-4000-8000-000000000004'
    )
  ),
  'video search excludes private, blocked, and demo posts'
);
select extensions.is(
  (select post_count from public.search_hashtags('dance', true) where tag = 'dance'),
  2::bigint,
  'exact hashtag counts include only visible posts'
);
select extensions.is(
  (select post_count from public.trending_hashtags() where tag = 'dance'),
  1::bigint,
  'trending hashtag counts include only the last seven days'
);
select extensions.ok(
  exists (
    select 1 from public.suggested_people()
    where id = '91000000-0000-4000-8000-000000000007'
      and mutual_follows = 1
      and shared_interests = 1
  ),
  'suggested people use mutual follows and shared interests'
);
select extensions.ok(
  not exists (
    select 1 from public.suggested_people()
    where id = '91000000-0000-4000-8000-000000000006'
  ),
  'suggestions exclude profiles the viewer already follows'
);
select extensions.is(
  (select count(*) from public.search_people(
    'dance',
    'dance_daisy',
    '91000000-0000-4000-8000-000000000002'
  )),
  1::bigint,
  'people search uses the supplied keyset cursor'
);
select extensions.ok(
  not exists (
    select 1 from public.search_people('search_owner')
    where id = auth.uid()
  ),
  'people search never returns the signed-in user'
);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000008', true);
select extensions.ok(
  exists (
    select 1 from public.search_people('dance')
    where id = '91000000-0000-4000-8000-000000000005'
  ),
  'demo viewers can discover demo profiles'
);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select * from public.search_people('a')$$,
  'P0001',
  'Search terms must contain at least 2 characters.',
  'search terms shorter than two characters are rejected'
);
select extensions.throws_ok(
  $$select * from public.search_people('dance', null, null, 21)$$,
  'P0001',
  'Page size must be between 1 and 20.',
  'search page size cannot exceed twenty'
);

reset role;
delete from wimpex_private.search_rate_limits
where user_id = auth.uid();
set local role authenticated;
do $$
begin
  for request_number in 1..60 loop
    perform wimpex_private.consume_search_rate_limit();
  end loop;
end;
$$;
select extensions.throws_ok(
  $$select wimpex_private.consume_search_rate_limit()$$,
  'P0001',
  'Search rate limit exceeded.',
  'search is limited to sixty requests per minute'
);

select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select * from public.search_people('dance')$$,
  'P0001',
  'Sign in to search.',
  'search cannot be called without an authenticated owner'
);

select * from extensions.finish();
rollback;
