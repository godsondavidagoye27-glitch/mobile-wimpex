import { goBack } from '../../lib/navigation';
import { getErrorMessage } from '../../lib/errorMessage';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
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
import { getSingleRouteParam, isUuidRouteParam } from '../../lib/routeParams';
import { getSupabaseClient } from '../../lib/supabase';
import { Icon } from '../../components/Icon';
import { KeyboardAwareScreen } from '../../hooks/useKeyboardInset';
import { theme } from '../../theme/theme';
import {
  canCreateStoryHighlight,
  reorderHighlightIds,
  validateStoryHighlightTitle,
  type HighlightAudience,
} from './highlightLogic';
import {
  createStoryHighlight,
  deleteStoryHighlight,
  getProfileStoryHighlights,
  getStoryHighlightItems,
  renameStoryHighlight,
  reorderStoryHighlight,
  type StoryHighlight,
} from './storyHighlightsService';

function HighlightVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    player.play();
  }, [player]);
  return (
    <>
      <VideoView player={player} style={styles.viewerMedia} contentFit="contain" nativeControls />
      {status === 'loading' ? <ActivityIndicator color={theme.colors.primary} /> : null}
    </>
  );
}

export function StoryHighlightsScreen() {
  const params = useLocalSearchParams<{ ownerId?: string | string[]; highlightId?: string | string[]; create?: string | string[] }>();
  const ownerId = getSingleRouteParam(params.ownerId) ?? '';
  const initialHighlightId = getSingleRouteParam(params.highlightId);
  const shouldCreateOnOpen = getSingleRouteParam(params.create) === 'true';
  const queryClient = useQueryClient();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [dismissInitialHighlight, setDismissInitialHighlight] = useState(false);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [formOpen, setFormOpen] = useState(() => shouldCreateOnOpen);
  const [editingHighlight, setEditingHighlight] = useState<StoryHighlight | null>(null);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<HighlightAudience>('everyone');
  const [saving, setSaving] = useState(false);
  const isOwner = viewerId === ownerId;

  useEffect(() => {
    let active = true;
    void getSupabaseClient().auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) setViewerId(data.session?.user.id ?? null);
    }).catch(async (caught: unknown) => {
      if (active) Alert.alert('Could not open highlights', await getErrorMessage(caught, 'Try again.'));
    });
    return () => { active = false; };
  }, []);

  const highlightsQuery = useQuery({
    queryKey: ['profile-story-highlights', ownerId],
    queryFn: () => getProfileStoryHighlights(ownerId),
    enabled: isUuidRouteParam(ownerId) && viewerId !== null,
  });
  const highlightRows = useMemo(() => highlightsQuery.data ?? [], [highlightsQuery.data]);
  const requestedHighlight = highlightRows.find((row) => row.id === initialHighlightId) ?? null;
  const selectedHighlight = highlightRows.find((row) => row.id === selectedHighlightId)
    ?? (dismissInitialHighlight ? null : requestedHighlight);
  const itemsQuery = useQuery({
    queryKey: ['story-highlight-items', selectedHighlight?.id],
    queryFn: () => getStoryHighlightItems(selectedHighlight!.id),
    enabled: Boolean(selectedHighlight),
  });
  const items = itemsQuery.data ?? [];
  const activeItem = items[activeItemIndex] ?? null;

  function openCreateForm() {
    setEditingHighlight(null);
    setTitle('');
    setAudience('everyone');
    setFormOpen(true);
  }

  function openHighlight(highlight: StoryHighlight) {
    setSelectedHighlightId(highlight.id);
    setDismissInitialHighlight(true);
    setActiveItemIndex(0);
  }

  function closeHighlight() {
    setSelectedHighlightId(null);
    setDismissInitialHighlight(true);
  }

  function openRenameForm(highlight: StoryHighlight) {
    setEditingHighlight(highlight);
    setTitle(highlight.title);
    setAudience(highlight.audience);
    setFormOpen(true);
  }

  async function refreshHighlights() {
    await queryClient.invalidateQueries({ queryKey: ['profile-story-highlights', ownerId] });
    await queryClient.invalidateQueries({ queryKey: ['story-highlight-items'] });
  }

  async function saveHighlight() {
    const validationError = validateStoryHighlightTitle(title);
    if (validationError) {
      Alert.alert('Highlight name', validationError);
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      if (editingHighlight) {
        await renameStoryHighlight(editingHighlight.id, title);
      } else {
        if (!canCreateStoryHighlight(highlightRows.length)) {
          throw new Error('You can create up to 20 highlights.');
        }
        await createStoryHighlight(title, audience);
      }
      setFormOpen(false);
      await refreshHighlights();
    } catch (caught) {
      Alert.alert('Could not save highlight', await getErrorMessage(caught, 'Try again.'));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(highlight: StoryHighlight) {
    Alert.alert('Delete highlight', `Delete “${highlight.title}” and its copied stories?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteStoryHighlight(highlight.id)
            .then(refreshHighlights)
            .catch(async (caught: unknown) => Alert.alert('Could not delete highlight', await getErrorMessage(caught, 'Try again.')));
        },
      },
    ]);
  }

  async function moveHighlight(highlight: StoryHighlight, newOrder: number) {
    const ids = reorderHighlightIds(highlightRows.map((row) => row.id), highlight.id, newOrder);
    if (ids.every((id, index) => id === highlightRows[index]?.id)) return;
    try {
      await reorderStoryHighlight(highlight.id, newOrder);
      await refreshHighlights();
    } catch (caught) {
      Alert.alert('Could not reorder highlights', await getErrorMessage(caught, 'Try again.'));
    }
  }

  if (!isUuidRouteParam(ownerId)) {
    return <View style={styles.center}><Text style={styles.body}>This highlight link is invalid.</Text></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" color={theme.colors.white} />
        </Pressable>
        <Text style={styles.heading}>Highlights</Text>
        {isOwner && highlightRows.length < 20 ? (
          <Pressable onPress={openCreateForm} accessibilityRole="button" accessibilityLabel="Create highlight">
            <Icon name="plus" color={theme.colors.primary} />
          </Pressable>
        ) : <View style={styles.headerSpacer} />}
      </View>

      {highlightsQuery.isPending ? <ActivityIndicator color={theme.colors.primary} style={styles.loading} /> : null}
      {highlightsQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.body}>Highlights could not be loaded.</Text>
          <Pressable onPress={() => void highlightsQuery.refetch()}><Text style={styles.link}>Retry</Text></Pressable>
        </View>
      ) : null}
      {!highlightsQuery.isPending && !highlightsQuery.isError && !highlightRows.length ? (
        <View style={styles.center}><Text style={styles.body}>{isOwner ? 'Create a highlight to save stories to your profile.' : 'No highlights yet.'}</Text></View>
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {highlightRows.map((highlight, index) => (
          <View key={highlight.id} style={styles.highlightCard}>
            <Pressable
              onPress={() => openHighlight(highlight)}
              style={styles.coverPressable}
              accessibilityRole="button"
              accessibilityLabel={`Open ${highlight.title}, ${highlight.item_count} stories`}
            >
              {highlight.cover_url
                ? <Image source={{ uri: highlight.cover_url }} style={styles.cardCover} />
                : <View style={styles.cardCoverEmpty}><Icon name="camera" color={theme.colors.textMuted} /></View>}
            </Pressable>
            <Pressable style={styles.highlightInfo} onPress={() => openHighlight(highlight)}>
              <Text style={styles.highlightTitle}>{highlight.title}</Text>
              <Text style={styles.subtitle}>{highlight.item_count} {highlight.item_count === 1 ? 'story' : 'stories'} · {highlight.audience === 'close_friends' ? 'Close friends' : highlight.audience}</Text>
            </Pressable>
            {isOwner ? (
              <View style={styles.actions}>
                <Pressable onPress={() => void moveHighlight(highlight, index - 1)} disabled={index === 0} accessibilityRole="button" accessibilityLabel={`Move ${highlight.title} up`}>
                  <Text style={[styles.action, index === 0 && styles.disabled]}>↑</Text>
                </Pressable>
                <Pressable onPress={() => void moveHighlight(highlight, index + 1)} disabled={index === highlightRows.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${highlight.title} down`}>
                  <Text style={[styles.action, index === highlightRows.length - 1 && styles.disabled]}>↓</Text>
                </Pressable>
                <Pressable onPress={() => openRenameForm(highlight)} accessibilityRole="button" accessibilityLabel={`Rename ${highlight.title}`}>
                  <Text style={styles.action}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => confirmDelete(highlight)} accessibilityRole="button" accessibilityLabel={`Delete ${highlight.title}`}>
                  <Icon name="trash" color={theme.colors.danger} size={20} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={formOpen && isOwner} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFormOpen(false)} accessibilityRole="button" accessibilityLabel="Close highlight editor" />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editingHighlight ? 'Rename highlight' : 'New highlight'}</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={40}
              placeholder="Name"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              accessibilityLabel="Highlight name"
            />
            {!editingHighlight ? (
              <View style={styles.audiences}>
                {(['everyone', 'followers', 'close_friends'] as const).map((option) => (
                  <Pressable key={option} onPress={() => setAudience(option)} style={[styles.audience, audience === option && styles.audienceSelected]}>
                    <Text style={[styles.audienceText, audience === option && styles.audienceTextSelected]}>
                      {option === 'close_friends' ? 'Close friends' : option[0].toUpperCase() + option.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable onPress={() => void saveHighlight()} disabled={saving} style={styles.primaryButton}>
              {saving ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.primaryText}>{editingHighlight ? 'Save name' : 'Create highlight'}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={selectedHighlight !== null} transparent animationType="fade" onRequestClose={closeHighlight}>
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewer}>
            <View style={styles.viewerHeader}>
              <Text numberOfLines={1} style={styles.sheetTitle}>{selectedHighlight?.title ?? 'Highlight'}</Text>
              <Pressable onPress={closeHighlight} accessibilityRole="button" accessibilityLabel="Close highlight">
                <Icon name="close" color={theme.colors.white} />
              </Pressable>
            </View>
            {itemsQuery.isPending ? <ActivityIndicator color={theme.colors.primary} style={styles.loading} /> : null}
            {itemsQuery.isError ? (
              <View style={styles.center}>
                <Text style={styles.body}>Stories could not be loaded.</Text>
                <Pressable onPress={() => void itemsQuery.refetch()}><Text style={styles.link}>Retry</Text></Pressable>
              </View>
            ) : null}
            {!itemsQuery.isPending && !itemsQuery.isError && !items.length ? <Text style={styles.body}>No stories in this highlight yet.</Text> : null}
            {activeItem ? (
              <View style={styles.storyItem}>
                <Text style={styles.subtitle}>{activeItemIndex + 1} of {items.length}</Text>
                {activeItem.media_url ? activeItem.kind === 'image'
                  ? <Image source={{ uri: activeItem.media_url }} style={styles.viewerMedia} resizeMode="contain" />
                  : <HighlightVideo key={activeItem.id} uri={activeItem.media_url} />
                  : <Text style={styles.body}>This story media is unavailable.</Text>}
                {activeItem.caption ? <Text style={styles.caption}>{activeItem.caption}</Text> : null}
                <View style={styles.itemNavigation}>
                  <Pressable
                    onPress={() => setActiveItemIndex((index) => Math.max(0, index - 1))}
                    disabled={activeItemIndex === 0}
                    style={styles.navButton}
                    accessibilityRole="button"
                    accessibilityLabel="Previous highlight story"
                  >
                    <Text style={[styles.action, activeItemIndex === 0 && styles.disabled]}>Previous</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setActiveItemIndex((index) => Math.min(items.length - 1, index + 1))}
                    disabled={activeItemIndex >= items.length - 1}
                    style={styles.navButton}
                    accessibilityRole="button"
                    accessibilityLabel="Next highlight story"
                  >
                    <Text style={[styles.action, activeItemIndex >= items.length - 1 && styles.disabled]}>Next</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  heading: { color: theme.colors.white, fontSize: 18, fontWeight: '800' },
  headerSpacer: { width: 24 },
  list: { padding: 16, gap: 10 },
  highlightCard: { minHeight: 88, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, backgroundColor: theme.colors.surface },
  coverPressable: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden' },
  cardCover: { width: '100%', height: '100%' },
  cardCoverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  highlightInfo: { flex: 1, gap: 4 },
  highlightTitle: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { color: theme.colors.primary, fontWeight: '800', padding: 4 },
  disabled: { opacity: 0.35 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loading: { marginTop: 28 },
  body: { color: theme.colors.textMuted, textAlign: 'center', fontSize: 14 },
  link: { color: theme.colors.primary, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.66)' },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 },
  sheetTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800', flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10, paddingHorizontal: 12, color: theme.colors.white, fontSize: 16 },
  audiences: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  audience: { minHeight: 38, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  audienceSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  audienceText: { color: theme.colors.white, fontSize: 12 },
  audienceTextSelected: { color: theme.colors.black, fontWeight: '800' },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  primaryText: { color: theme.colors.black, fontWeight: '800' },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.93)', paddingTop: 50, paddingHorizontal: 14, paddingBottom: 24 },
  viewer: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 18, padding: 14 },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  storyItem: { flex: 1, gap: 10, paddingBottom: 14 },
  itemNavigation: { flexDirection: 'row', justifyContent: 'space-between' },
  navButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  viewerMedia: { width: '100%', flex: 1, minHeight: 240, maxHeight: 540, backgroundColor: theme.colors.black },
  caption: { color: theme.colors.white, textAlign: 'center', fontSize: 14 },
});
