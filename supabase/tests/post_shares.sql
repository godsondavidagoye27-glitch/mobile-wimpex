begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'share_viewer@feed-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('22000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'share_author@feed-test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('11000000-0000-4000-8000-000000000001', 'share_viewer', 'Share Viewer', '2000-01-01', false),
  ('22000000-0000-4000-8000-000000000002', 'share_author', 'Share Author', '2000-01-01', false);

insert into public.posts (id, author_id, caption, audience, status, published_at, share_count)
values (
  '22000000-0000-4000-8000-000000000010',
  '22000000-0000-4000-8000-000000000002',
  'Share test',
  'everyone',
  'published',
  now(),
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select public.increment_share(
  '22000000-0000-4000-8000-000000000010',
  '33000000-0000-4000-8000-000000000010'
);
select public.increment_share(
  '22000000-0000-4000-8000-000000000010',
  '33000000-0000-4000-8000-000000000010'
);
select public.increment_share(
  '22000000-0000-4000-8000-000000000010',
  '44000000-0000-4000-8000-000000000010'
);

do $$
begin
  if (select share_count from public.posts where id = '22000000-0000-4000-8000-000000000010') <> 2 then
    raise exception 'A share retry was double counted or a distinct share event was lost.';
  end if;
end;
$$;

rollback;
