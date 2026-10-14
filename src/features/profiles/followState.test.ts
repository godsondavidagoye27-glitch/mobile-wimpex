import { describe, expect, it } from 'vitest';
import { followActionForStatus, followStatusAfterAction } from './followState';

describe('follow state transitions', () => {
  it('maps each follow state to its available action', () => {
    expect(followActionForStatus('none')).toBe('follow');
    expect(followActionForStatus('pending')).toBe('cancel-request');
    expect(followActionForStatus('accepted')).toBe('unfollow');
  });

  it('uses the server state for a new follow and clears a removed relation', () => {
    expect(followStatusAfterAction('follow', 'pending')).toBe('pending');
    expect(followStatusAfterAction('follow', 'accepted')).toBe('accepted');
    expect(followStatusAfterAction('unfollow')).toBe('none');
    expect(followStatusAfterAction('cancel-request')).toBe('none');
  });
});
