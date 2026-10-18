import { getErrorMessage } from '../../lib/errorMessage';
import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { findVttCue, parseWebVtt, type VttCue } from './vtt';
import { getSupabaseClient } from '../../lib/supabase';
import { preferenceStorage } from '../../lib/storage';
import type { FeedPost } from '../../types/database';
import { theme } from '../../theme/theme';

const captionPreferenceKey = 'wimpex.captions.enabled';
const captionFiles = new Map<string, Promise<VttCue[]>>();
const preferenceListeners = new Set<(enabled: boolean) => void>();
let cachedPreference: boolean | null = null;

function updateCaptionPreference(enabled: boolean) {
  cachedPreference = enabled;
  preferenceListeners.forEach((listener) => listener(enabled));
}

function loadCaptionFile(path: string) {
  const cached = captionFiles.get(path);
  if (cached) return cached;

  const request = getSupabaseClient().storage.from('captions').download(path).then(async ({ data, error }) => {
    if (error) throw error;
    const cues = parseWebVtt(await data.text());
    if (!cues.length) throw new Error('The caption file could not be read.');
    return cues;
  });
  captionFiles.set(path, request);
  void request.catch(async () => captionFiles.delete(path));
  return request;
}

function setCaptionTimeUpdateInterval(player: VideoPlayer, interval: number) {
  player.timeUpdateEventInterval = interval;
}

function statusCopy(status: FeedPost['captions_status']) {
  if (status === 'queued' || status === 'processing') return 'Captions are being generated.';
  if (status === 'failed') return 'Captions could not be generated.';
  if (status === 'no_speech') return 'No speech was detected.';
  if (status === 'disabled') return 'Captions are turned off for this video.';
  return 'Captions are not available for this video.';
}

export function CaptionOverlay({
  player,
  post,
  active,
  isAuthor,
}: {
  player: VideoPlayer;
  post: Pick<FeedPost, 'id' | 'captions_path' | 'captions_status' | 'captions_language'>;
  active: boolean;
  isAuthor: boolean;
}) {
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });
  const [enabled, setEnabled] = useState(false);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [cues, setCues] = useState<VttCue[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const statusMessage = useMemo(
    () => (post.captions_status === 'ready' ? null : statusCopy(post.captions_status)),
    [post.captions_status],
  );
  const displayMessage = message ?? statusMessage;

  useEffect(() => {
    setCaptionTimeUpdateInterval(player, 0.25);
    return () => {
      setCaptionTimeUpdateInterval(player, 0);
    };
  }, [player]);

  useEffect(() => {
    let mounted = true;
    const syncPreference = (saved: boolean) => {
      setEnabled(saved);
      setPreferenceLoaded(true);
    };
    preferenceListeners.add(syncPreference);
    if (cachedPreference !== null) {
      syncPreference(cachedPreference);
    }
    void preferenceStorage.getItem(captionPreferenceKey).then((saved) => {
      if (mounted && cachedPreference === null) {
        updateCaptionPreference(saved === 'true');
      }
    }).catch(async () => {
      if (mounted) {
        setMessage('Could not load your caption preference.');
        setPreferenceLoaded(true);
      }
    });
    return () => {
      mounted = false;
      preferenceListeners.delete(syncPreference);
    };
  }, []);

  const loadCues = useCallback(async () => {
    if (!post.captions_path) throw new Error('The caption file is not available.');
    setLoading(true);
    setMessage(null);
    try {
      setCues(await loadCaptionFile(post.captions_path));
    } catch {
      setMessage('Could not load captions. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [post.captions_path]);

  useEffect(() => {
    if (!active || !enabled || !preferenceLoaded || post.captions_status !== 'ready') return undefined;

    let cancelled = false;
    void (async () => {
      if (!post.captions_path) return;
      setLoading(true);
      setMessage(null);
      try {
        const nextCues = await loadCaptionFile(post.captions_path);
        if (!cancelled) setCues(nextCues);
      } catch {
        if (!cancelled) setMessage('Could not load captions. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, enabled, post.captions_path, post.captions_status, preferenceLoaded]);

  const toggleCaptions = async () => {
    if (post.captions_status !== 'ready' || !post.captions_path) {
      setMessage(statusCopy(post.captions_status));
      return;
    }
    const nextEnabled = !enabled;
    updateCaptionPreference(nextEnabled);
    setMessage(null);
    try {
      await preferenceStorage.setItem(captionPreferenceKey, String(nextEnabled));
      if (nextEnabled) await loadCues();
    } catch {
      updateCaptionPreference(!nextEnabled);
      setMessage('Could not save your caption preference.');
    }
  };

  const retryCaptions = async () => {
    if (retrying) return;
    setRetrying(true);
    setMessage(null);
    try {
      const { error } = await getSupabaseClient().rpc('request_captions', { post_id: post.id });
      if (error) throw error;
      setMessage('Captions are being generated.');
    } catch (error) {
      setMessage(await getErrorMessage(error, 'Could not retry captions. Try again.'));
    } finally {
      setRetrying(false);
    }
  };

  const cue = enabled && post.captions_status === 'ready' ? findVttCue(cues, currentTime) : null;

  return (
    <View style={[styles.container, { pointerEvents: 'box-none' }]}>
      <View style={styles.controls}>
        <Pressable
          onPress={() => void toggleCaptions()}
          style={[styles.ccButton, enabled && styles.ccButtonActive]}
          accessibilityRole="button"
          accessibilityLabel={enabled ? 'Turn captions off' : 'Turn captions on'}
        >
          <Text style={styles.ccText}>{enabled ? 'CC on' : 'CC'}</Text>
        </Pressable>
        {post.captions_language ? <Text style={styles.language}>{post.captions_language.toUpperCase()}</Text> : null}
      </View>
      {cue ? (
        <Text accessibilityLiveRegion="polite" style={styles.captionText}>
          {cue.text}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color={theme.colors.white} style={styles.indicator} /> : null}
      {displayMessage ? <Text style={styles.message}>{displayMessage}</Text> : null}
      {post.captions_status === 'failed' && isAuthor ? (
        <Pressable onPress={() => void retryCaptions()} disabled={retrying} style={styles.retryButton} accessibilityRole="button">
          {retrying ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={styles.retryText}>Retry captions</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 68,
    bottom: 16,
    alignItems: 'flex-start',
    gap: 6,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  ccButton: {
    minHeight: 34,
    minWidth: 40,
    paddingHorizontal: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  ccButtonActive: { backgroundColor: theme.colors.primary },
  ccText: { color: theme.colors.white, fontSize: 12, fontWeight: '800' },
  language: {
    color: theme.colors.white,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  captionText: {
    color: theme.colors.white,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  indicator: { marginLeft: 10 },
  message: {
    color: theme.colors.white,
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  retryButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: theme.colors.primary, fontSize: 12, fontWeight: '800' },
});
