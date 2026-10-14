import { describe, expect, it } from 'vitest';
import {
  canBanCommunityMember,
  canChangeCommunityRole,
  canDeleteCommunity,
  canLeaveCommunity,
  canModerateCommunity,
  canTransferCommunityOwnership,
} from './communityPermissions';

describe('community role permissions', () => {
  it('allows only active owner and moderator roles to moderate', () => {
    expect(canModerateCommunity('owner')).toBe(true);
    expect(canModerateCommunity('moderator')).toBe(true);
    expect(canModerateCommunity('member')).toBe(false);
    expect(canModerateCommunity(null)).toBe(false);
  });

  it('prevents moderators from banning the owner or another moderator', () => {
    expect(canBanCommunityMember('moderator', 'member')).toBe(true);
    expect(canBanCommunityMember('moderator', 'moderator')).toBe(false);
    expect(canBanCommunityMember('moderator', 'owner')).toBe(false);
    expect(canBanCommunityMember('member', 'member')).toBe(false);
    expect(canBanCommunityMember('owner', 'moderator')).toBe(true);
  });

  it('reserves role changes and ownership transfer for the owner', () => {
    expect(canChangeCommunityRole('owner', 'member')).toBe(true);
    expect(canChangeCommunityRole('owner', 'owner')).toBe(false);
    expect(canChangeCommunityRole('moderator', 'member')).toBe(false);
    expect(canTransferCommunityOwnership('owner', 'member')).toBe(true);
    expect(canTransferCommunityOwnership('moderator', 'member')).toBe(false);
  });

  it('prevents the owner from leaving or deleting without the appropriate action', () => {
    expect(canLeaveCommunity('owner')).toBe(false);
    expect(canLeaveCommunity('moderator')).toBe(true);
    expect(canDeleteCommunity('owner')).toBe(true);
    expect(canDeleteCommunity('moderator')).toBe(false);
  });
});
