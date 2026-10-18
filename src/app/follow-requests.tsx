import { getErrorMessage } from '../lib/errorMessage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { NameWithBadge } from '../components/NameWithBadge';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import type { FollowRequestRpcRow } from '../types/database';

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function FollowRequestsScreen() {
  const [requests, setRequests] = useState<FollowRequestRpcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadRequests = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await getSupabaseClient().rpc('get_follow_requests', { p_page_size: 50 });
      if (queryError) throw queryError;
      setRequests(data ?? []);
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to load follow requests.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadRequests();
  }, [loadRequests]));

  const respond = async (request: FollowRequestRpcRow, accept: boolean) => {
    if (actingId) return;
    setActingId(request.id);
    setError('');
    try {
      const { error: responseError } = await getSupabaseClient().rpc('respond_follow_request', {
        p_follower: request.id,
        p_accept: accept,
      });
      if (responseError) throw responseError;
      setRequests((current) => current.filter((item) => item.id !== request.id));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to update this follow request.'));
    } finally {
      setActingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Follow requests</Text>
        <View style={styles.backButton} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={requests.length ? styles.list : styles.emptyList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadRequests(true)} tintColor={theme.colors.primary} />
          }
          ListEmptyComponent={<Text style={styles.empty}>No follow requests.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.identity}
                onPress={() => router.push({ pathname: '/user/[username]', params: { username: item.username } })}
                accessibilityRole="button"
              >
                {item.avatar_url
                  ? <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
                  : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.initials}>{initials(item.display_name)}</Text></View>}
                <View style={styles.identityText}>
                  <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.name} />
                  <Text style={styles.username}>@{item.username}</Text>
                </View>
              </Pressable>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => void respond(item, true)}
                  disabled={actingId !== null}
                  style={styles.acceptButton}
                  accessibilityRole="button"
                >
                  {actingId === item.id ? <ActivityIndicator size="small" color={theme.colors.black} /> : <Text style={styles.acceptText}>Accept</Text>}
                </Pressable>
                <Pressable
                  onPress={() => void respond(item, false)}
                  disabled={actingId !== null}
                  style={styles.declineButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  backButton: { width: 42, height: 42, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 19, fontWeight: '800' },
  list: { padding: 16, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { color: theme.colors.textMuted, fontSize: 15, textAlign: 'center' },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.colors.surface },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3557' },
  initials: { color: theme.colors.white, fontSize: 14, fontWeight: '800' },
  identityText: { flex: 1, gap: 3 },
  name: { color: theme.colors.white, fontWeight: '700' },
  username: { color: theme.colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 6 },
  acceptButton: { minWidth: 66, minHeight: 36, paddingHorizontal: 10, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  acceptText: { color: theme.colors.black, fontSize: 12, fontWeight: '800' },
  declineButton: { minWidth: 66, minHeight: 36, paddingHorizontal: 10, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.line },
  declineText: { color: theme.colors.white, fontSize: 12, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: theme.colors.danger, padding: 16 },
});
