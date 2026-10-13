import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { theme } from '../../theme/theme';
import type { ChatMediaKind } from './chatMediaValidation';

type Props = {
  kind: ChatMediaKind;
  uri: string | null;
  localUri?: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function VideoPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const player = useVideoPlayer(uri);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.videoBackdrop}>
        <Pressable onPress={onClose} style={styles.closeVideo} accessibilityRole="button" accessibilityLabel="Close video">
          <Icon name="close" size={24} color={theme.colors.white} />
        </Pressable>
        <VideoView player={player} style={styles.videoPlayer} contentFit="contain" nativeControls />
      </View>
    </Modal>
  );
}

function VoicePlayer({ uri, durationMs }: { uri: string; durationMs: number | null }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const duration = status.duration || (durationMs ?? 0) / 1000;
  const time = status.playing ? status.currentTime : duration;
  return (
    <Pressable
      onPress={() => {
        if (status.playing) player.pause();
        else {
          if (status.currentTime >= duration && duration > 0) void player.seekTo(0);
          player.play();
        }
      }}
      style={styles.voicePlayer}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
    >
      <Icon name={status.playing ? 'pause' : 'play'} size={20} color={theme.colors.primary} />
      <View style={styles.waveLine}><View style={[styles.waveProgress, { width: `${duration ? Math.min(100, (time / duration) * 100) : 0}%` }]} /></View>
      <Text style={styles.voiceDuration}>{formatDuration(status.playing ? status.currentTime : duration)}</Text>
    </Pressable>
  );
}

function formatDuration(seconds: number) {
  const wholeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export function ChatMediaMessage({
  kind,
  uri,
  localUri,
  durationMs,
  width,
  height,
  loading,
  error,
  onRetry,
}: Props) {
  const [videoOpen, setVideoOpen] = useState(false);
  const source = localUri ?? uri;

  if (!source) {
    return (
      <View style={styles.unavailable}>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
        <Text style={styles.unavailableText}>{error ?? (loading ? 'Loading attachment…' : 'Attachment unavailable.')}</Text>
        {!loading ? (
          <Pressable onPress={onRetry} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (kind === 'image') {
    const aspectRatio = width && height ? width / height : 1;
    return (
      <Image
        source={{ uri: source }}
        style={[styles.image, { aspectRatio: Math.max(0.65, Math.min(1.8, aspectRatio)) }]}
        resizeMode="cover"
        accessibilityLabel="Chat photo"
      />
    );
  }

  if (kind === 'video') {
    return (
      <>
        <Pressable onPress={() => setVideoOpen(true)} style={styles.videoPreview} accessibilityRole="button" accessibilityLabel="Play chat video">
          <Icon name="play" size={24} color={theme.colors.white} />
          <Text style={styles.videoLabel}>Video · {formatDuration((durationMs ?? 0) / 1000)}</Text>
        </Pressable>
        {videoOpen ? <VideoPreview uri={source} onClose={() => setVideoOpen(false)} /> : null}
      </>
    );
  }

  return <VoicePlayer uri={source} durationMs={durationMs} />;
}

const styles = StyleSheet.create({
  image: { width: 230, maxWidth: '100%', minHeight: 130, borderRadius: 12, backgroundColor: theme.colors.black },
  videoPreview: { width: 230, height: 130, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: '#26313C' },
  videoLabel: { color: theme.colors.white, fontSize: 12, fontWeight: '700' },
  videoBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.95)' },
  videoPlayer: { width: '100%', aspectRatio: 16 / 9 },
  closeVideo: { position: 'absolute', zIndex: 2, top: 52, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  voicePlayer: { width: 230, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  waveLine: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.2)', overflow: 'hidden' },
  waveProgress: { height: '100%', backgroundColor: theme.colors.primary },
  voiceDuration: { color: theme.colors.text, fontSize: 11, fontVariant: ['tabular-nums'] },
  unavailable: { minWidth: 200, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 6 },
  unavailableText: { color: theme.colors.textMuted, fontSize: 12 },
  retryText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
});
