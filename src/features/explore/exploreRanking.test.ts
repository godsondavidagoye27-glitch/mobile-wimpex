import { describe, expect, it } from 'vitest';
import {
  isExploreProfileEligible,
  rankExploreCreators,
  rankSuggestedAccounts,
} from './exploreRanking';

describe('Explore ranking and eligibility', () => {
  it('ranks creators by activity score with stable username and id ties', () => {
    const rows = [
      { id: 'b', username: 'bea', display_name: 'Bea', avatar_url: null, is_private: false, followers_count: 10, popularity_score: 24, published_post_count: 1 },
      { id: 'c', username: 'amy', display_name: 'Amy 2', avatar_url: null, is_private: false, followers_count: 10, popularity_score: 24, published_post_count: 1 },
      { id: 'a', username: 'amy', display_name: 'Amy 1', avatar_url: null, is_private: false, followers_count: 10, popularity_score: 24, published_post_count: 1 },
      { id: 'd', username: 'zed', display_name: 'Zed', avatar_url: null, is_private: false, followers_count: 10, popularity_score: 30, published_post_count: 1 },
    ];

    expect(rankExploreCreators(rows).map((row) => row.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('ranks suggested accounts by mutual follows, shared interests, and audience size', () => {
    const rows = [
      { id: 'a', username: 'a', display_name: 'A', avatar_url: null, is_private: false, followers_count: 40, mutual_follows: 1, shared_interests: 2 },
      { id: 'b', username: 'b', display_name: 'B', avatar_url: null, is_private: false, followers_count: 5, mutual_follows: 2, shared_interests: 0 },
      { id: 'c', username: 'c', display_name: 'C', avatar_url: null, is_private: false, followers_count: 60, mutual_follows: 1, shared_interests: 2 },
    ];

    expect(rankSuggestedAccounts(rows).map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('excludes private, under-18, and blocked profiles', () => {
    expect(isExploreProfileEligible({ isPrivate: false, isMinor: false, isBlocked: false })).toBe(true);
    expect(isExploreProfileEligible({ isPrivate: true, isMinor: false, isBlocked: false })).toBe(false);
    expect(isExploreProfileEligible({ isPrivate: false, isMinor: true, isBlocked: false })).toBe(false);
    expect(isExploreProfileEligible({ isPrivate: false, isMinor: false, isBlocked: true })).toBe(false);
  });
});
