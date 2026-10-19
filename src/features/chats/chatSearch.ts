export type ChatSearchCursor = { createdAt: string; id: string } | null;
export type ChatSearchArgs = {
  p_query: string;
  p_conversation_id: string | null;
  p_cursor_created_at: string | null;
  p_cursor_id: string | null;
  p_page_size: number;
};

export function buildChatSearchArgs(
  query: string,
  conversationId: string | null,
  cursor: ChatSearchCursor = null,
  pageSize = 30,
): ChatSearchArgs {
  return {
    p_query: query.trim(),
    p_conversation_id: conversationId,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: Math.max(1, Math.min(50, Math.floor(pageSize))),
  };
}

export function canPinMessage(pinCount: number, alreadyPinned: boolean) {
  return alreadyPinned || pinCount < 3;
}
