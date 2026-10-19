import { describe, expect, it } from 'vitest';
import {
  canAddStoryToHighlight,
  canCreateStoryHighlight,
  canViewStoryHighlight,
  canViewStoryHighlightItem,
  MAX_STORIES_PER_HIGHLIGHT,
  MAX_STORY_HIGHLIGHTS,
  reorderHighlightIds,
  validateStoryHighlightTitle,
  type HighlightAccessFacts,
} from './highlightLogic';

describe('story highlight lifecycle rules', () => {
  it('validates names and enforces collection and item limits', () => {
    expect(validateStoryHighlightTitle('   ')).toBe('Enter a name for this highlight.');
    expect(validateStoryHighlightTitle('  Summer  ')).toBeNull();
    expect(validateStoryHighlightTitle('a'.repeat(41))).toContain('40 characters');
    expect(canCreateStoryHighlight(MAX_STORY_HIGHLIGHTS - 1)).toBe(true);
    expect(canCreateStoryHighlight(MAX_STORY_HIGHLIGHTS)).toBe(false);
    expect(canAddStoryToHighlight(MAX_STORIES_PER_HIGHLIGHT - 1)).toBe(true);
    expect(canAddStoryToHighlight(MAX_STORIES_PER_HIGHLIGHT)).toBe(false);
  });

  it('moves an owned highlight while preserving the order of others', () => {
    expect(reorderHighlightIds(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(reorderHighlightIds(['a', 'b', 'c'], 'missing', 1)).toEqual(['a', 'b', 'c']);
    expect(reorderHighlightIds(['a', 'b'], 'a', 4)).toEqual(['a', 'b']);
  });
});

describe('story highlight permission rules', () => {
  const base: HighlightAccessFacts = {
    viewerId: 'viewer',
    ownerId: 'owner',
    ownerIsPrivate: false,
    audience: 'everyone',
    isAcceptedFollower: false,
    isCloseFriend: false,
    isBlocked: false,
  };

  it('allows owners and public viewers unless blocked', () => {
    expect(canViewStoryHighlight({ ...base, viewerId: 'owner' })).toBe(true);
    expect(canViewStoryHighlight(base)).toBe(true);
    expect(canViewStoryHighlight({ ...base, isBlocked: true })).toBe(false);
  });

  it('requires accepted follows for private owners and follower highlights', () => {
    expect(canViewStoryHighlight({ ...base, ownerIsPrivate: true })).toBe(false);
    expect(canViewStoryHighlight({ ...base, ownerIsPrivate: true, isAcceptedFollower: true })).toBe(true);
    expect(canViewStoryHighlight({ ...base, audience: 'followers' })).toBe(false);
    expect(canViewStoryHighlight({ ...base, audience: 'followers', isAcceptedFollower: true })).toBe(true);
  });

  it('restricts close-friends highlights to close friends', () => {
    expect(canViewStoryHighlight({ ...base, audience: 'close_friends' })).toBe(false);
    expect(canViewStoryHighlight({ ...base, audience: 'close_friends', isCloseFriend: true })).toBe(true);
    expect(canViewStoryHighlight({ ...base, viewerId: null, isCloseFriend: true })).toBe(false);
  });

  it('keeps saved stories within the source story audience', () => {
    expect(canViewStoryHighlightItem(base, 'everyone')).toBe(true);
    expect(canViewStoryHighlightItem(base, 'close_friends')).toBe(false);
    expect(canViewStoryHighlightItem({ ...base, isCloseFriend: true }, 'close_friends')).toBe(true);
    expect(canViewStoryHighlightItem({ ...base, isBlocked: true, isCloseFriend: true }, 'close_friends')).toBe(false);
  });
});
