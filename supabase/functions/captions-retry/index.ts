import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';

const headers = { 'Content-Type': 'application/json' };

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const secret = Deno.env.get('CAPTIONS_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error('The captions-retry function is missing required server configuration.');
    return respond(503, { error: 'Caption retries are not configured.' });
  }
  if (!constantTimeEquals(request.headers.get('x-captions-webhook-secret'), secret)) {
    return respond(401, { error: 'Authentication is required.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const now = Date.now();
  const queuedCutoff = new Date(now - 10 * 60 * 1000).toISOString();
  const processingCutoff = new Date(now - 20 * 60 * 1000).toISOString();
  const [{ data: staleQueued, error: queuedError }, { data: staleProcessing, error: processingError }] =
    await Promise.all([
      admin.from('posts')
        .select('id,author_id,captions_attempts')
        .eq('captions_status', 'queued')
        .lt('captions_updated_at', queuedCutoff)
        .limit(100),
      admin.from('caption_jobs')
        .select('post_id')
        .eq('status', 'processing')
        .lt('updated_at', processingCutoff)
        .limit(100),
    ]);
  if (queuedError || processingError) {
    console.error('Unable to find stale caption jobs.', {
      queuedCode: queuedError?.code,
      processingCode: processingError?.code,
    });
    return respond(500, { error: 'Unable to retry captions.' });
  }

  const retryPosts = new Map<string, { attempts: number; status: 'queued' | 'processing' }>();
  for (const post of staleQueued ?? []) {
    retryPosts.set(post.id, { attempts: post.captions_attempts, status: 'queued' });
  }
  const staleProcessingJobs = staleProcessing ?? [];
  if (staleProcessingJobs.length) {
    const { data: processingPosts, error: postsError } = await admin.from('posts')
      .select('id,captions_status,captions_attempts')
      .in('id', staleProcessingJobs.map((job) => job.post_id))
      .in('captions_status', ['queued', 'processing']);
    if (postsError) {
      console.error('Unable to load stale caption posts.', { code: postsError.code });
      return respond(500, { error: 'Unable to retry captions.' });
    }
    for (const post of processingPosts ?? []) {
      if (post.captions_status !== 'queued' && post.captions_status !== 'processing') continue;
      retryPosts.set(post.id, {
        attempts: post.captions_attempts,
        status: post.captions_status,
      });
    }
  }

  let requeued = 0;
  let failed = 0;
  for (const [postId, stale] of retryPosts) {
    const nowIso = new Date().toISOString();
    if (stale.attempts >= 3) {
      const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
        admin.from('posts').update({
          captions_status: 'failed',
          captions_updated_at: nowIso,
        }).eq('id', postId).or('captions_status.eq.queued,captions_status.eq.processing'),
        admin.from('caption_jobs').update({
          status: 'failed',
          last_error: 'attempt_limit',
          updated_at: nowIso,
        }).eq('post_id', postId),
      ]);
      if (postUpdateError || jobUpdateError) {
        console.error('Unable to mark a caption job as failed.', {
          postId,
          postCode: postUpdateError?.code,
          jobCode: jobUpdateError?.code,
        });
        continue;
      }
      failed += 1;
      continue;
    }

    if (stale.status === 'queued') {
      const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
        admin.from('posts').update({
          captions_updated_at: nowIso,
        }).eq('id', postId).eq('captions_status', 'queued'),
        admin.from('caption_jobs').update({
          status: 'queued',
          provider_job_id: null,
          last_error: 'queued_webhook_timeout',
          updated_at: nowIso,
        }).eq('post_id', postId).eq('status', 'processing'),
      ]);
      if (postUpdateError || jobUpdateError) {
        console.error('Unable to re-notify the queued caption post.', {
          postId,
          postCode: postUpdateError?.code,
          jobCode: jobUpdateError?.code,
        });
        continue;
      }
    } else {
      const [{ error: postUpdateError }, { error: jobUpdateError }] = await Promise.all([
        admin.from('posts').update({
          captions_status: 'queued',
          captions_updated_at: nowIso,
        }).eq('id', postId).eq('captions_status', 'processing'),
        admin.from('caption_jobs').update({
          status: 'queued',
          provider_job_id: null,
          last_error: 'provider_timeout',
          updated_at: nowIso,
        }).eq('post_id', postId),
      ]);
      if (postUpdateError || jobUpdateError) {
        console.error('Unable to requeue a stale caption job.', {
          postId,
          postCode: postUpdateError?.code,
          jobCode: jobUpdateError?.code,
        });
        continue;
      }
    }
    requeued += 1;
  }

  return respond(200, { requeued, failed });
});
