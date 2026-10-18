import { getErrorMessage } from '../lib/errorMessage';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { FocusableTextInput } from '../components/AuthField';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
import type { CommunityCategory, CommunityVisibility } from '../types/database';

const categories: CommunityCategory[] = [
  'Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art',
  'Tech', 'Fashion', 'Learning', 'Health', 'Comedy', 'Other',
];

function communitySlug(value: string) {
  const slug = value.trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 40).replace(/-+$/g, '');
}

async function errorMessage(error: unknown) {
  return getErrorMessage(error, 'Try again.');
}

export default function CreateCommunityScreen() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CommunityCategory>('Other');
  const [visibility, setVisibility] = useState<CommunityVisibility>('public');
  const [adultsOnly, setAdultsOnly] = useState(false);
  const [rules, setRules] = useState<string[]>([]);
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [canCreateAdultsOnly, setCanCreateAdultsOnly] = useState(false);
  const [nameCheck, setNameCheck] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ruleDraft, setRuleDraft] = useState('');
  const cleanedName = name.trim();
  const validName = cleanedName.length >= 3 && cleanedName.length <= 40;
  const canSubmit = validName && nameCheck === 'available' && description.length <= 300
    && rules.every((rule) => rule.trim().length > 0 && rule.trim().length <= 120)
    && !saving;
  const nameMessage = useMemo(() => {
    if (cleanedName.length > 0 && !validName) return 'Community name must be 3 to 40 characters.';
    if (nameCheck === 'taken') return 'That community name is taken.';
    if (nameCheck === 'checking') return 'Checking community name.';
    return '';
  }, [cleanedName.length, nameCheck, validName]);

  useEffect(() => {
    let active = true;
    void Promise.resolve(getSupabaseClient().rpc('community_can_create_adults_only')).then(({ data, error: rpcError }) => {
      if (rpcError) throw rpcError;
      if (active) {
        setCanCreateAdultsOnly(!!data);
        setLoading(false);
      }
    }).catch(async (caught: unknown) => {
      if (active) {
        setError(await errorMessage(caught));
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const resetTimer = setTimeout(() => setNameCheck('idle'), 0);
    const timer = validName ? setTimeout(() => {
      setNameCheck('checking');
      void Promise.resolve(getSupabaseClient().rpc('community_name_available', { p_name: cleanedName })).then(({ data, error: rpcError }) => {
        if (rpcError) throw rpcError;
        if (active) setNameCheck(data ? 'available' : 'taken');
      }).catch(async (caught: unknown) => {
        if (active) {
          setNameCheck('error');
          setError(await errorMessage(caught));
        }
      });
    }, 300) : null;
    return () => {
      active = false;
      clearTimeout(resetTimer);
      if (timer) clearTimeout(timer);
    };
  }, [cleanedName, validName]);

  const chooseIcon = async () => {
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo library permission is required to choose a community icon.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) setIconUri(result.assets[0].uri);
    } catch (caught) {
      setError(`Unable to select an icon. ${await errorMessage(caught)}`);
    }
  };

  const addRule = () => {
    const rule = ruleDraft.trim();
    if (!rule || rule.length > 120 || rules.length >= 10) return;
    setRules((current) => [...current, rule]);
    setRuleDraft('');
  };

  const createCommunity = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    let communityId: string | null = null;
    let iconUploaded = false;
    try {
      const client = getSupabaseClient();
      const { data, error: createError } = await client.rpc('create_community', {
        p_slug: communitySlug(cleanedName),
        p_name: cleanedName,
        p_description: description.trim(),
        p_category: category,
        p_visibility: visibility,
        p_is_adults_only: adultsOnly,
        p_rules: rules,
      });
      if (createError) throw createError;
      communityId = data;

      if (iconUri) {
        const response = await fetch(iconUri);
        if (!response.ok) throw new Error('The selected icon could not be read.');
        const image = await response.blob();
        const iconPath = `${communityId}/icon.jpg`;
        const { error: uploadError } = await client.storage.from('community-icons').upload(iconPath, image, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (uploadError) throw uploadError;
        iconUploaded = true;
        const { error: updateError } = await client.rpc('update_community', {
          p_community_id: communityId,
          p_name: cleanedName,
          p_description: description.trim(),
          p_category: category,
          p_visibility: visibility,
          p_is_adults_only: adultsOnly,
          p_icon_path: iconPath,
        });
        if (updateError) throw updateError;
      }
      router.replace({ pathname: '/community/[slug]', params: { slug: communitySlug(cleanedName) } });
    } catch (caught) {
      let detail = await errorMessage(caught);
      if (communityId) {
        if (iconUploaded) {
          const { error: cleanupError } = await getSupabaseClient()
            .storage.from('community-icons').remove([`${communityId}/icon.jpg`]);
          if (cleanupError) detail += ` The selected icon could not be removed (${cleanupError.message}).`;
        }
        const { error: deleteError } = await getSupabaseClient().rpc('delete_community', {
          p_community_id: communityId,
        });
        if (deleteError) {
          detail = `The community was created, but its icon could not be saved. ${detail} The community could not be removed (${deleteError.message}).`;
        }
      }
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>New community</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => void chooseIcon()} style={styles.iconPicker} accessibilityRole="button">
          {iconUri ? <Image source={{ uri: iconUri }} style={styles.iconPreview} /> : <Icon name="camera" size={24} color={theme.colors.primary} />}
          <Text style={styles.iconPickerText}>{iconUri ? 'Change icon' : 'Add icon'}</Text>
        </Pressable>

        <Text style={styles.label}>Name</Text>
        <FocusableTextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          autoCapitalize="words"
          placeholder="Community name"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          accessibilityLabel="Community name"
        />
        {nameMessage ? <Text style={styles.fieldMessage}>{nameMessage}</Text> : null}
        {nameCheck === 'error' ? <Text style={styles.errorText}>{error || 'Community name could not be checked.'}</Text> : null}

        <Text style={styles.label}>Description</Text>
        <FocusableTextInput
          value={description}
          onChangeText={setDescription}
          maxLength={300}
          multiline
          placeholder="What is this community about?"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, styles.descriptionInput]}
          accessibilityLabel="Community description"
        />
        <Text style={styles.counter}>{description.length}/300</Text>

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {categories.map((item) => (
            <Pressable
              key={item}
              onPress={() => setCategory(item)}
              style={[styles.chip, item === category && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: item === category }}
            >
              <Text style={[styles.chipText, item === category && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Visibility</Text>
        <View style={styles.segment}>
          {(['public', 'private'] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setVisibility(item)}
              style={[styles.segmentButton, visibility === item && styles.segmentSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: visibility === item }}
            >
              <Text style={[styles.segmentText, visibility === item && styles.segmentTextSelected]}>
                {item === 'public' ? 'Public' : 'Private'}
              </Text>
            </Pressable>
          ))}
        </View>

        {canCreateAdultsOnly ? (
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
            <Pressable onPress={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))} accessibilityRole="button" accessibilityLabel="Remove rule">
              <Icon name="close" size={20} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        ))}
        {rules.length < 10 ? (
          <View style={styles.addRuleRow}>
            <FocusableTextInput
              value={ruleDraft}
              onChangeText={setRuleDraft}
              maxLength={120}
              placeholder="Add a rule"
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.input, styles.ruleInput]}
              accessibilityLabel="New community rule"
            />
            <Pressable onPress={addRule} disabled={!ruleDraft.trim()} style={styles.addRuleButton} accessibilityRole="button">
              <Text style={styles.addRuleText}>Add a rule</Text>
            </Pressable>
          </View>
        ) : null}

        {error && nameCheck !== 'error' ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          onPress={() => void createCommunity()}
          disabled={!canSubmit}
          style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
          accessibilityRole="button"
        >
          {saving ? <ActivityIndicator color={theme.colors.black} /> : <Text style={styles.submitText}>Create</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 42 },
  iconPicker: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    marginVertical: 12,
    borderRadius: 30,
    backgroundColor: '#16232A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: 4,
  },
  iconPreview: { width: 100, height: 100, position: 'absolute' },
  iconPickerText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  label: { color: theme.colors.white, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  input: {
    minHeight: 48,
    color: theme.colors.white,
    backgroundColor: '#171C22',
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  descriptionInput: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  counter: { color: theme.colors.textMuted, textAlign: 'right', fontSize: 12, marginTop: 5 },
  fieldMessage: { color: theme.colors.textMuted, fontSize: 12, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: '#142A38', borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontSize: 13 },
  chipTextActive: { color: theme.colors.primary, fontWeight: '700' },
  segment: { flexDirection: 'row', gap: 10 },
  segmentButton: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12 },
  segmentSelected: { borderColor: theme.colors.primary, backgroundColor: '#142A38' },
  segmentText: { color: theme.colors.textMuted, fontWeight: '600' },
  segmentTextSelected: { color: theme.colors.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchText: { flex: 1 },
  helper: { color: theme.colors.textMuted, fontSize: 12 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  ruleText: { color: theme.colors.white, flex: 1, paddingRight: 12 },
  addRuleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleInput: { flex: 1 },
  addRuleButton: { paddingHorizontal: 10, paddingVertical: 12 },
  addRuleText: { color: theme.colors.primary, fontWeight: '700' },
  errorText: { color: '#F87171', marginTop: 8, lineHeight: 20 },
  submitButton: { minHeight: 50, marginTop: 28, borderRadius: 25, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: theme.colors.black, fontSize: 16, fontWeight: '800' },
});
