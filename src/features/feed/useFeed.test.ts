import { describe, expect, it } from 'vitest';
import { mapSignedUrlResults } from './signedUrls';

describe('signed video URLs', () => {
  it('keeps successful URLs and leaves failed paths null', () => {
    const mapped = mapSignedUrlResults(
      ['user/available.mp4', 'user/unavailable.mp4'],
      [
        { path: 'user/available.mp4', signedUrl: 'https://example.test/video.mp4' },
        { path: 'user/unavailable.mp4', signedUrl: null, error: new Error('Missing object') },
      ],
    );

    expect(mapped.get('user/available.mp4')).toBe('https://example.test/video.mp4');
    expect(mapped.get('user/unavailable.mp4')).toBeNull();
  });

  it('leaves every requested path null when the response has no entries', () => {
    expect(mapSignedUrlResults(['user/video.mp4'], null).get('user/video.mp4')).toBeNull();
  });
});
