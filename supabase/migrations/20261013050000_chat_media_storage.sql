create or replace function public.chat_can_access_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
set row_security = off
as $$
declare
  path_parts text[];
  owner_id uuid;
  message_id uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 1 then return false; end if;
  if storage.filename(object_name) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|m4a|webm)$' then
    return false;
  end if;

  begin
    owner_id := path_parts[1]::uuid;
    message_id := split_part(storage.filename(object_name), '.', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return owner_id = auth.uid() or exists (
    select 1
    from public.messages m
    where m.id = message_id
      and m.sender_id = owner_id
      and m.media_path = object_name
      and m.deleted_at is null
      and public.chat_is_active_member_internal(m.conversation_id, auth.uid())
  );
end;
$$;

create or replace function public.chat_can_upload_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
set row_security = off
as $$
declare
  path_parts text[];
  owner_id uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 1 then return false; end if;
  if storage.filename(object_name) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|m4a|webm)$' then
    return false;
  end if;

  begin
    owner_id := path_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return owner_id = auth.uid();
end;
$$;

create or replace function public.chat_can_manage_media(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
set row_security = off
as $$
  select public.chat_can_upload_media(object_name);
$$;

revoke all on function public.chat_can_access_media(text) from public, anon, authenticated;
revoke all on function public.chat_can_upload_media(text) from public, anon, authenticated;
revoke all on function public.chat_can_manage_media(text) from public, anon, authenticated;
grant execute on function public.chat_can_access_media(text) to authenticated;
grant execute on function public.chat_can_upload_media(text) to authenticated;
grant execute on function public.chat_can_manage_media(text) to authenticated;

grant insert (id) on public.messages to authenticated;

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'audio/mp4',
      'audio/x-m4a',
      'audio/webm'
    ]
where id = 'chat-media';

drop policy if exists "Conversation members read chat media" on storage.objects;
drop policy if exists "Conversation members upload chat media" on storage.objects;
drop policy if exists "Uploaders update chat media" on storage.objects;
drop policy if exists "Uploaders delete chat media" on storage.objects;

create policy "Conversation members read chat media"
on storage.objects for select to authenticated
using (bucket_id = 'chat-media' and public.chat_can_access_media(name));

create policy "Users upload their own chat media"
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-media' and public.chat_can_upload_media(name));

create policy "Uploaders update their own chat media"
on storage.objects for update to authenticated
using (bucket_id = 'chat-media' and public.chat_can_manage_media(name))
with check (bucket_id = 'chat-media' and public.chat_can_manage_media(name));

create policy "Uploaders delete their own chat media"
on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and public.chat_can_manage_media(name));
