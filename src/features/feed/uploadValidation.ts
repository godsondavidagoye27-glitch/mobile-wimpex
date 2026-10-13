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
