import { router, useFocusEffect } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';
import { getErrorMessage } from '../../lib/errorMessage';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type {
  ExploreCreatorRpcRow,
  ExploreSuggestedAccountRpcRow,
  SearchHashtagRpcRow,
} from '../../types/database';
import {
  getExploreCreators,
  getExploreHashtags,
  getExploreSuggestedAccounts,
  type ExploreCreatorCursor,
  type ExploreHashtagCursor,
  type ExploreSuggestedCursor,
} from './exploreService';

type ExploreTab = 'hashtags' | 'creators' | 'suggested';
type ExploreRow = SearchHashtagRpcRow | ExploreCreatorRpcRow | ExploreSuggestedAccountRpcRow;
type Window = '24h' | '7d';

const tabs: { key: ExploreTab; label: string }[] = [
  { key: 'hashtags', label: 'Hashtags' },
  { key: 'creators', label: 'Creators' },
  { key: 'suggested', label: 'For you' },
];

export function ExploreScreen() {
  const [activeTab, setActiveTab] = useState<ExploreTab>('hashtags');
  const [window, setWindow] = useState<Window>('24h');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const client = getSupabaseClient();

  useEffect(() => {
    let active = true;
    const { data: authSubscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setViewerId(session?.user.id ?? null);
      setSessionReady(true);
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) {
        setViewerId(data.session?.user.id ?? null);
        setSessionReady(true);
      }
    }).catch(async (caught: unknown) => {
      if (active) {
        setErrorMessage(await getErrorMessage(caught, 'Explore could not be opened.'));
        setSessionReady(true);
      }
    });
    return () => {
      active = false;
      authSubscription.subscription.unsubscribe();
    };
  }, [client]);

  const hashtags24 = useInfiniteQuery({
    queryKey: ['explore', viewerId, 'hashtags', '24h'],
    initialPageParam: null as ExploreHashtagCursor,
    queryFn: ({ pageParam, signal }) => getExploreHashtags('24h', pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
    enabled: sessionReady && activeTab === 'hashtags' && window === '24h',
    staleTime: 3 * 60 * 1000,
  });
  const hashtags7d = useInfiniteQuery({
    queryKey: ['explore', viewerId, 'hashtags', '7d'],
    initialPageParam: null as ExploreHashtagCursor,
    queryFn: ({ pageParam, signal }) => getExploreHashtags('7d', pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
    enabled: sessionReady && activeTab === 'hashtags' && window === '7d',
    staleTime: 3 * 60 * 1000,
  });
  const creators24 = useInfiniteQuery({
    queryKey: ['explore', viewerId, 'creators', '24h'],
    initialPageParam: null as ExploreCreatorCursor,
    queryFn: ({ pageParam, signal }) => getExploreCreators('24h', pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
    enabled: sessionReady && activeTab === 'creators' && window === '24h',
    staleTime: 3 * 60 * 1000,
  });
  const creators7d = useInfiniteQuery({
    queryKey: ['explore', viewerId, 'creators', '7d'],
    initialPageParam: null as ExploreCreatorCursor,
    queryFn: ({ pageParam, signal }) => getExploreCreators('7d', pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
    enabled: sessionReady && activeTab === 'creators' && window === '7d',
    staleTime: 3 * 60 * 1000,
  });
  const suggested = useInfiniteQuery({
    queryKey: ['explore', viewerId, 'suggested'],
    initialPageParam: null as ExploreSuggestedCursor,
    queryFn: ({ pageParam, signal }) => getExploreSuggestedAccounts(pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
    enabled: sessionReady && activeTab === 'suggested',
    staleTime: 3 * 60 * 1000,
  });

  const currentQuery = activeTab === 'hashtags'
    ? (window === '24h' ? hashtags24 : hashtags7d)
    : activeTab === 'creators'
      ? (window === '24h' ? creators24 : creators7d)
      : suggested;
  const rows: ExploreRow[] = useMemo(() => {
    if (activeTab === 'hashtags') {
      return (window === '24h' ? hashtags24.data : hashtags7d.data)?.pages.flatMap((page) => page.rows) ?? [];
    }
    if (activeTab === 'creators') {
      return (window === '24h' ? creators24.data : creators7d.data)?.pages.flatMap((page) => page.rows) ?? [];
    }
    return suggested.data?.pages.flatMap((page) => page.rows) ?? [];
  }, [activeTab, creators24.data, creators7d.data, hashtags24.data, hashtags7d.data, suggested.data, window]);

  useEffect(() => {
    let active = true;
    if (!currentQuery.isError) {
      setErrorMessage('');
      return () => {
        active = false;
      };
    }
    void getErrorMessage(currentQuery.error, 'Explore could not be loaded.').then((message) => {
      if (active) setErrorMessage(message);
    });
    return () => {
      active = false;
    };
  }, [currentQuery.error, currentQuery.isError]);

  useFocusEffect(
    useCallback(() => {
      if (currentQuery.isStale && !currentQuery.isFetching) void currentQuery.refetch();
    }, [currentQuery.isFetching, currentQuery.isStale, currentQuery.refetch]),
  );

  const renderRow = ({ item }: { item: ExploreRow }) => {
    if ('tag' in item) {
      return (
        <Pressable
          onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: item.tag } })}
          style={styles.hashtagRow}
          accessibilityRole="button"
          accessibilityLabel={`Open hashtag ${item.tag}, ${item.post_count} posts`}
        >
          <View style={styles.hashtagIcon}><Text style={styles.hashtagIconText}>#</Text></View>
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={styles.rowTitle}>#{item.tag}</Text>
            <Text style={styles.rowDetail}>{item.post_count} {item.post_count === 1 ? 'post' : 'posts'} in {window === '24h' ? '24 hours' : '7 days'}</Text>
          </View>
          <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
        </Pressable>
      );
    }

    const suggestion = 'mutual_follows' in item;
    const detail = suggestion
      ? item.mutual_follows
        ? `${item.mutual_follows} mutual ${item.mutual_follows === 1 ? 'follow' : 'follows'}`
        : `${item.shared_interests} shared ${item.shared_interests === 1 ? 'interest' : 'interests'}`
      : `${item.popularity_score} recent likes and views · ${item.published_post_count} posts`;

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/user/[username]', params: { username: item.username } })}
        style={styles.personRow}
        accessibilityRole="button"
        accessibilityLabel={`View ${item.display_name}'s profile`}
      >
        <View style={styles.avatar}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Icon name="user" size={20} color={theme.colors.textMuted} />
          )}
        </View>
        <View style={styles.rowText}>
          <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.rowTitle} />
          <Text numberOfLines={1} style={styles.rowDetail}>@{item.username} · {detail}</Text>
        </View>
        <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
      </Pressable>
    );
  };

  const emptyText = activeTab === 'suggested'
    ? 'Follow some accounts and add profile interests to get personalized suggestions.'
    : activeTab === 'creators'
      ? 'There is not enough public creator activity yet. Check back soon.'
      : 'No public hashtags are trending in this period yet.';

  if (!sessionReady || (!viewerId && !errorMessage)) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>;
  }

  if (!viewerId) {
    return (
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          {errorMessage || 'Sign in to explore accounts and hashtags.'}
        </Text>
        <Pressable onPress={() => router.replace('/(auth)/welcome')} style={styles.retryButton}>
          <Text style={styles.retryText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SectionErrorBoundary title="Explore needs to restart">
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Explore</Text>
          <Pressable
            onPress={() => router.push('/search')}
            style={styles.searchButton}
            accessibilityRole="button"
            accessibilityLabel="Search Wimpex"
          >
            <Icon name="search" size={20} color={theme.colors.white} />
          </Pressable>
        </View>
        <View style={styles.tabs}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={{ selected: activeTab === tab.key }}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextSelected]}>{tab.label}</Text>
              {activeTab === tab.key ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          ))}
        </View>
        {activeTab !== 'suggested' ? (
          <View style={styles.windowRow}>
            {(['24h', '7d'] as const).map((period) => (
              <Pressable
                key={period}
                onPress={() => setWindow(period)}
                style={[styles.windowButton, window === period && styles.windowButtonSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: window === period }}
              >
                <Text style={[styles.windowText, window === period && styles.windowTextSelected]}>
                  {period === '24h' ? 'Last 24 hours' : 'Last 7 days'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <FlatList
          data={rows}
          keyExtractor={(item) => 'tag' in item ? `tag:${item.tag}` : item.id}
          renderItem={renderRow}
          contentContainerStyle={[styles.list, !rows.length && styles.emptyList]}
          refreshControl={<RefreshControl refreshing={currentQuery.isRefetching} onRefresh={() => void currentQuery.refetch()} tintColor={theme.colors.primary} />}
          onEndReached={() => {
            if (currentQuery.hasNextPage && !currentQuery.isFetchingNextPage) void currentQuery.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={currentQuery.isPending
            ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
            : currentQuery.isError
              ? (
                <View style={styles.emptyState}>
                  <Text style={styles.errorText}>{errorMessage || 'Explore could not be loaded.'}</Text>
                  <Pressable onPress={() => void currentQuery.refetch()} style={styles.retryButton}>
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              )
              : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>You are all caught up</Text>
                  <Text style={styles.emptyText}>{emptyText}</Text>
                  <Pressable onPress={() => router.push('/search')} style={styles.retryButton}>
                    <Text style={styles.retryText}>Search accounts and hashtags</Text>
                  </Pressable>
                </View>
              )}
          ListFooterComponent={currentQuery.isFetchingNextPage
            ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
            : null}
        />
      </View>
    </SectionErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  header: { minHeight: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: theme.colors.white, fontSize: 24, fontWeight: '800' },
  searchButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.colors.surface },
  tabs: { height: 48, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7 },
  tabText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextSelected: { color: theme.colors.primary },
  tabUnderline: { position: 'absolute', bottom: -1, width: '52%', height: 2, backgroundColor: theme.colors.primary },
  windowRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  windowButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.line },
  windowButtonSelected: { borderColor: theme.colors.primary, backgroundColor: 'rgba(214,178,94,0.12)' },
  windowText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  windowTextSelected: { color: theme.colors.primary },
  list: { paddingHorizontal: 16, paddingBottom: 28 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  hashtagRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  hashtagIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.colors.surface },
  hashtagIconText: { color: theme.colors.primary, fontSize: 23, fontWeight: '800' },
  personRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: theme.colors.surface },
  avatarImage: { width: '100%', height: '100%' },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  rowDetail: { color: theme.colors.textMuted, fontSize: 11 },
  loader: { marginVertical: 20 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, gap: 12 },
  emptyTitle: { color: theme.colors.white, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  errorText: { color: theme.colors.danger, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  retryText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
