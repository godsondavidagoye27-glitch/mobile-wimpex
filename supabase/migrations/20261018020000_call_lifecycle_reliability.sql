alter table public.call_sessions
  add column last_activity_at timestamptz;

update public.call_sessions
set last_activity_at = coalesce(
  greatest(caller_connected_at, callee_connected_at),
  created_at
)
where last_activity_at is null;

alter table public.call_sessions
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

create index call_sessions_stale_lifecycle_idx
  on public.call_sessions (status, last_activity_at)
  where status in ('ringing', 'connecting', 'active');

create policy "Participants can join their call status topic"
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^call-session:[0-9a-fA-F-]{36}$'
  and exists (
    select 1
    from public.call_sessions as session
    where session.id::text = substring(realtime.topic() from 14)
      and auth.uid() in (session.caller_id, session.callee_id)
  )
);

create or replace function public.reap_stale_call_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.call_sessions
  set status = case when status = 'ringing' then 'missed' else 'ended' end,
      ended_at = now()
  where (
    status = 'ringing'
    and expires_at <= now()
  ) or (
    status = 'connecting'
    and last_activity_at <= now() - interval '60 seconds'
  ) or (
    status = 'active'
    and last_activity_at <= now() - interval '90 seconds'
  );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.reap_stale_call_sessions() from public, anon, authenticated;
grant execute on function public.reap_stale_call_sessions() to service_role;

do $$
declare
  scheduled boolean;
  job_id bigint;
begin
  if to_regnamespace('cron') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1)'
      into scheduled
      using 'reap-stale-call-sessions';
    if not scheduled then
      execute 'select cron.schedule($1, $2, $3)'
        into job_id
        using 'reap-stale-call-sessions', '* * * * *',
          'select public.reap_stale_call_sessions();';
    end if;
  end if;
end;
$$;
