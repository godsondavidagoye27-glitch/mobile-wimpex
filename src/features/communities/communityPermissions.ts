import type { CommunityRole } from '../../types/database';

export function canModerateCommunity(role: CommunityRole | null | undefined) {
  return role === 'owner' || role === 'moderator';
}

export function canBanCommunityMember(
  actorRole: CommunityRole | null | undefined,
  targetRole: CommunityRole | null | undefined,
) {
  if (!canModerateCommunity(actorRole) || !targetRole) return false;
  if (targetRole === 'owner') return false;
  return actorRole === 'owner' || targetRole !== 'moderator';
}

export function canChangeCommunityRole(
  actorRole: CommunityRole | null | undefined,
  targetRole: CommunityRole | null | undefined,
) {
  return actorRole === 'owner' && targetRole !== 'owner' && targetRole !== undefined;
}

export function canTransferCommunityOwnership(
  actorRole: CommunityRole | null | undefined,
  targetRole: CommunityRole | null | undefined,
) {
  return actorRole === 'owner' && targetRole !== 'owner' && targetRole !== undefined;
}

export function canLeaveCommunity(role: CommunityRole | null | undefined) {
  return role !== 'owner';
}

export function canDeleteCommunity(role: CommunityRole | null | undefined) {
  return role === 'owner';
}
