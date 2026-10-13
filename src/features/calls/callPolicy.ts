export type CallProfile = {
  id: string;
  dateOfBirth: string;
  isDemo: boolean;
  isOfficial: boolean;
};

export type CallEligibilityInput = {
  conversationType: 'direct' | 'group';
  readOnly: boolean;
  isDemoConversation: boolean;
  activeMemberIds: string[];
  callerId: string;
  profiles: CallProfile[];
  isBlocked: boolean;
  recipientDmPolicy: 'everyone' | 'friends' | 'none';
  areMutualFriends: boolean;
};

export function ageOnDate(dateOfBirth: string, today = new Date()): number | null {
  const birthday = new Date(`${dateOfBirth}T00:00:00`);
  if (!Number.isFinite(birthday.getTime())) return null;
  let age = today.getFullYear() - birthday.getFullYear();
  if (
    today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }
  return age;
}

export function getCallIneligibilityReason(input: CallEligibilityInput, today = new Date()): string | null {
  if (input.conversationType !== 'direct' || input.readOnly || input.isDemoConversation) {
    return 'Calls are only available in regular one-to-one chats.';
  }
  if (input.activeMemberIds.length !== 2 || !input.activeMemberIds.includes(input.callerId)) {
    return 'You are not an active member of this one-to-one chat.';
  }
  if (
    input.profiles.length !== 2
    || input.profiles.some((profile) => profile.isDemo || profile.isOfficial)
  ) {
    return 'Calls are not available with demo or official accounts.';
  }
  if (input.profiles.some((profile) => {
    const age = ageOnDate(profile.dateOfBirth, today);
    return age === null || age < 18 || age > 120;
  })) {
    return 'Calling is currently limited to adults.';
  }
  if (input.isBlocked) return 'Calls are unavailable because of a blocked relationship.';
  if (input.recipientDmPolicy === 'none') return 'This person does not accept calls.';
  if (input.recipientDmPolicy === 'friends' && !input.areMutualFriends) {
    return 'A mutual accepted follow is required before calling.';
  }
  return null;
}

export function isTerminalCallStatus(status: string) {
  return status === 'ended' || status === 'declined' || status === 'missed';
}
