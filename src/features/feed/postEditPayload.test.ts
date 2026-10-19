import { describe, expect, it } from 'vitest';
import { createPostEditPayload } from './postEditPayload';

describe('published post edit payload', () => {
  it('contains only the fields users are allowed to edit', () => {
    const payload = createPostEditPayload({
      caption: 'A #Cafe stop and #travel',
      audience: 'followers',
      allow_comments: false,
      auto_captions: true,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'allow_comments',
      'audience',
      'auto_captions',
      'caption',
      'hashtags',
    ]);
    expect(payload).toEqual({
      caption: 'A #Cafe stop and #travel',
      hashtags: ['cafe', 'travel'],
      audience: 'followers',
      allow_comments: false,
      auto_captions: true,
    });
  });
});
