import { File } from 'expo-file-system';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';
import type { AuthorStoryRpcRow, Database, StoryRailRow } from '../../types/database';
import { orderStoryRail } from './storyTimeline';

type Client = SupabaseClient<Database>;

export type StoryWithUrl = AuthorStoryRpcRow & {
  media_url: string;
  thumb_url: string | null;
};

export type StoryViewer = {
  viewer_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  viewed_at: string;
};

export type StoryViewerPage = {
  total_count: number;
  viewers: StoryViewer[];
};

export type CreateStoryInput = {
  id: string;
  kind: 'image' | 'video';
  uri: string;
  mimeType: 'image/jpeg' | 'video/mp4' | 'video/quicktime';
  caption: string;
  captionStyle: Database['public']['Tables']['stories']['Insert']['caption_style'];
  audience: 'everyone' | 'followers' | 'close_friends';
  durationMs: number;
  width: number;
  height: number;
};

function getClient(): Client {
  return getSupabaseClient();
}

export async function getStoryRail(client = getClient()): Promise<StoryRailRow[]> {
  const [{ data: userResult, error: userError }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.rpc('get_story_rail'),
  ]);
  if (userError) throw userError;
  if (error) throw error;
  if (!userResult.user) throw new Error('Sign in to view stories.');

  const rows = data ?? [];
  if (rows.some((row) => row.is_owner)) return orderStoryRail(rows);

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id,display_name,username,avatar_url')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('Your profile could not be found.');

  return orderStoryRail([
    {
      author_id: profile.id,
      display_name: 'Your story',
      username: profile.username,
      avatar_url: profile.avatar_url,
      story_count: 0,
      has_unseen: false,
      is_close_friends_audience: false,
      latest_created_at: null,
      is_owner: true,
    },
    ...rows,
  ]);
}

export async function getAuthorStories(
  authorId: string,
  client = getClient(),
): Promise<StoryWithUrl[]> {
  const { data, error } = await client.rpc('get_author_stories', { p_author_id: authorId });
  if (error) throw error;

  return Promise.all((data ?? []).map(async (story) => {
    const [{ data: mediaUrl, error: mediaError }, thumbResult] = await Promise.all([
      client.storage.from('stories').createSignedUrl(story.media_path, 60 * 60),
      story.thumb_path
        ? client.storage.from('stories').createSignedUrl(story.thumb_path, 60 * 60)
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (mediaError) throw mediaError;
    if (thumbResult.error) throw thumbResult.error;
    return {
      ...story,
      media_url: mediaUrl.signedUrl,
      thumb_url: thumbResult.data?.signedUrl ?? null,
    };
  }));
}

export async function markStoryViewed(storyId: string, client = getClient()) {
  const { error } = await client.rpc('mark_story_viewed', { p_story_id: storyId });
  if (error) throw error;
}

export async function canReplyToStory(storyId: string, client = getClient()) {
  const { data, error } = await client.rpc('can_reply_to_story', { p_story_id: storyId });
  if (error) throw error;
  return data;
}

export async function sendStoryReply(storyId: string, body: string, client = getClient()) {
  const { data, error } = await client.rpc('send_story_reply', {
    p_story_id: storyId,
    p_body: body.trim(),
  });
  if (error) throw error;
  if (!data) throw new Error('The story reply could not be delivered.');
  return data;
}

export async function getStoryReplyPreviewUrl(path: string, client = getClient()) {
  const { data, error } = await client.storage.from('stories').createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function getStoryViewers(
  storyId: string,
  cursor?: Pick<StoryViewer, 'viewed_at' | 'viewer_id'>,
  client = getClient(),
): Promise<StoryViewerPage> {
  const { data, error } = await client.rpc('get_story_viewers', {
    p_story_id: storyId,
    p_cursor_viewed_at: cursor?.viewed_at ?? null,
    p_cursor_viewer_id: cursor?.viewer_id ?? null,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The story viewer list could not be read.');
  }

  const payload = data as Record<string, unknown>;
  if (typeof payload.total_count !== 'number' || !Array.isArray(payload.viewers)) {
    throw new Error('The story viewer list was returned in an invalid format.');
  }

  const viewers = payload.viewers.map((row): StoryViewer => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('A story viewer was returned in an invalid format.');
    }
    const viewer = row as Record<string, unknown>;
    if (
      typeof viewer.viewer_id !== 'string'
      || typeof viewer.display_name !== 'string'
      || typeof viewer.username !== 'string'
      || (viewer.avatar_url !== null && typeof viewer.avatar_url !== 'string')
      || typeof viewer.viewed_at !== 'string'
    ) {
      throw new Error('A story viewer was returned in an invalid format.');
    }
    return {
      viewer_id: viewer.viewer_id,
      display_name: viewer.display_name,
      username: viewer.username,
      avatar_url: viewer.avatar_url,
      viewed_at: viewer.viewed_at,
    };
  });

  return { total_count: payload.total_count, viewers };
}

export async function createStory(input: CreateStoryInput, client = getClient()) {
  const { data: authResult, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const authorId = authResult.user?.id;
  if (!authorId) throw new Error('Sign in before sharing a story.');

  const extension = input.kind === 'image'
    ? 'jpg'
    : input.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const mediaPath = `${authorId}/${input.id}.${extension}`;
  const file = new File(input.uri);
  if (!file.exists || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('The selected media is no longer available. Choose it again.');
  }

  const { error: uploadError } = await client.storage.from('stories').upload(mediaPath, file, {
    contentType: input.mimeType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { error: insertError } = await client.from('stories').insert({
    id: input.id,
    author_id: authorId,
    kind: input.kind,
    media_path: mediaPath,
    caption: input.caption.trim() || null,
    caption_style: input.caption.trim() ? input.captionStyle : null,
    audience: input.audience,
    duration_ms: input.kind === 'image' ? 5000 : input.durationMs,
    width: input.width,
    height: input.height,
  });
  if (insertError) {
    const { error: cleanupError } = await client.storage.from('stories').remove([mediaPath]);
    if (cleanupError) {
      throw new Error(`${insertError.message} The uploaded story media could not be removed: ${cleanupError.message}`);
    }
    throw insertError;
  }

  return { storyId: input.id, authorId };
}

export async function deleteStory(story: AuthorStoryRpcRow, client = getClient()) {
  const { error } = await client.rpc('delete_story', { p_story_id: story.id });
  if (error) throw error;

  const paths = [story.media_path, story.thumb_path].filter((path): path is string => Boolean(path));
  if (paths.length > 0) {
    const references = await Promise.all(paths.map(async (path) => {
      const { data, error: referenceError } = await client.rpc('story_reply_media_is_referenced', { p_path: path });
      if (referenceError) throw referenceError;
      return { path, isReferenced: data };
    }));
    const unreferencedPaths = references.filter((item) => !item.isReferenced).map((item) => item.path);
    if (unreferencedPaths.length > 0) {
      const { error: storageError } = await client.storage.from('stories').remove(unreferencedPaths);
      if (storageError) throw new Error(`The story was deleted, but its media could not be removed: ${storageError.message}`);
    }
  }
}

export async function blockStoryAuthor(authorId: string, client = getClient()) {
  const { error } = await client.rpc('block_user', { p_target: authorId });
  if (error) throw error;
}

export async function reportStory(storyId: string, reason: string, client = getClient()) {
  const { data: authResult, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authResult.user) throw new Error('Sign in to report a story.');

  const { error } = await client.from('reports').insert({
    reporter_id: authResult.user.id,
    target_type: 'story',
    target_id: storyId,
    reason,
  });
  if (error) throw error;
}

export function getStoryStoragePath(authorId: string, storyId: string, kind: 'image' | 'video') {
  return `${authorId}/${storyId}.${kind === 'image' ? 'jpg' : 'mp4'}`;
}
