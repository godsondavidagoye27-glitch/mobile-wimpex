import * as ImagePicker from 'expo-image-picker';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { getErrorMessage } from '../../lib/errorMessage';
import { theme } from '../../theme/theme';
import {
  maxChatMediaSizeBytes,
  maxChatVideoDurationMs,
  maxChatVoiceDurationMs,
  validateChatMedia,
  type ChatMediaAttachment,
} from './chatMediaValidation';
import { prepareChatPickerAsset, prepareRecordedVoice } from './chatMediaPreparation';
import { deleteEditedVideo } from '../video-editor/exportVideo';
import { openVideoEditor } from '../video-editor/videoEditorRequests';

type Props = {
  attachment: ChatMediaAttachment | null;
  disabled: boolean;
  showVoiceRecorder?: boolean;
  onAttachment: (attachment: ChatMediaAttachment) => void;
  caption?: string;
  onCaptionChange?: (caption: string) => void;
  onClear: () => void;
};

export function ChatMediaComposer({
  attachment,
  disabled,
  showVoiceRecorder = true,
  onAttachment,
  caption = '',
  onCaptionChange,
  onClear,
}: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const finishRequested = useRef(false);
  const mountedRef = useRef(true);

  const preparePickedAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const prepared = await prepareChatPickerAsset(asset, { allowOverLimitVideo: true });
    if (prepared.kind !== 'video' || !validateChatMedia(prepared)) return prepared;
    const edited = await openVideoEditor({
      uri: prepared.uri,
      maxDurationMs: maxChatVideoDurationMs,
      maxSizeBytes: maxChatMediaSizeBytes,
      durationMs: prepared.durationMs ?? 0,
      sizeBytes: prepared.sizeBytes,
      width: prepared.width ?? 0,
      height: prepared.height ?? 0,
      caption,
    });
    if (!edited) return null;
    if (edited.caption.trim()) onCaptionChange?.(edited.caption);
    const attachment: ChatMediaAttachment = {
      kind: 'video',
      uri: edited.uri,
      fileName: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: edited.sizeBytes,
      durationMs: edited.durationMs,
      width: edited.width,
      height: edited.height,
    };
    const validationError = validateChatMedia(attachment);
    if (validationError) {
      deleteEditedVideo(edited.uri);
      throw new Error(validationError);
    }
    return attachment;
  };

  const editAttachment = async () => {
    if (!attachment || attachment.kind !== 'video' || disabled || busy) return;
    setBusy(true);
    try {
      const edited = await openVideoEditor({
        uri: attachment.uri,
        maxDurationMs: maxChatVideoDurationMs,
        maxSizeBytes: maxChatMediaSizeBytes,
        durationMs: attachment.durationMs ?? 0,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        caption,
      });
      if (!edited) return;
      if (edited.caption.trim()) onCaptionChange?.(edited.caption);
      const result: ChatMediaAttachment = {
        kind: 'video',
        uri: edited.uri,
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: edited.sizeBytes,
        durationMs: edited.durationMs,
        width: edited.width,
        height: edited.height,
      };
      const validationError = validateChatMedia(result);
      if (validationError) {
        deleteEditedVideo(edited.uri);
        throw new Error(validationError);
      }
      deleteEditedVideo(attachment.uri);
      if (mountedRef.current) onAttachment(result);
    } catch (error) {
      console.error('Unable to edit chat video.', error);
      if (mountedRef.current) {
        Alert.alert('Could not edit video', await getErrorMessage(error, 'Try again.'));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const finishRecording = useCallback(async () => {
    if (!recording || finishRequested.current) return;
    finishRequested.current = true;
    setRecording(false);
    try {
      const durationMs = recorder.getStatus().durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error('The recording could not be saved. Try again.');
      const contentType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      if (mountedRef.current) onAttachment(prepareRecordedVoice(recorder.uri, durationMs, contentType));
    } catch (error) {
      console.error('Unable to finish voice recording.', error);
      if (mountedRef.current) {
        Alert.alert('Could not finish recording', await getErrorMessage(error, 'Try recording again.'));
      }
    }
  }, [onAttachment, recorder, recording]);

  useEffect(() => {
    if (recording && recorderState.durationMillis >= maxChatVoiceDurationMs) {
      const timeout = setTimeout(() => void finishRecording(), 0);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [finishRecording, recorderState.durationMillis, recording]);

  const pickMedia = async (mediaTypes: ('images' | 'videos')[] = ['images', 'videos']) => {
    if (disabled || busy || recording) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        allowsEditing: false,
        quality: 0.82,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (!result.canceled) {
        const prepared = await preparePickedAsset(result.assets[0]);
        if (mountedRef.current && prepared) onAttachment(prepared);
      }
    } catch (error) {
      console.error('Unable to prepare chat attachment.', error);
      if (mountedRef.current) {
        Alert.alert('Could not attach media', await getErrorMessage(error, 'Choose another file.'));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const captureMedia = async () => {
    if (disabled || busy || recording) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access required', 'Allow camera access to capture an attachment.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.82,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (!result.canceled) {
        const prepared = await preparePickedAsset(result.assets[0]);
        if (mountedRef.current && prepared) onAttachment(prepared);
      }
    } catch (error) {
      console.error('Unable to capture chat media.', error);
      if (mountedRef.current) {
        Alert.alert('Could not capture media', await getErrorMessage(error, 'Try again.'));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const chooseMedia = () => {
    if (Platform.OS === 'web') {
      void pickMedia();
      return;
    }
    Alert.alert('Add attachment', 'Choose a photo, video, or use the camera.', [
      { text: 'Photo', onPress: () => void pickMedia(['images']) },
      { text: 'Video', onPress: () => void pickMedia(['videos']) },
      { text: 'Camera', onPress: () => void captureMedia() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleRecording = async () => {
    if (disabled || busy || attachment) return;
    if (recording) {
      await finishRecording();
      return;
    }
    setBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone access required', 'Allow microphone access to record a voice message.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!mountedRef.current) return;
      recorder.record();
      finishRequested.current = false;
      setRecording(true);
    } catch (error) {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((resetError: unknown) => {
        console.error('Unable to restore the audio mode after a recording error.', resetError);
      });
      console.error('Unable to start voice recording.', error);
      if (mountedRef.current) {
        Alert.alert('Could not start recording', await getErrorMessage(error, 'Try again.'));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  useEffect(() => () => {
    if (recorder.isRecording) {
      void recorder.stop().catch((error: unknown) => {
        console.error('Unable to stop voice recording after closing the composer.', error);
      });
    }
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((resetError: unknown) => {
      console.error('Unable to restore the audio mode after closing the composer.', resetError);
    });
  }, [recorder]);

  return (
    <View style={styles.container}>
      {attachment ? (
        <View style={styles.readyRow}>
          <Text style={styles.readyText}>
            {attachment.kind === 'image' ? 'Photo ready' : attachment.kind === 'video' ? 'Video ready' : 'Voice message ready'}
          </Text>
          {attachment.kind === 'video' ? (
            <Pressable
              onPress={() => void editAttachment()}
              disabled={disabled || busy}
              accessibilityRole="button"
              accessibilityLabel="Trim or edit attached video"
              style={styles.editButton}
            >
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              deleteEditedVideo(attachment.uri);
              onClear();
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
            style={styles.clearButton}
          >
            <Icon name="close" size={20} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={chooseMedia}
            disabled={disabled || busy || recording}
            style={[styles.actionButton, (disabled || busy || recording) && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Attach photo or video"
          >
            {busy && !recording ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Icon name="plus" size={20} color={theme.colors.textMuted} />
            )}
          </Pressable>
          {showVoiceRecorder || recording ? (
            <Pressable
              onPress={() => void toggleRecording()}
              disabled={disabled || busy}
              style={[styles.recordButton, recording && styles.recordingButton, (disabled || busy) && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Stop voice recording' : 'Record voice message'}
            >
              <Icon name={recording ? 'pause' : 'mic'} size={20} color={recording ? theme.colors.black : theme.colors.textMuted} />
            </Pressable>
          ) : null}
          {recording ? (
            <Text style={styles.recordingLabel}>
              Recording {Math.floor(recorderState.durationMillis / 1000)}s - tap to stop
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 7 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  recordButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  recordingButton: { backgroundColor: theme.colors.danger },
  recordingLabel: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' },
  readyRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderRadius: 18, backgroundColor: theme.colors.surface },
  readyText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  editButton: { paddingHorizontal: 10, paddingVertical: 7 },
  editText: { color: theme.colors.gold, fontSize: 12, fontWeight: '700' },
  clearButton: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
