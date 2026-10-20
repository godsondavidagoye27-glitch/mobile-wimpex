import { goBack } from '../../lib/navigation';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme/theme';
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';
export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

function CallUnavailableContent() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Calling is unavailable on web</Text>
      <Text style={styles.message}>
        Audio and video calls are available in the Wimpex iOS and Android apps.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => goBack()}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Go back</Text>
      </Pressable>
    </View>
  );
}

export default function CallUnavailableScreen() {
  return (
    <SectionErrorBoundary title="Calling needs to restart">
      <CallUnavailableContent />
    </SectionErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.colors.black,
  },
  title: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    minHeight: 46,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
  },
  buttonText: {
    color: theme.colors.black,
    fontSize: 15,
    fontWeight: '700',
  },
});
