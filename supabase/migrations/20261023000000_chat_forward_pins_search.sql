alter table public.messages
  add column forwarded_from_id uuid references public.messages (id) on delete set null;
grant insert (forwarded_from_id) on public.messages to authenticated;

create table public.conversation_pins (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid not null references auth.users (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);
create index conversation_pins_order_idx on public.conversation_pins (conversation_id, pinned_at desc);
alter table public.conversation_pins enable row level security;
revoke all on public.conversation_pins from public, anon, authenticated;
grant select, delete on public.conversation_pins to authenticated;
grant insert (conversation_id, message_id, pinned_by) on public.conversation_pins to authenticated;

create function public.enforce_conversation_pin_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  conversation_type text;
  member_role text;
begin
  if auth.uid() is null or new.pinned_by <> auth.uid()
    or not public.chat_is_active_member_internal(new.conversation_id, auth.uid()) then
    raise exception 'Only active conversation members can pin messages.';
  end if;
  select c.type into conversation_type
  from public.conversations c where c.id = new.conversation_id;
  if conversation_type = 'group' then
    select cm.role into member_role
    from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.user_id = auth.uid() and cm.left_at is null;
    if member_role not in ('owner', 'admin') then
      raise exception 'Only group admins can pin messages.';
    end if;
  end if;
  if not exists (
    select 1 from public.messages m
    where m.id = new.message_id
      and m.conversation_id = new.conversation_id
      and m.deleted_at is null
  ) then
    raise exception 'Choose a message in this conversation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.conversation_id::text, 0));
  if not exists (
    select 1 from public.conversation_pins p
    where p.conversation_id = new.conversation_id and p.message_id = new.message_id
  ) and (
    select count(*) from public.conversation_pins p
    where p.conversation_id = new.conversation_id
  ) >= 3 then
    raise exception 'A conversation can have at most three pinned messages.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_conversation_pin_rules() from public, anon, authenticated;
create trigger conversation_pins_enforce_rules
before insert on public.conversation_pins
for each row execute function public.enforce_conversation_pin_rules();

create policy "Active members can read conversation pins"
on public.conversation_pins for select to authenticated
using (public.chat_is_active_member(conversation_id));
create policy "Active members can add conversation pins"
on public.conversation_pins for insert to authenticated
with check (pinned_by = auth.uid() and public.chat_is_active_member(conversation_id));
create policy "Members or group admins can remove conversation pins"
on public.conversation_pins for delete to authenticated
using (
  public.chat_is_active_member(conversation_id)
  and (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'direct')
    or exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_pins.conversation_id
        and cm.user_id = auth.uid()
        and cm.left_at is null
        and cm.role in ('owner', 'admin')
    )
  )
);

alter table public.messages
  add column search_vector tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(body, ''))) stored;
create index messages_search_vector_idx on public.messages using gin (search_vector);

create function public.search_chat_messages(
  p_query text,
  p_conversation_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 30
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  highlighted text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  viewer_id uuid := auth.uid();
  query_vector tsquery;
begin
  if viewer_id is null then raise exception 'Sign in to search conversations.'; end if;
  if char_length(btrim(coalesce(p_query, ''))) < 2 or char_length(p_query) > 100 then
    raise exception 'Search terms must be between 2 and 100 characters.';
  end if;
  if p_page_size < 1 or p_page_size > 50 then
    raise exception 'Page size must be between 1 and 50.';
  end if;
  if p_conversation_id is not null
    and not public.chat_is_active_member_internal(p_conversation_id, viewer_id) then
    raise exception 'You are not an active member of this conversation.';
  end if;
  query_vector := plainto_tsquery('simple', p_query);
  return query
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    ts_headline('simple', coalesce(m.body, ''), query_vector,
      'StartSel=[,StopSel=],MaxFragments=2,FragmentDelimiter= … ') as highlighted
  from public.messages m
  where m.deleted_at is null
    and m.search_vector @@ query_vector
    and (p_conversation_id is null or m.conversation_id = p_conversation_id)
    and public.chat_is_active_member_internal(m.conversation_id, viewer_id)
    and (
      p_cursor_created_at is null
      or (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by m.created_at desc, m.id desc
  limit p_page_size;
end;
$$;
revoke all on function public.search_chat_messages(text, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_chat_messages(text, uuid, timestamptz, uuid, integer) to authenticated;
