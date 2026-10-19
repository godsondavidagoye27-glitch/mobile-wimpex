import { describe, expect, it } from 'vitest';
import {
  addForegroundUsage,
  isDailyUsageState,
  isWithinQuietHours,
  shouldHideRestrictedContent,
} from './teenSafetyRules';

describe('teen safety rules', () => {
  it('pauses push delivery only inside the configured quiet-hours window, including midnight crossing', () => {
    expect(isWithinQuietHours(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(6 * 60 + 59, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(isWithinQuietHours(12 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietHours(18 * 60, 9 * 60, 17 * 60)).toBe(false);
  });

  it('hides restricted content only for minors who have enabled the filter', () => {
    expect(shouldHideRestrictedContent(true, true, true)).toBe(true);
    expect(shouldHideRestrictedContent(true, false, true)).toBe(false);
    expect(shouldHideRestrictedContent(false, true, true)).toBe(false);
    expect(shouldHideRestrictedContent(true, true, false)).toBe(false);
  });

  it('shows the daily usage reminder once when the threshold is reached and resets on a new day', () => {
    const first = addForegroundUsage(null, 30 * 60_000, 60, '2026-10-19');
    expect(first).toEqual({
      state: { day: '2026-10-19', foregroundMs: 30 * 60_000, reminded: false },
      shouldRemind: false,
    });
    const threshold = addForegroundUsage(first.state, 30 * 60_000, 60, '2026-10-19');
    expect(threshold.shouldRemind).toBe(true);
    expect(addForegroundUsage(threshold.state, 60_000, 60, '2026-10-19').shouldRemind).toBe(false);
    expect(addForegroundUsage(threshold.state, 0, 60, '2026-10-20').state).toEqual({
      day: '2026-10-20',
      foregroundMs: 0,
      reminded: false,
    });
    expect(addForegroundUsage(null, 10 * 60_000, null, '2026-10-19').shouldRemind).toBe(false);
  });

  it('accepts only a valid local usage record', () => {
    expect(isDailyUsageState({ day: '2026-10-19', foregroundMs: 1000, reminded: false })).toBe(true);
    expect(isDailyUsageState({ day: 'not-a-day', foregroundMs: 1000, reminded: false })).toBe(false);
    expect(isDailyUsageState({ day: '2026-10-19', foregroundMs: -1, reminded: false })).toBe(false);
  });
});
