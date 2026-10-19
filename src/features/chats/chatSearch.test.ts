import { describe, expect, it } from 'vitest';
import { buildChatSearchArgs, canPinMessage } from './chatSearch';

describe('chat search arguments', () => {
  it('trims the search term and includes the scoped conversation and cursor', () => {
    expect(buildChatSearchArgs(' hello ', 'conversation-id', { createdAt: '2025-01-01', id: 'message-id' }))
      .toEqual({
        p_query: 'hello',
        p_conversation_id: 'conversation-id',
        p_cursor_created_at: '2025-01-01',
        p_cursor_id: 'message-id',
        p_page_size: 30,
      });
  });

  it('caps pages to the server limit and allows exactly three pins', () => {
    expect(buildChatSearchArgs('hi', null, null, 500).p_page_size).toBe(50);
    expect(canPinMessage(2, false)).toBe(true);
    expect(canPinMessage(3, false)).toBe(false);
    expect(canPinMessage(3, true)).toBe(true);
  });
});
