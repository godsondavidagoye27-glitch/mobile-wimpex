create or replace function public.fail_post_upload(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to update your video upload.';
  end if;

  update public.posts
  set status = 'failed'
  where id = p_post_id
    and author_id = auth.uid()
    and status in ('uploading', 'failed');
end;
$$;

revoke all on function public.fail_post_upload(uuid) from public, anon, authenticated;
grant execute on function public.fail_post_upload(uuid) to authenticated;
