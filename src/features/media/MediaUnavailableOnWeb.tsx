import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme/theme';

export function MediaUnavailableOnWeb({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.brand}>WIMPEX</Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={styles.button}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Back to Wimpex</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.black,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    padding: 32,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
  },
  brand: {
    color: theme.colors.gold,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
  },
  title: {
    marginTop: 22,
    color: theme.colors.white,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: 12,
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 24,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
  },
  buttonText: {
    color: theme.colors.black,
    fontSize: 15,
    fontWeight: '800',
  },
});
