import type { VideoDraft, VideoUploadJob } from './uploadManager';

export const maxVideoDurationMs = 60_000;
export const maxVideoSizeBytes = 50 * 1024 * 1024;

export type VideoMetadata = {
  durationMs: number;
  sizeBytes: number;
};

export function validateVideo(metadata: VideoMetadata): string | null {
  if (!Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0) {
    return 'Could not read the video duration. Choose another video.';
  }
  if (metadata.durationMs > maxVideoDurationMs) {
    return 'Videos must be 60 seconds or shorter.';
  }
  if (!Number.isFinite(metadata.sizeBytes) || metadata.sizeBytes <= 0) {
    return 'Could not read the video size. Choose another video.';
  }
  if (metadata.sizeBytes > maxVideoSizeBytes) {
    return 'Videos must be 50 MB or smaller.';
  }
  return null;
}

export function extractHashtags(caption: string): string[] {
  return [...new Set(caption.match(/#[\p{L}\p{N}_]+/gu)?.map((tag) => tag.slice(1).toLowerCase()) ?? [])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasValidVideoMetadata(value: Record<string, unknown>) {
  return typeof value.uri === 'string'
    && typeof value.fileName === 'string'
    && typeof value.contentType === 'string'
    && typeof value.fileSize === 'number'
    && Number.isFinite(value.fileSize)
    && value.fileSize > 0
    && typeof value.durationMs === 'number'
    && Number.isFinite(value.durationMs)
    && value.durationMs > 0
    && typeof value.width === 'number'
    && Number.isFinite(value.width)
    && value.width > 0
    && typeof value.height === 'number'
    && Number.isFinite(value.height)
    && value.height > 0;
}

export function isVideoUploadJob(value: unknown): value is VideoUploadJob {
  if (!isRecord(value) || !hasValidVideoMetadata(value)) return false;
  return typeof value.id === 'string'
    && typeof value.ownerId === 'string'
    && typeof value.postId === 'string'
    && typeof value.caption === 'string'
    && isStringArray(value.hashtags)
    && (value.audience === 'everyone' || value.audience === 'followers')
    && typeof value.allowComments === 'boolean'
    && typeof value.autoCaptions === 'boolean'
    && (value.scheduledAt === undefined || value.scheduledAt === null || typeof value.scheduledAt === 'string')
    && typeof value.progress === 'number'
    && Number.isFinite(value.progress)
    && (value.uploadUrl === null || typeof value.uploadUrl === 'string')
    && (value.state === 'queued' || value.state === 'uploading' || value.state === 'failed')
    && (value.error === null || typeof value.error === 'string');
}

export function isVideoDraft(value: unknown): value is VideoDraft {
  if (!isRecord(value)) return false;
  const isEmptyDraft = value.uri === ''
    && value.fileName === ''
    && typeof value.contentType === 'string'
    && value.fileSize === 0
    && value.durationMs === 0
    && value.width === 0
    && value.height === 0;
  if (!isEmptyDraft && !hasValidVideoMetadata(value)) return false;
  const editSettings = value.editSettings;
  const hasValidEditSettings = editSettings === undefined
    || (
      isRecord(editSettings)
      && typeof editSettings.startMs === 'number'
      && Number.isFinite(editSettings.startMs)
      && editSettings.startMs >= 0
      && typeof editSettings.endMs === 'number'
      && Number.isFinite(editSettings.endMs)
      && editSettings.endMs > editSettings.startMs
      && typeof editSettings.muted === 'boolean'
    );
  return typeof value.caption === 'string'
    && (value.audience === 'everyone' || value.audience === 'followers')
    && typeof value.allowComments === 'boolean'
    && typeof value.autoCaptions === 'boolean'
    && hasValidEditSettings;
}
