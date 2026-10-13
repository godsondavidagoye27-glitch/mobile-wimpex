import { describe, expect, it } from 'vitest';
import { ageOnDate, getCallIneligibilityReason, isTerminalCallStatus } from './callPolicy';

const profiles = [
  { id: 'caller', dateOfBirth: '1990-10-14', isDemo: false, isOfficial: false },
  { id: 'peer', dateOfBirth: '1990-01-01', isDemo: false, isOfficial: false },
];

const eligibleCall = {
  conversationType: 'direct' as const,
  readOnly: false,
  isDemoConversation: false,
  activeMemberIds: ['caller', 'peer'],
  callerId: 'caller',
  profiles,
  isBlocked: false,
  recipientDmPolicy: 'everyone' as const,
  areMutualFriends: false,
};

describe('call eligibility policy', () => {
  it('allows eligible adult members of a direct conversation', () => {
    expect(getCallIneligibilityReason(eligibleCall, new Date('2026-10-13T12:00:00Z'))).toBeNull();
  });

  it('calculates age using the birthday boundary', () => {
    expect(ageOnDate('2008-10-14', new Date('2026-10-13T12:00:00Z'))).toBe(17);
    expect(ageOnDate('2008-10-13', new Date('2026-10-13T12:00:00Z'))).toBe(18);
  });

  it.each([
    [{ ...eligibleCall, conversationType: 'group' as const }, 'Calls are only available in regular one-to-one chats.'],
    [{ ...eligibleCall, isBlocked: true }, 'Calls are unavailable because of a blocked relationship.'],
    [{ ...eligibleCall, recipientDmPolicy: 'friends' as const }, 'A mutual accepted follow is required before calling.'],
    [{ ...eligibleCall, profiles: [profiles[0], { ...profiles[1], dateOfBirth: '2010-01-01' }] }, 'Calling is currently limited to adults.'],
    [{ ...eligibleCall, profiles: [profiles[0], { ...profiles[1], isDemo: true }] }, 'Calls are not available with demo or official accounts.'],
  ])('rejects an ineligible call', (input, reason) => {
    expect(getCallIneligibilityReason(input, new Date('2026-10-13T12:00:00Z'))).toBe(reason);
  });

  it('recognizes terminal lifecycle states', () => {
    expect(isTerminalCallStatus('ended')).toBe(true);
    expect(isTerminalCallStatus('missed')).toBe(true);
    expect(isTerminalCallStatus('connecting')).toBe(false);
  });
});
