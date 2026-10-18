import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '../../lib/supabase';
import type {
  CommunityMessageRpcRow,
  CommunityPostReportRpcRow,
  CommunityPostRpcRow,
} from '../../types/database';

const communityMediaLimit = 50 * 1024 * 1024;

export type CommunityPost = CommunityPostRpcRow & { media_url: string | null };
export type CommunityMediaInput = {
  uri: string;
  kind: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
};

export async function getCommunityPosts(communityId: string): Promise<CommunityPost[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_community_posts', {
    p_community_id: communityId,
    p_page_size: 30,
  });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (post) => {
    if (!post.media_path) return { ...post, media_url: null };
    const { data: signed, error: signError } = await client.storage
      .from('community-posts')
      .createSignedUrl(post.media_path, 60 * 60);
    if (signError) throw signError;
    return { ...post, media_url: signed.signedUrl };
  }));
}

export async function createCommunityPost(input: {
  communityId: string;
  body: string;
  media?: CommunityMediaInput | null;
}): Promise<string> {
  const client = getSupabaseClient();
  const body = input.body.trim();
  if (body.length > 2000) throw new Error('Community posts must be 2000 characters or fewer.');
  if (!body && !input.media) throw new Error('Add text or media before posting.');
  if (input.media && (!Number.isFinite(input.media.sizeBytes) || input.media.sizeBytes > communityMediaLimit)) {
    throw new Error('Community photos and videos must be smaller than 50 MB.');
  }

  const postId = Crypto.randomUUID();
  let mediaPath: string | null = null;
  if (input.media) {
    const mimeType = input.media.mimeType.toLowerCase();
    const extension = input.media.kind === 'image'
      ? mimeType === 'image/jpeg' ? 'jpg'
        : mimeType === 'image/png' ? 'png'
          : mimeType === 'image/webp' ? 'webp'
            : null
      : mimeType === 'video/mp4' ? 'mp4'
        : mimeType === 'video/quicktime' ? 'mov'
          : null;
    if (!extension) throw new Error('Choose a JPEG, PNG, or WebP photo, or an MP4 or MOV video.');
    mediaPath = `${input.communityId}/${postId}.${extension}`;
    const response = await fetch(input.media.uri);
    if (!response.ok) throw new Error('The selected media could not be read.');
    const blob = await response.blob();
    if (blob.size <= 0 || blob.size > communityMediaLimit) {
      throw new Error('Community photos and videos must be smaller than 50 MB.');
    }
    const { error: uploadError } = await client.storage.from('community-posts').upload(mediaPath, blob, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) throw uploadError;
  }

  const { data, error } = await client.rpc('create_community_post', {
    p_community_id: input.communityId,
    p_body: body,
    p_media_path: mediaPath,
    p_media_kind: input.media?.kind ?? null,
  });
  if (error) {
    if (mediaPath) {
      const { error: cleanupError } = await client.storage.from('community-posts').remove([mediaPath]);
      if (cleanupError) {
        throw new Error(`${error.message} The uploaded media could not be removed: ${cleanupError.message}`);
      }
    }
    throw error;
  }
  if (!data) {
    if (mediaPath) {
      const { error: cleanupError } = await client.storage.from('community-posts').remove([mediaPath]);
      if (cleanupError) {
        throw new Error(`The community post could not be created. The uploaded media could not be removed: ${cleanupError.message}`);
      }
    }
    throw new Error('The community post could not be created.');
  }
  return data;
}

export async function moderateCommunityPost(postId: string, action: 'remove' | 'pin') {
  const { error } = await getSupabaseClient().rpc('moderate_community_post', {
    p_post_id: postId,
    p_action: action,
  });
  if (error) throw error;
}

export async function reportCommunityPost(postId: string, reason: string) {
  const { error } = await getSupabaseClient().rpc('report_community_post', {
    p_post_id: postId,
    p_reason: reason,
    p_details: '',
  });
  if (error) throw error;
}

export async function getCommunityPostReports(communityId: string): Promise<CommunityPostReportRpcRow[]> {
  const { data, error } = await getSupabaseClient().rpc('get_community_post_reports', {
    p_community_id: communityId,
    p_page_size: 50,
  });
  if (error) throw error;
  return data ?? [];
}

export async function resolveCommunityPostReport(reportId: string) {
  const { error } = await getSupabaseClient().rpc('resolve_community_post_report', {
    p_report_id: reportId,
  });
  if (error) throw error;
}

export async function getCommunityMessages(communityId: string): Promise<CommunityMessageRpcRow[]> {
  const { data, error } = await getSupabaseClient().rpc('get_community_messages', {
    p_community_id: communityId,
    p_page_size: 50,
  });
  if (error) throw error;
  return (data ?? []).reverse();
}

export async function sendCommunityMessage(communityId: string, body: string) {
  const { error } = await getSupabaseClient().rpc('send_community_message', {
    p_community_id: communityId,
    p_body: body,
  });
  if (error) throw error;
}
