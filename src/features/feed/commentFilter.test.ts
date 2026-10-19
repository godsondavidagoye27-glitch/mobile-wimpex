import { describe, expect, it } from 'vitest';
import { findHiddenPhrase, matchesHiddenPhrase } from './commentFilter';

describe('hidden comment phrase matching', () => {
  it('matches without regard to case or accents', () => {
    expect(matchesHiddenPhrase('That CAFÉ was great', 'cafe')).toBe(true);
  });

  it('matches phrases on word boundaries but not inside other words', () => {
    expect(matchesHiddenPhrase('Please leave me alone', 'leave me')).toBe(true);
    expect(matchesHiddenPhrase('beliefs are personal', 'lie')).toBe(false);
  });

  it('ignores empty phrases and finds the first matching phrase', () => {
    expect(matchesHiddenPhrase('nothing here', '   ')).toBe(false);
    expect(findHiddenPhrase('a very bad phrase', ['', 'bad phrase', 'very bad'])).toBe('bad phrase');
  });
});
