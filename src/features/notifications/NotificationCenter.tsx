import { getErrorMessage } from '../../lib/errorMessage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { NotificationType } from '../../types/database';

type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationType;
  post_id: string | null;
  comment_id: string | null;
  community_id: string | null;
  live_stream_id: string | null;
  read_at: string | null;
  created_at: string;
  actor: { id: string; username: string; display_name: string; avatar_url: string | null } | null;
};

type NotificationSection = {
  title: 'Today' | 'Earlier';
  data: NotificationRow[];
};

const notificationSelect = 'id,user_id,actor_id,type,post_id,comment_id,community_id,live_stream_id,read_at,created_at';

function initials(displayName: string) {
  return displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function notificationAction(type: NotificationType) {
  switch (type) {
    case 'like': return 'liked your video';
    case 'comment': return 'commented on your video';
    case 'reply': return 'replied to your comment';
    case 'follow': return 'started following you';
    case 'follow_request': return 'requested to follow you';
    case 'live': return 'is live';
    case 'community_invite': return 'invited you to a community';
    case 'community_join_request': return 'requested to join your community';
    case 'community_request_approved': return 'approved your community request';
  }
}

function notificationSections(rows: NotificationRow[]): NotificationSection[] {
  const today = new Date();
  const isToday = (date: string) => {
    const created = new Date(date);
    return created.getFullYear() === today.getFullYear()
      && created.getMonth() === today.getMonth()
      && created.getDate() === today.getDate();
  };
  const todayRows = rows.filter((row) => isToday(row.created_at));
  const earlierRows = rows.filter((row) => !isToday(row.created_at));
  return [
    ...(todayRows.length ? [{ title: 'Today' as const, data: todayRows }] : []),
    ...(earlierRows.length ? [{ title: 'Earlier' as const, data: earlierRows }] : []),
  ];
}

function NotificationTypeIcon({ type }: { type: NotificationType }) {
  const color = type === 'like' ? theme.colors.danger : theme.colors.primary;
  return (
    <View style={styles.typeIcon}>
      <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" accessibilityLabel={`${type} notification`}>
        {type === 'like' ? (
          <Path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        ) : type === 'comment' ? (
          <Path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.4-3.7A7.5 7.5 0 1 1 20 11.5Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        ) : type === 'reply' ? (
          <Path d="M9 8 5 12l4 4M5 12h8a6 6 0 0 1 6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : type === 'follow_request' ? (
          <>
            <Circle cx={9} cy={8} r={4} stroke={color} strokeWidth={2} />
            <Path d="M3 21v-2a6 6 0 0 1 12 0v2M19 8v6m-3-3h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </>
        ) : type === 'follow' ? (
          <>
            <Circle cx={9} cy={8} r={4} stroke={color} strokeWidth={2} />
            <Path d="M3 21v-2a6 6 0 0 1 12 0v2m4-9v6m-3-3h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </>
        ) : type === 'community_invite' || type === 'community_join_request' || type === 'community_request_approved' ? (
          <>
            <Circle cx={9} cy={8} r={4} stroke={color} strokeWidth={2} />
            <Circle cx={18} cy={9} r={3} stroke={color} strokeWidth={2} />
            <Path d="M2 21v-2a7 7 0 0 1 14 0v2m2-6a5 5 0 0 1 4 5v1" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </>
        ) : (
          <>
            <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
            <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} />
            <Circle cx={12} cy={12} r={1} fill={color} />
          </>
        )}
      </Svg>
    </View>
  );
}

export function NotificationCenter() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const client = getSupabaseClient();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const currentUserId = sessionData.session?.user.id ?? null;
      setUserId(currentUserId);
      if (!currentUserId) {
        setRows([]);
        return;
      }

      const { data, error: notificationsError } = await client
        .from('notifications')
        .select(notificationSelect)
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (notificationsError) throw notificationsError;
      const notifications = data ?? [];
      const actorIds = [...new Set(notifications.map((item) => item.actor_id))];
      const actors = actorIds.length
        ? await client.from('profiles').select('id,username,display_name,avatar_url').in('id', actorIds)
        : { data: [], error: null };
      if (actors.error) throw actors.error;
      const actorById = new Map((actors.data ?? []).map((actor) => [actor.id, actor]));
      setRows(notifications.map((item) => ({
        ...item,
        actor: actorById.get(item.actor_id) ?? null,
      })));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to load notifications.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications();
    }, [loadNotifications]),
  );

  const markAllAsRead = async () => {
    if (!userId || markingRead || !rows.some((row) => !row.read_at)) return;
    setMarkingRead(true);
    setError('');
    const now = new Date().toISOString();
    try {
      const { error: updateError } = await getSupabaseClient()
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', userId)
        .is('read_at', null);
      if (updateError) throw updateError;
      setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? now })));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to mark notifications as read.'));
    } finally {
      setMarkingRead(false);
    }
  };

  const openNotification = async (notification: NotificationRow) => {
    const now = new Date().toISOString();
    if (!notification.read_at) {
      try {
        const { error: updateError } = await getSupabaseClient()
          .from('notifications')
          .update({ read_at: now })
          .eq('id', notification.id)
          .eq('user_id', notification.user_id)
          .is('read_at', null);
        if (updateError) throw updateError;
        setRows((current) => current.map((row) => row.id === notification.id ? { ...row, read_at: now } : row));
      } catch (caught) {
        setError(await getErrorMessage(caught, 'Unable to mark the notification as read.'));
        return;
      }
    }

    if (notification.type === 'like' || notification.type === 'comment' || notification.type === 'reply') {
      if (notification.post_id) {
        router.push({ pathname: '/post/[id]', params: { id: notification.post_id } });
        return;
      }
    }
    if (notification.type === 'follow_request') {
      router.push('/follow-requests');
      return;
    }
    if (notification.type === 'live') {
      if (!notification.live_stream_id) {
        setError('This live stream is no longer available.');
        return;
      }
      try {
        const { data, error: streamError } = await getSupabaseClient().rpc('get_live_stream', {
          p_stream_id: notification.live_stream_id,
        });
        if (streamError) throw streamError;
        if (!data?.length) {
          setError('This live stream is no longer available.');
          return;
        }
        router.push({ pathname: '/live/[streamId]', params: { streamId: notification.live_stream_id } });
      } catch (caught) {
        setError(await getErrorMessage(caught, 'Unable to open this live stream.'));
      }
      return;
    }
    if (
      notification.type === 'community_invite'
      || notification.type === 'community_join_request'
      || notification.type === 'community_request_approved'
    ) {
      if (!notification.community_id) {
        setError('This community is no longer available.');
        return;
      }
      try {
        const { data: slug, error: routeError } = await getSupabaseClient().rpc('community_notification_route', {
          p_community_id: notification.community_id,
        });
        if (routeError) throw routeError;
        if (!slug) {
          setError('This community is no longer available.');
          return;
        }
        router.push({
          pathname: '/community/[slug]',
          params: {
            slug,
            tab: notification.type === 'community_join_request' ? 'Members' : 'Posts',
          },
        });
      } catch (caught) {
        setError(await getErrorMessage(caught, 'Unable to open this community.'));
      }
      return;
    }
    if (notification.actor) {
      router.push({ pathname: '/user/[username]', params: { username: notification.actor.username } });
    } else {
      setError('This account is no longer available.');
    }
  };

  const sections = notificationSections(rows);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable
          onPress={() => void markAllAsRead()}
          disabled={markingRead || !rows.some((row) => !row.read_at)}
          accessibilityRole="button"
          style={styles.markAllButton}
        >
          {markingRead
            ? <ActivityIndicator size="small" color={theme.colors.primary} />
            : <Text style={[styles.markAllText, !rows.some((row) => !row.read_at) && styles.muted]}>Mark all as read</Text>}
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void openNotification(item)}
              style={[styles.row, !item.read_at && styles.unreadRow]}
              accessibilityRole="button"
            >
              <View style={styles.avatarWrap}>
                {item.actor?.avatar_url ? (
                  <Image source={{ uri: item.actor.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitials}>{item.actor ? initials(item.actor.display_name) : '?'}</Text>
                  </View>
                )}
                <NotificationTypeIcon type={item.type} />
              </View>
              <View style={styles.rowContent}>
                <View style={styles.message}>
                  {item.actor ? (
                    <NameWithBadge
                      name={item.actor.display_name}
                      userId={item.actor.id}
                      size="xs"
                      textStyle={styles.actorName}
                    />
                  ) : <Text style={styles.actorName}>Someone</Text>}
                  <Text style={styles.actionText}>{` ${notificationAction(item.type)}`}</Text>
                </View>
                <Text style={styles.time}>{formatNotificationTime(item.created_at)}</Text>
              </View>
              {!item.read_at ? <View style={styles.unreadDot} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Icon name="bell" size={24} color={theme.colors.primary} /></View>
              <Text style={styles.emptyText}>No notifications yet.</Text>
            </View>
          }
          contentContainerStyle={sections.length ? styles.listContent : styles.emptyList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadNotifications(true)}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

function formatNotificationTime(value: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  backButton: { width: 42, height: 42, alignItems: 'flex-start', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  markAllButton: { minWidth: 100, minHeight: 42, alignItems: 'flex-end', justifyContent: 'center' },
  markAllText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  muted: { color: theme.colors.textMuted },
  sectionTitle: {
    color: theme.colors.white,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 8,
  },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
  },
  unreadRow: { backgroundColor: 'rgba(56,189,248,0.07)' },
  avatarWrap: { width: 50, height: 50 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  avatarInitials: { color: theme.colors.white, fontSize: 15, fontWeight: '800' },
  typeIcon: {
    position: 'absolute',
    right: -4,
    bottom: -3,
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.black,
  },
  rowContent: { flex: 1, gap: 5 },
  message: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  actionText: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  actorName: { color: theme.colors.white, fontWeight: '700' },
  time: { color: theme.colors.textMuted, fontSize: 12 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  emptyList: { flexGrow: 1 },
  listContent: { paddingBottom: 28 },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  emptyText: { color: theme.colors.textMuted, fontSize: 15 },
  error: { color: theme.colors.danger, fontSize: 13, paddingHorizontal: 18, paddingTop: 8 },
});
