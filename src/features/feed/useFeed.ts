import { useInfiniteQuery } from '@tanstack/react-query';
import type { FeedRpcRow } from '../../types/database';
import { getSupabaseClient } from '../../lib/supabase';
import { getNextFeedCursor } from './feedPagination';
import { queryKeys, type FeedMode } from './queryKeys';
import { mapSignedUrlResults } from './signedUrls';

const pageSize = 10;
const signedUrlExpirySeconds = 60 * 60 * 2;

export type FeedCursor = {
  publishedAt: string;
  id: string;
};

export type FeedItem = FeedRpcRow & {
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

export type FeedPage = {
  items: FeedItem[];
  nextCursor: FeedCursor | null;
};

// Reuse signed URLs across refetches. A new URL string for the same video makes
// useVideoPlayer(uri) rebuild the player (flicker, restart, native crashes), and
// every refetch used to mint new ones.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signedUrlRefreshMarginMs = 10 * 60_000;

export async function getSignedUrls(bucket: 'videos' | 'thumbnails', paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map<string, string | null>();

  const now = Date.now();
  const result = new Map<string, string | null>();
  const missing: string[] = [];
  for (const path of uniquePaths) {
    const cached = signedUrlCache.get(`${bucket}:${path}`);
    if (cached && cached.expiresAt - signedUrlRefreshMarginMs > now) result.set(path, cached.url);
    else missing.push(path);
  }
  if (missing.length === 0) return result;

  const { data, error } = await getSupabaseClient()
    .storage
    .from(bucket)
    .createSignedUrls(missing, signedUrlExpirySeconds);

  if (error) throw error;
  const fresh = mapSignedUrlResults(
    missing,
    data?.map((entry, index) => ({
      path: entry.path ?? missing[index],
      signedUrl: entry.signedUrl,
      error: entry.error,
    })) ?? null,
  );
  fresh.forEach((url, path) => {
    result.set(path, url);
    if (url) signedUrlCache.set(`${bucket}:${path}`, { url, expiresAt: now + signedUrlExpirySeconds * 1000 });
  });
  return result;
}

async function attachSignedUrls(rows: FeedRpcRow[]): Promise<FeedItem[]> {
  const videoPaths = rows.flatMap(({ post }) => post.video_path ? [post.video_path] : []);
  const thumbnailPaths = rows.flatMap(({ post }) => post.thumb_path ? [post.thumb_path] : []);
  const [videoUrls, thumbnailUrls] = await Promise.all([
    getSignedUrls('videos', videoPaths),
    getSignedUrls('thumbnails', thumbnailPaths),
  ]);

  return rows.map((row) => ({
    ...row,
    videoUrl: row.post.video_path ? videoUrls.get(row.post.video_path) ?? null : null,
    thumbnailUrl: row.post.thumb_path ? thumbnailUrls.get(row.post.thumb_path) ?? null : null,
  }));
}

export function useFeed(mode: FeedMode) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(mode),
    initialPageParam: null as FeedCursor | null,
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const { data, error } = await getSupabaseClient().rpc('get_feed', {
        mode,
        cursor_published_at: pageParam?.publishedAt ?? null,
        cursor_id: pageParam?.id ?? null,
        page_size: pageSize,
      });
      if (error) throw error;

      const items = await attachSignedUrls(data);
      return {
        items,
        nextCursor: getNextFeedCursor(items),
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const hasPendingCaptions = query.state.data?.pages.some((page) =>
        page.items.some(({ post }) => post.captions_status === 'queued' || post.captions_status === 'processing'),
      );
      return hasPendingCaptions ? 5000 : false;
    },
  });
}