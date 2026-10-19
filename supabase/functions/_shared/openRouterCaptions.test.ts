import { describe, expect, it } from 'vitest';
import { parseWebVtt } from '../../../src/features/captions/vtt';
import { parseOpenRouterTranscript } from './openRouterCaptions';

describe('parseOpenRouterTranscript', () => {
  it('creates timed WebVTT from OpenRouter segment timestamps', () => {
    const result = parseOpenRouterTranscript({
      text: 'Hello there.',
      language: 'en',
      segments: [{ start: 0.125, end: 1.5, text: 'Hello there.' }],
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.language).toBe('en');
    expect(parseWebVtt(result.captions)).toEqual([
      { startMs: 125, endMs: 1500, text: 'Hello there.' },
    ]);
  });

  it('reports no speech without requiring timestamp segments', () => {
    expect(parseOpenRouterTranscript({ text: '  ', segments: [] })).toEqual({ status: 'no_speech' });
  });

  it('rejects non-empty transcripts without usable timed segments', () => {
    expect(() => parseOpenRouterTranscript({ text: 'words only' })).toThrow();
    expect(() => parseOpenRouterTranscript({
      text: 'words',
      segments: [{ start: 2, end: 1, text: 'invalid' }],
    })).toThrow();
  });
});
