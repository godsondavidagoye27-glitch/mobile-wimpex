create or replace function public.is_username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    lower(name) <> all (array[
      'wimpex', 'admin', 'support', 'help', 'official', 'moderator', 'null', 'undefined',
      'api', 'login', 'logout', 'signup', 'sign-up', 'register', 'account', 'profile',
      'settings', 'notifications', 'notification', 'message', 'messages', 'chat', 'chats',
      'search', 'discover', 'explore', 'about', 'terms', 'privacy', 'report', 'block',
      'follow', 'followers', 'following', 'live', 'video', 'videos', 'post', 'posts',
      'community', 'communities', 'create', 'verify', 'email', 'auth', 'feed', 'home'
    ]::text[])
    and not exists (
      select 1
      from public.profiles
      where username = lower(name)
    ),
    false
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;
