import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../components/Icon';
import { FocusableTextInput } from '../components/AuthField';
import { getSupabaseClient } from '../lib/supabase';
import { preferenceStorage } from '../lib/storage';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
import {
  clearVideoDraft,
  enqueueVideoUpload,
  loadUploadJobs,
  loadVideoDraft,
  removeUploadJob,
  resumeVideoUpload,
  saveVideoDraft,
  subscribeToUploadJobs,
  type VideoDraft,
  type VideoUploadJob,
} from '../features/feed/uploadManager';
import { extractHashtags, validateVideo } from '../features/feed/uploadValidation';
import { getVideoExtension } from '../features/media/videoExtension';

const emptyDraft: VideoDraft = {
  uri: '',
  fileName: '',
  contentType: 'video/mp4',
  fileSize: 0,
  durationMs: 0,
  width: 0,
  height: 0,
  caption: '',
  audience: 'everyone',
  allowComments: true,
  autoCaptions: true,
};

const captionsNoticePreferenceKey = 'wimpex.captions.disclosure-seen';
const captionsNotice = "Wimpex sends your video's audio to a speech-to-text service to make captions. Captions are saved with your video. Turn this off to keep the audio on Wimpex only.";

function LocalVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });

  return <VideoView player={player} style={styles.previewVideo} nativeControls />;
}

export default function CreatePostScreen() {
  const [draft, setDraft] = useState<VideoDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [jobs, setJobs] = useState<VideoUploadJob[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captionsNoticeSeen, setCaptionsNoticeSeen] = useState<boolean | null>(null);
  const [showCaptionsNoticeAfterToggle, setShowCaptionsNoticeAfterToggle] = useState(false);

  const draftError = useMemo(
    () => draft.uri ? validateVideo({ durationMs: draft.durationMs, sizeBytes: draft.fileSize }) : null,
    [draft.durationMs, draft.fileSize, draft.uri],
  );
  const draftHasUpload = jobs.some((job) => job.uri === draft.uri);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();
    void Promise.all([client.auth.getSession(), loadVideoDraft()]).then(async ([userResult, savedDraft]) => {
      if (userResult.error) throw userResult.error;
      if (!mounted) return;
      const user = userResult.data.session?.user;
      setOwnerId(user?.id ?? null);
      if (savedDraft) setDraft(savedDraft);
      setDraftReady(true);
      if (user) {
        const pendingJobs = await loadUploadJobs(user.id);
        if (!mounted) return;
        setJobs(pendingJobs);
        pendingJobs.filter((job) => job.state !== 'failed').forEach((job) => {
          void resumeVideoUpload(job.id).catch((error: unknown) => {
            console.error('Unable to resume saved video upload.', error);
          });
        });
      }
    }).catch((loadError: unknown) => {
      if (mounted) setError(loadError instanceof Error ? loadError.message : 'Could not load your saved draft.');
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void preferenceStorage.getItem(captionsNoticePreferenceKey).then((value) => {
      if (mounted) setCaptionsNoticeSeen(value === 'true');
    }).catch((loadError: unknown) => {
      if (mounted) {
        setCaptionsNoticeSeen(true);
        setError(loadError instanceof Error ? loadError.message : 'Could not load caption settings.');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const showCaptionsNotice = showCaptionsNoticeAfterToggle
    || (draftReady && captionsNoticeSeen === false && draft.autoCaptions);

  useEffect(() => {
    if (!ownerId) return undefined;
    const unsubscribe = subscribeToUploadJobs((updatedJobs) => {
      setJobs(updatedJobs.filter((job) => job.ownerId === ownerId));
    });
    return () => {
      unsubscribe();
    };
  }, [ownerId]);

  useEffect(() => {
    if (!draftReady) return;
    const save = setTimeout(() => {
      void saveVideoDraft(draft).catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Could not save your draft.');
      });
    }, 250);
    return () => clearTimeout(save);
  }, [draft, draftReady]);

  const pickVideo = async () => {
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow access to your videos in Settings to create a post.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        videoMaxDuration: 60,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const fileName = asset.fileName || (asset.mimeType === 'video/quicktime' ? 'video.mov' : 'video.mp4');
      const fileSize = asset.fileSize ?? new File(asset.uri).size;
      const durationMs = asset.duration ?? 0;
      const videoError = validateVideo({ durationMs, sizeBytes: fileSize });
      if (videoError) {
        setError(videoError);
        return;
      }
      const extension = getVideoExtension(fileName, asset.mimeType);
      const uploadDirectory = new Directory(Paths.document, 'wimpex-uploads');
      uploadDirectory.create({ intermediates: true, idempotent: true });
      const durableFile = new File(uploadDirectory, `${Crypto.randomUUID()}.${extension}`);
      await new File(asset.uri).copy(durableFile);
      if (draft.uri) {
        const previousFile = new File(draft.uri);
        if (previousFile.exists) previousFile.delete();
      }
      setDraft((current) => ({
        ...current,
        uri: durableFile.uri,
        fileName,
        contentType: extension === 'mov' ? 'video/quicktime' : 'video/mp4',
        fileSize,
        durationMs,
        width: asset.width,
        height: asset.height,
      }));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Could not open your video library.');
    }
  };

  const publishPost = async () => {
    setError(null);
    if (!ownerId) {
      setError('Sign in to upload a video.');
      return;
    }
    if (!draft.uri) {
      setError('Choose a video before posting.');
      return;
    }
    if (draftError) {
      setError(draftError);
      return;
    }

    setBusy(true);
    const postId = Crypto.randomUUID();
    const extension = getVideoExtension(draft.fileName, draft.contentType);
    const job: VideoUploadJob = {
      ...draft,
      id: postId,
      ownerId,
      postId,
      fileName: draft.fileName || `video.${extension}`,
      hashtags: extractHashtags(draft.caption),
      progress: 0,
      uploadUrl: null,
      state: 'queued',
      error: null,
    };
    try {
      await enqueueVideoUpload(job);
      await clearVideoDraft();
      setDraft(emptyDraft);
      Alert.alert('Video posted', 'Your video is now available in the feed.');
      router.replace({ pathname: '/post/[id]', params: { id: postId } });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The video upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const retryJob = async (job: VideoUploadJob) => {
    setError(null);
    setBusy(true);
    try {
      await resumeVideoUpload(job.id);
      if (job.uri === draft.uri) {
        await clearVideoDraft();
        setDraft(emptyDraft);
        router.replace({ pathname: '/post/[id]', params: { id: job.postId } });
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The video upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const deleteJob = async (job: VideoUploadJob) => {
    try {
      await removeUploadJob(job.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove this upload.');
    }
  };

  const clearSelectedVideo = () => {
    const selectedFile = new File(draft.uri);
    if (selectedFile.exists && !draftHasUpload) selectedFile.delete();
    setDraft((current) => ({ ...current, uri: '' }));
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Create post</Text>
        <Pressable
          onPress={() => void publishPost()}
          disabled={busy || !draft.uri || Boolean(draftError) || draftHasUpload}
          style={[styles.postButton, (busy || !draft.uri || Boolean(draftError) || draftHasUpload) && styles.disabledButton]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.postButtonText}>Post</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Video</Text>
        {draft.uri ? (
          <View style={styles.preview}>
            <LocalVideoPreview uri={draft.uri} />
            <Pressable
              onPress={clearSelectedVideo}
              style={styles.removeMedia}
              accessibilityRole="button"
              accessibilityLabel="Remove selected video"
            >
              <Icon name="close" size={20} color={theme.colors.white} />
            </Pressable>
            <Text style={styles.videoDetails}>
              {Math.ceil(draft.durationMs / 1000)} seconds, {(draft.fileSize / (1024 * 1024)).toFixed(1)} MB
            </Text>
          </View>
        ) : (
          <Pressable onPress={() => void pickVideo()} style={styles.pickButton} accessibilityRole="button">
            <Icon name="video" size={24} color={theme.colors.primary} />
            <Text style={styles.pickTitle}>Choose a video</Text>
            <Text style={styles.helper}>Up to 60 seconds and 50 MB</Text>
          </Pressable>
        )}

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Caption</Text>
          <FocusableTextInput
            value={draft.caption}
            onChangeText={(caption) => setDraft((current) => ({ ...current, caption }))}
            multiline
            maxLength={150}
            placeholder="Write a caption"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
          />
          <Text style={styles.characterCount}>{draft.caption.length}/150</Text>
          {extractHashtags(draft.caption).length ? (
            <View style={styles.hashtagChips}>
              {extractHashtags(draft.caption).map((tag) => (
                <Pressable
                  key={tag}
                  onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag } })}
                  style={styles.hashtagChip}
                  accessibilityRole="link"
                >
                  <Text style={styles.hashtagChipText}>#{tag}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <Text style={styles.fieldLabel}>Audience</Text>
            <View style={styles.audienceChoices}>
              {(['everyone', 'followers'] as const).map((audience) => (
                <Pressable
                  key={audience}
                  onPress={() => setDraft((current) => ({ ...current, audience }))}
                  style={[styles.audienceButton, draft.audience === audience && styles.audienceButtonActive]}
                >
                  <Text style={[styles.audienceText, draft.audience === audience && styles.audienceTextActive]}>
                    {audience === 'everyone' ? 'Everyone' : 'Followers'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.fieldLabel}>Allow comments</Text>
            <Switch
              value={draft.allowComments}
              onValueChange={(allowComments) => setDraft((current) => ({ ...current, allowComments }))}
              trackColor={{ false: theme.colors.line, true: theme.colors.success }}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.fieldLabel}>Auto captions</Text>
            <Switch
              value={draft.autoCaptions}
              onValueChange={(autoCaptions) => {
                setDraft((current) => ({ ...current, autoCaptions }));
                if (!autoCaptions || captionsNoticeSeen) {
                  setShowCaptionsNoticeAfterToggle(false);
                  return;
                }
                setShowCaptionsNoticeAfterToggle(true);
                setCaptionsNoticeSeen(true);
                void preferenceStorage.setItem(captionsNoticePreferenceKey, 'true').catch((noticeError: unknown) => {
                  setError(noticeError instanceof Error ? noticeError.message : 'Could not save caption settings.');
                });
              }}
              trackColor={{ false: theme.colors.line, true: theme.colors.success }}
            />
          </View>
          {showCaptionsNotice ? (
            <View style={styles.captionsNotice}>
              <Text style={styles.helper}>{captionsNotice}</Text>
              <Pressable onPress={() => router.push('/settings')} accessibilityRole="link">
                <Text style={styles.captionsSettingsLink}>Settings</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}

        {jobs.map((job) => (
          <View key={job.id} style={styles.jobCard}>
            <View style={styles.jobInfo}>
              <Text style={styles.jobTitle}>{job.state === 'failed' ? 'Upload failed' : 'Uploading video'}</Text>
              <Text style={styles.helper}>
                {job.error ?? `${Math.round(job.progress * 100)}%`}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(job.progress * 100)}%` }]} />
              </View>
            </View>
            {job.state === 'failed' ? (
              <>
                <Pressable onPress={() => void retryJob(job)} style={styles.jobButton} accessibilityRole="button">
                  <Text style={styles.jobButtonText}>Retry</Text>
                </Pressable>
                <Pressable onPress={() => void deleteJob(job)} style={styles.jobIconButton} accessibilityRole="button" accessibilityLabel="Remove failed upload">
                  <Icon name="trash" size={20} color={theme.colors.danger} />
                </Pressable>
              </>
            ) : <ActivityIndicator color={theme.colors.primary} />}
          </View>
        ))}
      </ScrollView>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  postButton: {
    minWidth: 64,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  postButtonText: { color: theme.colors.black, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  content: { paddingHorizontal: 18, paddingBottom: 36, gap: 14 },
  sectionTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '700' },
  preview: {
    height: 240,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    position: 'relative',
  },
  previewVideo: { width: '100%', height: '100%' },
  removeMedia: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoDetails: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: theme.colors.white,
    fontSize: 12,
  },
  pickButton: {
    height: 200,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderStyle: 'dashed',
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pickTitle: { color: theme.colors.white, fontWeight: '700', fontSize: 16 },
  helper: { color: theme.colors.textMuted, fontSize: 12 },
  fieldCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: 14,
  },
  fieldLabel: { color: theme.colors.white, fontWeight: '700' },
  input: { minHeight: 84, color: theme.colors.white, textAlignVertical: 'top', marginTop: 10 },
  characterCount: { color: theme.colors.textMuted, alignSelf: 'flex-end', fontSize: 12 },
  hashtagChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  hashtagChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.black,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hashtagChipText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  settingsCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 14,
  },
  settingRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  captionsNotice: { paddingVertical: 12, gap: 8 },
  captionsSettingsLink: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  audienceChoices: { flexDirection: 'row', gap: 8 },
  audienceButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  audienceButtonActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  audienceText: { color: theme.colors.textMuted, fontSize: 12 },
  audienceTextActive: { color: theme.colors.black, fontWeight: '700' },
  errorText: { color: theme.colors.danger, lineHeight: 20 },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: 14,
  },
  jobInfo: { flex: 1, gap: 6 },
  jobTitle: { color: theme.colors.white, fontWeight: '700' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: theme.colors.line, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: theme.colors.primary },
  jobButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  jobButtonText: { color: theme.colors.primary, fontWeight: '700' },
  jobIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
