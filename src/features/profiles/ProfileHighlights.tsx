import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getProfileStoryHighlights } from '../stories/storyHighlightsService';
import { theme } from '../../theme/theme';

export function ProfileHighlights({ ownerId, isOwner }: { ownerId: string; isOwner: boolean }) {
  const highlights = useQuery({
    queryKey: ['profile-story-highlights', ownerId],
    queryFn: () => getProfileStoryHighlights(ownerId),
    enabled: Boolean(ownerId),
  });
  const rows = highlights.data ?? [];

  if (highlights.isError) {
    return (
      <View style={styles.error}>
        <Text style={styles.message}>Highlights could not be loaded.</Text>
        <Pressable onPress={() => void highlights.refetch()} accessibilityRole="button">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (highlights.isPending || (!rows.length && !isOwner)) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Highlights</Text>
        {isOwner ? (
          <Pressable
            onPress={() => router.push({ pathname: '/highlights/[ownerId]', params: { ownerId } })}
            accessibilityRole="button"
            accessibilityLabel="Manage story highlights"
          >
            <Text style={styles.manage}>Manage</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {rows.map((highlight) => (
          <Pressable
            key={highlight.id}
            onPress={() => router.push({
              pathname: '/highlights/[ownerId]',
              params: { ownerId, highlightId: highlight.id },
            })}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel={`Open highlight ${highlight.title}`}
          >
            <View style={styles.coverRing}>
              {highlight.cover_url
                ? <Image source={{ uri: highlight.cover_url }} style={styles.cover} />
                : <Text style={styles.emptyCover}>＋</Text>}
            </View>
            <Text numberOfLines={1} style={styles.title}>{highlight.title}</Text>
          </Pressable>
        ))}
        {isOwner && rows.length < 20 ? (
          <Pressable
            onPress={() => router.push({ pathname: '/highlights/[ownerId]', params: { ownerId, create: 'true' } })}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel="Create highlight"
          >
            <View style={[styles.coverRing, styles.createCover]}><Text style={styles.createText}>＋</Text></View>
            <Text numberOfLines={1} style={styles.title}>New</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 16, paddingBottom: 12 },
  headingRow: { paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { color: theme.colors.white, fontSize: 15, fontWeight: '800' },
  manage: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  row: { gap: 14, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  item: { alignItems: 'center', width: 70, gap: 5 },
  coverRing: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cover: { width: '100%', height: '100%' },
  emptyCover: { color: theme.colors.textMuted, fontSize: 24 },
  createCover: { borderStyle: 'dashed', borderColor: theme.colors.primary },
  createText: { color: theme.colors.primary, fontSize: 27 },
  title: { width: 70, color: theme.colors.textMuted, fontSize: 11, textAlign: 'center' },
  error: { padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  message: { color: theme.colors.textMuted, fontSize: 13 },
  retry: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
});
