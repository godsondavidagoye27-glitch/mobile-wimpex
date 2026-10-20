import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusableTextInput } from '../components/AuthField';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { localDateTimeParts, parseLocalSchedule } from '../features/feed/scheduledPosts';
import type { Post } from '../types/database';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

type ScheduledPost = Pick<Post, 'id' | 'caption' | 'video_path' | 'scheduled_at'>;

async function fetchScheduledPosts(): Promise<ScheduledPost[]> {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) return [];
  const { data, error } = await client
    .from('posts')
    .select('id,caption,video_path,scheduled_at')
    .eq('author_id', userId)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function ScheduledPostCard({
  post,
  busy,
  onReschedule,
  onPublishNow,
  onCancel,
}: {
  post: ScheduledPost;
  busy: boolean;
  onReschedule: (post: ScheduledPost, date: string, time: string) => void;
  onPublishNow: (post: ScheduledPost) => void;
  onCancel: (post: ScheduledPost) => void;
}) {
  const parts = localDateTimeParts(post.scheduled_at ?? '');
  const [date, setDate] = useState(parts.date);
  const [time, setTime] = useState(parts.time);

  return (
    <View style={styles.card}>
      <Text style={styles.caption} numberOfLines={3}>{post.caption.trim() || 'Untitled video'}</Text>
      <Text style={styles.scheduledFor}>
        Currently scheduled for {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : 'an unknown time'}
      </Text>
      <Text style={styles.localTimeNote}>Edit using your device’s local time.</Text>
      <View style={styles.inputs}>
        <FocusableTextInput
          accessibilityLabel="New scheduled date, year-month-day"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="numbers-and-punctuation"
          style={styles.input}
        />
        <FocusableTextInput
          accessibilityLabel="New scheduled time, 24-hour local time"
          value={time}
          onChangeText={setTime}
          placeholder="HH:MM"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="numbers-and-punctuation"
          style={styles.input}
        />
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => onReschedule(post, date, time)}
          disabled={busy}
          style={styles.secondaryAction}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryActionText}>Save time</Text>
        </Pressable>
        <Pressable
          onPress={() => onPublishNow(post)}
          disabled={busy}
          style={styles.primaryAction}
          accessibilityRole="button"
        >
          <Text style={styles.primaryActionText}>Publish now</Text>
        </Pressable>
        <Pressable
          onPress={() => Alert.alert(
            'Cancel scheduled post?',
            'The uploaded video will be removed from your scheduled posts.',
            [
              { text: 'Keep scheduled', style: 'cancel' },
              { text: 'Cancel post', style: 'destructive', onPress: () => onCancel(post) },
            ],
          )}
          disabled={busy}
          style={styles.cancelAction}
          accessibilityRole="button"
          accessibilityLabel="Cancel scheduled post"
        >
          <Icon name="trash" size={20} color={theme.colors.danger} />
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={theme.colors.primary} style={styles.busy} /> : null}
    </View>
  );
}

export default function ScheduledPostsScreen() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPosts(await fetchScheduledPosts());
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchScheduledPosts().then((scheduledPosts) => {
      if (mounted) setPosts(scheduledPosts);
    }).catch(async (loadError: unknown) => {
      console.error('Unable to load scheduled posts.', loadError);
      if (mounted) setError(await getErrorMessage(loadError, 'Could not load your scheduled posts.'));
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const runAction = async (post: ScheduledPost, action: () => Promise<void>) => {
    setError(null);
    setBusyPostId(post.id);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      console.error('Unable to update a scheduled post.', actionError);
      try {
        await refresh();
      } catch (refreshError) {
        console.error('Unable to refresh scheduled posts after an action failed.', refreshError);
      }
      setError(await getErrorMessage(actionError, 'Could not update this scheduled post.'));
    } finally {
      setBusyPostId(null);
    }
  };

  const reschedule = (post: ScheduledPost, date: string, time: string) => runAction(post, async () => {
    const parsed = parseLocalSchedule(date, time);
    if (!parsed.scheduledAt) throw new Error(parsed.error || 'Choose a valid date and time.');
    const { error: rpcError } = await getSupabaseClient().rpc('reschedule_post', {
      p_post_id: post.id,
      p_scheduled_at: parsed.scheduledAt,
    });
    if (rpcError) throw rpcError;
  });

  const publishNow = (post: ScheduledPost) => runAction(post, async () => {
    const { error: publishError } = await getSupabaseClient().functions.invoke('publish-scheduled-posts', {
      body: { postId: post.id },
    });
    if (publishError) throw publishError;
  });

  const cancel = (post: ScheduledPost) => runAction(post, async () => {
    const client = getSupabaseClient();
    const { data: videoPath, error: cancelError } = await client.rpc('cancel_scheduled_post', { p_post_id: post.id });
    if (cancelError) throw cancelError;
    if (videoPath) {
      const { error: storageError } = await client.storage.from('videos').remove([videoPath]);
      if (storageError) throw storageError;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const ownerId = sessionData.session?.user.id;
    if (!ownerId) throw new Error('Sign in again to finish cancelling this post.');
    const { error: deleteError } = await client
      .from('posts')
      .delete()
      .eq('id', post.id)
      .eq('author_id', ownerId);
    if (deleteError) throw deleteError;
  });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Scheduled posts</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>Videos upload now and go live at the selected local time.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
        {!loading && posts.length === 0 ? (
          <Text style={styles.empty}>No scheduled posts. Choose Schedule when creating a video.</Text>
        ) : null}
        {posts.map((post) => (
          <ScheduledPostCard
            key={`${post.id}:${post.scheduled_at}`}
            post={post}
            busy={busyPostId === post.id}
            onReschedule={(item, date, time) => void reschedule(item, date, time)}
            onPublishNow={(item) => void publishNow(item)}
            onCancel={(item) => void cancel(item)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  headerSpacer: { width: 44 },
  content: { padding: 18, gap: 14, paddingBottom: 36 },
  description: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  error: { color: theme.colors.danger, lineHeight: 20 },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 20,
    lineHeight: 20,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: 14,
    gap: 10,
  },
  caption: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  scheduledFor: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  localTimeNote: { color: theme.colors.textMuted, fontSize: 11 },
  inputs: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.black,
    paddingHorizontal: 12,
    color: theme.colors.white,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryAction: {
    borderRadius: 12,
    backgroundColor: theme.colors.black,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryActionText: { color: theme.colors.white, fontSize: 12, fontWeight: '700' },
  primaryAction: {
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryActionText: { color: theme.colors.black, fontSize: 12, fontWeight: '800' },
  cancelAction: {
    width: 42,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  busy: { alignSelf: 'center' },
});
