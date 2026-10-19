export const crashRetryDelayMs = 150;
export const crashRetryWindowMs = 10_000;
export const crashRetryLimit = 2;
export const crashRetryLimitWindowMs = 60_000;

export type CrashRetryState = {
  retryTimestamps: number[];
  lastRetryAt: number | null;
};

export type CrashRetryDecision = {
  retry: boolean;
  state: CrashRetryState;
};

export const emptyCrashRetryState: CrashRetryState = {
  retryTimestamps: [],
  lastRetryAt: null,
};

export function decideCrashRetry(state: CrashRetryState, now: number): CrashRetryDecision {
  const retryTimestamps = state.retryTimestamps.filter(
    (timestamp) => now - timestamp < crashRetryLimitWindowMs,
  );
  const nextState = { retryTimestamps, lastRetryAt: state.lastRetryAt };
  if (state.lastRetryAt !== null && now - state.lastRetryAt < crashRetryWindowMs) {
    return { retry: false, state: nextState };
  }
  if (retryTimestamps.length >= crashRetryLimit) return { retry: false, state: nextState };
  retryTimestamps.push(now);
  return { retry: true, state: { retryTimestamps, lastRetryAt: now } };
}

export function markCrashRetryHealthy(state: CrashRetryState, now: number): CrashRetryState {
  const retryTimestamps = state.retryTimestamps.filter(
    (timestamp) => now - timestamp < crashRetryLimitWindowMs,
  );
  if (state.lastRetryAt === null || now - state.lastRetryAt < crashRetryWindowMs) {
    return { retryTimestamps, lastRetryAt: state.lastRetryAt };
  }
  return { retryTimestamps, lastRetryAt: null };
}
