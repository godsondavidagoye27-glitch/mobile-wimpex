import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { classifyModeration } from '../_shared/moderationScoring.ts';
import { moderationSystemPrompt, parseOpenRouterModerationResponse } from '../_shared/openRouterModeration.ts';
import { constantTimeEquals } from '../_shared/constantTime.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
const moderationModel = Deno.env.get('OPENROUTER_MODERATION_MODEL') ?? 'openai/gpt-4o-mini';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!supabaseUrl || !anonKey || !serviceKey || !openRouterKey) {
    console.error('Moderation function is missing required configuration.');
    return Response.json({ error: 'Moderation is temporarily unavailable.' }, { status: 503 });
  }
  const workerSecret = Deno.env.get('MODERATION_WORKER_SECRET');
  const isWorker = Boolean(
    workerSecret && constantTimeEquals(request.headers.get('x-moderation-worker-secret'), workerSecret),
  );
  const authorization = request.headers.get('Authorization');
  let requesterId: string | null = null;
  if (!isWorker) {
    if (!authorization) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userResult, error: userError } = await caller.auth.getUser();
    if (userError || !userResult.user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    requesterId = userResult.user.id;
  }

  const admin = createClient(supabaseUrl, serviceKey);
  if (isWorker) {
    const { error: recoverError } = await admin.rpc('retry_stale_moderation_jobs');
    if (recoverError) {
      console.error('Moderation stale-job recovery failed.', { code: recoverError.code });
      return Response.json({ error: 'Moderation could not start.' }, { status: 503 });
    }
  }
  let jobsQuery = admin
    .from('moderation_jobs')
    .select('id,content_type,content_id,attempts')
    .in('status', ['pending', 'retry'])
    .lte('available_at', new Date().toISOString())
    .order('created_at')
    .limit(5);
  if (requesterId) jobsQuery = jobsQuery.eq('requested_by', requesterId);
  const { data: jobs, error: jobsError } = await jobsQuery;
  if (jobsError) {
    console.error('Moderation queue lookup failed.', jobsError);
    return Response.json({ error: 'Moderation could not start.' }, { status: 503 });
  }

  const results: { jobId: string; status: 'done' | 'retry' }[] = [];
  for (const job of jobs ?? []) {
    const { data: claimed, error: claimError } = await admin.from('moderation_jobs')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('status', ['pending', 'retry'])
      .select('id');
    if (claimError) {
      console.error('Moderation job claim failed.', { jobId: job.id, code: claimError.code });
      continue;
    }
    if (!claimed?.length) continue;
    try {
      const { text, imageUrl, authorId } = await loadContent(admin, job.content_type, job.content_id);
      if (!authorId) throw new Error('Content is unavailable.');
      const input = imageUrl
        ? [{ type: 'text', text: text || 'No caption text was provided.' }, { type: 'image_url', image_url: { url: imageUrl } }]
        : text || 'No text was provided.';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let response: Response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: moderationModel,
            temperature: 0,
            max_tokens: 160,
            provider: { zdr: true },
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: moderationSystemPrompt },
              { role: 'user', content: input },
            ],
          }),
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`OpenRouter moderation returned ${response.status}.`);
      const scores = parseOpenRouterModerationResponse(await response.json());
      const flags = classifyModeration(scores);
      for (const flag of flags) {
        const { error: flagError } = await admin.from('moderation_flags').upsert({
          content_type: job.content_type,
          content_id: job.content_id,
          author_id: authorId,
          category: flag.category,
          score: flag.score,
          status: 'review',
          decision_note: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'content_type,content_id,category' });
        if (flagError) throw flagError;
      }
      const hasHighConfidenceFlag = flags.some((flag) => flag.highConfidence);
      await setModerationStatus(
        admin,
        job.content_type,
        job.content_id,
        hasHighConfidenceFlag ? 'hidden' : 'clear',
      );
      const { error: completeError } = await admin.from('moderation_jobs')
        .update({ status: 'done', attempts: job.attempts + 1, last_error: null, processing_started_at: null })
        .eq('id', job.id);
      if (completeError) throw completeError;
      results.push({ jobId: job.id, status: 'done' });
    } catch {
      const attempts = job.attempts + 1;
      const safeMessage = 'Moderation processing failed.';
      console.error('Moderation job failed.', { jobId: job.id, attempts });
      const { error: retryError } = await admin.from('moderation_jobs').update({
        status: 'retry',
        attempts,
        available_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
        last_error: safeMessage,
        processing_started_at: null,
      }).eq('id', job.id);
      if (retryError) console.error('Unable to persist moderation retry.', { jobId: job.id, code: retryError.code });
      results.push({ jobId: job.id, status: 'retry' });
    }
  }
  return Response.json({ processed: results.length, results });
});

async function loadContent(
  admin: ReturnType<typeof createClient>,
  type: 'post' | 'comment' | 'story_question_reply',
  id: string,
): Promise<{ text: string; imageUrl: string | null; authorId: string | null }> {
  if (type === 'comment') {
    const { data, error } = await admin.from('comments').select('body,author_id').eq('id', id).maybeSingle();
    if (error) throw error;
    return { text: data?.body ?? '', imageUrl: null, authorId: data?.author_id ?? null };
  }
  if (type === 'story_question_reply') {
    const { data, error } = await admin.from('story_question_replies')
      .select('body,responder_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return {
      text: data?.body ?? '',
      imageUrl: null,
      authorId: data?.responder_id ?? null,
    };
  }
  const { data, error } = await admin.from('posts')
    .select('caption,author_id,thumb_path')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const signed = data?.thumb_path
    ? await admin.storage.from('thumbnails').createSignedUrl(data.thumb_path, 60)
    : null;
  if (signed?.error) throw signed.error;
  return { text: data?.caption ?? '', imageUrl: signed?.data.signedUrl ?? null, authorId: data?.author_id ?? null };
}

async function setModerationStatus(
  admin: ReturnType<typeof createClient>,
  type: 'post' | 'comment' | 'story_question_reply',
  id: string,
  status: 'clear' | 'hidden',
) {
  const table = type === 'post'
    ? 'posts'
    : type === 'comment'
      ? 'comments'
      : 'story_question_replies';
  const { error } = await admin.from(table).update({ moderation_status: status }).eq('id', id);
  if (error) throw error;
}
