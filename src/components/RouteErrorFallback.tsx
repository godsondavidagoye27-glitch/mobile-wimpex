import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { secureStorage } from '../lib/storage';
import { theme } from '../theme/theme';

export function RouteErrorFallback({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error('A route encountered an unexpected render error.', error);
    if (__DEV__) return;
    void secureStorage.setItem('wimpex-last-route-error', JSON.stringify({
      message: error.message,
      stack: error.stack ?? '',
      occurredAt: new Date().toISOString(),
    })).catch((storageError: unknown) => {
      console.error('Unable to persist the last route error.', storageError);
    });
  }, [error]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>This screen ran into a problem</Text>
      <Text style={styles.message}>
        {__DEV__ ? error.message : 'You can try this screen again or return to the previous screen.'}
      </Text>
      {__DEV__ && error.stack ? (
        <ScrollView style={styles.stackContainer}>
          <Text selectable style={styles.stack}>{error.stack}</Text>
        </ScrollView>
      ) : null}
      <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>Go back</Text>
      </Pressable>
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
  stackContainer: {
    maxHeight: 220,
    marginTop: 12,
  },
  stack: {
    color: theme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  button: {
    minHeight: 46,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
  },
  buttonText: {
    color: theme.colors.black,
    fontSize: 15,
    fontWeight: '700',
  },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 8,
  },
  backText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
