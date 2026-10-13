import type { Database } from '../../types/database';

export type MessageRow = Database['public']['Tables']['messages']['Row'];
export type MessageDeliveryState = 'sending' | 'sent' | 'failed';
export type ChatMessage = MessageRow & {
  deliveryState: MessageDeliveryState;
  replyPreview?: string | null;
};

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
