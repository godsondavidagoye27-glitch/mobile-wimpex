import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';

const jsonHeaders = { 'Content-Type': 'application/json' };

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const sharedSecret = Deno.env.get('STORY_PURGE_SECRET');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  if (!sharedSecret || !serviceRoleKey || !supabaseUrl) {
    console.error('The expired story cleanup function is not configured.');
    return new Response(JSON.stringify({ error: 'Story cleanup is not configured.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!constantTimeEquals(request.headers.get('x-story-purge-secret'), sharedSecret)) {
    return new Response(JSON.stringify({ error: 'Authentication is required.' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const expiryCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: expiredStories, error: selectError } = await admin
    .from('stories')
    .select('id, media_path, thumb_path')
    .or(`deleted_at.not.is.null,expires_at.lt.${expiryCutoff}`)
    .limit(100);

  if (selectError) {
    console.error('Unable to list expired stories for cleanup.', selectError);
    return new Response(JSON.stringify({ error: 'Unable to list expired stories.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  let removed = 0;
  for (const story of expiredStories ?? []) {
    const objectPaths = [...new Set([story.media_path, story.thumb_path].filter((path): path is string => Boolean(path)))];
    const { data: retainedPreviews, error: previewError } = await admin
      .from('messages')
      .select('story_reply_preview_path')
      .in('story_reply_preview_path', objectPaths)
      .is('deleted_at', null)
      .limit(100);
    if (previewError) {
      console.error(`Unable to check story reply previews for story ${story.id}.`, previewError);
      continue;
    }
    const retainedPaths = new Set((retainedPreviews ?? []).map((message) => message.story_reply_preview_path));
    const pathsToRemove = objectPaths.filter((path) => !retainedPaths.has(path));

    if (pathsToRemove.length > 0) {
      const { error: storageError } = await admin.storage.from('stories').remove(pathsToRemove);
      if (storageError) {
        console.error(`Unable to remove storage objects for expired story ${story.id}.`, storageError);
        continue;
      }
    }

    const { error: deleteError } = await admin.from('stories').delete().eq('id', story.id);
    if (deleteError) {
      console.error(`Unable to remove expired story row ${story.id}.`, deleteError);
      continue;
    }
    removed += 1;
  }

  const rateLimitCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [{ error: creationRateLimitError }, { error: viewRateLimitError }] = await Promise.all([
    admin.from('story_creation_rate_limits').delete().lt('created_at', rateLimitCutoff),
    admin.from('story_view_rate_limits').delete().lt('called_at', expiryCutoff),
  ]);
  if (creationRateLimitError || viewRateLimitError) {
    console.error('Unable to clean expired story rate limit rows.', {
      creationRateLimitError,
      viewRateLimitError,
    });
    return new Response(JSON.stringify({ error: 'Stories were cleaned, but rate limit cleanup failed.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ removed }), { status: 200, headers: jsonHeaders });
});
