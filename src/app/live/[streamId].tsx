import {
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  registerGlobals,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import {
  endLive,
  getLiveMessages,
  getLiveStream,
  moderateLive,
  requestLiveConnection,
  sendLiveMessage,
  subscribeToLiveMessages,
  markLiveStarted,
  heartbeatLive,
  type LiveConnection,
} from '../../features/live/liveService';
import { getSupabaseClient } from '../../lib/supabase';
import type { LiveMessageRow, LiveStreamRpcRow } from '../../types/database';
import { theme } from '../../theme/theme';

registerGlobals();

const supabase = getSupabaseClient();

function LiveRoomContent({
  host,
  stream,
  messages,
  message,
  setMessage,
  sending,
  error,
  ended,
  onSend,
  onEnd,
  onClose,
  onModerate,
}: {
  host: boolean;
  stream: LiveStreamRpcRow;
  messages: LiveMessageRow[];
  message: string;
  setMessage: (value: string) => void;
  sending: boolean;
  error: string;
  ended: boolean;
  onSend: () => void;
  onEnd: () => void;
  onClose: () => void;
  onModerate: (item: LiveMessageRow) => void;
}) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const videoTrack = tracks.find((track) => (host ? track.participant.isLocal : !track.participant.isLocal));
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState('');

  const toggleMicrophone = async () => {
    setControlBusy(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(!microphoneEnabled);
      setMicrophoneEnabled((enabled) => !enabled);
      setControlError('');
    } catch (caught) {
      setControlError(caught instanceof Error ? caught.message : 'Could not change microphone settings.');
    } finally {
      setControlBusy(false);
    }
  };

  const toggleCamera = async () => {
    setControlBusy(true);
    try {
      await room.localParticipant.setCameraEnabled(!cameraEnabled);
      setCameraEnabled((enabled) => !enabled);
      setControlError('');
    } catch (caught) {
      setControlError(caught instanceof Error ? caught.message : 'Could not change camera settings.');
    } finally {
      setControlBusy(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.room}>
      {videoTrack && isTrackReference(videoTrack) ? (
        <VideoTrack trackRef={videoTrack} style={styles.video} objectFit="cover" />
      ) : (
        <View style={styles.videoPlaceholder}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.placeholderText}>{ended ? 'This live has ended.' : 'Connecting to the live stream…'}</Text>
        </View>
      )}
      <View style={styles.shade} pointerEvents="none" />
      <View style={styles.topBar}>
        <View style={styles.streamHeading}>
          <View style={styles.livePill}><Text style={styles.livePillText}>{ended ? 'ENDED' : 'LIVE'}</Text></View>
          <Text numberOfLines={1} style={styles.streamTitle}>{stream.title || 'Live stream'}</Text>
          <Text numberOfLines={1} style={styles.hostName}>{stream.host_display_name} · @{stream.host_username}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close live stream">
          <Icon name="close" size={24} color={theme.colors.white} />
        </Pressable>
      </View>

      <View style={styles.bottomPanel}>
        {error || controlError ? <Text style={styles.errorText}>{error || controlError}</Text> : null}
        <FlatList
          data={[...messages].reverse()}
          inverted
          keyExtractor={(item) => item.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => host && onModerate(item)}
              disabled={!host || Boolean(item.deleted_at)}
              style={styles.messageBubble}
              accessibilityRole={host ? 'button' : 'text'}
              accessibilityLabel={host ? `Moderate live message from ${item.author_id}` : undefined}
            >
              <Text style={styles.messageAuthor}>{item.author_id.slice(0, 8)}</Text>
              <Text style={[styles.messageBody, item.deleted_at && styles.deletedMessage]}>{item.body}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.chatHint}>Say hello in the live chat.</Text>}
        />
        <View style={styles.chatComposer}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Say something…"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.chatInput}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={onSend}
            editable={!sending && !ended}
            accessibilityLabel="Live chat message"
          />
          <Pressable onPress={onSend} disabled={sending || ended || !message.trim()} style={styles.sendButton} accessibilityRole="button" accessibilityLabel="Send live chat message">
            {sending ? <ActivityIndicator color={theme.colors.black} /> :             <Icon name="send" size={20} color={theme.colors.black} />}
          </Pressable>
        </View>
        {host ? (
          <View style={styles.hostControls}>
            <Pressable disabled={controlBusy} onPress={() => void toggleMicrophone()} style={styles.controlButton} accessibilityRole="button" accessibilityLabel={microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
              <Icon name="mic" size={20} color={theme.colors.white} />
              <Text style={styles.controlText}>{microphoneEnabled ? 'Mute' : 'Unmute'}</Text>
            </Pressable>
            <Pressable disabled={controlBusy} onPress={() => void toggleCamera()} style={styles.controlButton} accessibilityRole="button" accessibilityLabel={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
              <Icon name="video" size={20} color={theme.colors.white} />
              <Text style={styles.controlText}>{cameraEnabled ? 'Camera on' : 'Camera off'}</Text>
            </Pressable>
            <Pressable onPress={onEnd} style={styles.endButton} accessibilityRole="button">
              <Text style={styles.endButtonText}>End live</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAwareScreen>
  );
}

export default function LiveStreamScreen() {
  const params = useLocalSearchParams<{ streamId?: string | string[] }>();
  const streamId = Array.isArray(params.streamId) ? params.streamId[0] : params.streamId;
  const [stream, setStream] = useState<LiveStreamRpcRow | null>(null);
  const [connection, setConnection] = useState<LiveConnection | null>(null);
  const [connectionIssuedAt, setConnectionIssuedAt] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveMessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [ended, setEnded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const [audioReady, setAudioReady] = useState(false);
  const startConfirmed = useRef(false);
  const ending = useRef(false);
  const streamIsHost = Boolean(userId && stream?.host_id === userId);
  const hasConnectionToken = Boolean(connection?.token);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppIsActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!streamId) return undefined;
    let mounted = true;
    void (async () => {
      try {
        const [{ data: auth, error: authError }, liveStream] = await Promise.all([
          supabase.auth.getUser(),
          getLiveStream(streamId),
        ]);
        if (authError) throw authError;
        if (!auth.user) throw new Error('Sign in to watch live streams.');
        if (!mounted) return;
        setUserId(auth.user.id);
        setStream(liveStream);
        const liveConnection = await requestLiveConnection(streamId);
        if (mounted) {
          setConnection(liveConnection);
          setConnectionIssuedAt(Date.now());
        }
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : 'Could not connect to this live stream.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [streamId]);

  useEffect(() => {
    if (!streamId || !connection || connectionIssuedAt === null || !focused || !appIsActive || ended) {
      return undefined;
    }
    let mounted = true;
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleRefresh = (delay: number) => {
      timeout = setTimeout(() => { void refreshConnection(); }, delay);
    };
    const refreshConnection = async () => {
      try {
        const refreshed = await requestLiveConnection(streamId);
        if (!mounted) return;
        setConnection(refreshed);
        setConnectionIssuedAt(Date.now());
        setError('');
      } catch (caught) {
        if (!mounted) return;
        const detail = caught instanceof Error ? caught.message : 'Try again shortly.';
        setError(`Live connection token refresh failed: ${detail}`);
        scheduleRefresh(30_000);
      }
    };
    scheduleRefresh(Math.max(0, connectionIssuedAt + 8 * 60_000 - Date.now()));
    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [appIsActive, connection, connectionIssuedAt, ended, focused, streamId]);

  useEffect(() => {
    if (!streamId) return undefined;
    let mounted = true;
    void getLiveMessages(streamId)
      .then((rows) => { if (mounted) setMessages(rows); })
      .catch((caught: unknown) => {
        if (mounted) setMessageError(caught instanceof Error ? caught.message : 'Live chat could not be loaded.');
      });
    const messageChannel = subscribeToLiveMessages(streamId, (row, event) => {
      setMessages((current) => {
        if (event === 'UPDATE') return current.map((item) => item.id === row.id ? row : item);
        return current.some((item) => item.id === row.id) ? current : [...current, row];
      });
    });
    const statusChannel = supabase
      .channel(`live-status:${streamId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${streamId}` }, (payload) => {
        const updated = payload.new as LiveStreamRpcRow;
        if (updated.status === 'ended') setEnded(true);
      })
      .subscribe((status, subscribeError) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Live stream status subscription failed.', subscribeError);
        }
      });
    return () => {
      mounted = false;
      void supabase.removeChannel(messageChannel);
      void supabase.removeChannel(statusChannel);
    };
  }, [streamId]);

  useEffect(() => {
    if (!hasConnectionToken || !focused || !appIsActive) return undefined;
    let mounted = true;
    void AudioSession.startAudioSession()
      .then(() => { if (mounted) setAudioReady(true); })
      .catch((caught: unknown) => {
        if (mounted) setError(caught instanceof Error ? caught.message : 'Could not start audio for the live stream.');
      });
    return () => {
      mounted = false;
      setAudioReady(false);
      void AudioSession.stopAudioSession();
    };
  }, [appIsActive, focused, hasConnectionToken]);

  useEffect(() => {
    if (!streamId || !streamIsHost || !startConfirmed.current || ended) return undefined;
    const heartbeat = setInterval(() => {
      void heartbeatLive(streamId).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'The live connection was lost.');
        setEnded(true);
      });
    }, 30_000);
    return () => clearInterval(heartbeat);
  }, [ended, streamId, streamIsHost]);

  useEffect(() => {
    if (!ended) return undefined;
    const timeout = setTimeout(() => router.back(), 3000);
    return () => clearTimeout(timeout);
  }, [ended]);

  const handleConnected = useCallback(() => {
    if (!streamId || connection?.role !== 'host' || startConfirmed.current) return;
    startConfirmed.current = true;
    void markLiveStarted(streamId)
      .then(() => getLiveStream(streamId))
      .then(setStream)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not begin live publishing.');
        void endLive(streamId).catch((endError: unknown) => console.error('Could not stop a failed live startup.', endError));
      });
  }, [connection?.role, streamId]);

  const finishStream = async () => {
    if (!streamId || ending.current) return;
    ending.current = true;
    try {
      await endLive(streamId);
      setEnded(true);
      router.back();
    } catch (caught) {
      ending.current = false;
      Alert.alert('Could not end live stream', caught instanceof Error ? caught.message : 'Try again.');
    }
  };

  const closeStream = () => {
    if (streamIsHost) {
      Alert.alert('End live stream?', 'Viewers will be disconnected.', [
        { text: 'Stay live', style: 'cancel' },
        { text: 'End live', style: 'destructive', onPress: () => void finishStream() },
      ]);
    } else {
      router.back();
    }
  };

  const sendMessage = async () => {
    if (!streamId || sending || !draft.trim() || ended) return;
    setSending(true);
    try {
      await sendLiveMessage(streamId, draft.trim());
      setDraft('');
      setMessageError('');
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : 'Could not send live chat message.');
    } finally {
      setSending(false);
    }
  };

  const moderateMessage = (item: LiveMessageRow) => {
    if (!streamIsHost || !streamId || item.author_id === userId) return;
    const runModeration = async (action: Parameters<typeof moderateLive>[1]) => {
      try {
        const result = await moderateLive(streamId, action);
        if (result.warning) Alert.alert('Moderation warning', result.warning);
      } catch (caught) {
        showModerationError(caught);
      }
    };
    Alert.alert('Moderate viewer', 'Choose an action for this viewer.', [
      { text: 'Mute for 5 minutes', onPress: () => void runModeration({ action: 'mute', userId: item.author_id }) },
      { text: 'Ban from this live', style: 'destructive', onPress: () => void runModeration({ action: 'ban', userId: item.author_id }) },
      { text: 'Delete message', onPress: () => void runModeration({ action: 'delete_message', messageId: item.id }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const showModerationError = (caught: unknown) => {
    Alert.alert('Could not moderate viewer', caught instanceof Error ? caught.message : 'Try again.');
  };

  const room = connection && audioReady && focused && appIsActive && stream && !ended ? (
      <LiveKitRoom
          key={connection.token}
          serverUrl={connection.serverUrl}
        token={connection.token}
        connect
        audio={streamIsHost}
        video={streamIsHost}
        options={{ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }}
        onConnected={handleConnected}
        onDisconnected={() => undefined}
        onError={(roomError) => setError(roomError.message || 'The live stream connection failed.')}
        onMediaDeviceFailure={() => setError('Camera or microphone permission is unavailable.')}
      >
        <LiveRoomContent
          host={streamIsHost}
          stream={stream}
          messages={messages}
          message={draft}
          setMessage={setDraft}
          sending={sending}
          error={error || messageError}
          ended={ended}
          onSend={() => void sendMessage()}
          onEnd={() => void finishStream()}
          onClose={closeStream}
          onModerate={moderateMessage}
        />
      </LiveKitRoom>
  ) : null;

  if (!streamId) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorHeading}>A live stream was not selected.</Text>
        <Pressable onPress={() => router.back()} style={styles.backAction} accessibilityRole="button">
          <Text style={styles.backActionText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (loading || (!error && (!stream || !userId))) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} size="large" /></View>;
  }

  if (error && !connection) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorHeading}>Could not open live stream</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => router.back()} style={styles.backAction} accessibilityRole="button">
          <Text style={styles.backActionText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {room ?? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text style={styles.placeholderText}>{ended ? 'This live has ended.' : 'Reconnecting to live…'}</Text>
          <Pressable onPress={closeStream} style={styles.backAction} accessibilityRole="button">
            <Text style={styles.backActionText}>{streamIsHost ? 'End live' : 'Leave'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  room: { flex: 1, backgroundColor: '#000000' },
  video: { ...StyleSheet.absoluteFill },
  videoPlaceholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#101820' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.14)' },
  topBar: { position: 'absolute', top: 52, left: 14, right: 14, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  streamHeading: { flex: 1, marginRight: 8 },
  livePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: theme.colors.danger },
  livePillText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  streamTitle: { marginTop: 8, color: theme.colors.white, fontSize: 18, fontWeight: '900' },
  hostName: { marginTop: 3, color: '#E2E8F0', fontSize: 12 },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)' },
  bottomPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 18, backgroundColor: 'rgba(0,0,0,0.48)' },
  messageList: { maxHeight: 200 },
  messageListContent: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 8 },
  messageBubble: { alignSelf: 'flex-start', maxWidth: '92%', marginVertical: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.76)' },
  messageAuthor: { color: theme.colors.primary, fontSize: 10, fontWeight: '800' },
  messageBody: { color: theme.colors.white, fontSize: 13, marginTop: 2 },
  deletedMessage: { color: theme.colors.textMuted, fontStyle: 'italic' },
  chatHint: { padding: 10, color: '#E2E8F0', fontSize: 12 },
  chatComposer: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chatInput: { flex: 1, minHeight: 42, paddingHorizontal: 13, borderRadius: 21, backgroundColor: 'rgba(15,23,42,0.9)', color: theme.colors.white, fontSize: 13 },
  sendButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.colors.primary },
  hostControls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: 10 },
  controlButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 8 },
  controlText: { color: theme.colors.white, fontSize: 10, fontWeight: '700' },
  endButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, backgroundColor: theme.colors.danger },
  endButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  placeholderText: { color: theme.colors.white, fontSize: 14, textAlign: 'center' },
  errorText: { marginBottom: 4, color: '#FCA5A5', fontSize: 12, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: theme.colors.black },
  errorHeading: { color: theme.colors.white, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  backAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, backgroundColor: theme.colors.primary },
  backActionText: { color: theme.colors.black, fontWeight: '800' },
});
