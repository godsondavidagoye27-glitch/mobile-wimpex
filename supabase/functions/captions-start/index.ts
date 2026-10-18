import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';

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
    .select('status,provider_job_id')
    .eq('post_id', post.id)
    .maybeSingle();
  if (jobReadError) {
    console.error('Unable to inspect the caption job.', { code: jobReadError.code });
    return respond(500, { error: 'Unable to start captions.' });
  }
  if (currentJob?.status === 'processing' && currentJob.provider_job_id) {
    return respond(200, { ignored: true });
  }

  const assemblyKey = Deno.env.get('ASSEMBLYAI_API_KEY');
  const globalDailyCap = Number(Deno.env.get('AI_CAPTIONS_GLOBAL_DAILY_CAP'));
  if (
    Deno.env.get('AI_ENABLED') !== 'true'
    || Deno.env.get('AI_CAPTIONS_ENABLED') !== 'true'
    || !assemblyKey
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
    provider: 'assemblyai',
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

    const callbackUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/captions-callback`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let providerResponse: Response;
    try {
      providerResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: { authorization: assemblyKey, 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          audio_url: signedVideo.signedUrl,
          speech_models: ['universal-3-5-pro', 'universal-2'],
          language_detection: true,
          webhook_url: callbackUrl,
          webhook_auth_header_name: secretHeader,
          webhook_auth_header_value: secret,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!providerResponse.ok) {
      await setPostState(admin, post.id, 'failed', `assemblyai_http_${providerResponse.status}`);
      console.error('The captions provider rejected a transcription request.', {
        status: providerResponse.status,
      });
      return respond(200, { failed: true });
    }

    const providerJob = await providerResponse.json() as { id?: unknown };
    if (typeof providerJob.id !== 'string' || !providerJob.id) {
      await setPostState(admin, post.id, 'failed', 'assemblyai_invalid_response');
      console.error('The captions provider returned an invalid job response.');
      return respond(200, { failed: true });
    }
    const { error: providerIdError } = await admin.from('caption_jobs').update({
      provider_job_id: providerJob.id,
      updated_at: new Date().toISOString(),
    }).eq('post_id', post.id);
    if (providerIdError) throw providerIdError;
    return respond(200, { started: true });
  } catch (error) {
    console.error('Unable to submit a caption transcription.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    try {
      await setPostState(admin, post.id, 'failed', 'provider_request_failed');
    } catch (updateError) {
      console.error('Unable to mark the caption submission failure.', {
        errorName: updateError instanceof Error ? updateError.name : 'unknown',
      });
    }
    return respond(200, { failed: true });
  }
});
