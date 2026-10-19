import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';
import { parseOpenRouterTranscript } from '../_shared/openRouterCaptions.ts';

const headers = { 'Content-Type': 'application/json' };
const secretHeader = 'x-captions-webhook-secret';

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function secretMatches(request: Request, secret: string) {
  return constantTimeEquals(request.headers.get(secretHeader), secret);
}

async function setPostState(
  admin: ReturnType<typeof createClient>,
  postId: string,
  status: string,
  errorCode: string | null,
) {
  const [{ error: postError }, { error: jobError }] = await Promise.all([
    admin.from('posts').update({
      captions_status: status,
      captions_updated_at: new Date().toISOString(),
    }).eq('id', postId),
    admin.from('caption_jobs').update({
      status,
      last_error: errorCode,
      updated_at: new Date().toISOString(),
    }).eq('post_id', postId),
  ]);
  if (postError) throw postError;
  if (jobError) throw jobError;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });

  const secret = Deno.env.get('CAPTIONS_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error('The captions-start function is missing required server configuration.');
    return respond(503, { error: 'Captions are not configured.' });
  }
  if (!secretMatches(request, secret)) return respond(401, { error: 'Authentication is required.' });

  let payload: { record?: { id?: unknown; captions_status?: unknown } };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: 'A valid database webhook payload is required.' });
  }
  const postId = payload.record?.id;
  if (typeof postId !== 'string' || !/^[0-9a-f-]{36}$/i.test(postId)) {
    return respond(400, { error: 'A valid post is required.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('id,author_id,video_path,auto_captions,captions_status,captions_attempts')
    .eq('id', postId)
    .maybeSingle();
  if (postError) {
    console.error('Unable to load the queued caption post.', { code: postError.code });
    return respond(500, { error: 'Unable to start captions.' });
  }
  if (!post || post.captions_status !== 'queued' || !post.auto_captions || !post.video_path) {
    return respond(200, { ignored: true });
  }

  const { data: currentJob, error: jobReadError } = await admin
    .from('caption_jobs')
    .select('status')
    .eq('post_id', post.id)
    .maybeSingle();
  if (jobReadError) {
    console.error('Unable to inspect the caption job.', { code: jobReadError.code });
    return respond(500, { error: 'Unable to start captions.' });
  }
  if (currentJob?.status === 'processing') {
    return respond(200, { ignored: true });
  }

  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const globalDailyCap = Number(Deno.env.get('AI_CAPTIONS_GLOBAL_DAILY_CAP'));
  if (
    Deno.env.get('AI_ENABLED') !== 'true'
    || Deno.env.get('AI_CAPTIONS_ENABLED') !== 'true'
    || !openRouterKey
    || !Number.isSafeInteger(globalDailyCap)
    || globalDailyCap < 1
  ) {
    try {
      await setPostState(admin, post.id, 'disabled', 'feature_disabled');
    } catch (error) {
      console.error('Unable to disable captions for this post.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return respond(500, { error: 'Unable to update caption status.' });
    }
    return respond(200, { disabled: true });
  }

  if (post.captions_attempts >= 3) {
    try {
      await setPostState(admin, post.id, 'failed', 'attempt_limit');
    } catch (error) {
      console.error('Unable to mark the caption attempt limit.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return respond(500, { error: 'Unable to update caption status.' });
    }
    return respond(200, { failed: true });
  }

  const { data: permitted, error: consumeError } = await admin.rpc('ai_consume', {
    p_user_id: post.author_id,
    p_feature: 'captions',
    p_user_daily_cap: 30,
    p_user_minute_cap: 30,
    p_global_daily_cap: globalDailyCap,
    p_global_minute_cap: globalDailyCap,
  });
  if (consumeError) {
    console.error('Unable to consume the caption usage limit.', { code: consumeError.code });
    try {
      await setPostState(admin, post.id, 'failed', 'usage_check_failed');
    } catch (updateError) {
      console.error('Unable to mark the caption usage check failure.', {
        errorName: updateError instanceof Error ? updateError.name : 'unknown',
      });
    }
    return respond(200, { failed: true });
  }
  if (!permitted) {
    try {
      await setPostState(admin, post.id, 'disabled', 'usage_limit');
    } catch (error) {
      console.error('Unable to disable captions after the usage limit.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return respond(500, { error: 'Unable to update caption status.' });
    }
    return respond(200, { disabled: true });
  }

  const attempt = post.captions_attempts + 1;
  const now = new Date().toISOString();
  const { error: jobWriteError } = await admin.from('caption_jobs').upsert({
    post_id: post.id,
    provider: 'openrouter',
    provider_job_id: null,
    status: 'processing',
    attempts: attempt,
    last_error: null,
    updated_at: now,
  }, { onConflict: 'post_id' });
  if (jobWriteError) {
    console.error('Unable to record the caption job.', { code: jobWriteError.code });
    return respond(500, { error: 'Unable to start captions.' });
  }
  const { error: postWriteError } = await admin.from('posts').update({
    captions_status: 'processing',
    captions_attempts: attempt,
    captions_updated_at: now,
  }).eq('id', post.id).eq('captions_status', 'queued');
  if (postWriteError) {
    console.error('Unable to mark captions as processing.', { code: postWriteError.code });
    return respond(500, { error: 'Unable to start captions.' });
  }

  try {
    const { data: signedVideo, error: signedUrlError } = await admin.storage
      .from('videos')
      .createSignedUrl(post.video_path, 30 * 60);
    if (signedUrlError || !signedVideo?.signedUrl) {
      await setPostState(admin, post.id, 'failed', 'video_url_unavailable');
      return respond(200, { failed: true });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let transcriptionResponse: Response;
    try {
      transcriptionResponse = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'openai/whisper-large-v3',
          input_audio: { source_url: signedVideo.signedUrl },
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
          temperature: 0,
          provider: { zdr: true },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!transcriptionResponse.ok) {
      await setPostState(admin, post.id, 'failed', `openrouter_http_${transcriptionResponse.status}`);
      console.error('OpenRouter rejected a caption transcription request.', {
        status: transcriptionResponse.status,
      });
      return respond(200, { failed: true });
    }

    const transcript = parseOpenRouterTranscript(await transcriptionResponse.json());
    if (transcript.status === 'no_speech') {
      await setPostState(admin, post.id, 'no_speech', null);
      return respond(200, { noSpeech: true });
    }

    const { data: postOwner, error: ownerError } = await admin.from('posts')
      .select('author_id')
      .eq('id', post.id)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!postOwner) return respond(200, { deleted: true });

    const captionsPath = `${postOwner.author_id}/${post.id}.vtt`;
    const { error: uploadError } = await admin.storage.from('captions').upload(
      captionsPath,
      new Blob([transcript.captions], { type: 'text/vtt' }),
      { contentType: 'text/vtt', upsert: true },
    );
    if (uploadError) throw uploadError;

    const completedAt = new Date().toISOString();
    const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
      admin.from('posts').update({
        captions_path: captionsPath,
        captions_language: transcript.language,
        captions_status: 'ready',
        captions_updated_at: completedAt,
      }).eq('id', post.id).eq('captions_status', 'processing'),
      admin.from('caption_jobs').update({
        status: 'ready',
        last_error: null,
        updated_at: completedAt,
      }).eq('post_id', post.id).eq('status', 'processing'),
    ]);
    if (postUpdateError) throw postUpdateError;
    if (jobUpdateError) throw jobUpdateError;
    return respond(200, { ready: true });
  } catch (error) {
    console.error('Unable to process an OpenRouter caption transcription.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    try {
      await setPostState(admin, post.id, 'failed', 'openrouter_request_failed');
    } catch (updateError) {
      console.error('Unable to mark the caption submission failure.', {
        errorName: updateError instanceof Error ? updateError.name : 'unknown',
      });
    }
    return respond(200, { failed: true });
  }
});
