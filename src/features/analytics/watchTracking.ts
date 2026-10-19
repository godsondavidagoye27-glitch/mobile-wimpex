import { getErrorMessage } from '../../lib/errorMessage';
import { getSupabaseClient } from '../../lib/supabase';

export type PostWatchEvent = {
  post_id: string;
  session_id: string;
  watch_ms: number;
  completed: boolean;
};

const batchSize = 50;
const flushDelayMs = 15_000;
let pendingEvents: PostWatchEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlush: Promise<void> | null = null;

async function flushBatch() {
  if (activeFlush) return activeFlush;
  const events = pendingEvents.splice(0, batchSize);
  if (!events.length) return;

  activeFlush = Promise.resolve(getSupabaseClient().rpc('record_post_watch_batch', { p_events: events }))
    .then(({ error }) => {
      if (error) throw error;
    })
    .catch(async (error: unknown) => {
      pendingEvents = [...events, ...pendingEvents].slice(-batchSize);
      console.error('Unable to send sampled post watch data.', await getErrorMessage(error, 'Watch analytics could not be sent.'));
    })
    .finally(() => {
      activeFlush = null;
      if (pendingEvents.length >= batchSize) void flushBatch();
      else if (pendingEvents.length && !flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void flushBatch();
        }, flushDelayMs);
      }
    });
  return activeFlush;
}

export function enqueuePostWatchEvent(event: PostWatchEvent) {
  if (!event.post_id || !event.session_id
    || !Number.isFinite(event.watch_ms) || event.watch_ms < 1 || event.watch_ms > 10_000) return;
  pendingEvents.push(event);
  if (pendingEvents.length >= batchSize) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    void flushBatch();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBatch();
    }, flushDelayMs);
  }
}

export function flushPostWatchEvents() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  return flushBatch();
}
