begin;

select extensions.plan(9);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('96000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'caption-owner@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('96000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'caption-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('96000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'caption-outsider@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('96000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'caption-private@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('96000000-0000-4000-8000-000000000001', 'caption_owner', 'Caption Owner', '1990-01-01', false),
  ('96000000-0000-4000-8000-000000000002', 'caption_follower', 'Caption Follower', '1990-01-01', false),
  ('96000000-0000-4000-8000-000000000003', 'caption_outsider', 'Caption Outsider', '1990-01-01', false),
  ('96000000-0000-4000-8000-000000000004', 'caption_private', 'Caption Private', '1990-01-01', true);

insert into public.follows (follower_id, following_id, status)
values ('96000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001', 'accepted');

insert into public.posts (
  id, author_id, caption, video_path, captions_path, audience, auto_captions, status, published_at
)
values
  ('96100000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'Public caption', '96000000-0000-4000-8000-000000000001/96100000-0000-4000-8000-000000000001.mp4', '96000000-0000-4000-8000-000000000001/96100000-0000-4000-8000-000000000001.vtt', 'everyone', true, 'published', now()),
  ('96100000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000004', 'Private caption', '96000000-0000-4000-8000-000000000004/96100000-0000-4000-8000-000000000002.mp4', '96000000-0000-4000-8000-000000000004/96100000-0000-4000-8000-000000000002.vtt', 'everyone', true, 'published', now());

update public.posts
set captions_status = 'ready'
where id in (
  '96100000-0000-4000-8000-000000000001',
  '96100000-0000-4000-8000-000000000002'
);

select extensions.ok(
  not has_column_privilege('authenticated', 'public.posts', 'captions_path', 'INSERT'),
  'authenticated clients cannot provide caption object paths'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.posts', 'captions_path', 'UPDATE'),
  'authenticated clients cannot replace caption object paths'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.posts', 'captions_status', 'UPDATE'),
  'authenticated clients cannot change caption status'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.posts', 'captions_attempts', 'UPDATE'),
  'authenticated clients cannot change caption attempts'
);
select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Visible post captions can be read'
      and qual like '%can_view_post%'
      and qual like '%captions_status%'
  ),
  'caption storage reads are limited by post visibility and ready status'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.can_view_post('96100000-0000-4000-8000-000000000001', auth.uid()),
  true,
  'public post captions can be viewed by another user'
);
select extensions.is(
  public.can_view_post('96100000-0000-4000-8000-000000000002', auth.uid()),
  false,
  'private post captions are hidden from an outsider'
);

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.can_view_post('96100000-0000-4000-8000-000000000001', auth.uid()),
  true,
  'followers can view public post captions'
);

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.set_post_captions_enabled('96100000-0000-4000-8000-000000000001', false)$$,
  'You can only change captions for your own video.',
  'only the author can change caption settings'
);

select * from extensions.finish();
rollback;
