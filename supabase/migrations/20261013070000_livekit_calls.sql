create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id uuid not null references auth.users (id) on delete cascade,
  callee_id uuid not null references auth.users (id) on delete cascade,
  room_name text not null unique,
  media_type text not null check (media_type in ('audio', 'video')),
  status text not null default 'ringing'
    check (status in ('ringing', 'connecting', 'active', 'ended', 'declined', 'missed')),
  caller_connected_at timestamptz,
  callee_connected_at timestamptz,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (caller_id <> callee_id)
);

create index call_sessions_conversation_created_idx
  on public.call_sessions (conversation_id, created_at desc);
create index call_sessions_callee_ringing_idx
  on public.call_sessions (callee_id, created_at desc)
  where status = 'ringing';
create unique index call_sessions_one_live_per_conversation_idx
  on public.call_sessions (conversation_id)
  where status in ('ringing', 'connecting', 'active');

alter table public.call_sessions enable row level security;
revoke all on public.call_sessions from anon, authenticated;
grant select on public.call_sessions to authenticated;

create policy "Active conversation members can read call sessions"
on public.call_sessions for select to authenticated
using (public.chat_is_active_member(conversation_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'call_sessions'
    )
  then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end;
$$;
