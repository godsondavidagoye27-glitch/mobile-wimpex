import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

type Action = 'start' | 'accept' | 'connected' | 'end' | 'decline' | 'expire';
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

function livekitHost(url: string) {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

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

  let createdCallId: string | undefined;
  try {
    let pushWarning: string | undefined;
    const payload = await request.json();
    const action = payload?.action as Action;
    if (!['start', 'accept', 'connected', 'end', 'decline', 'expire'].includes(action)) {
      return jsonResponse(400, { error: 'Unknown call action.' });
    }

    let session: CallSession;
    if (action === 'start') {
      if (!isUuid(payload?.conversationId)) return jsonResponse(400, { error: 'A valid conversation is required.' });
      if (payload?.mediaType !== 'audio' && payload?.mediaType !== 'video') {
        return jsonResponse(400, { error: 'Choose audio or video calling.' });
      }
      const eligibility = await checkEligibility(admin, payload.conversationId, userId);
      if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });

      const { data: staleCalls, error: staleError } = await admin
        .from('call_sessions')
        .select('id')
        .eq('conversation_id', payload.conversationId)
        .eq('status', 'ringing')
        .lt('expires_at', new Date().toISOString());
      if (staleError) throw staleError;
      if (staleCalls.length) {
        const { error } = await admin.from('call_sessions')
          .update({ status: 'missed', ended_at: new Date().toISOString() })
          .in('id', staleCalls.map((row) => row.id));
        if (error) throw error;
      }

      const peer = eligibility.profiles.find((profile) => profile.id !== userId)!;
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
      const delivery = await sendIncomingCallPush(admin, session, peer.id, caller.display_name || caller.username);
      if (!delivery.accepted) {
        const { error: closeError } = await admin.from('call_sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', session.id)
          .in('status', ['ringing', 'connecting']);
        if (closeError) {
          console.error('Could not close a call with no available push destination.', closeError);
          throw new Error('The callee could not be notified and the call could not be closed. Please retry.');
        }
        return jsonResponse(503, { error: delivery.error || 'The callee could not be notified, so the call was not placed.' });
      }
      if (delivery.warning) pushWarning = delivery.warning;
    } else {
      if (!isUuid(payload?.callId)) return jsonResponse(400, { error: 'A valid call is required.' });
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
          const { error: expireError } = await admin.from('call_sessions').update({
            status: 'missed',
            ended_at: new Date().toISOString(),
          }).eq('id', session.id);
          if (expireError) throw expireError;
          return jsonResponse(410, { error: 'This call has expired.' });
        }
        const eligibility = await checkEligibility(admin, session.conversation_id, userId);
        if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });
        const { data: updated, error: updateError } = await admin.from('call_sessions')
          .update({ status: 'connecting' })
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
        const eligibility = await checkEligibility(admin, session.conversation_id, userId);
        if (eligibility.error) return jsonResponse(eligibility.status, { error: eligibility.error });
        const now = new Date().toISOString();
        const callerConnected = userId === session.caller_id || session.caller_connected_at !== null;
        const calleeConnected = userId === session.callee_id || session.callee_connected_at !== null;
        const patch = userId === session.caller_id
          ? { caller_connected_at: now }
          : { callee_connected_at: now };
        const { data: updated, error: updateError } = await admin.from('call_sessions')
          .update({
            ...patch,
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
    const { data: peer, error: peerError } = await admin.from('profiles')
      .select('display_name,username')
      .eq('id', peerId)
      .single();
    if (peerError) throw peerError;

    const { data: currentProfile, error: currentProfileError } = await admin.from('profiles')
      .select('display_name,username')
      .eq('id', userId)
      .single();
    if (currentProfileError) throw currentProfileError;
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
      peer: { displayName: peer.display_name || peer.username },
      ...(pushWarning ? { warning: pushWarning } : {}),
    });
  } catch (error) {
    console.error('LiveKit call request failed.', error);
    if (createdCallId) {
      const { error: closeError } = await admin.from('call_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', createdCallId)
        .in('status', ['ringing', 'connecting']);
      if (closeError) console.error('Could not close the call after a server failure.', closeError);
    }
    if (error instanceof Error && error.message.startsWith('The callee could not be notified')) {
      return jsonResponse(500, { error: error.message });
    }
    return jsonResponse(500, { error: 'Could not process this call request.' });
  }
});

async function sendIncomingCallPush(
  admin: ReturnType<typeof createClient>,
  session: CallSession,
  recipientId: string,
  callerName: string,
): Promise<{ accepted: boolean; warning?: string; error?: string }> {
  const { data: settings, error: settingsError } = await admin.from('user_settings')
    .select('push_enabled')
    .eq('user_id', recipientId)
    .maybeSingle();
  if (settingsError) {
    console.error('Could not read callee push preference.', settingsError);
    return { accepted: false, error: 'Could not check the callee notification preference; the call was not placed.' };
  }
  if (settings?.push_enabled === false) {
    return { accepted: false, error: 'The callee has disabled push notifications, so the call was not placed.' };
  }

  const { data: devices, error: devicesError } = await admin.from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', recipientId);
  if (devicesError) {
    console.error('Could not read callee push destinations.', devicesError);
    return { accepted: false, error: 'Could not find a notification destination; the call was not placed.' };
  }
  if (!devices.length) {
    return { accepted: false, error: 'The callee has no eligible push device, so the call was not placed.' };
  }

  const messages = devices.map((device) => ({
    to: device.expo_push_token,
    title: session.media_type === 'video' ? 'Incoming video call' : 'Incoming audio call',
    body: `${callerName} is calling you.`,
    sound: 'default',
    priority: 'high',
    data: {
      type: 'incoming_call',
      call_id: session.id,
      conversation_id: session.conversation_id,
      recipient_id: recipientId,
      media_type: session.media_type,
    },
  }));

  let acceptedCount = 0;
  let failedCount = 0;
  try {
    for (let index = 0; index < messages.length; index += 100) {
      const batch = messages.slice(index, index + 100);
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        const details = await response.text();
        console.error('Expo push endpoint rejected the incoming call notification.', response.status, details);
        failedCount += batch.length;
        continue;
      }
      const result = await response.json();
      const tickets = Array.isArray(result?.data) ? result.data : [];
      for (const ticket of tickets) {
        if (ticket?.status === 'ok') acceptedCount += 1;
        else failedCount += 1;
      }
      failedCount += Math.max(0, batch.length - tickets.length);
    }
    if (acceptedCount === 0) {
      return {
        accepted: false,
        error: 'Expo did not accept the incoming-call notification, so the call was not placed.',
      };
    }
    return {
      accepted: true,
      ...(failedCount ? { warning: 'Some devices could not be notified; the call is still ringing on available devices.' } : {}),
    };
  } catch (error) {
    console.error('Could not send the incoming call notification.', error);
    if (acceptedCount > 0) {
      return {
        accepted: true,
        warning: 'Some devices could not be notified; the call is still ringing on available devices.',
      };
    }
    return {
      accepted: false,
      error: 'Could not send the incoming-call notification, so the call was not placed.',
    };
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
