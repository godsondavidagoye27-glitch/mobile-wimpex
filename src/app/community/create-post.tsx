import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../../components/Icon';
import {
  createCommunityPost,
  type CommunityMediaInput,
} from '../../features/communities/communityContentService';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { CommunityListRpcRow } from '../../types/database';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Try again.';
}

function LocalCommunityVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  return <VideoView player={player} style={styles.preview} nativeControls />;
}

export default function CommunityPostComposerScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const requestedSlug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const [communities, setCommunities] = useState<CommunityListRpcRow[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityListRpcRow | null>(null);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<CommunityMediaInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = getSupabaseClient();
        const { data, error: communitiesError } = await client.rpc('my_communities');
        if (communitiesError) throw communitiesError;
        const activeCommunities = (data ?? []).filter((item) => item.status === 'active');
        if (!active) return;
        setCommunities(activeCommunities);

        if (requestedSlug) {
          const { data: detail, error: detailError } = await client.rpc('get_community', {
            p_slug: requestedSlug,
          });
          if (detailError) throw detailError;
          const community = detail?.[0];
          if (!community?.can_post) throw new Error('Join this community before posting.');
          setSelectedCommunity({
            id: community.id,
            slug: community.slug,
            name: community.name,
            description: community.description ?? '',
            category: community.category,
            visibility: community.visibility,
            is_adults_only: community.is_adults_only,
            icon_path: community.icon_path,
            member_count: community.member_count,
            post_count: community.post_count,
            role: community.role,
            status: community.status,
          });
        }
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [requestedSlug]);

  const chooseMedia = async (kind: 'image' | 'video') => {
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow access to your library to attach community media.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'image' ? ['images'] : ['videos'],
        allowsEditing: false,
        quality: 0.85,
        videoMaxDuration: 60,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const pickedMedia = kind === 'image'
        ? await ImageManipulator.manipulateAsync(asset.uri, [], {
            compress: 0.85,
            format: ImageManipulator.SaveFormat.JPEG,
          })
        : { uri: asset.uri };
      const mimeType = kind === 'image'
        ? 'image/jpeg'
        : asset.mimeType ?? 'video/mp4';
      if (kind === 'video' && asset.duration && asset.duration > 60_000) {
        setError('Community videos must be 60 seconds or shorter.');
        return;
      }
      const sizeResponse = await fetch(pickedMedia.uri);
      if (!sizeResponse.ok) throw new Error('The selected media could not be read.');
      const blob = await sizeResponse.blob();
      const fileSize = blob.size;
      if (!fileSize || fileSize > 50 * 1024 * 1024) {
        setError('Community photos and videos must be smaller than 50 MB.');
        return;
      }
      setMedia({ uri: pickedMedia.uri, kind, mimeType, sizeBytes: fileSize });
    } catch (caught) {
      setError(`Could not select media. ${errorMessage(caught)}`);
    }
  };

  const publish = async () => {
    if (!selectedCommunity || saving) return;
    setError('');
    setSaving(true);
    try {
      await createCommunityPost({
        communityId: selectedCommunity.id,
        body,
        media,
      });
      router.replace({
        pathname: '/community/[slug]',
        params: { slug: selectedCommunity.slug, tab: 'Posts' },
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Close composer">
          <Icon name="close" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Community post</Text>
        <Pressable
          onPress={() => void publish()}
          disabled={!selectedCommunity || saving || (!body.trim() && !media)}
          style={[styles.publishButton, (!selectedCommunity || saving || (!body.trim() && !media)) && styles.publishDisabled]}
          accessibilityRole="button"
        >
          {saving
            ? <ActivityIndicator size="small" color={theme.colors.black} />
            : <Text style={styles.publishText}>Post</Text>}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!selectedCommunity ? (
            <View style={styles.communityPicker}>
              <Text style={styles.sectionTitle}>Choose a community</Text>
              {communities.length
                ? communities.map((community) => (
                    <Pressable
                      key={community.id}
                      onPress={() => setSelectedCommunity(community)}
                      style={styles.communityRow}
                      accessibilityRole="button"
                    >
                      <View style={styles.communityIcon}>
                        <Text style={styles.communityInitial}>{community.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={styles.communityCopy}>
                        <Text style={styles.communityName}>{community.name}</Text>
                        <Text style={styles.communityMeta}>{community.member_count.toLocaleString()} members</Text>
                      </View>
                      <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
                    </Pressable>
                  ))
                : <Text style={styles.helper}>Join a community before creating a post.</Text>}
            </View>
          ) : (
            <>
              <Pressable onPress={() => setSelectedCommunity(null)} style={styles.selectedCommunity} accessibilityRole="button">
                <View style={styles.communityIcon}>
                  <Text style={styles.communityInitial}>{selectedCommunity.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.communityCopy}>
                  <Text style={styles.communityMeta}>Posting to</Text>
                  <Text style={styles.communityName}>{selectedCommunity.name}</Text>
                </View>
                <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
              </Pressable>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Share something with your community..."
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={2000}
                style={styles.bodyInput}
                textAlignVertical="top"
                accessibilityLabel="Community post text"
              />
              <Text style={styles.counter}>{body.length}/2000</Text>
              {media ? (
                <View style={styles.mediaPreviewWrap}>
                  {media.kind === 'image'
                    ? <Image source={{ uri: media.uri }} style={styles.preview} resizeMode="cover" />
                    : <LocalCommunityVideo uri={media.uri} />}
                  <Pressable onPress={() => setMedia(null)} style={styles.removeMedia} accessibilityRole="button" accessibilityLabel="Remove attachment">
                    <Icon name="close" size={20} color={theme.colors.white} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.mediaButtons}>
                  <Pressable onPress={() => void chooseMedia('image')} style={styles.mediaButton} accessibilityRole="button">
                    <Icon name="camera" size={20} color={theme.colors.primary} />
                    <Text style={styles.mediaButtonText}>Photo</Text>
                  </Pressable>
                  <Pressable onPress={() => void chooseMedia('video')} style={styles.mediaButton} accessibilityRole="button">
                    <Icon name="video" size={20} color={theme.colors.primary} />
                    <Text style={styles.mediaButtonText}>Video</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    minHeight: 58,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800' },
  publishButton: {
    minWidth: 64,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  publishDisabled: { opacity: 0.45 },
  publishText: { color: theme.colors.black, fontSize: 14, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 48 },
  communityPicker: { gap: 12 },
  sectionTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  communityRow: {
    minHeight: 68,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedCommunity: {
    minHeight: 62,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  communityIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityInitial: { color: theme.colors.primary, fontSize: 17, fontWeight: '800' },
  communityCopy: { flex: 1, gap: 3 },
  communityName: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  communityMeta: { color: theme.colors.textMuted, fontSize: 12 },
  bodyInput: {
    minHeight: 180,
    paddingTop: 18,
    color: theme.colors.white,
    fontSize: 17,
    lineHeight: 24,
  },
  counter: { color: theme.colors.textMuted, textAlign: 'right', fontSize: 12 },
  mediaButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  mediaButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
  },
  mediaButtonText: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  mediaPreviewWrap: { position: 'relative', marginTop: 16 },
  preview: { width: '100%', height: 320, borderRadius: 16, backgroundColor: theme.colors.surface },
  removeMedia: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  helper: { color: theme.colors.textMuted, lineHeight: 20 },
  error: { color: theme.colors.danger, marginTop: 16, lineHeight: 20 },
});
