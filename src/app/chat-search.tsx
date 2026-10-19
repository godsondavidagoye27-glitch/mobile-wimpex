import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { buildChatSearchArgs } from '../features/chats/chatSearch';
import { searchChatMessages } from '../features/chats/chatService';
import { getErrorMessage } from '../lib/errorMessage';
import { getSingleRouteParam, isUuidRouteParam } from '../lib/routeParams';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

type SearchRow = Awaited<ReturnType<typeof searchChatMessages>>[number];

export default function ChatSearchScreen() {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const rawConversationId = getSingleRouteParam(params.conversationId) ?? null;
  const conversationId = rawConversationId && isUuidRouteParam(rawConversationId) ? rawConversationId : null;
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (append: boolean) => {
    if (query.trim().length < 2 || loading) return;
    if (rawConversationId && !conversationId) {
      setError('This conversation link is invalid.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const cursor = append && rows.length
        ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].message_id }
        : null;
      const data = await searchChatMessages(
        getSupabaseClient(),
        buildChatSearchArgs(query, conversationId, cursor),
      );
      setRows((current) => append ? [...current, ...data] : data);
      setHasMore(data.length === 30);
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not search messages.'));
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, query, rawConversationId, rows]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Search messages</Text>
        <View style={styles.back} />
      </View>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(false)}
          returnKeyType="search"
          placeholder="Search messages"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          accessibilityLabel="Search message text"
        />
        <Pressable onPress={() => void load(false)} disabled={loading || query.trim().length < 2} style={styles.searchButton}>
          {loading ? <ActivityIndicator color={theme.colors.black} /> : <Icon name="search" size={20} color={theme.colors.black} />}
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.message_id}
        contentContainerStyle={styles.results}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({
              pathname: '/chat/[id]',
              params: { id: item.conversation_id, messageId: item.message_id },
            })}
            style={styles.result}
            accessibilityRole="button"
          >
            <Text style={styles.resultText}>{item.highlighted.replaceAll('[', '‹').replaceAll(']', '›')}</Text>
            <Text style={styles.resultDate}>{new Date(item.created_at).toLocaleString()}</Text>
          </Pressable>
        )}
        ListEmptyComponent={!loading && query.length >= 2 ? <Text style={styles.empty}>No matching messages.</Text> : null}
        ListFooterComponent={hasMore ? (
          <Pressable onPress={() => void load(true)} disabled={loading} style={styles.more}>
            <Text style={styles.moreText}>{loading ? 'Loading…' : 'Load more'}</Text>
          </Pressable>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36 },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 8, padding: 16 },
  input: { flex: 1, height: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10, paddingHorizontal: 12, color: theme.colors.white },
  searchButton: { width: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.colors.primary },
  results: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  result: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.surface, gap: 6 },
  resultText: { color: theme.colors.white, fontSize: 14 },
  resultDate: { color: theme.colors.textMuted, fontSize: 11 },
  empty: { textAlign: 'center', color: theme.colors.textMuted, marginTop: 30 },
  more: { alignItems: 'center', padding: 14 },
  moreText: { color: theme.colors.primary, fontWeight: '700' },
  error: { color: theme.colors.danger, paddingHorizontal: 16 },
});
