import { goBack } from '../lib/navigation';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEvent } from 'expo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer, type VideoThumbnail } from 'expo-video';
import { Icon } from '../components/Icon';
import { SectionErrorBoundary } from '../components/SectionErrorBoundary';
import { FocusableTextInput } from '../components/AuthField';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { preferenceStorage } from '../lib/storage';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
import {
  deletePostDraft,
  enqueueVideoUpload,
  loadUploadJobs,
  loadPostDrafts,
  removeUploadJob,
  resumeVideoUpload,
  savePostDraft,
  subscribeToUploadJobs,
  type VideoDraft,
  type VideoUploadJob,
} from '../features/feed/uploadManager';
import type { SavedPostDraft } from '../features/feed/postDraftModel';
import {
  extractHashtags,
  maxVideoDurationMs,
  maxVideoSizeBytes,
  validateVideo,
} from '../features/feed/uploadValidation';
import { getVideoExtension } from '../features/media/videoExtension';
import { localDateTimeParts, parseLocalSchedule } from '../features/feed/scheduledPosts';
import { ScheduledDateTimePicker } from '../features/feed/ScheduledDateTimePicker';
import { deleteEditedVideo } from '../features/video-editor/exportVideo';
import { openVideoEditor } from '../features/video-editor/videoEditorRequests';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

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

function DraftThumbnail({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.pause();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status, error: undefined });
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const thumbnailRef = useRef<VideoThumbnail | null>(null);

  useEffect(() => {
    if (status !== 'readyToPlay' || thumbnailRef.current) return undefined;
    let active = true;
    void player.generateThumbnailsAsync([0], { maxWidth: 160, maxHeight: 120 })
      .then((thumbnails) => {
        const first = thumbnails[0];
        if (!first) return;
        if (active) {
          thumbnailRef.current = first;
          setThumbnail(first);
        } else {
          first.release();
        }
        thumbnails.slice(1).forEach((item) => item.release());
      })
      .catch((thumbnailError: unknown) => {
        console.error('Unable to create a post draft thumbnail.', thumbnailError);
      });
    return () => {
      active = false;
      thumbnailRef.current?.release();
      thumbnailRef.current = null;
    };
  }, [player, status]);

  if (thumbnail) return <Image source={thumbnail} contentFit="cover" style={styles.draftThumbnail} />;
  return (
    <View style={[styles.draftThumbnail, styles.draftThumbnailFallback]}>
      <Icon name="video" size={24} color={theme.colors.primary} />
    </View>
  );
}

export default function CreatePostScreen() {
  const [draft, setDraft] = useState<VideoDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<SavedPostDraft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [jobs, setJobs] = useState<VideoUploadJob[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [schedulePost, setSchedulePost] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => localDateTimeParts(new Date(Date.now() + 60 * 60 * 1000).toISOString()).date);
  const [scheduleTime, setScheduleTime] = useState(() => localDateTimeParts(new Date(Date.now() + 60 * 60 * 1000).toISOString()).time);
  const [error, setError] = useState<string | null>(null);
  const [captionsNoticeSeen, setCaptionsNoticeSeen] = useState<boolean | null>(null);
  const [showCaptionsNoticeAfterToggle, setShowCaptionsNoticeAfterToggle] = useState(false);
  const savedDraftSignature = useRef('');

  const draftError = useMemo(
    () => draft.uri ? validateVideo({ durationMs: draft.durationMs, sizeBytes: draft.fileSize }) : null,
    [draft.durationMs, draft.fileSize, draft.uri],
  );
  const draftHasUpload = jobs.some((job) => job.uri === draft.uri);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();
    void client.auth.getSession().then(async (userResult) => {
      if (userResult.error) throw userResult.error;
      if (!mounted) return;
      const user = userResult.data.session?.user;
      setOwnerId(user?.id ?? null);
      if (user) {
        const drafts = await loadPostDrafts(user.id);
        if (!mounted) return;
        setSavedDrafts(drafts);
        const latest = drafts[0];
        if (latest) {
          setDraftId(latest.id);
          setDraft(latest.video);
          savedDraftSignature.current = JSON.stringify({ id: latest.id, video: latest.video });
        } else {
          const freshId = Crypto.randomUUID();
          setDraftId(freshId);
          savedDraftSignature.current = JSON.stringify({ id: freshId, video: emptyDraft });
        }
      } else {
        setDraftId(Crypto.randomUUID());
      }
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
      console.error('Unable to load the saved video draft.', loadError);
      if (mounted) void getErrorMessage(loadError, 'Could not load your saved draft.').then(setError);
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
        console.error('Unable to load caption settings.', loadError);
        void getErrorMessage(loadError, 'Could not load caption settings.').then(setError);
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
    if (!draftReady || !ownerId || !draftId) return;
    const signature = JSON.stringify({ id: draftId, video: draft });
    if (signature === savedDraftSignature.current || (!draft.uri && !draft.caption.trim())) return;
    let active = true;
    const save = setTimeout(() => {
      void savePostDraft(draftId, ownerId, draft).then((saved) => {
        if (!active) return;
        savedDraftSignature.current = JSON.stringify({ id: draftId, video: draft });
        setSavedDrafts((current) => [
          saved,
          ...current.filter((item) => item.id !== saved.id),
        ].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)));
      }).catch((saveError: unknown) => {
        console.error('Unable to save the video draft.', saveError);
        if (active) void getErrorMessage(saveError, 'Could not save your draft.').then(setError);
      });
    }, 2500);
    return () => {
      active = false;
      clearTimeout(save);
    };
  }, [draft, draftId, draftReady, ownerId]);

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
        const edited = await openVideoEditor({
          uri: asset.uri,
          maxDurationMs: maxVideoDurationMs,
          maxSizeBytes: maxVideoSizeBytes,
          durationMs,
          sizeBytes: fileSize,
          width: asset.width,
          height: asset.height,
        });
        if (!edited) return;
        const editedError = validateVideo(edited);
        if (editedError) {
          deleteEditedVideo(edited.uri);
          setError(editedError);
          return;
        }
        if (draft.uri && !draftHasUpload) {
          const previousFile = new File(draft.uri);
          if (previousFile.exists) previousFile.delete();
        }
        setDraft((current) => ({
          ...current,
          uri: edited.uri,
          fileName: 'video.mp4',
          contentType: 'video/mp4',
          fileSize: edited.sizeBytes,
          durationMs: edited.durationMs,
          width: edited.width,
          height: edited.height,
          editSettings: {
            startMs: edited.startMs,
            endMs: edited.endMs,
            muted: edited.muted,
          },
        }));
        return;
      }
      const extension = getVideoExtension(fileName, asset.mimeType);
      const draftsDirectory = new Directory(Paths.document, 'wimpex-drafts');
      draftsDirectory.create({ intermediates: true, idempotent: true });
      const durableFile = new File(draftsDirectory, `${Crypto.randomUUID()}.${extension}`);
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
        editSettings: undefined,
      }));
    } catch (pickError) {
      console.error('Unable to pick a video for the post.', pickError);
      setError(await getErrorMessage(pickError, 'Could not open your video library.'));
    }
  };

  const editSelectedVideo = async () => {
    if (!draft.uri || draftHasUpload) return;
    setError(null);
    try {
      const edited = await openVideoEditor({
        uri: draft.uri,
        maxDurationMs: maxVideoDurationMs,
        maxSizeBytes: maxVideoSizeBytes,
        durationMs: draft.durationMs,
        sizeBytes: draft.fileSize,
        width: draft.width,
        height: draft.height,
        caption: draft.caption,
      });
      if (!edited) return;
      const editedError = validateVideo(edited);
      if (editedError) {
        deleteEditedVideo(edited.uri);
        setError(editedError);
        return;
      }
      const previousFile = new File(draft.uri);
      if (previousFile.exists && !draftHasUpload) previousFile.delete();
      setDraft((current) => ({
        ...current,
        uri: edited.uri,
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        fileSize: edited.sizeBytes,
        durationMs: edited.durationMs,
        width: edited.width,
        height: edited.height,
        caption: edited.caption,
        editSettings: {
          startMs: edited.startMs,
          endMs: edited.endMs,
          muted: edited.muted,
        },
      }));
    } catch (editError) {
      console.error('Unable to open the video editor for the post.', editError);
      setError(await getErrorMessage(editError, 'Could not edit this video.'));
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
    const scheduleResult = schedulePost ? parseLocalSchedule(scheduleDate, scheduleTime) : null;
    const scheduledAt = scheduleResult?.scheduledAt ?? null;
    if (schedulePost && !scheduledAt) {
      setError(scheduleResult?.error ?? 'Choose a valid date and time.');
      return;
    }

    setBusy(true);
    const postId = Crypto.randomUUID();
    const extension = getVideoExtension(draft.fileName, draft.contentType);
    const job: VideoUploadJob = {
      ...draft,
      scheduledAt,
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
      await deletePostDraft(draftId, ownerId);
      setSavedDrafts((current) => current.filter((item) => item.id !== draftId));
      savedDraftSignature.current = '';
      setDraft(emptyDraft);
      setDraftId(Crypto.randomUUID());
      if (scheduledAt) {
        Alert.alert('Video scheduled', `Your video will go live ${new Date(scheduledAt).toLocaleString()}.`);
        router.replace('/scheduled-posts');
      } else {
        Alert.alert('Video posted', 'Your video is now available in the feed.');
        router.replace({ pathname: '/post/[id]', params: { id: postId } });
      }
    } catch (uploadError) {
      console.error('Unable to enqueue the video post.', uploadError);
      setError(await getErrorMessage(uploadError, 'The video upload failed. Try again.'));
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
        if (ownerId) await deletePostDraft(draftId, ownerId);
        setSavedDrafts((current) => current.filter((item) => item.id !== draftId));
        savedDraftSignature.current = '';
        setDraft(emptyDraft);
        setDraftId(Crypto.randomUUID());
        router.replace({ pathname: '/post/[id]', params: { id: job.postId } });
      }
    } catch (uploadError) {
      console.error('Unable to retry the video upload.', uploadError);
      setError(await getErrorMessage(uploadError, 'The video upload failed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteJob = async (job: VideoUploadJob) => {
    try {
      await removeUploadJob(job.id);
    } catch (deleteError) {
      console.error('Unable to remove the failed video upload.', deleteError);
      setError(await getErrorMessage(deleteError, 'Could not remove this upload.'));
    }
  };

  const clearSelectedVideo = () => {
    const selectedFile = new File(draft.uri);
    if (selectedFile.exists && !draftHasUpload) selectedFile.delete();
    setDraft((current) => ({
      ...current,
      uri: '',
      fileName: '',
      fileSize: 0,
      durationMs: 0,
      width: 0,
      height: 0,
      editSettings: undefined,
    }));
  };

  const flushActiveDraft = async () => {
    if (!ownerId || !draftId || (!draft.uri && !draft.caption.trim())) return true;
    const signature = JSON.stringify({ id: draftId, video: draft });
    if (signature === savedDraftSignature.current) return true;
    try {
      const saved = await savePostDraft(draftId, ownerId, draft);
      savedDraftSignature.current = signature;
      setSavedDrafts((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)));
      return true;
    } catch (saveError) {
      console.error('Unable to save the post draft before leaving the composer.', saveError);
      setError(await getErrorMessage(saveError, 'Could not save your draft.'));
      return false;
    }
  };

  const chooseDraft = async (saved: SavedPostDraft) => {
    if (!(await flushActiveDraft())) return;
    setDraftId(saved.id);
    setDraft(saved.video);
    savedDraftSignature.current = JSON.stringify({ id: saved.id, video: saved.video });
    setDraftsOpen(false);
    setError(null);
  };

  const discardDraft = async (id: string): Promise<boolean> => {
    if (!ownerId) return false;
    try {
      const removed = await deletePostDraft(id, ownerId);
      setSavedDrafts((current) => current.filter((item) => item.id !== id));
      if (removed?.video.uri && !jobs.some((job) => job.uri === removed.video.uri)) {
        const file = new File(removed.video.uri);
        if (file.exists) file.delete();
      }
      if (draftId === id) {
        setDraft(emptyDraft);
        setDraftId(Crypto.randomUUID());
        savedDraftSignature.current = '';
      }
      return true;
    } catch (discardError) {
      console.error('Unable to discard a saved post draft.', discardError);
      setError(await getErrorMessage(discardError, 'Could not discard this draft.'));
      return false;
    }
  };

  const leaveComposer = () => {
    if (!draft.uri && !draft.caption.trim()) {
      goBack();
      return;
    }
    Alert.alert(
      'Save this draft?',
      'Your draft is saved on this device only.',
      [
        {
          text: 'Keep draft',
          onPress: () => {
            void flushActiveDraft().then((saved) => {
              if (saved) goBack();
            });
          },
        },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (await discardDraft(draftId)) goBack();
            })();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={leaveComposer}
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
          {busy
            ? <ActivityIndicator color={theme.colors.black} />
            : <Text style={styles.postButtonText}>{schedulePost ? 'Schedule' : 'Post'}</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.draftsRow}>
          <Text style={styles.localDraftNotice}>Drafts are stored on this device only.</Text>
          <View style={styles.draftActions}>
            <Pressable
              onPress={() => setDraftsOpen(true)}
              style={styles.draftsButton}
              accessibilityRole="button"
              accessibilityLabel={`Open ${savedDrafts.length} saved drafts`}
            >
              <Text style={styles.draftsButtonText}>Drafts ({savedDrafts.length})</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/scheduled-posts')} style={styles.draftsButton} accessibilityRole="link">
              <Text style={styles.draftsButtonText}>Scheduled</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Video</Text>
        {draft.uri ? (
          <View style={styles.preview}>
            <SectionErrorBoundary title="Video preview needs to restart">
              <LocalVideoPreview uri={draft.uri} />
            </SectionErrorBoundary>
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
            <Pressable
              onPress={() => void editSelectedVideo()}
              disabled={busy || draftHasUpload}
              style={styles.editMedia}
              accessibilityRole="button"
              accessibilityLabel="Trim or edit selected video"
            >
              <Text style={styles.editMediaText}>Edit</Text>
            </Pressable>
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
            <Text style={styles.fieldLabel}>Publish time</Text>
            <View style={styles.audienceChoices}>
              {([false, true] as const).map((scheduled) => (
                <Pressable
                  key={String(scheduled)}
                  onPress={() => setSchedulePost(scheduled)}
                  style={[styles.audienceButton, schedulePost === scheduled && styles.audienceButtonActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: schedulePost === scheduled }}
                >
                  <Text style={[styles.audienceText, schedulePost === scheduled && styles.audienceTextActive]}>
                    {scheduled ? 'Schedule' : 'Now'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {schedulePost ? (
            <>
              <Text style={styles.scheduleHint}>Date and time use your device’s local time (10 minutes to 30 days ahead).</Text>
              <ScheduledDateTimePicker
                date={scheduleDate}
                time={scheduleTime}
                onDateChange={setScheduleDate}
                onTimeChange={setScheduleTime}
              />
            </>
          ) : null}
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
                  console.error('Unable to save caption settings.', noticeError);
                  void getErrorMessage(noticeError, 'Could not save caption settings.').then(setError);
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

      <Modal
        transparent
        animationType="slide"
        visible={draftsOpen}
        onRequestClose={() => setDraftsOpen(false)}
      >
        <View style={styles.draftsModal}>
          <Pressable
            style={styles.draftsScrim}
            onPress={() => setDraftsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close saved drafts"
          />
          <View style={styles.draftsSheet}>
            <View style={styles.draftsHeader}>
              <View>
                <Text style={styles.draftsTitle}>Saved drafts</Text>
                <Text style={styles.helper}>Stored on this device only</Text>
              </View>
              <Pressable onPress={() => setDraftsOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="close" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.draftsList}>
              {savedDrafts.length ? savedDrafts.map((saved) => (
                <View key={saved.id} style={styles.draftCard}>
                  {saved.video.uri
                    ? <DraftThumbnail uri={saved.video.uri} />
                    : <View style={[styles.draftThumbnail, styles.draftThumbnailFallback]}><Icon name="video" size={24} color={theme.colors.primary} /></View>}
                  <Pressable
                    onPress={() => chooseDraft(saved)}
                    style={styles.draftDescription}
                    accessibilityRole="button"
                    accessibilityLabel={`Resume draft, ${Math.ceil(saved.video.durationMs / 1000)} seconds, edited ${new Date(saved.updatedAt).toLocaleString()}`}
                  >
                    <Text style={styles.draftCaption} numberOfLines={2}>
                      {saved.video.caption.trim() || 'Untitled post'}
                    </Text>
                    <Text style={styles.helper}>
                      {saved.video.uri ? `${Math.ceil(saved.video.durationMs / 1000)} seconds · ` : ''}
                      Edited {new Date(saved.updatedAt).toLocaleString()}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void discardDraft(saved.id)}
                    style={styles.discardDraftButton}
                    accessibilityRole="button"
                    accessibilityLabel="Discard draft"
                  >
                    <Icon name="trash" size={20} color={theme.colors.danger} />
                  </Pressable>
                </View>
              )) : (
                <Text style={styles.emptyDrafts}>No saved drafts yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  draftsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  draftActions: { flexDirection: 'row', gap: 6 },
  localDraftNotice: { flex: 1, color: theme.colors.textMuted, fontSize: 11 },
  draftsButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: theme.colors.surface },
  draftsButtonText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  scheduleHint: { color: theme.colors.textMuted, fontSize: 12, paddingBottom: 8 },
  draftsModal: { flex: 1, justifyContent: 'flex-end' },
  draftsScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)' },
  draftsSheet: { maxHeight: '78%', backgroundColor: theme.colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 },
  draftsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16 },
  draftsTitle: { color: theme.colors.white, fontSize: 19, fontWeight: '800' },
  draftsList: { gap: 10, paddingBottom: 20 },
  draftCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, backgroundColor: theme.colors.black, padding: 9 },
  draftThumbnail: { width: 58, height: 64, borderRadius: 9 },
  draftThumbnailFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  draftDescription: { flex: 1, gap: 5 },
  draftCaption: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  discardDraftButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  emptyDrafts: { color: theme.colors.textMuted, paddingVertical: 24, textAlign: 'center' },
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
  editMedia: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  editMediaText: { color: theme.colors.gold, fontSize: 13, fontWeight: '700' },
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
