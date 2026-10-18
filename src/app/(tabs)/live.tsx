import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { getLiveStreams } from '../../features/live/liveService';
import { theme } from '../../theme/theme';

const liveStreamsKey = ['live-streams'];

export default function LiveScreen() {
  const query = useQuery({
    queryKey: liveStreamsKey,
    queryFn: () => getLiveStreams(),
    staleTime: 15_000,
  });
  const refetchLiveStreams = query.refetch;

  useFocusEffect(
    useCallback(() => {
      void refetchLiveStreams();
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Live</Text>
        <Pressable
          onPress={() => router.push('/live/create')}
          style={styles.hostButton}
          accessibilityRole="button"
          accessibilityLabel="Start a live stream"
        >
          <Icon name="live" size={20} color={theme.colors.black} />
          <Text style={styles.hostButtonText}>Go live</Text>
        </Pressable>
      </View>
      {query.isPending ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Text style={styles.message}>Live streams could not be loaded.</Text>
          <Pressable onPress={() => void query.refetch()} style={styles.retryButton} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={query.data}
          keyExtractor={(item) => item.stream_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={theme.colors.primary} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/live/[streamId]', params: { streamId: item.stream_id } })}
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={`Watch ${item.host_display_name}'s live stream${item.title ? `, ${item.title}` : ''}`}
            >
              <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
              <Text style={styles.cardTitle}>{item.title || 'Live stream'}</Text>
              <Text style={styles.hostName}>{item.host_display_name} · @{item.host_username}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.message}>No one is live right now. Start a stream and invite your community.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  title: { color: theme.colors.white, fontSize: 28, fontWeight: '800' },
  hostButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, borderRadius: 21, backgroundColor: theme.colors.primary },
  hostButtonText: { color: theme.colors.black, fontWeight: '800', fontSize: 13 },
  list: { paddingHorizontal: 18, paddingBottom: 90, gap: 12, flexGrow: 1 },
  card: { minHeight: 150, justifyContent: 'flex-end', gap: 5, padding: 18, borderRadius: 22, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  liveBadge: { position: 'absolute', top: 16, left: 16, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.danger },
  liveBadgeText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  cardTitle: { marginTop: 28, color: theme.colors.white, fontSize: 21, fontWeight: '800' },
  hostName: { color: theme.colors.textMuted, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  message: { paddingHorizontal: 22, paddingVertical: 32, color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
});
