begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'viewer@feed-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'author@feed-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'private@feed-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'blocked@feed-test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('10000000-0000-4000-8000-000000000001', 'feed_viewer', 'Feed Viewer', '2000-01-01', false),
  ('20000000-0000-4000-8000-000000000002', 'feed_author', 'Feed Author', '2000-01-01', false),
  ('30000000-0000-4000-8000-000000000003', 'feed_private', 'Private Author', '2000-01-01', true),
  ('40000000-0000-4000-8000-000000000004', 'feed_blocked', 'Blocked Author', '2000-01-01', false);

insert into public.posts (
  id, author_id, caption, audience, status, published_at
)
values
  ('20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000002', 'Followers post', 'followers', 'published', now()),
  ('30000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000003', 'Private account post', 'everyone', 'published', now()),
  ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000004', 'Blocked post', 'everyone', 'published', now());

insert into public.blocks (blocker_id, blocked_id)
values ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
begin
  if exists (
    select 1 from public.posts
    where id = '20000000-0000-4000-8000-000000000010'
  ) then
    raise exception 'A stranger can see a followers-only post.';
  end if;

  if exists (
    select 1 from public.posts
    where id = '30000000-0000-4000-8000-000000000010'
  ) then
    raise exception 'A stranger can see a private account post.';
  end if;

  if exists (
    select 1 from public.posts
    where id = '40000000-0000-4000-8000-000000000010'
  ) then
    raise exception 'A blocked user can see a post.';
  end if;

  begin
    perform public.finalize_post('20000000-0000-4000-8000-000000000010');
    raise exception 'A user finalized someone else''s post.';
  exception
    when raise_exception then
      if sqlerrm <> 'You can only publish your own post.' then
        raise;
      end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);

do $$
begin
  begin
    update public.posts
    set like_count = 99
    where id = '20000000-0000-4000-8000-000000000010';
    raise exception 'A user changed a post counter.';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

rollback;
