import { describe, expect, it } from 'vitest';
import {
  localDateTimeParts,
  filterGoLivePushRecipients,
  parseLocalSchedule,
  selectDueScheduledPosts,
  validateScheduledAt,
} from './scheduledPosts';

describe('scheduled posts', () => {
  it('selects only due scheduled posts in deterministic order', () => {
    const due = [
      { id: 'later', status: 'scheduled', scheduled_at: '2026-10-20T12:05:00.000Z' },
      { id: 'not-scheduled', status: 'published', scheduled_at: '2026-10-20T11:00:00.000Z' },
      { id: 'first', status: 'scheduled', scheduled_at: '2026-10-20T11:00:00.000Z' },
      { id: 'invalid', status: 'scheduled', scheduled_at: 'not-a-date' },
      { id: 'null', status: 'scheduled', scheduled_at: null },
      { id: 'future', status: 'scheduled', scheduled_at: '2026-10-20T13:00:00.000Z' },
    ];

    expect(selectDueScheduledPosts(due, Date.parse('2026-10-20T12:00:00.000Z'))).toEqual([
      due[2],
    ]);
    expect(selectDueScheduledPosts(due, Date.parse('2026-10-20T13:00:00.000Z'), 1)).toEqual([
      due[2],
    ]);
  });

  it('requires a valid local date/time in the 10-minute to 30-day window', () => {
    const now = new Date(2026, 9, 20, 12, 0).getTime();
    expect(parseLocalSchedule('2026-10-20', '12:05', now).error).toContain('10 minutes');
    expect(parseLocalSchedule('2026-10-20', '12:10', now).error).toBeNull();
    expect(parseLocalSchedule('2026-11-25', '12:00', now).error).toContain('30 days');
    expect(parseLocalSchedule('2026-02-31', '12:00', now).error).toContain('does not exist');
    expect(parseLocalSchedule('2026-10-20', '24:00', now).error).toContain('YYYY-MM-DD');
  });

  it('validates stored ISO timestamps and converts them to local editor fields', () => {
    expect(validateScheduledAt('invalid', Date.now())).toContain('valid');
    const local = new Date(2026, 9, 20, 13, 7);
    expect(localDateTimeParts(local.toISOString())).toEqual({ date: '2026-10-20', time: '13:07' });
  });

  it('excludes blocked, opted-out, and quiet-hour recipients from go-live pushes', () => {
    expect(filterGoLivePushRecipients(
      ['ok', 'blocked', 'disabled', 'quiet', 'ok'],
      new Set(['blocked']),
      new Set(['disabled']),
      new Set(['quiet']),
    )).toEqual(['ok']);
  });
});
