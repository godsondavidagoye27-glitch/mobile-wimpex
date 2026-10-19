import { getErrorMessage } from '../../lib/errorMessage';
import { createProfileShareUrl } from '../sharing/shareLinks';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Icon, type AppIconName } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { getSupabaseClient } from '../../lib/supabase';
import { getSignedUrls } from '../feed/useFeed';
import { theme } from '../../theme/theme';
import type { FeedPost, FeedRpcRow, ProfileRpcRow } from '../../types/database';
import { FollowListSheet } from './FollowListSheet';
import { ProfileHighlights } from './ProfileHighlights';
import { followActionForStatus, followStatusAfterAction } from './followState';
import { useFollowRequestCount } from './useFollowRequestCount';

type ProfileTab = 'posts' | 'liked' | 'saved';
type FollowListKind = 'followers' | 'following';
type ProfilePostRow = FeedRpcRow & { thumbnailUrl: string | null };
type TabCache = { key: string; rows: ProfilePostRow[]; cursor: ProfilePostRow | null; error: string };
type DialogAction =
  | { type: 'unfollow' }
  | { type: 'block' }
  | { type: 'delete'; post: FeedPost }
  | { type: 'audience'; post: FeedPost };

const tabs: { key: ProfileTab; label: string; icon: AppIconName }[] = [
  { key: 'posts', label: 'Posts', icon: 'grid' },
  { key: 'liked', label: 'Liked', icon: 'heart' },
  { key: 'saved', label: 'Saved', icon: 'bookmark' },
];
const tileColors = ['#163047', '#20352f', '#362d45', '#34352b', '#243449', '#3c2d36'];
const pageSize = 24;

async function attachProfileThumbnails(rows: FeedRpcRow[]): Promise<ProfilePostRow[]> {
  const paths = rows.flatMap(({ post }) => post.thumb_path ? [post.thumb_path] : []);
  const thumbnails = await getSignedUrls('thumbnails', paths);
  return rows.map((row) => ({
    ...row,
    thumbnailUrl: row.post.thumb_path ? thumbnails.get(row.post.thumb_path) ?? null : null,
  }));
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

function useProfileData(username: string | null) {
  const [result, setResult] = useState<{ key: string; profile: ProfileRpcRow | null; error: string } | null>(null);
  const key = username ?? 'self';
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await getSupabaseClient().rpc('get_profile', { p_username: username });
        if (error) throw error;
        if (!active) return;
        setResult({
          key,
          profile: data?.[0] ?? null,
          error: '',
        });
      } catch (caught) {
        if (!active) return;
        setResult({
          key,
          profile: null,
          error: await getErrorMessage(caught, 'Unable to load this profile.'),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [key, username]);

  const refresh = useCallback(async () => {
    const { data, error } = await getSupabaseClient().rpc('get_profile', { p_username: username });
    if (error) throw error;
    const next = { key, profile: data?.[0] ?? null, error: '' };
    setResult(next);
    return next.profile;
  }, [key, username]);

  return { profile: current?.profile ?? null, error: current?.error ?? '', loading: !current, refresh };
}

export function ProfileScreen({ username }: { username: string | null }) {
  const { width } = useWindowDimensions();
  const { profile, error: profileError, loading: profileLoading, refresh: refreshProfile } = useProfileData(username);
  const requestCount = useFollowRequestCount(profile?.is_me ?? false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [postResult, setPostResult] = useState<TabCache | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [toastText, setToastText] = useState('');
  const [tabOffset, setTabOffset] = useState(0);
  const [stickyTabs, setStickyTabs] = useState(false);
  const [listKind, setListKind] = useState<FollowListKind | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [acting, setActing] = useState(false);
  const [indicator] = useState(() => new Animated.Value(0));
  const requestId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profileRefreshOverride, setProfileRefreshOverride] = useState<ProfileRpcRow | null>(null);
  const currentTabKey = `${profile?.id ?? ''}:${activeTab}`;
  const tabData = postResult?.key === currentTabKey ? postResult : null;
  const isPrivateState = !!profile && !profile.is_me && !profile.can_view_posts && profile.is_private;
  const visibleTabs = profile?.is_me ? tabs : tabs.filter((tab) => tab.key !== 'saved');

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (!profile || !profile.can_view_posts || (activeTab === 'liked' && !profile.can_view_liked)) return undefined;
    const key = `${profile.id}:${activeTab}`;
    if (postResult?.key === key) return undefined;
    const id = ++requestId.current;
    void (async () => {
      try {
        const { data, error } = await getSupabaseClient().rpc('get_profile_posts', {
          p_user_id: profile.id,
          p_tab: activeTab,
          p_page_size: pageSize,
        });
        if (error) throw error;
        if (id !== requestId.current) return;
        const rows = await attachProfileThumbnails(data ?? []);
        setPostResult({
          key,
          rows,
          cursor: rows.length === pageSize ? rows[rows.length - 1] : null,
          error: '',
        });
      } catch (caught) {
        if (id !== requestId.current) return;
        setPostResult({
          key,
          rows: [],
          cursor: null,
          error: await getErrorMessage(caught, 'Unable to load videos.'),
        });
      }
    })();
    return () => {
      requestId.current += 1;
    };
  }, [activeTab, postResult?.key, profile]);

  const loadMore = async () => {
    if (!profile || !tabData?.cursor || loadingMore) return;
    setLoadingMore(true);
    const id = ++requestId.current;
    try {
      const { data, error } = await getSupabaseClient().rpc('get_profile_posts', {
        p_user_id: profile.id,
        p_tab: activeTab,
        p_cursor_created_at: tabData.cursor.post.published_at,
        p_cursor_id: tabData.cursor.post.id,
        p_page_size: pageSize,
        p_cursor_pinned: activeTab === 'posts' && tabData.cursor.post.pinned_at !== null,
      });
      if (error) throw error;
      if (id !== requestId.current) return;
      const rows = await attachProfileThumbnails(data ?? []);
      setPostResult((current) => current?.key === currentTabKey
        ? {
          ...current,
          rows: [...current.rows, ...rows.filter((row) => !current.rows.some((existing) => existing.post.id === row.post.id))],
          cursor: rows.length === pageSize ? rows[rows.length - 1] : null,
        }
        : current);
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to load more videos.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setScreenError('');
    try {
      const nextProfile = await refreshProfile();
      if (!nextProfile?.can_view_posts) {
        setPostResult(null);
        return;
      }
      const { data, error } = await getSupabaseClient().rpc('get_profile_posts', {
        p_user_id: nextProfile.id,
        p_tab: activeTab,
        p_page_size: pageSize,
      });
      if (error) throw error;
      const rows = await attachProfileThumbnails(data ?? []);
      setPostResult({
        key: `${nextProfile.id}:${activeTab}`,
        rows,
        cursor: rows.length === pageSize ? rows[rows.length - 1] : null,
        error: '',
      });
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to refresh this profile.'));
    } finally {
      setRefreshing(false);
    }
  };

  const performFollowAction = async () => {
    if (!profile || acting) return;
    const action = followActionForStatus(profile.follow_status);
    if (action === 'unfollow') {
      setDialogAction({ type: 'unfollow' });
      return;
    }
    setActing(true);
    setScreenError('');
    try {
      if (action === 'follow') {
        const { data, error } = await getSupabaseClient().rpc('follow_user', { p_target: profile.id });
        if (error) throw error;
        const nextStatus = followStatusAfterAction(action, data === 'pending' ? 'pending' : 'accepted');
        setProfileStatus(profile.id, nextStatus);
      } else {
        const { error } = await getSupabaseClient().rpc('cancel_follow_request', { p_target: profile.id });
        if (error) throw error;
        setProfileStatus(profile.id, followStatusAfterAction(action));
      }
      await refreshProfile();
      setProfileRefreshOverride(null);
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to update this follow.'));
    } finally {
      setActing(false);
    }
  };

  const setProfileStatus = (profileId: string, status: 'none' | 'pending' | 'accepted') => {
    if (!profile || profile.id !== profileId) return;
    setProfileRefreshOverride({
      ...profile,
      follow_status: status,
      is_following: status === 'accepted',
      can_view_posts: status === 'accepted' || !profile.is_private || profile.is_me,
    });
  };

  const shownProfile = profileRefreshOverride?.id === profile?.id
    ? profileRefreshOverride
    : profile;
  const isBlockedState = !!shownProfile && (shownProfile.is_blocked_by_me || shownProfile.has_blocked_me);

  const showToast = (message: string) => {
    setToastText(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 2200);
  };

  const confirmDialog = async () => {
    if (!dialogAction || !shownProfile || acting) return;
    const action = dialogAction;
    setActing(true);
    setScreenError('');
    try {
      const client = getSupabaseClient();
      if (action.type === 'unfollow') {
        const { error } = await client.rpc('unfollow_user', { p_target: shownProfile.id });
        if (error) throw error;
        setProfileStatus(shownProfile.id, 'none');
        await refreshProfile();
        setProfileRefreshOverride(null);
      } else if (action.type === 'block') {
        const { error } = await client.rpc('block_user', { p_target: shownProfile.id });
        if (error) throw error;
        setProfileRefreshOverride({ ...shownProfile, is_blocked_by_me: true, can_view_posts: false });
      } else if (action.type === 'delete') {
        const { error } = await client.functions.invoke('delete-own-post', {
          body: { postId: action.post.id },
        });
        if (error) throw error;
        setPostResult((current) => current?.key === currentTabKey
          ? { ...current, rows: current.rows.filter((row) => row.post.id !== action.post.id) }
          : current);
      }
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to complete this action.'));
    } finally {
      setActing(false);
      setDialogAction(null);
    }
  };

  const changeAudience = async (post: FeedPost, audience: FeedPost['audience']) => {
    setScreenError('');
    try {
      const { error } = await getSupabaseClient().from('posts').update({ audience }).eq('id', post.id);
      if (error) throw error;
      setPostResult((current) => current?.key === currentTabKey
        ? { ...current, rows: current.rows.map((row) => row.post.id === post.id ? { ...row, post: { ...row.post, audience } } : row) }
        : current);
      setDialogAction(null);
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to change video visibility.'));
    }
  };

  const pinPost = async (post: FeedPost) => {
    setScreenError('');
    try {
      const { error } = await getSupabaseClient().rpc('pin_post', {
        p_post_id: post.id,
        p_pinned: post.pinned_at === null,
      });
      if (error) throw error;
      const pinnedAt = post.pinned_at ? null : new Date().toISOString();
      setPostResult((current) => current?.key === currentTabKey
        ? {
          ...current,
          rows: current.rows.map((row) => row.post.id === post.id
            ? { ...row, post: { ...row.post, pinned_at: pinnedAt } }
            : row).sort((first, second) => {
            const firstPinned = first.post.pinned_at ? 1 : 0;
            const secondPinned = second.post.pinned_at ? 1 : 0;
            return secondPinned - firstPinned
              || (second.post.published_at ?? '').localeCompare(first.post.published_at ?? '');
          }),
        }
        : current);
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to pin this video.'));
    }
  };

  const shareProfile = async () => {
    if (!shownProfile) return;
    try {
      await Share.share({
        title: `@${shownProfile.username}`,
        message: createProfileShareUrl(shownProfile.username),
        url: createProfileShareUrl(shownProfile.username),
      });
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to share this profile.'));
    }
  };

  const reportProfile = async (reason: string) => {
    if (!shownProfile) return;
    setReportOpen(false);
    setScreenError('');
    try {
      const { data, error: authError } = await getSupabaseClient().auth.getSession();
      if (authError) throw authError;
      if (!data.session?.user) throw new Error('Sign in again to report this account.');
      const { error } = await getSupabaseClient().from('reports').insert({
        reporter_id: data.session.user.id,
        target_type: 'profile',
        target_id: shownProfile.id,
        reason,
      });
      if (error) throw error;
      Alert.alert('Report sent', 'Thank you for helping keep Wimpex safe.');
    } catch (caught) {
      setScreenError(await getErrorMessage(caught, 'Unable to submit this report.'));
    }
  };

  const selectTab = (nextTab: ProfileTab) => {
    const nextIndex = visibleTabs.findIndex((tab) => tab.key === nextTab);
    setActiveTab(nextTab);
    Animated.spring(indicator, {
      toValue: nextIndex,
      useNativeDriver: true,
      stiffness: 220,
      damping: 24,
      mass: 0.8,
    }).start();
  };

  if (profileLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}><View style={styles.skeletonSmall} /><View style={styles.skeletonTitle} /><View style={styles.skeletonSmall} /></View>
        <View style={styles.skeletonBody}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonLineShort} />
          <View style={styles.skeletonStats} />
          <View style={styles.skeletonGrid}><View /><View /><View /><View /><View /><View /></View>
        </View>
      </View>
    );
  }

  if (!shownProfile || isBlockedState) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="back" size={20} color={theme.colors.white} />
          </Pressable>
        </View>
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{isBlockedState ? 'User not found.' : profileError || 'User not found.'}</Text>
        </View>
      </View>
    );
  }

  const avatarInitials = initials(shownProfile.display_name);
  const tabWidth = width / visibleTabs.length;
  const profileUnavailable = !!profileError || !shownProfile;

  const renderTabs = (isSticky = false) => (
    <View
      onLayout={isSticky ? undefined : (event) => setTabOffset(event.nativeEvent.layout.y)}
      style={[styles.tabBar, isSticky && styles.stickyTabBar]}
    >
      {visibleTabs.map((tab, index) => (
        <Pressable
          key={tab.key}
          style={styles.tabButton}
          onPress={() => selectTab(tab.key)}
          accessibilityRole="button"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: activeTab === tab.key }}
        >
          <Icon name={tab.icon} size={20} color={activeTab === tab.key ? theme.colors.primary : theme.colors.textMuted} filled={activeTab === tab.key} />
          <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
        </Pressable>
      ))}
      <Animated.View
        style={[
          styles.tabUnderline,
          { width: tabWidth - 44, transform: [{ translateX: Animated.multiply(indicator, tabWidth) }] },
        ]}
      />
    </View>
  );

  const listHeader = (
    <View>
      <View style={styles.profileCard}>
        <View style={styles.avatarWrap}>
          <LinearGradient colors={[theme.colors.primary, theme.colors.success]} style={styles.avatarRing}>
            {shownProfile.avatar_url
              ? <Image source={{ uri: shownProfile.avatar_url }} style={styles.avatar} />
              : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{avatarInitials}</Text></View>}
          </LinearGradient>
        </View>
        <NameWithBadge
          name={shownProfile.display_name}
          userId={shownProfile.id}
          size="md"
          textStyle={styles.displayName}
        />
        <Text style={styles.username}>@{shownProfile.username}</Text>
        {shownProfile.bio ? <Text style={styles.bio}>{shownProfile.bio}</Text> : null}
        {shownProfile.link ? (
          <Pressable
            style={styles.linkRow}
            onPress={() => {
              void Linking.openURL(shownProfile.link!).catch(async (caught: unknown) => {
                setScreenError(await getErrorMessage(caught, 'Unable to open this link.'));
              });
            }}
            accessibilityRole="link"
          >
            <Icon name="link" size={20} color={theme.colors.primary} />
            <Text style={styles.linkText}>{shownProfile.link.replace(/^https:\/\//i, '')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.statsRow}>
        <Pressable style={styles.statItem} onPress={() => setListKind('following')} accessibilityRole="button">
          <Text style={styles.statValue}>{formatCount(shownProfile.following_count)}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </Pressable>
        <Pressable style={styles.statItem} onPress={() => setListKind('followers')} accessibilityRole="button">
          <Text style={styles.statValue}>{formatCount(shownProfile.followers_count)}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </Pressable>
        <Pressable
          style={styles.statItem}
          onPress={() => showToast('Total likes received on all posts')}
          accessibilityRole="button"
        >
          <Text style={styles.statValue}>{formatCount(shownProfile.likes_received_count)}</Text>
          <Text style={styles.statLabel}>Likes</Text>
        </Pressable>
      </View>
      <View style={styles.actionRow}>
        {shownProfile.is_me ? (
          <>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/profile/edit')} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>Edit profile</Text>
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => void shareProfile()} accessibilityRole="button" accessibilityLabel="Share profile">
              <Icon name="share" size={20} color={theme.colors.white} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={[
                styles.primaryButton,
                shownProfile.follow_status === 'accepted' && styles.followingButton,
                shownProfile.follow_status === 'pending' && styles.requestedButton,
              ]}
              onPress={() => void performFollowAction()}
              disabled={acting}
              accessibilityRole="button"
            >
              {acting ? <ActivityIndicator size="small" color={theme.colors.white} /> : (
                <Text style={[
                  styles.primaryButtonText,
                  shownProfile.follow_status !== 'none' && styles.followingText,
                ]}>
                  {shownProfile.follow_status === 'accepted' ? 'Following' : shownProfile.follow_status === 'pending' ? 'Requested' : 'Follow'}
                </Text>
              )}
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void startMessage(shownProfile)}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Message</Text>
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => setShowMore(true)} accessibilityRole="button" accessibilityLabel="More actions">
              <Icon name="more" size={20} color={theme.colors.white} />
            </Pressable>
          </>
        )}
      </View>
      {shownProfile.is_me ? (
        <Pressable style={styles.requestLink} onPress={() => router.push('/follow-requests')} accessibilityRole="button">
          <Text style={styles.requestLinkText}>Follow requests</Text>
          {requestCount > 0 ? <View style={styles.requestBadge}><Text style={styles.requestBadgeText}>{requestCount > 99 ? '99+' : requestCount}</Text></View> : null}
          <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
      {shownProfile.is_me ? (
        <Pressable style={styles.requestLink} onPress={() => router.push('/creator-analytics')} accessibilityRole="button">
          <Text style={styles.requestLinkText}>Creator dashboard</Text>
          <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
      <ProfileHighlights ownerId={shownProfile.id} isOwner={shownProfile.is_me} />
      {isPrivateState ? (
        <View style={styles.privateState}>
          <Icon name="lock" size={24} color={theme.colors.primary} />
          <Text style={styles.privateTitle}>This account is private</Text>
          <Text style={styles.stateText}>Follow this account to see their videos.</Text>
        </View>
      ) : null}
      {activeTab === 'liked' && !shownProfile.can_view_liked && !shownProfile.is_me ? (
        <View style={styles.privateState}>
          <Icon name="lock" size={24} color={theme.colors.primary} />
          <Text style={styles.stateText}>This user&apos;s liked videos are private.</Text>
        </View>
      ) : null}
      {renderTabs()}
    </View>
  );

  const openPostAction = (post: FeedPost) => {
    Alert.alert('Video options', undefined, [
      { text: post.pinned_at ? 'Unpin' : 'Pin to profile', onPress: () => void pinPost(post) },
      { text: 'Change audience', onPress: () => setDialogAction({ type: 'audience', post }) },
      { text: 'Delete post', style: 'destructive', onPress: () => setDialogAction({ type: 'delete', post }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const showPrivateCopy = isPrivateState
    || (activeTab === 'liked' && !shownProfile.can_view_liked && !shownProfile.is_me);
  const emptyCopy = activeTab === 'posts'
    ? (shownProfile.is_me ? 'Your videos appear here. Tap the plus to post one.' : 'No videos yet.')
    : activeTab === 'liked'
      ? 'No liked videos yet.'
      : 'Videos you save appear here.';
  const gridError = screenError || tabData?.error || (profileUnavailable ? profileError : '');

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.headerUsername}>{shownProfile.username}</Text>
        <Pressable
          onPress={() => shownProfile.is_me ? router.push('/settings') : setShowMore(true)}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={shownProfile.is_me ? 'Settings' : 'More actions'}
        >
          <Icon name={shownProfile.is_me ? 'settings' : 'more'} size={20} color={theme.colors.white} />
          {shownProfile.is_me && requestCount > 0 ? (
            <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{requestCount > 9 ? '9+' : requestCount}</Text></View>
          ) : null}
        </Pressable>
      </View>
      {stickyTabs ? renderTabs(true) : null}
      {gridError ? <Text accessibilityRole="alert" style={styles.error}>{gridError}</Text> : null}
      <FlatList
        key={`${shownProfile.id}-${activeTab}`}
        data={showPrivateCopy ? [] : tabData?.rows ?? []}
        numColumns={3}
        keyExtractor={(item) => item.post.id}
        onScroll={(event) => {
          const shouldStick = event.nativeEvent.contentOffset.y >= tabOffset && tabOffset > 0;
          setStickyTabs((current) => current === shouldStick ? current : shouldStick);
        }}
        scrollEventThrottle={16}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.45}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={showPrivateCopy ? null : !tabData ? (
          <View style={styles.centerState}><ActivityIndicator size="small" color={theme.colors.primary} /></View>
        ) : (
          <View style={styles.emptyState}>
            {shownProfile.is_me && activeTab === 'posts' ? (
              <Pressable onPress={() => router.push('/create-post')} style={styles.emptyPlus} accessibilityRole="button" accessibilityLabel="Create post">
                <Icon name="plus" size={24} color={theme.colors.primary} />
              </Pressable>
            ) : null}
            <Text style={styles.stateText}>{emptyCopy}</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Pressable
            style={[styles.tile, { width: width / 3, backgroundColor: tileColors[index % tileColors.length] }]}
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.post.id } })}
            onLongPress={shownProfile.is_me && activeTab === 'posts' ? () => openPostAction(item.post) : undefined}
            accessibilityRole="button"
            accessibilityLabel={`Open video, ${formatCount(item.post.view_count)} views`}
          >
            {item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
            <View style={styles.tilePlay}><Icon name="play" size={20} color={theme.colors.white} /></View>
            <View style={styles.tileMeta}>
              <Icon name="play" size={20} color={theme.colors.white} />
              <Text style={styles.tileViews}>{formatCount(item.post.view_count)}</Text>
            </View>
            {item.post.pinned_at ? <View style={styles.pinBadge}><Icon name="pin" size={20} color={theme.colors.white} /></View> : null}
          </Pressable>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={theme.colors.primary} /> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.primary} />}
      />

      <FollowListSheet
        visible={listKind !== null}
        profileId={shownProfile.id}
        kind={listKind ?? 'followers'}
        onClose={() => setListKind(null)}
        onFollowChanged={async () => {
          await refreshProfile();
          setProfileRefreshOverride(null);
        }}
      />

      <Modal transparent animationType="slide" visible={showMore} onRequestClose={() => setShowMore(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowMore(false)} />
        <View style={styles.actionSheet}>
          <Text style={styles.sheetTitle}>@{shownProfile.username}</Text>
          <Pressable style={styles.sheetRow} onPress={() => { setShowMore(false); void shareProfile(); }}>
            <Icon name="share" size={20} color={theme.colors.white} /><Text style={styles.sheetRowText}>Share profile</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => { setShowMore(false); setReportOpen(true); }}>
            <Icon name="flag" size={20} color={theme.colors.white} /><Text style={styles.sheetRowText}>Report</Text>
          </Pressable>
          <Pressable style={styles.sheetRow} onPress={() => { setShowMore(false); setDialogAction({ type: 'block' }); }}>
            <Icon name="ban" size={20} color={theme.colors.danger} /><Text style={[styles.sheetRowText, styles.dangerText]}>Block</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => setShowMore(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={reportOpen} onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setReportOpen(false)} />
        <View style={styles.actionSheet}>
          <Text style={styles.sheetTitle}>Report account</Text>
          {['Spam', 'Harassment', 'Inappropriate content', 'Other'].map((reason) => (
            <Pressable key={reason} style={styles.sheetRow} onPress={() => void reportProfile(reason)}>
              <Text style={styles.sheetRowText}>{reason}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.cancelButton} onPress={() => setReportOpen(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={dialogAction !== null} onRequestClose={() => setDialogAction(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDialogAction(null)} />
        <View style={styles.actionSheet}>
          <Text style={styles.sheetTitle}>{dialogTitle(dialogAction, shownProfile.username)}</Text>
          {dialogAction?.type === 'unfollow' ? <Text style={styles.sheetCopy}>Unfollow @{shownProfile.username}?</Text> : null}
          {dialogAction?.type === 'block' ? <Text style={styles.sheetCopy}>They will not be able to find or message you.</Text> : null}
          {dialogAction?.type === 'delete' ? <Text style={styles.sheetCopy}>This post will be removed from your profile.</Text> : null}
          {dialogAction?.type === 'audience' ? (
            <>
              <Pressable style={styles.sheetRow} onPress={() => void changeAudience(dialogAction.post, 'everyone')}>
                <Text style={styles.sheetRowText}>Everyone</Text>
              </Pressable>
              <Pressable style={styles.sheetRow} onPress={() => void changeAudience(dialogAction.post, 'followers')}>
                <Text style={styles.sheetRowText}>Followers</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.confirmButton, (dialogAction?.type === 'block' || dialogAction?.type === 'delete') && styles.dangerButton]}
              onPress={() => void confirmDialog()}
              disabled={acting}
            >
              {acting ? <ActivityIndicator color={theme.colors.white} /> : (
                <Text style={styles.confirmText}>
                  {dialogAction?.type === 'unfollow' ? 'Unfollow' : dialogAction?.type === 'block' ? 'Block' : 'Delete'}
                </Text>
              )}
            </Pressable>
          )}
          <Pressable style={styles.cancelButton} onPress={() => setDialogAction(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        </View>
      </Modal>
      {toastText ? <View style={[styles.toast, { pointerEvents: 'none' }]}><Text style={styles.toastText}>{toastText}</Text></View> : null}
    </View>
  );
}

function dialogTitle(action: DialogAction | null, username: string) {
  if (action?.type === 'unfollow') return 'Unfollow account';
  if (action?.type === 'block') return `Block @${username}`;
  if (action?.type === 'delete') return 'Delete post';
  if (action?.type === 'audience') return 'Change audience';
  return '';
}

async function startMessage(profile: ProfileRpcRow) {
  try {
    const { data, error } = await getSupabaseClient().rpc('start_direct_conversation', {
      other_user: profile.id,
    });
    if (error) throw error;
    router.push({ pathname: '/chat/[id]', params: { id: data } });
  } catch (caught) {
    Alert.alert('Could not start conversation', await getErrorMessage(caught, 'Try again.'));
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line, backgroundColor: theme.colors.black, zIndex: 3 },
  headerButton: { width: 42, height: 42, justifyContent: 'center', position: 'relative' },
  headerUsername: { color: theme.colors.white, fontSize: 16, fontWeight: '800' },
  headerBadge: { position: 'absolute', top: 0, right: -3, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.danger },
  headerBadgeText: { color: theme.colors.white, fontSize: 9, fontWeight: '800' },
  profileCard: { alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 16 },
  avatarWrap: { marginBottom: 5 },
  avatarRing: { width: 104, height: 104, borderRadius: 52, padding: 4 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.surface },
  avatarFallback: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3557' },
  avatarText: { color: theme.colors.white, fontSize: 30, fontWeight: '800' },
  displayName: { color: theme.colors.white, fontSize: 20, fontWeight: '800', marginTop: 1 },
  username: { color: theme.colors.textMuted, fontSize: 13 },
  bio: { color: theme.colors.white, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4, maxWidth: 300 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  linkText: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  statsRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  statItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: theme.colors.white, fontSize: 18, fontWeight: '800' },
  statLabel: { color: theme.colors.textMuted, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  primaryButton: { flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  primaryButtonText: { color: theme.colors.black, fontSize: 14, fontWeight: '800' },
  followingButton: { backgroundColor: theme.colors.success },
  requestedButton: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  followingText: { color: theme.colors.white },
  secondaryButton: { flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  secondaryText: { color: theme.colors.white, fontSize: 13, fontWeight: '700' },
  iconButton: { width: 44, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  requestLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18 },
  requestLinkText: { flex: 1, color: theme.colors.white, fontWeight: '700' },
  requestBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  requestBadgeText: { color: theme.colors.black, fontSize: 10, fontWeight: '800' },
  privateState: { minHeight: 176, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  privateTitle: { color: theme.colors.white, fontSize: 17, fontWeight: '800' },
  tabBar: { height: 48, flexDirection: 'row', backgroundColor: theme.colors.black, borderBottomWidth: 1, borderBottomColor: theme.colors.line, position: 'relative', zIndex: 1 },
  stickyTabBar: { position: 'absolute', top: 58, left: 0, right: 0, zIndex: 2 },
  tabButton: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabLabelActive: { color: theme.colors.primary },
  tabUnderline: { position: 'absolute', height: 2, bottom: 0, left: 22, backgroundColor: theme.colors.primary },
  tile: { aspectRatio: 0.75, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.black },
  tilePlay: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.22)' },
  tileMeta: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileViews: { color: theme.colors.white, fontSize: 12, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  pinBadge: { position: 'absolute', top: 5, left: 5 },
  emptyState: { minHeight: 190, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  emptyPlus: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.line, borderRadius: 26, backgroundColor: theme.colors.surface },
  stateText: { color: theme.colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: theme.colors.danger, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  toast: { position: 'absolute', bottom: 28, alignSelf: 'center', maxWidth: '90%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: '#1E293B', zIndex: 5 },
  toastText: { color: theme.colors.white, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  footer: { padding: 18 },
  modalOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.58)' },
  actionSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, paddingBottom: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.colors.surface, gap: 8 },
  sheetTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800', paddingVertical: 8 },
  sheetCopy: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, paddingBottom: 8 },
  sheetRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  sheetRowText: { color: theme.colors.white, fontSize: 14, fontWeight: '600' },
  dangerText: { color: theme.colors.danger },
  confirmButton: { minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  dangerButton: { backgroundColor: theme.colors.danger },
  confirmText: { color: theme.colors.white, fontWeight: '800' },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skeletonBody: { flex: 1, alignItems: 'center', paddingTop: 25, gap: 12 },
  skeletonSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface },
  skeletonTitle: { width: 140, height: 18, borderRadius: 8, backgroundColor: theme.colors.surface },
  skeletonAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.surface },
  skeletonLine: { width: '56%', height: 18, borderRadius: 8, backgroundColor: theme.colors.surface },
  skeletonLineShort: { width: '38%', height: 14, borderRadius: 7, backgroundColor: theme.colors.surface },
  skeletonStats: { width: '84%', height: 52, borderRadius: 12, backgroundColor: theme.colors.surface, marginTop: 10 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', marginTop: 12 },
});
