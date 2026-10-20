import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';
import { sendExpoPushMessages } from '../_shared/expoPush.ts';
import {
  isNotificationMuteActive,
  type NotificationMuteRow,
} from '../_shared/notificationMute.ts';
import {
  filterGoLivePushRecipients,
  selectDueScheduledPosts,
} from '../../../src/features/feed/scheduledPosts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-scheduler-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

type ScheduledPost = {
  id: string;
  status: string;
  scheduled_at: string | null;
};

type PublishedPost = {
  id: string;
  author_id: string;
  status: string;
  moderation_status: string;
  audience: 'everyone' | 'followers';
  caption: string;
};

type PushToken = {
  user_id: string;
  expo_push_token: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sendGoLivePushes(admin: ReturnType<typeof createClient>, post: PublishedPost) {
  if (post.status !== 'published' || post.moderation_status !== 'clear') return 0;

  const followerIds: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin
      .from('follows')
      .select('follower_id')
      .eq('following_id', post.author_id)
      .eq('status', 'accepted')
      .order('follower_id')
      .range(offset, offset + 499);
    if (error) throw error;
    const rows = data ?? [];
    followerIds.push(...rows.map((row: { follower_id: string }) => row.follower_id));
    if (rows.length < 500) break;
  }
  if (!followerIds.length) return 0;

  const [
    { data: blockedByAuthor, error: outgoingBlockError },
    { data: blockingAuthor, error: incomingBlockError },
  ] = await Promise.all([
    admin.from('blocks').select('blocked_id').eq('blocker_id', post.author_id).in('blocked_id', followerIds),
    admin.from('blocks').select('blocker_id').eq('blocked_id', post.author_id).in('blocker_id', followerIds),
  ]);
  if (outgoingBlockError) throw outgoingBlockError;
  if (incomingBlockError) throw incomingBlockError;
  const blockedIds = new Set<string>([
    ...(blockedByAuthor ?? []).map((block: { blocked_id: string }) => block.blocked_id),
    ...(blockingAuthor ?? []).map((block: { blocker_id: string }) => block.blocker_id),
  ]);
  const candidateIds = [...new Set(followerIds)];
  if (!candidateIds.length) return 0;

  const { data: author, error: authorError } = await admin
    .from('profiles')
    .select('display_name,username')
    .eq('id', post.author_id)
    .maybeSingle();
  if (authorError) throw authorError;
  const authorName = author?.display_name || author?.username || 'Someone you follow';
  const { data: settings, error: settingsError } = await admin
    .from('user_settings')
    .select('user_id,push_enabled')
    .in('user_id', candidateIds);
  if (settingsError) throw settingsError;
  const settingsByUser = new Map((settings ?? []).map((setting: { user_id: string; push_enabled: boolean }) => [
    setting.user_id,
    setting.push_enabled,
  ]));
  const pushDisabledIds = new Set(
    candidateIds.filter((userId) => settingsByUser.get(userId) === false),
  );
  const pushEnabledIds = candidateIds.filter((userId) => !pushDisabledIds.has(userId));
  if (!pushEnabledIds.length) return 0;

  const { data: mutes, error: mutesError } = await admin
    .from('notification_mutes')
    .select('owner_id,target_type,target_id,muted_until,mute_calls')
    .in('owner_id', candidateIds)
    .eq('target_type', 'user')
    .eq('target_id', post.author_id);
  if (mutesError) throw mutesError;
  const mutedIds = new Set(
    (mutes ?? [])
      .filter((mute: NotificationMuteRow) => isNotificationMuteActive(mute.muted_until))
      .map((mute: NotificationMuteRow) => mute.owner_id),
  );

  const quietResults = await Promise.all(pushEnabledIds.map(async (userId) => {
    const { data: suppress, error } = await admin.rpc('teen_should_suppress_push', { p_user_id: userId });
    if (error) {
      console.error('Could not evaluate go-live push quiet hours; skipping recipient.', {
        recipientId: userId,
        code: error.code,
      });
      return { userId, suppress: true };
    }
    return { userId, suppress: suppress === true };
  }));
  const quietIds = new Set(
    quietResults.filter((result) => result.suppress).map((result) => result.userId),
  );
  const eligibleRecipientIds = filterGoLivePushRecipients(
    candidateIds,
    blockedIds,
    pushDisabledIds,
    quietIds,
    mutedIds,
  );
  if (!eligibleRecipientIds.length) return 0;

  let sent = 0;
  for (let offset = 0; offset < eligibleRecipientIds.length; offset += 500) {
    const recipientBatch = eligibleRecipientIds.slice(offset, offset + 500);
    const { data: tokens, error: tokenError } = await admin
      .from('device_push_tokens')
      .select('user_id,expo_push_token')
      .in('user_id', recipientBatch);
    if (tokenError) throw tokenError;
    const messages = (tokens ?? []).map((token: PushToken) => ({
      to: token.expo_push_token,
      title: `${authorName} just posted`,
      body: post.caption.trim() || 'A new video is ready to watch.',
      sound: 'default',
      channelId: 'default',
      data: { type: 'post_published', post_id: post.id, recipient_id: token.user_id },
    }));
    if (messages.length) {
      const tickets = await sendExpoPushMessages(messages);
      sent += tickets.filter((ticket) => ticket.status === 'ok').length;
    }
  }
  return sent;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(503, { error: 'Scheduled publishing is not configured.' });
  }

  const secret = Deno.env.get('SCHEDULED_POSTS_WEBHOOK_SECRET');
  const isScheduler = Boolean(secret && constantTimeEquals(request.headers.get('x-scheduler-secret'), secret));
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!isScheduler) {
    const authorization = request.headers.get('Authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return jsonResponse(secret ? 401 : 503, { error: 'Authentication is required.' });
    const caller = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse(401, { error: 'The session is invalid or expired.' });

    let body: { postId?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'A scheduled post id is required.' });
    }
    if (typeof body.postId !== 'string' || !uuidPattern.test(body.postId)) {
      return jsonResponse(400, { error: 'A valid scheduled post id is required.' });
    }
    const { error: publishError } = await caller.rpc('publish_scheduled_post_now', { p_post_id: body.postId });
    if (publishError) return jsonResponse(400, { error: publishError.message });

    const { data: post, error: postError } = await admin
      .from('posts')
      .select('id,author_id,status,moderation_status,audience,caption')
      .eq('id', body.postId)
      .maybeSingle();
    if (postError) {
      console.error('The post went live, but its go-live notification target could not be loaded.', postError);
      return jsonResponse(200, { published: true, pushSent: false });
    }
    if (post) {
      try {
        await sendGoLivePushes(admin, post as PublishedPost);
      } catch (pushError) {
        console.error('Unable to send scheduled-post go-live pushes.', pushError);
      }
    }
    return jsonResponse(200, { published: true });
  }

  let candidates: ScheduledPost[];
  const { data, error: queryError } = await admin
    .from('posts')
    .select('id,status,scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at')
    .limit(100);
  if (queryError) return jsonResponse(500, { error: 'Unable to load scheduled posts.' });
  candidates = selectDueScheduledPosts((data ?? []) as ScheduledPost[], Date.now(), 100);

  let published = 0;
  let failed = 0;
  let pushDeliveries = 0;
  for (const candidate of candidates) {
    const { data: didPublish, error: publishError } = await admin.rpc(
      'publish_due_scheduled_post',
      { p_post_id: candidate.id },
    );
    if (publishError) {
      failed += 1;
      console.error('Unable to publish a due scheduled post.', { postId: candidate.id, error: publishError.message });
      continue;
    }
    if (!didPublish) continue;
    published += 1;

    const { data: post, error: postError } = await admin
      .from('posts')
      .select('id,author_id,status,moderation_status,audience,caption')
      .eq('id', candidate.id)
      .maybeSingle();
    if (postError || !post) {
      failed += 1;
      console.error('Unable to load a published post for go-live notifications.', candidate.id);
      continue;
    }
    try {
      pushDeliveries += await sendGoLivePushes(admin, post as PublishedPost);
    } catch (pushError) {
      console.error('Unable to send scheduled-post go-live pushes.', { postId: candidate.id, pushError });
    }
  }
  return jsonResponse(200, { considered: candidates.length, published, failed, pushDeliveries });
});
