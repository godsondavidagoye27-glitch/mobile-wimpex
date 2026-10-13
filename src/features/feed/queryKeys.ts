export type FeedMode = 'for_you' | 'following';

export const queryKeys = {
  all: ['wimpex'] as const,
  feed: (mode: FeedMode) => ['feed', mode] as const,
};
