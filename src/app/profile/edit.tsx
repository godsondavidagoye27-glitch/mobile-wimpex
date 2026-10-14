import * as ImagePicker from 'expo-image-picker';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/build/react-navigation/core/usePreventRemove';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { isValidUsername } from '../../features/auth/signupValidation';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { ProfileRpcRow } from '../../types/database';
import { validateProfileLink } from '../../features/profiles/profileValidation';

type ProfileDraft = {
  displayName: string;
  username: string;
  bio: string;
  link: string;
  avatarUri: string | null;
};
type AvailabilityResult = { username: string; status: 'available' | 'taken' | 'error'; message: string };

function usernameAgainDate(value: string | null) {
  if (!value) return null;
  const availableAt = new Date(new Date(value).getTime() + 14 * 24 * 60 * 60 * 1000);
  return availableAt > new Date() ? availableAt : null;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Try again.';
}

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const [profile, setProfile] = useState<ProfileRpcRow | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: queryError } = await getSupabaseClient().rpc('get_profile', { p_username: null });
        if (queryError) throw queryError;
        const current = data?.[0];
        if (!current?.is_me) throw new Error('Your profile could not be found.');
        if (!active) return;
        setProfile(current);
        setDraft({
          displayName: current.display_name,
          username: current.username,
          bio: current.bio ?? '',
          link: current.link ?? '',
          avatarUri: null,
        });
      } catch (caught) {
        if (active) setError(messageFor(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const username = draft?.username.trim().toLowerCase() ?? '';
  const usernameChanged = !!profile && username !== profile.username;
  const cooldownDate = usernameChanged ? usernameAgainDate(profile?.username_changed_at ?? null) : null;
  const cooldownEndsAt = cooldownDate?.getTime() ?? null;

  useEffect(() => {
    if (!usernameChanged || cooldownEndsAt !== null || !isValidUsername(username)) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setAvailability({ username, status: 'error', message: 'Checking username availability.' });
      void (async () => {
        try {
          const { data, error: queryError } = await getSupabaseClient().rpc('is_username_available', { name: username });
          if (!active) return;
          if (queryError) throw queryError;
          setAvailability({
            username,
            status: data ? 'available' : 'taken',
            message: data ? 'This username is available.' : 'That username is taken.',
          });
        } catch (caught) {
          if (active) setAvailability({
            username,
            status: 'error',
            message: messageFor(caught),
          });
        }
      })();
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cooldownEndsAt, username, usernameChanged]);

  const linkError = validateProfileLink(draft?.link ?? '');
  const usernameError = !usernameChanged
    ? ''
    : cooldownDate
      ? `You can change your username again on ${cooldownDate.toLocaleDateString()}.`
      : !isValidUsername(username)
        ? 'Use 3 to 20 letters, numbers, dots or underscores.'
        : availability?.username === username
          ? availability.message
          : '';
  const usernameAvailable = !usernameChanged
    || (!cooldownDate && isValidUsername(username) && availability?.username === username && availability.status === 'available');
  const dirty = !!profile && !!draft && (
    draft.displayName.trim() !== profile.display_name
    || username !== profile.username
    || draft.bio !== (profile.bio ?? '')
    || draft.link.trim() !== (profile.link ?? '')
    || draft.avatarUri !== null
  );

  usePreventRemove(dirty && !saved, ({ data }) => {
    setPendingNavigationAction(() => () => navigation.dispatch(data.action));
    setDiscardOpen(true);
  });

  const updateDraft = (values: Partial<ProfileDraft>) => {
    setDraft((current) => current ? { ...current, ...values } : current);
  };

  const chooseAvatar = async () => {
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo library permission is required to update your profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled) updateDraft({ avatarUri: result.assets[0].uri });
    } catch (caught) {
      setError(`Unable to select a profile photo. ${messageFor(caught)}`);
    }
  };

  const save = async () => {
    if (!profile || !draft || !dirty || !usernameAvailable || !draft.displayName.trim() || linkError || saving) return;
    setSaving(true);
    setError('');
    let uploadedPath: string | null = null;
    try {
      const client = getSupabaseClient();
      let avatarUrl = profile.avatar_url;
      if (draft.avatarUri) {
        const photoResponse = await fetch(draft.avatarUri);
        if (!photoResponse.ok) throw new Error('Unable to read the selected photo.');
        const photo = await photoResponse.blob();
        uploadedPath = `${profile.id}/avatar-${Date.now()}.jpg`;
        const { error: uploadError } = await client.storage.from('avatars').upload(uploadedPath, photo, {
          contentType: 'image/jpeg',
          upsert: false,
        });
        if (uploadError) throw uploadError;
        avatarUrl = client.storage.from('avatars').getPublicUrl(uploadedPath).data.publicUrl;
      }

      const { error: updateError } = await client.from('profiles').update({
        display_name: draft.displayName.trim(),
        username,
        bio: draft.bio,
        link: draft.link.trim() || null,
        avatar_url: avatarUrl,
      }).eq('id', profile.id);
      if (updateError) throw updateError;
      setSaved(true);
      router.back();
    } catch (caught) {
      if (uploadedPath) {
        const { error: cleanupError } = await getSupabaseClient().storage.from('avatars').remove([uploadedPath]);
        if (cleanupError) {
          setError(`Unable to save profile (${messageFor(caught)}). The uploaded photo could not be removed (${cleanupError.message}).`);
          return;
        }
      }
      setError(messageFor(caught));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDiscardOpen(false);
    if (pendingNavigationAction) {
      pendingNavigationAction();
    } else {
      router.back();
    }
    setPendingNavigationAction(null);
  };

  const avatarSource = draft?.avatarUri
    ? { uri: draft.avatarUri }
    : profile?.avatar_url
      ? { uri: profile.avatar_url }
      : null;
  const canSave = dirty
    && usernameAvailable
    && !!draft?.displayName.trim()
    && !linkError
    && !saving;
  const availabilityPending = usernameChanged
    && !cooldownDate
    && isValidUsername(username)
    && availability?.username !== username;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  if (!profile || !draft) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error || 'Your profile could not be found.'}</Text></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.iconButton} accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Edit profile</Text>
        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={() => void save()}
          disabled={!canSave}
          accessibilityRole="button"
        >
          {saving ? <ActivityIndicator size="small" color={theme.colors.black} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.errorBanner}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarWrap}>
          <View style={styles.avatarRing}>
            {avatarSource
              ? <Image source={avatarSource} style={styles.avatar} />
              : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(draft.displayName)}</Text></View>}
          </View>
          <Pressable onPress={() => void chooseAvatar()} accessibilityRole="button">
            <Text style={styles.changePhoto}>Change photo</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={draft.displayName}
            onChangeText={(displayName) => updateDraft({ displayName })}
            style={styles.input}
            maxLength={60}
            accessibilityLabel="Display name"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            value={draft.username}
            onChangeText={(value) => updateDraft({ username: value.toLowerCase() })}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            accessibilityLabel="Username"
          />
          {availabilityPending ? <Text style={styles.meta}>Checking username availability.</Text> : null}
          {usernameError ? (
            <Text style={[styles.meta, availability?.status === 'available' && styles.metaActive]}>{usernameError}</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            value={draft.bio}
            onChangeText={(bio) => bio.length <= 150 && updateDraft({ bio })}
            multiline
            style={[styles.input, styles.textArea]}
            maxLength={150}
            accessibilityLabel="Bio"
          />
          <Text style={styles.counter}>{draft.bio.length}/150</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Link</Text>
          <TextInput
            value={draft.link}
            onChangeText={(link) => updateDraft({ link })}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            accessibilityLabel="Link"
          />
          {linkError ? <Text style={styles.meta}>{linkError}</Text> : null}
        </View>
      </ScrollView>

      <Modal transparent animationType="fade" visible={discardOpen} onRequestClose={() => setDiscardOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDiscardOpen(false)} />
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>Discard changes</Text>
          <Text style={styles.confirmCopy}>Your profile changes will not be saved.</Text>
          <Pressable style={styles.discardButton} onPress={discard} accessibilityRole="button">
            <Text style={styles.discardText}>Discard changes</Text>
          </Pressable>
          <Pressable style={styles.stayButton} onPress={() => setDiscardOpen(false)} accessibilityRole="button">
            <Text style={styles.stayText}>Keep editing</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  iconButton: { width: 42, height: 42, alignItems: 'flex-start', justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 19, fontWeight: '800' },
  saveButton: { minWidth: 64, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 12, backgroundColor: theme.colors.primary },
  saveButtonDisabled: { opacity: 0.4 },
  saveText: { color: theme.colors.black, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 32 },
  avatarWrap: { alignItems: 'center', gap: 12, marginBottom: 24 },
  avatarRing: { width: 104, height: 104, padding: 4, borderRadius: 52, backgroundColor: theme.colors.primary },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.surface },
  avatarFallback: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3557' },
  avatarText: { color: theme.colors.white, fontSize: 30, fontWeight: '800' },
  changePhoto: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  field: { marginBottom: 18 },
  label: { color: theme.colors.white, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, paddingVertical: 11, color: theme.colors.white, backgroundColor: theme.colors.surface },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  meta: { color: theme.colors.textMuted, marginTop: 7, fontSize: 12, lineHeight: 18 },
  metaActive: { color: theme.colors.primary },
  counter: { color: theme.colors.textMuted, textAlign: 'right', marginTop: 7, fontSize: 12 },
  errorBanner: { color: theme.colors.danger, fontSize: 13, paddingHorizontal: 18, paddingTop: 10 },
  error: { color: theme.colors.danger, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black, padding: 24 },
  modalOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.62)' },
  confirmCard: { position: 'absolute', left: 24, right: 24, top: '35%', padding: 18, borderRadius: 18, backgroundColor: theme.colors.surface, gap: 10 },
  confirmTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800' },
  confirmCopy: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 5 },
  discardButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.colors.danger },
  discardText: { color: theme.colors.white, fontWeight: '800' },
  stayButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  stayText: { color: theme.colors.textMuted, fontWeight: '700' },
});
