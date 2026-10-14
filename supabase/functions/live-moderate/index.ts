import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RoomServiceClient } from 'npm:livekit-server-sdk@2';

type Action = 'mute' | 'ban' | 'delete_message';

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
    console.error('The live-moderate function is missing required server configuration.');
    return jsonResponse(503, { error: 'Live moderation is not configured on the server.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Sign in to moderate a live stream.' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse(401, { error: 'Your session is invalid or expired.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const payload = await request.json();
    const action = payload?.action as Action;
    if (!['mute', 'ban', 'delete_message'].includes(action)) {
      return jsonResponse(400, { error: 'Unknown live moderation action.' });
    }
    if (!isUuid(payload?.streamId)) return jsonResponse(400, { error: 'A valid live stream is required.' });

    if (action === 'delete_message') {
      if (!isUuid(payload?.messageId)) return jsonResponse(400, { error: 'A valid live message is required.' });
      const { error } = await userClient.rpc('delete_live_message', {
        p_stream_id: payload.streamId,
        p_message_id: payload.messageId,
      });
      if (error) return jsonResponse(403, { error: error.message });
      return jsonResponse(200, { ok: true });
    }

    if (!isUuid(payload?.userId)) return jsonResponse(400, { error: 'A valid user is required.' });
    if (action === 'mute') {
      const durationSeconds = payload?.durationSeconds ?? 300;
      if (!Number.isInteger(durationSeconds)) {
        return jsonResponse(400, { error: 'Mute duration must be a number of seconds.' });
      }
      const { data: expiresAt, error } = await userClient.rpc('mute_live_user', {
        p_stream_id: payload.streamId,
        p_user_id: payload.userId,
        p_duration_seconds: durationSeconds,
      });
      if (error) return jsonResponse(403, { error: error.message });

      return jsonResponse(200, { ok: true, expiresAt });
    }

    const reason = payload?.reason == null ? null : String(payload.reason);
    const durationSeconds = payload?.durationSeconds ?? null;
    if (durationSeconds !== null && !Number.isInteger(durationSeconds)) {
      return jsonResponse(400, { error: 'Ban duration must be a number of seconds.' });
    }
    const { error: banError } = await userClient.rpc('ban_live_user', {
      p_stream_id: payload.streamId,
      p_user_id: payload.userId,
      p_reason: reason,
      p_duration_seconds: durationSeconds,
    });
    if (banError) return jsonResponse(403, { error: banError.message });

    const { data: stream, error: streamError } = await admin.from('live_streams')
      .select('room_name')
      .eq('id', payload.streamId)
      .maybeSingle();
    if (streamError) throw streamError;
    if (!stream) return jsonResponse(200, { ok: true, warning: 'The stream ended before the participant could be removed.' });

    try {
      const roomService = new RoomServiceClient(livekitHost(livekitUrl), livekitApiKey, livekitApiSecret);
      await roomService.removeParticipant(stream.room_name, payload.userId);
      return jsonResponse(200, { ok: true });
    } catch (error) {
      console.error('The participant was banned in the database but could not be removed from LiveKit.', error);
      return jsonResponse(200, {
        ok: true,
        warning: 'The account is blocked from getting another token, but the connected participant could not be removed.',
      });
    }
  } catch (error) {
    console.error('Live moderation request failed.', error);
    return jsonResponse(500, { error: 'Could not process this moderation request.' });
  }
});
