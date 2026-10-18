import type { Database } from '../../types/database';

export type MessageRow = Pick<
  Database['public']['Tables']['messages']['Row'],
  | 'id'
  | 'conversation_id'
  | 'sender_id'
  | 'client_id'
  | 'kind'
  | 'body'
  | 'media_path'
  | 'media_duration_ms'
  | 'width'
  | 'height'
  | 'reply_to_id'
  | 'story_reply_preview_path'
  | 'story_reply_caption'
  | 'created_at'
  | 'deleted_at'
>;
export type MessageDeliveryState = 'sending' | 'sent' | 'failed';
export type ChatMessage = MessageRow & {
  deliveryState: MessageDeliveryState;
  replyPreview?: string | null;
};

export function isMessageRow(value: unknown): value is MessageRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Record<keyof MessageRow, unknown>>;
  return (
    typeof row.id === 'string'
    && typeof row.conversation_id === 'string'
    && typeof row.sender_id === 'string'
    && typeof row.client_id === 'string'
    && typeof row.kind === 'string'
    && (typeof row.body === 'string' || row.body === null)
    && (typeof row.media_path === 'string' || row.media_path === null)
    && (typeof row.media_duration_ms === 'number' || row.media_duration_ms === null)
    && (typeof row.width === 'number' || row.width === null)
    && (typeof row.height === 'number' || row.height === null)
    && (typeof row.reply_to_id === 'string' || row.reply_to_id === null)
    && (typeof row.story_reply_preview_path === 'string' || row.story_reply_preview_path === null)
    && (typeof row.story_reply_caption === 'string' || row.story_reply_caption === null)
    && typeof row.created_at === 'string'
    && (typeof row.deleted_at === 'string' || row.deleted_at === null)
  );
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) {
    const key = `${message.sender_id}:${message.client_id}`;
    const previous = messages.get(key);
    messages.set(key, {
      ...previous,
      ...message,
      deliveryState: message.id.startsWith('local:') ? message.deliveryState : 'sent',
      replyPreview: message.replyPreview ?? previous?.replyPreview,
    });
  }
  return Array.from(messages.values()).sort((first, second) =>
    second.created_at.localeCompare(first.created_at) || second.id.localeCompare(first.id),
  );
}

export function applyRealtimeChatMessage(
  current: ChatMessage[],
  row: MessageRow,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
): ChatMessage[] {
  if (event === 'DELETE') return current.filter((message) => message.id !== row.id);
  return mergeChatMessages(current, [{ ...row, deliveryState: 'sent' }]);
}

export function setMessageDeliveryState(
  messages: ChatMessage[],
  clientId: string,
  deliveryState: MessageDeliveryState,
): ChatMessage[] {
  return messages.map((message) =>
    message.client_id === clientId ? { ...message, deliveryState } : message,
  );
}

export function isTypingActive(expiresAt: number, now = Date.now()): boolean {
  return expiresAt > now;
}

export function unreadBadgeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
