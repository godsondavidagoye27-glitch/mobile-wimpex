begin;

do $$
begin
  if not public.teen_age_is_minor(date '2008-10-20', date '2026-10-19') then
    raise exception 'A 17-year-old must be identified as a minor.';
  end if;
  if public.teen_age_is_minor(date '2008-10-19', date '2026-10-19') then
    raise exception 'An 18-year-old must not be identified as a minor.';
  end if;

  if public.teen_profile_is_discoverable(true) then
    raise exception 'Minor profiles must not be discoverable.';
  end if;
  if not public.teen_profile_is_discoverable(false) then
    raise exception 'Adult profiles should remain discoverable.';
  end if;

  if not public.teen_dm_pair_allowed(true, false, true) then
    raise exception 'Mutual accepted follows should allow a teen conversation.';
  end if;
  if public.teen_dm_pair_allowed(false, true, false) then
    raise exception 'A non-mutual conversation involving a teen must be rejected.';
  end if;
  if not public.teen_dm_pair_allowed(false, false, false) then
    raise exception 'Adult messaging must preserve its existing recipient policy.';
  end if;

  if not public.teen_quiet_hours_match(time '23:00', time '22:00', time '07:00')
    or not public.teen_quiet_hours_match(time '06:59', time '22:00', time '07:00')
    or public.teen_quiet_hours_match(time '07:00', time '22:00', time '07:00')
  then
    raise exception 'Overnight quiet hours must include the start and exclude the end.';
  end if;

  if not public.teen_restricted_flag('nudity', 0.5, 'review')
    or not public.teen_restricted_flag('violence', 0.9, 'warned')
    or public.teen_restricted_flag('abuse', 0.9, 'review')
    or public.teen_restricted_flag('nudity', 0.49, 'review')
    or public.teen_restricted_flag('nudity', 0.9, 'approved')
  then
    raise exception 'Restricted-content classification must use category, confidence, and active review status.';
  end if;
end;
$$;

rollback;
