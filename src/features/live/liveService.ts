import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';
import type { Database, LiveMessageRow, LiveStreamRpcRow } from '../../types/database';

type Client = SupabaseClient<Database>;

export type LiveConnection = {
  token: string;
  serverUrl: string;
  role: 'host' | 'viewer';
  streamId: string;
  title: string;
};

export type LiveModerationAction =
  | { action: 'mute'; userId: string; durationSeconds?: number }
  | { action: 'ban'; userId: string; reason?: string; durationSeconds?: number | null }
  | { action: 'delete_message'; messageId: string };

function getClient() {
  return getSupabaseClient();
}

export async function getLiveStreams(client: Client = getClient()): Promise<LiveStreamRpcRow[]> {
  const { data, error } = await client.rpc('get_live_streams', { p_limit: 50 });
  if (error) throw error;
  return data ?? [];
}

export async function getLiveStream(streamId: string, client: Client = getClient()): Promise<LiveStreamRpcRow> {
  const { data, error } = await client.rpc('get_live_stream', { p_stream_id: streamId });
  if (error) throw error;
  const stream = data?.[0];
  if (!stream) throw new Error('This live stream is no longer available.');
  return stream;
}

export async function startLive(title: string, client: Client = getClient()): Promise<string> {
  const { data, error } = await client.rpc('start_live', { p_title: title.trim() });
  if (error) throw error;
  if (!data) throw new Error('The live service did not create a stream.');
  return data;
}

export async function requestLiveConnection(streamId: string, client: Client = getClient()): Promise<LiveConnection> {
  const { data, error } = await client.functions.invoke<LiveConnection>('live-token', { body: { streamId } });
  if (error) throw error;
  if (
    !data
    || typeof data.token !== 'string'
    || typeof data.serverUrl !== 'string'
    || (data.role !== 'host' && data.role !== 'viewer')
    || data.streamId !== streamId
  ) {
    throw new Error('The live service returned an invalid connection.');
  }
  return data;
}

export async function markLiveStarted(streamId: string, client: Client = getClient()) {
  const { error } = await client.rpc('mark_live_started', { p_stream_id: streamId });
  if (error) throw error;
}

export async function heartbeatLive(streamId: string, client: Client = getClient()) {
  const { error } = await client.rpc('live_heartbeat', { p_stream_id: streamId });
  if (error) throw error;
}

export async function endLive(streamId: string, client: Client = getClient()) {
  const { error } = await client.rpc('end_live', { p_stream_id: streamId });
  if (error) throw error;
}

export async function sendLiveMessage(streamId: string, body: string, client: Client = getClient()) {
  const { error } = await client.rpc('send_live_message', { p_stream_id: streamId, p_body: body });
  if (error) throw error;
}

export async function getLiveMessages(streamId: string, client: Client = getClient()): Promise<LiveMessageRow[]> {
  const { data, error } = await client
    .from('live_messages')
    .select('*')
    .eq('stream_id', streamId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export function subscribeToLiveMessages(
  streamId: string,
  onChange: (message: LiveMessageRow, event: 'INSERT' | 'UPDATE') => void,
  client: Client = getClient(),
): RealtimeChannel {
  return client
    .channel(`live-messages:${streamId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'live_messages', filter: `stream_id=eq.${streamId}` },
      (payload) => onChange(payload.new as LiveMessageRow, 'INSERT'),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_messages', filter: `stream_id=eq.${streamId}` },
      (payload) => onChange(payload.new as LiveMessageRow, 'UPDATE'),
    )
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Live chat subscription failed.', error);
      }
    });
}

export async function moderateLive(
  streamId: string,
  moderation: LiveModerationAction,
  client: Client = getClient(),
) {
  const { data, error } = await client.functions.invoke<{ ok: boolean; warning?: string }>('live-moderate', {
    body: { ...moderation, streamId },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error('The live moderation action was not confirmed.');
  return data;
}
