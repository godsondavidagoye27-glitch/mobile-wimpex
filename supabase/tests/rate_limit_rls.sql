begin;
select plan(3);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_message_rate_limits'::regclass),
  'chat message rate limits enforce row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.story_creation_rate_limits'::regclass),
  'story creation rate limits enforce row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.story_view_rate_limits'::regclass),
  'story view rate limits enforce row level security'
);

select * from finish();
rollback;
