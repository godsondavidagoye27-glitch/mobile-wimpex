export type TrimRange = {
  startMs: number;
  endMs: number;
};

export function clampTrimRange(
  range: TrimRange,
  durationMs: number,
  maxDurationMs: number,
  minDurationMs = 1000,
): TrimRange {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('The video duration could not be read.');
  }
  const minimum = Math.min(Math.max(1, minDurationMs), durationMs);
  const maximum = Math.min(
    durationMs,
    Number.isFinite(maxDurationMs) && maxDurationMs > 0 ? maxDurationMs : durationMs,
  );
  if (maximum < minimum) {
    throw new Error('The video is shorter than the minimum clip length.');
  }

  const length = Math.min(maximum, Math.max(minimum, range.endMs - range.startMs));
  const startMs = Math.min(Math.max(0, range.startMs), durationMs - length);
  return { startMs, endMs: startMs + length };
}

export function initialTrimRange(durationMs: number, maxDurationMs: number): TrimRange {
  return clampTrimRange(
    { startMs: 0, endMs: durationMs },
    durationMs,
    maxDurationMs,
  );
}

export function slideTrimRange(range: TrimRange, deltaMs: number, durationMs: number): TrimRange {
  const length = range.endMs - range.startMs;
  const startMs = Math.min(
    Math.max(0, range.startMs + deltaMs),
    Math.max(0, durationMs - length),
  );
  return { startMs, endMs: startMs + length };
}

export function needsVideoReencode({
  trimmedSizeBytes,
  maxSizeBytes,
  mute,
  sourceMimeType,
}: {
  trimmedSizeBytes: number;
  maxSizeBytes: number;
  mute: boolean;
  sourceMimeType: string | null | undefined;
}): boolean {
  const h264 = /(?:avc|h264)/i.test(sourceMimeType ?? '');
  return mute || !h264 || trimmedSizeBytes > maxSizeBytes;
}
