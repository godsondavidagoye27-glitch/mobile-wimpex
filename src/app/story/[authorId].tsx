import { getErrorMessage } from '../../lib/errorMessage';
import { useEvent } from 'expo';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { FocusableTextInput } from '../../components/AuthField';
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';
import { StoryStickerWidget } from '../../features/stories/StoryStickerWidget';
import {
  blockStoryAuthor,
  canReplyToStory,
  deleteStory,
  getAuthorStories,
  getStoryRail,
  getStoryViewers,
  markStoryViewed,
  reportStory,
  sendStoryReply,
  type StoryViewer,
  type StoryWithUrl,
} from '../../features/stories/storyService';
import { formatStoryExpiry } from '../../features/stories/storyTimeline';
import {
  addStoryToHighlight,
  createStoryHighlight,
  getProfileStoryHighlights,
} from '../../features/stories/storyHighlightsService';
import {
  canAddStoryToHighlight,
  canCreateStoryHighlight,
  validateStoryHighlightTitle,
  type HighlightAudience,
} from '../../features/stories/highlightLogic';
import type { StoryRailRow } from '../../types/database';
import { getSingleRouteParam, isUuidRouteParam } from '../../lib/routeParams';
import { theme } from '../../theme/theme';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

const railQueryKey = ['story-rail'];
const authorStoriesQueryKey = (authorId: string) => ['author-stories', authorId];

function getAge(createdAt: string) {
  const ageMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function StoryProgress({
  story,
  active,
  paused,
  onComplete,
}: {
  story: StoryWithUrl;
  active: boolean;
  paused: boolean;
  onComplete: () => void;
}) {
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  useEffect(() => {
    if (!active) {
      progress.value = 0;
      return;
    }
    if (paused) {
      cancelAnimation(progress);
      return;
    }
    progress.value = withTiming(
      1,
      { duration: story.duration_ms * (1 - progress.value), reduceMotion: ReduceMotion.System },
      (finished) => {
        if (finished) runOnJS(onComplete)();
      },
    );
    return () => cancelAnimation(progress);
  }, [active, onComplete, paused, progress, story.duration_ms]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, animatedStyle]} />
    </View>
  );
}

function StoryVideo({ story, paused, onError }: { story: StoryWithUrl; paused: boolean; onError: () => void }) {
  const player = useVideoPlayer(story.media_url, (videoPlayer) => {
    videoPlayer.loop = false;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  useEffect(() => {
    if (status === 'error') onError();
  }, [onError, status]);

  return (
    <>
      <VideoView player={player} style={styles.media} contentFit="cover" nativeControls={false} />
      {status === 'loading' ? <ActivityIndicator color={theme.colors.white} style={StyleSheet.absoluteFill} /> : null}
    </>
  );
}

function StoryUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.unavailableTitle}>This story is no longer available.</Text>
      <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close story viewer">
        <Text style={styles.closeText}>Close</Text>
      </Pressable>
    </View>
  );
}

export default function StoryViewerScreen() {
  const params = useLocalSearchParams<{ authorId?: string | string[] }>();
  const routeAuthorId = getSingleRouteParam(params.authorId);
  const [authorId, setAuthorId] = useState(routeAuthorId ?? '');
  const [storyIndex, setStoryIndex] = useState(0);
  const [holding, setHolding] = useState(false);
  const [screenFocused, setScreenFocused] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(() => new Set());
  const [activeWidth, setActiveWidth] = useState(0);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [storyViewers, setStoryViewers] = useState<StoryViewer[]>([]);
  const [storyViewerCount, setStoryViewerCount] = useState(0);
  const [storyViewerLoading, setStoryViewerLoading] = useState(false);
  const [storyViewerError, setStoryViewerError] = useState('');
  const [replyPolicyState, setReplyPolicyState] = useState({ storyId: '', allowed: false, error: '' });
  const [replyDraft, setReplyDraft] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const [highlightTitle, setHighlightTitle] = useState('');
  const [highlightAudience, setHighlightAudience] = useState<HighlightAudience>('everyone');
  const [savingHighlight, setSavingHighlight] = useState(false);
  const viewedStories = useRef(new Set<string>());
  const startX = useRef(0);
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppIsActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const railQuery = useQuery({ queryKey: railQueryKey, queryFn: () => getStoryRail() });
  const rail = useMemo(() => railQuery.data ?? [], [railQuery.data]);
  const author = rail.find((item) => item.author_id === authorId) ?? null;
  const storiesQuery = useQuery({
    queryKey: authorStoriesQueryKey(authorId),
    queryFn: () => getAuthorStories(authorId),
    enabled: isUuidRouteParam(authorId) && Boolean(author?.story_count),
  });
  const stories = useMemo(() => storiesQuery.data ?? [], [storiesQuery.data]);
  const activeStory = stories[storyIndex] ?? null;
  const paused = holding || !screenFocused || !appIsActive;
  const canReply = Boolean(activeStory && replyPolicyState.storyId === activeStory.id && replyPolicyState.allowed);
  const highlightsQuery = useQuery({
    queryKey: ['profile-story-highlights', authorId],
    queryFn: () => getProfileStoryHighlights(authorId),
    enabled: Boolean(highlightPickerOpen && author?.is_owner),
  });

  const loadStoryViewers = useCallback(async (storyId: string, reset: boolean) => {
    if (storyViewerLoading) return;
    setStoryViewerLoading(true);
    setStoryViewerError('');
    try {
      const cursor = reset ? undefined : storyViewers[storyViewers.length - 1];
      const page = await getStoryViewers(storyId, cursor);
      setStoryViewers((current) => reset ? page.viewers : [...current, ...page.viewers]);
      setStoryViewerCount(page.total_count);
    } catch (caught) {
      setStoryViewerError(await getErrorMessage(caught, 'Could not load story viewers.'));
    } finally {
      setStoryViewerLoading(false);
    }
  }, [storyViewerLoading, storyViewers]);

  const openStoryViewers = () => {
    if (!activeStory) return;
    setStoryViewers([]);
    setStoryViewerCount(activeStory.view_count ?? 0);
    setViewersOpen(true);
    void loadStoryViewers(activeStory.id, true);
  };

  useEffect(() => {
    if (!activeStory || author?.is_owner) return undefined;
    let mounted = true;
    void canReplyToStory(activeStory.id)
      .then((allowed) => {
        if (mounted) setReplyPolicyState({ storyId: activeStory.id, allowed, error: '' });
      })
      .catch(async (caught: unknown) => {
        if (mounted) {
          setReplyPolicyState({
            storyId: activeStory.id,
            allowed: false,
            error: await getErrorMessage(caught, 'Story replies could not be checked.'),
          });
        }
      });
    return () => { mounted = false; };
  }, [activeStory, author?.is_owner]);

  const changeAuthor = useCallback((nextAuthor: StoryRailRow) => {
    setAuthorId(nextAuthor.author_id);
    setStoryIndex(0);
    setHolding(false);
    setFailedMediaIds(new Set());
    router.setParams({ authorId: nextAuthor.author_id });
  }, []);

  const goToNextAuthor = useCallback((): StoryRailRow | null => {
    if (!author) return null;
    const authorsWithStories = rail.filter((item) => item.story_count > 0);
    const index = authorsWithStories.findIndex((item) => item.author_id === author.author_id);
    const nextAuthor = authorsWithStories[index + 1];
    if (!nextAuthor) return null;
    changeAuthor(nextAuthor);
    return nextAuthor;
  }, [author, changeAuthor, rail]);

  const goToPreviousAuthor = useCallback((): StoryRailRow | null => {
    if (!author) return null;
    const authorsWithStories = rail.filter((item) => item.story_count > 0);
    const index = authorsWithStories.findIndex((item) => item.author_id === author.author_id);
    const previousAuthor = authorsWithStories[index - 1];
    if (!previousAuthor) return null;
    changeAuthor(previousAuthor);
    return previousAuthor;
  }, [author, changeAuthor, rail]);

  const goNext = useCallback(() => {
    if (storyIndex + 1 < stories.length) {
      setStoryIndex((index) => index + 1);
      return;
    }
    if (!goToNextAuthor()) router.back();
  }, [goToNextAuthor, stories.length, storyIndex]);

  const goPrevious = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex((index) => index - 1);
      return;
    }
    const previousAuthor = goToPreviousAuthor();
    if (previousAuthor) {
      setStoryIndex(Math.max(0, previousAuthor.story_count - 1));
    }
  }, [goToPreviousAuthor, storyIndex]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 18 || Math.abs(gesture.dy) > 18,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 80) router.back();
      else if (gesture.dx < -70) goToNextAuthor();
      else if (gesture.dx > 70) goToPreviousAuthor();
    },
  }), [goToNextAuthor, goToPreviousAuthor]);

  useEffect(() => {
    if (!activeStory) return;
    const mediaToPreload = stories.slice(storyIndex + 1, storyIndex + 3);
    mediaToPreload.forEach((story) => {
      const preview = story.thumb_url ?? (story.kind === 'image' ? story.media_url : null);
      if (preview) void Image.prefetch(preview).catch(async (error: unknown) => console.warn('Unable to preload a story preview.', error));
    });
  }, [activeStory, stories, storyIndex]);

  useEffect(() => {
    if (!activeStory || author?.is_owner || paused || viewedStories.current.has(activeStory.id)) return;
    const timer = setTimeout(() => {
      viewedStories.current.add(activeStory.id);
      void markStoryViewed(activeStory.id)
        .then(() => queryClient.invalidateQueries({ queryKey: railQueryKey }))
        .catch(async (error: unknown) => {
          viewedStories.current.delete(activeStory.id);
          console.error('Unable to mark the story as viewed.', error);
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [activeStory, author?.is_owner, paused, queryClient]);

  const onMediaError = useCallback(() => {
    if (!activeStory) return;
    setFailedMediaIds((current) => new Set(current).add(activeStory.id));
  }, [activeStory]);

  const deleteActiveStory = () => {
    if (!activeStory) return;
    Alert.alert('Delete story', 'This story will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteStory(activeStory)
            .then(async () => {
              await queryClient.invalidateQueries({ queryKey: railQueryKey });
              await queryClient.invalidateQueries({ queryKey: authorStoriesQueryKey(authorId) });
              router.back();
            })
            .catch(async (error: unknown) => Alert.alert('Could not delete the story', await getErrorMessage(error, 'Try again.')));
        },
      },
    ]);
  };

  const reportActiveStory = (reason: string) => {
    if (!activeStory) return;
    void reportStory(activeStory.id, reason)
      .then(() => Alert.alert('Report received', 'Thank you for helping keep Wimpex safe.'))
      .catch(async (error: unknown) => Alert.alert('Could not report this story', await getErrorMessage(error, 'Try again.')));
  };

  const replyToStory = async () => {
    if (!activeStory || !replyDraft.trim() || replySending) return;
    setReplySending(true);
    try {
      const conversationId = await sendStoryReply(activeStory.id, replyDraft);
      router.push({ pathname: '/chat/[id]', params: { id: conversationId } });
    } catch (caught) {
      Alert.alert('Could not send story reply', await getErrorMessage(caught, 'Try again.'));
    } finally {
      setReplySending(false);
    }
  };

  const addActiveStoryToHighlight = async (highlightId: string) => {
    if (!activeStory || !author?.is_owner || savingHighlight) return;
    setSavingHighlight(true);
    try {
      await addStoryToHighlight(highlightId, activeStory);
      await queryClient.invalidateQueries({ queryKey: ['profile-story-highlights', authorId] });
      await queryClient.invalidateQueries({ queryKey: ['story-highlight-items', highlightId] });
      setHighlightPickerOpen(false);
      Alert.alert('Added to highlight', 'A copy of this story is saved to your profile.');
    } catch (caught) {
      Alert.alert('Could not add story to highlight', await getErrorMessage(caught, 'Try again.'));
    } finally {
      setSavingHighlight(false);
    }
  };

  const createHighlightAndAddStory = async () => {
    const validationError = validateStoryHighlightTitle(highlightTitle);
    if (validationError) {
      Alert.alert('Highlight name', validationError);
      return;
    }
    if (!activeStory || !author?.is_owner || savingHighlight) return;
    if (!canCreateStoryHighlight(highlightsQuery.data?.length ?? 0)) {
      Alert.alert('Highlight limit reached', 'You can create up to 20 highlights.');
      return;
    }
    setSavingHighlight(true);
    try {
      const highlightId = await createStoryHighlight(highlightTitle, highlightAudience);
      await addStoryToHighlight(highlightId, activeStory);
      await queryClient.invalidateQueries({ queryKey: ['profile-story-highlights', authorId] });
      setHighlightPickerOpen(false);
      setHighlightTitle('');
      Alert.alert('Added to highlight', 'A copy of this story is saved to your profile.');
    } catch (caught) {
      Alert.alert('Could not add story to highlight', await getErrorMessage(caught, 'Try again.'));
    } finally {
      setSavingHighlight(false);
    }
  };

  const showMoreActions = () => {
    if (author?.is_owner) {
      deleteActiveStory();
      return;
    }
    Alert.alert('Story options', 'Choose an action.', [
      { text: 'Report', onPress: () => Alert.alert('Report story', 'Choose a reason.', [
        { text: 'Spam', onPress: () => reportActiveStory('spam') },
        { text: 'Inappropriate content', onPress: () => reportActiveStory('inappropriate') },
        { text: 'Other', onPress: () => reportActiveStory('other') },
        { text: 'Cancel', style: 'cancel' },
      ]) },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => Alert.alert('Block account', `Block ${author?.display_name}?`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: () => {
              void blockStoryAuthor(authorId)
                .then(() => router.back())
                .catch(async (error: unknown) => Alert.alert('Could not block this account', await getErrorMessage(error, 'Try again.')));
            },
          },
        ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!isUuidRouteParam(authorId)) {
    return (
      <View style={styles.loading}>
        <Text style={styles.unavailableTitle}>This story link is invalid.</Text>
        <Pressable onPress={() => router.back()} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (railQuery.isPending) {
    return <View style={styles.loading}><View style={styles.loadingFrame}><ActivityIndicator color={theme.colors.primary} /></View></View>;
  }

  if (railQuery.isError) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableTitle}>Stories could not be loaded.</Text>
        <Pressable onPress={() => void railQuery.refetch()} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.closeText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.closeTextButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (!author || author.story_count === 0) {
    return <StoryUnavailable onClose={() => router.back()} />;
  }

  if (storiesQuery.isError) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableTitle}>Stories could not be loaded.</Text>
        <Pressable onPress={() => void storiesQuery.refetch()} style={styles.closeButton} accessibilityRole="button">
          <Text style={styles.closeText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (storiesQuery.isPending || !activeStory) {
    return <View style={styles.loading}><View style={styles.loadingFrame}><ActivityIndicator color={theme.colors.primary} /></View></View>;
  }

  const failed = failedMediaIds.has(activeStory.id) || !activeStory.media_url;
  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.viewer} {...panResponder.panHandlers}>
        <View style={styles.progressRow}>
          {stories.map((story, index) => (
            <View key={story.id} style={styles.progressTrack}>
              {index < storyIndex ? (
                <View style={styles.progressDone} />
              ) : index === storyIndex ? (
                <StoryProgress
                  key={story.id}
                  story={story}
                  active
                  paused={paused}
                  onComplete={goNext}
                />
              ) : null}
            </View>
          ))}
      </View>

        <View style={styles.header}>
          <View style={styles.authorInfo}>
            <View style={styles.avatar}>
              {author.avatar_url ? <Image source={{ uri: author.avatar_url }} style={styles.avatarImage} /> : (
                <Text style={styles.avatarInitials}>{initials(author.display_name)}</Text>
              )}
            </View>
            <View>
              <NameWithBadge name={author.display_name} userId={authorId} size="sm" textStyle={styles.authorName} />
              <Text style={styles.age}>{getAge(activeStory.created_at)}</Text>
            </View>
            {author.is_owner ? (
              <View style={styles.ownerStoryActions}>
                <Text style={styles.expiry}>{formatStoryExpiry(activeStory.expires_at)}</Text>
                <Pressable
                  onPress={openStoryViewers}
                  style={styles.viewerCountButton}
                  accessibilityRole="button"
                  accessibilityLabel={`${activeStory.view_count ?? 0} story views. Open viewers.`}
                >
                  <Text style={styles.viewerCountText}>{activeStory.view_count ?? 0} views</Text>
                </Pressable>
                <Pressable
                  onPress={() => setHighlightPickerOpen(true)}
                  style={styles.highlightAction}
                  accessibilityRole="button"
                  accessibilityLabel="Add story to a highlight"
                >
                  <Text style={styles.viewerCountText}>Add to highlight</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <Pressable onPress={showMoreActions} style={styles.moreButton} accessibilityRole="button" accessibilityLabel={author.is_owner ? 'Delete story' : 'Report or block account'}>
            <Icon name="more" size={24} color={theme.colors.white} />
          </Pressable>
        </View>

        <View
          style={styles.mediaFrame}
          onLayout={(event) => setActiveWidth(event.nativeEvent.layout.width)}
          onTouchStart={(event) => { startX.current = event.nativeEvent.locationX; }}
        >
          {failed ? (
            <View style={styles.mediaError}>
              <Text style={styles.mediaErrorText}>Could not load this story.</Text>
              <Pressable onPress={goNext} style={styles.skipButton} accessibilityRole="button">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>
          ) : activeStory.kind === 'video' && activeStory.media_url ? (
            <StoryVideo story={{ ...activeStory, media_url: activeStory.media_url }} paused={paused} onError={onMediaError} />
          ) : (
            <Image
              source={{ uri: activeStory.media_url ?? '' }}
              style={styles.media}
              resizeMode="cover"
              onError={onMediaError}
            />
          )}
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'transparent', pointerEvents: failed ? 'none' : 'auto' },
            ]}
            onPress={(event) => {
              const x = event.nativeEvent.locationX || startX.current;
              if (activeWidth > 0 && x / activeWidth < 0.3) goPrevious();
              else goNext();
            }}
            onPressIn={() => setHolding(true)}
            onPressOut={() => setHolding(false)}
            accessibilityRole="button"
            accessibilityLabel="Next or previous story"
          />
          <SectionErrorBoundary title="Story sticker unavailable">
            <StoryStickerWidget
              key={activeStory.id}
              storyId={activeStory.id}
              isOwner={author.is_owner}
              onPauseChange={setHolding}
            />
          </SectionErrorBoundary>
        </View>

        {activeStory.caption ? (
          <View style={[styles.captionChip, { backgroundColor: captionBackground(activeStory.caption_style) }]}>
            <Text style={styles.caption}>{activeStory.caption}</Text>
          </View>
        ) : null}
      </View>
      {!author.is_owner && canReply ? (
        <View style={styles.replyBar}>
          <FocusableTextInput
            value={replyDraft}
            onChangeText={setReplyDraft}
            placeholder={`Reply to ${author.display_name}`}
            placeholderTextColor="#CBD5E1"
            style={styles.replyInput}
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={() => void replyToStory()}
            editable={!replySending}
            accessibilityLabel={`Reply to ${author.display_name}'s story`}
          />
          <Pressable
            onPress={() => void replyToStory()}
            disabled={replySending || !replyDraft.trim()}
            style={styles.replySendButton}
            accessibilityRole="button"
            accessibilityLabel="Send story reply"
          >
            {replySending ? <ActivityIndicator color={theme.colors.black} /> : <Icon name="send" size={20} color={theme.colors.black} />}
          </Pressable>
        </View>
      ) : !author.is_owner && replyPolicyState.storyId === activeStory.id && replyPolicyState.error ? (
        <Text style={styles.replyPolicyError}>{replyPolicyState.error}</Text>
      ) : null}
      <Modal
        visible={viewersOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setViewersOpen(false)}
      >
        <View style={styles.viewerSheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setViewersOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close viewers"
          />
          <View style={styles.viewerSheet}>
            <View style={styles.viewerSheetHeader}>
              <Text style={styles.viewerSheetTitle}>{storyViewerCount} viewers</Text>
              <Pressable onPress={() => setViewersOpen(false)} accessibilityRole="button" accessibilityLabel="Close viewers">
                <Text style={styles.viewerSheetClose}>Close</Text>
              </Pressable>
            </View>
            {storyViewerError ? (
              <View style={styles.viewerSheetError}>
                <Text style={styles.viewerErrorText}>{storyViewerError}</Text>
                <Pressable
                  onPress={() => void loadStoryViewers(activeStory.id, storyViewers.length === 0)}
                  accessibilityRole="button"
                >
                  <Text style={styles.viewerSheetClose}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={storyViewers}
                keyExtractor={(item) => item.viewer_id}
                renderItem={({ item }) => (
                  <View style={styles.viewerRow}>
                    <View style={styles.viewerAvatar}>
                      {item.avatar_url ? (
                        <Image source={{ uri: item.avatar_url }} style={styles.viewerAvatarImage} />
                      ) : (
                        <Text style={styles.viewerAvatarInitials}>{initials(item.display_name)}</Text>
                      )}
                    </View>
                    <View style={styles.viewerIdentity}>
                      <NameWithBadge name={item.display_name} userId={item.viewer_id} size="xs" textStyle={styles.viewerName} />
                      <Text numberOfLines={1} style={styles.viewerUsername}>@{item.username}</Text>
                    </View>
                    <Text style={styles.viewerTime}>{getAge(item.viewed_at)}</Text>
                  </View>
                )}
                onEndReached={() => {
                  if (!storyViewerLoading && storyViewers.length < storyViewerCount) {
                    void loadStoryViewers(activeStory.id, false);
                  }
                }}
                onEndReachedThreshold={0.5}
                ListEmptyComponent={!storyViewerLoading ? <Text style={styles.viewerEmpty}>No views yet.</Text> : null}
                ListFooterComponent={storyViewerLoading ? <ActivityIndicator color={theme.colors.primary} style={styles.viewerLoading} /> : null}
              />
            )}
          </View>
        </View>
      </Modal>
      <Modal
        visible={highlightPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHighlightPickerOpen(false)}
      >
        <View style={styles.viewerSheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setHighlightPickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close add to highlight"
          />
          <View style={styles.viewerSheet}>
            <View style={styles.viewerSheetHeader}>
              <Text style={styles.viewerSheetTitle}>Add to highlight</Text>
              <Pressable onPress={() => setHighlightPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.viewerSheetClose}>Close</Text>
              </Pressable>
            </View>
            {highlightsQuery.isPending ? <ActivityIndicator color={theme.colors.primary} style={styles.viewerLoading} /> : null}
            {highlightsQuery.isError ? (
              <View style={styles.viewerSheetError}>
                <Text style={styles.viewerErrorText}>Highlights could not be loaded.</Text>
                <Pressable onPress={() => void highlightsQuery.refetch()}><Text style={styles.viewerSheetClose}>Retry</Text></Pressable>
              </View>
            ) : (
              <FlatList
                data={highlightsQuery.data ?? []}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => void addActiveStoryToHighlight(item.id)}
                    disabled={savingHighlight || !canAddStoryToHighlight(item.item_count)}
                    style={styles.highlightPickerRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Add story to ${item.title}`}
                  >
                    {item.cover_url
                      ? <Image source={{ uri: item.cover_url }} style={styles.highlightPickerCover} />
                      : <View style={styles.highlightPickerCover} />}
                    <Text style={styles.viewerName}>{item.title}</Text>
                    <Text style={styles.viewerUsername}>{item.item_count}/100</Text>
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.viewerEmpty}>Create your first highlight below.</Text>}
              />
            )}
            <View style={styles.highlightCreate}>
              <TextInput
                value={highlightTitle}
                onChangeText={setHighlightTitle}
                placeholder="New highlight name"
                placeholderTextColor={theme.colors.textMuted}
                maxLength={40}
                style={styles.highlightTitleInput}
                accessibilityLabel="New highlight name"
              />
              <View style={styles.highlightAudienceRow}>
                {(['everyone', 'followers', 'close_friends'] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setHighlightAudience(option)}
                    style={[styles.highlightAudience, highlightAudience === option && styles.highlightAudienceSelected]}
                  >
                    <Text style={[styles.highlightAudienceText, highlightAudience === option && styles.highlightAudienceTextSelected]}>
                      {option === 'close_friends' ? 'Close friends' : option[0].toUpperCase() + option.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {(highlightsQuery.data?.length ?? 0) < 20 ? (
                <Pressable
                  onPress={() => void createHighlightAndAddStory()}
                  disabled={savingHighlight}
                  style={styles.highlightCreateButton}
                  accessibilityRole="button"
                >
                  {savingHighlight
                    ? <ActivityIndicator color={theme.colors.black} />
                    : <Text style={styles.highlightCreateText}>Create and add story</Text>}
                </Pressable>
              ) : <Text style={styles.viewerEmpty}>You have reached the 20-highlight limit.</Text>}
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAwareScreen>
  );
}

function captionBackground(style: StoryWithUrl['caption_style']) {
  const token = style && typeof style === 'object' && !Array.isArray(style) ? style.background : null;
  if (token === 'sky') return '#38BDF8';
  if (token === 'green') return '#22C55E';
  if (token === 'gold') return '#FFD700';
  if (token === 'light') return '#FFFFFF';
  return 'rgba(15, 23, 42, 0.82)';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  viewer: { flex: 1, paddingTop: 38, paddingHorizontal: 12, paddingBottom: 24, justifyContent: 'space-between' },
  progressRow: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: '#FFFFFF' },
  progressDone: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  authorInfo: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { color: theme.colors.white, fontWeight: '800' },
  authorName: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  age: { color: '#CBD5E1', fontSize: 12, marginTop: 2 },
  expiry: { color: '#CBD5E1', fontSize: 11, marginLeft: 6 },
  ownerStoryActions: { alignItems: 'flex-end', gap: 2 },
  highlightAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  viewerCountButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  viewerCountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  moreButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mediaFrame: { flex: 1, marginTop: 10, borderRadius: 22, overflow: 'hidden', backgroundColor: '#111418' },
  media: { width: '100%', height: '100%', backgroundColor: '#111418' },
  captionChip: { maxWidth: '94%', alignSelf: 'center', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, marginTop: 12 },
  caption: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  mediaError: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  mediaErrorText: { color: theme.colors.white, fontSize: 16, fontWeight: '700' },
  skipButton: { minWidth: 100, minHeight: 44, backgroundColor: theme.colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: theme.colors.black, fontWeight: '800' },
  loading: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', padding: 16 },
  loadingFrame: { width: '100%', height: '88%', borderRadius: 22, backgroundColor: '#111418', alignItems: 'center', justifyContent: 'center' },
  unavailable: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  unavailableTitle: { color: theme.colors.white, fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  closeButton: { minHeight: 46, minWidth: 130, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: theme.colors.primary },
  closeTextButton: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  closeText: { color: theme.colors.black, fontSize: 14, fontWeight: '800' },
  viewerSheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  viewerSheet: { maxHeight: '72%', minHeight: 240, paddingBottom: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: theme.colors.black },
  viewerSheetHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  viewerSheetTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '800' },
  viewerSheetClose: { color: theme.colors.primary, fontSize: 14, fontWeight: '700', padding: 8 },
  viewerSheetError: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  viewerErrorText: { color: theme.colors.danger, fontSize: 13, textAlign: 'center' },
  viewerRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  viewerAvatarImage: { width: '100%', height: '100%' },
  viewerAvatarInitials: { color: theme.colors.white, fontWeight: '700' },
  viewerIdentity: { flex: 1 },
  viewerName: { color: theme.colors.white, fontSize: 13, fontWeight: '700' },
  viewerUsername: { color: theme.colors.textMuted, fontSize: 12 },
  viewerTime: { color: theme.colors.textMuted, fontSize: 11 },
  viewerEmpty: { padding: 24, color: theme.colors.textMuted, textAlign: 'center' },
  viewerLoading: { padding: 16 },
  highlightPickerRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.line },
  highlightPickerCover: { width: 40, height: 40, borderRadius: 8, backgroundColor: theme.colors.surface },
  highlightCreate: { gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: theme.colors.line },
  highlightTitleInput: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10, paddingHorizontal: 12, color: theme.colors.white, fontSize: 14 },
  highlightAudienceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  highlightAudience: { minHeight: 34, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, justifyContent: 'center' },
  highlightAudienceSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  highlightAudienceText: { color: theme.colors.white, fontSize: 11 },
  highlightAudienceTextSelected: { color: theme.colors.black, fontWeight: '800' },
  highlightCreateButton: { minHeight: 44, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  highlightCreateText: { color: theme.colors.black, fontWeight: '800' },
  replyBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#000000' },
  replyInput: { flex: 1, minHeight: 42, paddingHorizontal: 15, borderRadius: 21, backgroundColor: '#1F2937', color: theme.colors.white, fontSize: 13 },
  replySendButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.colors.primary },
  replyPolicyError: { paddingHorizontal: 18, paddingVertical: 12, color: '#FCA5A5', fontSize: 12, backgroundColor: '#000000', textAlign: 'center' },
});
