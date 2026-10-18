export type KeysetRow = {
  post: {
    id: string;
    published_at: string | null;
  };
};

export type KeysetCursor = {
  id: string;
  publishedAt: string;
};

export function getNextFeedCursor<T extends KeysetRow>(items: readonly T[]): KeysetCursor | null {
  const lastItem = items.at(-1);
  if (!lastItem?.post.published_at) return null;
  return { id: lastItem.post.id, publishedAt: lastItem.post.published_at };
}

export function mergeFeedPages<T extends KeysetRow>(pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.filter((item) => {
      if (seen.has(item.post.id)) return false;
      seen.add(item.post.id);
      return true;
    }),
  );
}

export function updateFeedItem<T extends KeysetRow>(
  items: readonly T[],
  postId: string,
  update: (item: T) => T,
): T[] {
  return items.map((item) => item.post.id === postId ? update(item) : item);
}
