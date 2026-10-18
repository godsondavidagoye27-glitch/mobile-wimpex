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
import type { BlockedProfileRpcRow } from '../types/database';

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function BlockedUsersScreen() {
  const [profiles, setProfiles] = useState<BlockedProfileRpcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await getSupabaseClient().rpc('get_blocked_users', { p_page_size: 50 });
      if (queryError) throw queryError;
      setProfiles(data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load blocked accounts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const unblock = async (profile: BlockedProfileRpcRow) => {
    if (actingId) return;
    setActingId(profile.id);
    setError('');
    try {
      const { error: unblockError } = await getSupabaseClient().rpc('unblock_user', { p_target: profile.id });
      if (unblockError) throw unblockError;
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to unblock this account.');
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
        <Text style={styles.title}>Blocked users</Text>
        <View style={styles.backButton} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={profiles.length ? styles.list : styles.emptyList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>You have not blocked anyone.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.avatar_url
                ? <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
                : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.initials}>{initials(item.display_name)}</Text></View>}
              <View style={styles.identity}>
                <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.name} />
                <Text style={styles.username}>@{item.username}</Text>
              </View>
              <Pressable
                onPress={() => void unblock(item)}
                disabled={actingId !== null}
                style={styles.unblockButton}
                accessibilityRole="button"
              >
                {actingId === item.id ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Text style={styles.unblockText}>Unblock</Text>}
              </Pressable>
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
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.colors.surface },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3557' },
  initials: { color: theme.colors.white, fontSize: 14, fontWeight: '800' },
  identity: { flex: 1, gap: 3 },
  name: { color: theme.colors.white, fontWeight: '700' },
  username: { color: theme.colors.textMuted, fontSize: 12 },
  unblockButton: { minWidth: 80, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.line, borderRadius: 11 },
  unblockText: { color: theme.colors.white, fontSize: 12, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: theme.colors.danger, padding: 16 },
});
