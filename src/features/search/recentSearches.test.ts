import { describe, expect, it } from 'vitest';
import { addRecentSearch, normalizeRecentSearches, recentSearchLimit, removeRecentSearch } from './recentSearches';

describe('recent searches', () => {
  it('trims, deduplicates case-insensitively, and caps saved searches at ten', () => {
    const searches = Array.from({ length: 12 }, (_, index) => ` query ${index} `);
    expect(normalizeRecentSearches(searches)).toHaveLength(recentSearchLimit);
    expect(normalizeRecentSearches([' Coffee ', 'coffee', 'tea'])).toEqual(['Coffee', 'tea']);
  });

  it('moves a repeated search to the front', () => {
    expect(addRecentSearch(['tea', 'coffee'], ' Coffee ')).toEqual(['Coffee', 'tea']);
  });

  it('removes a search without changing the others', () => {
    expect(removeRecentSearch(['tea', 'coffee'], 'COFFEE')).toEqual(['tea']);
  });

  it('rejects malformed stored values', () => {
    expect(() => normalizeRecentSearches('coffee')).toThrow('invalid format');
    expect(() => normalizeRecentSearches([null])).toThrow('invalid format');
  });
});
