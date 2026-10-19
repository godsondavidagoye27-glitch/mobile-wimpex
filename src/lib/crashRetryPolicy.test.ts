import { describe, expect, it } from 'vitest';
import {
  decideCrashRetry,
  emptyCrashRetryState,
  markCrashRetryHealthy,
} from './crashRetryPolicy';

describe('crash retry policy', () => {
  it('retries the first error automatically', () => {
    expect(decideCrashRetry(emptyCrashRetryState, 1000)).toEqual({
      retry: true,
      state: { retryTimestamps: [1000], lastRetryAt: 1000 },
    });
  });

  it('shows fallback after another crash within ten seconds', () => {
    const first = decideCrashRetry(emptyCrashRetryState, 1000);
    expect(decideCrashRetry(first.state, 10_999).retry).toBe(false);
  });

  it('resets the consecutive retry after a ten-second healthy period', () => {
    const first = decideCrashRetry(emptyCrashRetryState, 1000);
    const healthy = markCrashRetryHealthy(first.state, 11_000);
    expect(healthy).toEqual({ retryTimestamps: [1000], lastRetryAt: null });
    expect(decideCrashRetry(healthy, 11_001).retry).toBe(true);
  });

  it('allows no more than two automatic retries in a rolling minute', () => {
    const first = decideCrashRetry(emptyCrashRetryState, 1000);
    const afterHealthy = markCrashRetryHealthy(first.state, 11_000);
    const second = decideCrashRetry(afterHealthy, 11_001);
    const healthyAgain = markCrashRetryHealthy(second.state, 21_001);
    expect(decideCrashRetry(healthyAgain, 21_002).retry).toBe(false);
    const afterWindow = markCrashRetryHealthy(healthyAgain, 61_001);
    expect(decideCrashRetry(afterWindow, 61_002).retry).toBe(true);
  });
});
