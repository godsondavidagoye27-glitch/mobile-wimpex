import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getStoryRail } from './storyService';
import { theme } from '../../theme/theme';

const railQueryKey = ['story-rail'];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function StoryRail() {
  const storyQuery = useQuery({
    queryKey: railQueryKey,
    queryFn: () => getStoryRail(),
  });
  const refetchStoryRail = storyQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      void refetchStoryRail();
      const interval = setInterval(() => void refetchStoryRail(), 60_000);
      return () => clearInterval(interval);
    }, [refetchStoryRail]),
  );

  if (storyQuery.isPending) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={styles.item}>
            <View style={styles.loadingAvatar} />
            <View style={styles.loadingName} />
          </View>
        ))}
      </ScrollView>
    );
  }

  if (storyQuery.isError) {
    return (
      <View style={styles.errorRow}>
        <Text style={styles.errorText}>Stories could not be loaded.</Text>
        <Pressable onPress={() => void storyQuery.refetch()} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {(storyQuery.data ?? []).map((story) => {
        const label = story.is_owner ? 'Your story' : story.display_name;
        const openStory = () => {
          if (story.is_owner && story.story_count === 0) {
            router.push('/create-story');
            return;
          }
          router.push({ pathname: '/story/[authorId]', params: { authorId: story.author_id } });
        };
        return (
          <View key={story.author_id} style={styles.item}>
            <Pressable
              onPress={openStory}
              style={styles.avatarPressable}
              accessibilityRole="button"
              accessibilityLabel={story.is_owner ? 'Open your story' : `Open ${story.display_name}'s story`}
            >
              <View
                style={[
                  styles.ring,
                  story.is_close_friends_audience
                    ? styles.closeFriendsRing
                    : story.has_unseen ? styles.unseenRing : styles.seenRing,
                  story.story_count === 0 && styles.emptyRing,
                ]}
              >
                {story.has_unseen && !story.is_close_friends_audience ? (
                  <LinearGradient
                    colors={['#38BDF8', '#22C55E']}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                <View style={styles.avatar}>
                  {story.avatar_url ? (
                    <Image source={{ uri: story.avatar_url }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarInitials}>{initials(label)}</Text>
                  )}
                </View>
              </View>
            </Pressable>
            {story.is_owner ? (
              <Pressable
                onPress={() => router.push('/create-story')}
                style={styles.addBadge}
                accessibilityRole="button"
                accessibilityLabel="Create a story"
                hitSlop={8}
              >
                <Text style={styles.addText}>+</Text>
              </Pressable>
            ) : null}
            <Text numberOfLines={1} style={styles.name}>{label.length > 12 ? `${label.slice(0, 11)}...` : label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 16, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  item: { alignItems: 'center', width: 72, position: 'relative' },
  avatarPressable: { minWidth: 60, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 60, height: 60, borderRadius: 30, padding: 3, alignItems: 'center', justifyContent: 'center' },
  unseenRing: { borderColor: 'transparent', borderWidth: 2 },
  seenRing: { backgroundColor: 'transparent', borderColor: '#475569', borderWidth: 1 },
  closeFriendsRing: { backgroundColor: '#22C55E', borderColor: '#22C55E', borderWidth: 2 },
  emptyRing: { borderColor: theme.colors.line, borderWidth: 1 },
  avatar: { flex: 1, width: '100%', borderRadius: 30, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { fontSize: 18, fontWeight: '700', color: theme.colors.white },
  addBadge: {
    position: 'absolute',
    right: 3,
    top: 39,
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.black,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { color: theme.colors.black, fontSize: 17, lineHeight: 19, fontWeight: '800' },
  name: { marginTop: 5, fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 72 },
  loadingAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.surface },
  loadingName: { marginTop: 8, width: 48, height: 8, borderRadius: 4, backgroundColor: theme.colors.surface },
  errorRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: theme.colors.textMuted, fontSize: 13 },
  retry: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center' },
  retryText: { color: theme.colors.primary, fontWeight: '700' },
});
