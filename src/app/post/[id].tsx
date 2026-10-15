import { useEvent } from 'expo';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../../components/Icon';
import { FocusableTextInput } from '../../components/AuthField';
import { ChatScreenLayout } from '../../components/ChatScreenLayout';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import { HashtagText } from '../../components/HashtagText';
import { CaptionOverlay } from '../../features/captions/CaptionOverlay';
import { parseWebVtt, writeWebVtt, type VttCue } from '../../features/captions/vtt';
import { incrementPostShare, setPostLiked, setPostSaved } from '../../features/feed/postActions';
import { getSignedUrls } from '../../features/feed/useFeed';
import { getSupabaseClient } from '../../lib/supabase';
import type { Post } from '../../types/database';
import { theme } from '../../theme/theme';
import { calculateChatComposerHeight } from '../../features/chats/chatLayout';

type PostDetail = {
  post: Post;
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  videoUrl: string | null;
  liked: boolean;
  saved: boolean;
  currentUserId: string;
};

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  created_at: string;
  deleted_at: string | null;
};

type CommentAuthor = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

type CommentItem = CommentRow & {
  author: CommentAuthor;
  replies: (CommentRow & { author: CommentAuthor })[];
};

type CommentCursor = { createdAt: string; id: string };
type CommentPage = { items: CommentItem[]; nextCursor: CommentCursor | null };

async function loadPost(postId: string): Promise<PostDetail> {
  const client = getSupabaseClient();
  const { data: post, error: postError } = await client
    .from('posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle();
  if (postError) throw postError;
  if (!post) throw new Error('This video is no longer available.');

  const [{ data: author, error: authorError }, { data: userResult, error: userError }] = await Promise.all([
    client.from('profiles').select('id,username,display_name,avatar_url').eq('id', post.author_id).maybeSingle(),
    client.auth.getUser(),
  ]);
  if (authorError) throw authorError;
  if (userError) throw userError;
  if (!author) throw new Error('Could not load the video creator.');
  if (!userResult.user) throw new Error('Sign in to view this video.');

  const [likesResult, savesResult, videoUrls] = await Promise.all([
    client.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', userResult.user.id).maybeSingle(),
    client.from('post_saves').select('post_id').eq('post_id', postId).eq('user_id', userResult.user.id).maybeSingle(),
    post.video_path ? getSignedUrls('videos', [post.video_path]) : Promise.resolve(new Map<string, string | null>()),
  ]);
  if (likesResult.error) throw likesResult.error;
  if (savesResult.error) throw savesResult.error;

  return {
    post,
    author,
    videoUrl: post.video_path ? videoUrls.get(post.video_path) ?? null : null,
    liked: Boolean(likesResult.data),
    saved: Boolean(savesResult.data),
    currentUserId: userResult.user.id,
  };
}

async function loadCommentPage(postId: string, cursor: CommentCursor | null): Promise<CommentPage> {
  const client = getSupabaseClient();
  let query = client
    .from('comments')
    .select('id,post_id,author_id,parent_id,body,like_count,created_at,deleted_at')
    .eq('post_id', postId)
    .is('parent_id', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (cursor) {
    query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`);
  }
  const { data: roots, error } = await query.limit(30);
  if (error) throw error;
  if (!roots.length) return { items: [], nextCursor: null };

  const rootIds = roots.map(({ id }) => id);
  const { data: replies, error: repliesError } = await client
    .from('comments')
    .select('id,post_id,author_id,parent_id,body,like_count,created_at,deleted_at')
    .in('parent_id', rootIds)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (repliesError) throw repliesError;

  const authorIds = [...new Set([...roots, ...replies].map(({ author_id }) => author_id))];
  const { data: authors, error: authorsError } = await client
    .from('profiles')
    .select('id,username,display_name,avatar_url')
    .in('id', authorIds);
  if (authorsError) throw authorsError;
  const authorById = new Map(authors.map((author) => [author.id, author]));
  const repliesByParent = new Map<string, CommentRow[]>();
  replies.forEach((reply) => {
    if (!reply.parent_id) return;
    const group = repliesByParent.get(reply.parent_id) ?? [];
    group.push(reply);
    repliesByParent.set(reply.parent_id, group);
  });
  const items: CommentItem[] = roots.map((root) => {
    const rootAuthor = authorById.get(root.author_id);
    if (!rootAuthor) throw new Error('Could not load a comment author.');
    return {
      ...root,
      author: rootAuthor,
      replies: (repliesByParent.get(root.id) ?? []).map((reply) => {
        const replyAuthor = authorById.get(reply.author_id);
        if (!replyAuthor) throw new Error('Could not load a reply author.');
        return { ...reply, author: replyAuthor };
      }),
    };
  });
  const lastRoot = roots.at(-1);
  return {
    items,
    nextCursor: roots.length === 30 && lastRoot ? { createdAt: lastRoot.created_at, id: lastRoot.id } : null,
  };
}

function PostVideo({ uri, post, isAuthor }: { uri: string | null; post: Post; isAuthor: boolean }) {
  if (!uri) {
    return (
      <View style={styles.videoUnavailable}>
        <Icon name="video" size={24} color={theme.colors.textMuted} />
        <Text style={styles.videoUnavailableText}>Video unavailable</Text>
      </View>
    );
  }
  return <PlayingPostVideo uri={uri} post={post} isAuthor={isAuthor} />;
}

function PlayingPostVideo({ uri, post, isAuthor }: { uri: string; post: Post; isAuthor: boolean }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    player.play();
  }, [player]);

  return (
    <View style={styles.videoContainer}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />
      <CaptionOverlay player={player} post={post} active isAuthor={isAuthor} />
      {!isPlaying ? (
        <View pointerEvents="none" style={styles.pausedVideoOverlay}>
          <Icon name="play" size={24} color={theme.colors.white} />
        </View>
      ) : null}
    </View>
  );
}

function Avatar({ author, size = 42 }: { author: CommentAuthor | PostDetail['author']; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarInitial}>
        {author.display_name.trim().charAt(0).toUpperCase() || author.username.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function PostDetailScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const postId = Array.isArray(routeId) ? routeId[0] : routeId;
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState('');
  const [commentInputHeight, setCommentInputHeight] = useState(44);
  const commentListRef = useRef<FlatList<CommentItem>>(null);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);
  const [captionCues, setCaptionCues] = useState<VttCue[]>([]);
  const [captionEditorError, setCaptionEditorError] = useState<string | null>(null);
  const [savingCaptions, setSavingCaptions] = useState(false);
  const postQuery = useQuery({
    queryKey: ['post-detail', postId],
    queryFn: () => loadPost(postId),
    enabled: Boolean(postId),
    refetchInterval: (query) => {
      const status = query.state.data?.post.captions_status;
      return status === 'queued' || status === 'processing' ? 5000 : false;
    },
  });
  const commentsQuery = useInfiniteQuery({
    queryKey: ['post-comments', postId],
    initialPageParam: null as CommentCursor | null,
    queryFn: ({ pageParam }) => loadCommentPage(postId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(postId && postQuery.data?.post.allow_comments),
  });
  const detail = postQuery.data;
  const comments = useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [commentsQuery.data],
  );

  useEffect(() => {
    if (!postId) return;
    const client = getSupabaseClient();
    const channel = client
      .channel(`post-comments:${postId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'comments',
        filter: `post_id=eq.${postId}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['post-comments', postId] });
        void queryClient.invalidateQueries({ queryKey: ['post-detail', postId] });
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [postId, queryClient]);

  const refreshPost = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['post-detail', postId] }),
      queryClient.invalidateQueries({ queryKey: ['post-comments', postId] }),
      queryClient.invalidateQueries({ queryKey: ['feed', 'for_you'] }),
      queryClient.invalidateQueries({ queryKey: ['feed', 'following'] }),
    ]);
  };

  const openCaptionEditor = async () => {
    if (!detail?.post.captions_path) return;
    setCaptionEditorError(null);
    try {
      const { data, error } = await getSupabaseClient().storage.from('captions').download(detail.post.captions_path);
      if (error) throw error;
      const cues = parseWebVtt(await data.text());
      if (!cues.length) throw new Error('The caption file could not be read.');
      setCaptionCues(cues);
      setCaptionEditorOpen(true);
    } catch (error) {
      setCaptionEditorError(error instanceof Error ? error.message : 'Could not load captions for editing.');
    }
  };

  const saveCaptionEdits = async () => {
    if (!detail || savingCaptions) return;
    setSavingCaptions(true);
    setCaptionEditorError(null);
    try {
      const { error } = await getSupabaseClient().functions.invoke('captions-save', {
        body: { postId: detail.post.id, captions: writeWebVtt(captionCues) },
      });
      if (error) throw error;
      setCaptionEditorOpen(false);
      await refreshPost();
    } catch (error) {
      setCaptionEditorError(error instanceof Error ? error.message : 'Could not save captions.');
    } finally {
      setSavingCaptions(false);
    }
  };

  const toggleAutoCaptions = async () => {
    if (!detail) return;
    try {
      const { error } = await getSupabaseClient().rpc('set_post_captions_enabled', {
        post_id: detail.post.id,
        enabled: !detail.post.auto_captions,
      });
      if (error) throw error;
      await refreshPost();
    } catch (error) {
      Alert.alert('Could not update caption settings', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const sendComment = async () => {
    const body = commentText.trim();
    if (!body || !detail || sending) return;
    setSending(true);
    setCommentError(null);
    try {
      const { error: insertError } = await getSupabaseClient().from('comments').insert({
        post_id: detail.post.id,
        author_id: detail.currentUserId,
        parent_id: replyTo?.id ?? null,
        body,
      });
      if (insertError) throw insertError;
      setCommentText('');
      setReplyTo(null);
      await refreshPost();
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Could not send your comment. Try again.');
    } finally {
      setSending(false);
    }
  };

  const deleteComment = (comment: CommentRow) => {
    Alert.alert('Delete comment', 'This comment will be removed from the conversation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void getSupabaseClient()
            .from('comments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', comment.id)
            .eq('author_id', detail?.currentUserId ?? '')
            .then(({ error }) => {
              if (error) Alert.alert('Could not delete comment', error.message);
              else void refreshPost();
            });
        },
      },
    ]);
  };

  const sharePost = async () => {
    if (!detail) return;
    try {
      const result = await Share.share({ message: `Watch @${detail.author.username}'s video on Wimpex.` });
      if (result.action === Share.sharedAction) {
        await incrementPostShare(detail.post.id);
        await refreshPost();
      }
    } catch (error) {
      Alert.alert('Could not share this video', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const renderComment = ({ item }: { item: CommentItem }) => (
    <View style={styles.commentBlock}>
      <CommentRowView
        comment={item}
        currentUserId={detail?.currentUserId ?? ''}
        onReply={() => setReplyTo(item)}
        onDelete={deleteComment}
      />
      {item.replies.map((reply) => (
        <CommentRowView
          key={reply.id}
          comment={reply}
          currentUserId={detail?.currentUserId ?? ''}
          onReply={() => setReplyTo(item)}
          onDelete={deleteComment}
          nested
        />
      ))}
    </View>
  );

  if (postQuery.isPending) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={theme.colors.primary} />
        <View style={styles.skeleton} />
        <View style={styles.skeletonLine} />
      </View>
    );
  }

  if (postQuery.isError || !detail) {
    return (
      <View style={styles.loadingScreen}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.errorText}>{postQuery.error?.message ?? 'Could not load this video.'}</Text>
        <Pressable onPress={() => void postQuery.refetch()} style={styles.primaryButton} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
    <ChatScreenLayout
      style={styles.screen}
      header={(
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="back" size={20} color={theme.colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Video</Text>
          <Pressable onPress={() => void sharePost()} style={styles.headerAction} accessibilityRole="button" accessibilityLabel="Share video">
            <Icon name="share" size={20} color={theme.colors.white} />
          </Pressable>
        </View>
      )}
      contextHeader={(
        <View>
          <PostVideo
            uri={detail.videoUrl}
            post={detail.post}
            isAuthor={detail.currentUserId === detail.post.author_id}
          />
          {detail.currentUserId === detail.post.author_id ? (
            <View style={styles.captionOwnerTools}>
              {detail.post.captions_status === 'ready' ? (
                <Pressable onPress={() => void openCaptionEditor()} style={styles.captionToolButton} accessibilityRole="button">
                  <Text style={styles.captionToolText}>Edit captions</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => void toggleAutoCaptions()} style={styles.captionToolButton} accessibilityRole="button">
                <Text style={styles.captionToolText}>Turn captions off or on</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.authorRow}>
            <Link href={{ pathname: '/user/[username]', params: { username: detail.author.username } }} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${detail.author.display_name}'s profile`}>
                <Avatar author={detail.author} size={46} />
              </Pressable>
            </Link>
            <View style={styles.authorMeta}>
              <Link href={{ pathname: '/user/[username]', params: { username: detail.author.username } }} asChild>
                <Pressable accessibilityRole="button">
                  <Text style={styles.authorName}>{detail.author.display_name}</Text>
                  <Text style={styles.handle}>@{detail.author.username}</Text>
                </Pressable>
              </Link>
            </View>
            <Text style={styles.postDate}>{formatCommentDate(detail.post.created_at)}</Text>
          </View>

          <HashtagText text={detail.post.caption} style={styles.caption} />
          {detail.post.hashtags.length ? (
            <HashtagText text={detail.post.hashtags.map((tag) => `#${tag}`).join(' ')} style={styles.hashtags} />
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              onPress={() => {
                void setPostLiked(detail.post.id, detail.liked)
                  .then(refreshPost)
                  .catch((error: unknown) => Alert.alert('Could not update like', error instanceof Error ? error.message : 'Try again.'));
              }}
              style={styles.statButton}
              accessibilityRole="button"
              accessibilityLabel={detail.liked ? 'Unlike video' : 'Like video'}
            >
              <Icon name="heart" size={20} color={detail.liked ? theme.colors.danger : theme.colors.white} filled={detail.liked} />
              <Text style={styles.metric}>{detail.post.like_count}</Text>
            </Pressable>
            <View style={styles.statButton}>
              <Icon name="comment" size={20} color={theme.colors.white} />
              <Text style={styles.metric}>{detail.post.comment_count}</Text>
            </View>
            <Pressable
              onPress={() => {
                void setPostSaved(detail.post.id, detail.saved)
                  .then(refreshPost)
                  .catch((error: unknown) => Alert.alert('Could not update saved videos', error instanceof Error ? error.message : 'Try again.'));
              }}
              style={styles.statButton}
              accessibilityRole="button"
              accessibilityLabel={detail.saved ? 'Remove saved video' : 'Save video'}
            >
              <Icon name="bookmark" size={20} color={theme.colors.white} filled={detail.saved} />
              <Text style={styles.metric}>{detail.post.save_count}</Text>
            </Pressable>
          </View>

          {detail.post.allow_comments ? (
            <View style={styles.commentHeader}>
              <Text style={styles.sectionTitle}>Comments</Text>
              {commentsQuery.isPending ? <ActivityIndicator color={theme.colors.primary} /> : null}
              {commentsQuery.isError ? (
                <Pressable onPress={() => void commentsQuery.refetch()} accessibilityRole="button">
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={styles.commentsDisabled}>Comments are turned off for this video.</Text>
          )}
        </View>
      )}
      hideContextHeaderWhenKeyboardOpen
      list={(
        <FlatList
          ref={commentListRef}
          data={detail.post.allow_comments ? comments : []}
          keyExtractor={(item) => item.id}
          renderItem={renderComment}
          onEndReached={() => {
            if (commentsQuery.hasNextPage && !commentsQuery.isFetchingNextPage) void commentsQuery.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          refreshing={postQuery.isRefetching}
          onRefresh={() => void refreshPost()}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            detail.post.allow_comments && !commentsQuery.isPending && !commentsQuery.isError
              ? <Text style={styles.emptyComments}>Be the first to comment.</Text>
              : null
          }
          ListFooterComponent={commentsQuery.isFetchingNextPage ? <ActivityIndicator color={theme.colors.primary} style={styles.listFooter} /> : null}
        />
      )}
      composer={detail.post.allow_comments ? (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replying}>
              <Text style={styles.replyingText}>Replying to @{replyTo.author.username}</Text>
              <Pressable onPress={() => setReplyTo(null)} style={styles.closeReply} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <Icon name="close" size={20} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
          {commentError ? <Text style={styles.errorText}>{commentError}</Text> : null}
          <View style={styles.composerRow}>
            <FocusableTextInput
              value={commentText}
              onChangeText={setCommentText}
              onContentSizeChange={(event) => {
                setCommentInputHeight(calculateChatComposerHeight(event.nativeEvent.contentSize.height));
              }}
              onFocus={() => commentListRef.current?.scrollToEnd({ animated: true })}
              maxLength={500}
              multiline
              placeholder={replyTo ? 'Write a reply' : 'Write a comment'}
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.commentInput, { height: commentInputHeight }]}
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={() => void sendComment()}
            />
            <Pressable
              onPress={() => void sendComment()}
              disabled={!commentText.trim() || sending}
              style={[styles.sendButton, (!commentText.trim() || sending) && styles.disabledButton]}
              accessibilityRole="button"
              accessibilityLabel={replyTo ? 'Send reply' : 'Send comment'}
            >
              {sending
                ? <ActivityIndicator color={theme.colors.black} />
                : <Icon name="send" size={20} color={theme.colors.black} />}
            </Pressable>
          </View>
        </View>
      ) : null}
    />
      <Modal
        visible={captionEditorOpen}
        animationType="slide"
        onRequestClose={() => setCaptionEditorOpen(false)}
      >
        <KeyboardAwareScreen style={{ flex: 1 }}>
          <View style={styles.captionEditor}>
            <View style={styles.captionEditorHeader}>
              <Text style={styles.sectionTitle}>Edit captions</Text>
              <Pressable onPress={() => setCaptionEditorOpen(false)} accessibilityRole="button" accessibilityLabel="Close caption editor">
                <Icon name="close" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.captionCueList} keyboardShouldPersistTaps="handled">
              {captionCues.map((cue, index) => (
                <View key={`${cue.startMs}-${cue.endMs}-${index}`} style={styles.captionCue}>
                  <Text style={styles.captionCueTime}>{cue.startMs} ms</Text>
                  <FocusableTextInput
                    value={cue.text}
                    onChangeText={(text) => setCaptionCues((current) => current.map((item, cueIndex) => (
                      cueIndex === index ? { ...item, text } : item
                    )))}
                    multiline
                    maxLength={84}
                    style={styles.captionCueInput}
                    accessibilityLabel={`Caption text ${index + 1}`}
                  />
                </View>
              ))}
            </ScrollView>
            {captionEditorError ? <Text accessibilityRole="alert" style={styles.errorText}>{captionEditorError}</Text> : null}
            <Pressable
              onPress={() => void saveCaptionEdits()}
              disabled={savingCaptions}
              style={styles.captionSaveButton}
              accessibilityRole="button"
            >
              {savingCaptions
                ? <ActivityIndicator color={theme.colors.black} />
                : <Text style={styles.primaryButtonText}>Save captions</Text>}
            </Pressable>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </>
  );
}

function CommentRowView({
  comment,
  currentUserId,
  onReply,
  onDelete,
  nested = false,
}: {
  comment: CommentRow & { author: CommentAuthor };
  currentUserId: string;
  onReply: () => void;
  onDelete: (comment: CommentRow) => void;
  nested?: boolean;
}) {
  return (
    <View style={[styles.commentRow, nested && styles.nestedComment]}>
      <Link href={{ pathname: '/user/[username]', params: { username: comment.author.username } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${comment.author.display_name}'s profile`}>
          <Avatar author={comment.author} size={nested ? 32 : 38} />
        </Pressable>
      </Link>
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Link href={{ pathname: '/user/[username]', params: { username: comment.author.username } }} asChild>
            <Pressable accessibilityRole="button">
              <Text style={styles.commentName}>{comment.author.display_name}</Text>
            </Pressable>
          </Link>
          <Text style={styles.commentDate}>{formatCommentDate(comment.created_at)}</Text>
        </View>
        <Text style={[styles.commentText, comment.deleted_at && styles.deletedComment]}>
          {comment.deleted_at ? 'This comment was deleted.' : comment.body}
        </Text>
        <View style={styles.commentActions}>
          <Pressable onPress={onReply} style={styles.commentAction} accessibilityRole="button">
            <Text style={styles.commentActionText}>Reply</Text>
          </Pressable>
          {comment.author_id === currentUserId && !comment.deleted_at ? (
            <Pressable onPress={() => onDelete(comment)} style={styles.commentAction} accessibilityRole="button">
              <Text style={styles.commentActionText}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  loadingScreen: {
    flex: 1,
    backgroundColor: theme.colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 18,
  },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  headerTitle: { color: theme.colors.white, fontSize: 17, fontWeight: '700' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  listContent: { flexGrow: 1, paddingBottom: 24 },
  videoContainer: { width: '100%', height: 440, backgroundColor: '#050607', position: 'relative' },
  videoUnavailable: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    gap: 8,
  },
  videoUnavailableText: { color: theme.colors.textMuted },
  captionOwnerTools: { flexDirection: 'row', gap: 16, paddingHorizontal: 18, paddingTop: 10 },
  captionToolButton: { minHeight: 40, justifyContent: 'center' },
  captionToolText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  captionEditor: { flex: 1, backgroundColor: theme.colors.black, padding: 18, paddingTop: 48, gap: 14 },
  captionEditorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  captionCueList: { gap: 12, paddingBottom: 20 },
  captionCue: { borderRadius: 12, backgroundColor: theme.colors.surface, padding: 12, gap: 8 },
  captionCueTime: { color: theme.colors.textMuted, fontSize: 11 },
  captionCueInput: { minHeight: 52, color: theme.colors.white, textAlignVertical: 'top' },
  captionSaveButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: theme.colors.primary },
  pausedVideoOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 16, gap: 12 },
  avatar: { backgroundColor: '#1D3557', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: theme.colors.white, fontWeight: '700', fontSize: 16 },
  authorMeta: { flex: 1 },
  authorName: { color: theme.colors.white, fontWeight: '700', fontSize: 15 },
  handle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  postDate: { color: theme.colors.textMuted, fontSize: 12 },
  caption: { color: theme.colors.white, fontSize: 16, paddingHorizontal: 18, marginTop: 14 },
  hashtags: { color: theme.colors.primary, fontSize: 14, paddingHorizontal: 18, marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 24, paddingHorizontal: 18, paddingVertical: 16 },
  statButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  metric: { color: theme.colors.textMuted, fontSize: 13 },
  commentHeader: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.line,
  },
  sectionTitle: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  commentsDisabled: { color: theme.colors.textMuted, paddingHorizontal: 18, paddingTop: 18 },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
  emptyComments: { color: theme.colors.textMuted, textAlign: 'center', padding: 28 },
  commentBlock: { paddingTop: 16, paddingHorizontal: 18, gap: 16 },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nestedComment: { paddingLeft: 46 },
  commentBody: { flex: 1 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentName: { color: theme.colors.white, fontWeight: '700', fontSize: 13 },
  commentDate: { color: theme.colors.textMuted, fontSize: 11 },
  commentText: { color: theme.colors.textMuted, lineHeight: 20, marginTop: 4 },
  deletedComment: { fontStyle: 'italic' },
  commentActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  commentAction: { minHeight: 32, justifyContent: 'center' },
  commentActionText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  composer: { borderTopWidth: 1, borderTopColor: theme.colors.line, backgroundColor: theme.colors.surface, paddingHorizontal: 14, paddingTop: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commentInput: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: '#171C22', paddingHorizontal: 16, paddingVertical: 10, color: theme.colors.white, textAlignVertical: 'top' },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  disabledButton: { opacity: 0.45 },
  replying: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  replyingText: { color: theme.colors.textMuted, fontSize: 12 },
  closeReply: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: theme.colors.danger, textAlign: 'center', paddingHorizontal: 20, lineHeight: 20 },
  primaryButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: 22, paddingHorizontal: 22 },
  primaryButtonText: { color: theme.colors.black, fontWeight: '700' },
  skeleton: { width: '100%', height: 320, borderRadius: 18, backgroundColor: theme.colors.surface },
  skeletonLine: { width: '80%', height: 16, borderRadius: 8, backgroundColor: theme.colors.surface },
  listFooter: { paddingVertical: 22 },
});
