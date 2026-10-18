import { describe, expect, it } from 'vitest';
import {
  isTypingActive,
  mergeChatMessages,
  setMessageDeliveryState,
  unreadBadgeCount,
  type ChatMessage,
} from './messageState';

const message = (
  id: string,
  clientId: string,
  createdAt: string,
  deliveryState: ChatMessage['deliveryState'] = 'sent',
): ChatMessage => ({
  id,
  conversation_id: 'conversation',
  sender_id: 'sender',
  client_id: clientId,
  kind: 'text',
  body: 'Hello',
  media_path: null,
  media_duration_ms: null,
  width: null,
  height: null,
  reply_to_id: null,
  story_reply_preview_path: null,
  story_reply_caption: null,
  created_at: createdAt,
  deleted_at: null,
  deliveryState,
});

describe('chat message state', () => {
  it('replaces an optimistic message with its realtime/server copy by client id', () => {
    const optimistic = message('local:client-1', 'client-1', '2026-01-01T00:00:00.000Z', 'sending');
    const server = message('server-1', 'client-1', optimistic.created_at);

    expect(mergeChatMessages([optimistic], [server])).toEqual([server]);
  });

  it('deduplicates retries and orders messages newest first', () => {
    const older = message('server-older', 'older', '2026-01-01T00:00:00.000Z');
    const newer = message('server-newer', 'newer', '2026-01-02T00:00:00.000Z');

    expect(mergeChatMessages([older, newer], [older])).toEqual([newer, older]);
  });

  it('moves a failed optimistic message back to sending when retried', () => {
    const failed = message('local:retry', 'retry', '2026-01-01T00:00:00.000Z', 'failed');
    expect(setMessageDeliveryState([failed], 'retry', 'sending')[0].deliveryState).toBe('sending');
  });

  it('expires typing after four seconds', () => {
    expect(isTypingActive(4_000, 3_999)).toBe(true);
    expect(isTypingActive(4_000, 4_000)).toBe(false);
  });

  it('normalizes unread badge values', () => {
    expect(unreadBadgeCount(4.8)).toBe(4);
    expect(unreadBadgeCount(-1)).toBe(0);
    expect(unreadBadgeCount(Number.NaN)).toBe(0);
  });
});
