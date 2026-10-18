import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { getLiveStreams } from './liveService';
import { theme } from '../../theme/theme';

const liveStreamsKey = ['live-streams'];

export function LiveNowRail() {
  const query = useQuery({
    queryKey: liveStreamsKey,
    queryFn: () => getLiveStreams(),
    staleTime: 15_000,
  });
  const refetchLiveStreams = query.refetch;

  useFocusEffect(
    useCallback(() => {
      let interval: ReturnType<typeof setInterval> | null = null;
      const stop = () => {
        if (interval) clearInterval(interval);
        interval = null;
      };
      const start = () => {
        if (AppState.currentState === 'active' && !interval) {
          interval = setInterval(() => void refetchLiveStreams(), 30_000);
        }
      };
      start();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') start();
        else stop();
      });
      return () => {
        stop();
        subscription.remove();
      };
    }, [refetchLiveStreams]),
  );

  if (query.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.errorRow}>
        <Text style={styles.errorText}>Live streams could not be loaded.</Text>
        <Pressable onPress={() => void query.refetch()} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!query.data.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Live now</Text>
      <FlatList
        horizontal
        data={query.data}
        keyExtractor={(stream) => stream.stream_id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/live/[streamId]', params: { streamId: item.stream_id } })}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${item.host_display_name}'s live stream, ${item.title}`}
          >
            <View style={styles.badge}><Text style={styles.badgeText}>LIVE</Text></View>
            <Text numberOfLines={1} style={styles.streamTitle}>{item.title || 'Live stream'}</Text>
            <Text numberOfLines={1} style={styles.hostName}>{item.host_display_name}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 14 },
  title: { paddingHorizontal: 18, color: theme.colors.white, fontSize: 16, fontWeight: '800' },
  list: { gap: 10, paddingHorizontal: 18, paddingVertical: 10 },
  card: { width: 170, minHeight: 100, justifyContent: 'flex-end', gap: 4, padding: 12, borderRadius: 16, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  badge: { position: 'absolute', top: 10, left: 10, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: theme.colors.danger },
  badgeText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  streamTitle: { marginTop: 20, color: theme.colors.white, fontSize: 14, fontWeight: '800' },
  hostName: { color: theme.colors.textMuted, fontSize: 12 },
  loading: { height: 54, alignItems: 'center', justifyContent: 'center' },
  errorRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: theme.colors.textMuted, fontSize: 12 },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
});
