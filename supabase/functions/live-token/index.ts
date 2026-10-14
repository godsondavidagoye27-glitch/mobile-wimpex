import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

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
    console.error('The live-token function is missing required server configuration.');
    return jsonResponse(503, { error: 'Live streaming is not configured on the server.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Sign in to join a live stream.' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse(401, { error: 'Your session is invalid or expired.' });
  }

  try {
    const payload = await request.json();
    if (!isUuid(payload?.streamId)) return jsonResponse(400, { error: 'A valid live stream is required.' });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: stream, error: streamError } = await admin.from('live_streams')
      .select('id,host_id,room_name,title,status')
      .eq('id', payload.streamId)
      .maybeSingle();
    if (streamError) throw streamError;
    if (!stream || !['starting', 'live'].includes(stream.status)) {
      return jsonResponse(404, { error: 'This live stream is not available.' });
    }

    const isHost = stream.host_id === authData.user.id;
    if (!isHost && stream.status !== 'live') {
      return jsonResponse(404, { error: 'This live stream is not available.' });
    }
    const { data: canView, error: accessError } = await admin.rpc('can_view_live', {
      p_stream_id: stream.id,
      p_viewer_id: authData.user.id,
    });
    if (accessError) throw accessError;
    if (!canView) return jsonResponse(403, { error: 'You cannot join this live stream.' });

    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('username')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return jsonResponse(403, { error: 'This profile is unavailable.' });

    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: authData.user.id,
      name: profile.username,
      ttl: '10m',
    });
    token.addGrant({
      roomJoin: true,
      room: stream.room_name,
      canPublish: isHost,
      canPublishData: false,
      canSubscribe: true,
      ...(isHost ? { canPublishSources: ['camera', 'microphone'] } : {}),
    });

    return jsonResponse(200, {
      token: await token.toJwt(),
      serverUrl: livekitUrl,
      role: isHost ? 'host' : 'viewer',
      streamId: stream.id,
      title: stream.title,
    });
  } catch (error) {
    console.error('Live token request failed.', error);
    return jsonResponse(500, { error: 'Could not create a live stream token.' });
  }
});
