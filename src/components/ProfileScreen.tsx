import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from './Icon';
import { currentUserProfile, likedPosts, otherProfiles, profilePosts, savedPosts, type PostItem, type Profile, profileSearch } from '../data/profile';
import { theme } from '../theme/theme';

const formatNumber = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace('.0', '')}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')}k`;
  return String(value);
};

type Props = {
  profile: Profile;
  isOwner?: boolean;
};

export function ProfileScreen({ profile, isOwner = false }: Props) {
  const [activeTab, setActiveTab] = useState<'posts' | 'liked' | 'saved'>('posts');
  const [statsSheetOpen, setStatsSheetOpen] = useState(false);
  const [statsKey, setStatsKey] = useState<'following' | 'followers' | 'likes'>('following');
  const [searchText, setSearchText] = useState('');
  const [followed, setFollowed] = useState(!isOwner && profile.username !== 'ariwimpex');
  const [menuOpen, setMenuOpen] = useState(false);
  const [postActionId, setPostActionId] = useState<string | null>(null);
  const [listFollowState, setListFollowState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(profileSearch.map((item) => [item.id, item.followed])),
  );

  const collection = useMemo(() => {
    if (activeTab === 'liked') {
      const userPosts = likedPosts[profile.id] ?? [];
      return userPosts;
    }
    if (activeTab === 'saved') {
      const userPosts = savedPosts[profile.id] ?? [];
      return userPosts;
    }
    const userPosts = profilePosts[profile.id] ?? [];
    return userPosts;
  }, [activeTab, profile.id]);

  const visibleStats = useMemo(() => {
    const rows = profileSearch.filter((item) => {
      if (!searchText) return true;
      return `${item.displayName} ${item.username}`.toLowerCase().includes(searchText.toLowerCase());
    });
    return rows;
  }, [profileSearch, searchText]);

  const openPhotoPicker = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      Alert.alert('Photo updated', 'Your profile photo was updated.');
    }
  };

  const handleStatsPress = (key: 'following' | 'followers' | 'likes') => {
    if (key === 'likes') {
      Alert.alert('Total likes', 'This is the total likes received on all posts.');
      return;
    }
    setStatsKey(key);
    setStatsSheetOpen(true);
  };

  const handleDeletePost = (id: string) => {
    Alert.alert('Delete post', 'Delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setPostActionId(null) },
    ]);
  };

  const renderTile = (post: PostItem) => {
    const tileKey = `${profile.id}-${post.id}`;
    return (
      <Pressable
        key={tileKey}
        style={styles.tile}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
        onLongPress={() => isOwner && setPostActionId(post.id)}
      >
        <Image source={{ uri: post.image }} style={styles.tileImage as any} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} style={styles.tileGradient} />
        <View style={styles.tileMeta}>
          <Icon name="play" size={20} color={theme.colors.white} />
          <Text style={styles.tileViews}>{formatNumber(post.views * 1000)}</Text>
        </View>
        {post.pinned ? <View style={styles.pinBadge}><Icon name="pin" size={20} color={theme.colors.white} /></View> : null}
        {post.processing ? <View style={styles.processingBadge}><ActivityIndicator size="small" color={theme.colors.primary} /></View> : null}
      </Pressable>
    );
  };

  const emptyState = () => {
    const emptyLabel = activeTab === 'posts' ? 'Videos you post will appear here.' : activeTab === 'liked' ? 'Videos you like will appear here.' : 'Videos you save will appear here.';
    const iconName = activeTab === 'posts' ? 'grid' : activeTab === 'liked' ? 'heart' : 'bookmark';

    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconWrap}><Icon name={iconName as any} size={20} color={theme.colors.primary} /></View>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  };

  const tabOptions = [
    { key: 'posts', icon: 'grid' as const, label: 'Posts' },
    { key: 'liked', icon: 'heart' as const, label: 'Liked' },
    { key: 'saved', icon: 'bookmark' as const, label: 'Saved' },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.usernameText}>{profile.username}</Text>
        <Pressable
          onPress={() => {
            if (isOwner) router.push('/settings');
            else setMenuOpen(true);
          }}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={isOwner ? 'Settings' : 'More actions'}
        >
          <Icon name={isOwner ? 'settings' : 'more'} size={20} color={theme.colors.white} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <Pressable onPress={isOwner ? openPhotoPicker : undefined} style={styles.avatarWrap} accessibilityRole={isOwner ? 'button' : undefined}>
            <LinearGradient colors={profile.avatarGradient} style={styles.avatarRing}>
              <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
                <Text style={styles.avatarText}>{profile.initials}</Text>
              </View>
            </LinearGradient>
          </Pressable>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <Text style={styles.bio}>{profile.bio}</Text>
          {profile.link ? (
            <View style={styles.linkRow}>
              <Icon name="link" size={20} color={theme.colors.primary} />
              <Text style={styles.linkText}>{profile.link}</Text>
            </View>
          ) : null}

          <View style={styles.statsRow}>
            <Pressable style={styles.statItem} onPress={() => handleStatsPress('following')}>
              <Text style={styles.statValue}>{formatNumber(profile.following)}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </Pressable>
            <Pressable style={styles.statItem} onPress={() => handleStatsPress('followers')}>
              <Text style={styles.statValue}>{formatNumber(profile.followers)}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </Pressable>
            <Pressable style={styles.statItem} onPress={() => handleStatsPress('likes')}>
              <Text style={styles.statValue}>{formatNumber(profile.likes)}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            {isOwner ? (
              <>
                <Pressable style={styles.ghostButton} onPress={() => router.push('/profile/edit')} accessibilityRole="button" accessibilityLabel="Edit profile">
                  <Text style={styles.ghostButtonText}>Edit profile</Text>
                </Pressable>
                <Pressable style={styles.iconCircleButton} accessibilityRole="button" accessibilityLabel="Share profile">
                  <Icon name="share" size={20} color={theme.colors.white} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={[styles.primaryButton, followed && styles.primaryButtonActive]} onPress={() => setFollowed((value) => !value)} accessibilityRole="button" accessibilityLabel={followed ? 'Following' : 'Follow'}>
                  <Text style={[styles.primaryButtonText, followed && styles.primaryButtonTextActive]}>{followed ? 'Following' : 'Follow'}</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => router.push('/(tabs)/chats')} accessibilityRole="button" accessibilityLabel="Message user">
                  <Text style={styles.ghostButtonText}>Message</Text>
                </Pressable>
                <Pressable style={styles.iconCircleButton} accessibilityRole="button" accessibilityLabel="More actions">
                  <Icon name="more" size={20} color={theme.colors.white} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {isOwner ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightsScroll}>
            <Pressable style={styles.highlightAdd} accessibilityRole="button" accessibilityLabel="Add story">
              <View style={styles.addCircle}><Icon name="plus" size={20} color={theme.colors.white} /></View>
              <Text style={styles.highlightLabel}>New</Text>
            </Pressable>
            {profile.highlights.map((highlight) => (
              <Pressable key={highlight.id} style={styles.highlightItem} accessibilityRole="button">
                <View style={[styles.highlightAvatar, { backgroundColor: highlight.color }]}>
                  <Text style={styles.highlightInitial}>{highlight.initials}</Text>
                </View>
                <Text style={styles.highlightLabel}>{highlight.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.tabBar}>
          {tabOptions.map((tab) => {
            const isVisible = tab.key !== 'saved' || isOwner;
            const isSelected = activeTab === tab.key;
            if (!isVisible) return null;
            return (
              <Pressable
                key={tab.key}
                style={styles.tabButton}
                onPress={() => setActiveTab(tab.key as 'posts' | 'liked' | 'saved')}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
              >
                <Icon
                  name={tab.icon}
                  size={20}
                  color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                  filled={isSelected}
                />
                {isSelected ? <View style={styles.tabUnderline} /> : null}
              </Pressable>
            );
          })}
        </View>

        {activeTab === 'liked' && !isOwner && !profile.showLikedVideos ? (
          <View style={styles.privateState}>
            <Icon name="lock" size={20} color={theme.colors.primary} />
            <Text style={styles.privateText}>This user&apos;s liked videos are private.</Text>
          </View>
        ) : (
          <View style={styles.gridWrap}>
            {collection.length > 0 ? (
              <View style={styles.grid}>
                {collection.map(renderTile)}
              </View>
            ) : (
              emptyState()
            )}
          </View>
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={statsSheetOpen} onRequestClose={() => setStatsSheetOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setStatsSheetOpen(false)} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{statsKey === 'following' ? 'Following' : 'Followers'}</Text>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
          />
          <View style={styles.listWrap}>
            {visibleStats.map((item) => {
              const isFollowing = listFollowState[item.id] ?? item.followed;
              return (
                <View key={item.id} style={styles.listRow}>
                  <View style={styles.userIntro}>
                    <View style={[styles.inlineAvatar, { backgroundColor: item.avatarColor }]}>
                      <Text style={styles.inlineAvatarText}>{item.initials}</Text>
                    </View>
                    <View>
                      <Text style={styles.listName}>{item.displayName}</Text>
                      <Text style={styles.listUsername}>@{item.username}</Text>
                    </View>
                  </View>
                  <Pressable
                    style={[styles.followChip, isFollowing && styles.followChipActive]}
                    onPress={() => {
                      setListFollowState((current) => ({ ...current, [item.id]: !isFollowing }));
                    }}
                  >
                    <Text style={[styles.followChipText, isFollowing && styles.followChipTextActive]}>{isFollowing ? 'Following' : 'Follow'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={Boolean(menuOpen)} onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setMenuOpen(false)} />
        <View style={styles.menuCard}>
          <Pressable style={styles.menuRow} onPress={() => Alert.alert('Shared', 'Profile link copied to clipboard.')}>
            <Icon name="share" size={20} color={theme.colors.white} />
            <Text style={styles.menuText}>Share</Text>
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => Alert.alert('Report', 'Thanks for flagging this profile.') }>
            <Icon name="flag" size={20} color={theme.colors.white} />
            <Text style={styles.menuText}>Report</Text>
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => Alert.alert('Blocked', 'This user has been blocked.') }>
            <Icon name="ban" size={20} color={theme.colors.white} />
            <Text style={styles.menuText}>Block</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={Boolean(postActionId)} onRequestClose={() => setPostActionId(null)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setPostActionId(null)} />
        <View style={styles.menuCard}>
          <Pressable style={styles.menuRow} onPress={() => setPostActionId(null)}>
            <Icon name="pin" size={20} color={theme.colors.white} />
            <Text style={styles.menuText}>Pin</Text>
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => setPostActionId(null)}>
            <Icon name="shield" size={20} color={theme.colors.white} />
            <Text style={styles.menuText}>Change audience</Text>
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => handleDeletePost(postActionId ?? '')}>
            <Icon name="trash" size={20} color={theme.colors.danger} />
            <Text style={[styles.menuText, styles.dangerText]}>Delete</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  usernameText: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
  },
  content: { paddingBottom: 48 },
  profileCard: { paddingHorizontal: 18, paddingTop: 8 },
  avatarWrap: { alignSelf: 'center', marginBottom: 12 },
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.colors.white,
    fontSize: 30,
    fontWeight: '800',
  },
  displayName: {
    alignSelf: 'center',
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '800',
  },
  bio: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  linkRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  linkText: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 18,
    paddingHorizontal: 6,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: theme.colors.white,
    fontWeight: '800',
    fontSize: 18,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 18,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 16,
    minWidth: 112,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonActive: { backgroundColor: theme.colors.success },
  primaryButtonText: {
    color: theme.colors.black,
    fontWeight: '800',
  },
  primaryButtonTextActive: {
    color: theme.colors.white,
  },
  ghostButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: '#111418',
    minWidth: 126,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: theme.colors.white,
    fontWeight: '700',
  },
  iconCircleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111418',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightsScroll: { paddingHorizontal: 18, paddingBottom: 10, gap: 14 },
  highlightAdd: { alignItems: 'center', width: 58 },
  addCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#171C22',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightItem: { alignItems: 'center', width: 58 },
  highlightAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.black,
  },
  highlightInitial: {
    color: theme.colors.white,
    fontWeight: '700',
  },
  highlightLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
    backgroundColor: '#0D1217',
    position: 'relative',
    marginTop: 8,
  },
  tabButton: {
    flex: 1,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 50,
    height: 3,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  gridWrap: { paddingHorizontal: 16, paddingTop: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 4,
  },
  tile: {
    width: '32.5%',
    height: 170,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 6,
  },
  tileImage: { width: '100%', height: '100%' },
  tileGradient: { position: 'absolute', inset: 0 },
  tileMeta: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tileViews: { color: theme.colors.white, fontSize: 12, fontWeight: '700' },
  pinBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.7)',
  },
  processingBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.75)',
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44 },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111418',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', maxWidth: 220 },
  privateState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 42,
    gap: 8,
  },
  privateText: { color: theme.colors.textMuted, textAlign: 'center', maxWidth: 240 },
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
  },
  sheetCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#111418',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 36,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  sheetHandle: {
    width: 52,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    color: theme.colors.white,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  searchInput: {
    height: 42,
    borderRadius: 12,
    backgroundColor: '#1A2026',
    paddingHorizontal: 12,
    color: theme.colors.white,
    marginBottom: 12,
  },
  listWrap: { gap: 10 },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  userIntro: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineAvatarText: { color: theme.colors.white, fontWeight: '700' },
  listName: { color: theme.colors.white, fontWeight: '700' },
  listUsername: { color: theme.colors.textMuted, fontSize: 12 },
  followChip: {
    minWidth: 88,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
  },
  followChipActive: { backgroundColor: theme.colors.success },
  followChipText: { color: theme.colors.black, fontWeight: '800' },
  followChipTextActive: { color: theme.colors.white },
  menuCard: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: '#111418',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingVertical: 8,
    minWidth: 180,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: { color: theme.colors.white, fontWeight: '700' },
  dangerText: { color: theme.colors.danger },
});

export default ProfileScreen;
