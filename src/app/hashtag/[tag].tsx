import { getErrorMessage } from '../../lib/errorMessage';
import { router, useLocalSearchParams } from 'expo-router';
import { getSingleRouteParam } from '../../lib/routeParams';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { getSignedUrls } from '../../features/feed/useFeed';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { FeedRpcRow } from '../../types/database';

type HashtagVideo = FeedRpcRow & { thumbnailUrl: string | null };
type VideoCursor = { publishedAt: string; id: string };
const pageSize = 20;

async function loadHashtagVideos(tag: string, cursor: VideoCursor | null, signal: AbortSignal) {
  const { data, error } = await getSupabaseClient().rpc('search_videos', {
    p_query: tag,
    p_hashtag: tag,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: pageSize,
  }).abortSignal(signal);
  if (error) throw error;
  const paths = data.flatMap(({ post }) => post.thumb_path ? [post.thumb_path] : []);
  const thumbnails = await getSignedUrls('thumbnails', paths);
  if (signal.aborted) return [];
  return data.map((row): HashtagVideo => ({
    ...row,
    thumbnailUrl: row.post.thumb_path ? thumbnails.get(row.post.thumb_path) ?? null : null,
  }));
}

export default function HashtagScreen() {
  const { tag: routeTag } = useLocalSearchParams<{ tag: string | string[] }>();
  const tag = (getSingleRouteParam(routeTag) ?? '').replace(/^#+/, '').toLowerCase();
  const { width } = useWindowDimensions();
  const [videos, setVideos] = useState<HashtagVideo[]>([]);
  const [postCount, setPostCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const itemWidth = Math.floor((width - 36 - 16) / 3);
  const tagUnavailable = tag.length < 2;

  const loadInitial = useCallback(async (refresh = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (refresh) setRefreshing(true);
    else {
      setLoading(true);
      setRefreshing(false);
    }
    setError('');
    setPageError('');
    try {
      const client = getSupabaseClient();
      const [videoRows, countResult] = await Promise.all([
        loadHashtagVideos(tag, null, controller.signal),
        client.rpc('search_hashtags', { p_query: tag, p_exact: true, p_page_size: 1 }).abortSignal(controller.signal),
      ]);
      if (countResult.error) throw countResult.error;
      if (controller.signal.aborted) return;
      setVideos(videoRows);
      setPostCount(countResult.data[0]?.post_count ?? 0);
      const last = videoRows.at(-1);
      setHasMore(videoRows.length === pageSize && Boolean(last?.post.published_at));
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(await getErrorMessage(caught, 'Could not load this hashtag.'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [tag]);

  useEffect(() => {
    if (tagUnavailable) return undefined;
    const timeout = setTimeout(() => void loadInitial(), 0);
    return () => {
      clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [loadInitial, tagUnavailable]);

  const loadMore = async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const last = videos.at(-1);
    if (!last?.post.published_at) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const next = await loadHashtagVideos(tag, {
        publishedAt: last.post.published_at,
        id: last.post.id,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setVideos((current) => [...current, ...next]);
      setHasMore(next.length === pageSize && Boolean(next.at(-1)?.post.published_at));
      setPageError('');
    } catch (caught) {
      if (!controller.signal.aborted) {
        setPageError(await getErrorMessage(caught, 'Could not load more videos.'));
      }
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };

  const renderVideo = ({ item }: { item: HashtagVideo }) => (
    <Pressable
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.post.id } })}
      style={[styles.tile, { width: itemWidth }]}
      accessibilityRole="button"
      accessibilityLabel={`Open video by ${item.author.display_name}`}
    >
      {item.thumbnailUrl
        ? <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
        : <View style={[styles.thumbnail, styles.videoFallback]}>
            <Icon name="play" size={20} color={theme.colors.white} />
          </View>}
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>#{tag}</Text>
          {postCount !== null ? (
            <Text style={styles.subtitle}>{postCount} {postCount === 1 ? 'video' : 'videos'}</Text>
          ) : null}
        </View>
        <View style={styles.backButton} />
      </View>

      {tagUnavailable ? (
        <View style={styles.message}>
          <Text style={styles.errorText}>This hashtag is not available.</Text>
        </View>
      ) : loading && videos.length === 0 ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.message}>
          <Text style={styles.errorText}>Could not load this hashtag. Check your connection and try again.</Text>
          <Pressable onPress={() => void loadInitial()} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.post.id}
          renderItem={renderVideo}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          ListEmptyComponent={<Text style={styles.emptyText}>No videos with this hashtag yet.</Text>}
          ListFooterComponent={loadingMore
            ? <ActivityIndicator color={theme.colors.primary} style={styles.footer} />
            : pageError
              ? <Text style={styles.errorText}>{pageError}</Text>
              : null}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadInitial(true)} tintColor={theme.colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  title: { color: theme.colors.white, fontSize: 19, fontWeight: '800' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  grid: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32, flexGrow: 1 },
  gridRow: { justifyContent: 'flex-start', gap: 8, marginBottom: 8 },
  tile: { overflow: 'hidden', borderRadius: 8 },
  thumbnail: { width: '100%', aspectRatio: 0.78, backgroundColor: theme.colors.surface },
  videoFallback: { alignItems: 'center', justifyContent: 'center' },
  loader: { marginTop: 40 },
  message: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: theme.colors.danger, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryButton: { paddingHorizontal: 16, paddingVertical: 10, marginTop: 12 },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 32 },
  footer: { paddingVertical: 20 },
});
