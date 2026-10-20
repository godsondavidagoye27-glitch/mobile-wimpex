import { goBack } from '../lib/navigation';
import type { ErrorBoundaryProps } from 'expo-router';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { persistAppError } from '../lib/appErrorTelemetry';
import {
  crashRetryDelayMs,
  crashRetryWindowMs,
  decideCrashRetry,
  emptyCrashRetryState,
  markCrashRetryHealthy,
  type CrashRetryState,
} from '../lib/crashRetryPolicy';
import { theme } from '../theme/theme';

const routeRetryStates = new Map<string, CrashRetryState>();

export function RouteErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const pathname = usePathname();
  const retryRef = useRef(retry);
  const handledErrorRef = useRef<Error | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retrying, setRetrying] = useState(true);

  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  useEffect(() => {
    console.error('A route encountered an unexpected render error.', error);
    if (handledErrorRef.current === error) return;
    handledErrorRef.current = error;
    const current = routeRetryStates.get(pathname) ?? emptyCrashRetryState;
    const decision = decideCrashRetry(current, Date.now());
    routeRetryStates.set(pathname, decision.state);
    persistAppError(error, '', decision.retry);
    setRetrying(decision.retry);
    if (decision.retry) {
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void retryRef.current().catch((retryError: unknown) => {
          console.error('Unable to retry the failed route.', retryError);
        });
        healthyTimerRef.current = setTimeout(() => {
          healthyTimerRef.current = null;
          const latest = routeRetryStates.get(pathname) ?? emptyCrashRetryState;
          routeRetryStates.set(pathname, markCrashRetryHealthy(latest, Date.now()));
        }, crashRetryWindowMs);
      }, crashRetryDelayMs);
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (healthyTimerRef.current) clearTimeout(healthyTimerRef.current);
    };
  }, [error, pathname]);

  if (retrying) {
    return (
      <View style={styles.recovering}>
        <Text style={styles.message}>Restarting this screen…</Text>
      </View>
    );
  }

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
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => goBack()} style={styles.backButton}>
        <Text style={styles.backText}>Go back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  recovering: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.black,
  },
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
