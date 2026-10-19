import { describe, expect, it } from 'vitest';
import { createPostInsertPayload, POST_INSERT_COLUMNS } from './postInsertPayload';

describe('feed post insert payload', () => {
  it('matches only the columns granted to authenticated post creators', () => {
    expect(POST_INSERT_COLUMNS).toEqual([
      'id',
      'author_id',
      'caption',
      'hashtags',
      'video_path',
      'thumb_path',
      'duration_ms',
      'width',
      'height',
      'audience',
      'allow_comments',
      'auto_captions',
    ]);
  });

  it('omits status, counters, and server-managed timestamps', () => {
    const payload = createPostInsertPayload({
      id: 'post-id',
      author_id: 'author-id',
      caption: 'caption',
      hashtags: ['tag'],
      video_path: 'author-id/post-id.mp4',
      thumb_path: null,
      duration_ms: 1000,
      width: 720,
      height: 1280,
      audience: 'everyone',
      allow_comments: true,
      auto_captions: true,
    });

    expect(Object.keys(payload)).toEqual(POST_INSERT_COLUMNS);
  });
});
