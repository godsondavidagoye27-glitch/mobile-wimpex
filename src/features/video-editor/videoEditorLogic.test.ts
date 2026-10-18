import { describe, expect, it } from 'vitest';
import {
  clampTrimRange,
  initialTrimRange,
  needsVideoReencode,
  slideTrimRange,
} from './videoEditorLogic';

describe('video editor trim range', () => {
  it('opens with a max-length window for a long video', () => {
    expect(initialTrimRange(180_000, 60_000)).toEqual({ startMs: 0, endMs: 60_000 });
  });

  it('clamps a window without exceeding the duration or maximum', () => {
    expect(clampTrimRange({ startMs: 55_000, endMs: 180_000 }, 120_000, 60_000))
      .toEqual({ startMs: 55_000, endMs: 115_000 });
    expect(clampTrimRange({ startMs: 100_000, endMs: 180_000 }, 120_000, 60_000))
      .toEqual({ startMs: 60_000, endMs: 120_000 });
  });

  it('enforces a minimum one-second selection', () => {
    expect(clampTrimRange({ startMs: 4_000, endMs: 4_100 }, 20_000, 60_000))
      .toEqual({ startMs: 4_000, endMs: 5_000 });
  });

  it('slides the selected window while clamping to either end', () => {
    const range = { startMs: 30_000, endMs: 60_000 };
    expect(slideTrimRange(range, 20_000, 80_000)).toEqual({ startMs: 50_000, endMs: 80_000 });
    expect(slideTrimRange(range, -50_000, 80_000)).toEqual({ startMs: 0, endMs: 30_000 });
  });
});

describe('video editor re-encode decision', () => {
  const common = { maxSizeBytes: 10_000_000, mute: false, sourceMimeType: 'video/avc' };

  it('stream-copies an in-limit H.264 trim without mute', () => {
    expect(needsVideoReencode({ ...common, trimmedSizeBytes: 9_000_000 })).toBe(false);
  });

  it('re-encodes when the trim exceeds the size cap', () => {
    expect(needsVideoReencode({ ...common, trimmedSizeBytes: 11_000_000 })).toBe(true);
  });

  it('re-encodes non-H.264 inputs and muted exports', () => {
    expect(needsVideoReencode({
      ...common,
      sourceMimeType: 'video/hevc',
      trimmedSizeBytes: 2_000_000,
    })).toBe(true);
    expect(needsVideoReencode({ ...common, mute: true, trimmedSizeBytes: 2_000_000 })).toBe(true);
  });
});
