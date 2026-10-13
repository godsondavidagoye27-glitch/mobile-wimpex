import { useInfiniteQuery } from '@tanstack/react-query';
import type { FeedRpcRow } from '../../types/database';
import { getSupabaseClient } from '../../lib/supabase';
import { getNextFeedCursor } from './feedPagination';
import { queryKeys, type FeedMode } from './queryKeys';

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

type FeedPage = {
  items: FeedItem[];
  nextCursor: FeedCursor | null;
};

async function getSignedUrls(bucket: 'videos' | 'thumbnails', paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map<string, string>();

  const { data, error } = await getSupabaseClient()
    .storage
    .from(bucket)
    .createSignedUrls(uniquePaths, signedUrlExpirySeconds);

  if (error) throw error;
  if (!data || data.length !== uniquePaths.length) {
    throw new Error(`Could not create signed URLs for ${bucket}.`);
  }

  const urls = new Map<string, string>();
  data.forEach((result, index) => {
    if (result.error || !result.signedUrl) {
      throw new Error(`Could not create a signed URL for ${bucket}/${uniquePaths[index]}.`);
    }
    urls.set(uniquePaths[index], result.signedUrl);
  });
  return urls;
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
  });
}
