import type { ImagePickerAsset } from 'expo-image-picker';
import type { ChatMediaAttachment } from './chatMediaValidation';

export async function prepareChatPickerAsset(_asset: ImagePickerAsset): Promise<ChatMediaAttachment> {
  throw new Error('Chat media attachments are available in the Wimpex mobile app.');
}

export function prepareRecordedVoice(
  _uri: string,
  _durationMs: number,
  _contentType: string,
): ChatMediaAttachment {
  throw new Error('Voice messages are available in the Wimpex mobile app.');
}
