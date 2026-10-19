export type DailyUsageState = {
  day: string;
  foregroundMs: number;
  reminded: boolean;
};

export type UsageUpdate = {
  state: DailyUsageState;
  shouldRemind: boolean;
};

export function isDailyUsageState(value: unknown): value is DailyUsageState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.day === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(state.day)
    && typeof state.foregroundMs === 'number'
    && Number.isFinite(state.foregroundMs)
    && state.foregroundMs >= 0
    && typeof state.reminded === 'boolean';
}

export function addForegroundUsage(
  current: DailyUsageState | null,
  elapsedMs: number,
  reminderMinutes: number | null,
  today: string,
): UsageUpdate {
  const state = current?.day === today
    ? current
    : { day: today, foregroundMs: 0, reminded: false };
  const next = {
    ...state,
    foregroundMs: state.foregroundMs + Math.max(0, elapsedMs),
  };
  const thresholdMs = reminderMinutes === null ? Number.POSITIVE_INFINITY : reminderMinutes * 60_000;
  const shouldRemind = !next.reminded && next.foregroundMs >= thresholdMs;
  return {
    state: shouldRemind ? { ...next, reminded: true } : next,
    shouldRemind,
  };
}

export function isWithinQuietHours(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function shouldHideRestrictedContent(
  isMinor: boolean,
  hideRestrictedContent: boolean,
  isRestricted: boolean,
): boolean {
  return isMinor && hideRestrictedContent && isRestricted;
}
