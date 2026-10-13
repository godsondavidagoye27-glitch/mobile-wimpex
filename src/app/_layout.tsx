import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnlinePresence } from '../features/chats/OnlinePresence';
import { NotificationLifecycle } from '../features/notifications/NotificationLifecycle';
import { theme } from '../theme/theme';

void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.error('Unable to prevent the native splash screen from auto-hiding.', error);
});

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app encountered an unexpected error.', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorScreen}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>The app ran into a problem. Reload to continue.</Text>
          <Pressable
            onPress={() => {
              this.setState({ hasError: false });
              router.replace('/');
            }}
            style={styles.reloadButton}
            accessibilityRole="button"
          >
            <Text style={styles.reloadButtonText}>Reload</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <StatusBar style="light" />
            <OnlinePresence />
            <NotificationLifecycle />
            <View style={styles.rootContent} onLayout={hideSplash}>
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
                <Stack.Screen name="create" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
              </Stack>
            </View>
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
