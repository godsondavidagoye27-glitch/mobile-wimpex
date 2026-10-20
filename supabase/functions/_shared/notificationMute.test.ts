import { describe, expect, it } from 'vitest';
import {
  isNotificationMuteActive,
  isNotificationTargetMuted,
  type NotificationMuteRow,
} from './notificationMute';

const now = Date.parse('2026-10-19T12:00:00.000Z');

describe('notification mute expiry', () => {
  it('keeps permanent and future mutes active but ignores expired or invalid dates', () => {
    expect(isNotificationMuteActive(null, now)).toBe(true);
    expect(isNotificationMuteActive('2026-10-19T12:01:00.000Z', now)).toBe(true);
    expect(isNotificationMuteActive('2026-10-19T12:00:00.000Z', now)).toBe(false);
    expect(isNotificationMuteActive('2026-10-19T11:59:00.000Z', now)).toBe(false);
    expect(isNotificationMuteActive('invalid', now)).toBe(false);
  });

  it('matches muted owners and targets while keeping calls opt-in', () => {
    const mutes: NotificationMuteRow[] = [
      {
        owner_id: 'recipient',
        target_type: 'user',
        target_id: 'sender',
        muted_until: null,
        mute_calls: false,
      },
    ];
    expect(isNotificationTargetMuted(mutes, 'recipient', 'user', 'sender', now)).toBe(true);
    expect(isNotificationTargetMuted(mutes, 'recipient', 'user', 'sender', now, true)).toBe(false);
    expect(isNotificationTargetMuted(mutes, 'other', 'user', 'sender', now)).toBe(false);
    expect(isNotificationTargetMuted([{
      ...mutes[0],
      mute_calls: true,
      muted_until: '2026-10-19T13:00:00.000Z',
    }], 'recipient', 'user', 'sender', now, true)).toBe(true);
  });
});
