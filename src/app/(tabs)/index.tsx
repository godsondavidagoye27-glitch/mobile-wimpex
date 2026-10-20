import { getErrorMessage } from '../../lib/errorMessage';
import { useEvent } from 'expo';
import { Link, router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetworkState } from 'expo-network';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { HashtagText } from '../../components/HashtagText';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { mergeFeedPages, updateFeedItem } from '../../features/feed/feedPagination';
import { StoryRail } from '../../features/stories/StoryRail';
import { LiveNowRail } from '../../features/live/LiveNowRail';
import { incrementPostShare, recordPostView, setPostLiked, setPostSaved } from '../../features/feed/postActions';
import {
  loadUploadJobs,
  removeUploadJob,
  resumeVideoUpload,
  subscribeToUploadJobs,
  type VideoUploadJob,
} from '../../features/feed/uploadManager';
import type { FeedCursor, FeedItem, FeedPage } from '../../features/feed/useFeed';
import { useFeed } from '../../features/feed/useFeed';
import { queryKeys } from '../../features/feed/queryKeys';
import { getSupabaseClient } from '../../lib/supabase';
import { CaptionOverlay } from '../../features/captions/CaptionOverlay';
import { enqueuePostWatchEvent, flushPostWatchEvents } from '../../features/analytics/watchTracking';
import { theme } from '../../theme/theme';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

const viewabilityConfig = { itemVisiblePercentThreshold: 65 };

function FeedVideo({
  uri,
  active,
  shouldLoad,
  onOpenPost,
  post,
  isAuthor,
}: {
  uri: string | null;
  active: boolean;
  shouldLoad: boolean;
  onOpenPost: () => void;
  post: FeedItem['post'];
  isAuthor: boolean;
}) {
  if (!uri || !shouldLoad) {
    return (
      <Pressable onPress={onOpenPost} style={styles.videoSurface} accessibilityRole="button" accessibilityLabel="Open video details">
        <LinearGradient colors={['#102B3B', '#17382C']} style={styles.videoPlaceholder}>
          <Icon name="play" size={24} color={theme.colors.white} />
          <Text style={styles.unavailableText}>{uri ? 'Scroll to play' : 'Video unavailable'}</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  return <PlayingVideo uri={uri} active={active} post={post} isAuthor={isAuthor} />;
}

function PlayingVideo({
  uri,
  active,
  post,
  isAuthor,
}: {
  uri: string;
  active: boolean;
  post: FeedItem['post'];
  isAuthor: boolean;
}) {
  const [pausedByUser, setPausedByUser] = useState(false);
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.timeUpdateEventInterval = 5;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const watchSessionId = useRef<string | null>(null);
  const previousTime = useRef<number | null>(null);

  useEffect(() => {
    if (active && !pausedByUser) player.play();
    else player.pause();
  }, [active, pausedByUser, player]);

  useEffect(() => {
    if (!active || !isPlaying) {
      previousTime.current = null;
      return;
    }
    const previous = previousTime.current;
    previousTime.current = currentTime;
    if (previous === null || currentTime <= previous) return;
    const watchedMs = Math.round((currentTime - previous) * 1000);
    if (watchedMs < 250 || watchedMs > 10_000) return;
    enqueuePostWatchEvent({
      post_id: post.id,
      session_id: watchSessionId.current ?? (watchSessionId.current = Crypto.randomUUID()),
      watch_ms: watchedMs,
      completed: player.duration > 0 && currentTime >= player.duration - 0.5,
    });
  }, [active, currentTime, isPlaying, player, post.id]);

  useEffect(() => () => {
    void flushPostWatchEvents();
  }, []);

  return (
    <View style={styles.videoSurface}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <Pressable
        onPress={() => setPausedByUser((paused) => !paused)}
        style={styles.playState}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} size={20} color={theme.colors.white} />
      </Pressable>
      <CaptionOverlay player={player} post={post} active={active} isAuthor={isAuthor} />
    </View>
  );
}

function FeedHeader() {
  return (
    <View>
      <LiveNowRail />
      <StoryRail />
    </View>
  );
}

const FeedPostCard = memo(function FeedPostCard({
  item,
  active,
  shouldLoadVideo,
  onToggleLike,
  onToggleSave,
  onShare,
  busy,
  itemHeight,
  isAuthor,
}: {
  item: FeedItem;
  active: boolean;
  shouldLoadVideo: boolean;
  onToggleLike: (item: FeedItem) => void;
  onToggleSave: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
  busy: boolean;
  itemHeight: number;
  isAuthor: boolean;
}) {
  const openPost = () => router.push({ pathname: '/post/[id]', params: { id: item.post.id } });

  return (
    <View style={[styles.videoCardWrap, { height: itemHeight }]}>
      <FeedVideo
        uri={item.videoUrl}
        active={active}
        shouldLoad={shouldLoadVideo}
        onOpenPost={openPost}
        post={item.post}
        isAuthor={isAuthor}
      />
      <View style={[styles.videoOverlay, { pointerEvents: 'box-none' }]}>
        <View style={[styles.metaStack, { pointerEvents: 'box-none' }]}>
          <Link href={{ pathname: '/user/[username]', params: { username: item.author.username } }} asChild>
            <Pressable style={styles.profileLink} accessibilityRole="button">
              <NameWithBadge
                name={item.author.display_name}
                userId={item.post.author_id}
                verified={item.author.is_verified}
                size="sm"
                textStyle={styles.displayName}
              />
              <Text style={styles.username}>@{item.author.username}</Text>
            </Pressable>
          </Link>
          <HashtagText text={item.post.caption} style={styles.caption} />
          {item.post.hashtags.length > 0 ? (
            <HashtagText text={item.post.hashtags.map((tag) => `#${tag}`).join(' ')} style={styles.hashtags} />
          ) : null}
        </View>
        <View style={styles.rightRail}>
          <Pressable onPress={openPost} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Open video details">
            <Icon name="more" size={24} color={theme.colors.white} />
          </Pressable>
          <Pressable
            onPress={() => onToggleLike(item)}
            disabled={busy}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={item.is_liked ? 'Unlike video' : 'Like video'}
          >
            <Icon name="heart" size={24} color={item.is_liked ? theme.colors.danger : theme.colors.white} filled={item.is_liked} />
            <Text style={styles.count}>{item.post.like_count}</Text>
          </Pressable>
          <Pressable
            onPress={openPost}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel="Open comments"
          >
            <Icon name="comment" size={24} color={theme.colors.white} />
            <Text style={styles.count}>{item.post.comment_count}</Text>
          </Pressable>
          <Pressable
            onPress={() => onToggleSave(item)}
            disabled={busy}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={item.is_saved ? 'Remove saved video' : 'Save video'}
          >
            <Icon name="bookmark" size={24} color={theme.colors.white} filled={item.is_saved} />
            <Text style={styles.count}>{item.post.save_count}</Text>
          </Pressable>
          <Pressable onPress={() => onShare(item)} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Share video">
            <Icon name="share" size={24} color={theme.colors.white} />
            <Text style={styles.count}>{item.post.share_count}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

export default function HomeScreen() {
  const [tab, setTab] = useState<'For You' | 'Following'>('For You');
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(() => new Set());
  const [uploadJobs, setUploadJobs] = useState<VideoUploadJob[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const networkState = useNetworkState();
  const viewedPostIds = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const [isFocused, setIsFocused] = useState(false);
  // Only a user pull shows the spinner. Background refetches (caption polling, app focus,
  // reconnect) used to drive it, so the feed looked like it was refreshing by itself.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const mode = tab === 'For You' ? 'for_you' : 'following';
  const feedQuery = useFeed(mode);
  const posts = mergeFeedPages(feedQuery.data?.pages.map((page) => page.items) ?? []);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    let currentOwnerId: string | null = null;
    const unsubscribe = subscribeToUploadJobs((updatedJobs) => {
      if (mounted && currentOwnerId) {
        setUploadJobs(updatedJobs.filter((job) => job.ownerId === currentOwnerId));
      }
    });

    void getSupabaseClient().auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      currentOwnerId = data.session?.user.id ?? null;
      setCurrentUserId(currentOwnerId);
      if (!currentOwnerId) return;
      const savedJobs = await loadUploadJobs(currentOwnerId);
      if (!mounted) return;
      setUploadJobs(savedJobs);
      savedJobs.filter((job) => job.state !== 'failed').forEach((job) => {
        void resumeVideoUpload(job.id).catch(async (error: unknown) => {
          console.error('Unable to resume saved video upload.', error);
        });
      });
    }).catch(async (error: unknown) => {
      if (mounted) {
        Alert.alert('Could not resume video uploads', await getErrorMessage(error, 'Try again from Create post.'));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    const firstVisible = viewableItems.find((token) => token.isViewable)?.item;
    const visibleToken = viewableItems.find((token) => token.isViewable);
    setActivePostId(firstVisible?.post.id ?? null);
    setActiveIndex(visibleToken?.index ?? null);
  }, []);

  useEffect(() => {
    if (!activePostId || viewedPostIds.current.has(activePostId)) return;
    viewedPostIds.current.add(activePostId);
    // Background bookkeeping: never interrupt scrolling with an alert.
    void recordPostView(activePostId).catch((error: unknown) => {
      viewedPostIds.current.delete(activePostId);
      console.warn('Could not record this view.', error);
    });
  }, [activePostId]);

  const pullToRefresh = async () => {
    setManualRefreshing(true);
    try {
      await feedQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
  };

  const refreshFeeds = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.feed('for_you') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.feed('following') }),
    ]);
  };

  const updateCachedPost = (postId: string, update: (item: FeedItem) => FeedItem) => {
    queryClient.setQueriesData<InfiniteData<FeedPage, FeedCursor | null>>(
      { queryKey: ['feed'] },
      (current) => current
        ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: updateFeedItem(page.items, postId, update),
          })),
        }
        : current,
    );
  };

  const runPostAction = async (
    postId: string,
    action: () => Promise<void>,
    optimisticUpdate: (item: FeedItem) => FeedItem,
  ) => {
    const previousForYou = queryClient.getQueryData<InfiniteData<FeedPage, FeedCursor | null>>(queryKeys.feed('for_you'));
    const previousFollowing = queryClient.getQueryData<InfiniteData<FeedPage, FeedCursor | null>>(queryKeys.feed('following'));
    setBusyPostIds((current) => new Set(current).add(postId));
    updateCachedPost(postId, optimisticUpdate);
    try {
      await action();
      // The optimistic update is already in the cache; just mark feeds stale so
      // they refresh next time instead of reloading every page under the viewer.
      await queryClient.invalidateQueries({ queryKey: ['feed'], refetchType: 'none' });
    } catch (error) {
      queryClient.setQueryData(queryKeys.feed('for_you'), previousForYou);
      queryClient.setQueryData(queryKeys.feed('following'), previousFollowing);
      Alert.alert('Could not update this video', await getErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setBusyPostIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    }
  };

  const sharePost = async (item: FeedItem) => {
    const postUrl = Linking.createURL(`/post/${item.post.id}`);
    const shareId = Crypto.randomUUID();
    try {
      const result = await Share.share({
        message: `Watch @${item.author.username}'s video on Wimpex. ${postUrl}`,
        url: postUrl,
      });
      if (result.action === Share.sharedAction) {
        await incrementPostShare(item.post.id, shareId);
        await refreshFeeds();
      }
    } catch (error) {
      Alert.alert('Could not share this video', await getErrorMessage(error, 'Try again.'));
    }
  };

  const retryUpload = async (job: VideoUploadJob) => {
    try {
      await resumeVideoUpload(job.id);
    } catch (error) {
      Alert.alert('Upload failed', await getErrorMessage(error, 'Try again.'));
    }
  };

  const removeFailedUpload = async (job: VideoUploadJob) => {
    try {
      await removeUploadJob(job.id);
    } catch (error) {
      Alert.alert('Could not remove upload', await getErrorMessage(error, 'Try again.'));
    }
  };

  const likePost = (item: FeedItem) => void runPostAction(
    item.post.id,
    () => setPostLiked(item.post.id, item.is_liked),
    (current) => ({
      ...current,
      is_liked: !current.is_liked,
      post: { ...current.post, like_count: Math.max(0, current.post.like_count + (current.is_liked ? -1 : 1)) },
    }),
  );
  const savePost = (item: FeedItem) => void runPostAction(
    item.post.id,
    () => setPostSaved(item.post.id, item.is_saved),
    (current) => ({
      ...current,
      is_saved: !current.is_saved,
      post: { ...current.post, save_count: Math.max(0, current.post.save_count + (current.is_saved ? -1 : 1)) },
    }),
  );
  // Stable callbacks so memoized cards don't re-render on every upload tick or state change.
  const actionsRef = useRef({ like: likePost, save: savePost, share: (item: FeedItem) => void sharePost(item) });
  actionsRef.current = { like: likePost, save: savePost, share: (item: FeedItem) => void sharePost(item) };
  const onToggleLike = useCallback((item: FeedItem) => actionsRef.current.like(item), []);
  const onToggleSave = useCallback((item: FeedItem) => actionsRef.current.save(item), []);
  const onShare = useCallback((item: FeedItem) => actionsRef.current.share(item), []);

  const renderPost = ({ item, index }: { item: FeedItem; index: number }) => (
    <FeedPostCard
      item={item}
      active={item.post.id === activePostId && isFocused && appIsActive}
      shouldLoadVideo={activeIndex !== null && Math.abs(index - activeIndex) <= 1}
      busy={busyPostIds.has(item.post.id)}
      itemHeight={listHeight || 480}
      isAuthor={item.post.author_id === currentUserId}
      onToggleLike={onToggleLike}
      onToggleSave={onToggleSave}
      onShare={onShare}
    />
  );

  const emptyContent = () => {
    if (feedQuery.isPending) {
      return (
        <View accessibilityLabel="Loading videos">
          <View style={[styles.skeletonCard, { height: listHeight || 480 }]} />
        </View>
      );
    }
    if (feedQuery.isError) {
      return (
        <View style={styles.feedMessage}>
          <Text style={styles.feedMessageText}>Could not load videos. Check your connection and try again.</Text>
          <Pressable onPress={() => void feedQuery.refetch()} style={styles.feedButton} accessibilityRole="button">
            <Text style={styles.feedButtonText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.feedMessage}>
        <Text style={styles.feedMessageText}>
          {tab === 'For You' ? 'No videos yet. Be the first to post.' : 'Follow people to see their videos here.'}
        </Text>
        {tab === 'For You' ? (
          <Pressable onPress={() => router.push('/create-post')} style={styles.feedButton} accessibilityRole="button">
            <Text style={styles.feedButtonText}>Create video</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.wordmark}>Wimpex</Text>
        <View style={styles.headerActions}>
          <Link href="/search" asChild>
            <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Search">
              <Icon name="search" size={20} color={theme.colors.white} />
            </Pressable>
          </Link>
          <Link href="/settings" asChild>
            <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Open settings">
              <Icon name="moon" size={20} color={theme.colors.white} />
            </Pressable>
          </Link>
          <NotificationBell />
          <Link href="/profile" asChild>
            <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Open profile">
              <Icon name="user" size={20} color={theme.colors.white} />
            </Pressable>
          </Link>
        </View>
      </View>
      {networkState.isConnected === false || networkState.isInternetReachable === false ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>You are offline</Text>
        </View>
      ) : null}
      <View style={styles.tabRow}>
        {(['For You', 'Following'] as const).map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={styles.tabButton}>
            <Text style={[styles.tabLabel, tab === item && styles.tabLabelActive]}>{item}</Text>
            {tab === item && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>
      <FeedHeader />
      {uploadJobs.map((job) => (
        <View key={job.id} style={styles.uploadBanner}>
          <View style={styles.uploadBannerContent}>
            <Text style={styles.uploadBannerTitle}>
              {job.state === 'failed' ? 'Upload paused' : 'Uploading your video'}
            </Text>
            <Text style={styles.uploadBannerDetail}>
              {job.error ?? `${Math.round(job.progress * 100)}% complete`}
            </Text>
            <View style={styles.uploadProgressTrack}>
              <View style={[styles.uploadProgressFill, { width: `${Math.round(job.progress * 100)}%` }]} />
            </View>
          </View>
          {job.state === 'failed' ? (
            <View style={styles.uploadButtons}>
              <Pressable onPress={() => void retryUpload(job)} style={styles.uploadButton} accessibilityRole="button">
                <Text style={styles.uploadButtonText}>Retry</Text>
              </Pressable>
              <Pressable
                onPress={() => void removeFailedUpload(job)}
                style={styles.uploadButton}
                accessibilityRole="button"
              >
                <Text style={styles.removeUploadText}>Remove</Text>
              </Pressable>
            </View>
          ) : <ActivityIndicator color={theme.colors.primary} />}
        </View>
      ))}
      <View style={styles.listHost} onLayout={(event) => {
        const height = Math.round(event.nativeEvent.layout.height);
        setListHeight((current) => (Math.abs(current - height) > 1 ? height : current));
      }}>
      {listHeight > 0 ? <FlatList
        style={styles.listHost}
        data={posts}
        keyExtractor={(item) => item.post.id}
        renderItem={renderPost}
        getItemLayout={(_, index) => {
          const itemHeight = listHeight || 480;
          return { length: itemHeight, offset: itemHeight * index, index };
        }}
        ListEmptyComponent={emptyContent}
        ListFooterComponent={feedQuery.isFetchingNextPage ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.listFooter} />
        ) : feedQuery.isError && posts.length > 0 ? (
          <Pressable onPress={() => void feedQuery.fetchNextPage()} style={styles.feedMessage}>
            <Text style={styles.feedMessageText}>Could not load more videos.</Text>
            <Text style={styles.feedButtonText}>Retry</Text>
          </Pressable>
        ) : null}
        contentContainerStyle={styles.content}
        snapToInterval={listHeight || undefined}
        snapToStart
        snapToEnd={false}
        decelerationRate="fast"
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) void feedQuery.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        refreshControl={
          <RefreshControl
            refreshing={manualRefreshing}
            onRefresh={() => void pullToRefresh()}
            tintColor={theme.colors.primary}
          />
        }
      /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listHost: { flex: 1 },
  screen: { flex: 1, backgroundColor: theme.colors.black },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  wordmark: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: theme.colors.gold,
    textShadowColor: 'rgba(255, 215, 0, 0.65)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  tabRow: { flexDirection: 'row', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  tabLabel: { color: theme.colors.textMuted, fontSize: 15, fontWeight: '700' },
  tabLabelActive: { color: theme.colors.white },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 52,
    height: 2,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  content: { paddingBottom: 30 },
  liveRow: { paddingTop: 14, paddingHorizontal: 18 },
  sectionTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  liveScroll: { gap: 10, paddingBottom: 4 },
  liveCard: { width: 170, height: 130, borderRadius: 20, padding: 14, justifyContent: 'flex-end' },
  liveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.38)',
    color: theme.colors.white,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 8,
  },
  liveTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  liveMeta: { color: theme.colors.white, fontSize: 12, marginTop: 3, opacity: 0.9 },
  storyRow: { gap: 16, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  storyItem: { alignItems: 'center', width: 72 },
  storyRingWrap: { position: 'relative' },
  storyRing: { width: 72, height: 72, borderRadius: 36, padding: 3, alignItems: 'center', justifyContent: 'center' },
  storyAvatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#111418', alignItems: 'center', justifyContent: 'center' },
  storyInitial: { fontSize: 20, fontWeight: '700', color: theme.colors.white },
  storyBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  storyBadgeText: { color: '#000000', fontSize: 18, fontWeight: '800', lineHeight: 18 },
  storyLabel: { marginTop: 8, fontSize: 12, color: theme.colors.textMuted, textAlign: 'center' },
  videoCardWrap: {
    marginHorizontal: 18,
    height: 480,
    borderRadius: 22,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: theme.colors.surface,
  },
  videoSurface: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  videoPlaceholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  unavailableText: { color: theme.colors.white, fontSize: 12, marginTop: 8 },
  playState: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  metaStack: { width: '74%', justifyContent: 'flex-end' },
  profileLink: { marginBottom: 7 },
  displayName: { color: theme.colors.white, fontSize: 17, fontWeight: '700' },
  username: { color: theme.colors.white, opacity: 0.85, fontSize: 12, marginTop: 2 },
  caption: { color: theme.colors.white, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  hashtags: { color: theme.colors.primary, fontSize: 13, marginBottom: 10 },
  autoCaption: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  autoCaptionText: { color: theme.colors.white, fontSize: 11, fontWeight: '700' },
  rightRail: { width: 54, justifyContent: 'flex-end', gap: 14, alignItems: 'center' },
  actionButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
  count: { color: theme.colors.white, fontSize: 11, fontWeight: '700' },
  skeletonCard: { marginHorizontal: 18, borderRadius: 22, backgroundColor: theme.colors.surface },
  feedMessage: { minHeight: 240, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 16 },
  feedMessageText: { color: theme.colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  feedButton: { minHeight: 44, borderRadius: 22, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  feedButtonText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  listFooter: { paddingVertical: 24 },
  uploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 18,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
  },
  uploadBannerContent: { flex: 1, gap: 6 },
  uploadBannerTitle: { color: theme.colors.white, fontSize: 13, fontWeight: '700' },
  uploadBannerDetail: { color: theme.colors.textMuted, fontSize: 11 },
  uploadProgressTrack: { height: 4, borderRadius: 2, backgroundColor: theme.colors.line, overflow: 'hidden' },
  uploadProgressFill: { height: '100%', backgroundColor: theme.colors.primary },
  uploadButtons: { alignItems: 'flex-end', gap: 6 },
  uploadButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 },
  uploadButtonText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  removeUploadText: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' },
  offlineBanner: {
    backgroundColor: '#36230D',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  offlineText: { color: '#FBBF24', textAlign: 'center', fontSize: 12, fontWeight: '700' },
});