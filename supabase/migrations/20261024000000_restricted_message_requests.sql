create table public.message_requests (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> recipient_id),
  check ((status = 'pending') = (responded_at is null))
);
create index message_requests_recipient_idx on public.message_requests (recipient_id, created_at desc)
  where status = 'pending';
alter table public.message_requests enable row level security;
revoke all on public.message_requests from public, anon, authenticated;
grant select on public.message_requests to authenticated;
create policy "Conversation participants can read their message request"
on public.message_requests for select to authenticated
using (auth.uid() in (requester_id, recipient_id));

create function public.enqueue_restricted_message_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  peer_id uuid;
  owner_id uuid;
  requester_id uuid;
  recipient_id uuid;
begin
  select cm.user_id into peer_id
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.user_id
    and cm.left_at is null
    and c.type = 'direct'
  limit 1;
  if peer_id is null then return new; end if;

  select r.owner_id into owner_id
  from public.comment_restrictions r
  where (r.owner_id = new.user_id and r.restricted_user_id = peer_id)
     or (r.owner_id = peer_id and r.restricted_user_id = new.user_id)
  limit 1;
  if owner_id is null then return new; end if;
  recipient_id := owner_id;
  requester_id := case when owner_id = new.user_id then peer_id else new.user_id end;
  insert into public.message_requests (conversation_id, requester_id, recipient_id)
  values (new.conversation_id, requester_id, recipient_id)
  on conflict (conversation_id) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_restricted_message_request() from public, anon, authenticated;
create trigger conversation_members_restricted_request
after insert or update of left_at on public.conversation_members
for each row when (new.left_at is null)
execute function public.enqueue_restricted_message_request();

drop policy if exists "Active conversation members can read messages" on public.messages;
create policy "Active members read messages except pending requests"
on public.messages for select to authenticated
using (
  public.chat_is_active_member(conversation_id)
  and not exists (
    select 1 from public.message_requests request
    where request.conversation_id = messages.conversation_id
      and request.status = 'pending'
      and auth.uid() = request.recipient_id
  )
);

create function public.get_my_message_requests()
returns table (
  conversation_id uuid,
  requester_id uuid,
  username text,
  display_name text,
  avatar_url text,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select request.conversation_id, request.requester_id,
    profile.username, profile.display_name, profile.avatar_url,
    message.body, request.created_at
  from public.message_requests request
  join public.profiles profile on profile.id = request.requester_id
  left join lateral (
    select m.body from public.messages m
    where m.conversation_id = request.conversation_id
      and m.sender_id = request.requester_id
      and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) message on true
  where request.recipient_id = auth.uid()
    and request.status = 'pending'
  order by request.created_at desc
  limit 100;
$$;

create function public.respond_message_request(p_conversation_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.message_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where conversation_id = p_conversation_id
    and recipient_id = auth.uid()
    and status = 'pending';
  if not found then raise exception 'This message request is unavailable.'; end if;
  if not p_accept then
    update public.conversation_members
    set left_at = now()
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
      and left_at is null;
  end if;
end;
$$;

create function public.filter_restricted_chat_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  recipient uuid;
begin
  if exists (
    select 1 from public.message_requests request
    where request.conversation_id = new.conversation_id
      and request.recipient_id = new.sender_id
      and request.status = 'pending'
  ) then
    raise exception 'Accept the message request before replying.';
  end if;
  select case when cm.user_id = new.sender_id then other_member.user_id else cm.user_id end
  into recipient
  from public.conversation_members cm
  join public.conversation_members other_member
    on other_member.conversation_id = cm.conversation_id
   and other_member.user_id <> cm.user_id
  join public.conversations c on c.id = cm.conversation_id and c.type = 'direct'
  where cm.conversation_id = new.conversation_id
    and cm.user_id = new.sender_id
    and cm.left_at is null
    and other_member.left_at is null
  limit 1;
  if recipient is not null and exists (
    select 1 from public.comment_restrictions r
    where r.owner_id = recipient and r.restricted_user_id = new.sender_id
  ) and not exists (
    select 1 from public.message_requests request
    where request.conversation_id = new.conversation_id and request.status = 'accepted'
  ) then
    insert into public.message_requests (conversation_id, requester_id, recipient_id)
    values (new.conversation_id, new.sender_id, recipient)
    on conflict (conversation_id) do update
      set status = 'pending',
          requester_id = excluded.requester_id,
          recipient_id = excluded.recipient_id,
          created_at = now(),
          responded_at = null
      where public.message_requests.status = 'declined';
  end if;
  return new;
end;
$$;
revoke all on function public.filter_restricted_chat_insert() from public, anon, authenticated;
create trigger messages_enqueue_restricted_request
before insert on public.messages
for each row execute function public.filter_restricted_chat_insert();

revoke all on function public.get_my_message_requests() from public, anon;
revoke all on function public.respond_message_request(uuid, boolean) from public, anon;
grant execute on function public.get_my_message_requests() to authenticated;
grant execute on function public.respond_message_request(uuid, boolean) to authenticated;
