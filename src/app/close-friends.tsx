import { getErrorMessage } from '../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { NameWithBadge } from '../components/NameWithBadge';
import { FocusableTextInput } from '../components/AuthField';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';

type CloseFriendRow = {
  id: string;
  display_name: string;
  username: string;
  is_friend: boolean;
};

const pageSize = 25;

export default function CloseFriendsScreen() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CloseFriendRow[]>([]);
  const [friendCursor, setFriendCursor] = useState<string | null>(null);
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadRows = useCallback(async (search: string, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const client = getSupabaseClient();
      const [friendsResult, candidatesResult] = await Promise.all([
        client.rpc('get_close_friends', {
          p_query: search,
          p_cursor: append ? friendCursor : null,
        }),
        client.rpc('get_close_friend_candidates', {
          p_query: search,
          p_cursor: append ? candidateCursor : null,
        }),
      ]);
      if (friendsResult.error) throw friendsResult.error;
      if (candidatesResult.error) throw candidatesResult.error;

      const friends = (friendsResult.data ?? []).map((friend) => ({
        id: friend.friend_id,
        display_name: friend.display_name,
        username: friend.username,
        is_friend: true,
      }));
      const candidates = (candidatesResult.data ?? []).map((candidate) => ({
        id: candidate.user_id,
        display_name: candidate.display_name,
        username: candidate.username,
        is_friend: false,
      }));
      setRows((current) => {
        const next = append ? [...current] : [];
        const ids = new Set(next.map((row) => row.id));
        [...friends, ...candidates].forEach((row) => {
          if (!ids.has(row.id)) {
            ids.add(row.id);
            next.push(row);
          }
        });
        return next;
      });
      setFriendCursor(friends.length === pageSize ? friends[friends.length - 1].id : null);
      setCandidateCursor(candidates.length === pageSize ? candidates[candidates.length - 1].id : null);
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not load close friends.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [candidateCursor, friendCursor]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFriendCursor(null);
      setCandidateCursor(null);
      void loadRows(query.trim(), false);
    }, 250);
    return () => clearTimeout(timeout);
  }, [loadRows, query]);

  const toggleFriend = async (row: CloseFriendRow) => {
    setError('');
    try {
      const { error: actionError } = row.is_friend
        ? await getSupabaseClient().rpc('remove_close_friend', { p_friend_id: row.id })
        : await getSupabaseClient().rpc('add_close_friend', { p_friend_id: row.id });
      if (actionError) throw actionError;
      setFriendCursor(null);
      setCandidateCursor(null);
      await loadRows(query.trim(), false);
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not update close friends.'));
    }
  };

  const renderRow = ({ item }: { item: CloseFriendRow }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.initials}>{item.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</Text>
      </View>
      <View style={styles.person}>
        <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.name} />
        <Text numberOfLines={1} style={styles.username}>@{item.username}</Text>
      </View>
      <Pressable
        onPress={() => void toggleFriend(item)}
        style={[styles.action, item.is_friend && styles.removeAction]}
        accessibilityRole="button"
        accessibilityLabel={item.is_friend ? `Remove ${item.display_name} from close friends` : `Add ${item.display_name} to close friends`}
      >
        {item.is_friend ? <Icon name="check" size={20} color={theme.colors.success} /> : <Icon name="plus" size={20} color={theme.colors.white} />}
      </Pressable>
    </View>
  );

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Close friends</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.search}>
        <Icon name="search" size={20} color={theme.colors.textMuted} />
        <FocusableTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people you follow"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
          accessibilityLabel="Search people you follow"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {!rows.some((row) => row.is_friend) && !loading ? (
        <Text style={styles.empty}>You have not added anyone yet.</Text>
      ) : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void loadRows(query.trim(), false)} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={(row) => row.id}
          onEndReached={() => {
            if (!loadingMore && (friendCursor || candidateCursor)) void loadRows(query.trim(), true);
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.primary} style={styles.footer} /> : null}
          ListEmptyComponent={query ? <Text style={styles.empty}>No people found.</Text> : null}
        />
      )}
      {error && !loading ? <Text accessibilityRole="alert" style={styles.errorInline}>{error}</Text> : null}
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
  backButton: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, minHeight: 46, borderRadius: 16, backgroundColor: theme.colors.surface },
  searchInput: { flex: 1, color: theme.colors.white, fontSize: 14, marginLeft: 8, minHeight: 44 },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  initials: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  person: { flex: 1 },
  name: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  username: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.colors.surface },
  removeAction: { backgroundColor: 'rgba(34,197,94,0.12)' },
  empty: { paddingHorizontal: 18, paddingVertical: 16, color: theme.colors.textMuted, fontSize: 14, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  error: { color: theme.colors.danger, fontSize: 14, textAlign: 'center' },
  errorInline: { padding: 12, color: theme.colors.danger, fontSize: 13 },
  retry: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  footer: { padding: 16 },
});
