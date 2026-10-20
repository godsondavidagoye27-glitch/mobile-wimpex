import { getSupabaseClient } from '../../lib/supabase';
import type {
  ExploreCreatorRpcRow,
  ExploreSuggestedAccountRpcRow,
  SearchHashtagRpcRow,
} from '../../types/database';
import { rankExploreCreators, rankSuggestedAccounts } from './exploreRanking';

const pageSize = 20;

export type ExploreHashtagCursor = { postCount: number; tag: string } | null;
export type ExploreCreatorCursor = { score: number; username: string; id: string } | null;
export type ExploreSuggestedCursor = {
  mutualFollows: number;
  sharedInterests: number;
  followers: number;
  username: string;
  id: string;
} | null;

export type ExplorePage<Row, Cursor> = {
  rows: Row[];
  cursor: Cursor;
  hasMore: boolean;
};

export async function getExploreHashtags(
  window: '24h' | '7d',
  cursor: ExploreHashtagCursor,
  signal?: AbortSignal,
): Promise<ExplorePage<SearchHashtagRpcRow, ExploreHashtagCursor>> {
  let request = getSupabaseClient().rpc('explore_hashtags', {
    p_window: window,
    p_cursor_post_count: cursor?.postCount ?? null,
    p_cursor_tag: cursor?.tag ?? null,
    p_page_size: pageSize,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const rows = data ?? [];
  const last = rows[rows.length - 1];
  return {
    rows,
    cursor: rows.length === pageSize && last ? { postCount: last.post_count, tag: last.tag } : null,
    hasMore: rows.length === pageSize,
  };
}

export async function getExploreCreators(
  window: '24h' | '7d',
  cursor: ExploreCreatorCursor,
  signal?: AbortSignal,
): Promise<ExplorePage<ExploreCreatorRpcRow, ExploreCreatorCursor>> {
  let request = getSupabaseClient().rpc('explore_popular_creators', {
    p_window: window,
    p_cursor_score: cursor?.score ?? null,
    p_cursor_username: cursor?.username ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: pageSize,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const rows = rankExploreCreators(data ?? []);
  const last = rows[rows.length - 1];
  return {
    rows,
    cursor: rows.length === pageSize && last
      ? { score: last.popularity_score, username: last.username, id: last.id }
      : null,
    hasMore: rows.length === pageSize,
  };
}

export async function getExploreSuggestedAccounts(
  cursor: ExploreSuggestedCursor,
  signal?: AbortSignal,
): Promise<ExplorePage<ExploreSuggestedAccountRpcRow, ExploreSuggestedCursor>> {
  let request = getSupabaseClient().rpc('explore_suggested_accounts', {
    p_cursor_mutual_follows: cursor?.mutualFollows ?? null,
    p_cursor_shared_interests: cursor?.sharedInterests ?? null,
    p_cursor_followers: cursor?.followers ?? null,
    p_cursor_username: cursor?.username ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: pageSize,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const rows = rankSuggestedAccounts(data ?? []);
  const last = rows[rows.length - 1];
  return {
    rows,
    cursor: rows.length === pageSize && last
      ? {
        mutualFollows: last.mutual_follows,
        sharedInterests: last.shared_interests,
        followers: last.followers_count,
        username: last.username,
        id: last.id,
      }
      : null,
    hasMore: rows.length === pageSize,
  };
}
