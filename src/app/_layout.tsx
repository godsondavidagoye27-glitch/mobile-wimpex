import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useNetworkState } from 'expo-network';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnlinePresence } from '../features/chats/OnlinePresence';
import { NotificationLifecycle } from '../features/notifications/NotificationLifecycle';
import { TeenUsageReminder } from '../features/privacy/TeenUsageReminder';
import { KeyboardInsetProvider } from '../hooks/useKeyboardInset';
import { getSupabaseClient } from '../lib/supabase';
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

void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.error('Unable to prevent the native splash screen from auto-hiding.', error);
});

class AppErrorBoundary extends Component<
  { children: ReactNode },
  {
    hasError: boolean;
    retrying: boolean;
    error: Error | null;
    componentStack: string;
    manualRetryPending: boolean;
    failedManualRetries: number;
  }
> {
  state = {
    hasError: false,
    retrying: false,
    error: null as Error | null,
    componentStack: '',
    manualRetryPending: false,
    failedManualRetries: 0,
  };
  private retryState: CrashRetryState = emptyCrashRetryState;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthyTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, retrying: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app encountered an unexpected error.', error, info.componentStack);
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
    const componentStack = info.componentStack ?? '';
    if (this.state.manualRetryPending) {
      persistAppError(error, componentStack, false);
      this.setState((current) => ({
        retrying: false,
        manualRetryPending: false,
        failedManualRetries: current.failedManualRetries + 1,
        componentStack,
      }));
      return;
    }
    const decision = decideCrashRetry(this.retryState, Date.now());
    this.retryState = decision.state;
    persistAppError(error, componentStack, decision.retry);
    this.setState({ componentStack, retrying: decision.retry });
    if (!decision.retry) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setState((current) => ({
        hasError: false,
        retrying: false,
        error: null,
        componentStack: '',
      }));
      this.healthyTimer = setTimeout(() => {
        this.retryState = markCrashRetryHealthy(this.retryState, Date.now());
      }, crashRetryWindowMs);
    }, crashRetryDelayMs);
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
  }

  private reload = () => {
    if (this.state.failedManualRetries >= 2) {
      router.replace('/');
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.setState((current) => ({
      hasError: false,
      retrying: false,
      error: null,
      componentStack: '',
      manualRetryPending: true,
    }));
    this.healthyTimer = setTimeout(() => {
      this.retryState = markCrashRetryHealthy(this.retryState, Date.now());
      this.healthyTimer = null;
    }, crashRetryWindowMs);
  }

  render() {
    if (this.state.retrying) return <View style={styles.rootContent} />;
    if (this.state.hasError) {
      const stack = this.state.error?.stack?.split('\n').slice(0, 8).join('\n') ?? '';
      const componentStack = this.state.componentStack.split('\n').slice(0, 8).join('\n');
      const details = [this.state.error?.message, stack, componentStack].filter(Boolean).join('\n\n');
      const showDetails = __DEV__ || Constants.expoConfig?.extra?.appVariant !== 'production';
      return (
        <View style={styles.errorScreen}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>
            {showDetails && details ? details : 'The app ran into a problem. Reload to continue.'}
          </Text>
          {showDetails ? (
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(details).then(
                  () => Alert.alert('Copied', 'Error details were copied to the clipboard.'),
                  (error: unknown) => console.error('Unable to copy app error details.', error),
                );
              }}
              style={styles.copyButton}
              accessibilityRole="button"
              accessibilityLabel="Copy error details"
            >
              <Text style={styles.copyButtonText}>Copy error details</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={this.reload}
            style={styles.reloadButton}
            accessibilityRole="button"
          >
            <Text style={styles.reloadButtonText}>
              {this.state.failedManualRetries >= 2 ? 'Go home' : 'Reload'}
            </Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export const unstable_settings = { initialRouteName: 'index' };

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnReconnect: true,
      },
      mutations: { retry: 0 },
    },
  }));
  const networkState = useNetworkState();
  const isOnline = networkState.isConnected !== false && networkState.isInternetReachable !== false;
  const splashHidden = useRef(false);

  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    void SplashScreen.hideAsync().catch((error: unknown) => {
      splashHidden.current = false;
      console.error('Unable to hide the native splash screen.', error);
    });
  }, []);

  useEffect(() => {
    const timeout = setTimeout(hideSplash, 3000);
    return () => clearTimeout(timeout);
  }, [hideSplash]);

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  useEffect(() => {
    onlineManager.setOnline(isOnline);
  }, [isOnline]);

  useEffect(() => {
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return;
    const auth = getSupabaseClient().auth;
    const updateAutoRefresh = (state: string) => {
      if (state === 'active') auth.startAutoRefresh();
      else auth.stopAutoRefresh();
    };
    updateAutoRefresh(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateAutoRefresh);
    return () => {
      subscription.remove();
      auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    const runtime = globalThis as typeof globalThis & {
      ErrorUtils?: {
        getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
        setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
      };
    };
    const errorUtils = runtime.ErrorUtils;
    if (!errorUtils) return undefined;
    const previousHandler = errorUtils.getGlobalHandler?.();
    const handler = (error: Error, isFatal?: boolean) => {
      console.error('An uncaught JavaScript error occurred.', { error, isFatal });
      persistAppError(error, '', false);
      previousHandler?.(error, isFatal);
    };
    errorUtils.setGlobalHandler(handler);
    return () => {
      if (previousHandler) errorUtils.setGlobalHandler(previousHandler);
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <KeyboardInsetProvider>
              <StatusBar style="light" />
              <OnlinePresence />
              <NotificationLifecycle />
              <TeenUsageReminder />
              <View style={styles.rootContent} onLayout={hideSplash}>
                <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
                  {/* Must stay first: a remounted navigator (after an error-boundary reload) starts on the
                      first declared screen, which used to be the story viewer with no author id. */}
                  <Stack.Screen name="index" />
                  <Stack.Screen name="story/[authorId]" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: '#000000' } }} />
                </Stack>
              </View>
            </KeyboardInsetProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  rootContent: { flex: 1 },
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.colors.black,
  },
  errorTitle: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  copyButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 18,
  },
  copyButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  reloadButton: {
    minHeight: 46,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
  },
  reloadButtonText: {
    color: theme.colors.black,
    fontSize: 15,
    fontWeight: '700',
  },
});