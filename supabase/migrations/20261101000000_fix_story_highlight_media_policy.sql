begin;

create function public.can_read_story_highlight_media(
  p_media_path text,
  p_viewer_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select p_viewer_id is not null
    and p_viewer_id = auth.uid()
    and p_media_path is not null
    and exists (
      select 1
      from public.story_highlight_items item
      where item.media_path = p_media_path
        and public.can_view_story_highlight(item.highlight_id, p_viewer_id)
        and public.can_view_story_highlight_item(item.id, p_viewer_id)
    );
$$;

revoke all on function public.can_read_story_highlight_media(text, uuid) from public, anon, authenticated;
grant execute on function public.can_read_story_highlight_media(text, uuid) to authenticated;

drop policy "Highlight media read when highlight is visible" on storage.objects;
create policy "Highlight media read when highlight is visible"
on storage.objects for select to authenticated
using (
  bucket_id = 'highlights'
  and public.can_read_story_highlight_media(storage.objects.name, auth.uid())
);

commit;
