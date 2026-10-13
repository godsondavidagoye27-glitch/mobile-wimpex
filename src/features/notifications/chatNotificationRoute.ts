const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatNotificationRoute = {
  kind: 'chat';
  conversationId: string;
  messageId: string;
  recipientId: string;
};

export type IncomingCallNotificationRoute = {
  kind: 'incoming_call';
  conversationId: string;
  callId: string;
  recipientId: string;
  mode: 'audio' | 'video';
};

export type NotificationRoute = ChatNotificationRoute | IncomingCallNotificationRoute;

export function parseChatNotificationRoute(data: unknown): ChatNotificationRoute | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (
    candidate.type !== 'chat_message'
    || typeof candidate.conversation_id !== 'string'
    || !uuidPattern.test(candidate.conversation_id)
    || typeof candidate.message_id !== 'string'
    || !uuidPattern.test(candidate.message_id)
    || typeof candidate.recipient_id !== 'string'
    || !uuidPattern.test(candidate.recipient_id)
  ) {
    return null;
  }
  return {
    kind: 'chat',
    conversationId: candidate.conversation_id,
    messageId: candidate.message_id,
    recipientId: candidate.recipient_id,
  };
}

export function parseIncomingCallNotificationRoute(data: unknown): IncomingCallNotificationRoute | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  const mode = candidate.mode ?? candidate.media_type;
  if (
    candidate.type !== 'incoming_call'
    || typeof candidate.conversation_id !== 'string'
    || !uuidPattern.test(candidate.conversation_id)
    || typeof candidate.call_id !== 'string'
    || !uuidPattern.test(candidate.call_id)
    || typeof candidate.recipient_id !== 'string'
    || !uuidPattern.test(candidate.recipient_id)
    || (mode !== 'audio' && mode !== 'video')
  ) {
    return null;
  }
  return {
    kind: 'incoming_call',
    conversationId: candidate.conversation_id,
    callId: candidate.call_id,
    recipientId: candidate.recipient_id,
    mode,
  };
}
