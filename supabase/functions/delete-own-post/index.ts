import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(401, { error: 'Sign in to delete this post.' });
  }

  let payload: { postId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: 'A valid post is required.' });
  }
  if (typeof payload.postId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.postId)) {
    return respond(400, { error: 'A valid post is required.' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond(401, { error: 'Your session is invalid or expired.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: post, error: readError } = await admin
    .from('posts')
    .select('id,author_id,captions_path')
    .eq('id', payload.postId)
    .maybeSingle();
  if (readError) {
    console.error('Unable to load the post for deletion.', { code: readError.code });
    return respond(500, { error: 'Unable to delete this post.' });
  }
  if (!post || post.author_id !== userData.user.id) {
    return respond(404, { error: 'This post could not be found.' });
  }

  let captionFile: Blob | null = null;
  if (post.captions_path) {
    const { data, error } = await admin.storage.from('captions').download(post.captions_path);
    if (error && error.statusCode !== '404') {
      console.error('Unable to download post captions before deletion.', { code: error.name });
      return respond(500, { error: "Unable to remove this post's captions." });
    }
    if (data) {
      captionFile = data;
      const { error: removeError } = await admin.storage.from('captions').remove([post.captions_path]);
      if (removeError) {
        console.error('Unable to remove post captions.', { code: removeError.name });
        return respond(500, { error: "Unable to remove this post's captions." });
      }
    }
  }

  const { error: deleteError } = await admin.from('posts').delete().eq('id', post.id).eq('author_id', userData.user.id);
  if (deleteError) {
    console.error('Unable to delete the post row.', { code: deleteError.code });
    if (post.captions_path && captionFile) {
      const { error: restoreError } = await admin.storage.from('captions').upload(
        post.captions_path,
        captionFile,
        { contentType: 'text/vtt', upsert: true },
      );
      if (restoreError) console.error('Unable to restore captions after post deletion failed.', { code: restoreError.name });
    }
    return respond(500, { error: 'Unable to delete this post.' });
  }

  return respond(200, { deleted: true });
});
