import { File } from 'expo-file-system';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';
import type {
  AuthorStoryRpcRow,
  Database,
  StoryPollResultsRpcRow,
  StoryQuestionReplyRpcRow,
  StoryRailRow,
} from '../../types/database';
import { mapSignedUrlResults } from '../feed/signedUrls';
import { getVideoExtension } from '../media/videoExtension';
import { orderStoryRail } from './storyTimeline';

type Client = SupabaseClient<Database>;

export type StoryWithUrl = AuthorStoryRpcRow & {
  media_url: string | null;
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
  sticker?: {
    kind: 'poll' | 'question';
    prompt: string;
    optionOne?: string;
    optionTwo?: string;
    positionX: number;
    positionY: number;
    scale: number;
  } | null;
};

function getClient(): Client {
  return getSupabaseClient();
}

export async function getStoryRail(client = getClient()): Promise<StoryRailRow[]> {
  const [{ data: userResult, error: userError }, { data, error }] = await Promise.all([
    client.auth.getSession(),
    client.rpc('get_story_rail'),
  ]);
  if (userError) throw userError;
  if (error) throw error;
  const user = userResult.session?.user;
  if (!user) throw new Error('Sign in to view stories.');

  const rows = data ?? [];
  if (rows.some((row) => row.is_owner)) return orderStoryRail(rows);

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id,display_name,username,avatar_url')
    .eq('id', user.id)
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

  const stories = data ?? [];
  const paths = [...new Set(stories.flatMap((story) => [story.media_path, story.thumb_path].filter(
    (path): path is string => Boolean(path),
  )))];
  const signedUrls = new Map<string, string | null>(paths.map((path) => [path, null]));
  if (paths.length > 0) {
    const { data: results, error: signingError } = await client.storage
      .from('stories')
      .createSignedUrls(paths, 60 * 60);
    if (signingError) throw signingError;
    const mapped = mapSignedUrlResults(
      paths,
      results?.map((result, index) => ({
        path: result.path ?? paths[index],
        signedUrl: result.signedUrl,
        error: result.error,
      })) ?? null,
    );
    mapped.forEach((signedUrl, path) => {
      signedUrls.set(path, signedUrl);
      if (!signedUrl) console.warn('Unable to sign a story media URL.', { path });
    });
  }

  return stories.map((story) => ({
    ...story,
    media_url: signedUrls.get(story.media_path) ?? null,
    thumb_url: story.thumb_path ? signedUrls.get(story.thumb_path) ?? null : null,
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
  const { data: authResult, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  const authorId = authResult.session?.user.id;
  if (!authorId) throw new Error('Sign in before sharing a story.');

  const extension = input.kind === 'image' ? 'jpg' : getVideoExtension(input.uri, input.mimeType);
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

  const { error: insertError } = await client.rpc('create_story_with_sticker', {
    p_story_id: input.id,
    p_kind: input.kind,
    p_media_path: mediaPath,
    p_caption: input.caption.trim() || null,
    p_caption_style: input.caption.trim() ? input.captionStyle ?? null : null,
    p_audience: input.audience,
    p_duration_ms: input.kind === 'image' ? 5000 : input.durationMs,
    p_width: input.width,
    p_height: input.height,
    p_sticker_kind: input.sticker?.kind ?? null,
    p_sticker_prompt: input.sticker?.prompt.trim() || null,
    p_option_one: input.sticker?.optionOne?.trim() || null,
    p_option_two: input.sticker?.optionTwo?.trim() || null,
    p_position_x: input.sticker?.positionX ?? 0.5,
    p_position_y: input.sticker?.positionY ?? 0.65,
    p_scale: input.sticker?.scale ?? 1,
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

export async function getStorySticker(storyId: string, client = getClient()) {
  const { data, error } = await client
    .from('story_stickers')
    .select('*')
    .eq('story_id', storyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getStoryPollResults(stickerId: string, client = getClient()) {
  const { data, error } = await client.rpc('get_story_poll_results', { p_sticker_id: stickerId });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function voteOnStoryPoll(
  stickerId: string,
  optionNumber: 1 | 2,
  client = getClient(),
): Promise<StoryPollResultsRpcRow> {
  const { data, error } = await client.rpc('vote_on_story_poll', {
    p_sticker_id: stickerId,
    p_option_number: optionNumber,
  });
  if (error) throw error;
  if (!data?.[0]) throw new Error('The poll results could not be loaded.');
  return data[0];
}

export async function replyToStoryQuestion(stickerId: string, body: string, client = getClient()) {
  const { data, error } = await client.rpc('reply_to_story_question', {
    p_sticker_id: stickerId,
    p_body: body.trim(),
  });
  if (error) throw error;
  if (!data) throw new Error('Your reply could not be sent.');
  return data;
}

export async function getStoryQuestionReplies(
  stickerId: string,
  client = getClient(),
): Promise<StoryQuestionReplyRpcRow[]> {
  const { data, error } = await client.rpc('get_story_question_replies', { p_sticker_id: stickerId });
  if (error) throw error;
  return data ?? [];
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
  const { data: authResult, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!authResult.session?.user) throw new Error('Sign in to report a story.');

  const { error } = await client.from('reports').insert({
    reporter_id: authResult.session.user.id,
    target_type: 'story',
    target_id: storyId,
    reason,
  });
  if (error) throw error;
}

export function getStoryStoragePath(
  authorId: string,
  storyId: string,
  kind: 'image' | 'video',
  mimeType?: 'video/mp4' | 'video/quicktime',
) {
  return `${authorId}/${storyId}.${kind === 'image' ? 'jpg' : getVideoExtension('', mimeType)}`;
}
