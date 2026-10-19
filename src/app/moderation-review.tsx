import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import type { Database } from '../types/database';

type Flag = Database['public']['Tables']['moderation_flags']['Row'];

export default function ModerationReviewScreen() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const client = getSupabaseClient();
    const { data: sessionResult, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionResult.session) throw new Error('Sign in to view moderation status.');
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('is_official').eq('id', sessionResult.session.user.id).maybeSingle();
    if (profileError) throw profileError;
    const staff = profile?.is_official ?? false;
    setIsStaff(staff);
    const query = client.from('moderation_flags')
      .select('id,content_type,content_id,author_id,category,score,status,decision_note,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(100);
    const { data, error: flagsError } = staff ? await query.in('status', ['review', 'appealed']) : await query.eq('author_id', sessionResult.session.user.id);
    if (flagsError) throw flagsError;
    setFlags(data);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void refresh().catch(async (caught: unknown) => {
        if (active) setError(await getErrorMessage(caught, 'Could not load moderation status.'));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);

  const review = async (flag: Flag, action: 'approve' | 'remove' | 'warn') => {
    try {
      const { error: actionError } = await getSupabaseClient().rpc('review_moderation_flag', {
        p_flag_id: flag.id,
        p_action: action,
      });
      if (actionError) throw actionError;
      await refresh();
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not save the moderation decision.'));
    }
  };

  const appeal = async (flag: Flag) => {
    try {
      const { error: appealError } = await getSupabaseClient().rpc('appeal_moderation_flag', {
        p_flag_id: flag.id,
        p_note: 'The author requested a review.',
      });
      if (appealError) throw appealError;
      await refresh();
      Alert.alert('Appeal sent', 'A reviewer will take another look.');
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not submit the appeal.'));
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>{isStaff ? 'Moderation queue' : 'Content review'}</Text>
        <View style={styles.back} />
      </View>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {!isStaff ? <Text style={styles.description}>Content flagged by automated checks may be hidden while it is reviewed. Use Appeal to request another look.</Text> : null}
          {flags.length === 0 ? <Text style={styles.empty}>Nothing to review.</Text> : flags.map((flag) => (
            <View key={flag.id} style={styles.card}>
              <Text style={styles.heading}>{flag.category} · {flag.content_type} · {Math.round(flag.score * 100)}%</Text>
              <Text style={styles.note}>{flag.status}{flag.decision_note ? ` — ${flag.decision_note}` : ''}</Text>
              {isStaff ? (
                <View style={styles.actions}>
                  <Action label="Approve" onPress={() => void review(flag, 'approve')} />
                  <Action label="Warn" onPress={() => void review(flag, 'warn')} />
                  <Action label="Remove" destructive onPress={() => void review(flag, 'remove')} />
                </View>
              ) : flag.status === 'review' || flag.status === 'removed' ? (
                <Action label="Appeal" onPress={() => void appeal(flag)} />
              ) : null}
            </View>
          ))}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

function Action({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, destructive && styles.destructive]}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36 },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  description: { color: theme.colors.textMuted, lineHeight: 20 },
  card: { backgroundColor: theme.colors.surface, padding: 16, borderRadius: 12, gap: 8 },
  heading: { color: theme.colors.white, fontWeight: '700', textTransform: 'capitalize' },
  note: { color: theme.colors.textMuted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: { backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
  destructive: { backgroundColor: theme.colors.danger },
  actionText: { color: theme.colors.black, fontWeight: '700' },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: 48 },
  error: { color: theme.colors.danger },
});
