import { router } from 'expo-router';
import { preferenceStorage } from '../lib/storage';
import { useEffect, useState } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon, type AppIconName } from '../components/Icon';
import { currentUserProfile } from '../data/profile';
import { signOutProviders } from '../features/auth/socialAuth';
import { useAuthFlow } from '../features/auth/useAuthFlow';
import {
  getPushPermissionGranted,
  syncPushTokenForCurrentSession,
} from '../features/notifications/pushNotifications';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';

type ThemeMode = 'Dark' | 'Light' | 'System';

const themeModes: ThemeMode[] = ['Dark', 'Light', 'System'];

type NotificationSettingKey =
  | 'push_enabled'
  | 'notify_likes'
  | 'notify_comments'
  | 'notify_followers'
  | 'notify_messages'
  | 'notify_live'
  | 'show_online_status';

const notificationSettingByLabel: Record<string, NotificationSettingKey> = {
  'Show my online status': 'show_online_status',
  'Push notifications': 'push_enabled',
  Likes: 'notify_likes',
  Comments: 'notify_comments',
  'New followers': 'notify_followers',
  Messages: 'notify_messages',
  'Live from people I follow': 'notify_live',
};

const defaultNotificationSettings = {
  push_enabled: true,
  notify_likes: true,
  notify_comments: true,
  notify_followers: true,
  notify_messages: true,
  notify_live: true,
  show_online_status: true,
};

const settingsSections = [
  {
    title: 'Account',
    rows: [
      { label: 'Edit profile', icon: 'user', value: '', type: 'link' },
      { label: 'Email', icon: 'globe', value: 'ari@wimpex.app', type: 'value' },
      { label: 'Password', icon: 'lock', value: '', type: 'link' },
      { label: 'Linked accounts', icon: 'link', value: 'Google, Apple', type: 'value' },
    ],
  },
  {
    title: 'Privacy',
    rows: [
      { label: 'Private account', icon: 'shield', type: 'switch', active: true },
      { label: 'Who can message me', icon: 'message', value: 'Everyone', type: 'value' },
      { label: 'Show my online status', icon: 'eye', type: 'switch', active: true },
      { label: 'Show my liked videos', icon: 'heart', type: 'switch', active: false },
      { label: 'Allow others to find me by contacts', icon: 'user', type: 'switch', active: true },
      { label: 'Blocked users', icon: 'ban', value: '3', type: 'value' },
      { label: 'Personalized recommendations', icon: 'sparkles', type: 'switch', active: true },
    ],
  },
  {
    title: 'Notifications',
    rows: [
      { label: 'Push notifications', icon: 'bell', type: 'switch', active: true },
      { label: 'Likes', icon: 'heart', type: 'switch', active: true },
      { label: 'Comments', icon: 'comment', type: 'switch', active: true },
      { label: 'New followers', icon: 'user', type: 'switch', active: true },
      { label: 'Messages', icon: 'chats', type: 'switch', active: true },
      { label: 'Live from people I follow', icon: 'live', type: 'switch', active: false },
    ],
  },
  {
    title: 'Appearance',
    rows: [
      { label: 'Theme', icon: 'moon', type: 'segmented', value: 'Dark' },
      { label: 'Language', icon: 'language', value: 'English', type: 'value' },
    ],
  },
  {
    title: 'Safety',
    rows: [
      { label: 'Community guidelines', icon: 'shield', type: 'link' },
      { label: 'Report a problem', icon: 'flag', type: 'link' },
    ],
  },
  {
    title: 'Data',
    rows: [{ label: 'Download my data', icon: 'download', type: 'link' }],
  },
  {
    title: 'About',
    rows: [
      { label: 'Terms', icon: 'check', type: 'link' },
      { label: 'Privacy policy', icon: 'globe', type: 'link' },
      { label: 'App version', icon: 'info', value: '1.0.0', type: 'value' },
    ],
  },
];

export default function SettingsScreen() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('Dark');
  const [notificationSettings, setNotificationSettings] = useState(defaultNotificationSettings);
  const [pushPermissionGranted, setPushPermissionGranted] = useState(false);
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);
  const [isMinor, setIsMinor] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [typedUsername, setTypedUsername] = useState('');

  useEffect(() => {
    let active = true;
    void preferenceStorage.getItem('wimpex-theme-mode').then((value) => {
      if (active && value && themeModes.includes(value as ThemeMode)) setThemeMode(value as ThemeMode);
    }).catch((error: unknown) => {
      Alert.alert('Could not load your theme setting', error instanceof Error ? error.message : 'Try again.');
    });
    void (async () => {
      try {
        const client = getSupabaseClient();
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) return;
        const { data, error } = await client
          .from('user_settings')
          .select('push_enabled,notify_likes,notify_comments,notify_followers,notify_messages,notify_live,show_online_status')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        if (error) throw error;
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('date_of_birth')
          .eq('id', userData.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;
        setSettingsUserId(userData.user.id);
        if (profile) {
          const today = new Date();
          const birthday = new Date(`${profile.date_of_birth}T00:00:00`);
          let age = today.getFullYear() - birthday.getFullYear();
          if (
            today.getMonth() < birthday.getMonth()
            || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())
          ) {
            age -= 1;
          }
          setIsMinor(age < 18);
        }
        if (data) setNotificationSettings(data);
      } catch (error) {
        if (active) {
          Alert.alert(
            'Could not load notification settings',
            error instanceof Error ? error.message : 'Try again.',
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refreshPushPermission = () => {
      void getPushPermissionGranted()
        .then(setPushPermissionGranted)
        .catch((error: unknown) => {
          Alert.alert(
            'Could not check notification permission',
            error instanceof Error ? error.message : 'Try again.',
          );
        });
    };
    refreshPushPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPushPermission();
    });
    return () => subscription.remove();
  }, []);

  const persistTheme = async (nextMode: ThemeMode) => {
    setThemeMode(nextMode);
    try {
      await preferenceStorage.setItem('wimpex-theme-mode', nextMode);
    } catch (error) {
      Alert.alert('Could not save your theme setting', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const persistNotificationSetting = async (key: NotificationSettingKey, value: boolean) => {
    if (!settingsUserId) {
      Alert.alert('Unable to save setting', 'Sign in again and retry.');
      return;
    }
    const previous = notificationSettings[key];
    setNotificationSettings((current) => ({ ...current, [key]: value }));
    try {
      const settingUpdate: { user_id: string } & Partial<Record<NotificationSettingKey, boolean>> = {
        user_id: settingsUserId,
      };
      settingUpdate[key] = value;
      const { error } = await getSupabaseClient()
        .from('user_settings')
        .upsert(settingUpdate, { onConflict: 'user_id' });
      if (error) throw error;
      if (key === 'push_enabled') {
        try {
          await syncPushTokenForCurrentSession(value);
          if (value) setPushPermissionGranted(true);
        } catch (registrationError) {
          const rollback = { user_id: settingsUserId, push_enabled: previous };
          const { error: rollbackError } = await getSupabaseClient()
            .from('user_settings')
            .upsert(rollback, { onConflict: 'user_id' });
          if (rollbackError) {
            throw new Error(
              `Push setup failed (${registrationError instanceof Error ? registrationError.message : 'unknown error'}); `
              + `the setting could not be restored (${rollbackError.message}).`,
            );
          }
          throw registrationError;
        }
      }
      if (key === 'show_online_status' && isMinor) {
        setNotificationSettings((current) => ({ ...current, show_online_status: false }));
      }
    } catch (error) {
      setNotificationSettings((current) => ({ ...current, [key]: previous }));
      Alert.alert(
        'Could not save notification setting',
        error instanceof Error ? error.message : 'Try again.',
      );
    }
  };

  const canDelete = typedUsername.trim() === currentUserProfile.username;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {settingsSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.rows.map((row) => (
              <Pressable key={row.label} style={styles.row} accessibilityRole="button">
                <View style={styles.rowMain}>
                  <View style={styles.iconWrap}>
                    <Icon name={row.icon as AppIconName} size={20} color={theme.colors.primary} />
                  </View>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                </View>

                {row.type === 'switch' ? (
                  <Switch
                    value={
                      notificationSettingByLabel[row.label]
                        ? notificationSettingByLabel[row.label] === 'push_enabled'
                          ? notificationSettings.push_enabled && pushPermissionGranted
                          : notificationSettings[notificationSettingByLabel[row.label]]
                        : Boolean('active' in row && row.active)
                    }
                    disabled={notificationSettingByLabel[row.label] === 'show_online_status' && isMinor}
                    onValueChange={(value) => {
                      const key = notificationSettingByLabel[row.label];
                      if (key) void persistNotificationSetting(key, value);
                    }}
                    trackColor={{ false: '#374151', true: theme.colors.success }}
                    thumbColor={theme.colors.white}
                  />
                ) : row.type === 'segmented' ? (
                  <View style={styles.segmentedWrap}>
                    {themeModes.map((mode) => (
                      <Pressable
                        key={mode}
                        onPress={() => persistTheme(mode)}
                        style={[styles.segmentButton, themeMode === mode && styles.segmentButtonActive]}
                      >
                        <Text style={[styles.segmentText, themeMode === mode && styles.segmentTextActive]}>{mode}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={styles.valueWrap}>
                    {row.value ? <Text style={styles.valueText}>{row.value}</Text> : null}
                    <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        ))}

        <Pressable
          style={styles.signoutRow}
          accessibilityRole="button"
          onPress={() => {
            void signOutProviders()
              .then(() => {
                useAuthFlow.getState().resetSignup();
                router.replace('/(auth)/welcome');
              })
              .catch((error: unknown) => {
                Alert.alert(
                  'Unable to log out',
                  error instanceof Error ? error.message : 'Try again.',
                );
              });
          }}
        >
          <View style={styles.rowMain}>
            <View style={styles.iconWrap}>
              <Icon name="logOut" size={20} color={theme.colors.white} />
            </View>
            <Text style={styles.logoutText}>Log out</Text>
          </View>
        </Pressable>

        <Pressable style={styles.deleteRow} onPress={() => setDeleteSheetOpen(true)} accessibilityRole="button">
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent animationType="slide" visible={deleteSheetOpen} onRequestClose={() => setDeleteSheetOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setDeleteSheetOpen(false)} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Delete account</Text>
          <Text style={styles.sheetCopy}>Type your username to confirm.</Text>
          <TextInput
            value={typedUsername}
            onChangeText={setTypedUsername}
            style={styles.input}
            placeholder={currentUserProfile.username}
            placeholderTextColor={theme.colors.textMuted}
          />
          <Pressable
            style={[styles.deleteButton, !canDelete && styles.deleteButtonDisabled]}
            disabled={!canDelete}
            accessibilityRole="button"
          >
            <Text style={[styles.deleteButtonText, !canDelete && styles.deleteButtonTextDisabled]}>Delete account</Text>
          </Pressable>
        </View>
      </Modal>
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
  title: { color: theme.colors.white, fontSize: 22, fontWeight: '800' },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  headerSpacer: { width: 44 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  section: { marginBottom: 18 },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111418',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { color: theme.colors.white, fontWeight: '700' },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueText: { color: theme.colors.textMuted, fontSize: 12 },
  segmentedWrap: {
    flexDirection: 'row',
    backgroundColor: '#171C22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: 2,
  },
  segmentButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  segmentButtonActive: { backgroundColor: theme.colors.primary },
  segmentText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  segmentTextActive: { color: theme.colors.black },
  signoutRow: {
    backgroundColor: '#111418',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  logoutText: { color: theme.colors.white, fontWeight: '700' },
  deleteRow: {
    paddingVertical: 16,
    marginTop: 6,
    alignItems: 'center',
  },
  deleteText: { color: theme.colors.danger, fontWeight: '700' },
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
  },
  sheetCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#111418',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 34,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  sheetHandle: {
    width: 52,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: { color: theme.colors.white, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  sheetCopy: { color: theme.colors.textMuted, marginBottom: 12 },
  input: {
    borderRadius: 12,
    backgroundColor: '#171C22',
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.white,
  },
  deleteButton: {
    marginTop: 18,
    backgroundColor: theme.colors.danger,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteButtonDisabled: { opacity: 0.4 },
  deleteButtonText: { color: theme.colors.white, fontWeight: '800' },
  deleteButtonTextDisabled: { color: '#F8FAFC' },
});
