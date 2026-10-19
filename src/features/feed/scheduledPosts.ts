export type ScheduledPostCandidate = {
  id: string;
  status: string;
  scheduled_at: string | null;
};

export type LocalScheduleResult =
  | { scheduledAt: string; error: null }
  | { scheduledAt: null; error: string };

export function validateScheduledAt(scheduledAt: string, now = Date.now()): string | null {
  const timestamp = Date.parse(scheduledAt);
  if (!Number.isFinite(timestamp)) return 'Choose a valid date and time.';
  if (timestamp < now + 10 * 60 * 1000) return 'Choose a time at least 10 minutes from now.';
  if (timestamp > now + 30 * 24 * 60 * 60 * 1000) return 'Posts can only be scheduled up to 30 days ahead.';
  return null;
}

export function parseLocalSchedule(date: string, time: string, now = Date.now()): LocalScheduleResult {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return { scheduledAt: null, error: 'Enter a date as YYYY-MM-DD and a time as HH:MM.' };

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const localDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (
    localDate.getFullYear() !== Number(year)
    || localDate.getMonth() !== Number(month) - 1
    || localDate.getDate() !== Number(day)
    || localDate.getHours() !== Number(hour)
    || localDate.getMinutes() !== Number(minute)
  ) {
    return { scheduledAt: null, error: 'That local date or time does not exist.' };
  }

  const scheduledAt = localDate.toISOString();
  const error = validateScheduledAt(scheduledAt, now);
  return error ? { scheduledAt: null, error } : { scheduledAt, error: null };
}

export function localDateTimeParts(isoTimestamp: string): { date: string; time: string } {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function selectDueScheduledPosts<T extends ScheduledPostCandidate>(
  posts: readonly T[],
  now = Date.now(),
  limit = 100,
): T[] {
  if (!Number.isInteger(limit) || limit < 1) return [];
  return posts
    .filter((post) => post.status === 'scheduled'
      && post.scheduled_at !== null
      && Number.isFinite(Date.parse(post.scheduled_at))
      && Date.parse(post.scheduled_at) <= now)
    .slice()
    .sort((first, second) => {
      const scheduledOrder = Date.parse(first.scheduled_at!) - Date.parse(second.scheduled_at!);
      return scheduledOrder || first.id.localeCompare(second.id);
    })
    .slice(0, limit);
}

export function filterGoLivePushRecipients(
  candidateIds: readonly string[],
  blockedIds: ReadonlySet<string>,
  pushDisabledIds: ReadonlySet<string>,
  quietHoursIds: ReadonlySet<string>,
): string[] {
  return [...new Set(candidateIds)].filter((userId) =>
    !blockedIds.has(userId)
      && !pushDisabledIds.has(userId)
      && !quietHoursIds.has(userId));
}
