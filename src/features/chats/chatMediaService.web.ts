import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import type { ChatMediaAttachment } from './chatMediaValidation';

type Client = SupabaseClient<Database>;

export async function uploadChatMedia(
  _client: Client,
  _ownerId: string,
  _mediaId: string,
  _attachment: ChatMediaAttachment,
): Promise<string> {
  throw new Error('Chat media uploads are available in the Wimpex mobile app.');
}

export async function removeChatMedia(client: Client, path: string) {
  const { error } = await client.storage.from('chat-media').remove([path]);
  if (error) throw error;
}

export async function createChatMediaSignedUrl(client: Client, path: string) {
  const { data, error } = await client.storage.from('chat-media').createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
