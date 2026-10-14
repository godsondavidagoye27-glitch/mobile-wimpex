begin;

select extensions.plan(23);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'live-host@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('61000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'live-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('61000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'live-outsider@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('61000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'live-muted-follower@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('61000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'live-minor@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, username, display_name, date_of_birth, is_private)
values
  ('61000000-0000-4000-8000-000000000001', 'live_host', 'Live Host', '1990-01-01', true),
  ('61000000-0000-4000-8000-000000000002', 'live_follower', 'Live Follower', '1990-01-01', false),
  ('61000000-0000-4000-8000-000000000003', 'live_outsider', 'Live Outsider', '1990-01-01', false),
  ('61000000-0000-4000-8000-000000000004', 'live_muted_follow', 'Live Muted Follow', '1990-01-01', false),
  ('61000000-0000-4000-8000-000000000005', 'live_minor', 'Live Minor', '2012-01-01', false);

insert into public.follows (follower_id, following_id, status)
values
  ('61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', 'accepted'),
  ('61000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000001', 'accepted');

insert into public.user_settings (user_id, notify_live)
values ('61000000-0000-4000-8000-000000000004', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.start_live('Minor stream')$$,
  'Live streaming is currently limited to adult accounts.',
  'accounts under 18 cannot host live streams'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select public.start_live('Private test stream');

select extensions.is(
  (select status from public.live_streams where host_id = auth.uid()),
  'starting',
  'starting a stream creates a pending live room'
);
select extensions.throws_ok(
  $$select public.start_live('A second stream')$$,
  'You already have an active live stream.',
  'a host cannot start two active streams'
);
select extensions.is(
  public.mark_live_started((select id from public.live_streams where host_id = auth.uid())),
  true,
  'the host can mark a stream live'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.can_view_live((select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'), auth.uid()),
  true,
  'an accepted follower can view a private host live stream'
);
select extensions.is(
  (select count(*) from public.get_live_stream(
    (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001')
  )),
  1::bigint,
  'an eligible viewer can fetch the live stream'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.can_view_live((select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'), auth.uid()),
  false,
  'a non-follower cannot view a private host live stream'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (select count(*) from public.notifications
   where user_id = '61000000-0000-4000-8000-000000000002'
     and actor_id = '61000000-0000-4000-8000-000000000001'
     and type = 'live'
     and live_stream_id = (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001')),
  1::bigint,
  'starting a live stream notifies eligible followers through their notification settings'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
select extensions.is(
  (select count(*) from public.notifications
   where user_id = '61000000-0000-4000-8000-000000000004'
     and actor_id = '61000000-0000-4000-8000-000000000001'
     and type = 'live'),
  0::bigint,
  'followers who disable live notifications are skipped'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.send_live_message(
    (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'),
    'Hello from a follower'
  ) is not null,
  true,
  'eligible viewers can send a live message'
);
select extensions.is(
  (select count(*) from public.live_messages
   where author_id = auth.uid()
     and stream_id = (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001')),
  1::bigint,
  'eligible viewers can read live messages through RLS'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.send_live_message(
    (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'),
    'This must be rejected'
  )$$,
  'This live stream is not available to you.',
  'viewers without access cannot post live messages'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.mute_live_user(
    (select id from public.live_streams where host_id = auth.uid()),
    '61000000-0000-4000-8000-000000000002'
  ) is not null,
  true,
  'the host can mute an eligible viewer'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.send_live_message(
    (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'),
    'Muted message'
  )$$,
  'You are muted in this live stream.',
  'muted viewers cannot send live messages'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.ban_live_user(
    (select id from public.live_streams where host_id = auth.uid()),
    '61000000-0000-4000-8000-000000000002',
    'Test ban'
  ),
  true,
  'the host can ban an eligible viewer'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select extensions.is(
  public.can_view_live((select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'), auth.uid()),
  false,
  'a banned viewer cannot view or request another stream token'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.ban_live_user(
    (select id from public.live_streams where host_id = '61000000-0000-4000-8000-000000000001'),
    '61000000-0000-4000-8000-000000000002',
    'Unauthorized ban'
  )$$,
  'Only the host can moderate an active live stream.',
  'non-host viewers cannot ban participants'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.delete_live_message(
    (select id from public.live_streams where host_id = auth.uid()),
    (
      select id from public.live_messages
      where stream_id = (select id from public.live_streams where host_id = auth.uid())
      limit 1
    )
  ),
  true,
  'the host can delete a live message'
);
select extensions.is(
  (select count(*) from public.live_messages
   where stream_id = (select id from public.live_streams where host_id = auth.uid())
     and deleted_at is null),
  0::bigint,
  'deleted live messages are hidden from the live chat'
);
select extensions.is(
  public.end_live((select id from public.live_streams where host_id = auth.uid())),
  true,
  'the host can end a live stream'
);
select extensions.is(
  public.end_live((select id from public.live_streams where host_id = auth.uid())),
  false,
  'ending an already-ended host stream is idempotent'
);
select public.start_live('Stale test stream');

reset role;
update public.live_streams
set created_at = now() - interval '3 minutes'
where host_id = '61000000-0000-4000-8000-000000000001'
  and status = 'starting';
select set_config('request.jwt.claim.sub', '', true);
select extensions.is(
  public.reap_stale_lives(),
  1,
  'the scheduled reaper ends a stale starting stream'
);
select extensions.is(
  (select status from public.live_streams
   where host_id = '61000000-0000-4000-8000-000000000001'
     and title = 'Stale test stream'),
  'ended',
  'stale starting streams are marked ended'
);

select * from extensions.finish();
rollback;
