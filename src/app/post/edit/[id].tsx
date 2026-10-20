import { goBack } from '../../../lib/navigation';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '../../../components/Icon';
import { getErrorMessage } from '../../../lib/errorMessage';
import { getSingleRouteParam, isUuidRouteParam } from '../../../lib/routeParams';
import { getSupabaseClient } from '../../../lib/supabase';
import { createPostEditPayload } from '../../../features/feed/postEditPayload';
import { requestPendingModeration } from '../../../features/moderation/requestModeration';
import { theme } from '../../../theme/theme';

type EditablePost = {
  id: string;
  author_id: string;
  caption: string;
  audience: 'everyone' | 'followers';
  allow_comments: boolean;
  auto_captions: boolean;
};

export default function EditPostScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const postId = getSingleRouteParam(params.id) ?? '';
  const [post, setPost] = useState<EditablePost | null>(null);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'followers'>('everyone');
  const [allowComments, setAllowComments] = useState(true);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isUuidRouteParam(postId)) throw new Error('This post link is invalid.');
      const client = getSupabaseClient();
      const { data: sessionResult, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionResult.session) throw new Error('Sign in to edit this post.');
      const { data, error: postError } = await client.from('posts')
        .select('id,author_id,caption,audience,allow_comments,auto_captions')
        .eq('id', postId)
        .maybeSingle();
      if (postError) throw postError;
      if (!data || data.author_id !== sessionResult.session.user.id) {
        throw new Error('Only the post owner can edit this video.');
      }
      if (!active) return;
      setPost(data);
      setCaption(data.caption);
      setAudience(data.audience);
      setAllowComments(data.allow_comments);
      setAutoCaptions(data.auto_captions);
    })().catch(async (caught: unknown) => {
      if (active) setError(await getErrorMessage(caught, 'Could not load this post.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [postId]);

  const save = async () => {
    if (!post || saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = createPostEditPayload({
        caption,
        audience,
        allow_comments: allowComments,
        auto_captions: autoCaptions,
      });
      const { error: updateError } = await getSupabaseClient().from('posts')
        .update(payload)
        .eq('id', post.id)
        .eq('author_id', post.author_id);
      if (updateError) throw updateError;
      if (payload.caption !== post.caption) requestPendingModeration('post');
      goBack();
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not save post changes.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Edit post</Text>
        <Pressable onPress={() => void save()} disabled={!post || saving} style={styles.saveButton}>
          {saving ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Text style={styles.label}>Caption and hashtags</Text>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={2200}
          placeholder="Write a caption"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.caption}
          accessibilityLabel="Post caption"
        />
        <Text style={styles.label}>Audience</Text>
        <View style={styles.audienceRow}>
          {(['everyone', 'followers'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setAudience(option)}
              style={[styles.audienceOption, audience === option && styles.audienceSelected]}
            >
              <Text style={[styles.optionText, audience === option && styles.optionSelected]}>
                {option === 'everyone' ? 'Everyone' : 'Followers'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Setting label="Allow comments" value={allowComments} onChange={setAllowComments} />
        <Setting label="Automatic captions" value={autoCaptions} onChange={setAutoCaptions} />
        <Text style={styles.note}>Changing the audience takes effect immediately. Hashtags are rebuilt from the caption when you save.</Text>
      </ScrollView>
    </View>
  );
}

function Setting({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.optionText}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#374151', true: theme.colors.success }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36 },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  saveButton: { minWidth: 56, minHeight: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, borderRadius: 9, paddingHorizontal: 12 },
  saveText: { color: theme.colors.black, fontWeight: '800' },
  content: { padding: 20, gap: 12 },
  label: { color: theme.colors.white, fontWeight: '700', marginTop: 12 },
  caption: { minHeight: 150, textAlignVertical: 'top', borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, padding: 12, color: theme.colors.white },
  audienceRow: { flexDirection: 'row', gap: 10 },
  audienceOption: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.line, padding: 12, borderRadius: 10 },
  audienceSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  optionText: { color: theme.colors.white },
  optionSelected: { color: theme.colors.primary, fontWeight: '700' },
  settingRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.line },
  note: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: theme.colors.danger },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
});
