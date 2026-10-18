import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';
import { Upload } from 'tus-js-client';
import type { Database } from '../../types/database';
import {
  extensionFor,
  validateChatMedia,
  type ChatMediaAttachment,
} from './chatMediaValidation';

type Client = SupabaseClient<Database>;
const standardUploadLimitBytes = 6 * 1024 * 1024;

function getStorageEndpoint() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL before uploading chat media.');
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname.endsWith('.supabase.co')) {
    return `https://${parsed.hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`;
}

async function uploadResumable(client: Client, file: File, path: string, contentType: string) {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Set EXPO_PUBLIC_SUPABASE_ANON_KEY before uploading chat media.');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const upload = new Upload(file, {
      endpoint: getStorageEndpoint(),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: standardUploadLimitBytes,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      headers: { apikey: anonKey, 'x-upsert': 'true' },
      metadata: {
        bucketName: 'chat-media',
        objectName: path,
        contentType,
        cacheControl: '3600',
      },
      onBeforeRequest: async (request) => {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('Sign in again to upload this attachment.');
        request.setHeader('authorization', `Bearer ${data.session.access_token}`);
      },
      onError: (error) => finish(error),
      onSuccess: () => finish(),
    });
    upload.start();
  });
}

export async function uploadChatMedia(
  client: Client,
  ownerId: string,
  mediaId: string,
  attachment: ChatMediaAttachment,
): Promise<string> {
  const validationError = validateChatMedia(attachment);
  if (validationError) throw new Error(validationError);

  const file = new File(attachment.uri);
  if (!file.exists) throw new Error('The selected attachment is no longer available. Choose it again.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > attachment.sizeBytes) {
    throw new Error('The attachment changed after selection. Choose it again.');
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('Chat attachments must be 25 MB or smaller.');

  const path = `${ownerId}/${mediaId}.${extensionFor(attachment)}`;
  if (file.size > standardUploadLimitBytes) {
    await uploadResumable(client, file, path, attachment.contentType);
  } else {
    const bytes = await file.bytes();
    const { error } = await client.storage.from('chat-media').upload(path, bytes, {
      cacheControl: '3600',
      contentType: attachment.contentType,
      upsert: true,
    });
    if (error) throw error;
  }
  return path;
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
