import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabase';

export type CallSession = {
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
  ended_at: string | null;
  created_at: string;
};

export type CallResponse = {
  call: CallSession;
  token: string;
  serverUrl: string;
  peer: { displayName: string };
  warning?: string;
};

export type CallAction = 'start' | 'accept' | 'connected' | 'end' | 'decline' | 'expire';

export async function requestCallAction(
  action: CallAction,
  params: { conversationId?: string; callId?: string; mediaType?: 'audio' | 'video' } = {},
): Promise<CallResponse | { ended: true; call: CallSession }> {
  const { data, error } = await getSupabaseClient().functions.invoke<CallResponse | { ended: true; call: CallSession }>(
    'livekit-call',
    { body: { action, ...params } },
  );
  if (error) {
    let responseMessage = (data as { error?: string } | null)?.error;
    if (!responseMessage) {
      const errorContext = error as typeof error & { context?: { json?: () => Promise<unknown> } };
      try {
        const body = await errorContext.context?.json?.();
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
          responseMessage = body.error;
        }
      } catch {
        responseMessage = undefined;
      }
    }
    throw new Error(responseMessage || error.message || 'Could not connect the call.');
  }
  if (!data) throw new Error('The call service returned an empty response.');
  return data;
}

export function subscribeToCall(callId: string, onUpdate: (call: CallSession) => void): () => void {
  const client = getSupabaseClient();
  const channel: RealtimeChannel = client
    .channel(`call-session:${callId}`, { config: { private: true } })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
      (payload) => onUpdate(payload.new as CallSession),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
