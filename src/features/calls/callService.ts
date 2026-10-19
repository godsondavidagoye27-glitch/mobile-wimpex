import type { RealtimeChannel } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { getSupabaseClient } from '../../lib/supabase';

type CallErrorResponse = {
  error?: unknown;
  code?: unknown;
  stage?: unknown;
  requestId?: unknown;
};

export class CallRequestError extends Error {
  readonly code?: string;
  readonly stage?: string;
  readonly requestId?: string;

  constructor(message: string, response: CallErrorResponse) {
    super(message);
    this.name = 'CallRequestError';
    this.code = typeof response.code === 'string' ? response.code : undefined;
    this.stage = typeof response.stage === 'string' ? response.stage : undefined;
    this.requestId = typeof response.requestId === 'string' ? response.requestId : undefined;
  }
}

export function getCallErrorReference(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const details = error as { requestId?: unknown; stage?: unknown };
  const profile = Constants.expoConfig?.extra?.appVariant;
  if (
    (profile !== 'preview' && profile !== 'development')
    || typeof details.requestId !== 'string'
    || typeof details.stage !== 'string'
  ) return null;
  return `ref: ${details.requestId} / ${details.stage}`;
}

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
  peer: { id: string; displayName: string };
  ringReachability?: 'push_sent' | 'push_partial' | 'push_unavailable';
  warningCode?: 'push_unavailable' | 'push_partial';
  warning?: string;
};

export type CallAction = 'start' | 'accept' | 'connected' | 'heartbeat' | 'end' | 'decline' | 'expire';

export async function requestCallAction(
  action: CallAction,
  params: { conversationId?: string; callId?: string; mediaType?: 'audio' | 'video' } = {},
): Promise<CallResponse | { ended: true; call: CallSession }> {
  const { data, error } = await getSupabaseClient().functions.invoke<CallResponse | { ended: true; call: CallSession }>(
    'livekit-call',
    { body: { action, ...params } },
  );
  if (error) {
    let response: CallErrorResponse = {};
    const dataBody = data as CallErrorResponse | null;
    if (dataBody && typeof dataBody === 'object') response = dataBody;
    if (
      typeof response.error !== 'string'
      || typeof response.code !== 'string'
      || typeof response.stage !== 'string'
      || typeof response.requestId !== 'string'
    ) {
      const errorContext = error as typeof error & { context?: { json?: () => Promise<unknown> } };
      try {
        const body: unknown = await errorContext.context?.json?.();
        if (body && typeof body === 'object') {
          response = { ...response, ...(body as CallErrorResponse) };
        }
      } catch (parseError) {
        console.error('Could not read the call error response body.', parseError);
      }
    }
    const message = response.code === 'call_schema_outdated'
      ? 'Calling is being updated. Try again soon.'
      : response.code === 'call_server_error'
        ? 'Could not process this call request. Please try again.'
        : typeof response.error === 'string' && response.error
          ? response.error
          : error.message || 'Could not connect the call.';
    throw new CallRequestError(message, response);
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
    .subscribe((status, error) => {
      if (error) console.error('Could not subscribe to call status updates.', error);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn('Call status realtime channel is unavailable; the polling fallback remains active.', status);
      }
    });
  return () => {
    void client.removeChannel(channel);
  };
}

export async function fetchCallSession(callId: string): Promise<CallSession | null> {
  const { data, error } = await getSupabaseClient()
    .from('call_sessions')
    .select('id,conversation_id,caller_id,callee_id,room_name,media_type,status,caller_connected_at,callee_connected_at,expires_at,ended_at,created_at')
    .eq('id', callId)
    .maybeSingle();
  if (error) throw error;
  return data as CallSession | null;
}

export type IncomingCall = Pick<
  CallSession,
  'id' | 'conversation_id' | 'callee_id' | 'media_type' | 'status' | 'expires_at'
>;

export function subscribeToIncomingCalls(
  userId: string,
  onIncoming: (call: IncomingCall) => void,
): () => void {
  const client = getSupabaseClient();
  const channel: RealtimeChannel = client
    .channel(`incoming-calls:${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'call_sessions',
      filter: `callee_id=eq.${userId}`,
    }, (payload) => {
      if (payload.eventType === 'DELETE') return;
      const row = payload.new as Partial<IncomingCall>;
      if (
        typeof row.id === 'string'
        && typeof row.conversation_id === 'string'
        && row.callee_id === userId
        && (row.media_type === 'audio' || row.media_type === 'video')
        && row.status === 'ringing'
        && typeof row.expires_at === 'string'
        && Date.parse(row.expires_at) > Date.now()
      ) {
        onIncoming(row as IncomingCall);
      }
    })
    .subscribe((status, error) => {
      if (error) console.error('Could not subscribe to incoming calls.', error);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Incoming-call realtime subscription failed.', status);
      }
    });
  return () => {
    void client.removeChannel(channel);
  };
}
