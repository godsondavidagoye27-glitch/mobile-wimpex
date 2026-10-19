import { describe, expect, it } from 'vitest';
import { averageWatchPercent, creatorAnalyticsStart } from './creatorAnalytics';

describe('creator analytics calculations', () => {
  it('uses an exact rolling period start', () => {
    expect(creatorAnalyticsStart(7, new Date('2026-10-19T12:00:00.000Z')))
      .toBe('2026-10-12T12:00:00.000Z');
  });

  it('averages capped watch percentages per viewer session', () => {
    expect(averageWatchPercent([
      { sessionId: 'a', postId: 'p', userId: 'u1', watchMs: 4000, durationMs: 8000 },
      { sessionId: 'a', postId: 'p', userId: 'u1', watchMs: 2000, durationMs: 8000 },
      { sessionId: 'b', postId: 'p', userId: 'u2', watchMs: 12000, durationMs: 8000 },
    ])).toBe(88);
  });

  it('returns zero when no valid watch samples exist', () => {
    expect(averageWatchPercent([
      { sessionId: 'a', postId: 'p', userId: 'u1', watchMs: -1, durationMs: 8000 },
    ])).toBe(0);
  });
});
