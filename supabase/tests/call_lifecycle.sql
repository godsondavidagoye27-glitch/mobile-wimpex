begin;
select plan(5);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'call_sessions'
      and column_name = 'last_activity_at'
      and is_nullable = 'NO'
  ),
  'call sessions track a non-null activity timestamp'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'Participants can join their call status topic'
  ),
  'authenticated call participants can authorize the call status topic'
);

select ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.reap_stale_call_sessions()'::regprocedure
  ),
  'stale call cleanup function is installed'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'call_sessions'
      and indexname = 'call_sessions_stale_lifecycle_idx'
  ),
  'stale call cleanup has a status/activity index'
);

select ok(
  not has_function_privilege('authenticated', 'public.reap_stale_call_sessions()', 'EXECUTE'),
  'authenticated users cannot invoke the call cleanup function'
);

select * from finish();
rollback;
