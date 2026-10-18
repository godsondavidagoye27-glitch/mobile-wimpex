import { describe, expect, it } from 'vitest';
import { getVideoExtension } from './videoExtension';

describe('getVideoExtension', () => {
  it('preserves QuickTime MOV uploads by MIME type or file extension', () => {
    expect(getVideoExtension('clip', 'video/quicktime')).toBe('mov');
    expect(getVideoExtension('clip.MOV', 'video/mp4')).toBe('mov');
  });

  it('uses MP4 for other video files', () => {
    expect(getVideoExtension('clip.mp4', 'video/mp4')).toBe('mp4');
    expect(getVideoExtension('clip', null)).toBe('mp4');
  });
});
