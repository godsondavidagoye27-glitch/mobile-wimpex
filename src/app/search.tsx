import { getErrorMessage } from '../lib/errorMessage';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { NameWithBadge } from '../components/NameWithBadge';
import { FocusableTextInput } from '../components/AuthField';
import { getSignedUrls } from '../features/feed/useFeed';
import { addRecentSearch, removeRecentSearch } from '../features/search/recentSearches';
import {
  clearRecentSearches,
  loadRecentSearches,
  saveRecentSearches,
} from '../features/search/recentSearchStorage';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
import type {
  CommunityRow,
  FeedRpcRow,
  SearchHashtagRpcRow,
  SearchPersonRpcRow,
  SuggestedPersonRpcRow,
} from '../types/database';

type SearchTab = 'People' | 'Videos' | 'Hashtags' | 'Communities';
type SearchRow = SearchPersonRpcRow | FeedRpcRow | SearchHashtagRpcRow | CommunityRow;
type SearchCursor =
  | { kind: 'people'; username: string; id: string }
  | { kind: 'videos'; publishedAt: string; id: string }
  | { kind: 'hashtags'; postCount: number; tag: string }
  | { kind: 'communities'; rank: number; members: number; id: string };
type VideoResult = FeedRpcRow & { thumbnailUrl: string | null };
type SearchPage = {
  key: string;
  rows: SearchRow[];
  cursor: SearchCursor | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
};

const searchTabs: SearchTab[] = ['People', 'Videos', 'Hashtags', 'Communities'];
const pageSize = 20;
const emptyPage = (key: string, loading = false): SearchPage => ({
  key,
  rows: [],
  cursor: null,
  hasMore: false,
  loading,
  loadingMore: false,
  error: '',
});

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function cursorAfter(tab: SearchTab, row: SearchRow): SearchCursor | null {
  if (tab === 'People' && 'username' in row) {
    return { kind: 'people', username: row.username, id: row.id };
  }
  if (tab === 'Videos' && 'post' in row && row.post.published_at) {
    return { kind: 'videos', publishedAt: row.post.published_at, id: row.post.id };
  }
  if (tab === 'Hashtags' && 'tag' in row) {
    return { kind: 'hashtags', postCount: row.post_count, tag: row.tag };
  }
  if (tab === 'Communities' && 'interest_match' in row) {
    return { kind: 'communities', rank: row.interest_match, members: row.member_count, id: row.id };
  }
  return null;
}

async function loadSearchRows(
  tab: SearchTab,
  query: string,
  cursor: SearchCursor | null,
  signal: AbortSignal,
): Promise<SearchRow[]> {
  const client = getSupabaseClient();
  if (tab === 'People') {
    const peopleCursor = cursor?.kind === 'people' ? cursor : null;
    const { data, error } = await client.rpc('search_people', {
      p_query: query,
      p_cursor_username: peopleCursor?.username ?? null,
      p_cursor_id: peopleCursor?.id ?? null,
      p_page_size: pageSize,
    }).abortSignal(signal);
    if (error) throw error;
    return data;
  }
  if (tab === 'Videos') {
    const videoCursor = cursor?.kind === 'videos' ? cursor : null;
    const { data, error } = await client.rpc('search_videos', {
      p_query: query,
      p_cursor_published_at: videoCursor?.publishedAt ?? null,
      p_cursor_id: videoCursor?.id ?? null,
      p_page_size: pageSize,
    }).abortSignal(signal);
    if (error) throw error;

    const paths = data.flatMap(({ post }) => post.thumb_path ? [post.thumb_path] : []);
    const thumbnails = await getSignedUrls('thumbnails', paths);
    if (signal.aborted) return [];
    return data.map((row): VideoResult => ({
      ...row,
      thumbnailUrl: row.post.thumb_path ? thumbnails.get(row.post.thumb_path) ?? null : null,
    }));
  }
  if (tab === 'Hashtags') {
    const hashtagCursor = cursor?.kind === 'hashtags' ? cursor : null;
    const { data, error } = await client.rpc('search_hashtags', {
      p_query: query,
      p_cursor_post_count: hashtagCursor?.postCount ?? null,
      p_cursor_tag: hashtagCursor?.tag ?? null,
      p_page_size: pageSize,
    }).abortSignal(signal);
    if (error) throw error;
    return data;
  }
  if (tab === 'Communities') {
    const communityCursor = cursor?.kind === 'communities' ? cursor : null;
    const { data, error } = await client.rpc('discover_communities', {
      p_query: query,
      p_cursor_rank: communityCursor?.rank ?? null,
      p_cursor_members: communityCursor?.members ?? null,
      p_cursor_id: communityCursor?.id ?? null,
      p_page_size: pageSize,
    }).abortSignal(signal);
    if (error) throw error;
    return data;
  }
  return [];
}

export default function SearchScreen() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('People');
  const [result, setResult] = useState<SearchPage>(() => emptyPage(''));
  const [retryToken, setRetryToken] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [trending, setTrending] = useState<SearchHashtagRpcRow[]>([]);
  const [suggested, setSuggested] = useState<SuggestedPersonRpcRow[]>([]);
  const [discoverError, setDiscoverError] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [suggestedFollowStatus, setSuggestedFollowStatus] = useState<Record<string, 'pending' | 'accepted'>>({});
  const [followingBusy, setFollowingBusy] = useState<Set<string>>(() => new Set());
  const [followedResults, setFollowedResults] = useState<Record<string, 'pending' | 'accepted'>>({});
  const [communityStatuses, setCommunityStatuses] = useState<Record<string, CommunityRow['status']>>({});
  const [communityBusy, setCommunityBusy] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const inFlightRequests = useRef(new Map<SearchTab, AbortController>());
  const loadingMore = useRef(false);
  const recentSearchesRef = useRef(recentSearches);
  const resultKey = `${activeTab}:${query}`;
  const shownResult = result.key === resultKey ? result : emptyPage(resultKey);
  const hasInput = input.trim().length > 0;

  useEffect(() => {
    recentSearchesRef.current = recentSearches;
  }, [recentSearches]);

  useEffect(() => {
    inFlightRequests.current.get(activeTab)?.abort();
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [activeTab, input]);

  const refreshDiscoverContent = useCallback(async () => {
    setDiscoverLoading(true);
    setDiscoverError('');
    const [trendingResult, suggestedResult] = await Promise.allSettled([
      getSupabaseClient().rpc('trending_hashtags'),
      getSupabaseClient().rpc('suggested_people'),
    ]);
    const errors: string[] = [];
    if (trendingResult.status === 'fulfilled' && !trendingResult.value.error) {
      setTrending(trendingResult.value.data);
    } else {
      errors.push(
        trendingResult.status === 'rejected'
          ? (await getErrorMessage(trendingResult.reason, 'Trending tags could not be loaded.'))
          : trendingResult.value.error?.message ?? 'Trending hashtags could not be loaded.',
      );
    }
    if (suggestedResult.status === 'fulfilled' && !suggestedResult.value.error) {
      setSuggested(suggestedResult.value.data);
    } else {
      errors.push(
        suggestedResult.status === 'rejected'
          ? (await getErrorMessage(suggestedResult.reason, 'Suggested people could not be loaded.'))
          : suggestedResult.value.error?.message ?? 'Suggested people could not be loaded.',
      );
    }
    setDiscoverError(errors.join(' '));
    setDiscoverLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadRecentSearches().then((searches) => {
      if (mounted) {
        recentSearchesRef.current = searches;
        setRecentSearches(searches);
        setHistoryError('');
      }
    }).catch(async (error: unknown) => {
      if (mounted) setHistoryError(await getErrorMessage(error, 'Recent searches could not be read.'));
    });
    const refreshTimer = setTimeout(() => void refreshDiscoverContent(), 0);
    return () => {
      mounted = false;
      clearTimeout(refreshTimer);
    };
  }, [refreshDiscoverContent]);

  useEffect(() => {
    const requests = inFlightRequests.current;
    requests.get(activeTab)?.abort();
    const controller = new AbortController();
    requests.set(activeTab, controller);
    const key = resultKey;

    if (activeTab === 'Communities' || query.length < 2) {
      const resetTimer = setTimeout(() => setResult(emptyPage(key)), 0);
      return () => {
        clearTimeout(resetTimer);
        controller.abort();
        if (requests.get(activeTab) === controller) {
          requests.delete(activeTab);
        }
      };
    }

    const loadingTimer = setTimeout(() => setResult(emptyPage(key, true)), 0);
    void loadSearchRows(activeTab, query, null, controller.signal).then(async (rows) => {
      if (controller.signal.aborted) return;
      const lastRow = rows.at(-1);
      setResult({
        key,
        rows,
        cursor: lastRow ? cursorAfter(activeTab, lastRow) : null,
        hasMore: rows.length === pageSize,
        loading: false,
        loadingMore: false,
        error: '',
      });
      const nextRecent = addRecentSearch(recentSearchesRef.current, query);
      recentSearchesRef.current = nextRecent;
      setRecentSearches(nextRecent);
      setHistoryError('');
      try {
        await saveRecentSearches(nextRecent);
      } catch (error) {
        if (!controller.signal.aborted) {
          setHistoryError(await getErrorMessage(error, 'Recent searches could not be saved.'));
        }
      }
    }).catch(async (error: unknown) => {
      if (!controller.signal.aborted) {
        setResult({
          ...emptyPage(key),
          error: await getErrorMessage(error, 'Search failed.'),
        });
      }
    });

    return () => {
      clearTimeout(loadingTimer);
      controller.abort();
      const request = requests.get(activeTab);
      request?.abort();
      if (request === controller) requests.delete(activeTab);
    };
  }, [activeTab, query, resultKey, retryToken]);

  const updateRecentSearches = async (searches: string[]) => {
    recentSearchesRef.current = searches;
    setRecentSearches(searches);
    setHistoryError('');
    try {
      await saveRecentSearches(searches);
    } catch (error) {
      setHistoryError(await getErrorMessage(error, 'Recent searches could not be saved.'));
    }
  };

  const loadNextPage = async () => {
    if (loadingMore.current || !shownResult.hasMore || !shownResult.cursor || shownResult.loading) return;
    loadingMore.current = true;
    const controller = new AbortController();
    inFlightRequests.current.get(activeTab)?.abort();
    inFlightRequests.current.set(activeTab, controller);
    const key = shownResult.key;
    setResult((current) => current.key === key ? { ...current, loadingMore: true } : current);
    try {
      const rows = await loadSearchRows(activeTab, query, shownResult.cursor, controller.signal);
      if (controller.signal.aborted) return;
      setResult((current) => {
        if (current.key !== key) return current;
        const combined = [...current.rows, ...rows];
        const lastRow = combined.at(-1);
        return {
          ...current,
          rows: combined,
          cursor: lastRow ? cursorAfter(activeTab, lastRow) : null,
          hasMore: rows.length === pageSize,
          loadingMore: false,
        };
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = await getErrorMessage(error, 'Search failed.');
        setResult((current) => current.key === key
          ? { ...current, loadingMore: false, error: message }
          : current);
      }
    } finally {
      if (inFlightRequests.current.get(activeTab) === controller) {
        inFlightRequests.current.delete(activeTab);
      }
      loadingMore.current = false;
    }
  };

  const updateFollowStatus = (personId: string, status: 'pending' | 'accepted', suggestedPerson: boolean) => {
    if (suggestedPerson) {
      setSuggestedFollowStatus((current) => ({ ...current, [personId]: status }));
      setSuggested((current) => current.filter((person) => person.id !== personId));
    } else {
      setFollowedResults((current) => ({ ...current, [personId]: status }));
    }
  };

  const followPerson = async (personId: string, suggestedPerson: boolean) => {
    if (followingBusy.has(personId)) return;
    setFollowingBusy((current) => new Set(current).add(personId));
    try {
      const { data, error } = await getSupabaseClient().rpc('follow_user', { p_target: personId });
      if (error) throw error;
      updateFollowStatus(personId, data === 'pending' ? 'pending' : 'accepted', suggestedPerson);
    } catch (error) {
      Alert.alert('Could not follow this person', await getErrorMessage(error, 'Check your connection and try again.'));
    } finally {
      setFollowingBusy((current) => {
        const next = new Set(current);
        next.delete(personId);
        return next;
      });
    }
  };

  const openSearch = (value: string) => {
    setInput(value);
    setQuery(value.trim());
    inputRef.current?.focus();
  };

  const openHashtag = (tag: string) => {
    router.push({ pathname: '/hashtag/[tag]', params: { tag } });
  };

  const updateCommunityMembership = async (community: CommunityRow) => {
    if (communityBusy) return;
    setCommunityBusy(community.id);
    try {
      if (community.status === 'invited') {
        const { error } = await getSupabaseClient().rpc('respond_invite', {
          p_community_id: community.id,
          p_accept: true,
        });
        if (error) throw error;
        setCommunityStatuses((current) => ({ ...current, [community.id]: 'active' }));
      } else {
        const { data, error } = await getSupabaseClient().rpc('join_community', {
          p_community_id: community.id,
        });
        if (error) throw error;
        const status = data === 'active' || data === 'pending' || data === 'invited' || data === 'banned'
          ? data
          : null;
        setCommunityStatuses((current) => ({ ...current, [community.id]: status }));
      }
    } catch (error) {
      Alert.alert('Could not join this community', await getErrorMessage(error, 'Try again.'));
    } finally {
      setCommunityBusy(null);
    }
  };

  const renderCommunity = (community: CommunityRow) => {
    const status = communityStatuses[community.id] ?? community.status;
    const label = status === 'active' ? 'Joined'
      : status === 'pending' ? 'Requested'
        : status === 'invited' ? 'Accept invite'
          : community.visibility === 'private' ? 'Request to join' : 'Join';
    const isDisabled = status === 'pending' || communityBusy === community.id;
    const iconUrl = community.icon_path
      ? getSupabaseClient().storage.from('community-icons').getPublicUrl(community.icon_path).data.publicUrl
      : null;
    return (
      <View key={community.id} style={styles.personRow}>
        <Pressable
          onPress={() => router.push({ pathname: '/community/[slug]', params: { slug: community.slug } })}
          style={styles.personProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${community.name}`}
        >
          <View style={styles.avatar}>
            {iconUrl
              ? <Image source={{ uri: iconUrl }} style={styles.avatarImage} />
              : <Text style={styles.avatarInitials}>{initials(community.name)}</Text>}
          </View>
          <View style={styles.personMeta}>
            <View style={styles.nameWithLock}>
              <Text numberOfLines={1} style={styles.personName}>{community.name}</Text>
              {community.visibility === 'private' ? <Icon name="lock" size={20} color={theme.colors.textMuted} /> : null}
            </View>
            <Text numberOfLines={1} style={styles.personHandle}>
              {community.member_count.toLocaleString()} members · {community.category}
            </Text>
            {community.description ? <Text numberOfLines={1} style={styles.personHandle}>{community.description}</Text> : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            if (status === 'active') {
              router.push({ pathname: '/community/[slug]', params: { slug: community.slug } });
            } else if (!isDisabled) {
              void updateCommunityMembership(community);
            }
          }}
          disabled={isDisabled}
          style={[styles.followButton, status === 'active' && styles.followButtonDone]}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${community.name}`}
        >
          {communityBusy === community.id
            ? <ActivityIndicator size="small" color={theme.colors.black} />
            : <Text style={[styles.followButtonText, status === 'active' && styles.followButtonTextDone]}>{label}</Text>}
        </Pressable>
      </View>
    );
  };

  const renderPerson = (person: SearchPersonRpcRow, isSuggested: boolean) => {
    const status: SearchPersonRpcRow['follow_status'] = isSuggested
      ? suggestedFollowStatus[person.id] ?? 'none'
      : followedResults[person.id] ?? person.follow_status;
    const isBusy = followingBusy.has(person.id);
    const followLabel = status === 'accepted' ? 'Following' : status === 'pending' ? 'Requested' : 'Follow';
    const alreadyFollowing = followLabel !== 'Follow';
    return (
      <View key={person.id} style={styles.personRow}>
        <Pressable
          onPress={() => router.push({ pathname: '/user/[username]', params: { username: person.username } })}
          style={styles.personProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${person.display_name}'s profile`}
        >
          <View style={styles.avatar}>
            {person.avatar_url
              ? <Image source={{ uri: person.avatar_url }} style={styles.avatarImage} />
              : <Text style={styles.avatarInitials}>{initials(person.display_name)}</Text>}
          </View>
          <View style={styles.personMeta}>
            <NameWithBadge
              name={person.display_name}
              userId={person.id}
              size="xs"
              textStyle={styles.personName}
            />
            <Text numberOfLines={1} style={styles.personHandle}>@{person.username}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => void followPerson(person.id, isSuggested)}
          disabled={isBusy || alreadyFollowing}
          style={[styles.followButton, alreadyFollowing && styles.followButtonDone]}
          accessibilityRole="button"
          accessibilityLabel={`${followLabel} ${person.display_name}`}
        >
          {isBusy
            ? <ActivityIndicator size="small" color={theme.colors.black} />
            : <Text style={[styles.followButtonText, alreadyFollowing && styles.followButtonTextDone]}>{followLabel}</Text>}
        </Pressable>
      </View>
    );
  };

  const renderVideo = (item: FeedRpcRow) => {
    const video = item as VideoResult;
    return (
      <Pressable
        key={item.post.id}
        onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.post.id } })}
        style={styles.videoTile}
        accessibilityRole="button"
        accessibilityLabel={`Open video by ${item.author.display_name}`}
      >
        {video.thumbnailUrl
          ? <Image source={{ uri: video.thumbnailUrl }} style={styles.videoThumbnail} />
          : <View style={[styles.videoThumbnail, styles.videoFallback]}>
              <Icon name="play" size={24} color={theme.colors.white} />
            </View>}
        <Text numberOfLines={2} style={styles.videoCaption}>{item.post.caption || `Video by @${item.author.username}`}</Text>
      </Pressable>
    );
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Search</Text>
        <Pressable
          onPress={() => router.push('/explore')}
          style={styles.headerSpacer}
          accessibilityRole="button"
          accessibilityLabel="Open Explore"
        >
          <Icon name="explore" size={20} color={theme.colors.primary} />
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={theme.colors.textMuted} />
        <FocusableTextInput
          ref={inputRef}
          value={input}
          onChangeText={setInput}
          placeholder="Search people, videos, communities"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(input.trim())}
          style={styles.searchInput}
          accessibilityLabel="Search people, videos, communities"
        />
        {hasInput ? (
          <Pressable
            onPress={() => {
              setInput('');
              setQuery('');
              inputRef.current?.focus();
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>

      {hasInput ? (
        <View style={styles.tabs}>
          {searchTabs.map((tab) => (
            <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.tabButton}>
              <Text style={[styles.tabText, tab === activeTab && styles.tabTextActive]}>{tab}</Text>
              {tab === activeTab ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={!hasInput
          ? <RefreshControl refreshing={discoverLoading} onRefresh={() => void refreshDiscoverContent()} tintColor={theme.colors.primary} />
          : undefined}
      >
        {!hasInput ? (
          <>
            {historyError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{historyError}</Text>
                <Pressable onPress={() => void loadRecentSearches().then(updateRecentSearches).catch(async (error: unknown) => {
                  setHistoryError(await getErrorMessage(error, 'Recent searches could not be read.'));
                })}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {recentSearches.length ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Recent searches</Text>
                  <Pressable onPress={() => void clearRecentSearches().then(() => {
                    recentSearchesRef.current = [];
                    setRecentSearches([]);
                    setHistoryError('');
                  }).catch(async (error: unknown) => setHistoryError(await getErrorMessage(error, 'Recent searches could not be cleared.')))}>
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                </View>
                {recentSearches.map((search) => (
                  <View key={search} style={styles.recentRow}>
                    <Pressable onPress={() => openSearch(search)} style={styles.recentSearch} accessibilityRole="button">
                      <Icon name="search" size={20} color={theme.colors.textMuted} />
                      <Text style={styles.recentText}>{search}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void updateRecentSearches(removeRecentSearch(recentSearches, search))}
                      style={styles.removeRecent}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${search} from recent searches`}
                    >
                      <Icon name="close" size={20} color={theme.colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trending hashtags</Text>
              {trending.length ? (
                <View style={styles.chips}>
                  {trending.map((item) => (
                    <Pressable key={item.tag} onPress={() => openHashtag(item.tag)} style={styles.trendingChip}>
                      <Text style={styles.trendingTag}>#{item.tag}</Text>
                      <Text style={styles.trendingCount}>{item.post_count}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={styles.mutedText}>No trending hashtags yet.</Text>}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Suggested people</Text>
              {suggested.length ? (
                suggested.map((person) => (
                  <View key={person.id}>
                    {renderPerson({
                      ...person,
                      follow_status: suggestedFollowStatus[person.id] ?? 'none',
                    }, true)}
                    {person.mutual_follows > 0 || person.shared_interests > 0 ? (
                      <Text style={styles.suggestionReason}>
                        {person.mutual_follows > 0
                          ? `${person.mutual_follows} mutual ${person.mutual_follows === 1 ? 'follow' : 'follows'}`
                          : `${person.shared_interests} shared ${person.shared_interests === 1 ? 'interest' : 'interests'}`}
                      </Text>
                    ) : null}
                  </View>
                ))
              ) : <Text style={styles.mutedText}>No suggestions yet.</Text>}
              {discoverError ? <Text style={styles.errorText}>{discoverError}</Text> : null}
            </View>
          </>
        ) : input.trim().length < 2 ? (
          <Text style={styles.mutedText}>Enter at least 2 characters to search.</Text>
        ) : input.trim() !== query ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
        ) : shownResult.loading ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
        ) : shownResult.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not search. Check your connection and try again.</Text>
            <Pressable onPress={() => setRetryToken((value) => value + 1)} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : shownResult.rows.length === 0 ? (
          <Text style={styles.mutedText}>No results for &quot;{query}&quot;.</Text>
        ) : (
          <>
            {activeTab === 'People'
              ? (shownResult.rows as SearchPersonRpcRow[]).map((person) => renderPerson(person, false))
              : null}
            {activeTab === 'Videos'
              ? <View style={styles.videoGrid}>{(shownResult.rows as VideoResult[]).map(renderVideo)}</View>
              : null}
            {activeTab === 'Hashtags'
              ? (shownResult.rows as SearchHashtagRpcRow[]).map((item) => (
                  <Pressable key={item.tag} onPress={() => openHashtag(item.tag)} style={styles.hashtagRow}>
                    <View style={styles.hashtagIcon}>
                      <Text style={styles.hashtagIconText}>#</Text>
                    </View>
                    <View style={styles.personMeta}>
                      <Text style={styles.personName}>#{item.tag}</Text>
                      <Text style={styles.personHandle}>{item.post_count} {item.post_count === 1 ? 'video' : 'videos'}</Text>
                    </View>
                    <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
                  </Pressable>
                ))
              : null}
            {activeTab === 'Communities'
              ? (shownResult.rows as CommunityRow[]).map(renderCommunity)
              : null}
            {shownResult.hasMore ? (
              <Pressable onPress={() => void loadNextPage()} disabled={shownResult.loadingMore} style={styles.loadMoreButton}>
                {shownResult.loadingMore
                  ? <ActivityIndicator color={theme.colors.black} />
                  : <Text style={styles.loadMoreText}>Load more</Text>}
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  headerSpacer: { width: 40 },
  searchRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  searchInput: { flex: 1, color: theme.colors.white, paddingVertical: 10, fontSize: 14 },
  cancelText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
    marginTop: 12,
    paddingHorizontal: 10,
  },
  tabButton: { flex: 1, alignItems: 'center', position: 'relative', paddingVertical: 12 },
  tabText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: theme.colors.white },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: 36,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36, flexGrow: 1 },
  section: { marginBottom: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  clearText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700', marginBottom: 12 },
  recentRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentSearch: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  recentText: { color: theme.colors.white, fontSize: 14 },
  removeRecent: { padding: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  trendingTag: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  trendingCount: { color: theme.colors.textMuted, fontSize: 11 },
  personRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  personMeta: { flex: 1 },
  nameWithLock: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  personName: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  personHandle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  followButton: {
    minWidth: 86,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  followButtonDone: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  followButtonText: { color: theme.colors.black, fontSize: 12, fontWeight: '800' },
  followButtonTextDone: { color: theme.colors.white },
  suggestionReason: { color: theme.colors.textMuted, fontSize: 11, marginLeft: 58, marginBottom: 6 },
  hashtagRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12 },
  hashtagIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hashtagIconText: { color: theme.colors.primary, fontSize: 22, fontWeight: '800' },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  videoTile: { width: '48%', marginBottom: 6 },
  videoThumbnail: { width: '100%', aspectRatio: 0.76, borderRadius: 14, backgroundColor: theme.colors.surface },
  videoFallback: { alignItems: 'center', justifyContent: 'center' },
  videoCaption: { color: theme.colors.white, fontSize: 12, lineHeight: 17, marginTop: 7 },
  loadMoreButton: {
    minHeight: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    marginTop: 16,
  },
  loadMoreText: { color: theme.colors.black, fontSize: 13, fontWeight: '800' },
  loader: { marginTop: 36 },
  mutedText: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21, paddingVertical: 14 },
  errorBox: { alignItems: 'center', paddingVertical: 28 },
  errorText: { color: theme.colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: { marginTop: 12, padding: 8 },
  retryText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
});
