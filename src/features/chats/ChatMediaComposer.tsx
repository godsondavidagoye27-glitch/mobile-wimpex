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
import { theme } from '../../theme/theme';
import {
  maxChatVoiceDurationMs,
  type ChatMediaAttachment,
} from './chatMediaValidation';
import { prepareChatPickerAsset, prepareRecordedVoice } from './chatMediaPreparation';

type Props = {
  attachment: ChatMediaAttachment | null;
  disabled: boolean;
  showVoiceRecorder?: boolean;
  onAttachment: (attachment: ChatMediaAttachment) => void;
  onClear: () => void;
};

export function ChatMediaComposer({
  attachment,
  disabled,
  showVoiceRecorder = true,
  onAttachment,
  onClear,
}: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const finishRequested = useRef(false);

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
      onAttachment(prepareRecordedVoice(recorder.uri, durationMs, contentType));
    } catch (error) {
      Alert.alert('Could not finish recording', error instanceof Error ? error.message : 'Try recording again.');
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
      if (!result.canceled) onAttachment(await prepareChatPickerAsset(result.assets[0]));
    } catch (error) {
      Alert.alert('Could not attach media', error instanceof Error ? error.message : 'Choose another file.');
    } finally {
      setBusy(false);
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
      if (!result.canceled) onAttachment(await prepareChatPickerAsset(result.assets[0]));
    } catch (error) {
      Alert.alert('Could not capture media', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
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
      recorder.record();
      finishRequested.current = false;
      setRecording(true);
    } catch (error) {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((resetError: unknown) => {
        console.error('Unable to restore the audio mode after a recording error.', resetError);
      });
      Alert.alert('Could not start recording', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    if (recorder.isRecording) void recorder.stop();
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
          <Pressable
            onPress={onClear}
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
  clearButton: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
