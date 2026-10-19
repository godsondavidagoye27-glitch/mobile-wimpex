import { getErrorMessage } from '../../lib/errorMessage';
import { router, useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { FocusableTextInput } from '../../components/AuthField';
import {
  fetchChatList,
  searchChatProfiles,
  type ChatListEntry,
  type ChatProfile,
} from '../../features/chats/chatService';
import { unreadBadgeCount } from '../../features/chats/messageState';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

const formatMessageTime = (date: string | null) => {
  if (!date) return '';
  const messageDate = new Date(date);
  const today = new Date();
  if (messageDate.toDateString() === today.toDateString()) {
    return messageDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return messageDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getInitials = (value: string) =>
  value.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || '?';

export default function ChatsScreen() {
  const networkState = useNetworkState();
  const [entries, setEntries] = useState<ChatListEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [profiles, setProfiles] = useState<ChatProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [creating, setCreating] = useState(false);

  const supabase = useMemo(() => getSupabaseClient(), []);

  const refresh = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setRefreshing(true);
    try {
      const { data, error: userError } = await supabase.auth.getSession();
      if (userError) throw userError;
      const user = data.session?.user;
      if (!user) {
        setUserId(null);
        setEntries([]);
        setError('');
        return;
      }
      setUserId(user.id);
      setEntries(await fetchChatList(supabase, user.id));
      setError('');
    } catch (loadError) {
      setError(await getErrorMessage(loadError, 'Could not load your chats.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    setLoading(true);
    void (async () => {
      try {
        const { data, error: userError } = await supabase.auth.getSession();
        if (userError) throw userError;
        const user = data.session?.user;
        if (!user) {
          if (mounted) {
            setUserId(null);
            setEntries([]);
            setError('');
          }
          return;
        }
        const activeUserId = user.id;
        const nextEntries = await fetchChatList(supabase, activeUserId);
        if (!mounted) return;
        setUserId(activeUserId);
        setEntries(nextEntries);
        setError('');
        channel = supabase
          .channel(`chat-list:${activeUserId}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'conversation_members',
            filter: `user_id=eq.${activeUserId}`,
          }, () => {
            if (mounted) void refresh(false);
          })
          .subscribe((status, subscribeError) => {
            if (subscribeError) {
              console.error('Unable to subscribe to chat list updates.', subscribeError);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('Chat list realtime subscription failed.', status);
            }
          });
      } catch (loadError) {
        if (mounted) setError(await getErrorMessage(loadError, 'Could not load your chats.'));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh, supabase]));

  const peerIds = useMemo(() => Array.from(new Set(
    entries.flatMap((entry) => entry.members.map((member) => member.user_id).filter((id) => id !== userId)),
  )), [entries, userId]);

  useEffect(() => {
    if (!userId || peerIds.length === 0) {
      return;
    }
    let active = true;
    const channels = peerIds.map((peerId) => {
      const channel = supabase.channel(`presence:${peerId}`, {
        config: { private: true, presence: { key: peerId } },
      });
      channel.on('presence', { event: 'sync' }, () => {
        if (!active) return;
        const state = channel.presenceState();
        setOnlineUserIds((current) => {
          const next = new Set(current);
          if (state[peerId]?.length) next.add(peerId);
          else next.delete(peerId);
          return next;
        });
      });
      channel.subscribe((status, subscribeError) => {
        if (subscribeError) {
          console.error(`Unable to subscribe to online status for ${peerId}.`, subscribeError);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Online status subscription failed for ${peerId}.`, status);
        }
      });
      return channel;
    });
    return () => {
      active = false;
      channels.forEach((channel) => void supabase.removeChannel(channel));
    };
  }, [peerIds, supabase, userId]);

  useEffect(() => {
    if (!composerOpen || !userId) return;
    let active = true;
    const timeout = setTimeout(() => {
      setPeopleLoading(true);
      setPeopleError('');
      void searchChatProfiles(supabase, userId, searchTerm)
        .then((nextProfiles) => {
          if (active) setProfiles(nextProfiles);
        })
        .catch(async (searchError: unknown) => {
          if (active) setPeopleError(await getErrorMessage(searchError, 'Could not search people.'));
        })
        .finally(() => {
          if (active) setPeopleLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [composerOpen, searchTerm, supabase, userId]);

  const openComposer = () => {
    setGroupMode(false);
    setSearchTerm('');
    setGroupTitle('');
    setSelectedIds(new Set());
    setComposerOpen(true);
  };

  const startDirect = async (profile: ChatProfile) => {
    if (creating) return;
    setCreating(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('start_direct_conversation', {
        other_user: profile.id,
      });
      if (rpcError) throw rpcError;
      setComposerOpen(false);
      routerPushConversation(data);
    } catch (createError) {
      Alert.alert('Could not start conversation', await getErrorMessage(createError, 'Try again.'));
    } finally {
      setCreating(false);
    }
  };

  const createGroup = async () => {
    if (creating || selectedIds.size === 0 || !groupTitle.trim()) return;
    setCreating(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_group', {
        group_title: groupTitle.trim(),
        member_ids: Array.from(selectedIds),
      });
      if (rpcError) throw rpcError;
      setComposerOpen(false);
      routerPushConversation(data);
    } catch (createError) {
      Alert.alert('Could not create group', await getErrorMessage(createError, 'Try again.'));
    } finally {
      setCreating(false);
    }
  };

  const renderConversation = ({ item }: { item: ChatListEntry }) => {
    const title = item.conversation.type === 'group'
      ? item.conversation.title ?? 'Group conversation'
      : item.peer?.display_name ?? 'Conversation';
    const preview = item.lastMessage
      ? item.lastMessage.deleted_at
        ? 'This message was deleted'
        : item.lastMessage.body ?? ({
          image: 'Photo',
          video: 'Video',
          voice: 'Voice message',
          call: 'Call',
          system: item.peer?.is_official ? 'Welcome to Wimpex' : 'Update',
          text: '',
        }[item.lastMessage.kind] ?? '')
      : 'Say hello';
    const online = item.members.some((member) => member.user_id !== userId && onlineUserIds.has(member.user_id));
    const unreadCount = unreadBadgeCount(item.membership.unread_count);
    return (
      <Pressable
        onPress={() => routerPushConversation(item.conversation.id)}
        style={styles.chatRow}
        accessibilityRole="button"
        accessibilityLabel={`Open chat with ${title}`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(title)}</Text>
          {online ? <View style={styles.onlineDot} /> : null}
        </View>
        <View style={styles.chatBody}>
          <View style={styles.chatTopRow}>
            <View style={styles.nameLine}>
              {item.conversation.type === 'group' ? (
                <Text style={styles.name} numberOfLines={1}>{title}</Text>
              ) : (
                <NameWithBadge
                  name={title}
                  userId={item.peer?.id}
                  size="xs"
                  textStyle={styles.name}
                />
              )}
              {item.peer?.is_official ? <Text style={styles.officialLabel}>Official</Text> : null}
            </View>
            <Text style={styles.time}>{formatMessageTime(item.conversation.last_message_at)}</Text>
          </View>
          <Text style={styles.message} numberOfLines={1}>{preview}</Text>
        </View>
        {unreadCount > 0 ? (
          <View style={styles.unreadPill}>
            <Text style={styles.unreadText}>{unreadCount}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const emptyList = () => {
    if (loading) {
      return (
        <View style={styles.skeletonList} accessibilityLabel="Loading chats">
          {[0, 1, 2, 3].map((item) => <View key={item} style={styles.skeletonRow} />)}
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Could not load your chats.</Text>
          <Pressable onPress={() => void refresh(true)} style={styles.retryButton} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return <View style={styles.empty}><Text style={styles.emptyText}>No chats yet. Start a conversation.</Text></View>;
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/message-requests')} style={styles.requestButton} accessibilityRole="button">
            <Text style={styles.requestText}>Requests</Text>
          </Pressable>
          <Pressable onPress={openComposer} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Compose chat">
            <Icon name="plus" size={20} color={theme.colors.white} />
          </Pressable>
        </View>
      </View>
      {networkState.isConnected === false || networkState.isInternetReachable === false ? (
        <View style={styles.offlineBanner}><Text style={styles.offlineText}>You are offline</Text></View>
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.conversation.id}
        renderItem={renderConversation}
        ListEmptyComponent={emptyList}
        contentContainerStyle={entries.length ? styles.list : styles.emptyList}
        refreshing={refreshing}
        onRefresh={() => void refresh(true)}
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => setComposerOpen(false)}>
        <KeyboardAwareScreen style={{ flex: 1 }}>
          <View style={styles.modalBackdrop}>
            <View style={styles.composer}>
            <View style={styles.composerHeader}>
              <Text style={styles.composerTitle}>{groupMode ? 'New group' : 'New conversation'}</Text>
              <Pressable onPress={() => setComposerOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="close" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
            {!groupMode ? (
              <Pressable style={styles.newGroupButton} onPress={() => setGroupMode(true)} accessibilityRole="button">
                <Icon name="groups" size={20} color={theme.colors.primary} />
                <Text style={styles.newGroupText}>New group</Text>
                <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
              </Pressable>
            ) : (
              <View style={styles.groupControls}>
                <FocusableTextInput
                  value={groupTitle}
                  onChangeText={setGroupTitle}
                  placeholder="Group name"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.searchInput}
                  accessibilityLabel="Group name"
                  maxLength={80}
                />
                <Text style={styles.selectionText}>{selectedIds.size} selected</Text>
              </View>
            )}
            <View style={styles.searchBox}>
              <Icon name="search" size={20} color={theme.colors.textMuted} />
              <FocusableTextInput
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder="Search people"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.searchInput}
                accessibilityLabel="Search people"
                autoCapitalize="none"
              />
            </View>
            {peopleLoading ? <ActivityIndicator color={theme.colors.primary} style={styles.peopleLoading} /> : null}
            {peopleError ? <Text style={styles.peopleError}>{peopleError}</Text> : null}
            <FlatList
              data={profiles}
              keyExtractor={(profile) => profile.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedIds.has(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      if (!groupMode) {
                        void startDirect(item);
                        return;
                      }
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    style={styles.personRow}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.personAvatar}><Text style={styles.avatarText}>{getInitials(item.display_name)}</Text></View>
                    <View style={styles.personIdentity}>
                      <NameWithBadge name={item.display_name} userId={item.id} size="xs" textStyle={styles.personName} />
                      <Text style={styles.personUsername}>@{item.username}</Text>
                    </View>
                    {groupMode ? <Icon name={selected ? 'check' : 'dot'} size={20} color={selected ? theme.colors.primary : theme.colors.textMuted} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={!peopleLoading && !peopleError
                ? <Text style={styles.noPeople}>No people found.</Text>
                : null}
            />
            {groupMode ? (
              <View style={styles.groupActions}>
                <Pressable onPress={() => setGroupMode(false)} style={styles.cancelButton} accessibilityRole="button">
                  <Text style={styles.cancelText}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={() => void createGroup()}
                  disabled={creating || selectedIds.size === 0 || !groupTitle.trim()}
                  style={[styles.createButton, (creating || selectedIds.size === 0 || !groupTitle.trim()) && styles.buttonDisabled]}
                  accessibilityRole="button"
                >
                  {creating ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.createText}>Create group</Text>}
                </Pressable>
              </View>
            ) : null}
            {creating && !groupMode ? <ActivityIndicator color={theme.colors.primary} /> : null}
            </View>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </KeyboardAwareScreen>
  );
}

function routerPushConversation(conversationId: string) {
  router.push({ pathname: '/chat/[id]', params: { id: conversationId } });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  requestButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18 },
  requestText: { color: theme.colors.white, fontWeight: '700', fontSize: 12 },
  title: { color: theme.colors.white, fontSize: 28, fontWeight: '800' },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  list: { paddingHorizontal: 18, paddingBottom: 90 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 80 },
  chatRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1B2A35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    position: 'relative',
  },
  avatarText: { color: theme.colors.white, fontWeight: '700', fontSize: 17 },
  onlineDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.black,
  },
  chatBody: { flex: 1, minWidth: 0 },
  chatTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 },
  nameLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { color: theme.colors.white, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  officialLabel: { color: theme.colors.primary, fontSize: 10, fontWeight: '700' },
  time: { color: theme.colors.textMuted, fontSize: 11 },
  message: { color: theme.colors.textMuted, fontSize: 13 },
  unreadPill: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  unreadText: { color: theme.colors.black, fontWeight: '800', fontSize: 12 },
  empty: { alignItems: 'center', gap: 12 },
  emptyText: { color: theme.colors.textMuted, fontSize: 15, textAlign: 'center' },
  retryButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 22, backgroundColor: theme.colors.primary },
  retryText: { color: theme.colors.black, fontWeight: '700' },
  skeletonList: { paddingHorizontal: 18 },
  skeletonRow: { height: 66, marginVertical: 5, borderRadius: 14, backgroundColor: theme.colors.surface },
  offlineBanner: { backgroundColor: '#36230D', paddingVertical: 7 },
  offlineText: { color: '#FBBF24', textAlign: 'center', fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  composer: {
    height: '88%',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.black,
  },
  composerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  composerTitle: { color: theme.colors.white, fontSize: 21, fontWeight: '800' },
  newGroupButton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  newGroupText: { flex: 1, color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  groupControls: { gap: 10, marginBottom: 8 },
  selectionText: { color: theme.colors.textMuted, fontSize: 12 },
  searchBox: {
    height: 46,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#171C22',
  },
  searchInput: { flex: 1, minHeight: 44, color: theme.colors.white, paddingVertical: 8 },
  peopleLoading: { padding: 8 },
  peopleError: { color: theme.colors.danger, marginVertical: 8 },
  noPeople: { color: theme.colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  personRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  personAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1B2A35', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  personIdentity: { flex: 1, gap: 3 },
  personName: { color: theme.colors.white, fontWeight: '700', fontSize: 14 },
  personUsername: { color: theme.colors.textMuted, fontSize: 12 },
  groupActions: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  cancelButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, borderWidth: 1, borderColor: theme.colors.line },
  cancelText: { color: theme.colors.white, fontWeight: '700' },
  createButton: { flex: 2, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: theme.colors.primary },
  createText: { color: theme.colors.black, fontWeight: '800' },
  buttonDisabled: { opacity: 0.45 },
});
