import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';

export default function CommentControlsScreen() {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [phrase, setPhrase] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPhrases = async () => {
    const { data, error: queryError } = await getSupabaseClient().rpc('get_my_hidden_comment_words');
    if (queryError) throw queryError;
    setPhrases(data.map((item) => item.phrase));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: queryError } = await getSupabaseClient().rpc('get_my_hidden_comment_words');
        if (queryError) throw queryError;
        if (active) setPhrases(data.map((item) => item.phrase));
      } catch (caught) {
        if (active) setError(await getErrorMessage(caught, 'Could not load comment controls.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const addPhrase = async () => {
    const value = phrase.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      const { error: saveError } = await getSupabaseClient().rpc('add_my_hidden_comment_word', { p_phrase: value });
      if (saveError) throw saveError;
      setPhrase('');
      await loadPhrases();
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not add this hidden word.'));
    } finally {
      setBusy(false);
    }
  };

  const removePhrase = async (value: string) => {
    try {
      const { error: deleteError } = await getSupabaseClient().rpc('remove_my_hidden_comment_word', { p_phrase: value });
      if (deleteError) throw deleteError;
      setPhrases((current) => current.filter((item) => item !== value));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not remove this hidden word.'));
    }
  };

  const setRestriction = async (restrict: boolean) => {
    const normalized = username.trim().replace(/^@/, '');
    if (!normalized) {
      setError('Enter the username of the account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: profile, error: profileError } = await getSupabaseClient()
        .from('profiles').select('id').eq('username', normalized).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error('That account could not be found.');
      const { error: restrictionError } = await getSupabaseClient().rpc('set_comment_restriction', {
        p_user_id: profile.id,
        p_restrict: restrict,
      });
      if (restrictionError) throw restrictionError;
      setUsername('');
      Alert.alert(restrict ? 'Account restricted' : 'Restriction removed');
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not update this restriction.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Comment controls</Text>
        <View style={styles.back} />
      </View>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.description}>Comments on your posts that match these words or phrases are hidden from everyone except the commenter.</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={phrase}
              onChangeText={setPhrase}
              placeholder="Add a word or phrase"
              placeholderTextColor={theme.colors.textMuted}
              maxLength={100}
              style={styles.input}
              accessibilityLabel="Hidden word or phrase"
            />
            <Pressable onPress={() => void addPhrase()} disabled={busy || !phrase.trim()} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Add</Text>
            </Pressable>
          </View>
          <Text style={styles.count}>{phrases.length} / 100</Text>
          {phrases.map((item) => (
            <View key={item} style={styles.phraseRow}>
              <Text style={styles.phrase}>{item}</Text>
              <Pressable onPress={() => void removePhrase(item)} accessibilityRole="button" accessibilityLabel={`Remove ${item}`}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={() => router.push('/hidden-comments')} style={styles.linkRow}>
            <Text style={styles.link}>Review hidden comments</Text>
            <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
          </Pressable>
          <Text style={styles.section}>Restrict an account</Text>
          <Text style={styles.description}>Their comments on your posts stay visible only to them until you approve them. Their messages are handled as requests by chat controls.</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="@username"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            accessibilityLabel="Account username"
          />
          <View style={styles.inputRow}>
            <Pressable onPress={() => void setRestriction(true)} disabled={busy} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Restrict</Text>
            </Pressable>
            <Pressable onPress={() => void setRestriction(false)} disabled={busy} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Remove restriction</Text>
            </Pressable>
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  content: { padding: 20, gap: 12 },
  description: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10, paddingHorizontal: 12, color: theme.colors.white, flex: 1 },
  primaryButton: { backgroundColor: theme.colors.primary, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 13 },
  primaryText: { color: theme.colors.black, fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 13 },
  secondaryText: { color: theme.colors.white, fontWeight: '600' },
  count: { color: theme.colors.textMuted, textAlign: 'right', fontSize: 12 },
  phraseRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.line },
  phrase: { color: theme.colors.white },
  remove: { color: theme.colors.danger, fontSize: 13 },
  linkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.colors.line, marginTop: 10 },
  link: { color: theme.colors.primary, fontWeight: '600' },
  section: { color: theme.colors.white, fontSize: 16, fontWeight: '700', marginTop: 14 },
  error: { color: theme.colors.danger },
});
