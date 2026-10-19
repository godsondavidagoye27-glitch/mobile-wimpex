import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { FocusableTextInput } from '../../components/AuthField';
import { startLive } from '../../features/live/liveService';
import { getErrorMessage } from '../../lib/errorMessage';
import { theme } from '../../theme/theme';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

function CreateLiveContent() {
  const [title, setTitle] = useState('');
  const [starting, setStarting] = useState(false);

  const beginStream = async () => {
    if (starting) return;
    if (title.trim().length > 100) {
      Alert.alert('Title too long', 'Live stream titles can be up to 100 characters.');
      return;
    }

    setStarting(true);
    try {
      const streamId = await startLive(title);
      router.replace({ pathname: '/live/[streamId]', params: { streamId } });
    } catch (error) {
      console.error('Unable to start live streaming.', error);
      Alert.alert('Could not start live', await getErrorMessage(error, 'Try again.'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Start a live</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>Go live with your community</Text>
        <Text style={styles.description}>Only adults can host live streams. Your camera and microphone will turn on when the stream connects.</Text>
        <FocusableTextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Add a title (optional)"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          maxLength={100}
          returnKeyType="done"
          accessibilityLabel="Live stream title"
        />
        <Text style={styles.counter}>{title.length}/100</Text>
        <Pressable onPress={() => void beginStream()} disabled={starting} style={styles.startButton} accessibilityRole="button">
          {starting ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.startText}>Start live stream</Text>}
        </Pressable>
        <Text style={styles.note}>Live streams are not recorded or available for replay.</Text>
      </View>
    </KeyboardAwareScreen>
  );
}

export default function CreateLiveScreen() {
  return (
    <SectionErrorBoundary title="Live setup needs to restart">
      <CreateLiveContent />
    </SectionErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  headerTitle: { color: theme.colors.white, fontSize: 17, fontWeight: '800' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 60 },
  title: { color: theme.colors.white, fontSize: 27, fontWeight: '900', textAlign: 'center' },
  description: { marginTop: 12, color: theme.colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  input: { minHeight: 52, marginTop: 28, paddingHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.surface, color: theme.colors.white, fontSize: 15 },
  counter: { alignSelf: 'flex-end', marginTop: 6, color: theme.colors.textMuted, fontSize: 12 },
  startButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 22, borderRadius: 26, backgroundColor: theme.colors.primary },
  startText: { color: theme.colors.black, fontSize: 15, fontWeight: '900' },
  note: { marginTop: 18, color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' },
});
