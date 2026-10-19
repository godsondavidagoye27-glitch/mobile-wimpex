export type CreatorAnalyticsPeriod = 7 | 28 | 90;

export type WatchSample = {
  sessionId: string;
  postId: string;
  userId: string;
  watchMs: number;
  durationMs: number;
};

export type CreatorAnalyticsPost = {
  post_id: string;
  caption: string;
  views: number;
  unique_viewers: number;
  watch_ms: number;
  average_watch_percent: number;
  likes: number;
  comments: number;
  shares: number;
};

export type CreatorAnalytics = {
  period_days: CreatorAnalyticsPeriod;
  views: number;
  unique_viewers: number;
  watch_ms: number;
  average_watch_percent: number;
  followers_gained: number;
  likes: number;
  comments: number;
  shares: number;
  daily: { day: string; views: number; watch_ms: number }[];
  top_posts: CreatorAnalyticsPost[];
};

export function isCreatorAnalyticsPeriod(value: number): value is CreatorAnalyticsPeriod {
  return value === 7 || value === 28 || value === 90;
}

export function creatorAnalyticsStart(periodDays: CreatorAnalyticsPeriod, now: Date): string {
  return new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString();
}

export function averageWatchPercent(samples: WatchSample[]): number {
  const sessions = new Map<string, { watchedMs: number; durationMs: number }>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.watchMs) || sample.watchMs <= 0
      || !Number.isFinite(sample.durationMs) || sample.durationMs <= 0) continue;
    const key = `${sample.userId}:${sample.sessionId}:${sample.postId}`;
    const current = sessions.get(key) ?? { watchedMs: 0, durationMs: sample.durationMs };
    current.watchedMs += sample.watchMs;
    current.durationMs = Math.max(current.durationMs, sample.durationMs);
    sessions.set(key, current);
  }
  if (!sessions.size) return 0;
  const percentages = [...sessions.values()]
    .map(({ watchedMs, durationMs }) => Math.min(100, watchedMs / durationMs * 100));
  return Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length);
}

function isPostMetric(value: unknown): value is CreatorAnalyticsPost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.post_id === 'string'
    && typeof row.caption === 'string'
    && ['views', 'unique_viewers', 'watch_ms', 'average_watch_percent', 'likes', 'comments', 'shares']
      .every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]));
}

function isDailyMetric(value: unknown): value is CreatorAnalytics['daily'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.day === 'string'
    && typeof row.views === 'number'
    && Number.isFinite(row.views)
    && typeof row.watch_ms === 'number'
    && Number.isFinite(row.watch_ms);
}

export function isCreatorAnalytics(value: unknown): value is CreatorAnalytics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const totals = ['views', 'unique_viewers', 'watch_ms', 'average_watch_percent', 'followers_gained', 'likes', 'comments', 'shares'];
  return typeof result.period_days === 'number'
    && isCreatorAnalyticsPeriod(result.period_days)
    && totals.every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]))
    && Array.isArray(result.daily)
    && result.daily.every(isDailyMetric)
    && Array.isArray(result.top_posts)
    && result.top_posts.every(isPostMetric);
}
