import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import type { Database } from '../types/database';

type HiddenComment = Database['public']['Functions']['get_my_hidden_comments']['Returns'][number];

export default function HiddenCommentsScreen() {
  const [comments, setComments] = useState<HiddenComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().rpc('get_my_hidden_comments');
    if (loadError) throw loadError;
    setComments(data);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: loadError } = await getSupabaseClient().rpc('get_my_hidden_comments');
        if (loadError) throw loadError;
        if (active) setComments(data);
      } catch (caught) {
        if (active) setError(await getErrorMessage(caught, 'Could not load hidden comments.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const approve = async (comment: HiddenComment) => {
    try {
      const { error: reviewError } = await getSupabaseClient().rpc('review_hidden_comment', {
        p_comment_id: comment.id,
        p_unhide: true,
      });
      if (reviewError) throw reviewError;
      await refresh();
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not approve this comment.'));
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Hidden comments</Text>
        <View style={styles.back} />
      </View>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {comments.length === 0 ? <Text style={styles.empty}>No comments need review.</Text> : comments.map((comment) => (
            <View key={comment.id} style={styles.card}>
              <Text style={styles.author}>{comment.author_display_name} · @{comment.author_username}</Text>
              <Text style={styles.body}>{comment.body}</Text>
              <Text style={styles.reason}>{comment.visibility_state === 'hidden_word' ? 'Matched a hidden word or phrase' : 'Restricted account'}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => router.push({ pathname: '/post/[id]', params: { id: comment.post_id } })} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>View post</Text>
                </Pressable>
                <Pressable onPress={() => void approve(comment)} style={styles.primaryButton}>
                  <Text style={styles.primaryText}>Approve</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36 },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, gap: 8 },
  author: { color: theme.colors.textMuted, fontSize: 12 },
  body: { color: theme.colors.white, fontSize: 15 },
  reason: { color: theme.colors.primary, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  primaryButton: { backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: theme.colors.black, fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryText: { color: theme.colors.white },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: 48 },
  error: { color: theme.colors.danger },
});
