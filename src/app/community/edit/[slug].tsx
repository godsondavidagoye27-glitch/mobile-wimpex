import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../../components/Icon';
import { getSupabaseClient } from '../../../lib/supabase';
import { theme } from '../../../theme/theme';
import type { CommunityCategory, CommunityDetailRpcRow, CommunityVisibility } from '../../../types/database';

const categories: CommunityCategory[] = [
  'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art',
  'Tech', 'Fashion', 'Learning', 'Health', 'Comedy', 'Other',
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Try again.';
}

export default function EditCommunityScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug ?? '';
  const [community, setCommunity] = useState<CommunityDetailRpcRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CommunityCategory>('Other');
  const [visibility, setVisibility] = useState<CommunityVisibility>('public');
  const [adultsOnly, setAdultsOnly] = useState(false);
  const [rules, setRules] = useState<string[]>([]);
  const [ruleDraft, setRuleDraft] = useState('');
  const [canCreateAdultsOnly, setCanCreateAdultsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameAvailability, setNameAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const nameChanged = !!community && name.trim() !== community.name;
  const nameAvailable = !nameChanged || nameAvailability === 'available';
  const changed = !!community && (
    nameChanged
    || description.trim() !== (community.description ?? '')
    || category !== community.category
    || visibility !== community.visibility
    || adultsOnly !== community.is_adults_only
    || JSON.stringify(rules) !== JSON.stringify(Array.isArray(community.rules) ? community.rules : [])
  );
  const valid = !!community?.can_moderate
    && name.trim().length >= 3
    && name.trim().length <= 40
    && description.trim().length <= 300
    && (!nameChanged || nameAvailable)
    && (!adultsOnly || canCreateAdultsOnly)
    && rules.length <= 10
    && rules.every((rule) => rule.trim().length > 0 && rule.trim().length <= 120);
  const canSave = valid && changed && !saving;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = getSupabaseClient();
        const [result, adultResult] = await Promise.all([
          client.rpc('get_community', { p_slug: slug }),
          client.rpc('community_can_create_adults_only'),
        ]);
        if (result.error) throw result.error;
        if (adultResult.error) throw adultResult.error;
        const value = result.data?.[0] ?? null;
        if (active) {
          setCommunity(value);
          setCanCreateAdultsOnly(!!adultResult.data);
          if (value) {
            setName(value.name);
            setDescription(value.description ?? '');
            setCategory(value.category);
            setVisibility(value.visibility);
            setAdultsOnly(value.is_adults_only);
            setRules(Array.isArray(value.rules)
              ? value.rules.filter((rule): rule is string => typeof rule === 'string')
              : []);
            if (!value.can_moderate) setError('Only community moderators can edit details.');
          }
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
  }, [slug]);

  useEffect(() => {
    if (!community || !nameChanged) {
      const timer = setTimeout(() => setNameAvailability('idle'), 0);
      return () => clearTimeout(timer);
    }
    let active = true;
    const resetTimer = setTimeout(() => setNameAvailability('idle'), 0);
    const timer = setTimeout(() => {
      setNameAvailability('checking');
      void Promise.resolve(getSupabaseClient().rpc('community_name_available', { p_name: name.trim() }))
        .then(({ data, error: rpcError }) => {
          if (rpcError) throw rpcError;
          if (active) setNameAvailability(data ? 'available' : 'taken');
        })
        .catch((caught: unknown) => {
          if (active) {
            setNameAvailability('error');
            setError(errorMessage(caught));
          }
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(resetTimer);
      clearTimeout(timer);
    };
  }, [community, name, nameChanged]);

  const nameError = useMemo(() => {
    if (name.trim().length > 0 && (name.trim().length < 3 || name.trim().length > 40)) {
      return 'Community name must be 3 to 40 characters.';
    }
    if (nameChanged && nameAvailability === 'taken') return 'That community name is taken.';
    return '';
  }, [name, nameAvailability, nameChanged]);

  const save = async () => {
    if (!community || !canSave) return;
    setSaving(true);
    setError('');
    try {
      const client = getSupabaseClient();
      const { error: updateError } = await client.rpc('update_community', {
        p_community_id: community.id,
        p_name: name.trim(),
        p_description: description.trim(),
        p_category: category,
        p_visibility: visibility,
        p_is_adults_only: adultsOnly,
      });
      if (updateError) throw updateError;
      const { error: rulesError } = await client.rpc('update_rules', {
        p_community_id: community.id,
        p_rules: rules,
      });
      if (rulesError) throw rulesError;
      router.back();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    const value = ruleDraft.trim();
    if (!value || value.length > 120 || rules.length >= 10) return;
    setRules((current) => [...current, value]);
    setRuleDraft('');
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Edit community</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!community ? <Text style={styles.errorText}>Community not found.</Text> : null}
        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} maxLength={40} style={styles.input} accessibilityLabel="Community name" />
        {nameError ? <Text style={styles.helper}>{nameError}</Text> : null}
        {nameChanged && nameAvailability === 'checking' ? <Text style={styles.helper}>Checking community name.</Text> : null}

        <Text style={styles.label}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          maxLength={300}
          multiline
          style={[styles.input, styles.descriptionInput]}
          accessibilityLabel="Community description"
        />
        <Text style={styles.counter}>{description.length}/300</Text>

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {categories.map((item) => (
            <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}>
              <Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Visibility</Text>
        <View style={styles.segment}>
          {(['public', 'private'] as const).map((item) => (
            <Pressable key={item} onPress={() => setVisibility(item)} style={[styles.segmentButton, visibility === item && styles.segmentSelected]}>
              <Text style={[styles.chipText, visibility === item && styles.chipTextActive]}>
                {item === 'public' ? 'Public' : 'Private'}
              </Text>
            </Pressable>
          ))}
        </View>

        {community?.role === 'owner' && canCreateAdultsOnly ? (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Adults only</Text>
              <Text style={styles.helper}>Only adults can see or join this community.</Text>
            </View>
            <Switch value={adultsOnly} onValueChange={setAdultsOnly} trackColor={{ true: theme.colors.primary }} />
          </View>
        ) : null}

        <Text style={styles.label}>Rules</Text>
        {rules.map((rule, index) => (
          <View key={`${rule}-${index}`} style={styles.ruleRow}>
            <Text style={styles.ruleText}>{rule}</Text>
            <Pressable onPress={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
              <Icon name="close" size={20} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        ))}
        {rules.length < 10 ? (
          <View style={styles.ruleEntry}>
            <TextInput value={ruleDraft} onChangeText={setRuleDraft} maxLength={120} placeholder="Add a rule" placeholderTextColor={theme.colors.textMuted} style={[styles.input, styles.ruleInput]} />
            <Pressable onPress={addRule}><Text style={styles.addRule}>Add a rule</Text></Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable onPress={() => void save()} disabled={!canSave} style={[styles.saveButton, !canSave && styles.disabled]}>
          {saving ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 42 },
  label: { color: theme.colors.white, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  input: { minHeight: 48, color: theme.colors.white, backgroundColor: '#171C22', borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  descriptionInput: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  counter: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 5 },
  helper: { color: theme.colors.textMuted, fontSize: 12, marginTop: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: '#142A38', borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: theme.colors.primary },
  segment: { flexDirection: 'row', gap: 10 },
  segmentButton: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12 },
  segmentSelected: { backgroundColor: '#142A38', borderColor: theme.colors.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchText: { flex: 1 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  ruleText: { color: theme.colors.white, flex: 1, paddingRight: 12 },
  ruleEntry: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleInput: { flex: 1 },
  addRule: { color: theme.colors.primary, fontWeight: '700' },
  errorText: { color: '#F87171', marginTop: 12, lineHeight: 20 },
  saveButton: { minHeight: 50, marginTop: 28, borderRadius: 25, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  saveText: { color: theme.colors.black, fontSize: 16, fontWeight: '800' },
});
