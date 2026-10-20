import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import {
  isCreatorAnalytics,
  type CreatorAnalytics,
  type CreatorAnalyticsPeriod,
} from '../features/analytics/creatorAnalytics';
import { theme } from '../theme/theme';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

const periods: CreatorAnalyticsPeriod[] = [7, 28, 90];
const initialData: CreatorAnalytics = {
  period_days: 7,
  views: 0,
  unique_viewers: 0,
  watch_ms: 0,
  average_watch_percent: 0,
  followers_gained: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  daily: [],
  top_posts: [],
};

function durationLabel(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${totalSeconds % 60}s`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
              </View>
  );
}

export default function CreatorAnalyticsScreen() {
  const [period, setPeriod] = useState<CreatorAnalyticsPeriod>(7);
  const [refresh, setRefresh] = useState(0);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    requestKey: string;
    data?: CreatorAnalytics;
    error?: string;
  } | null>(null);
  const requestKey = `${period}:${refresh}`;
  const currentResult = result?.requestKey === requestKey ? result : null;
  const data = currentResult?.data ?? initialData;
  const loading = currentResult === null;
  const error = currentResult?.error ?? '';
  const maxDailyViews = useMemo(
    () => Math.max(1, ...data.daily.map((day) => day.views)),
    [data.daily],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve(getSupabaseClient().rpc('get_creator_analytics', { p_period_days: period }))
      .then(({ data: response, error: rpcError }) => {
        if (rpcError) throw rpcError;
        if (!isCreatorAnalytics(response)) throw new Error('Creator analytics returned an invalid response.');
        if (active) setResult({ requestKey, data: response });
      })
      .catch(async (caught: unknown) => {
        console.error('Unable to load creator analytics.', caught);
        const message = await getErrorMessage(caught, 'Could not load analytics.');
        if (active) setResult({ requestKey, error: message });
      });
    return () => {
      active = false;
    };
  }, [period, refresh, requestKey]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Creator dashboard</Text>
      </View>
      <View style={styles.periodRow}>
        {periods.map((days) => (
          <Pressable
            key={days}
            onPress={() => setPeriod(days)}
            accessibilityRole="button"
            accessibilityState={{ selected: period === days }}
            style={[styles.periodButton, period === days && styles.periodSelected]}
          >
            <Text style={[styles.periodText, period === days && styles.periodTextSelected]}>{days} days</Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.muted}>Loading your analytics…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => setRefresh((current) => current + 1)} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statGrid}>
            <Stat label="Views" value={data.views.toLocaleString()} />
            <Stat label="Unique viewers" value={data.unique_viewers.toLocaleString()} />
            <Stat label="Watch time" value={durationLabel(data.watch_ms)} />
            <Stat label="Average watched" value={`${data.average_watch_percent}%`} />
            <Stat label="Followers gained" value={data.followers_gained.toLocaleString()} />
            <Stat label="Likes · comments · shares" value={`${data.likes} · ${data.comments} · ${data.shares}`} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Daily views</Text>
            {data.views === 0 ? (
              <Text style={styles.muted}>No watch data in this period yet.</Text>
            ) : (
              <View style={styles.chart}>
                {data.daily.map((day) => (
                  <View key={day.day} style={styles.barGroup}>
                    <View style={styles.barTrack}>
                      <View style={[styles.bar, { height: `${Math.max(3, day.views / maxDailyViews * 100)}%` }]} />
                    </View>
                    <Text style={styles.dayLabel}>{day.day.slice(5)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Top posts</Text>
            {data.top_posts.length ? data.top_posts.map((post, index) => (
              <View key={post.post_id}>
                <Pressable
                  onPress={() => setExpandedPostId((current) => current === post.post_id ? null : post.post_id)}
                  style={styles.postRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Show analytics for ${post.caption || 'untitled video'}`}
                  accessibilityState={{ expanded: expandedPostId === post.post_id }}
                >
                  <Text style={styles.rank}>{index + 1}</Text>
                  <View style={styles.postCopy}>
                    <Text style={styles.postCaption} numberOfLines={2}>{post.caption || 'Untitled video'}</Text>
                    <Text style={styles.muted}>
                      {post.views} views · {post.average_watch_percent}% average watched
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
                </Pressable>
                {expandedPostId === post.post_id ? (
                  <View style={styles.postDetails}>
                    <View style={styles.postStats}>
                      <Stat label="Views" value={post.views.toLocaleString()} />
                      <Stat label="Unique viewers" value={post.unique_viewers.toLocaleString()} />
                      <Stat label="Watch time" value={durationLabel(post.watch_ms)} />
                      <Stat label="Average watched" value={`${post.average_watch_percent}%`} />
                      <Stat label="Likes" value={post.likes.toLocaleString()} />
                      <Stat label="Comments" value={post.comments.toLocaleString()} />
                      <Stat label="Shares" value={post.shares.toLocaleString()} />
                    </View>
                    <Pressable
                      onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.post_id } })}
                      accessibilityRole="button"
                    >
                      <Text style={styles.retry}>Open video</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )) : <Text style={styles.muted}>Your published videos will appear here.</Text>}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 12 },
  back: { width: 40, height: 40, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  periodButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 18, backgroundColor: theme.colors.surface },
  periodSelected: { backgroundColor: theme.colors.primary },
  periodText: { color: theme.colors.textMuted, fontWeight: '700' },
  periodTextSelected: { color: theme.colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '47%', minHeight: 88, padding: 14, borderRadius: 14, backgroundColor: theme.colors.surface, justifyContent: 'center' },
  statValue: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  statLabel: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 14, padding: 16, gap: 12 },
  sectionTitle: { color: theme.colors.white, fontSize: 16, fontWeight: '800' },
  muted: { color: theme.colors.textMuted, fontSize: 12 },
  error: { color: theme.colors.white, textAlign: 'center' },
  retry: { color: theme.colors.primary, fontWeight: '800' },
  chart: { height: 140, flexDirection: 'row', alignItems: 'stretch', gap: 3 },
  barGroup: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  barTrack: { height: 112, width: '80%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', minHeight: 3, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: theme.colors.primary },
  dayLabel: { color: theme.colors.textMuted, fontSize: 9 },
  postRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingVertical: 12 },
  rank: { color: theme.colors.primary, fontWeight: '800', width: 20 },
  postCopy: { flex: 1, gap: 4 },
  postCaption: { color: theme.colors.white, fontWeight: '700' },
  postDetails: { borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 10, paddingBottom: 12, gap: 10 },
  postStats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
});
