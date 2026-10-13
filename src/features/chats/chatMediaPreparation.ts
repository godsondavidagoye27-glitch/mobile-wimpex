import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { maxChatMediaSizeBytes, validateChatMedia, type ChatMediaAttachment } from './chatMediaValidation';

export async function prepareChatPickerAsset(asset: ImagePickerAsset): Promise<ChatMediaAttachment> {
  const originalFile = new File(asset.uri);
  const originalSize = asset.fileSize ?? originalFile.size;
  if (!Number.isFinite(originalSize) || originalSize <= 0) {
    throw new Error('Could not read the attachment size. Choose another file.');
  }
  if (originalSize > maxChatMediaSizeBytes) {
    throw new Error('Chat attachments must be 25 MB or smaller.');
  }

  if (asset.type === 'image') {
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    let image: ImageManipulator.ImageRef | null = null;
    try {
      const longestSide = Math.max(asset.width, asset.height);
      if (longestSide > 2048) {
        const scale = 2048 / longestSide;
        context.resize({
          width: Math.round(asset.width * scale),
          height: Math.round(asset.height * scale),
        });
      }
      image = await context.renderAsync();
      const result = await image.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.82,
      });
      const file = new File(result.uri);
      const attachment: ChatMediaAttachment = {
        kind: 'image',
        uri: result.uri,
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: file.size,
        durationMs: null,
        width: result.width,
        height: result.height,
      };
      const validationError = validateChatMedia(attachment);
      if (validationError) throw new Error(validationError);
      return attachment;
    } finally {
      image?.release();
      context.release();
    }
  }

  if (asset.type === 'video') {
    const contentType = asset.mimeType?.toLowerCase()
      ?? (asset.fileName?.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '');
    const attachment: ChatMediaAttachment = {
      kind: 'video',
      uri: asset.uri,
      fileName: asset.fileName ?? 'video.mp4',
      contentType,
      sizeBytes: originalSize,
      durationMs: asset.duration ?? null,
      width: asset.width,
      height: asset.height,
    };
    const validationError = validateChatMedia(attachment);
    if (validationError) throw new Error(validationError);
    return attachment;
  }

  throw new Error('Choose a photo or an MP4 video to share in chat.');
}

export function prepareRecordedVoice(uri: string, durationMs: number, contentType: string): ChatMediaAttachment {
  const file = new File(uri);
  const attachment: ChatMediaAttachment = {
    kind: 'voice',
    uri,
    fileName: contentType === 'audio/webm' ? 'voice-message.webm' : 'voice-message.m4a',
    contentType,
    sizeBytes: file.size,
    durationMs: Math.round(durationMs),
    width: null,
    height: null,
  };
  const validationError = validateChatMedia(attachment);
  if (validationError) throw new Error(validationError);
  return attachment;
}
