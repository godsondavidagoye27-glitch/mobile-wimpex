import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../components/Icon';
import { FocusableTextInput } from '../components/AuthField';
import { getErrorMessage } from '../lib/errorMessage';
import { createStory } from '../features/stories/storyService';
import {
  fitStoryImageDimensions,
  validateStoryCaption,
  validateStoryVideo,
} from '../features/stories/storyTimeline';
import { deleteEditedVideo } from '../features/video-editor/exportVideo';
import { openVideoEditor } from '../features/video-editor/videoEditorRequests';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
import type { Database } from '../types/database';

type Audience = 'everyone' | 'followers' | 'close_friends';
type CaptionColor = 'sky' | 'green' | 'gold' | 'dark' | 'light';

const captionColors: { token: CaptionColor; color: string; label: string }[] = [
  { token: 'sky', color: theme.colors.primary, label: 'Sky' },
  { token: 'green', color: theme.colors.success, label: 'Green' },
  { token: 'gold', color: theme.colors.gold, label: 'Gold' },
  { token: 'dark', color: theme.colors.surface, label: 'Dark' },
  { token: 'light', color: '#FFFFFF', label: 'Light' },
];
const audiences: Audience[] = ['everyone', 'followers', 'close_friends'];
const audienceLabels: Record<Audience, string> = {
  everyone: 'Everyone',
  followers: 'Followers',
  close_friends: 'Close friends',
};

function LocalVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  return <VideoView player={player} style={styles.preview} contentFit="cover" nativeControls />;
}

export default function CreateStoryScreen() {
  const [caption, setCaption] = useState('');
  const [captionColor, setCaptionColor] = useState<CaptionColor>('dark');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [media, setMedia] = useState<{
    uri: string;
    kind: 'image' | 'video';
    mimeType: 'image/jpeg' | 'video/mp4' | 'video/quicktime';
    durationMs: number;
    sizeBytes: number;
    width: number;
    height: number;
  } | null>(null);
  const [closeFriendCount, setCloseFriendCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStoryMedia = (next: NonNullable<typeof media>) => {
    if (media && media.uri !== next.uri) deleteEditedVideo(media.uri);
    setMedia(next);
  };

  const editStoryVideo = async (video: NonNullable<typeof media>) => {
    if (video.kind !== 'video') return;
    const edited = await openVideoEditor({
      uri: video.uri,
      maxDurationMs: 15_000,
      maxSizeBytes: 25 * 1024 * 1024,
      durationMs: video.durationMs,
      sizeBytes: video.sizeBytes,
      width: video.width,
      height: video.height,
      caption,
    });
    if (!edited) return;
    const validationMessage = validateStoryVideo(edited.durationMs, edited.sizeBytes);
    if (validationMessage) {
      deleteEditedVideo(edited.uri);
      throw new Error(validationMessage);
    }
    setCaption(edited.caption.slice(0, 120));
    setStoryMedia({
      uri: edited.uri,
      kind: 'video',
      mimeType: 'video/mp4',
      durationMs: edited.durationMs,
      sizeBytes: edited.sizeBytes,
      width: edited.width,
      height: edited.height,
    });
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: queryError } = await getSupabaseClient().rpc('get_close_friends', { p_query: '', p_cursor: null });
        if (queryError) throw queryError;
        if (active) setCloseFriendCount(data?.length ?? 0);
      } catch (caught) {
        console.error('Unable to load close friends for story audience.', caught);
        if (active) void getErrorMessage(caught, 'Could not load your close friends.').then(setError);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const pickMedia = async (useCamera: boolean) => {
    setError('');
    try {
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Allow camera access in Settings to take a story.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo and video access in Settings to choose a story.');
          return;
        }
      }

      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
      };
      const result = useCamera
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('Could not read the selected media.');

      if (asset.type === 'video') {
        const size = asset.fileSize ?? new File(asset.uri).size;
        const mimeType = asset.mimeType?.toLowerCase();
        const validationMessage = validateStoryVideo(asset.duration ?? 0, size);
        const requiresMp4Export = mimeType !== 'video/mp4' && mimeType !== 'video/quicktime';
        if (validationMessage || requiresMp4Export) {
          const edited = await openVideoEditor({
            uri: asset.uri,
            maxDurationMs: 15_000,
            maxSizeBytes: 25 * 1024 * 1024,
            durationMs: asset.duration ?? 0,
            sizeBytes: size,
            width: asset.width,
            height: asset.height,
            caption,
          });
          if (!edited) return;
          const editedValidation = validateStoryVideo(edited.durationMs, edited.sizeBytes);
          if (editedValidation) {
            deleteEditedVideo(edited.uri);
            throw new Error(editedValidation);
          }
          setCaption(edited.caption.slice(0, 120));
          setStoryMedia({
            uri: edited.uri,
            kind: 'video',
            mimeType: 'video/mp4',
            durationMs: edited.durationMs,
            sizeBytes: edited.sizeBytes,
            width: edited.width,
            height: edited.height,
          });
          return;
        }
        if (mimeType !== 'video/mp4' && mimeType !== 'video/quicktime') {
          setError('Choose an MP4 or MOV video.');
          return;
        }
        setStoryMedia({
          uri: asset.uri,
          kind: 'video',
          mimeType,
          durationMs: Math.round(asset.duration ?? 0),
          sizeBytes: size,
          width: asset.width,
          height: asset.height,
        });
        return;
      }

      if (asset.type !== 'image') throw new Error('Choose a photo or a video.');
      const target = fitStoryImageDimensions(asset.width, asset.height);
      const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
      let rendered: ImageManipulator.ImageRef | null = null;
      try {
        if (target.width !== asset.width || target.height !== asset.height) {
          context.resize(target);
        }
        rendered = await context.renderAsync();
        const resultImage = await rendered.saveAsync({
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.8,
        });
        const file = new File(resultImage.uri);
        if (!file.exists || file.size <= 0) throw new Error('The selected photo could not be prepared.');
        setStoryMedia({
          uri: resultImage.uri,
          kind: 'image',
          mimeType: 'image/jpeg',
          durationMs: 5000,
          sizeBytes: file.size,
          width: resultImage.width,
          height: resultImage.height,
        });
      } finally {
        rendered?.release();
        context.release();
      }
    } catch (caught) {
      console.error('Unable to prepare story media.', caught);
      setError(await getErrorMessage(caught, 'Could not prepare the selected media.'));
    }
  };

  const selectAudience = () => {
    const next = audiences[(audiences.indexOf(audience) + 1) % audiences.length];
    if (next === 'close_friends' && closeFriendCount === 0) {
      setError('Add close friends first.');
      return;
    }
    setError('');
    setAudience(next);
  };

  const shareStory = async () => {
    setError('');
    if (!media) {
      setError('Choose a photo or video before sharing your story.');
      return;
    }
    const captionError = validateStoryCaption(caption);
    if (captionError) {
      setError(captionError);
      return;
    }
    if (audience === 'close_friends' && closeFriendCount === 0) {
      setError('Add close friends first.');
      return;
    }

    setBusy(true);
    const id = Crypto.randomUUID();
    const captionStyle: Database['public']['Tables']['stories']['Insert']['caption_style'] =
      caption.trim() ? { background: captionColor } : null;
    try {
      const created = await createStory({
        id,
        kind: media.kind,
        uri: media.uri,
        mimeType: media.mimeType,
        caption,
        captionStyle,
        audience,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height,
      });
      if (media.kind === 'video') deleteEditedVideo(media.uri);
      router.replace({ pathname: '/story/[authorId]', params: { authorId: created.authorId } });
    } catch (caught) {
      console.error('Unable to share story.', caught);
      setError(await getErrorMessage(caught, 'Could not share this story.'));
    } finally {
      setBusy(false);
    }
  };

  const previewColor = captionColors.find((item) => item.token === captionColor)?.color ?? theme.colors.surface;

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Story</Text>
        <Pressable
          onPress={() => void shareStory()}
          disabled={busy}
          style={[styles.shareButton, busy && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Share story"
        >
          {busy ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.shareText}>Share</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.actionRow}>
          <Pressable style={styles.actionButton} onPress={() => void pickMedia(false)} disabled={busy} accessibilityRole="button">
            <Text style={styles.actionText}>Choose photo or video</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => void pickMedia(true)} disabled={busy} accessibilityRole="button">
            <Text style={styles.actionText}>Use camera</Text>
          </Pressable>
        </View>

        <View style={styles.previewCard}>
          {media ? (
            media.kind === 'video' ? (
              <LocalVideoPreview uri={media.uri} />
            ) : (
              <Image source={{ uri: media.uri }} style={styles.preview} resizeMode="cover" />
            )
          ) : (
            <Text style={styles.previewPlaceholder}>Choose a photo or video.</Text>
          )}
          {media?.kind === 'video' ? (
            <Pressable
              onPress={() => void editStoryVideo(media).catch(async (editError: unknown) => {
                console.error('Unable to edit story video.', editError);
                setError(await getErrorMessage(editError, 'Could not edit this video.'));
              })}
              style={styles.editVideoButton}
              accessibilityRole="button"
              accessibilityLabel="Trim or edit story video"
            >
              <Text style={styles.editVideoText}>Edit video</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.captionHeader}>
            <Text style={styles.label}>Caption</Text>
            <Text style={styles.counter}>{caption.length}/120</Text>
          </View>
          <FocusableTextInput
            value={caption}
            onChangeText={(value) => {
              setCaption(value.slice(0, 120));
              setError('');
            }}
            placeholder="Add a caption"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={120}
            multiline
            style={styles.input}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />
          <View style={styles.colorRow}>
            {captionColors.map((item) => (
              <Pressable
                key={item.token}
                onPress={() => setCaptionColor(item.token)}
                style={[
                  styles.colorButton,
                  { backgroundColor: item.color },
                  captionColor === item.token && styles.colorSelected,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Caption background: ${item.label}`}
                accessibilityState={{ selected: captionColor === item.token }}
              />
            ))}
          </View>
          {caption.trim() ? (
            <View style={[styles.captionPreview, { backgroundColor: previewColor }]}>
              <Text style={styles.captionPreviewText}>{caption}</Text>
            </View>
          ) : null}
        </View>

        <Pressable onPress={selectAudience} style={styles.audienceRow} accessibilityRole="button" accessibilityLabel={`Audience: ${audienceLabels[audience]}`}>
          <View>
            <Text style={styles.label}>Audience</Text>
            <Text style={styles.audienceValue}>{audienceLabels[audience]}</Text>
          </View>
          <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
        </Pressable>
        {audience === 'close_friends' && closeFriendCount === 0 ? (
          <Pressable onPress={() => router.push('/close-friends')} style={styles.addFriends} accessibilityRole="button">
            <Text style={styles.addFriendsText}>Add close friends first. Add close friends</Text>
          </Pressable>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
  headerButton: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  shareButton: { minWidth: 72, minHeight: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  shareText: { color: theme.colors.black, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  content: { paddingHorizontal: 16, paddingBottom: 30, gap: 14 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  actionText: { color: theme.colors.white, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  previewCard: { height: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: '100%', backgroundColor: theme.colors.surface },
  previewPlaceholder: { color: theme.colors.textMuted, fontSize: 14 },
  editVideoButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editVideoText: { color: theme.colors.gold, fontSize: 13, fontWeight: '700' },
  card: { padding: 14, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  captionHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  counter: { color: theme.colors.textMuted, fontSize: 12 },
  input: { minHeight: 72, color: theme.colors.white, fontSize: 15, lineHeight: 22, paddingTop: 8 },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 12 },
  colorButton: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  colorSelected: { borderWidth: 3, borderColor: theme.colors.white },
  captionPreview: { minHeight: 38, alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 10 },
  captionPreviewText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  audienceRow: { minHeight: 62, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audienceValue: { color: theme.colors.white, fontSize: 14, fontWeight: '700', marginTop: 3 },
  addFriends: { minHeight: 44, justifyContent: 'center' },
  addFriendsText: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 18 },
});
