import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { feed, liveMoments, stories } from '../../data/mock';
import { theme } from '../../theme/theme';

export default function HomeScreen() {
  const [tab, setTab] = useState<'For You' | 'Following'>('For You');

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.wordmark}>Wimpex</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} accessibilityRole="button">
            <Icon name="moon" size={20} color={theme.colors.white} />
          </Pressable>
          <Pressable style={styles.iconButton} accessibilityRole="button">
            <Icon name="bell" size={20} color={theme.colors.white} />
            <View style={styles.badge} />
          </Pressable>
          <Link href="/profile" asChild>
            <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Open profile">
              <Icon name="user" size={20} color={theme.colors.white} />
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(['For You', 'Following'] as const).map((item: 'For You' | 'Following') => (
          <Pressable key={item} onPress={() => setTab(item)} style={styles.tabButton}>
            <Text style={[styles.tabLabel, tab === item && styles.tabLabelActive]}>{item}</Text>
            {tab === item && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.liveRow}>
          <Text style={styles.sectionTitle}>Live now</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveScroll}>
            {liveMoments.map((item: (typeof liveMoments)[number]) => (
              <LinearGradient key={item.id} colors={item.gradient as [string, string]} style={styles.liveCard}>
                <Text style={styles.liveBadge}>{item.label}</Text>
                <Text style={styles.liveTitle}>{item.title}</Text>
                <Text style={styles.liveMeta}>{item.viewers} watching</Text>
              </LinearGradient>
            ))}
          </ScrollView>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
          {stories.map((story: (typeof stories)[number]) => (
            <Link key={story.id} href={story.isOwner ? '/profile' : '/user?username=mila'} asChild>
              <Pressable style={styles.storyItem} accessibilityRole="button">
                <LinearGradient
                  colors={['#38BDF8', '#22C55E']}
                  style={[styles.storyRing, story.isOwner && styles.storyRingOwner]}
                >
                  <View style={styles.storyAvatar}>
                    <Text style={styles.storyInitial}>{story.initial}</Text>
                  </View>
                </LinearGradient>
                <Text style={styles.storyLabel}>{story.name}</Text>
              </Pressable>
            </Link>
          ))}
        </ScrollView>

        {feed.map((post: (typeof feed)[number]) => (
          <View key={post.id} style={styles.videoCardWrap}>
            <Image source={{ uri: post.image }} style={styles.videoThumb} resizeMode="cover" />
            <View style={styles.progressBar} />
            <View style={styles.videoOverlay}>
              <View style={styles.metaStack}>
                <Link href="/user?username=mila" asChild>
                  <Pressable>
                    <Text style={styles.username}>{post.user}</Text>
                  </Pressable>
                </Link>
                <Text style={styles.caption}>{post.caption}</Text>
                <Text style={styles.hashtags}>{post.hashtags.join(' ')}</Text>
                <View style={styles.autoCaption}>
                  <Text style={styles.autoCaptionText}>Auto captions</Text>
                </View>
              </View>
              <View style={styles.rightRail}>
                <Pressable style={styles.actionButton} accessibilityRole="button">
                  <Icon name="heart" size={20} color={theme.colors.white} filled />
                  <Text style={styles.count}>{post.likes}</Text>
                </Pressable>
                <Pressable style={styles.actionButton} accessibilityRole="button">
                  <Icon name="comment" size={20} color={theme.colors.white} />
                  <Text style={styles.count}>{post.comments}</Text>
                </Pressable>
                <Pressable style={styles.actionButton} accessibilityRole="button">
                  <Icon name="bookmark" size={20} color={theme.colors.white} />
                  <Text style={styles.count}>{post.saves}</Text>
                </Pressable>
                <Pressable style={styles.actionButton} accessibilityRole="button">
                  <Icon name="captions" size={20} color={theme.colors.white} />
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <Link href="/settings" asChild>
        <Pressable style={styles.settingsShortcut} accessibilityRole="button">
          <Icon name="settings" size={20} color={theme.colors.white} />
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  wordmark: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: theme.colors.gold,
    textShadowColor: 'rgba(255, 215, 0, 0.65)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  badge: {
    position: 'absolute',
    right: 9,
    top: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  tabLabel: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: theme.colors.white,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 52,
    height: 2,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  content: {
    paddingBottom: 100,
  },
  liveRow: {
    paddingTop: 14,
    paddingHorizontal: 18,
  },
  sectionTitle: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  liveScroll: {
    gap: 10,
    paddingBottom: 4,
  },
  liveCard: {
    width: 170,
    height: 130,
    borderRadius: 20,
    padding: 14,
    justifyContent: 'flex-end',
  },
  liveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.38)',
    color: theme.colors.white,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 8,
  },
  liveTitle: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  liveMeta: {
    color: theme.colors.white,
    fontSize: 12,
    marginTop: 3,
    opacity: 0.9,
  },
  storyRow: {
    gap: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
  },
  storyItem: {
    alignItems: 'center',
    width: 64,
  },
  storyRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRingOwner: {
    borderWidth: 2,
  },
  storyAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#111418',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.white,
  },
  storyLabel: {
    marginTop: 8,
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  videoCardWrap: {
    marginTop: 18,
    marginHorizontal: 18,
    height: 420,
    borderRadius: 22,
    overflow: 'hidden',
    position: 'relative',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
  },
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: theme.colors.success,
  },
  videoOverlay: {
    position: 'absolute',
    inset: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  metaStack: {
    width: '74%',
    justifyContent: 'flex-end',
  },
  username: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 5,
  },
  caption: {
    color: theme.colors.white,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  hashtags: {
    color: theme.colors.primary,
    fontSize: 13,
    marginBottom: 10,
  },
  autoCaption: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  autoCaptionText: {
    color: theme.colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  rightRail: {
    width: 54,
    justifyContent: 'flex-end',
    gap: 14,
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  count: {
    color: theme.colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  settingsShortcut: {
    position: 'absolute',
    right: 18,
    bottom: 110,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
});
