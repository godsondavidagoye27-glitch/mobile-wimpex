import { getErrorMessage } from '../../lib/errorMessage';
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
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { NameWithBadge } from '../../components/NameWithBadge';
import {
  fetchCallSession,
  requestCallAction,
  subscribeToCall,
  type CallResponse,
  type CallSession,
} from '../../features/calls/callService';
import { isTerminalCallStatus } from '../../features/calls/callPolicy';
import { getSingleRouteParam, isUuidRouteParam } from '../../lib/routeParams';
import { theme } from '../../theme/theme';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

registerGlobals();

type RouteParams = {
  conversationId?: string;
  callId?: string;
  direction?: string;
  mode?: string;
};

async function requestCallMediaPermissions(mediaType: 'audio' | 'video') {
  if (Platform.OS !== 'android') return true;
  const requiredPermissions = [
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ...(mediaType === 'video' ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
  ];
  const results = await PermissionsAndroid.requestMultiple(requiredPermissions);
  return requiredPermissions.every((permission) =>
    results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export default function CallScreen() {
  const params = useLocalSearchParams<RouteParams>();
  const conversationRouteId = getSingleRouteParam(params.conversationId);
  const callRouteId = getSingleRouteParam(params.callId);
  const conversationId = isUuidRouteParam(conversationRouteId) ? conversationRouteId : undefined;
  const callId = isUuidRouteParam(callRouteId) ? callRouteId : undefined;
  const direction = getSingleRouteParam(params.direction);
  const requestedMode = getSingleRouteParam(params.mode);
  const incoming = direction === 'incoming';
  const mediaType = requestedMode === 'audio' ? 'audio' : 'video';
  const routeKey = `${conversationId ?? ''}:${callId ?? ''}:${incoming}:${mediaType}`;
  return (
    <CallSessionScreen
      key={routeKey}
      conversationId={conversationId}
      callId={callId}
      incoming={incoming}
      mediaType={mediaType}
    />
  );
}

function CallSessionScreen({
  conversationId,
  callId,
  incoming,
  mediaType,
}: {
  conversationId: string | undefined;
  callId: string | undefined;
  incoming: boolean;
  mediaType: 'audio' | 'video';
}) {
  const [connection, setConnection] = useState<CallResponse | null>(null);
  const [call, setCall] = useState<CallSession | null>(null);
  const incompleteCall = incoming ? !callId : !conversationId;
  const [loading, setLoading] = useState(!incompleteCall);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    incompleteCall ? `This ${incoming ? 'incoming ' : ''}call link is incomplete.` : '',
  );
  const [callWarning, setCallWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const callRef = useRef<CallSession | null>(null);

  const setCallState = useCallback((next: CallSession) => {
    const current = callRef.current;
    callRef.current = next;
    const changed = !current
      || current.status !== next.status
      || current.caller_connected_at !== next.caller_connected_at
      || current.callee_connected_at !== next.callee_connected_at
      || current.ended_at !== next.ended_at;
    if (changed) {
      setCall(next);
      setConnection((activeConnection) =>
        activeConnection ? { ...activeConnection, call: next } : activeConnection,
      );
    }
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

  useEffect(() => {
    if (!incoming || !callId) return undefined;
    let active = true;
    void fetchCallSession(callId)
      .then((latest) => {
        if (!active) return;
        if (!latest) {
          setError('This call is no longer available.');
          return;
        }
        setCallState(latest);
      })
      .catch(async (loadError: unknown) => {
        if (active) setError(await getErrorMessage(loadError, 'Could not load this call.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [callId, incoming, setCallState]);

  const startCall = useCallback(async () => {
    if (!conversationId || startedRef.current) return;
    startedRef.current = true;
    try {
      if (!(await requestCallMediaPermissions(mediaType))) {
        startedRef.current = false;
        setPermissionDenied(true);
        setError('Allow microphone access to place this call.');
        setLoading(false);
        return;
      }
      const result = await requestCallAction('start', { conversationId, mediaType });
      if (!('token' in result)) throw new Error('The call service did not return a connection token.');
      callRef.current = result.call;
      setCall(result.call);
      setConnection(result);
      setCallWarning(
        result.warning
        ?? (result.ringReachability === 'push_unavailable'
          ? 'They may not be notified unless Wimpex is open.'
          : ''),
      );
    } catch (callError) {
      setError(await getErrorMessage(callError, 'Could not start the call.'));
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
    const activeCallId = call?.id ?? (incoming ? callId : undefined);
    if (!activeCallId) return;
    return subscribeToCall(activeCallId, setCallState);
  }, [call?.id, callId, incoming, setCallState]);

  useEffect(() => {
    const activeCallId = call?.id ?? (incoming ? callId : undefined);
    const activeCallStatus = call?.status;
    if (!activeCallId || (activeCallStatus && isTerminalCallStatus(activeCallStatus))) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const latest = await fetchCallSession(activeCallId);
        if (active && latest) setCallState(latest);
      } catch (pollError) {
        if (active) console.warn('Could not refresh call status; realtime updates remain active.', pollError);
      }
    };
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [call?.id, call?.status, callId, incoming, setCallState]);

  useEffect(() => {
    if (!call || call.status !== 'ringing') return;
    const timer = setInterval(() => {
      if (Date.parse(call.expires_at) > Date.now() || endingRef.current) return;
      endingRef.current = true;
      void requestCallAction('expire', { callId: call.id })
        .then((result) => {
          if ('call' in result) setCallState(result.call);
        })
        .catch(async () => setNotice('No answer'))
        .finally(() => {
          setConnection(null);
          setNotice('No answer');
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [call, setCallState]);

  useEffect(() => {
    const activeCallId = call?.id;
    if (!activeCallId || call?.status !== 'active') return undefined;
    const timer = setInterval(() => {
      void requestCallAction('heartbeat', { callId: activeCallId })
        .then((result) => {
          if ('call' in result) setCallState(result.call);
        })
        .catch(async (heartbeatError: unknown) => {
          console.warn('Could not refresh call activity.', heartbeatError);
        });
    }, 20_000);
    return () => clearInterval(timer);
  }, [call?.id, call?.status, setCallState]);

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
      .catch(async (audioError: unknown) => {
        if (mounted) {
          setError(await getErrorMessage(audioError, 'Could not start the audio session.'));
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
      if (!(await requestCallMediaPermissions(mediaType))) {
        setPermissionDenied(true);
        setError('Allow microphone access to answer this call.');
        return;
      }
      const result = await requestCallAction('accept', { callId });
      if (!('token' in result)) throw new Error('The call service did not return a connection token.');
      callRef.current = result.call;
      setCall(result.call);
      setConnection(result);
    } catch (callError) {
      setError(await getErrorMessage(callError, 'Could not answer the call.'));
    } finally {
      setBusy(false);
    }
  }, [busy, callId, mediaType]);

  const finishCall = useCallback(async (action: 'end' | 'decline') => {
    const currentCallId = call?.id ?? callId;
    if (endingRef.current) return;
    if (!currentCallId) {
      router.back();
      return;
    }
    endingRef.current = true;
    setBusy(true);
    try {
      const result = await requestCallAction(action, { callId: currentCallId });
      if ('call' in result) setCallState(result.call);
    } catch (callError) {
      setError(await getErrorMessage(callError, 'Could not end the call.'));
    } finally {
      setConnection(null);
      setBusy(false);
      router.back();
    }
  }, [call?.id, callId, setCallState]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (incoming && callId && (!callRef.current || callRef.current.status === 'ringing')) {
        void finishCall('decline');
      } else if (callRef.current && !isTerminalCallStatus(callRef.current.status)) {
        void finishCall(callRef.current.status === 'ringing' && incoming ? 'decline' : 'end');
      } else {
        router.back();
      }
      return true;
    });
    return () => subscription.remove();
  }, [callId, finishCall, incoming]);

  useEffect(() => () => {
    const currentCall = callRef.current;
    const currentCallId = currentCall?.id ?? (incoming ? callId : undefined);
    if (!currentCallId || (currentCall && isTerminalCallStatus(currentCall.status)) || endingRef.current) return;
    endingRef.current = true;
    const action = (!currentCall || currentCall.status === 'ringing') && incoming ? 'decline' : 'end';
    void requestCallAction(action, { callId: currentCallId }).catch(async (cleanupError: unknown) => {
      console.error('Could not end the call while leaving the call screen.', cleanupError);
    });
  }, [callId, incoming]);

  const handleConnected = useCallback(() => {
    const currentCallId = call?.id;
    if (!currentCallId) return;
    void requestCallAction('connected', { callId: currentCallId })
      .then((result) => {
        if ('call' in result) setCallState(result.call);
      })
      .catch(async (callError: unknown) => {
        setError(await getErrorMessage(callError, 'Could not confirm the call connection.'));
      });
  }, [call?.id, setCallState]);

  const handleDisconnected = useCallback(() => {
    const currentCall = callRef.current;
    if (!currentCall || isTerminalCallStatus(currentCall.status) || endingRef.current) return;
    setError('The call connection was lost.');
    void finishCall('end');
  }, [finishCall]);

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
        onDisconnected={handleDisconnected}
        onError={(roomError) => setError(roomError.message || 'The call connection failed.')}
        onMediaDeviceFailure={() => {
          setPermissionDenied(true);
          setError('Camera or microphone permission is unavailable.');
        }}
      >
        <CallRoom
          peerName={connection.peer.displayName}
          peerId={connection.peer.id}
          mediaType={connection.call.media_type}
          error={error}
          warning={callWarning}
          elapsedSeconds={elapsedSeconds}
          busy={busy}
          onHangup={() => void finishCall('end')}
        />
      </LiveKitRoom>
    );
  }, [audioReady, busy, callWarning, connection, elapsedSeconds, error, finishCall, handleConnected, handleDisconnected]);

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
          ) : incoming && call?.status === 'ringing' && !connection ? (
            <IncomingCall
              mode={mediaType}
              error={error}
              permissionDenied={permissionDenied}
              onOpenSettings={() => {
                void Linking.openSettings().catch(async (settingsError: unknown) => {
                  console.error('Could not open device permission settings.', settingsError);
                });
              }}
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
              {permissionDenied ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void Linking.openSettings().catch(async (settingsError: unknown) => {
                      console.error('Could not open device permission settings.', settingsError);
                    });
                  }}
                  style={styles.backButton}
                >
                  <Text style={styles.backButtonText}>Open settings</Text>
                </Pressable>
              ) : null}
              {permissionDenied && !incoming ? (
                <Pressable accessibilityRole="button" onPress={() => void startCall()} style={styles.backButton}>
                  <Text style={styles.backButtonText}>Try again</Text>
                </Pressable>
              ) : null}
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
  error,
  permissionDenied,
  onOpenSettings,
  onAccept,
  onDecline,
}: {
  mode: 'audio' | 'video';
  error: string;
  permissionDenied: boolean;
  onOpenSettings: () => void;
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
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {permissionDenied ? (
        <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.backButton}>
          <Text style={styles.backButtonText}>Open settings</Text>
        </Pressable>
      ) : null}
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
  peerId,
  mediaType,
  error,
  warning,
  elapsedSeconds,
  busy,
  onHangup,
}: {
  peerName: string;
  peerId: string;
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
      setControlError(await getErrorMessage(toggleError, 'Could not change microphone settings.'));
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
      setControlError(await getErrorMessage(toggleError, 'Could not change camera settings.'));
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
          <NameWithBadge name={peerName} userId={peerId} size="lg" textStyle={styles.title} />
          <Text style={styles.statusText}>
            {mediaType === 'video' ? 'Waiting for their camera…' : formatDuration(elapsedSeconds)}
          </Text>
        </View>
      )}
      <View style={styles.topBar}>
        <NameWithBadge name={peerName} userId={peerId} size="md" textStyle={styles.peerName} />
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
