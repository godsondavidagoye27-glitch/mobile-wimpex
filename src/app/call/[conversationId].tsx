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
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import {
  requestCallAction,
  subscribeToCall,
  type CallResponse,
  type CallSession,
} from '../../features/calls/callService';
import { isTerminalCallStatus } from '../../features/calls/callPolicy';
import { theme } from '../../theme/theme';

registerGlobals();

type RouteParams = {
  conversationId?: string;
  callId?: string;
  direction?: string;
  mode?: string;
};

export default function CallScreen() {
  const params = useLocalSearchParams<RouteParams>();
  const conversationId = Array.isArray(params.conversationId)
    ? params.conversationId[0]
    : params.conversationId;
  const callId = Array.isArray(params.callId) ? params.callId[0] : params.callId;
  const direction = Array.isArray(params.direction) ? params.direction[0] : params.direction;
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const incoming = direction === 'incoming';
  const mediaType = requestedMode === 'audio' ? 'audio' : 'video';
  const [connection, setConnection] = useState<CallResponse | null>(null);
  const [call, setCall] = useState<CallSession | null>(null);
  const [loading, setLoading] = useState(!incoming);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [callWarning, setCallWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [audioReady, setAudioReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const endingRef = useRef(false);

  const setCallState = useCallback((next: CallSession) => {
    setCall(next);
    setConnection((current) => current ? { ...current, call: next } : current);
    if (isTerminalCallStatus(next.status)) {
      setConnection(null);
      setNotice(
        next.status === 'declined'
          ? 'Call declined'
          : next.status === 'missed'
            ? 'No answer'
            : 'Call ended',
      );
    }
  }, []);

  const startCall = useCallback(async () => {
    if (!conversationId || startedRef.current) return;
    startedRef.current = true;
    try {
      const result = await requestCallAction('start', { conversationId, mediaType });
      if (!('token' in result)) throw new Error('The call service did not return a connection token.');
      setCall(result.call);
      setConnection(result);
      setCallWarning(result.warning ?? '');
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not start the call.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, mediaType]);

  useEffect(() => {
    if (incoming) return undefined;
    const timeout = setTimeout(() => void startCall(), 0);
    return () => clearTimeout(timeout);
  }, [incoming, startCall]);

  useEffect(() => {
    const activeCallId = call?.id;
    if (!activeCallId) return;
    return subscribeToCall(activeCallId, setCallState);
  }, [call?.id, setCallState]);

  useEffect(() => {
    if (!call || call.status !== 'ringing') return;
    const timer = setInterval(() => {
      if (Date.parse(call.expires_at) > Date.now() || endingRef.current) return;
      endingRef.current = true;
      void requestCallAction('expire', { callId: call.id })
        .then((result) => {
          if ('call' in result) setCallState(result.call);
        })
        .catch(() => setNotice('No answer'))
        .finally(() => {
          setConnection(null);
          setNotice('No answer');
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [call, setCallState]);

  useEffect(() => {
    if (call?.status !== 'active') return;
    startedAtRef.current ??= Date.now();
    const timer = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.status]);

  useEffect(() => {
    if (!connection?.token) {
      return;
    }
    let mounted = true;
    void AudioSession.startAudioSession()
      .then(() => {
        if (mounted) setAudioReady(true);
      })
      .catch((audioError: unknown) => {
        if (mounted) {
          setError(audioError instanceof Error ? audioError.message : 'Could not start the audio session.');
        }
      });
    return () => {
      mounted = false;
      setAudioReady(false);
      void AudioSession.stopAudioSession();
    };
  }, [connection?.token]);

  const answerCall = useCallback(async () => {
    if (!callId || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestCallAction('accept', { callId });
      if (!('token' in result)) throw new Error('The call service did not return a connection token.');
      setCall(result.call);
      setConnection(result);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not answer the call.');
    } finally {
      setBusy(false);
    }
  }, [busy, callId]);

  const finishCall = useCallback(async (action: 'end' | 'decline') => {
    const currentCallId = call?.id ?? callId;
    if (!currentCallId || endingRef.current) {
      router.back();
      return;
    }
    endingRef.current = true;
    setBusy(true);
    try {
      const result = await requestCallAction(action, { callId: currentCallId });
      if ('call' in result) setCallState(result.call);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not end the call.');
    } finally {
      setConnection(null);
      setBusy(false);
      router.back();
    }
  }, [call?.id, callId, setCallState]);

  const handleConnected = useCallback(() => {
    const currentCallId = call?.id;
    if (!currentCallId) return;
    void requestCallAction('connected', { callId: currentCallId })
      .then((result) => {
        if ('call' in result) setCallState(result.call);
      })
      .catch((callError: unknown) => {
        setError(callError instanceof Error ? callError.message : 'Could not confirm the call connection.');
      });
  }, [call?.id, setCallState]);

  const roomConnection = useMemo(() => {
    if (!connection || !audioReady) return null;
    return (
      <LiveKitRoom
        serverUrl={connection.serverUrl}
        token={connection.token}
        connect
        audio
        video={connection.call.media_type === 'video'}
        options={{ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }}
        onConnected={handleConnected}
        onDisconnected={() => undefined}
        onError={(roomError) => setError(roomError.message || 'The call connection failed.')}
        onMediaDeviceFailure={() => setError('Camera or microphone permission is unavailable.')}
      >
        <CallRoom
          peerName={connection.peer.displayName}
          mediaType={connection.call.media_type}
          error={error}
          warning={callWarning}
          elapsedSeconds={elapsedSeconds}
          busy={busy}
          onHangup={() => void finishCall('end')}
        />
      </LiveKitRoom>
    );
  }, [audioReady, busy, callWarning, connection, elapsedSeconds, error, finishCall, handleConnected]);

  const statusLabel = call?.status === 'active'
    ? formatDuration(elapsedSeconds)
    : call?.status === 'connecting'
      ? 'Connecting…'
      : 'Ringing…';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.black} />
      {roomConnection}
      {!roomConnection ? (
        <View style={styles.centerContent}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close call screen"
            onPress={() => incoming && callId ? void finishCall('decline') : router.back()}
            style={styles.closeButton}
          >
            <Icon name="close" color={theme.colors.white} />
          </Pressable>
          {loading || busy ? (
            <ActivityIndicator color={theme.colors.primary} size="large" />
          ) : incoming && !connection ? (
            <IncomingCall
              mode={mediaType}
              onAccept={() => void answerCall()}
              onDecline={() => void finishCall('decline')}
            />
          ) : (
            <View style={styles.centerMessage}>
              <View style={styles.avatar}>
                <Icon name="user" size={24} color={theme.colors.white} />
              </View>
              <Text style={styles.statusText}>{notice || (call ? statusLabel : 'Call not connected')}</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {call && !notice ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void finishCall('end')}
                  style={[styles.endButton, styles.endButtonLarge]}
                >
                  <Icon name="close" color={theme.colors.white} />
                  <Text style={styles.controlLabel}>End call</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
                  <Text style={styles.backButtonText}>Close</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function IncomingCall({
  mode,
  onAccept,
  onDecline,
}: {
  mode: 'audio' | 'video';
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.incomingContent}>
      <View style={styles.avatar}>
        <Icon name="user" size={24} color={theme.colors.white} />
      </View>
      <Text style={styles.title}>Incoming {mode} call</Text>
      <Text style={styles.statusText}>Someone is calling you</Text>
      <View style={styles.incomingActions}>
        <CallActionButton
          icon="close"
          label="Decline"
          color={theme.colors.danger}
          onPress={onDecline}
        />
        <CallActionButton
          icon="check"
          label="Answer"
          color={theme.colors.success}
          onPress={onAccept}
        />
      </View>
    </View>
  );
}

function CallRoom({
  peerName,
  mediaType,
  error,
  warning,
  elapsedSeconds,
  busy,
  onHangup,
}: {
  peerName: string;
  mediaType: 'audio' | 'video';
  error: string;
  warning: string;
  elapsedSeconds: number;
  busy: boolean;
  onHangup: () => void;
}) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera]);
  const remoteTrack = tracks.find((track) => !track.participant.isLocal);
  const localTrack = tracks.find((track) => track.participant.isLocal);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(mediaType === 'video');
  const [switching, setSwitching] = useState(false);
  const [controlError, setControlError] = useState('');

  const toggleMicrophone = async () => {
    setSwitching(true);
    try {
      await room.localParticipant.setMicrophoneEnabled(!microphoneEnabled);
      setMicrophoneEnabled((enabled) => !enabled);
      setControlError('');
    } catch (toggleError) {
      setControlError(toggleError instanceof Error ? toggleError.message : 'Could not change microphone settings.');
    } finally {
      setSwitching(false);
    }
  };

  const toggleCamera = async () => {
    setSwitching(true);
    try {
      await room.localParticipant.setCameraEnabled(!cameraEnabled);
      setCameraEnabled((enabled) => !enabled);
      setControlError('');
    } catch (toggleError) {
      setControlError(toggleError instanceof Error ? toggleError.message : 'Could not change camera settings.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <View style={styles.room}>
      {mediaType === 'video' && remoteTrack && isTrackReference(remoteTrack) ? (
        <VideoTrack trackRef={remoteTrack} style={styles.remoteVideo} objectFit="cover" />
      ) : (
        <View style={styles.remotePlaceholder}>
          <View style={styles.avatar}>
            <Icon name="user" size={24} color={theme.colors.white} />
          </View>
          <Text style={styles.title}>{peerName}</Text>
          <Text style={styles.statusText}>
            {mediaType === 'video' ? 'Waiting for their camera…' : formatDuration(elapsedSeconds)}
          </Text>
        </View>
      )}
      <View style={styles.topBar}>
        <Text style={styles.peerName} numberOfLines={1}>{peerName}</Text>
        <Text style={styles.callDuration}>{formatDuration(elapsedSeconds)}</Text>
        {warning ? <Text style={styles.pushWarning}>{warning}</Text> : null}
        {error || controlError ? (
          <Text style={styles.callError}>{error || controlError}</Text>
        ) : null}
      </View>
      {mediaType === 'video' && localTrack && isTrackReference(localTrack) ? (
        <VideoTrack
          trackRef={localTrack}
          style={styles.localVideo}
          objectFit="cover"
          mirror
          zOrder={1}
        />
      ) : null}
      <View style={styles.controls}>
        <CallActionButton
          icon="mic"
          label={microphoneEnabled ? 'Mute' : 'Unmute'}
          disabled={switching}
          color={theme.colors.surface}
          onPress={() => void toggleMicrophone()}
        />
        <CallActionButton
          icon="close"
          label="End"
          disabled={busy}
          color={theme.colors.danger}
          onPress={onHangup}
        />
        {mediaType === 'video' ? (
          <CallActionButton
            icon="video"
            label={cameraEnabled ? 'Camera off' : 'Camera on'}
            disabled={switching}
            color={theme.colors.surface}
            onPress={() => void toggleCamera()}
          />
        ) : null}
      </View>
    </View>
  );
}

function CallActionButton({
  icon,
  label,
  color,
  disabled = false,
  onPress,
}: {
  icon: 'close' | 'check' | 'mic' | 'video';
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: color }, disabled && styles.disabled]}
    >
      <Icon name={icon} color={theme.colors.white} size={24} />
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  room: {
    flex: 1,
    backgroundColor: theme.colors.black,
    justifyContent: 'center',
  },
  remoteVideo: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  remotePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  topBar: {
    position: 'absolute',
    top: theme.spacing.xl,
    left: theme.spacing.xl,
    right: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  peerName: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowRadius: 5,
  },
  callDuration: {
    color: theme.colors.white,
    fontSize: 13,
    textShadowColor: '#000',
    textShadowRadius: 5,
  },
  pushWarning: {
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.md,
    backgroundColor: 'rgba(127, 29, 29, 0.85)',
    color: theme.colors.white,
    fontSize: 12,
    textAlign: 'center',
  },
  callError: {
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.md,
    backgroundColor: 'rgba(127, 29, 29, 0.85)',
    color: theme.colors.white,
    fontSize: 12,
    textAlign: 'center',
  },
  localVideo: {
    position: 'absolute',
    right: theme.spacing.lg,
    top: 88,
    width: 104,
    height: 148,
    borderRadius: theme.radii.md,
    overflow: 'hidden',
  },
  controls: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.xl,
    backgroundColor: 'rgba(17, 20, 24, 0.88)',
  },
  actionButton: {
    minWidth: 76,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.radii.lg,
  },
  disabled: {
    opacity: 0.5,
  },
  controlLabel: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xxl,
  },
  closeButton: {
    position: 'absolute',
    top: theme.spacing.lg,
    left: theme.spacing.lg,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: theme.colors.surface,
  },
  centerMessage: {
    alignItems: 'center',
    gap: theme.spacing.lg,
  },
  incomingContent: {
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  incomingActions: {
    flexDirection: 'row',
    gap: theme.spacing.xxl,
    marginTop: theme.spacing.xxl,
  },
  avatar: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 44,
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  statusText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
  errorText: {
    maxWidth: 320,
    color: theme.colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  endButton: {
    minWidth: 76,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.radii.lg,
  },
  endButtonLarge: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
  },
  backButton: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
  },
  backButtonText: {
    color: theme.colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
