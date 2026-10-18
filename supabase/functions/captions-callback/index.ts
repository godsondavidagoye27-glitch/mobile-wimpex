import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';
import { normalizeWebVtt, parseWebVtt, writeWebVtt } from '../../../src/features/captions/vtt.ts';

const headers = { 'Content-Type': 'application/json' };
const secretHeader = 'x-captions-webhook-secret';

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function setFailed(
  admin: ReturnType<typeof createClient>,
  postId: string,
  errorCode: string,
) {
  const now = new Date().toISOString();
  const [{ error: postError }, { error: jobError }] = await Promise.all([
    admin.from('posts').update({
      captions_status: 'failed',
      captions_updated_at: now,
    }).eq('id', postId).eq('captions_status', 'processing'),
    admin.from('caption_jobs').update({
      status: 'failed',
      last_error: errorCode,
      updated_at: now,
    }).eq('post_id', postId).eq('status', 'processing'),
  ]);
  if (postError) throw postError;
  if (jobError) throw jobError;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const secret = Deno.env.get('CAPTIONS_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const assemblyKey = Deno.env.get('ASSEMBLYAI_API_KEY');
  if (!secret || !supabaseUrl || !serviceRoleKey || !assemblyKey) {
    console.error('The captions-callback function is missing required server configuration.');
    return respond(503, { error: 'Captions are not configured.' });
  }
  if (!constantTimeEquals(request.headers.get(secretHeader), secret)) {
    return respond(401, { error: 'Authentication is required.' });
  }

  let payload: { transcript_id?: unknown; status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: 'A valid provider callback is required.' });
  }
  if (
    typeof payload.transcript_id !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(payload.transcript_id)
    || !['completed', 'error'].includes(String(payload.status))
  ) {
    return respond(400, { error: 'A valid provider callback is required.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: job, error: jobError } = await admin
    .from('caption_jobs')
    .select('post_id,status,provider_job_id')
    .eq('provider_job_id', payload.transcript_id)
    .maybeSingle();
  if (jobError) {
    console.error('Unable to find the caption callback job.', { code: jobError.code });
    return respond(500, { error: 'Unable to process captions.' });
  }
  if (!job) return respond(503, { error: 'The caption job is not ready yet.' });
  if (['ready', 'no_speech', 'disabled'].includes(job.status)) return respond(200, { duplicate: true });
  if (payload.status === 'error') {
    try {
      await setFailed(admin, job.post_id, 'assemblyai_transcription_failed');
      return respond(200, { failed: true });
    } catch (error) {
      console.error('Unable to save the failed caption callback.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return respond(500, { error: 'Unable to process captions.' });
    }
  }

  try {
    const transcriptResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${encodeURIComponent(payload.transcript_id)}`,
      { headers: { authorization: assemblyKey } },
    );
    if (!transcriptResponse.ok) {
      await setFailed(admin, job.post_id, `assemblyai_transcript_http_${transcriptResponse.status}`);
      return respond(200, { failed: true });
    }
    const transcript = await transcriptResponse.json() as {
      status?: unknown;
      text?: unknown;
      language_code?: unknown;
    };
    if (transcript.status !== 'completed') {
      await setFailed(admin, job.post_id, 'assemblyai_transcript_incomplete');
      return respond(200, { failed: true });
    }
    if (typeof transcript.text !== 'string' || !transcript.text.trim()) {
      const now = new Date().toISOString();
      const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
        admin.from('posts').update({
          captions_status: 'no_speech',
          captions_updated_at: now,
        }).eq('id', job.post_id).eq('captions_status', 'processing'),
        admin.from('caption_jobs').update({
          status: 'no_speech',
          last_error: null,
          updated_at: now,
        }).eq('post_id', job.post_id).eq('status', 'processing'),
      ]);
      if (postUpdateError) throw postUpdateError;
      if (jobUpdateError) throw jobUpdateError;
      return respond(200, { noSpeech: true });
    }

    const subtitleResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${encodeURIComponent(payload.transcript_id)}/vtt?chars_per_caption=42`,
      { headers: { authorization: assemblyKey } },
    );
    if (!subtitleResponse.ok) {
      await setFailed(admin, job.post_id, `assemblyai_vtt_http_${subtitleResponse.status}`);
      return respond(200, { failed: true });
    }
    const providerVtt = await subtitleResponse.text();
    const parsedCues = parseWebVtt(providerVtt);
    if (parsedCues.length === 0) {
      await setFailed(admin, job.post_id, 'assemblyai_vtt_invalid');
      return respond(200, { failed: true });
    }
    const captions = writeWebVtt(normalizeWebVtt(parsedCues));
    if (new TextEncoder().encode(captions).byteLength > 204_800) {
      await setFailed(admin, job.post_id, 'captions_file_too_large');
      return respond(200, { failed: true });
    }

    const { data: post, error: postReadError } = await admin
      .from('posts')
      .select('author_id')
      .eq('id', job.post_id)
      .maybeSingle();
    if (postReadError) throw postReadError;
    if (!post) return respond(200, { deleted: true });
    const path = `${post.author_id}/${job.post_id}.vtt`;
    const { error: uploadError } = await admin.storage.from('captions').upload(
      path,
      new Blob([captions], { type: 'text/vtt' }),
      { contentType: 'text/vtt', upsert: true },
    );
    if (uploadError) throw uploadError;

    const now = new Date().toISOString();
    const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
      admin.from('posts').update({
        captions_path: path,
        captions_language: typeof transcript.language_code === 'string' ? transcript.language_code : null,
        captions_status: 'ready',
        captions_updated_at: now,
      }).eq('id', job.post_id).eq('captions_status', 'processing'),
      admin.from('caption_jobs').update({
        status: 'ready',
        last_error: null,
        updated_at: now,
      }).eq('post_id', job.post_id).eq('status', 'processing'),
    ]);
    if (postUpdateError) throw postUpdateError;
    if (jobUpdateError) throw jobUpdateError;
    return respond(200, { ready: true });
  } catch (error) {
    console.error('Unable to process the provider caption result.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    try {
      await setFailed(admin, job.post_id, 'caption_processing_failed');
    } catch (updateError) {
      console.error('Unable to persist the caption processing failure.', {
        errorName: updateError instanceof Error ? updateError.name : 'unknown',
      });
    }
    return respond(500, { error: 'Unable to process captions.' });
  }
});
