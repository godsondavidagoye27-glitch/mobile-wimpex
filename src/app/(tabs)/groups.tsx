import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { CommunityCategory, CommunityListRpcRow, CommunityRow } from '../../types/database';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';

const categories: (CommunityCategory | 'All')[] = [
  'All', 'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art',
  'Tech', 'Fashion', 'Learning', 'Health', 'Comedy', 'Other',
];
const pageSize = 20;
type CommunityCursor = { rank: number; members: number; id: string };

function getCursor(row: CommunityRow): CommunityCursor {
  return { rank: row.interest_match, members: row.member_count, id: row.id };
}

function iconUrl(path: string | null) {
  return path ? getSupabaseClient().storage.from('community-icons').getPublicUrl(path).data.publicUrl : null;
}

function communityInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function GroupsScreen() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CommunityCategory | null>(null);
  const [yourCommunities, setYourCommunities] = useState<CommunityListRpcRow[]>([]);
  const [suggested, setSuggested] = useState<CommunityRow[]>([]);
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [cursor, setCursor] = useState<CommunityCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const visibleRows = useMemo(() => (
    input.trim() === query ? rows : []
  ), [input, query, rows]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const loadDiscovery = useCallback(async (
    nextCursor: CommunityCursor | null,
    append: boolean,
    signal: AbortSignal,
  ) => {
    const { data, error: rpcError } = await getSupabaseClient().rpc('discover_communities', {
      p_category: category,
      p_query: query,
      p_cursor_rank: nextCursor?.rank ?? null,
      p_cursor_members: nextCursor?.members ?? null,
      p_cursor_id: nextCursor?.id ?? null,
      p_page_size: pageSize,
    }).abortSignal(signal);
    if (rpcError) throw rpcError;
    if (signal.aborted) return;
    const page = data ?? [];
    setRows((previous) => append
      ? [...previous, ...page.filter((item) => !previous.some((old) => old.id === item.id))]
      : page);
    const last = page.at(-1);
    setCursor(last ? getCursor(last) : null);
    setHasMore(page.length === pageSize);
  }, [category, query]);

  const loadSections = useCallback(async (signal: AbortSignal) => {
    const [mine, suggestions] = await Promise.all([
      getSupabaseClient().rpc('my_communities').abortSignal(signal),
      getSupabaseClient().rpc('suggested_communities').abortSignal(signal),
    ]);
    if (mine.error) throw mine.error;
    if (suggestions.error) throw suggestions.error;
    if (!signal.aborted) {
      setYourCommunities(mine.data ?? []);
      setSuggested(suggestions.data ?? []);
    }
  }, []);

  const refresh = useCallback((isPull = false) => {
    setRefreshing(isPull);
    setRetryToken((value) => value + 1);
  }, []);

  useEffect(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => {
      setRows([]);
      setCursor(null);
      setHasMore(false);
      setError('');
      setLoading(true);
      void Promise.all([
        loadSections(controller.signal),
        loadDiscovery(null, false, controller.signal),
      ]).catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Communities could not be loaded.');
        }
      }).finally(() => {
        if (request.current === controller) {
          request.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [category, loadDiscovery, loadSections, retryToken]);

  const changeMembership = async (community: CommunityRow | CommunityListRpcRow, action: 'join' | 'invite') => {
    if (actionBusy) return;
    setActionBusy(community.id);
    try {
      if (action === 'invite') {
        const { error: inviteError } = await getSupabaseClient().rpc('respond_invite', {
          p_community_id: community.id,
          p_accept: true,
        });
        if (inviteError) throw inviteError;
      } else {
        const { error: joinError } = await getSupabaseClient().rpc('join_community', {
          p_community_id: community.id,
        });
        if (joinError) throw joinError;
      }
      await refresh(true);
    } catch (caught) {
      Alert.alert('Could not update membership', caught instanceof Error ? caught.message : 'Try again.');
    } finally {
      setActionBusy(null);
    }
  };

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore || !cursor || input.trim() !== query) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      await loadDiscovery(cursor, true, controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'More communities could not be loaded.');
      }
    } finally {
      if (request.current === controller) request.current = null;
      setLoadingMore(false);
    }
  };

  const openCommunity = (slug: string) => router.push({ pathname: '/community/[slug]', params: { slug } });

  const renderCommunity = (community: CommunityRow | CommunityListRpcRow, compact = false) => {
    const isMember = community.status === 'active';
    const isPending = community.status === 'pending';
    const isInvited = community.status === 'invited';
    const isBusy = actionBusy === community.id;
    const avatarUrl = iconUrl(community.icon_path);
    const action = isInvited ? 'Accept invite' : isPending ? 'Requested' : isMember ? 'Joined'
      : community.visibility === 'private' ? 'Request to join' : 'Join';
    return (
      <View key={community.id} style={[styles.communityCard, compact && styles.compactCard]}>
        <Pressable
          onPress={() => openCommunity(community.slug)}
          style={styles.communityInfo}
          accessibilityRole="button"
          accessibilityLabel={`Open ${community.name}`}
        >
          <View style={styles.iconWrap}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.communityIcon} />
              : <Text style={styles.initials}>{communityInitials(community.name)}</Text>}
          </View>
          <View style={styles.communityBody}>
            <View style={styles.nameLine}>
              <Text numberOfLines={1} style={styles.communityName}>{community.name}</Text>
              {community.visibility === 'private' ? <Icon name="lock" size={20} color={theme.colors.textMuted} /> : null}
            </View>
            <Text style={styles.meta}>{community.member_count.toLocaleString()} members</Text>
            {!compact ? <Text numberOfLines={1} style={styles.description}>{community.description || 'Community'}</Text> : null}
          </View>
        </Pressable>
        {!compact ? (
          <Pressable
            onPress={() => {
              if (isMember) openCommunity(community.slug);
              else if (!isPending) void changeMembership(community, isInvited ? 'invite' : 'join');
            }}
            disabled={isPending || isBusy}
            style={[styles.joinButton, (isMember || isPending) && styles.joinedButton]}
            accessibilityRole="button"
            accessibilityLabel={`${action} ${community.name}`}
          >
            {isBusy
              ? <ActivityIndicator size="small" color={theme.colors.primary} />
              : <Text style={[styles.joinText, (isMember || isPending) && styles.joinedText]}>{action}</Text>}
          </Pressable>
        ) : null}
      </View>
    );
  };

  const listHeader = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>Communities</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/search')}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Icon name="search" size={20} color={theme.colors.white} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/create-community')}
            style={[styles.iconButton, styles.createButton]}
            accessibilityRole="button"
            accessibilityLabel="Create community"
          >
            <Icon name="plus" size={20} color={theme.colors.black} />
          </Pressable>
        </View>
      </View>
      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={theme.colors.textMuted} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search communities"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search communities"
        />
        {input ? (
          <Pressable onPress={() => setInput('')} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.categoryList}
        renderItem={({ item }) => {
          const active = item === 'All' ? category === null : category === item;
          return (
            <Pressable
              onPress={() => setCategory(item === 'All' ? null : item)}
              style={[styles.categoryChip, active && styles.categoryChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{item}</Text>
            </Pressable>
          );
        }}
      />
      {yourCommunities.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your communities</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={yourCommunities}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.yourCommunityList}
            renderItem={({ item }) => (
              <Pressable onPress={() => openCommunity(item.slug)} style={styles.yourCommunity}>
                <View style={styles.yourIcon}>
                  {iconUrl(item.icon_path)
                    ? <Image source={{ uri: iconUrl(item.icon_path) ?? '' }} style={styles.yourImage} />
                    : <Text style={styles.yourInitials}>{communityInitials(item.name)}</Text>}
                </View>
                <Text numberOfLines={1} style={styles.yourName}>{item.name}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      {suggested.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suggested for you</Text>
          {suggested.slice(0, 5).map((item) => renderCommunity(item, true))}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{query ? 'Search results' : 'Discover communities'}</Text>
      </View>
      {loading || (input.trim() !== query && input.trim().length > 0) ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Communities could not be loaded. Check your connection and try again.</Text>
          <Pressable onPress={() => setRetryToken((value) => value + 1)} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <FlatList
        data={loading || (input.trim() !== query && input.trim().length > 0) ? [] : visibleRows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderCommunity(item)}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={!loading && !error && input.trim() === query
          ? <Text style={styles.emptyText}>{query ? 'No communities found.' : 'No communities yet. Create the first one.'}</Text>
          : null}
        ListFooterComponent={loadingMore
          ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
          : error && rows.length > 0
            ? <Pressable onPress={() => void loadMore()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
            : null}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} tintColor={theme.colors.primary} />}
      />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  list: { paddingHorizontal: 18, paddingBottom: 90 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: { color: theme.colors.white, fontSize: 28, fontWeight: '800' },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  createButton: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  searchRow: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#171C22',
    borderWidth: 1,
    borderColor: theme.colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: { flex: 1, color: theme.colors.white, fontSize: 15, paddingVertical: 0 },
  categoryList: { gap: 8, paddingVertical: 14 },
  categoryChip: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#171C22',
  },
  categoryChipActive: { backgroundColor: '#142A38', borderColor: theme.colors.primary },
  categoryText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  categoryTextActive: { color: theme.colors.primary },
  section: { marginTop: 12, marginBottom: 8 },
  sectionTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '700', marginBottom: 10 },
  yourCommunityList: { gap: 14, paddingBottom: 8 },
  yourCommunity: { width: 76, alignItems: 'center', gap: 6 },
  yourIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#16232A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  yourImage: { width: 60, height: 60 },
  yourInitials: { color: theme.colors.primary, fontSize: 18, fontWeight: '800' },
  yourName: { width: 76, color: theme.colors.textMuted, fontSize: 11, textAlign: 'center' },
  communityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  compactCard: { paddingVertical: 8, borderBottomWidth: 0 },
  communityInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#16232A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  communityIcon: { width: 52, height: 52 },
  initials: { color: theme.colors.primary, fontSize: 17, fontWeight: '800' },
  communityBody: { flex: 1, paddingRight: 8 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  communityName: { color: theme.colors.white, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  meta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  description: { color: theme.colors.textMuted, fontSize: 13, marginTop: 3 },
  joinButton: {
    backgroundColor: '#142A38',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 72,
    alignItems: 'center',
  },
  joinedButton: { backgroundColor: 'rgba(34,197,94,0.12)' },
  joinText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  joinedText: { color: theme.colors.success },
  loader: { paddingVertical: 24 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', paddingTop: 36 },
  errorBox: { marginTop: 12, alignItems: 'center' },
  errorText: { color: theme.colors.textMuted, textAlign: 'center', lineHeight: 21 },
  retryButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 10,
    borderRadius: 20,
    backgroundColor: '#142A38',
    alignSelf: 'center',
  },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
});
