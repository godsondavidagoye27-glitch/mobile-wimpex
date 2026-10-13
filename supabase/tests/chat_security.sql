begin;

select extensions.plan(25);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'alice@chat-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'bob@chat-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'minor@chat-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'carol@chat-test.invalid', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rate@chat-test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, dm_policy)
values
  ('11000000-0000-4000-8000-000000000001', 'chat_alice', 'Alice', '1990-01-01', 'everyone'),
  ('11000000-0000-4000-8000-000000000002', 'chat_bob', 'Bob', '1990-01-01', 'none'),
  ('11000000-0000-4000-8000-000000000003', 'chat_minor', 'Minor', '2012-01-01', 'everyone'),
  ('11000000-0000-4000-8000-000000000004', 'chat_carol', 'Carol', '1990-01-01', 'everyone'),
  ('11000000-0000-4000-8000-000000000005', 'chat_rate', 'Rate User', '1990-01-01', 'everyone');

insert into public.conversations (id, type, created_by, direct_key)
values (
  '22000000-0000-4000-8000-000000000001',
  'direct',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001:11000000-0000-4000-8000-000000000002'
);

insert into public.conversation_members (conversation_id, user_id)
values
  ('22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002');

insert into public.conversations (id, type, created_by, direct_key)
values (
  '22000000-0000-4000-8000-000000000002',
  'direct',
  '11000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001:11000000-0000-4000-8000-000000000005'
);

insert into public.conversation_members (conversation_id, user_id)
values
  ('22000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000005'),
  ('22000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (select count(*) from public.conversations where id = '22000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a member can read their direct conversation'
);
select extensions.is(
  (select count(*) from public.conversation_members where conversation_id = '22000000-0000-4000-8000-000000000001'),
  2::bigint,
  'conversation members can see the thread membership list'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (select count(*) from public.conversations where id = '22000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a non-member cannot read a conversation'
);
select extensions.is(
  (select count(*) from public.conversation_members where conversation_id = '22000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a non-member cannot read membership details'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.start_direct_conversation('11000000-0000-4000-8000-000000000002'::uuid)$$,
  'a recipient who accepts no DMs cannot be messaged'
);
select extensions.throws_ok(
  $$select public.start_direct_conversation('11000000-0000-4000-8000-000000000003'::uuid)$$,
  'an adult cannot start a direct chat with an under-18 account without mutual follows'
);
select extensions.throws_ok(
  $$select public.create_group('Minor safety test', array['11000000-0000-4000-8000-000000000003'::uuid])$$,
  'a group cannot include an under-18 account without mutual accepted follows'
);

reset role;
insert into public.follows (follower_id, following_id, status)
values
  ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'accepted'),
  ('11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'accepted');
update public.follows set status = 'accepted'
where (follower_id, following_id) in (
  ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003'),
  ('11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001')
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select extensions.ok(
  public.start_direct_conversation('11000000-0000-4000-8000-000000000003'::uuid) is not null,
  'mutual accepted follows permit adult/minor direct messaging'
);
select extensions.ok(
  public.create_group('Minor safety allowed', array['11000000-0000-4000-8000-000000000003'::uuid]) is not null,
  'mutual accepted follows permit the minor in a group'
);

insert into public.messages (
  id, conversation_id, sender_id, client_id, kind, body
)
values (
  '33000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  'text',
  'Unread counter test'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select unread_count from public.conversation_members
   where conversation_id = '22000000-0000-4000-8000-000000000001'
     and user_id = '11000000-0000-4000-8000-000000000002'),
  1,
  'a new message increments the recipient unread count'
);
select public.mark_read(
  '22000000-0000-4000-8000-000000000001'::uuid,
  '33000000-0000-4000-8000-000000000001'::uuid
);
select extensions.is(
  (select unread_count from public.conversation_members
   where conversation_id = '22000000-0000-4000-8000-000000000001'
     and user_id = '11000000-0000-4000-8000-000000000002'),
  0,
  'mark_read clears the unread count through the requested message'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$insert into public.messages (conversation_id, sender_id, client_id, kind, body)
    values ('22000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001',
      'text', 'Duplicate retry')$$,
  'a repeated client ID cannot create a duplicate message'
);
select extensions.is(
  (select count(*) from public.messages
   where sender_id = '11000000-0000-4000-8000-000000000001'
     and client_id = '44000000-0000-4000-8000-000000000001'),
  1::bigint,
  'client-ID retries leave one persisted message'
);

insert into public.messages (
  id, conversation_id, sender_id, client_id, kind, media_path
)
values (
  '55000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000010',
  'image',
  '11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg'
);
select extensions.ok(
  public.chat_can_upload_media('11000000-0000-4000-8000-000000000001/66000000-0000-4000-8000-000000000001.jpg'),
  'a signed-in user can upload a supported media type only into their own private folder'
);
select extensions.ok(
  public.chat_can_access_media('11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg'),
  'a sender can read media referenced by their active conversation message'
);
select extensions.ok(
  not public.chat_can_upload_media('11000000-0000-4000-8000-000000000002/66000000-0000-4000-8000-000000000001.jpg'),
  'a user cannot upload into another account media folder'
);
select extensions.ok(
  not public.chat_can_upload_media('11000000-0000-4000-8000-000000000001/66000000-0000-4000-8000-000000000001.svg'),
  'unsupported chat media extensions are rejected'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select extensions.ok(
  public.chat_can_access_media('11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg'),
  'another active conversation member can read the referenced private attachment'
);
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000004', true);
select extensions.ok(
  not public.chat_can_access_media('11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg'),
  'a non-member cannot read a private chat attachment'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
insert into public.message_reactions (message_id, user_id, emoji)
values (
  '33000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '👍'
);
select extensions.throws_ok(
  $$insert into public.message_reactions (message_id, user_id, emoji)
    values ('33000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001', '👍')$$,
  'duplicate reactions by one user are rejected'
);
select extensions.is(
  (select count(*) from public.message_reactions
   where message_id = '33000000-0000-4000-8000-000000000001'
     and user_id = '11000000-0000-4000-8000-000000000001'),
  1::bigint,
  'reaction uniqueness preserves one reaction row'
);

reset role;
insert into public.blocks (blocker_id, blocked_id)
values (
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$insert into public.messages (conversation_id, sender_id, client_id, kind, body)
    values ('22000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000002',
      'text', 'Blocked message')$$,
  'a block prevents chat messages'
);
select extensions.throws_ok(
  $$insert into public.messages (conversation_id, sender_id, client_id, kind, body)
    select cm.conversation_id, '11000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000003', 'text', 'Welcome reply'
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = '11000000-0000-4000-8000-000000000001'
      and c.read_only limit 1$$,
  'a welcome conversation is read-only'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000005', true);
insert into public.messages (conversation_id, sender_id, client_id, kind, body)
select
  '22000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000005',
  gen_random_uuid(),
  'text',
  'Rate test ' || message_number
from generate_series(1, 30) as test_values(message_number);
select extensions.throws_ok(
  $$insert into public.messages (conversation_id, sender_id, client_id, kind, body)
    values ('22000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000005',
      gen_random_uuid(), 'text', 'Rate limit test')$$,
  'the rolling message rate limit is enforced'
);

reset role;
update public.profiles
set is_official = false
where id = 'f0a4c8b2-91d3-4a67-8b5c-1234567890ab';
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '11000000-0000-4000-8000-000000000006',
  'authenticated', 'authenticated', 'welcome@chat-test.invalid', '', now(), '{}', '{}', now(), now()
);
insert into public.profiles (id, username, display_name, date_of_birth)
values ('11000000-0000-4000-8000-000000000006', 'chat_welcome', 'Welcome', '1990-01-01');
select extensions.is(
  (select count(*) from public.profiles where id = '11000000-0000-4000-8000-000000000006'),
  1::bigint,
  'missing official profile does not block account creation'
);
update public.profiles
set is_official = true
where id = 'f0a4c8b2-91d3-4a67-8b5c-1234567890ab';

select * from extensions.finish();
rollback;
