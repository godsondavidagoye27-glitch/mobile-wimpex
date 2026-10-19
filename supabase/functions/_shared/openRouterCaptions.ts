import {
  normalizeWebVtt,
  writeWebVtt,
  type VttCue,
} from '../../../src/features/captions/vtt.ts';

export type OpenRouterCaptionResult =
  | { status: 'no_speech' }
  | { status: 'ready'; captions: string; language: string | null };

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export function parseOpenRouterTranscript(payload: unknown): OpenRouterCaptionResult {
  if (!isRecord(payload) || typeof payload.text !== 'string') {
    throw new Error('Transcription response is missing text.');
  }
  if (!payload.text.trim()) return { status: 'no_speech' };
  if (!Array.isArray(payload.segments)) {
    throw new Error('Transcription response is missing timed segments.');
  }

  const segments = payload.segments.filter(isTranscriptSegment);
  if (segments.length === 0) {
    throw new Error('Transcription response has no valid timed segments.');
  }

  const cues: VttCue[] = segments
    .map((segment) => ({
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      text: segment.text.trim(),
    }))
    .filter((cue) => cue.endMs > cue.startMs && cue.text.length > 0)
    .sort((first, second) => first.startMs - second.startMs);
  if (cues.length === 0) throw new Error('Transcription response has no usable timed segments.');

  const captions = writeWebVtt(normalizeWebVtt(cues));
  if (new TextEncoder().encode(captions).byteLength > 204_800) {
    throw new Error('Generated captions exceed the supported size.');
  }
  return {
    status: 'ready',
    captions,
    language: typeof payload.language === 'string' ? payload.language : null,
  };
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (!isRecord(value)) return false;
  return typeof value.start === 'number'
    && Number.isFinite(value.start)
    && value.start >= 0
    && typeof value.end === 'number'
    && Number.isFinite(value.end)
    && value.end > value.start
    && typeof value.text === 'string'
    && value.text.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
