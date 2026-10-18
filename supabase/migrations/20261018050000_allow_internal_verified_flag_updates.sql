create or replace function public.protect_profile_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  reserved_names text[] := array[
    'wimpex', 'admin', 'support', 'help', 'official', 'moderator', 'null', 'undefined',
    'api', 'login', 'logout', 'signup', 'sign-up', 'register', 'account', 'profile',
    'settings', 'notifications', 'notification', 'message', 'messages', 'chat', 'chats',
    'search', 'discover', 'explore', 'about', 'terms', 'privacy', 'report', 'block',
    'follow', 'followers', 'following', 'live', 'video', 'videos', 'post', 'posts',
    'community', 'communities', 'create', 'verify', 'email', 'auth', 'feed', 'home'
  ];
  changed_at timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.username <> lower(new.username) or new.username = any(reserved_names) then
      raise exception 'That username is reserved or unavailable.';
    end if;
    if new.bio is not null and char_length(new.bio) > 150 then
      raise exception 'Bio must be 150 characters or fewer.';
    end if;
    if new.link is not null and (
      char_length(new.link) > 100 or new.link !~* '^https://'
    ) then
      raise exception 'Enter a link that starts with https://';
    end if;
  else
    if new.username is distinct from old.username then
      if new.username <> lower(new.username) or new.username = any(reserved_names) then
        raise exception 'That username is reserved or unavailable.';
      end if;

      changed_at := old.username_changed_at;
      if changed_at is not null and changed_at > now() - interval '14 days' then
        raise exception 'You can change your username again on %.',
          to_char(changed_at + interval '14 days', 'FMMonth DD, YYYY');
      end if;
      new.username_changed_at := now();
    end if;

    if new.bio is distinct from old.bio
      and new.bio is not null
      and char_length(new.bio) > 150 then
      raise exception 'Bio must be 150 characters or fewer.';
    end if;
    if new.link is distinct from old.link
      and new.link is not null
      and (char_length(new.link) > 100 or new.link !~* '^https://') then
      raise exception 'Enter a link that starts with https://';
    end if;

    if new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'Date of birth cannot be changed.';
    end if;

    if new.is_private is distinct from old.is_private
      and date_part('year', age(current_date, new.date_of_birth)) < 18
      and not new.is_private then
      raise exception 'Accounts under 18 stay private.';
    end if;
  end if;

  return new;
end;
$$;
