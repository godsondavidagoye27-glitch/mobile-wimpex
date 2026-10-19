import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { router, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LinearTransition, runOnJS } from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { getSingleRouteParam } from '../lib/routeParams';
import { SectionErrorBoundary } from '../components/SectionErrorBoundary';
import { getErrorMessage } from '../lib/errorMessage';
import { theme } from '../theme/theme';
import { exportVideo } from '../features/video-editor/exportVideo';
import {
  clampTrimRange,
  initialTrimRange,
  type TrimRange,
} from '../features/video-editor/videoEditorLogic';
import {
  finishVideoEditorRequest,
  type VideoEditorResult,
} from '../features/video-editor/videoEditorRequests';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

function numberParam(value: string | string[] | undefined, fallback: number) {
  const parsed = Number(getSingleRouteParam(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percent(value: number, durationMs: number) {
  return Math.max(0, Math.min(1, value / durationMs));
}

function percentCss(value: number): `${number}%` {
  return `${value * 100}%`;
}

function seekPlayerTo(player: VideoPlayer, seconds: number) {
  player.seekBy(seconds - player.currentTime);
}

function VideoEditorContent() {
  const params = useLocalSearchParams<{
    requestId?: string;
    uri?: string;
    maxDurationMs?: string;
    maxSizeBytes?: string;
    durationMs?: string;
    sizeBytes?: string;
    width?: string;
    height?: string;
    caption?: string;
  }>();
  const requestId = getSingleRouteParam(params.requestId) ?? '';
  const uri = getSingleRouteParam(params.uri) ?? '';
  const maxDurationMs = numberParam(params.maxDurationMs, 60_000);
  const maxSizeBytes = numberParam(params.maxSizeBytes, 50 * 1024 * 1024);
  const sourceDurationMs = numberParam(params.durationMs, maxDurationMs);
  const { width: screenWidth } = useWindowDimensions();
  const player = useVideoPlayer(uri || null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });
  const { status, error: previewError } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });
  const [range, setRange] = useState<TrimRange>(() => (
    sourceDurationMs >= 1000
      ? initialTrimRange(sourceDurationMs, maxDurationMs)
      : { startMs: 0, endMs: 1000 }
  ));
  const [positionMs, setPositionMs] = useState(0);
  const [timelineWidth, setTimelineWidth] = useState(Math.max(240, screenWidth - 40));
  const [thumbnails, setThumbnails] = useState<VideoThumbnail[]>([]);
  const [muted, setMuted] = useState(false);
  const [caption, setCaption] = useState(getSingleRouteParam(params.caption) ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const durationMs = Math.max(sourceDurationMs, Math.round(player.duration * 1000) || 0);
  const rangeRef = useRef(range);
  const startGestureBase = useRef(0);
  const endGestureBase = useRef(0);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const requestedRef = useRef(false);
  const thumbnailPlayer = player;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      thumbnails.forEach((thumbnail) => thumbnail.release());
    };
  }, [thumbnails]);

  useEffect(() => () => {
    finishVideoEditorRequest(requestId, null);
  }, [requestId]);

  useEffect(() => {
    if (status !== 'readyToPlay' || requestedRef.current) return;
    requestedRef.current = true;
    const resolvedDuration = Math.round(player.duration * 1000);
    if (resolvedDuration >= 1000) {
      const nextRange = initialTrimRange(resolvedDuration, maxDurationMs);
      rangeRef.current = nextRange;
      setTimeout(() => {
        if (mountedRef.current) setRange(nextRange);
      }, 0);
    }
    const times = Array.from({ length: 10 }, (_, index) => player.duration * (index / 10));
    void thumbnailPlayer.generateThumbnailsAsync(times, { maxWidth: 160, maxHeight: 120 })
      .then((created) => {
        if (mountedRef.current) setThumbnails(created);
        else created.forEach((thumbnail) => thumbnail.release());
      })
      .catch((thumbnailError: unknown) => {
        console.error('Unable to generate video editor thumbnails.', thumbnailError);
        if (mountedRef.current) {
          void getErrorMessage(thumbnailError, 'Video thumbnails could not be loaded.')
            .then(setError);
        }
      });
  }, [maxDurationMs, player, status, thumbnailPlayer]);

  useEffect(() => {
    const timer = setInterval(() => {
      const currentMs = player.currentTime * 1000;
      if (player.playing && currentMs >= range.endMs) {
        seekPlayerTo(player, range.startMs / 1000);
        setPositionMs(range.startMs);
      } else {
        setPositionMs(currentMs);
      }
    }, 120);
    return () => clearInterval(timer);
  }, [player, range.endMs, range.startMs]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  const beginStartDrag = useCallback(() => {
    startGestureBase.current = percent(rangeRef.current.startMs, durationMs);
  }, [durationMs]);

  const updateStartFromDrag = useCallback((delta: number) => {
    const current = rangeRef.current;
    const nextFraction = Math.max(
      0,
      Math.min(
        percent(current.endMs, durationMs) - 1000 / durationMs,
        startGestureBase.current + delta,
      ),
    );
    const next = clampTrimRange(
      { startMs: nextFraction * durationMs, endMs: current.endMs },
      durationMs,
      maxDurationMs,
    );
    rangeRef.current = next;
    setRange(next);
    seekPlayerTo(player, next.startMs / 1000);
  }, [durationMs, maxDurationMs, player]);

  const beginEndDrag = useCallback(() => {
    endGestureBase.current = percent(rangeRef.current.endMs, durationMs);
  }, [durationMs]);

  const updateEndFromDrag = useCallback((delta: number) => {
    const current = rangeRef.current;
    const nextFraction = Math.min(
      1,
      Math.max(
        percent(current.startMs, durationMs) + 1000 / durationMs,
        endGestureBase.current + delta,
      ),
    );
    const next = clampTrimRange(
      { startMs: current.startMs, endMs: nextFraction * durationMs },
      durationMs,
      maxDurationMs,
    );
    rangeRef.current = next;
    setRange(next);
  }, [durationMs, maxDurationMs]);

  const beginWindowDrag = useCallback(() => {
    startGestureBase.current = percent(rangeRef.current.startMs, durationMs);
    endGestureBase.current = percent(rangeRef.current.endMs, durationMs);
  }, [durationMs]);

  const updateWindowFromDrag = useCallback((delta: number) => {
    const boundedDelta = Math.max(
      -startGestureBase.current,
      Math.min(1 - endGestureBase.current, delta),
    );
    const next = clampTrimRange(
      {
        startMs: (startGestureBase.current + boundedDelta) * durationMs,
        endMs: (endGestureBase.current + boundedDelta) * durationMs,
      },
      durationMs,
      maxDurationMs,
    );
    rangeRef.current = next;
    setRange(next);
    seekPlayerTo(player, next.startMs / 1000);
  }, [durationMs, maxDurationMs, player]);

  // Gesture callbacks are worklets; their JS handlers intentionally read refs only after runOnJS.
  /* eslint-disable react-hooks/refs */
  const startHandleGesture = useMemo(() => Gesture.Pan()
    .onBegin(() => runOnJS(beginStartDrag)())
    .onUpdate((event) => {
      runOnJS(updateStartFromDrag)(event.translationX / timelineWidth);
    }), [beginStartDrag, timelineWidth, updateStartFromDrag]);

  const endHandleGesture = useMemo(() => Gesture.Pan()
    .onBegin(() => runOnJS(beginEndDrag)())
    .onUpdate((event) => {
      runOnJS(updateEndFromDrag)(event.translationX / timelineWidth);
    }), [beginEndDrag, timelineWidth, updateEndFromDrag]);

  const windowGesture = useMemo(() => {
    return Gesture.Pan()
      .onBegin(() => runOnJS(beginWindowDrag)())
      .onUpdate((event) => {
        runOnJS(updateWindowFromDrag)(event.translationX / timelineWidth);
      });
  }, [beginWindowDrag, timelineWidth, updateWindowFromDrag]);
  /* eslint-enable react-hooks/refs */
  const startFraction = percent(range.startMs, durationMs);
  const endFraction = percent(range.endMs, durationMs);
  const selectedRegionStyle = {
    left: percentCss(startFraction),
    width: percentCss(Math.max(0, endFraction - startFraction)),
  };
  const startHandleStyle = { left: percentCss(startFraction) };
  const endHandleStyle = { left: percentCss(endFraction) };
  const playheadStyle = { left: percentCss(percent(positionMs, durationMs)) };
  const videoTooShort = status === 'readyToPlay' && player.duration > 0 && player.duration < 1;
  const canExport = status === 'readyToPlay' && !videoTooShort && !busy;

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    finishVideoEditorRequest(requestId, null);
    router.back();
  }, [requestId]);

  const done = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0.05);
    setError('');
    cancelledRef.current = false;
    try {
      const result = await exportVideo({
        uri,
        startMs: range.startMs,
        endMs: range.endMs,
        mute: muted,
        maxSizeBytes,
        sourceMimeType: player.videoTrack?.mimeType,
        onProgress: (value) => {
          if (mountedRef.current) setProgress(value);
        },
        isCancelled: () => cancelledRef.current,
      });
      if (!mountedRef.current || cancelledRef.current) return;
      const editorResult: VideoEditorResult = {
        ...result,
        caption,
        muted,
      };
      finishVideoEditorRequest(requestId, editorResult);
      router.back();
    } catch (exportError) {
      console.error('Unable to export edited video.', exportError);
      if (!cancelledRef.current && mountedRef.current) {
        setError(await getErrorMessage(exportError, 'Could not export this video. Try again.'));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const thumbnailWidth = timelineWidth / Math.max(1, thumbnails.length);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={cancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Cancel video editing"
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit video</Text>
        <Pressable
          onPress={() => {
            if (player.playing) player.pause();
            else {
              if (player.currentTime * 1000 < range.startMs || player.currentTime * 1000 >= range.endMs) {
                seekPlayerTo(player, range.startMs / 1000);
              }
              player.play();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={player.playing ? 'Pause preview' : 'Play preview'}
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>{player.playing ? 'Pause' : 'Play'}</Text>
        </Pressable>
      </View>

      <View style={[styles.preview, { maxHeight: Math.min(560, screenWidth * 1.15) }]}>
        {uri ? (
          <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
        ) : (
          <Text style={styles.errorText}>The video could not be opened.</Text>
        )}
        {status === 'loading' ? <ActivityIndicator style={styles.previewLoader} color={theme.colors.gold} /> : null}
        {status === 'error' ? (
          <Text accessibilityRole="alert" style={styles.previewError}>
            {previewError?.message ?? 'The video could not be opened. Choose another file.'}
          </Text>
        ) : null}
      </View>
      {videoTooShort ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          Choose a video that is at least one second long.
        </Text>
      ) : null}
      <View style={styles.editorControls}>
        <View style={styles.durationRow}>
          <Text style={styles.durationText}>{Math.max(1, Math.ceil((range.endMs - range.startMs) / 1000))}s</Text>
          <Text style={styles.limitText}>of max {Math.ceil(maxDurationMs / 1000)}s</Text>
          <Pressable
            onPress={() => setMuted((value) => !value)}
            accessibilityRole="switch"
            accessibilityState={{ checked: muted }}
            accessibilityLabel={muted ? 'Unmute exported video' : 'Mute exported video'}
            style={[styles.muteButton, muted && styles.muteButtonActive]}
          >
            <Text style={styles.muteText}>{muted ? 'Muted' : 'Sound on'}</Text>
          </Pressable>
        </View>

        <View
          style={styles.timeline}
          onLayout={(event) => setTimelineWidth(Math.max(1, event.nativeEvent.layout.width))}
          accessibilityLabel="Video trim timeline"
        >
          <View style={styles.thumbnailRow}>
            {thumbnails.length ? thumbnails.map((thumbnail, index) => (
              <Image
                key={`${thumbnail.requestedTime}-${index}`}
                source={thumbnail}
                contentFit="cover"
                style={{ width: thumbnailWidth, height: 62 }}
              />
            )) : Array.from({ length: 10 }, (_, index) => (
              <View key={index} style={[styles.thumbnailPlaceholder, { width: timelineWidth / 10 }]} />
            ))}
          </View>
          <GestureDetector gesture={windowGesture}>
            <Animated.View
              layout={LinearTransition.duration(80)}
              style={[styles.selectedRegion, selectedRegionStyle]}
            />
          </GestureDetector>
          <Animated.View
            layout={LinearTransition.duration(80)}
            style={[styles.playhead, playheadStyle]}
            pointerEvents="none"
          />
          <GestureDetector gesture={startHandleGesture}>
            <Animated.View
              layout={LinearTransition.duration(80)}
              style={[styles.trimHandle, styles.startHandle, startHandleStyle]}
            >
              <View style={styles.handleGrip} />
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={endHandleGesture}>
            <Animated.View
              layout={LinearTransition.duration(80)}
              style={[styles.trimHandle, styles.endHandle, endHandleStyle]}
            >
              <View style={styles.handleGrip} />
            </Animated.View>
          </GestureDetector>
        </View>
        <View style={styles.timeLabels}>
          <Text style={styles.timeLabel}>{(range.startMs / 1000).toFixed(1)}s</Text>
          <Text style={styles.timeLabel}>{(range.endMs / 1000).toFixed(1)}s</Text>
        </View>

        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Add a caption"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Video caption"
          maxLength={500}
          style={styles.captionInput}
        />
        {!!error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}

        {busy ? (
          <View style={styles.progressBlock}>
            <ActivityIndicator color={theme.colors.gold} />
            <Text style={styles.progressText}>Exporting video {Math.round(progress * 100)}%</Text>
            <Pressable
              onPress={cancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel video export"
              style={styles.cancelExportButton}
            >
              <Text style={styles.cancelExportText}>Cancel export</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => void done()}
            disabled={!canExport}
            accessibilityRole="button"
            accessibilityLabel="Finish editing and export video"
            style={[styles.doneButton, !canExport && styles.disabledButton]}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function VideoEditorScreen() {
  return (
    <SectionErrorBoundary title="Video editor needs to restart">
      <VideoEditorContent />
    </SectionErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingHorizontal: 16 },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { minWidth: 64, paddingVertical: 10 },
  headerButtonText: { color: theme.colors.gold, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: theme.colors.white, fontSize: 17, fontWeight: '700' },
  preview: {
    flex: 1,
    minHeight: 180,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#090909',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: { width: '100%', height: '100%' },
  previewLoader: { position: 'absolute' },
  previewError: { position: 'absolute', color: theme.colors.danger, padding: 18, textAlign: 'center' },
  editorControls: { paddingTop: 14, paddingBottom: 8, gap: 10 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  durationText: { color: theme.colors.white, fontSize: 20, fontWeight: '700' },
  limitText: { flex: 1, color: theme.colors.textMuted, fontSize: 14 },
  muteButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  muteButtonActive: { borderColor: theme.colors.gold, backgroundColor: '#2A2418' },
  muteText: { color: theme.colors.white, fontSize: 13 },
  timeline: {
    height: 72,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#252525',
    justifyContent: 'center',
  },
  thumbnailRow: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  thumbnailPlaceholder: { height: 62, backgroundColor: '#333333', borderRightWidth: 1, borderColor: '#444444' },
  selectedRegion: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderColor: theme.colors.gold,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    backgroundColor: 'rgba(214, 178, 94, 0.12)',
  },
  trimHandle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 18,
    marginLeft: -9,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.gold,
  },
  startHandle: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  endHandle: { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  handleGrip: { width: 3, height: 22, borderRadius: 2, backgroundColor: '#17130A' },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    zIndex: 2,
    backgroundColor: theme.colors.white,
  },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  timeLabel: { color: theme.colors.textMuted, fontSize: 12 },
  captionInput: {
    color: theme.colors.white,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { color: theme.colors.danger, fontSize: 13 },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  progressText: { flex: 1, color: theme.colors.white, fontSize: 14 },
  cancelExportButton: { padding: 10 },
  cancelExportText: { color: theme.colors.danger, fontWeight: '600' },
  doneButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: theme.colors.gold,
  },
  doneButtonText: { color: theme.colors.black, fontWeight: '700', fontSize: 16 },
  disabledButton: { opacity: 0.45 },
});
