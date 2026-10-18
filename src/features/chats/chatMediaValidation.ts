export const maxChatMediaSizeBytes = 25 * 1024 * 1024;
export const maxChatVideoDurationMs = 60_000;
export const maxChatVoiceDurationMs = 120_000;

export type ChatMediaKind = 'image' | 'video' | 'voice';

export type ChatMediaAttachment = {
  kind: ChatMediaKind;
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

const allowedChatMediaTypes: Record<ChatMediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4'],
  voice: ['audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/mpeg', 'audio/aac', 'audio/3gpp', 'audio/ogg'],
};

export function extensionFor(attachment: ChatMediaAttachment): string {
  if (attachment.kind === 'image') return 'jpg';
  if (attachment.kind === 'video') return 'mp4';
  switch (attachment.contentType.toLowerCase()) {
    case 'audio/webm': return 'webm';
    case 'audio/mpeg': return 'mp3';
    case 'audio/aac': return 'aac';
    case 'audio/3gpp': return '3gp';
    case 'audio/ogg': return 'ogg';
    default: return 'm4a';
  }
}

export function validateChatMedia(attachment: ChatMediaAttachment): string | null {
  if (!Number.isFinite(attachment.sizeBytes) || attachment.sizeBytes <= 0) {
    return 'Could not read the attachment size. Choose or record it again.';
  }
  if (attachment.sizeBytes > maxChatMediaSizeBytes) {
    return 'Chat attachments must be 25 MB or smaller.';
  }
  if (!allowedChatMediaTypes[attachment.kind].includes(attachment.contentType.toLowerCase())) {
    return 'This file type is not supported in chat.';
  }
  if (attachment.kind === 'video') {
    if (!Number.isFinite(attachment.durationMs) || !attachment.durationMs || attachment.durationMs <= 0) {
      return 'Could not read the video duration. Choose another video.';
    }
    if (attachment.durationMs > maxChatVideoDurationMs) {
      return 'Chat videos must be 60 seconds or shorter.';
    }
  }
  if (attachment.kind === 'voice') {
    if (!Number.isFinite(attachment.durationMs) || !attachment.durationMs || attachment.durationMs <= 0) {
      return 'Could not read the recording duration. Record it again.';
    }
    if (attachment.durationMs > maxChatVoiceDurationMs) {
      return 'Voice messages must be 2 minutes or shorter.';
    }
  }
  if (
    (attachment.width !== null && (!Number.isFinite(attachment.width) || attachment.width <= 0))
    || (attachment.height !== null && (!Number.isFinite(attachment.height) || attachment.height <= 0))
  ) {
    return 'Could not read the media dimensions. Choose another file.';
  }
  return null;
}
