import { useEvent } from 'expo';
import { Link, router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetworkState } from 'expo-network';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { HashtagText } from '../../components/HashtagText';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { liveMoments, stories } from '../../data/mock';
import { mergeFeedPages } from '../../features/feed/feedPagination';
import { incrementPostShare, recordPostView, setPostLiked, setPostSaved } from '../../features/feed/postActions';
import {
  loadUploadJobs,
  removeUploadJob,
  resumeVideoUpload,
  subscribeToUploadJobs,
  type VideoUploadJob,
} from '../../features/feed/uploadManager';
import type { FeedItem } from '../../features/feed/useFeed';
import { useFeed } from '../../features/feed/useFeed';
import { queryKeys } from '../../features/feed/queryKeys';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';

const viewabilityConfig = { itemVisiblePercentThreshold: 65 };

function FeedVideo({
  uri,
  active,
  shouldLoad,
  onOpenPost,
}: {
  uri: string | null;
  active: boolean;
  shouldLoad: boolean;
  onOpenPost: () => void;
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
  return <PlayingVideo uri={uri} active={active} />;
}

function PlayingVideo({ uri, active }: { uri: string; active: boolean }) {
  const [pausedByUser, setPausedByUser] = useState(false);
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    if (active && !pausedByUser) player.play();
    else player.pause();
  }, [active, pausedByUser, player]);

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
    </View>
  );
}

function FeedHeader() {
  return (
    <View>
      <View style={styles.liveRow}>
        <Text style={styles.sectionTitle}>Live now</Text>
        <FlatList
          horizontal
          data={liveMoments}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.liveScroll}
          renderItem={({ item }) => (
            <LinearGradient colors={item.gradient as [string, string]} style={styles.liveCard}>
              <Text style={styles.liveBadge}>{item.label}</Text>
              <Text style={styles.liveTitle}>{item.title}</Text>
              <Text style={styles.liveMeta}>{item.viewers} watching</Text>
            </LinearGradient>
          )}
        />
      </View>
      <FlatList
        horizontal
        data={stories.filter((story) => story.isOwner)}
        keyExtractor={(story) => story.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storyRow}
        renderItem={({ item: story }) => (
          <Link href="/profile" asChild>
            <Pressable style={styles.storyItem} accessibilityRole="button" accessibilityLabel={`Open ${story.name}'s story`}>
              <LinearGradient colors={['#38BDF8', '#22C55E']} style={styles.storyRing}>
                <View style={styles.storyAvatar}>
                  <Text style={styles.storyInitial}>{story.initial}</Text>
                </View>
              </LinearGradient>
              <Text style={styles.storyLabel}>{story.name}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

function FeedPostCard({
  item,
  active,
  shouldLoadVideo,
  onToggleLike,
  onToggleSave,
  onShare,
  busy,
  itemHeight,
}: {
  item: FeedItem;
  active: boolean;
  shouldLoadVideo: boolean;
  onToggleLike: () => void;
  onToggleSave: () => void;
  onShare: () => void;
  busy: boolean;
  itemHeight: number;
}) {
  const openPost = () => router.push({ pathname: '/post/[id]', params: { id: item.post.id } });

  return (
    <View style={[styles.videoCardWrap, { height: itemHeight }]}>
      <FeedVideo uri={item.videoUrl} active={active} shouldLoad={shouldLoadVideo} onOpenPost={openPost} />
      <View pointerEvents="box-none" style={styles.videoOverlay}>
        <View pointerEvents="box-none" style={styles.metaStack}>
          <Link href={{ pathname: '/user/[username]', params: { username: item.author.username } }} asChild>
            <Pressable style={styles.profileLink} accessibilityRole="button">
              <Text style={styles.displayName}>{item.author.display_name}</Text>
              <Text style={styles.username}>@{item.author.username}</Text>
            </Pressable>
          </Link>
          <HashtagText text={item.post.caption} style={styles.caption} />
          {item.post.hashtags.length > 0 ? (
            <HashtagText text={item.post.hashtags.map((tag) => `#${tag}`).join(' ')} style={styles.hashtags} />
          ) : null}
          {item.post.auto_captions ? (
            <View style={styles.autoCaption}>
              <Text style={styles.autoCaptionText}>Auto captions</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.rightRail}>
          <Pressable onPress={openPost} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Open video details">
            <Icon name="more" size={24} color={theme.colors.white} />
          </Pressable>
          <Pressable
            onPress={onToggleLike}
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
            onPress={onToggleSave}
            disabled={busy}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={item.is_saved ? 'Remove saved video' : 'Save video'}
          >
            <Icon name="bookmark" size={24} color={theme.colors.white} filled={item.is_saved} />
            <Text style={styles.count}>{item.post.save_count}</Text>
          </Pressable>
          <Pressable onPress={onShare} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Share video">
            <Icon name="share" size={24} color={theme.colors.white} />
            <Text style={styles.count}>{item.post.share_count}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const [tab, setTab] = useState<'For You' | 'Following'>('For You');
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(() => new Set());
  const [uploadJobs, setUploadJobs] = useState<VideoUploadJob[]>([]);
  const networkState = useNetworkState();
  const viewedPostIds = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const [isFocused, setIsFocused] = useState(false);
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

    void getSupabaseClient().auth.getUser().then(async ({ data, error }) => {
      if (error) throw error;
      currentOwnerId = data.user?.id ?? null;
      if (!currentOwnerId) return;
      const savedJobs = await loadUploadJobs(currentOwnerId);
      if (!mounted) return;
      setUploadJobs(savedJobs);
      savedJobs.filter((job) => job.state !== 'failed').forEach((job) => {
        void resumeVideoUpload(job.id).catch(() => undefined);
      });
    }).catch((error: unknown) => {
      if (mounted) {
        Alert.alert('Could not resume video uploads', error instanceof Error ? error.message : 'Try again from Create post.');
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
    void recordPostView(activePostId).catch((error: unknown) => {
      Alert.alert('Could not record this view', error instanceof Error ? error.message : 'Try again.');
    });
  }, [activePostId]);

  const refreshFeeds = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.feed('for_you') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.feed('following') }),
    ]);
  };

  const runPostAction = async (postId: string, action: () => Promise<void>) => {
    setBusyPostIds((current) => new Set(current).add(postId));
    try {
      await action();
      await refreshFeeds();
    } catch (error) {
      Alert.alert('Could not update this video', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally {
      setBusyPostIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    }
  };

  const sharePost = async (item: FeedItem) => {
    try {
      const result = await Share.share({ message: `Watch @${item.author.username}'s video on Wimpex.` });
      if (result.action === Share.sharedAction) {
        await incrementPostShare(item.post.id);
        await refreshFeeds();
      }
    } catch (error) {
      Alert.alert('Could not share this video', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const retryUpload = async (job: VideoUploadJob) => {
    try {
      await resumeVideoUpload(job.id);
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const removeFailedUpload = async (job: VideoUploadJob) => {
    try {
      await removeUploadJob(job.id);
    } catch (error) {
      Alert.alert('Could not remove upload', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const renderPost = ({ item, index }: { item: FeedItem; index: number }) => (
    <FeedPostCard
      item={item}
      active={item.post.id === activePostId && isFocused && appIsActive}
      shouldLoadVideo={activeIndex !== null && Math.abs(index - activeIndex) <= 1}
      busy={busyPostIds.has(item.post.id)}
      itemHeight={listHeight || 480}
      onToggleLike={() => void runPostAction(item.post.id, () => setPostLiked(item.post.id, item.is_liked))}
      onToggleSave={() => void runPostAction(item.post.id, () => setPostSaved(item.post.id, item.is_saved))}
      onShare={() => void sharePost(item)}
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
      <FlatList
        data={posts}
        keyExtractor={(item) => item.post.id}
        renderItem={renderPost}
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
        onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
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
            refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
            onRefresh={() => void feedQuery.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  storyItem: { alignItems: 'center', width: 64 },
  storyRing: { width: 72, height: 72, borderRadius: 36, padding: 3, alignItems: 'center', justifyContent: 'center' },
  storyAvatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#111418', alignItems: 'center', justifyContent: 'center' },
  storyInitial: { fontSize: 20, fontWeight: '700', color: theme.colors.white },
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
