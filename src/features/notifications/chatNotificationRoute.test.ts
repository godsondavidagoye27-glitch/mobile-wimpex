import { describe, expect, it } from 'vitest';
import {
  parseChatNotificationRoute,
  parseIncomingCallNotificationRoute,
  parsePublishedPostNotificationRoute,
} from './chatNotificationRoute';

const validRoute = {
  type: 'chat_message',
  conversation_id: '6b332828-dadc-4f04-8ab7-18fdae0fcb6a',
  message_id: '6b332828-dadc-4f04-8ab7-18fdae0fcb6b',
  recipient_id: '6b332828-dadc-4f04-8ab7-18fdae0fcb6c',
};

describe('parseChatNotificationRoute', () => {
  it('returns a typed route for a valid chat notification', () => {
    expect(parseChatNotificationRoute(validRoute)).toEqual({
      kind: 'chat',
      conversationId: validRoute.conversation_id,
      messageId: validRoute.message_id,
      recipientId: validRoute.recipient_id,
    });
  });

  it('rejects unknown notification types and malformed identifiers', () => {
    expect(parseChatNotificationRoute({ ...validRoute, type: 'live' })).toBeNull();
    expect(parseChatNotificationRoute({ ...validRoute, conversation_id: 'not-a-uuid' })).toBeNull();
    expect(parseChatNotificationRoute(null)).toBeNull();
  });

  it('parses incoming-call payloads with a validated media mode', () => {
    const call = {
      type: 'incoming_call',
      conversation_id: validRoute.conversation_id,
      call_id: validRoute.message_id,
      recipient_id: validRoute.recipient_id,
      mode: 'audio',
    };
    expect(parseIncomingCallNotificationRoute(call)).toEqual({
      kind: 'incoming_call',
      conversationId: call.conversation_id,
      callId: call.call_id,
      recipientId: call.recipient_id,
      mode: 'audio',
    });
    expect(parseIncomingCallNotificationRoute({ ...call, mode: 'screen' })).toBeNull();
    expect(parseIncomingCallNotificationRoute({ ...call, call_id: 'invalid' })).toBeNull();
  });

  it('parses go-live notifications only when both identifiers are valid', () => {
    const post = {
      type: 'post_published',
      post_id: validRoute.message_id,
      recipient_id: validRoute.recipient_id,
    };
    expect(parsePublishedPostNotificationRoute(post)).toEqual({
      kind: 'published_post',
      postId: post.post_id,
      recipientId: post.recipient_id,
    });
    expect(parsePublishedPostNotificationRoute({ ...post, post_id: 'invalid' })).toBeNull();
    expect(parsePublishedPostNotificationRoute({ ...post, recipient_id: 'invalid' })).toBeNull();
  });
});
