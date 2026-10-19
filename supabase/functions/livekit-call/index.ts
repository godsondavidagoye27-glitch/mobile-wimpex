import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';
import { sendExpoPushMessages } from '../_shared/expoPush.ts';
import { getStaleCallTerminalStatus } from '../_shared/callLifecycle.ts';
import { getCallErrorDetails, mapCallFailure } from '../_shared/callErrors.ts';

type Action = 'start' | 'accept' | 'connected' | 'heartbeat' | 'end' | 'decline' | 'expire';
type CallSession = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  room_name: string;
  media_type: 'audio' | 'video';
  status: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
  caller_connected_at: string | null;
  callee_connected_at: string | null;
  last_activity_at: string;
  expires_at: string;
};
type Profile = {
  id: string;
  username: string;
  display_name: string;
  date_of_birth: string;
  dm_policy: 'everyone' | 'friends' | 'none';
  is_demo: boolean;
  is_official: boolean;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ageOnToday(dateOfBirth: string) {
  const birthday = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (!Number.isFinite(birthday.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  if (
    today.getUTCMonth() < birthday.getUTCMonth()
    || (today.getUTCMonth() === birthday.getUTCMonth() && today.getUTCDate() < birthday.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function isTerminal(status: CallSession['status']) {
  return status === 'ended' || status === 'declined' || status === 'missed';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const livekitUrl = Deno.env.get('LIVEKIT_URL');
  const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
  const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) {
    console.error('The livekit-call function is missing required server configuration.');
    return jsonResponse(503, { error: 'Calling is not configured on the server.' });
  }

  let createdCallId: string | undefined;
  let action = 'unknown';
  let stage = 'auth';
  let adminClient: ReturnType<typeof createClient> | undefined;
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Sign in to use calling.' });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse(401, { error: 'Your session is invalid or expired.' });
    const userId = authData.user.id;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    adminClient = admin;

    let pushWarning: string | undefined;
    let pushWarningCode: 'push_unavailable' | 'push_partial' | undefined;
    let ringReachability: 'push_sent' | 'push_partial' | 'push_unavailable' = 'push_sent';
    stage = 'parse_request';
    const payload = await request.json();
    action = payload?.action as Action;
    if (!['start', 'accept', 'connected', 'heartbeat', 'end', 'decline', 'expire'].includes(action)) {
      return jsonResponse(400, { error: 'Unknown call action.' });
    }

    let session: CallSession;
    if (action === 'start') {
      if (!isUuid(payload?.conversationId)) return jsonResponse(400, { error: 'A valid conversation is required.' });
      if (payload?.mediaType !== 'audio' && payload?.mediaType !== 'video') {
        return jsonResponse(400, { error: 'Choose audio or video calling.' });
      }
      stage = 'eligibility';
      const eligibility = await checkEligibility(admin, payload.conversationId, userId);
      if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });

      stage = 'load_stale_calls';
      const { data: staleCalls, error: staleError } = await admin
        .from('call_sessions')
        .select('id,status,created_at,expires_at,last_activity_at')
        .eq('conversation_id', payload.conversationId)
        .in('status', ['ringing', 'connecting', 'active']);
      if (staleError) throw staleError;
      const staleCall = staleCalls.find((candidate) =>
        getStaleCallTerminalStatus(candidate, Date.now()) !== null,
      );
      if (staleCall) {
        const terminalStatus = getStaleCallTerminalStatus(staleCall, Date.now());
        if (!terminalStatus) throw new Error('Stale call status changed while checking the conversation.');
        const { error } = await admin.from('call_sessions')
          .update({ status: terminalStatus, ended_at: new Date().toISOString() })
          .eq('id', staleCall.id)
          .eq('status', staleCall.status);
        if (error) throw error;
      }

      const peer = eligibility.profiles.find((profile) => profile.id !== userId)!;
      stage = 'insert_session';
      const { data, error } = await admin.from('call_sessions').insert({
        conversation_id: payload.conversationId,
        caller_id: userId,
        callee_id: peer.id,
        room_name: `wimpex-${crypto.randomUUID()}`,
        media_type: payload.mediaType,
        expires_at: new Date(Date.now() + 45_000).toISOString(),
      }).select('*').single();
      if (error) {
        if (error.code === '23505') return jsonResponse(409, { error: 'There is already a call in progress for this chat.' });
        throw error;
      }
      session = data as CallSession;
      createdCallId = session.id;

      const caller = eligibility.profiles.find((profile) => profile.id === userId)!;
      stage = 'send_push';
      let delivery: Awaited<ReturnType<typeof sendIncomingCallPush>> = {
        warningCode: 'push_unavailable',
        warning: 'They may not be notified unless Wimpex is open.',
      };
      try {
        delivery = await sendIncomingCallPush(admin, session, peer.id, caller.display_name || caller.username);
      } catch (pushError) {
        console.error('Could not send the incoming call notification.', pushError);
      }
      pushWarning = delivery.warning;
      pushWarningCode = delivery.warningCode;
      ringReachability = delivery.warningCode ?? 'push_sent';
    } else {
      if (!isUuid(payload?.callId)) return jsonResponse(400, { error: 'A valid call is required.' });
      stage = 'load_session';
      const { data, error } = await admin.from('call_sessions')
        .select('*')
        .eq('id', payload.callId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(404, { error: 'This call is no longer available.' });
      session = data as CallSession;
      if (userId !== session.caller_id && userId !== session.callee_id) {
        return jsonResponse(403, { error: 'You are not a participant in this call.' });
      }

      if (action === 'accept') {
        if (userId !== session.callee_id || session.status !== 'ringing') {
          return jsonResponse(409, { error: 'This call can no longer be answered.' });
        }
        if (new Date(session.expires_at).getTime() <= Date.now()) {
          stage = 'update_session';
          const { error: expireError } = await admin.from('call_sessions').update({
            status: 'missed',
            ended_at: new Date().toISOString(),
          }).eq('id', session.id);
          if (expireError) throw expireError;
          return jsonResponse(410, { error: 'This call has expired.' });
        }
        stage = 'eligibility';
        const eligibility = await checkEligibility(admin, session.conversation_id, userId);
        if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });
        stage = 'update_session';
        const { data: updated, error: updateError } = await admin.from('call_sessions')
          .update({ status: 'connecting', last_activity_at: new Date().toISOString() })
          .eq('id', session.id)
          .eq('status', 'ringing')
          .select('*')
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) return jsonResponse(409, { error: 'This call has already been answered or ended.' });
        session = updated as CallSession;
      } else if (action === 'connected') {
        if (isTerminal(session.status)) return jsonResponse(409, { error: 'This call has already ended.' });
        if (userId === session.callee_id && session.status === 'ringing') {
          return jsonResponse(409, { error: 'Answer the call before connecting.' });
        }
        if (new Date(session.expires_at).getTime() <= Date.now() && session.status === 'ringing') {
          return jsonResponse(410, { error: 'This call has expired.' });
        }
        stage = 'eligibility';
        const eligibility = await checkEligibility(admin, session.conversation_id, userId);
        if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });
        const now = new Date().toISOString();
        const callerConnected = userId === session.caller_id || session.caller_connected_at !== null;
        const calleeConnected = userId === session.callee_id || session.callee_connected_at !== null;
        const patch = userId === session.caller_id
          ? { caller_connected_at: now }
          : { callee_connected_at: now };
        stage = 'update_session';
        const { data: updated, error: updateError } = await admin.from('call_sessions')
          .update({
            ...patch,
              last_activity_at: now,
              status: callerConnected && calleeConnected
              ? 'active'
              : session.status === 'ringing'
                ? 'ringing'
                : 'connecting',
          })
          .eq('id', session.id)
          .in('status', ['ringing', 'connecting', 'active'])
          .select('*')
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) return jsonResponse(409, { error: 'This call has already ended.' });
        session = updated as CallSession;
      } else if (action === 'heartbeat') {
        if (session.status !== 'active') {
          return jsonResponse(409, { error: 'This call is no longer active.' });
        }
        stage = 'update_session';
        const { data: updated, error: heartbeatError } = await admin.from('call_sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', session.id)
          .eq('status', 'active')
          .select('*')
          .maybeSingle();
        if (heartbeatError) throw heartbeatError;
        if (!updated) return jsonResponse(409, { error: 'This call has already ended.' });
        session = updated as CallSession;
      } else if (action === 'end' || action === 'decline' || action === 'expire') {
        if (isTerminal(session.status)) return jsonResponse(200, { ended: true, call: session });
        if (action === 'decline' && userId !== session.callee_id) {
          return jsonResponse(403, { error: 'Only the person receiving the call can decline it.' });
        }
        if (action === 'decline' && session.status !== 'ringing') {
          return jsonResponse(409, { error: 'Only an unanswered call can be declined.' });
        }
        if (action === 'expire') {
          if (session.status !== 'ringing') {
            return jsonResponse(409, { error: 'Only an unanswered call can expire.' });
          }
          if (new Date(session.expires_at).getTime() > Date.now()) {
            return jsonResponse(409, { error: 'This call has not expired yet.' });
          }
        }
        stage = 'update_session';
        const update = admin.from('call_sessions')
          .update({
            status: action === 'decline' ? 'declined' : action === 'expire' ? 'missed' : 'ended',
            ended_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        const { data: updated, error: updateError } = action === 'expire'
          ? await update.eq('status', 'ringing').select('*').maybeSingle()
          : await update.in('status', ['ringing', 'connecting', 'active']).select('*').maybeSingle();
        if (updateError) throw updateError;
        if (updated) session = updated as CallSession;
        return jsonResponse(200, { ended: true, call: session });
      }
    }

    const peerId = userId === session.caller_id ? session.callee_id : session.caller_id;
    stage = 'load_profiles';
    const { data: peer, error: peerError } = await admin.from('profiles')
      .select('id,display_name,username')
      .eq('id', peerId)
      .single();
    if (peerError) throw peerError;

    const { data: currentProfile, error: currentProfileError } = await admin.from('profiles')
      .select('display_name,username')
      .eq('id', userId)
      .single();
    if (currentProfileError) throw currentProfileError;
    stage = 'mint_token';
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: userId,
      name: currentProfile.display_name || currentProfile.username,
      ttl: '1h',
    });
    token.addGrant({
      roomJoin: true,
      room: session.room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: session.media_type === 'video' ? ['camera', 'microphone'] : ['microphone'],
    });
    return jsonResponse(200, {
      call: session,
      token: await token.toJwt(),
      serverUrl: livekitUrl,
      peer: { id: peer.id, displayName: peer.display_name || peer.username },
      ringReachability,
      ...(pushWarningCode ? { warningCode: pushWarningCode } : {}),
      ...(pushWarning ? { warning: pushWarning } : {}),
    });
  } catch (error) {
    const details = getCallErrorDetails(error);
    const failure = mapCallFailure(error);
    console.error('LiveKit call request failed.', {
      requestId,
      action,
      stage,
      code: details.code,
      message: details.message,
    });
    if (createdCallId && adminClient) {
      try {
        const { error: closeError } = await adminClient.from('call_sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', createdCallId)
          .in('status', ['ringing', 'connecting']);
        if (closeError) throw closeError;
      } catch (closeError) {
        const closeDetails = getCallErrorDetails(closeError);
        console.error('Could not close the call after a server failure.', {
          requestId,
          action,
          stage: 'cleanup_session',
          code: closeDetails.code,
          message: closeDetails.message,
        });
      }
    }
    return jsonResponse(failure.status, {
      error: failure.message,
      code: failure.code,
      stage,
      requestId,
    });
  }
});

async function sendIncomingCallPush(
  admin: ReturnType<typeof createClient>,
  session: CallSession,
  recipientId: string,
  callerName: string,
): Promise<{ warning?: string; warningCode?: 'push_unavailable' | 'push_partial' }> {
  let pushEnabled: boolean | null | undefined;
  try {
    const { data: settings, error: settingsError } = await admin.from('user_settings')
      .select('push_enabled')
      .eq('user_id', recipientId)
      .maybeSingle();
    if (settingsError) {
      console.error('Could not read callee push preference.', settingsError);
      return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
    }
    pushEnabled = settings?.push_enabled;
  } catch (error) {
    console.error('Could not read callee push preference.', error);
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  }
  if (pushEnabled === false) {
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  }

  let devices: { expo_push_token: string }[];
  try {
    const { data, error } = await admin.from('device_push_tokens')
      .select('expo_push_token')
      .eq('user_id', recipientId);
    if (error) {
      console.error('Could not read callee push destinations.', error);
      return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
    }
    devices = data ?? [];
  } catch (error) {
    console.error('Could not read callee push destinations.', error);
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  }
  if (!devices.length) {
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  }

  const messages = devices.map((device) => ({
    to: device.expo_push_token,
    title: session.media_type === 'video' ? 'Incoming video call' : 'Incoming audio call',
    body: `${callerName} is calling you.`,
    sound: 'default',
    channelId: 'calls',
    priority: 'high',
    ttl: 45,
    interruptionLevel: 'timeSensitive',
    data: {
      type: 'incoming_call',
      call_id: session.id,
      conversation_id: session.conversation_id,
      recipient_id: recipientId,
      media_type: session.media_type,
    },
  }));

  try {
    const tickets = await sendExpoPushMessages(messages);
    const staleTokens = tickets.flatMap((ticket, index) =>
      ticket.details?.error === 'DeviceNotRegistered'
        ? [devices[index]?.expo_push_token].filter((token): token is string => typeof token === 'string')
        : [],
    );
    if (staleTokens.length) {
      const { error: pruneError } = await admin.from('device_push_tokens')
        .delete()
        .eq('user_id', recipientId)
        .in('expo_push_token', staleTokens);
      if (pruneError) console.error('Could not remove stale call notification tokens.', pruneError);
    }
    const acceptedCount = tickets.filter((ticket) => ticket.status === 'ok').length;
    if (acceptedCount === messages.length) return {};
    if (acceptedCount > 0) {
      console.warn('Some devices did not accept the incoming-call notification.');
      return { warningCode: 'push_partial', warning: 'They may not be notified on every device.' };
    }
    console.warn('No device accepted the incoming-call notification.');
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  } catch (error) {
    console.error('Could not send the incoming call notification.', error);
    return { warningCode: 'push_unavailable', warning: 'They may not be notified unless Wimpex is open.' };
  }
}

async function checkEligibility(
  admin: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
): Promise<{ profiles: Profile[]; error?: string; status: number }> {
  const { data: conversation, error: conversationError } = await admin.from('conversations')
    .select('id,type,read_only,is_demo')
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return { profiles: [], status: 404, error: 'This conversation is no longer available.' };
  if (conversation.type !== 'direct' || conversation.read_only || conversation.is_demo) {
    return { profiles: [], status: 403, error: 'Calls are only available in regular one-to-one chats.' };
  }

  const { data: members, error: membersError } = await admin.from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .is('left_at', null);
  if (membersError) throw membersError;
  if (members.length !== 2 || !members.some((member) => member.user_id === userId)) {
    return { profiles: [], status: 403, error: 'You are not an active member of this one-to-one chat.' };
  }

  const { data: profiles, error: profilesError } = await admin.from('profiles')
    .select('id,username,display_name,date_of_birth,dm_policy,is_demo,is_official')
    .in('id', members.map((member) => member.user_id));
  if (profilesError) throw profilesError;
  if (profiles.length !== 2 || profiles.some((profile) => profile.is_demo || profile.is_official)) {
    return { profiles: [], status: 403, error: 'Calls are not available with demo or official accounts.' };
  }
  if (profiles.some((profile) => {
    const age = ageOnToday(profile.date_of_birth);
    return age === null || age < 18 || age > 120;
  })) {
    return { profiles: [], status: 403, error: 'Calling is currently limited to adults.' };
  }

  const { data: blocks, error: blocksError } = await admin.from('blocks')
    .select('blocker_id')
    .in('blocker_id', members.map((member) => member.user_id))
    .in('blocked_id', members.map((member) => member.user_id));
  if (blocksError) throw blocksError;
  if (blocks.length) return { profiles: [], status: 403, error: 'Calls are unavailable because of a blocked relationship.' };

  const recipient = profiles.find((profile) => profile.id !== userId)!;
  if (recipient.dm_policy === 'none') {
    return { profiles: [], status: 403, error: 'This person does not accept calls.' };
  }
  if (recipient.dm_policy === 'friends') {
    const { data: follows, error: followsError } = await admin.from('follows')
      .select('follower_id,following_id,status')
      .in('follower_id', members.map((member) => member.user_id))
      .in('following_id', members.map((member) => member.user_id))
      .eq('status', 'accepted');
    if (followsError) throw followsError;
    const mutual = follows.some((follow) => follow.follower_id === userId && follow.following_id === recipient.id)
      && follows.some((follow) => follow.follower_id === recipient.id && follow.following_id === userId);
    if (!mutual) return { profiles: [], status: 403, error: 'A mutual accepted follow is required before calling.' };
  }

  return { profiles, status: 200 };
}
