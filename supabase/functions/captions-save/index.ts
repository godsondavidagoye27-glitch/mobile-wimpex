import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateVttRewrite } from '../../../src/features/captions/vtt.ts';

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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('The captions-save function is missing required server configuration.');
    return respond(503, { error: 'Caption editing is unavailable.' });
  }
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Sign in to edit captions.' });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 210_000) return respond(413, { error: 'The caption file is too large.' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond(401, { error: 'Your session is invalid or expired.' });

  let payload: { postId?: unknown; captions?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: 'A valid caption edit is required.' });
  }
  if (
    typeof payload.postId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(payload.postId)
    || typeof payload.captions !== 'string'
  ) {
    return respond(400, { error: 'A valid caption edit is required.' });
  }
  if (new TextEncoder().encode(payload.captions).byteLength > 204_800) {
    return respond(413, { error: 'The caption file is too large.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('id,author_id,captions_path,captions_status')
    .eq('id', payload.postId)
    .maybeSingle();
  if (postError) {
    console.error('Unable to load the post for caption editing.', { code: postError.code });
    return respond(500, { error: 'Unable to save captions.' });
  }
  if (!post || post.author_id !== userData.user.id) {
    return respond(403, { error: 'You can only edit captions for your own video.' });
  }
  if (post.captions_status !== 'ready' || !post.captions_path) {
    return respond(409, { error: 'This video does not have editable captions.' });
  }

  const { data: originalFile, error: downloadError } = await admin.storage
    .from('captions')
    .download(post.captions_path);
  if (downloadError) {
    console.error('Unable to load the original caption file.', { code: downloadError.name });
    return respond(500, { error: 'Unable to load the original captions.' });
  }
  const validation = validateVttRewrite(await originalFile.text(), payload.captions);
  if (!validation.valid) return respond(400, { error: validation.error });

  const { error: uploadError } = await admin.storage.from('captions').upload(
    post.captions_path,
    new Blob([payload.captions], { type: 'text/vtt' }),
    { contentType: 'text/vtt', upsert: true },
  );
  if (uploadError) {
    console.error('Unable to upload the edited caption file.', { code: uploadError.name });
    return respond(500, { error: 'Unable to save captions.' });
  }

  const { error: updateError } = await admin.from('posts').update({
    captions_updated_at: new Date().toISOString(),
  }).eq('id', post.id).eq('author_id', userData.user.id);
  if (updateError) {
    console.error('Unable to update the caption timestamp.', { code: updateError.code });
    return respond(500, { error: 'Unable to save captions.' });
  }
  return respond(200, { saved: true });
});
