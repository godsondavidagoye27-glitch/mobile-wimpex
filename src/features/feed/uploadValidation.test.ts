import { describe, expect, it } from 'vitest';
import { extractHashtags, maxVideoDurationMs, maxVideoSizeBytes, validateVideo } from './uploadValidation';

describe('video upload validation', () => {
  it('accepts videos within the duration and size limits', () => {
    expect(validateVideo({ durationMs: maxVideoDurationMs, sizeBytes: maxVideoSizeBytes })).toBeNull();
  });

  it('rejects videos longer than 60 seconds', () => {
    expect(validateVideo({ durationMs: maxVideoDurationMs + 1, sizeBytes: 1 })).toBe(
      'Videos must be 60 seconds or shorter.',
    );
  });

  it('rejects videos larger than 50 MB', () => {
    expect(validateVideo({ durationMs: 1, sizeBytes: maxVideoSizeBytes + 1 })).toBe(
      'Videos must be 50 MB or smaller.',
    );
  });

  it('rejects missing video metadata', () => {
    expect(validateVideo({ durationMs: 0, sizeBytes: 1 })).toBe(
      'Could not read the video duration. Choose another video.',
    );
    expect(validateVideo({ durationMs: 1, sizeBytes: Number.NaN })).toBe(
      'Could not read the video size. Choose another video.',
    );
  });

  it('extracts unique lowercase hashtags from captions', () => {
    expect(extractHashtags('Walk #Morning #coffee #MORNING')).toEqual(['morning', 'coffee']);
  });
});
