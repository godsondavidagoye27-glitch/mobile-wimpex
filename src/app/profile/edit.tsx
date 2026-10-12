import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { currentUserProfile } from '../../data/profile';
import { theme } from '../../theme/theme';

export default function EditProfileScreen() {
  const [displayName, setDisplayName] = useState(currentUserProfile.displayName);
  const [username, setUsername] = useState(currentUserProfile.username);
  const [bio, setBio] = useState(currentUserProfile.bio);
  const [link, setLink] = useState(currentUserProfile.link ?? '');

  const usernameIsAvailable = useMemo(() => {
    return username.trim().length > 2 && username.trim().toLowerCase() !== currentUserProfile.username.toLowerCase();
  }, [username]);

  const isDirty =
    displayName !== currentUserProfile.displayName ||
    username !== currentUserProfile.username ||
    bio !== currentUserProfile.bio ||
    link !== (currentUserProfile.link ?? '');

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.iconButton}>
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Edit profile</Text>
        <Pressable style={[styles.saveButton, !isDirty && styles.saveButtonDisabled]} disabled={!isDirty} accessibilityRole="button">
          <Text style={[styles.saveText, !isDirty && styles.saveTextDisabled]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{currentUserProfile.initials}</Text>
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Display name</Text>
          <TextInput value={displayName} onChangeText={setDisplayName} style={styles.input} placeholder="Display name" placeholderTextColor={theme.colors.textMuted} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput value={username} onChangeText={setUsername} style={styles.input} placeholder="Username" placeholderTextColor={theme.colors.textMuted} />
          <Text style={[styles.meta, usernameIsAvailable && styles.metaActive]}>{usernameIsAvailable ? 'This username is available.' : 'Choose a username with at least 3 characters.'}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput value={bio} onChangeText={(value) => value.length <= 150 && setBio(value)} multiline style={[styles.input, styles.textArea]} maxLength={150} placeholder="Bio" placeholderTextColor={theme.colors.textMuted} />
          <Text style={styles.counter}>{bio.length}/150</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Link</Text>
          <TextInput value={link} onChangeText={setLink} style={styles.input} placeholder="https://" placeholderTextColor={theme.colors.textMuted} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#171C22',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  saveButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveText: { color: theme.colors.black, fontWeight: '800' },
  saveTextDisabled: { color: '#0F172A' },
  content: { paddingHorizontal: 18, paddingBottom: 32 },
  avatarWrap: { alignItems: 'center', marginBottom: 18 },
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    padding: 4,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#1D3557',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.colors.white, fontSize: 30, fontWeight: '800' },
  field: { marginBottom: 18 },
  label: { color: theme.colors.white, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#111418',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.colors.white,
  },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  meta: { color: theme.colors.textMuted, marginTop: 8, fontSize: 12 },
  metaActive: { color: theme.colors.primary },
  counter: { color: theme.colors.textMuted, textAlign: 'right', marginTop: 8, fontSize: 12 },
});
