import { describe, expect, it } from 'vitest';
import { getNextFeedCursor, mergeFeedPages, updateFeedItem } from './feedPagination';

const row = (id: string, publishedAt: string) => ({
  post: { id, published_at: publishedAt },
});

describe('feed keyset pagination', () => {
  it('uses the last row as the next keyset cursor', () => {
    expect(getNextFeedCursor([
      row('newer', '2026-10-13T00:00:00Z'),
      row('older', '2026-10-12T00:00:00Z'),
    ])).toEqual({
      id: 'older',
      publishedAt: '2026-10-12T00:00:00Z',
    });
  });

  it('merges pages in order without duplicate post ids', () => {
    expect(mergeFeedPages([
      [row('one', '2026-10-13T00:00:00Z'), row('two', '2026-10-12T00:00:00Z')],
      [row('two', '2026-10-12T00:00:00Z'), row('three', '2026-10-11T00:00:00Z')],
    ])).toEqual([
      row('one', '2026-10-13T00:00:00Z'),
      row('two', '2026-10-12T00:00:00Z'),
      row('three', '2026-10-11T00:00:00Z'),
    ]);
  });

  it('updates the matching post without changing the other feed rows', () => {
    const items = [
      { ...row('one', '2026-10-13T00:00:00Z'), is_liked: false },
      { ...row('two', '2026-10-12T00:00:00Z'), is_liked: true },
    ];
    expect(updateFeedItem(items, 'one', (item) => ({ ...item, is_liked: true }))).toEqual([
      { ...items[0], is_liked: true },
      items[1],
    ]);
  });
});
