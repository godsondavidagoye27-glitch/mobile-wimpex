create table public.device_push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id uuid not null,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, installation_id),
  unique (expo_push_token)
);

alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.device_push_tokens to authenticated;

create policy "Users manage their own push tokens"
on public.device_push_tokens for select to authenticated
using (user_id = auth.uid());

create policy "Users register their own push tokens"
on public.device_push_tokens for insert to authenticated
with check (user_id = auth.uid());

create policy "Users update their own push tokens"
on public.device_push_tokens for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users remove their own push tokens"
on public.device_push_tokens for delete to authenticated
using (user_id = auth.uid());

create table public.push_notification_deliveries (
  message_id uuid not null references public.messages (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  installation_id uuid not null,
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  expo_ticket_id text,
  primary key (message_id, recipient_id, installation_id),
  foreign key (recipient_id, installation_id)
    references public.device_push_tokens (user_id, installation_id)
    on delete cascade
);

alter table public.push_notification_deliveries enable row level security;
revoke all on public.push_notification_deliveries from public, anon, authenticated;
