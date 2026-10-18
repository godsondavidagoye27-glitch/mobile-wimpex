import { getErrorMessage } from '../../lib/errorMessage';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { FocusableTextInput } from '../../components/AuthField';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { ProfileListRpcRow } from '../../types/database';
import { followActionForStatus, followStatusAfterAction } from './followState';

type FollowListKind = 'followers' | 'following';
type FollowListResult = { key: string; rows: ProfileListRpcRow[]; cursor: ProfileListRpcRow | null; error: string };

export function FollowListSheet({
  visible,
  profileId,
  kind,
  onClose,
  onFollowChanged,
}: {
  visible: boolean;
  profileId: string;
  kind: FollowListKind;
  onClose: () => void;
  onFollowChanged: () => Promise<void>;
}) {
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [result, setResult] = useState<FollowListResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  const key = `${profileId}:${kind}:${debouncedSearch.trim().toLowerCase()}`;
  const currentResult = result?.key === key ? result : null;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!visible) return undefined;
    const id = ++requestId.current;
    void (async () => {
      try {
        const { data, error } = await getSupabaseClient().rpc('get_follow_list', {
          p_user_id: profileId,
          p_kind: kind,
          p_query: debouncedSearch.trim(),
          p_page_size: 30,
        });
        if (error) throw error;
        if (id !== requestId.current) return;
        const rows = data ?? [];
        setResult({ key, rows, cursor: rows.length === 30 ? rows[rows.length - 1] : null, error: '' });
      } catch (caught) {
        if (id !== requestId.current) return;
        setResult({
          key,
          rows: [],
          cursor: null,
          error: await getErrorMessage(caught, 'Unable to load this list.'),
        });
      }
    })();
    return () => {
      requestId.current += 1;
    };
  }, [debouncedSearch, key, kind, profileId, visible]);

  const loadMore = async () => {
    if (!currentResult?.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data, error } = await getSupabaseClient().rpc('get_follow_list', {
        p_user_id: profileId,
        p_kind: kind,
        p_query: debouncedSearch.trim(),
        p_cursor_created_at: currentResult.cursor.followed_at,
        p_cursor_user_id: currentResult.cursor.id,
        p_page_size: 30,
      });
      if (error) throw error;
      setResult((current) => {
        if (current?.key !== key) return current;
        const nextRows = data ?? [];
        return {
          ...current,
          rows: [...current.rows, ...nextRows.filter((row) => !current.rows.some((existing) => existing.id === row.id))],
          cursor: nextRows.length === 30 ? nextRows[nextRows.length - 1] : null,
        };
      });
    } catch (caught) {
      const message = await getErrorMessage(caught, 'Unable to load more accounts.');
      setResult((current) => current?.key === key
        ? { ...current, error: message }
        : current);
    } finally {
      setLoadingMore(false);
    }
  };

  const changeFollow = async (row: ProfileListRpcRow) => {
    const action = followActionForStatus(row.follow_status);
    try {
      let serverStatus: ProfileListRpcRow['follow_status'] = 'none';
      if (action === 'follow') {
        const { data, error } = await getSupabaseClient().rpc('follow_user', { p_target: row.id });
        if (error) throw error;
        serverStatus = data === 'pending' ? 'pending' : 'accepted';
      } else if (action === 'unfollow') {
        const { error } = await getSupabaseClient().rpc('unfollow_user', { p_target: row.id });
        if (error) throw error;
      } else {
        const { error } = await getSupabaseClient().rpc('cancel_follow_request', { p_target: row.id });
        if (error) throw error;
      }
      const nextStatus = followStatusAfterAction(action, serverStatus);
      setResult((current) => current?.key === key
        ? {
          ...current,
          rows: current.rows.map((item) => item.id === row.id
            ? { ...item, follow_status: nextStatus, is_following: nextStatus === 'accepted' }
            : item),
        }
        : current);
      await onFollowChanged();
    } catch (caught) {
      const message = await getErrorMessage(caught, 'Unable to update this follow.');
      setResult((current) => current?.key === key
        ? { ...current, error: message }
        : current);
    }
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAwareScreen style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.heading}>
            <Text style={styles.title}>{kind === 'followers' ? 'Followers' : 'Following'}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={20} color={theme.colors.textMuted} />
            </Pressable>
          </View>
          <FocusableTextInput
            value={searchText}
            onChangeText={setSearchText}
            style={styles.search}
            placeholder="Search"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel={`Search ${kind}`}
          />
          {currentResult?.error ? <Text accessibilityRole="alert" style={styles.error}>{currentResult.error}</Text> : null}
          {!currentResult ? (
            <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
          ) : (
            <FlatList
              data={currentResult.rows}
              keyExtractor={(row) => row.id}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={<Text style={styles.empty}>No accounts found.</Text>}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.primary} /> : null}
              renderItem={({ item }) => (
                <View style={styles.row}>
                <Pressable
                  style={styles.identity}
                  onPress={() => {
                    onClose();
                    router.push({ pathname: '/user/[username]', params: { username: item.username } });
                  }}
                  accessibilityRole="button"
                >
                  {item.avatar_url
                    ? <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
                    : <View style={[styles.avatar, styles.fallback]}><Text style={styles.initials}>{item.display_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'}</Text></View>}
                  <View style={styles.nameWrap}>
                    <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.name} />
                    <Text style={styles.username}>@{item.username}</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[styles.followButton, item.follow_status !== 'none' && styles.followingButton]}
                  onPress={() => void changeFollow(item)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.followText, item.follow_status !== 'none' && styles.followingText]}>
                    {item.follow_status === 'pending' ? 'Requested' : item.follow_status === 'accepted' ? 'Following' : 'Follow'}
                  </Text>
                </Pressable>
                </View>
              )}
            />
          )}
        </View>
      </KeyboardAwareScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '76%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.colors.black, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 18 },
  heading: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '800' },
  search: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.surface, color: theme.colors.white, paddingHorizontal: 12, marginVertical: 12 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3557' },
  initials: { color: theme.colors.white, fontSize: 13, fontWeight: '800' },
  nameWrap: { flex: 1, gap: 3 },
  name: { color: theme.colors.white, fontWeight: '700' },
  username: { color: theme.colors.textMuted, fontSize: 12 },
  followButton: { minWidth: 88, paddingHorizontal: 10, height: 36, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  followingButton: { backgroundColor: theme.colors.surface },
  followText: { color: theme.colors.black, fontSize: 12, fontWeight: '800' },
  followingText: { color: theme.colors.white },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: 26 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: theme.colors.danger, marginBottom: 8 },
});
