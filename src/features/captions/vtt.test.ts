import { describe, expect, it } from 'vitest';
import {
  findVttCue,
  normalizeWebVtt,
  parseWebVtt,
  validateVttRewrite,
  writeWebVtt,
} from './vtt';

describe('WebVTT utilities', () => {
  it('parses BOM, hours, milliseconds, cue settings and multiline cues', () => {
    const cues = parseWebVtt(
      '\uFEFFWEBVTT\n\nintro\n01:02:03.250 --> 01:02:05.500 align:start position:10%\nFirst line\nSecond line\n',
    );

    expect(cues).toEqual([{
      id: 'intro',
      startMs: 3_723_250,
      endMs: 3_725_500,
      text: 'First line\nSecond line',
    }]);
  });

  it('accepts minute and second timestamps and finds the active cue', () => {
    const cues = parseWebVtt('WEBVTT\n\n00:01.000 --> 00:03.000\nHello\n');
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 3000 });
    expect(findVttCue(cues, 1.5)?.text).toBe('Hello');
    expect(findVttCue(cues, 3)).toBeNull();
  });

  it('does not throw on malformed input and omits invalid cues', () => {
    expect(() => parseWebVtt('WEBVTT\n\nnot a timestamp\nbad cue\n')).not.toThrow();
    expect(parseWebVtt('WEBVTT\n\nnot a timestamp\nbad cue\n')).toEqual([]);
    expect(parseWebVtt('WEBVTT\n\n00:00.000 --> 00:00.000\nEmpty duration\n')).toEqual([]);
  });

  it('writes parseable WebVTT and locks cue timing during edits', () => {
    const original = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOriginal\n';
    const cue = parseWebVtt(original)[0];
    const rewritten = writeWebVtt([{ ...cue, text: 'Edited' }]);
    expect(parseWebVtt(rewritten)[0].text).toBe('Edited');
    expect(validateVttRewrite(original, rewritten).valid).toBe(true);
    expect(validateVttRewrite(
      original,
      'WEBVTT\n\n00:00:01.100 --> 00:00:03.000\nEdited\n',
    )).toMatchObject({ valid: false, error: 'Caption timing cannot be changed.' });
  });

  it('rejects rewritten captions that exceed the text constraints', () => {
    const original = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOriginal\n';
    expect(validateVttRewrite(
      original,
      `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n${'x'.repeat(85)}\n`,
    ).valid).toBe(false);
    expect(validateVttRewrite(
      original,
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOne\nTwo\nThree\n',
    ).valid).toBe(false);
  });

  it('keeps normalized cue times within the provider timing range', () => {
    const source = parseWebVtt(
      `WEBVTT\n\n00:00:01.000 --> 00:00:06.000\n${'A sentence with enough words to make more than one line '.repeat(4)}\n`,
    );
    const normalized = normalizeWebVtt(source);

    expect(normalized.length).toBeGreaterThan(1);
    expect(normalized[0].startMs).toBe(source[0].startMs);
    expect(normalized.at(-1)?.endMs).toBe(source[0].endMs);
    expect(normalized.every((cue, index) =>
      cue.endMs > cue.startMs && (index === 0 || normalized[index - 1].endMs <= cue.startMs),
    )).toBe(true);
  });
});
