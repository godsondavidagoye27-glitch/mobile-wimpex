import * as Crypto from 'expo-crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getErrorMessage } from '../../lib/errorMessage';
import { getSupabaseClient } from '../../lib/supabase';
import type { Database, StoryHighlightItemRpcRow, StoryHighlightRpcRow } from '../../types/database';
import { mapSignedUrlResults } from '../feed/signedUrls';
import type { StoryWithUrl } from './storyService';
import type { HighlightAudience } from './highlightLogic';

type Client = SupabaseClient<Database>;

export type StoryHighlight = StoryHighlightRpcRow & { cover_url: string | null };
export type StoryHighlightItem = StoryHighlightItemRpcRow & { media_url: string | null };

function getClient(): Client {
  return getSupabaseClient();
}

async function signHighlightPaths(paths: string[], client: Client) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const signedUrls = new Map<string, string | null>(uniquePaths.map((path) => [path, null]));
  if (!uniquePaths.length) return signedUrls;

  const { data, error } = await client.storage.from('highlights').createSignedUrls(uniquePaths, 60 * 60);
  if (error) throw error;
  const mapped = mapSignedUrlResults(
    uniquePaths,
    data?.map((result, index) => ({
      path: result.path ?? uniquePaths[index],
      signedUrl: result.signedUrl,
      error: result.error,
    })) ?? null,
  );
  mapped.forEach((url, path) => signedUrls.set(path, url));
  return signedUrls;
}

export async function getProfileStoryHighlights(ownerId: string, client = getClient()): Promise<StoryHighlight[]> {
  const { data, error } = await client.rpc('get_profile_story_highlights', { p_owner_id: ownerId });
  if (error) throw error;
  const rows = data ?? [];
  const urls = await signHighlightPaths(rows.flatMap((row) => row.cover_path ? [row.cover_path] : []), client);
  return rows.map((row) => ({ ...row, cover_url: row.cover_path ? urls.get(row.cover_path) ?? null : null }));
}

export async function getStoryHighlightItems(
  highlightId: string,
  client = getClient(),
): Promise<StoryHighlightItem[]> {
  const { data, error } = await client.rpc('get_story_highlight_items', { p_highlight_id: highlightId });
  if (error) throw error;
  const rows = data ?? [];
  const urls = await signHighlightPaths(rows.map((row) => row.media_path), client);
  return rows.map((row) => ({ ...row, media_url: urls.get(row.media_path) ?? null }));
}

export async function createStoryHighlight(
  title: string,
  audience: HighlightAudience,
  client = getClient(),
) {
  const { data, error } = await client.rpc('create_story_highlight', {
    p_title: title.trim(),
    p_audience: audience,
  });
  if (error) throw error;
  if (!data) throw new Error('The highlight could not be created.');
  return data;
}

export async function renameStoryHighlight(highlightId: string, title: string, client = getClient()) {
  const { error } = await client.rpc('rename_story_highlight', {
    p_highlight_id: highlightId,
    p_title: title.trim(),
  });
  if (error) throw error;
}

export async function reorderStoryHighlight(highlightId: string, newOrder: number, client = getClient()) {
  const { error } = await client.rpc('reorder_story_highlight', {
    p_highlight_id: highlightId,
    p_new_order: newOrder,
  });
  if (error) throw error;
}

export async function deleteStoryHighlight(highlightId: string, client = getClient()) {
  const items = await getStoryHighlightItems(highlightId, client);
  const { error } = await client.rpc('delete_story_highlight', { p_highlight_id: highlightId });
  if (error) throw error;
  const paths = items.map((item) => item.media_path);
  if (paths.length) {
    const { error: storageError } = await client.storage.from('highlights').remove(paths);
    if (storageError) {
      throw new Error(`The highlight was deleted, but its copied media could not be removed: ${await getErrorMessage(storageError, 'Try again.')}`);
    }
  }
}

export async function addStoryToHighlight(
  highlightId: string,
  story: StoryWithUrl,
  client = getClient(),
) {
  const { data: authResult, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  const userId = authResult.session?.user.id;
  if (!userId) throw new Error('Sign in to save a story to a highlight.');

  const extension = story.media_path.toLowerCase().endsWith('.mov') ? 'mov'
    : story.kind === 'image' ? 'jpg' : 'mp4';
  const itemId = Crypto.randomUUID();
  const mediaPath = `${userId}/${highlightId}/${itemId}.${extension}`;
  const { data: media, error: downloadError } = await client.storage.from('stories').download(story.media_path);
  if (downloadError) throw downloadError;
  if (!media || media.size === 0) throw new Error('This story media is no longer available.');

  const contentType = story.kind === 'image' ? 'image/jpeg'
    : extension === 'mov' ? 'video/quicktime' : 'video/mp4';
  const { error: uploadError } = await client.storage.from('highlights').upload(mediaPath, media, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { error: addError } = await client.rpc('add_story_to_highlight', {
    p_highlight_id: highlightId,
    p_story_id: story.id,
    p_item_id: itemId,
  });
  if (addError) {
    const { error: cleanupError } = await client.storage.from('highlights').remove([mediaPath]);
    if (cleanupError) {
      throw new Error(
        `${await getErrorMessage(addError, 'The story could not be added.')} `
        + `The copied media could not be removed: ${await getErrorMessage(cleanupError, 'Try again.')}`,
      );
    }
    throw addError;
  }
}
