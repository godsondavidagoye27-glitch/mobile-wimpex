begin;

do $$
begin
  if not exists (
    select 1
    from public.badge_types badge_type
    where badge_type.key = 'verified'
      and badge_type.is_active
      and badge_type.show_publicly
  ) then
    raise exception 'The active, public verified badge is unavailable. Apply the profile badges migration first.';
  end if;
end;
$$;

delete from public.badge_suppressions
where badge_key = 'verified';

insert into public.profile_badges (
  profile_id,
  badge_key,
  source,
  granted_by,
  expires_at,
  note
)
select
  profile.id,
  'verified',
  'manual',
  'owner',
  null,
  'Initial grant to all existing users'
from public.profiles profile
on conflict (profile_id, badge_key) do update
set source = 'manual',
    granted_at = now(),
    granted_by = 'owner',
    expires_at = null,
    note = excluded.note;

select
  count(*) as existing_profiles,
  count(*) filter (where profile.is_verified) as verified_profiles
from public.profiles profile;

commit;
