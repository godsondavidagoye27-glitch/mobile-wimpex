export const MAX_STORY_HIGHLIGHTS = 20;
export const MAX_STORIES_PER_HIGHLIGHT = 100;
export const MAX_STORY_HIGHLIGHT_TITLE_LENGTH = 40;

export type HighlightAudience = 'everyone' | 'followers' | 'close_friends';

export type HighlightAccessFacts = {
  viewerId: string | null;
  ownerId: string;
  ownerIsPrivate: boolean;
  audience: HighlightAudience;
  isAcceptedFollower: boolean;
  isCloseFriend: boolean;
  isBlocked: boolean;
};

export function validateStoryHighlightTitle(title: string): string | null {
  const normalized = title.trim();
  if (!normalized) return 'Enter a name for this highlight.';
  if (normalized.length > MAX_STORY_HIGHLIGHT_TITLE_LENGTH) {
    return `Highlight names must be ${MAX_STORY_HIGHLIGHT_TITLE_LENGTH} characters or fewer.`;
  }
  return null;
}

export function canCreateStoryHighlight(highlightCount: number): boolean {
  return Number.isInteger(highlightCount)
    && highlightCount >= 0
    && highlightCount < MAX_STORY_HIGHLIGHTS;
}

export function canAddStoryToHighlight(itemCount: number): boolean {
  return Number.isInteger(itemCount)
    && itemCount >= 0
    && itemCount < MAX_STORIES_PER_HIGHLIGHT;
}

export function canViewStoryHighlight(facts: HighlightAccessFacts): boolean {
  if (!facts.viewerId) return false;
  if (facts.viewerId === facts.ownerId) return true;
  if (facts.isBlocked) return false;
  if (facts.ownerIsPrivate && !facts.isAcceptedFollower) return false;

  if (facts.audience === 'everyone') return true;
  if (facts.audience === 'followers') return facts.isAcceptedFollower;
  return facts.isCloseFriend;
}

export function canViewStoryHighlightItem(
  facts: HighlightAccessFacts,
  sourceAudience: HighlightAudience,
): boolean {
  if (!canViewStoryHighlight(facts)) return false;
  if (facts.viewerId === facts.ownerId || sourceAudience === 'everyone') return true;
  if (sourceAudience === 'followers') return facts.isAcceptedFollower;
  return facts.isCloseFriend;
}

export function reorderHighlightIds(ids: string[], highlightId: string, newOrder: number): string[] {
  const oldOrder = ids.indexOf(highlightId);
  if (oldOrder < 0 || !Number.isInteger(newOrder) || newOrder < 0 || newOrder >= ids.length) {
    return ids;
  }
  const reordered = [...ids];
  reordered.splice(oldOrder, 1);
  reordered.splice(newOrder, 0, highlightId);
  return reordered;
}
