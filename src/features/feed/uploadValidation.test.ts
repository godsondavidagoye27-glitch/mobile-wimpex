import { describe, expect, it } from 'vitest';
import {
  extractHashtags,
  isVideoDraft,
  isVideoUploadJob,
  maxVideoDurationMs,
  maxVideoSizeBytes,
  validateVideo,
} from './uploadValidation';

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

  it('validates persisted upload jobs and drafts before hydrating them', () => {
    const metadata = {
      uri: 'file:///video.mp4',
      fileName: 'video.mp4',
      contentType: 'video/mp4',
      fileSize: 100,
      durationMs: 1000,
      width: 720,
      height: 1280,
    };
    const job = {
      ...metadata,
      id: 'job-id',
      ownerId: 'owner-id',
      postId: 'post-id',
      caption: '',
      hashtags: [],
      audience: 'everyone',
      allowComments: true,
      autoCaptions: false,
      scheduledAt: null,
      progress: 0,
      uploadUrl: null,
      state: 'queued',
      error: null,
    };
    const draft = { ...metadata, caption: '', audience: 'everyone', allowComments: true, autoCaptions: false };
    const emptyDraft = {
      uri: '',
      fileName: '',
      contentType: 'video/mp4',
      fileSize: 0,
      durationMs: 0,
      width: 0,
      height: 0,
      caption: '',
      audience: 'everyone',
      allowComments: true,
      autoCaptions: false,
    };

    expect(isVideoUploadJob(job)).toBe(true);
    expect(isVideoUploadJob({ ...job, progress: Number.NaN })).toBe(false);
    expect(isVideoDraft(draft)).toBe(true);
    expect(isVideoDraft(emptyDraft)).toBe(true);
    expect(isVideoDraft({ ...draft, width: 'wide' })).toBe(false);
  });
});
