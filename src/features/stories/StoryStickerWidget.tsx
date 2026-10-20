import { Canvas, RoundedRect, useCanvasSize } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getErrorMessage } from '../../lib/errorMessage';
import { theme } from '../../theme/theme';
import type {
  StoryPollResultsRpcRow,
  StoryQuestionReplyRpcRow,
  StoryStickerRow,
} from '../../types/database';
import {
  getStoryPollResults,
  getStoryQuestionReplies,
  getStorySticker,
  replyToStoryQuestion,
  voteOnStoryPoll,
} from './storyService';

type Props = {
  storyId: string;
  isOwner: boolean;
  onPauseChange: (paused: boolean) => void;
};

export function StoryStickerWidget({ storyId, isOwner, onPauseChange }: Props) {
  const { ref: canvasRef, size } = useCanvasSize();
  const [sticker, setSticker] = useState<StoryStickerRow | null>(null);
  const [pollResults, setPollResults] = useState<StoryPollResultsRpcRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replies, setReplies] = useState<StoryQuestionReplyRpcRow[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const currentSticker = await getStorySticker(storyId);
        if (!active) return;
        setSticker(currentSticker);
        if (currentSticker?.kind === 'poll') {
          setPollResults(await getStoryPollResults(currentSticker.id));
        } else {
          setPollResults(null);
        }
      } catch (caught) {
        if (active) setError(await getErrorMessage(caught, 'This story sticker could not be loaded.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [storyId]);

  const openQuestion = async () => {
    setReplyOpen(true);
    onPauseChange(true);
    if (!isOwner || !sticker || sticker.kind !== 'question') return;
    setRepliesLoading(true);
    setError('');
    try {
      setReplies(await getStoryQuestionReplies(sticker.id));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Question replies could not be loaded.'));
    } finally {
      setRepliesLoading(false);
    }
  };

  const closeQuestion = () => {
    setReplyOpen(false);
    onPauseChange(false);
  };

  const castVote = async (option: 1 | 2) => {
    if (!sticker || voting || pollResults?.can_view_results) return;
    setVoting(true);
    setError('');
    try {
      setPollResults(await voteOnStoryPoll(sticker.id, option));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Your vote could not be saved.'));
    } finally {
      setVoting(false);
    }
  };

  const sendReply = async () => {
    if (!sticker || sticker.kind !== 'question' || !replyDraft.trim() || replySending) return;
    setReplySending(true);
    setError('');
    try {
      await replyToStoryQuestion(sticker.id, replyDraft);
      setReplyDraft('');
      closeQuestion();
      Alert.alert('Reply sent', 'Your answer is visible only to the story author.');
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Your reply could not be sent.'));
    } finally {
      setReplySending(false);
    }
  };

  if (loading) return null;
  if (!sticker) {
    return error ? (
      <View style={styles.stickerErrorWrap}>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      </View>
    ) : null;
  }

  const panelWidth = Math.min(300 * sticker.scale, size.width * 0.88);
  const panelHeight = (sticker.kind === 'poll' ? 154 : 112) * sticker.scale;
  const left = Math.max(8, Math.min(size.width - panelWidth - 8, sticker.position_x * size.width - panelWidth / 2));
  const top = Math.max(54, Math.min(size.height - panelHeight - 88, sticker.position_y * size.height - panelHeight / 2));
  const oneCount = pollResults?.option_one_count ?? 0;
  const twoCount = pollResults?.option_two_count ?? 0;
  const total = pollResults?.total_votes ?? 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Canvas ref={canvasRef} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
        <RoundedRect
          x={left}
          y={top}
          width={panelWidth}
          height={panelHeight}
          r={18}
          color="#101827"
          opacity={0.97}
        />
      </Canvas>
      <View style={[styles.panel, { left, top, width: panelWidth, minHeight: panelHeight }]}>
        <Text numberOfLines={2} style={styles.prompt}>{sticker.prompt}</Text>
        {sticker.kind === 'poll' ? (
          pollResults?.can_view_results ? (
            <View style={styles.results}>
              <PollResult label={sticker.option_one ?? 'Option 1'} count={oneCount} total={total} selected={pollResults.viewer_option === 1} />
              <PollResult label={sticker.option_two ?? 'Option 2'} count={twoCount} total={total} selected={pollResults.viewer_option === 2} />
              <Text style={styles.voteCount}>{total} {total === 1 ? 'vote' : 'votes'}</Text>
            </View>
          ) : isOwner ? (
            <Text style={styles.voteCount}>No votes yet.</Text>
          ) : (
            <View style={styles.pollChoices}>
              <Pressable onPress={() => void castVote(1)} disabled={voting} style={styles.choice} accessibilityRole="button">
                <Text style={styles.choiceText}>{sticker.option_one}</Text>
              </Pressable>
              <Pressable onPress={() => void castVote(2)} disabled={voting} style={styles.choice} accessibilityRole="button">
                <Text style={styles.choiceText}>{sticker.option_two}</Text>
              </Pressable>
              {voting ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
            </View>
          )
        ) : (
          <Pressable
            onPress={() => void openQuestion()}
            style={styles.questionAction}
            accessibilityRole="button"
          >
            <Text style={styles.questionActionText}>{isOwner ? 'View answers' : 'Answer'}</Text>
          </Pressable>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>

      <Modal visible={replyOpen} transparent animationType="slide" onRequestClose={closeQuestion}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeQuestion} accessibilityRole="button" accessibilityLabel="Close story answers" />
          <View style={styles.replySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isOwner ? 'Question answers' : sticker.prompt}</Text>
              <Pressable onPress={closeQuestion} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            {isOwner ? (
              <>
                {repliesLoading ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} /> : null}
                <FlatList
                  data={replies}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.replyRow}>
                      <Text style={styles.replyBy}>@{item.username}</Text>
                      <Text style={styles.replyBody}>{item.body}</Text>
                    </View>
                  )}
                  ListEmptyComponent={!repliesLoading ? <Text style={styles.empty}>No answers yet.</Text> : null}
                />
              </>
            ) : (
              <>
                <TextInput
                  value={replyDraft}
                  onChangeText={setReplyDraft}
                  maxLength={1000}
                  multiline
                  placeholder="Write your answer"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.replyInput}
                  accessibilityLabel="Answer to the story question"
                />
                <Pressable
                  onPress={() => void sendReply()}
                  disabled={!replyDraft.trim() || replySending}
                  style={[styles.sendButton, (!replyDraft.trim() || replySending) && styles.disabled]}
                  accessibilityRole="button"
                >
                  {replySending ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.sendText}>Send privately</Text>}
                </Pressable>
                <Text style={styles.privacyNote}>Only the story author can see your answer.</Text>
              </>
            )}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PollResult({
  label,
  count,
  total,
  selected,
}: {
  label: string;
  count: number;
  total: number;
  selected: boolean;
}) {
  const percentage = total ? Math.round((count / total) * 100) : 0;
  return (
    <View style={styles.resultRow}>
      <View style={styles.resultLabelRow}>
        <Text numberOfLines={1} style={[styles.resultLabel, selected && styles.selectedResult]}>{label}</Text>
        <Text style={styles.resultLabel}>{percentage}%</Text>
      </View>
      <View style={styles.resultTrack}>
        <View style={[styles.resultFill, { width: `${percentage}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stickerErrorWrap: { position: 'absolute', left: 16, right: 16, top: 88, alignItems: 'center' },
  panel: { position: 'absolute', padding: 14, alignItems: 'stretch', justifyContent: 'center' },
  prompt: { color: theme.colors.white, fontSize: 15, lineHeight: 19, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  pollChoices: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choice: { flex: 1, minHeight: 38, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 10, paddingHorizontal: 6 },
  choiceText: { color: theme.colors.white, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  results: { gap: 7 },
  resultRow: { gap: 4 },
  resultLabelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  resultLabel: { color: theme.colors.white, fontSize: 11, fontWeight: '700' },
  selectedResult: { color: theme.colors.primary },
  resultTrack: { height: 5, overflow: 'hidden', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  resultFill: { height: '100%', backgroundColor: theme.colors.primary },
  voteCount: { color: theme.colors.textMuted, fontSize: 11, textAlign: 'center' },
  questionAction: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(214,178,94,0.15)' },
  questionActionText: { color: theme.colors.primary, fontSize: 12, fontWeight: '800' },
  error: { color: theme.colors.danger, fontSize: 11, marginTop: 6, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  replySheet: { maxHeight: '75%', minHeight: 260, padding: 18, backgroundColor: theme.colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sheetTitle: { flex: 1, color: theme.colors.white, fontSize: 17, fontWeight: '800' },
  closeText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  replyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 4 },
  replyBy: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  replyBody: { color: theme.colors.white, fontSize: 14, lineHeight: 19 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', paddingVertical: 30 },
  loader: { marginVertical: 18 },
  replyInput: { minHeight: 110, maxHeight: 180, padding: 12, color: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, textAlignVertical: 'top' },
  sendButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: theme.colors.primary },
  sendText: { color: theme.colors.black, fontWeight: '800', fontSize: 14 },
  disabled: { opacity: 0.55 },
  privacyNote: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' },
});
