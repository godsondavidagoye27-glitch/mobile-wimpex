import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import { FocusableTextInput } from '../../components/AuthField';
import { ChatScreenLayout } from '../../components/ChatScreenLayout';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import { calculateChatComposerHeight } from '../../features/chats/chatLayout';
import { getStoryReplyPreviewUrl } from '../../features/stories/storyService';
import { ChatMediaComposer } from '../../features/chats/ChatMediaComposer';
import { ChatMediaMessage } from '../../features/chats/ChatMediaMessage';
import {
  fetchConversationMessages,
  type ChatProfile,
} from '../../features/chats/chatService';
import {
  createChatMediaSignedUrl,
  removeChatMedia,
  uploadChatMedia,
} from '../../features/chats/chatMediaService';
import {
  applyRealtimeChatMessage,
  isMessageRow,
  mergeChatMessages,
  setMessageDeliveryState,
  type ChatMessage,
  type MessageRow,
} from '../../features/chats/messageState';
import { beginProfileCompletion } from '../../features/auth/useAuthFlow';
import type { ChatMediaAttachment } from '../../features/chats/chatMediaValidation';
import { getSupabaseClient } from '../../lib/supabase';
import { getSingleRouteParam, isUuidRouteParam } from '../../lib/routeParams';
import type { Database } from '../../types/database';
import { theme } from '../../theme/theme';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

type Conversation = Pick<
  Database['public']['Tables']['conversations']['Row'],
  'id' | 'type' | 'title' | 'read_only'
>;
type Member = Pick<
  Database['public']['Tables']['conversation_members']['Row'],
  'user_id' | 'last_read_message_id'
>;
type Profile = Pick<ChatProfile, 'id' | 'username' | 'display_name' | 'avatar_url' | 'is_official' | 'date_of_birth'>;
type ReactionGroup = { emoji: string; count: number; mine: boolean };

const quickReactions = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const messageViewability = { itemVisiblePercentThreshold: 70 };

function StoryReplyVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.muted = true;
    videoPlayer.loop = false;
  });
  return <VideoView player={player} style={styles.storyReplyImage} contentFit="cover" nativeControls={false} />;
}

function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function compareMessagePosition(first: MessageRow, second: MessageRow) {
  return first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id);
}

function isMissingSenderProfileError(error: unknown) {
  return (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'P0001'
    && 'message' in error
    && error.message === 'Message sender profile not found.'
  );
}

function isUnder18(dateOfBirth: string) {
  const today = new Date();
  const birthday = new Date(`${dateOfBirth}T00:00:00`);
  let age = today.getFullYear() - birthday.getFullYear();
  if (
    today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }
  return age < 18;
}

function TypingDots() {
  const [dots] = useState(() => [new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]);

  useEffect(() => {
    const animations = dots.map((dot, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 130),
      Animated.timing(dot, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0.3, duration: 260, useNativeDriver: true }),
    ])));
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View style={styles.typingBubble} accessibilityLabel="Typing">
      {dots.map((opacity, index) => (
        <Animated.View key={index} style={[styles.typingDot, { opacity }]} />
      ))}
    </View>
  );
}

export default function ChatThreadScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const routeId = getSingleRouteParam(params.id);
  const conversationId = isUuidRouteParam(routeId) ? routeId : '';
  const networkState = useNetworkState();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAt = useRef(0);
  const newestMarkedReadId = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const membersRef = useRef<Member[]>([]);
  const profilesRef = useRef<Profile[]>([]);
  const showOnlineStatusRef = useRef(true);
  const screenFocusedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingMediaRef = useRef(new Map<string, { attachment: ChatMediaAttachment; mediaId: string }>());
  const mediaRequestsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const [focused, setFocused] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionGroup[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportTarget, setReportTarget] = useState<{ type: 'message' | 'conversation'; id: string } | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [attachment, setAttachment] = useState<ChatMediaAttachment | null>(null);
  const [localMediaUris, setLocalMediaUris] = useState<Record<string, string>>({});
  const [signedMediaUrls, setSignedMediaUrls] = useState<Record<string, string>>({});
  const [mediaLoadStatus, setMediaLoadStatus] = useState<Record<string, 'loading' | 'ready' | 'error'>>({});
  const [composerInputHeight, setComposerInputHeight] = useState(44);
  const latestMessageIdRef = useRef<string | null>(null);
  const showScrollButtonRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    membersRef.current = members;
    profilesRef.current = profiles;
  }, [members, profiles]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadReactions = useCallback(async (rows: MessageRow[], isActive: () => boolean = () => true) => {
    const ids = rows.map((message) => message.id).filter((messageId) => !messageId.startsWith('local:'));
    if (!ids.length) {
      if (mountedRef.current && isActive()) setReactions({});
      return;
    }
    const { data, error: reactionError } = await supabase
      .from('message_reactions')
      .select('message_id,user_id,emoji')
      .in('message_id', ids);
    if (reactionError) throw reactionError;
    if (!mountedRef.current || !isActive()) return;
    const grouped: Record<string, ReactionGroup[]> = {};
    for (const reaction of data) {
      const group = grouped[reaction.message_id] ?? [];
      const existing = group.find((item) => item.emoji === reaction.emoji);
      if (existing) {
        existing.count += 1;
        existing.mine ||= reaction.user_id === userIdRef.current;
      } else {
        group.push({ emoji: reaction.emoji, count: 1, mine: reaction.user_id === userIdRef.current });
      }
      grouped[reaction.message_id] = group;
    }
    setReactions((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return { ...next, ...grouped };
    });
  }, [supabase]);

  const refreshSignedMedia = useCallback(async (path: string) => {
    if (mediaRequestsRef.current.has(path)) return;
    mediaRequestsRef.current.add(path);
    setMediaLoadStatus((current) => ({ ...current, [path]: 'loading' }));
    setSignedMediaUrls((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    try {
      const isStoryReplyPreview = messagesRef.current.some((message) => message.story_reply_preview_path === path);
      const signedUrl = isStoryReplyPreview
        ? await getStoryReplyPreviewUrl(path, supabase)
        : await createChatMediaSignedUrl(supabase, path);
      if (!mountedRef.current) return;
      setSignedMediaUrls((current) => ({ ...current, [path]: signedUrl }));
      setMediaLoadStatus((current) => ({ ...current, [path]: 'ready' }));
    } catch (mediaError) {
      console.error('Unable to open private chat media.', mediaError);
      if (mountedRef.current) setMediaLoadStatus((current) => ({ ...current, [path]: 'error' }));
    } finally {
      mediaRequestsRef.current.delete(path);
    }
  }, [supabase]);

  useEffect(() => {
    const paths = new Set(messages.flatMap((message) => [message.media_path, message.story_reply_preview_path])
      .filter((path): path is string => Boolean(path)));
    paths.forEach((path) => {
      if (!mediaLoadStatus[path]) void refreshSignedMedia(path);
    });
  }, [mediaLoadStatus, messages, refreshSignedMedia]);

  const loadConversation = useCallback(async (isActive: () => boolean = () => true) => {
    if (!isUuidRouteParam(conversationId)) throw new Error('This conversation link is invalid.');
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError) throw authError;
    if (!isActive()) return;
    if (!authData.session?.user) throw new Error('Sign in to open this conversation.');
    const currentUserId = authData.session.user.id;

    const { data: nextConversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id,type,title,read_only')
      .eq('id', conversationId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!isActive()) return;
    if (!nextConversation) throw new Error('This conversation is unavailable.');

    const { data: nextMembers, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id,last_read_message_id')
      .eq('conversation_id', conversationId)
      .is('left_at', null);
    if (membersError) throw membersError;
    if (!isActive()) return;
    const { data: nextProfiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,username,display_name,avatar_url,is_official,date_of_birth')
      .in('id', nextMembers.map((member) => member.user_id));
    if (profilesError) throw profilesError;
    if (!isActive()) return;

    const rows = await fetchConversationMessages(supabase, conversationId, undefined, 30);
    if (!isActive()) return;
    const nextSettings = await supabase
      .from('user_settings')
      .select('show_online_status')
      .eq('user_id', currentUserId)
      .maybeSingle();
    if (nextSettings.error) throw nextSettings.error;
    if (!isActive()) return;
    showOnlineStatusRef.current = nextSettings.data?.show_online_status !== false;

    userIdRef.current = currentUserId;
    setUserId(currentUserId);
    setConversation(nextConversation);
    setMembers(nextMembers);
    setProfiles(nextProfiles);
    setMessages((current) => mergeChatMessages(
      current,
      rows.map((message) => ({ ...message, deliveryState: 'sent' as const })),
    ));
    latestMessageIdRef.current = rows[0]?.id ?? null;
    setHasMore(rows.length === 30);
    newestMarkedReadId.current = null;
    await loadReactions(rows, isActive);
  }, [conversationId, loadReactions, supabase]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setFocused(true);
    screenFocusedRef.current = true;
    if (messagesRef.current.length === 0) setLoading(true);
    setError('');
    void loadConversation(() => active)
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this conversation.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      setFocused(false);
      screenFocusedRef.current = false;
      setRemoteTyping(false);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [loadConversation]));

  useEffect(() => {
    if (!conversationId || !userId) return undefined;
    let active = true;
    const channel = supabase.channel(`chat:${conversationId}`, {
      config: { private: true, presence: { key: userId } },
    });
    channelRef.current = channel;
    channel
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        if (!active) return;
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id?: unknown }).id;
          if (typeof deletedId === 'string') {
            setMessages((current) => current.filter((message) => message.id !== deletedId));
            setReactions((current) => {
              const next = { ...current };
              delete next[deletedId];
              return next;
            });
          }
          return;
        }
        const realtimeMessage = payload.new;
        if (!isMessageRow(realtimeMessage)) return;
        const realtimeEvent = payload.eventType === 'INSERT' ? 'INSERT' : 'UPDATE';
        setMessages((current) => applyRealtimeChatMessage(current, realtimeMessage, realtimeEvent));
        const previousNewest = messagesRef.current[0];
        if (
          realtimeEvent === 'INSERT'
          && (!previousNewest || compareMessagePosition(realtimeMessage, previousNewest) > 0)
        ) {
          if (showScrollButtonRef.current && realtimeMessage.sender_id !== userIdRef.current) {
            setNewMessageCount((count) => count + 1);
          } else if (!showScrollButtonRef.current) {
            listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }
          latestMessageIdRef.current = realtimeMessage.id;
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
      }, (payload) => {
        if (!active) return;
        const reaction = payload.eventType === 'DELETE' ? payload.old : payload.new;
        const messageId = reaction && typeof reaction === 'object' && 'message_id' in reaction
          ? reaction.message_id
          : null;
        if (typeof messageId !== 'string') return;
        const message = messagesRef.current.find((item) => item.id === messageId);
        if (message) {
          void loadReactions([message]).catch((reactionError: unknown) => {
            console.error('Unable to refresh reactions for a chat message.', reactionError);
          });
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_members',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        void (async () => {
          try {
            const { data, error: memberRefreshError } = await supabase
              .from('conversation_members')
              .select('user_id,last_read_message_id')
              .eq('conversation_id', conversationId)
              .is('left_at', null);
            if (!active) return;
            if (memberRefreshError) {
              console.error('Unable to refresh conversation membership.', memberRefreshError);
              return;
            }
            setMembers(data);
          } catch (memberRefreshError) {
            if (active) console.error('Unable to refresh conversation membership.', memberRefreshError);
          }
        })();
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!active || typeof payload?.user_id !== 'string' || payload.user_id === userId) return;
        setRemoteTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setRemoteTyping(false), 4000);
      })
      .on('presence', { event: 'sync' }, () => {
        if (!active) return;
        const state = channel.presenceState();
        setOnlineUserIds(new Set(
          Object.keys(state).filter((presenceUserId) =>
            presenceUserId !== userId
            && membersRef.current.some((member) => member.user_id === presenceUserId),
          ),
        ));
      });

    channel.subscribe((status, subscribeError) => {
      if (!active) return;
      if (subscribeError) {
        console.error('Unable to subscribe to this conversation.', subscribeError);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Conversation realtime subscription failed.', status);
      }
      const currentProfile = profilesRef.current.find((profile) => profile.id === userId);
      if (
        status === 'SUBSCRIBED'
        && showOnlineStatusRef.current
        && currentProfile
        && !isUnder18(currentProfile.date_of_birth)
      ) {
        void channel.track({ user_id: userId }).then((trackStatus) => {
          if (active && trackStatus !== 'ok') console.error('Unable to publish online presence.', trackStatus);
        }).catch((trackError: unknown) => {
          if (active) console.error('Unable to publish online presence.', trackError);
        });
      }
    });
    return () => {
      active = false;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (channelRef.current === channel) channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, loadReactions, supabase, userId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (menuMessage) {
        setMenuMessage(null);
        return true;
      }
      if (headerMenuOpen) {
        setHeaderMenuOpen(false);
        return true;
      }
      if (reportOpen) {
        setReportOpen(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [headerMenuOpen, menuMessage, reportOpen]);

  const latestMessage = messages[0] ?? null;
  const peer = profiles.find((profile) => profile.id !== userId) ?? null;
  const otherReadId = members.find((member) => member.user_id !== userId)?.last_read_message_id;
  const otherReadMessage = messages.find((message) => message.id === otherReadId);
  const latestMine = messages.find((message) => message.sender_id === userId && !message.id.startsWith('local:'));
  const latestIsSeen = Boolean(
    latestMine && otherReadMessage && compareMessagePosition(otherReadMessage, latestMine) >= 0,
  );
  const title = conversation?.type === 'group' ? conversation.title ?? 'Group chat' : peer?.display_name ?? 'Chat';
  const statusLine = remoteTyping
    ? 'Typing'
    : conversation?.type === 'group'
      ? `${members.length} members`
      : peer && onlineUserIds.has(peer.id)
        ? 'Online'
        : '';

  const markRead = useCallback(async (message: ChatMessage) => {
    if (!userId || !focused || message.id.startsWith('local:') || newestMarkedReadId.current === message.id) return;
    newestMarkedReadId.current = message.id;
    const { error: readError } = await supabase.rpc('mark_read', {
      p_conversation_id: conversationId,
      p_up_to_message_id: message.id,
    });
    if (readError) {
      newestMarkedReadId.current = null;
      console.warn('Unable to mark the latest chat message as read.', readError);
    }
  }, [conversationId, focused, supabase, userId]);

  const latestMessageRef = useRef<ChatMessage | null>(null);
  const markReadRef = useRef(markRead);

  useLayoutEffect(() => {
    latestMessageRef.current = latestMessage;
    markReadRef.current = markRead;
  }, [latestMessage, markRead]);

  const onViewableItemsChanged = useCallback((info: { viewableItems: ViewToken<ChatMessage>[] }) => {
    const newestMessage = latestMessageRef.current;
    const newestVisible = newestMessage && info.viewableItems.some((token) =>
      token.isViewable && token.item.id === newestMessage.id,
    );
    if (newestMessage && newestVisible && screenFocusedRef.current) {
      void markReadRef.current(newestMessage);
    }
  }, []);
  const loadOlder = useCallback(async () => {
    const oldest = messages[messages.length - 1];
    if (!conversationId || !oldest || loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    try {
      const olderRows = await fetchConversationMessages(supabase, conversationId, oldest, 30);
      const olderMessages = olderRows.map((message) => ({ ...message, deliveryState: 'sent' as const }));
      setMessages((current) => mergeChatMessages(current, olderMessages));
      setHasMore(olderRows.length === 30);
      await loadReactions(olderRows);
    } catch (loadError) {
      Alert.alert('Could not load older messages', loadError instanceof Error ? loadError.message : 'Try again.');
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMore, loadReactions, loadingOlder, messages, supabase]);
  const handleLoadOlder = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);

  const sendTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < 2000) return;
    lastTypingSentAt.current = now;
    const channel = channelRef.current;
    if (!channel || !userId) return;
    void channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId } })
      .then((status) => {
        if (status !== 'ok') console.warn('Typing update was not delivered.', status);
      })
      .catch((typingError: unknown) => {
        console.error('Unable to send typing update.', typingError);
      });
  };

  const transmitMessage = useCallback(async (message: ChatMessage) => {
    if (!userId || !conversationId) return;
    setMessages((current) => setMessageDeliveryState(current, message.client_id, 'sending'));
    const insert = {
      conversation_id: conversationId,
      sender_id: userId,
      client_id: message.client_id,
      kind: 'text' as const,
      body: message.body,
      reply_to_id: message.reply_to_id,
    };
    try {
      const { data, error: sendError } = await supabase
        .from('messages')
        .insert(insert)
        .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
        .single();
      if (sendError) {
        const { data: existing, error: lookupError } = await supabase
          .from('messages')
          .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
          .eq('sender_id', userId)
          .eq('client_id', message.client_id)
          .maybeSingle();
        if (lookupError) throw new Error(`${sendError.message} ${lookupError.message}`);
        if (!existing) throw sendError;
        setMessages((current) => mergeChatMessages(current, [{ ...existing, deliveryState: 'sent' }]));
      } else {
        setMessages((current) => mergeChatMessages(current, [{ ...data, deliveryState: 'sent' }]));
      }
      setDraft('');
      setReplyTo(null);
      setSending(false);
    } catch (sendError) {
      setMessages((current) => setMessageDeliveryState(current, message.client_id, 'failed'));
      setSending(false);
      console.error('Unable to send chat message.', sendError);
      if (isMissingSenderProfileError(sendError)) {
        beginProfileCompletion();
        router.replace('/(auth)/welcome?resume=signup');
      }
    }
  }, [conversationId, supabase, userId]);

  const transmitMediaMessage = useCallback(async (
    message: ChatMessage,
    pending: { attachment: ChatMediaAttachment; mediaId: string },
  ) => {
    if (!userId || !conversationId) return;
    setSending(true);
    setMessages((current) => setMessageDeliveryState(current, message.client_id, 'sending'));
    let path: string | null = null;
    try {
      path = await uploadChatMedia(supabase, userId, pending.mediaId, pending.attachment);
      const insert = {
        id: pending.mediaId,
        conversation_id: conversationId,
        sender_id: userId,
        client_id: message.client_id,
        kind: pending.attachment.kind,
        body: message.body,
        media_path: path,
        media_duration_ms: pending.attachment.durationMs,
        width: pending.attachment.width,
        height: pending.attachment.height,
        reply_to_id: message.reply_to_id,
      };
      const { data, error: sendError } = await supabase
        .from('messages')
        .insert(insert)
        .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
        .single();
      let savedMessage: MessageRow;
      if (sendError) {
        const { data: existing, error: lookupError } = await supabase
          .from('messages')
          .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
          .eq('sender_id', userId)
          .eq('client_id', message.client_id)
          .maybeSingle();
        if (lookupError) throw new Error(`${sendError.message} ${lookupError.message}`);
        if (!existing || existing.media_path !== path) throw sendError;
        savedMessage = existing;
      } else if (data) {
        savedMessage = data;
      } else {
        throw new Error('The attachment was uploaded but the message could not be confirmed.');
      }
      setMessages((current) => mergeChatMessages(current, [{ ...savedMessage, deliveryState: 'sent' }]));
      setLocalMediaUris((current) => {
        const next = { ...current };
        delete next[message.client_id];
        return next;
      });
      pendingMediaRef.current.delete(message.client_id);
      setReplyTo(null);
    } catch (sendError) {
      setMessages((current) => setMessageDeliveryState(current, message.client_id, 'failed'));
      if (path) {
        try {
          const { data: existing } = await supabase
            .from('messages')
            .select('id')
            .eq('sender_id', userId)
            .eq('client_id', message.client_id)
            .maybeSingle();
          if (!existing) await removeChatMedia(supabase, path);
        } catch (cleanupError) {
          console.warn('Could not clean up an incomplete chat upload.', cleanupError);
        }
      }
      const text = sendError instanceof Error ? sendError.message : 'Try sending the attachment again.';
      Alert.alert('Attachment not sent', text);
      console.error('Unable to send chat attachment.', sendError);
    } finally {
      setSending(false);
    }
  }, [conversationId, supabase, userId]);

  const submitMessage = async () => {
    const body = draft.trim();
    if ((!body && !attachment) || !userId || !conversationId || sending || conversation?.read_only) return;
    if (body.length > 2000) {
      Alert.alert('Message is too long', 'Messages can be up to 2000 characters.');
      return;
    }
    if (attachment && (networkState.isConnected === false || networkState.isInternetReachable === false)) {
      Alert.alert('You are offline', 'Reconnect before sending an attachment.');
      return;
    }
    setSending(true);
    const clientId = Crypto.randomUUID();
    const mediaId = attachment ? Crypto.randomUUID() : null;
    const optimistic: ChatMessage = {
      id: `local:${clientId}`,
      conversation_id: conversationId,
      sender_id: userId,
      client_id: clientId,
      kind: attachment?.kind ?? 'text',
      body: body || null,
      media_path: null,
      media_duration_ms: attachment?.durationMs ?? null,
      width: attachment?.width ?? null,
      height: attachment?.height ?? null,
      reply_to_id: replyTo?.id ?? null,
      story_reply_preview_path: null,
      story_reply_caption: null,
      created_at: new Date().toISOString(),
      deleted_at: null,
      deliveryState: 'sending',
      replyPreview: replyTo?.body,
    };
    setMessages((current) => mergeChatMessages(current, [optimistic]));
    if (attachment && mediaId) {
      pendingMediaRef.current.set(clientId, { attachment, mediaId });
      setLocalMediaUris((current) => ({ ...current, [clientId]: attachment.uri }));
    }
    setDraft('');
    setAttachment(null);
    if (attachment && mediaId) void transmitMediaMessage(optimistic, { attachment, mediaId });
    else void transmitMessage(optimistic);
  };

  const retryMessage = useCallback((message: ChatMessage) => {
    const pending = pendingMediaRef.current.get(message.client_id);
    if (pending) void transmitMediaMessage(message, pending);
    else void transmitMessage(message);
  }, [transmitMediaMessage, transmitMessage]);

  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!userId || message.id.startsWith('local:')) return;
    const existing = reactions[message.id]?.some((reaction) => reaction.emoji === emoji && reaction.mine);
    const result = existing
      ? await supabase.from('message_reactions').delete().eq('message_id', message.id).eq('user_id', userId).eq('emoji', emoji)
      : await supabase.from('message_reactions').insert({ message_id: message.id, user_id: userId, emoji });
    if (result.error) {
      Alert.alert('Could not update reaction', result.error.message);
      return;
    }
    try {
      await loadReactions(messagesRef.current);
    } catch (reactionError) {
      Alert.alert('Could not refresh reactions', reactionError instanceof Error ? reactionError.message : 'Try again.');
    }
  }, [loadReactions, reactions, supabase, userId]);

  const deleteMessage = async (message: ChatMessage) => {
    if (!userId || message.sender_id !== userId) return;
    const { error: deleteError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', message.id)
      .eq('sender_id', userId ?? '');
    if (deleteError) {
      Alert.alert('Could not delete message', deleteError.message);
      return;
    }
    setMessages((current) => current.map((entry) =>
      entry.id === message.id ? { ...entry, deleted_at: new Date().toISOString() } : entry,
    ));
    if (message.media_path) {
      try {
        await removeChatMedia(supabase, message.media_path);
      } catch (cleanupError) {
        Alert.alert(
          'Message deleted',
          cleanupError instanceof Error
            ? `The media file could not be removed from storage: ${cleanupError.message}`
            : 'The media file could not be removed from storage.',
        );
      }
    }
  };

  const copyMessage = async (message: ChatMessage) => {
    if (message.body) {
      try {
        await Clipboard.setStringAsync(message.body);
      } catch (copyError) {
        Alert.alert('Could not copy message', copyError instanceof Error ? copyError.message : 'Try again.');
      }
    }
  };

  const reportMessage = async () => {
    if (!userId || !reportTarget || !reportReason.trim()) return;
    const { error: reportError } = await supabase.from('reports').insert({
      reporter_id: userId,
      target_type: reportTarget.type,
      target_id: reportTarget.id,
      reason: reportReason.trim(),
    });
    if (reportError) {
      Alert.alert('Could not submit report', reportError.message);
      return;
    }
    setReportOpen(false);
    setMenuMessage(null);
    setReportTarget(null);
    setReportReason('');
  };

  const blockPeer = () => {
    if (!peer || !userId) return;
    Alert.alert('Block this person?', 'They will no longer be able to message you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          void supabase.from('blocks').insert({ blocker_id: userId, blocked_id: peer.id })
            .then(({ error: blockError }) => {
              if (blockError) Alert.alert('Could not block this person', blockError.message);
              else router.back();
            });
        },
      },
    ]);
  };

  const renderMessage = useCallback(({ item, index }: { item: ChatMessage; index: number }) => {
    const mine = item.sender_id === userId;
    const sender = profiles.find((profile) => profile.id === item.sender_id);
    const older = messages[index + 1];
    const showDate = !older || dateLabel(item.created_at) !== dateLabel(older.created_at);
    const groupedWithOlder = Boolean(
      older
      && older.sender_id === item.sender_id
      && Math.abs(new Date(item.created_at).getTime() - new Date(older.created_at).getTime()) < 3 * 60 * 1000,
    );
    const visibleBody = item.deleted_at
      ? 'This message was deleted'
      : item.body ?? ({
        image: 'Photo',
        video: 'Video',
        voice: 'Voice message',
        call: 'Call',
        system: '',
        text: '',
      }[item.kind] ?? '');
    const storyPreviewIsVideo = Boolean(item.story_reply_preview_path && /\.(mp4|mov)$/i.test(item.story_reply_preview_path));
    const itemReactions = reactions[item.id] ?? [];
    return (
      <View>
        {showDate ? <View style={styles.dateDivider}><Text style={styles.dateText}>{dateLabel(item.created_at)}</Text></View> : null}
        {conversation?.type === 'group' && !groupedWithOlder && !mine && sender ? (
          <NameWithBadge name={sender.display_name} userId={sender.id} size="xs" textStyle={styles.senderName} />
        ) : null}
        <View style={[styles.messageLine, mine && styles.messageLineMine]}>
          <Pressable
            onLongPress={() => setMenuMessage(item)}
            delayLongPress={350}
            style={[
              styles.messageBubble,
              mine ? styles.sentBubble : styles.receivedBubble,
              item.kind === 'system' && styles.systemBubble,
              groupedWithOlder && styles.groupedBubble,
            ]}
            accessibilityRole="text"
          >
            {item.replyPreview || item.reply_to_id ? (
              <View style={styles.replyQuote}>
                <Text style={styles.replyQuoteText} numberOfLines={2}>
                  {item.replyPreview ?? messages.find((message) => message.id === item.reply_to_id)?.body ?? 'Replied message'}
                </Text>
              </View>
            ) : null}
            {item.story_reply_preview_path && !item.deleted_at ? (
              <View style={styles.storyReplyCard}>
                {signedMediaUrls[item.story_reply_preview_path] ? (
                  storyPreviewIsVideo ? (
                    <StoryReplyVideoPreview uri={signedMediaUrls[item.story_reply_preview_path]} />
                  ) : (
                    <Image source={{ uri: signedMediaUrls[item.story_reply_preview_path] }} style={styles.storyReplyImage} />
                  )
                ) : (
                  <Pressable
                    onPress={() => void refreshSignedMedia(item.story_reply_preview_path!)}
                    style={styles.storyReplyImagePlaceholder}
                    accessibilityRole="button"
                    accessibilityLabel={storyPreviewIsVideo ? 'Video story preview' : 'Load story preview'}
                  >
                    {storyPreviewIsVideo ? (
                      <Icon name="play" size={20} color={theme.colors.white} />
                    ) : (
                      <Text style={styles.storyReplyPlaceholderText}>Story</Text>
                    )}
                  </Pressable>
                )}
                <View style={styles.storyReplyContent}>
                  <Text style={styles.storyReplyLabel}>{item.sender_id === userId ? 'You replied to their story' : 'Replied to your story'}</Text>
                  {item.story_reply_caption ? (
                    <Text numberOfLines={2} style={styles.storyReplyCaption}>{item.story_reply_caption}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            {item.deleted_at ? (
              <Text style={[styles.messageText, styles.deletedText]}>{visibleBody}</Text>
            ) : item.kind === 'image' || item.kind === 'video' || item.kind === 'voice' ? (
              <ChatMediaMessage
                kind={item.kind}
                uri={item.media_path ? signedMediaUrls[item.media_path] ?? null : null}
                localUri={localMediaUris[item.client_id] ?? null}
                durationMs={item.media_duration_ms}
                width={item.width}
                height={item.height}
                loading={Boolean(item.media_path && mediaLoadStatus[item.media_path] === 'loading')}
                error={item.media_path && mediaLoadStatus[item.media_path] === 'error' ? 'Could not load this private attachment.' : null}
                onRetry={() => {
                  if (item.media_path) {
                    setMediaLoadStatus((current) => {
                      const next = { ...current };
                      delete next[item.media_path as string];
                      return next;
                    });
                    void refreshSignedMedia(item.media_path);
                  }
                }}
              />
            ) : (
              <Text style={[styles.messageText, mine && styles.sentMessageText, item.kind === 'system' && styles.systemText]}>
                {visibleBody}
              </Text>
            )}
            {item.deliveryState === 'failed' ? (
              <Pressable onPress={() => retryMessage(item)} accessibilityRole="button">
                <Text style={styles.failedText}>Message not sent. Tap to retry.</Text>
              </Pressable>
            ) : item.deliveryState === 'sending' ? (
              <Text style={styles.deliveryText}>Sending</Text>
            ) : null}
            {mine && latestMine?.id === item.id && latestIsSeen ? <Text style={styles.seenText}>Seen</Text> : null}
          </Pressable>
        </View>
        {itemReactions.length ? (
          <View style={[styles.reactionsRow, mine && styles.reactionsRowMine]}>
            {itemReactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                onPress={() => void toggleReaction(item, reaction.emoji)}
                style={[styles.reactionChip, reaction.mine && styles.reactionChipMine]}
                accessibilityRole="button"
                accessibilityLabel={`${reaction.emoji}, ${reaction.count} reactions`}
              >
                <Text style={styles.reactionText}>{reaction.emoji} {reaction.count}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {!groupedWithOlder && item.kind !== 'system' ? (
          <Text style={[styles.timestamp, mine && styles.timestampMine]}>{timeLabel(item.created_at)}</Text>
        ) : null}
      </View>
    );
  }, [
    conversation?.type,
    latestIsSeen,
    latestMine?.id,
    localMediaUris,
    mediaLoadStatus,
    messages,
    profiles,
    reactions,
    refreshSignedMedia,
    retryMessage,
    signedMediaUrls,
    toggleReaction,
    userId,
  ]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrolledUp = event.nativeEvent.contentOffset.y > 220;
    showScrollButtonRef.current = scrolledUp;
    setShowScrollButton(scrolledUp);
    if (!scrolledUp) setNewMessageCount(0);
  }, []);

  if (loading && !conversation) {
    return (
      <ChatScreenLayout
        style={styles.screen}
        header={(
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
              <Icon name="back" size={20} color={theme.colors.white} />
            </Pressable>
            <Text style={styles.headerTitle}>Chat</Text>
            <View style={styles.headerButton} />
          </View>
        )}
        list={(
          <View style={styles.loadingBubbles}>
            <View style={[styles.loadingBubble, styles.loadingBubbleOther]} />
            <View style={[styles.loadingBubble, styles.loadingBubbleMine]} />
            <View style={[styles.loadingBubble, styles.loadingBubbleOther]} />
          </View>
        )}
        composer={<View style={styles.loadingComposer} />}
      />
    );
  }

  if (error || !conversation) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="back" size={20} color={theme.colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>{error || 'This conversation is unavailable.'}</Text>
          <Pressable onPress={() => {
            setLoading(true);
            setError('');
            void loadConversation().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load this conversation.')).finally(() => setLoading(false));
          }} style={styles.retryButton} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
      <ChatScreenLayout
        style={styles.screen}
        header={(
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
              <Icon name="back" size={20} color={theme.colors.white} />
            </Pressable>
            <View style={styles.headerAvatar}>
              {peer?.avatar_url ? (
                <Image source={{ uri: peer.avatar_url }} style={styles.headerAvatarImage} />
              ) : (
                <Text style={styles.headerAvatarInitial}>{title.trim().charAt(0).toUpperCase() || '?'}</Text>
              )}
            </View>
            <View style={styles.headerIdentity}>
              {conversation.type === 'group' ? (
                <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              ) : (
                <NameWithBadge name={title} userId={peer?.id} size="sm" textStyle={styles.headerTitle} />
              )}
              {statusLine ? <Text style={styles.statusText}>{statusLine}</Text> : null}
            </View>
            <View style={styles.callButtons}>
              {conversation.type === 'direct' && !conversation.read_only ? (
                <>
                  <Pressable
                    onPress={() => router.push({
                      pathname: '/call/[conversationId]',
                      params: { conversationId, mode: 'audio' },
                    })}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel="Start voice call"
                  >
                    <Icon name="mic" size={20} color={theme.colors.white} />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push({
                      pathname: '/call/[conversationId]',
                      params: { conversationId, mode: 'video' },
                    })}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel="Start video call"
                  >
                    <Icon name="video" size={20} color={theme.colors.white} />
                  </Pressable>
                </>
              ) : null}
              <Pressable onPress={() => setHeaderMenuOpen(true)} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Chat options">
                <Icon name="more" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
          </View>
        )}
        notice={networkState.isConnected === false || networkState.isInternetReachable === false
          ? <View style={styles.offlineBanner}><Text style={styles.offlineText}>You are offline</Text></View>
          : null}
        list={(
          <View style={styles.listRegion}>
            {loadingOlder ? <ActivityIndicator color={theme.colors.primary} style={styles.olderLoading} /> : null}
            <FlatList
              ref={listRef}
              data={messages}
              inverted
              keyExtractor={(message) => message.id}
              renderItem={renderMessage}
              onEndReached={handleLoadOlder}
              onEndReachedThreshold={0.25}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={messageViewability}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              initialNumToRender={20}
              maxToRenderPerBatch={10}
              windowSize={7}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={remoteTyping ? <TypingDots /> : null}
              ListEmptyComponent={!remoteTyping ? (
                <View style={styles.emptyThread}>
                  <Text style={styles.emptyThreadText}>Say hello to {title}.</Text>
                </View>
              ) : null}
            />
            {showScrollButton ? (
              <Pressable
                onPress={() => {
                  listRef.current?.scrollToOffset({ offset: 0, animated: true });
                  setNewMessageCount(0);
                }}
                style={styles.scrollBottom}
                accessibilityRole="button"
                accessibilityLabel="Scroll to latest message"
              >
                <View style={styles.scrollIcon}>
                  <Icon name="chevronRight" size={20} color={theme.colors.white} />
                </View>
                {newMessageCount > 0 ? (
                  <Text style={styles.newMessageCount}>{newMessageCount}</Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        )}
        composer={!conversation.read_only ? (
          <View style={styles.composer}>
            {replyTo ? (
              <View style={styles.replyPreview}>
                <View style={styles.replyPreviewContent}>
                  <Text style={styles.replyPreviewLabel}>Replying to {replyTo.sender_id === userId ? 'your message' : title}</Text>
                  <Text style={styles.replyPreviewBody} numberOfLines={1}>{replyTo.body ?? 'Message'}</Text>
                </View>
                <Pressable onPress={() => setReplyTo(null)} accessibilityRole="button" accessibilityLabel="Cancel reply">
                  <Icon name="close" size={20} color={theme.colors.textMuted} />
                </Pressable>
              </View>
            ) : null}
            <ChatMediaComposer
              attachment={attachment}
              disabled={sending}
              showVoiceRecorder={!draft.trim() && !attachment}
              onAttachment={setAttachment}
              onClear={() => setAttachment(null)}
            />
            <View style={styles.inputRow}>
              <FocusableTextInput
                value={draft}
                onChangeText={(value) => {
                  setDraft(value);
                  if (value.trim()) sendTyping();
                }}
                onContentSizeChange={(event) => {
                  setComposerInputHeight(calculateChatComposerHeight(event.nativeEvent.contentSize.height));
                }}
                placeholder="Message"
                placeholderTextColor={theme.colors.textMuted}
                style={[styles.messageInput, { height: composerInputHeight }]}
                multiline
                maxLength={2000}
                accessibilityLabel="Message"
                onFocus={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
                onSubmitEditing={() => void submitMessage()}
                submitBehavior="newline"
              />
              {draft.trim() || attachment || sending ? (
                <Pressable
                  onPress={() => void submitMessage()}
                  disabled={sending || (!draft.trim() && !attachment)}
                  style={[styles.sendButton, (sending || (!draft.trim() && !attachment)) && styles.sendButtonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  {sending ? <ActivityIndicator size="small" color={theme.colors.black} /> : <Icon name="send" size={20} color={theme.colors.black} />}
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      />

      <Modal transparent visible={menuMessage !== null} animationType="fade" onRequestClose={() => setMenuMessage(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuMessage(null)}>
          <View style={styles.messageMenu} onStartShouldSetResponder={() => true}>
            <View style={styles.emojiRow}>
              {quickReactions.map((emoji) => (
                <Pressable key={emoji} onPress={() => {
                  if (menuMessage) void toggleReaction(menuMessage, emoji);
                  setMenuMessage(null);
                }} style={styles.quickEmoji} accessibilityRole="button" accessibilityLabel={`React ${emoji}`}>
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {[
              { label: 'Reply', action: () => setReplyTo(menuMessage) },
              { label: 'Copy', action: () => { if (menuMessage) void copyMessage(menuMessage); } },
              ...(menuMessage?.sender_id === userId ? [{ label: 'Delete', action: () => { if (menuMessage) void deleteMessage(menuMessage); } }] : []),
              { label: 'Report', action: () => {
                if (menuMessage) setReportTarget({ type: 'message', id: menuMessage.id });
                setReportOpen(true);
              } },
            ].map((item) => (
              <Pressable key={item.label} onPress={() => {
                item.action();
                setMenuMessage(null);
              }} style={styles.menuItem} accessibilityRole="button">
                <Text style={styles.menuItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={headerMenuOpen} animationType="fade" onRequestClose={() => setHeaderMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setHeaderMenuOpen(false)}>
          <View style={styles.messageMenu}>
            {peer ? (
              <Pressable onPress={() => { setHeaderMenuOpen(false); blockPeer(); }} style={styles.menuItem} accessibilityRole="button">
                <Text style={styles.dangerMenuText}>Block {peer.display_name}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => {
              setHeaderMenuOpen(false);
              setReportTarget({ type: 'conversation', id: conversationId });
              setReportOpen(true);
            }} style={styles.menuItem} accessibilityRole="button">
              <Text style={styles.menuItemText}>Report conversation</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={reportOpen} animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <KeyboardAwareScreen style={{ flex: 1 }}>
          <View style={styles.reportBackdrop}>
            <View style={styles.reportCard}>
              <Text style={styles.reportTitle}>Report this chat</Text>
              <Text style={styles.reportCopy}>Tell us why you are reporting this content.</Text>
              <FocusableTextInput
                value={reportReason}
                onChangeText={setReportReason}
                style={styles.reportInput}
                placeholder="Reason"
                placeholderTextColor={theme.colors.textMuted}
                maxLength={500}
                accessibilityLabel="Report reason"
              />
              <View style={styles.reportActions}>
                <Pressable onPress={() => setReportOpen(false)} style={styles.reportCancel} accessibilityRole="button">
                  <Text style={styles.reportCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void reportMessage()}
                  disabled={!reportReason.trim()}
                  style={[styles.reportSubmit, !reportReason.trim() && styles.sendButtonDisabled]}
                  accessibilityRole="button"
                >
                  <Text style={styles.reportSubmitText}>Submit report</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  loadingBubbles: { flex: 1, minHeight: 120, justifyContent: 'flex-end', gap: 12, padding: 16 },
  loadingBubble: { height: 42, width: '68%', borderRadius: 16, backgroundColor: theme.colors.surface },
  loadingBubbleOther: { alignSelf: 'flex-start' },
  loadingBubbleMine: { alignSelf: 'flex-end', width: '52%' },
  loadingComposer: { height: 64, backgroundColor: theme.colors.surface, borderRadius: 16, margin: 12 },
  header: {
    minHeight: 62,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: theme.colors.surface },
  headerAvatarImage: { width: '100%', height: '100%' },
  headerAvatarInitial: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  headerIdentity: { flex: 1, alignItems: 'center', minWidth: 0 },
  headerTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '800' },
  statusText: { color: theme.colors.primary, fontSize: 11, marginTop: 2 },
  callButtons: { flexDirection: 'row', alignItems: 'center' },
  offlineBanner: { backgroundColor: '#36230D', paddingVertical: 7 },
  offlineText: { color: '#FBBF24', textAlign: 'center', fontSize: 12, fontWeight: '700' },
  listRegion: { flex: 1, minHeight: 120, position: 'relative' },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 14, paddingVertical: 12 },
  olderLoading: { padding: 8 },
  dateDivider: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: '#171C22', marginVertical: 12 },
  dateText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  senderName: { color: theme.colors.textMuted, fontSize: 11, marginLeft: 8, marginBottom: 4, marginTop: 6 },
  messageLine: { flexDirection: 'row', justifyContent: 'flex-start', marginVertical: 2 },
  messageLineMine: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '82%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },
  sentBubble: { backgroundColor: theme.colors.primary, borderBottomRightRadius: 6 },
  receivedBubble: { backgroundColor: theme.colors.surface, borderBottomLeftRadius: 6 },
  groupedBubble: { marginTop: 1 },
  systemBubble: { alignSelf: 'center', backgroundColor: '#171C22', maxWidth: '90%', borderRadius: 14 },
  messageText: { color: theme.colors.white, fontSize: 15, lineHeight: 21 },
  sentMessageText: { color: theme.colors.black },
  systemText: { color: theme.colors.textMuted, textAlign: 'center', fontSize: 13 },
  deletedText: { fontStyle: 'italic', opacity: 0.7 },
  replyQuote: { borderLeftWidth: 2, borderLeftColor: theme.colors.primary, paddingLeft: 8, marginBottom: 6 },
  replyQuoteText: { color: theme.colors.textMuted, fontSize: 12 },
  storyReplyCard: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7, padding: 6, borderRadius: 10, backgroundColor: 'rgba(15,23,42,0.12)' },
  storyReplyImage: { width: 44, height: 54, borderRadius: 6, backgroundColor: theme.colors.surface },
  storyReplyImagePlaceholder: { width: 44, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: theme.colors.surface },
  storyReplyPlaceholderText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' },
  storyReplyContent: { flex: 1 },
  storyReplyLabel: { color: theme.colors.primary, fontSize: 11, fontWeight: '800' },
  storyReplyCaption: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 },
  timestamp: { color: theme.colors.textMuted, fontSize: 10, marginLeft: 10, marginBottom: 4 },
  timestampMine: { textAlign: 'right', marginRight: 10, marginLeft: 0 },
  seenText: { color: theme.colors.black, fontSize: 10, fontWeight: '700', marginTop: 4, textAlign: 'right' },
  failedText: { color: theme.colors.danger, fontSize: 11, marginTop: 6 },
  deliveryText: { color: 'rgba(0,0,0,0.6)', fontSize: 10, marginTop: 4, textAlign: 'right' },
  reactionsRow: { flexDirection: 'row', gap: 5, marginLeft: 8, marginBottom: 3 },
  reactionsRowMine: { justifyContent: 'flex-end', marginRight: 8, marginLeft: 0 },
  reactionChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  reactionChipMine: { borderColor: theme.colors.primary },
  reactionText: { color: theme.colors.white, fontSize: 11 },
  typingBubble: { alignSelf: 'flex-start', flexDirection: 'row', gap: 4, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: theme.colors.surface, margin: 6 },
  typingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.white },
  emptyThread: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyThreadText: { color: theme.colors.textMuted, fontSize: 15, textAlign: 'center' },
  scrollBottom: { position: 'absolute', right: 18, bottom: 12, minWidth: 44, height: 44, borderRadius: 22, backgroundColor: '#25313C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  scrollIcon: { transform: [{ rotate: '90deg' }] },
  newMessageCount: { color: theme.colors.white, fontSize: 10, fontWeight: '700' },
  composer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.line, backgroundColor: theme.colors.black },
  replyPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8, marginBottom: 7, borderRadius: 10, backgroundColor: theme.colors.surface },
  replyPreviewContent: { flex: 1 },
  replyPreviewLabel: { color: theme.colors.primary, fontSize: 11, fontWeight: '700' },
  replyPreviewBody: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageInput: { flex: 1, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: '#171C22', color: theme.colors.white, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.45 },
  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  messageMenu: { margin: 12, padding: 10, borderRadius: 18, backgroundColor: '#111418', borderWidth: 1, borderColor: theme.colors.line },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  quickEmoji: { minWidth: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 23 },
  menuItem: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  menuItemText: { color: theme.colors.white, fontSize: 15 },
  dangerMenuText: { color: theme.colors.danger, fontSize: 15, fontWeight: '700' },
  reportBackdrop: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.65)' },
  reportCard: { padding: 18, borderRadius: 20, backgroundColor: '#111418', borderWidth: 1, borderColor: theme.colors.line },
  reportTitle: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  reportCopy: { color: theme.colors.textMuted, fontSize: 14, marginTop: 7, marginBottom: 14 },
  reportInput: { minHeight: 90, padding: 12, borderRadius: 12, backgroundColor: '#171C22', color: theme.colors.white, textAlignVertical: 'top' },
  reportActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  reportCancel: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line },
  reportCancelText: { color: theme.colors.white, fontWeight: '700' },
  reportSubmit: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.colors.primary },
  reportSubmitText: { color: theme.colors.black, fontWeight: '800' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  errorText: { color: theme.colors.textMuted, textAlign: 'center', lineHeight: 22 },
  retryButton: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  retryText: { color: theme.colors.black, fontWeight: '800' },
});
