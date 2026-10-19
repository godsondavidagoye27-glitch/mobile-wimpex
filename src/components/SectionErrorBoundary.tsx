import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

type Props = PropsWithChildren<{
  onError?: (error: Error, info: ErrorInfo) => void;
  title?: string;
}>;

type State = {
  error: Error | null;
  componentStack: string;
  retrying: boolean;
};

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', retrying: false };
  private retryState: CrashRetryState = emptyCrashRetryState;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthyTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, retrying: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    const decision = decideCrashRetry(this.retryState, Date.now());
    this.retryState = decision.state;
    console.error('A recoverable app section crashed.', error, info.componentStack);
    persistAppError(error, info.componentStack ?? '', decision.retry);
    this.setState({ retrying: decision.retry });
    if (!decision.retry) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setState((current) => ({
        error: null,
        componentStack: '',
        retrying: false,
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

  private retry = () => {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.setState((current) => ({
      error: null,
      componentStack: '',
      retrying: false,
    }));
    this.healthyTimer = setTimeout(() => {
      this.retryState = markCrashRetryHealthy(this.retryState, Date.now());
    }, crashRetryWindowMs);
  };

  render() {
    if (this.state.retrying) {
      return <View style={[styles.fallback, styles.restarting]} />;
    }
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>{this.props.title ?? 'This section needs to restart'}</Text>
          <Text style={styles.message}>
            {__DEV__ ? this.state.error.message : 'You can try this section again.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={this.retry}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: theme.colors.surface,
  },
  restarting: { minHeight: 0, padding: 0 },
  title: { color: theme.colors.white, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  message: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' },
  button: { paddingHorizontal: 16, paddingVertical: 8 },
  buttonText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
});
