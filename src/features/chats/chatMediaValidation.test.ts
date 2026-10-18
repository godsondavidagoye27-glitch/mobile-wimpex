import { describe, expect, it } from 'vitest';
import {
  maxChatMediaSizeBytes,
  maxChatVideoDurationMs,
  maxChatVoiceDurationMs,
  extensionFor,
  validateChatMedia,
  type ChatMediaAttachment,
} from './chatMediaValidation';

function attachment(overrides: Partial<ChatMediaAttachment> = {}): ChatMediaAttachment {
  return {
    kind: 'image',
    uri: 'file:///photo.jpg',
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    durationMs: null,
    width: 640,
    height: 480,
    ...overrides,
  };
}

describe('chat media validation', () => {
  it('accepts supported images, videos, and recorded audio within limits', () => {
    expect(validateChatMedia(attachment({ sizeBytes: maxChatMediaSizeBytes }))).toBeNull();
    expect(validateChatMedia(attachment({
      kind: 'video',
      contentType: 'video/mp4',
      durationMs: maxChatVideoDurationMs,
    }))).toBeNull();
    expect(validateChatMedia(attachment({
      kind: 'voice',
      contentType: 'audio/webm',
      durationMs: maxChatVoiceDurationMs,
      width: null,
      height: null,
    }))).toBeNull();
  });

  it.each([
    ['audio/mpeg', 'mp3'],
    ['audio/aac', 'aac'],
    ['audio/3gpp', '3gp'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'm4a'],
    ['audio/webm', 'webm'],
  ])('accepts %s and maps it to .%s', (contentType, extension) => {
    const voice = attachment({
      kind: 'voice',
      fileName: 'voice',
      contentType,
      durationMs: 1000,
      width: null,
      height: null,
    });
    expect(validateChatMedia(voice)).toBeNull();
    expect(extensionFor(voice)).toBe(extension);
  });

  it('rejects missing, non-finite, or oversized attachments', () => {
    expect(validateChatMedia(attachment({ sizeBytes: 0 }))).toContain('size');
    expect(validateChatMedia(attachment({ sizeBytes: Number.NaN }))).toContain('size');
    expect(validateChatMedia(attachment({ sizeBytes: maxChatMediaSizeBytes + 1 }))).toContain('25 MB');
  });

  it('rejects unsupported or mismatched MIME types', () => {
    expect(validateChatMedia(attachment({ contentType: 'image/svg+xml' }))).toContain('not supported');
    expect(validateChatMedia(attachment({
      kind: 'video',
      contentType: 'video/quicktime',
      durationMs: 1000,
    }))).toContain('not supported');
  });

  it('rejects videos without a valid duration or over the duration cap', () => {
    expect(validateChatMedia(attachment({
      kind: 'video',
      contentType: 'video/mp4',
      durationMs: null,
    }))).toContain('duration');
    expect(validateChatMedia(attachment({
      kind: 'video',
      contentType: 'video/mp4',
      durationMs: maxChatVideoDurationMs + 1,
    }))).toContain('60 seconds');
  });

  it('rejects invalid or overlong voice recordings', () => {
    expect(validateChatMedia(attachment({
      kind: 'voice',
      contentType: 'audio/mp4',
      durationMs: 0,
      width: null,
      height: null,
    }))).toContain('duration');
    expect(validateChatMedia(attachment({
      kind: 'voice',
      contentType: 'audio/mp4',
      durationMs: maxChatVoiceDurationMs + 1,
      width: null,
      height: null,
    }))).toContain('2 minutes');
  });
});
