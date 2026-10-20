import { getErrorMessage } from '../lib/errorMessage';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Icon, type AppIconName } from '../components/Icon';
import { FocusableTextInput } from '../components/AuthField';
import { useFollowRequestCount } from '../features/profiles/useFollowRequestCount';
import { MutedTargetsSheet } from '../features/notifications/MutedTargetsSheet';
import { signOutProviders } from '../features/auth/socialAuth';
import { assertNoActiveVideoUploads, clearLocalUploadData } from '../features/feed/uploadManager';
import { useAuthFlow } from '../features/auth/useAuthFlow';
import {
  getPushPermissionGranted,
  syncPushTokenForCurrentSession,
} from '../features/notifications/pushNotifications';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import type { Database, ProfileRpcRow } from '../types/database';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';

type PrivacyPolicy = 'everyone' | 'friends' | 'none';
type StoryReplyPolicy = 'everyone' | 'followers' | 'off';
type NotificationSettingKey =
  | 'push_enabled'
  | 'notify_likes'
  | 'notify_comments'
  | 'notify_followers'
  | 'notify_messages'
  | 'notify_live'
  | 'show_online_status';

type SettingsValues = {
  push_enabled: boolean;
  notify_likes: boolean;
  notify_comments: boolean;
  notify_followers: boolean;
  notify_messages: boolean;
  notify_live: boolean;
  show_online_status: boolean;
  show_liked_videos: boolean;
  personalized_recommendations: boolean;
  story_replies: StoryReplyPolicy;
};

const defaultSettings: SettingsValues = {
  push_enabled: true,
  notify_likes: true,
  notify_comments: true,
  notify_followers: true,
  notify_messages: true,
  notify_live: true,
  show_online_status: true,
  show_liked_videos: false,
  personalized_recommendations: true,
  story_replies: 'everyone',
};

const messagePolicies: { value: PrivacyPolicy; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'none', label: 'No one' },
];

async function errorMessage(error: unknown) {
  return getErrorMessage(error, 'Try again.');
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<ProfileRpcRow | null>(null);
  const [email, setEmail] = useState('');
  const [settings, setSettings] = useState<SettingsValues>(defaultSettings);
  const [isMinor, setIsMinor] = useState(false);
  const [pushPermissionGranted, setPushPermissionGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [storyRepliesOpen, setStoryRepliesOpen] = useState(false);
  const [mutedTargetsOpen, setMutedTargetsOpen] = useState(false);
  const [dialog, setDialog] = useState<'logout' | 'delete' | null>(null);
  const [typedUsername, setTypedUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const followRequestCount = useFollowRequestCount(profile !== null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = getSupabaseClient();
        const { data: authResult, error: authError } = await client.auth.getSession();
        if (authError) throw authError;
        const user = authResult.session?.user;
        if (!user) throw new Error('Sign in to open settings.');
        const [profileResult, settingsResult, birthResult] = await Promise.all([
          client.rpc('get_profile', { p_username: null }),
          client.from('user_settings')
            .select('push_enabled,notify_likes,notify_comments,notify_followers,notify_messages,notify_live,show_online_status,show_liked_videos,personalized_recommendations,story_replies')
            .eq('user_id', user.id)
            .maybeSingle(),
          client.from('profiles').select('date_of_birth').eq('id', user.id).maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (settingsResult.error) throw settingsResult.error;
        if (birthResult.error) throw birthResult.error;
        const currentProfile = profileResult.data?.[0];
        if (!currentProfile) throw new Error('Your profile could not be found.');
        if (!active) return;
        setProfile(currentProfile);
        setEmail(user.email ?? '');
        if (settingsResult.data) setSettings({ ...defaultSettings, ...settingsResult.data });
        if (birthResult.data) {
          const today = new Date();
          const birthday = new Date(`${birthResult.data.date_of_birth}T00:00:00`);
          let age = today.getFullYear() - birthday.getFullYear();
          if (
            today.getMonth() < birthday.getMonth()
            || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())
          ) age -= 1;
          setIsMinor(age < 18);
        }
      } catch (caught) {
        if (active) setError(await errorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refreshPermission = () => {
      void getPushPermissionGranted()
        .then(setPushPermissionGranted)
        .catch(async (caught: unknown) => {
          setError(`Could not check notification permission. ${await errorMessage(caught)}`);
        });
    };
    refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission();
    });
    return () => subscription.remove();
  }, []);

  const persistNotification = async (key: NotificationSettingKey, value: boolean) => {
    if (saving || !profile) return;
    if (key === 'show_online_status' && isMinor) {
      Alert.alert('Accounts under 18 stay private.');
      return;
    }
    const previous = settings[key];
    setSettings((current) => ({ ...current, [key]: value }));
    setError('');
    try {
      const client = getSupabaseClient();
      const update: Database['public']['Tables']['user_settings']['Insert'] = { user_id: profile.id };
      switch (key) {
        case 'push_enabled': update.push_enabled = value; break;
        case 'notify_likes': update.notify_likes = value; break;
        case 'notify_comments': update.notify_comments = value; break;
        case 'notify_followers': update.notify_followers = value; break;
        case 'notify_messages': update.notify_messages = value; break;
        case 'notify_live': update.notify_live = value; break;
        case 'show_online_status': update.show_online_status = value; break;
      }
      const { error: updateError } = await client.from('user_settings').upsert(update, { onConflict: 'user_id' });
      if (updateError) throw updateError;
      if (key === 'push_enabled') {
        try {
          await syncPushTokenForCurrentSession(value);
          if (value) setPushPermissionGranted(true);
        } catch (registrationError) {
          const { error: rollbackError } = await client.from('user_settings')
            .upsert({ user_id: profile.id, push_enabled: previous }, { onConflict: 'user_id' });
          if (rollbackError) {
            throw new Error(
              `Push setup failed (${await errorMessage(registrationError)}); `
              + `the setting could not be restored (${rollbackError.message}).`,
            );
          }
          throw registrationError;
        }
      }
    } catch (caught) {
      setSettings((current) => ({ ...current, [key]: previous }));
      setError(`Could not save setting. ${await errorMessage(caught)}`);
    }
  };

  const persistPreference = async (
    key: 'show_liked_videos' | 'personalized_recommendations',
    value: boolean,
  ) => {
    if (!profile) return;
    const previous = settings[key];
    setSettings((current) => ({ ...current, [key]: value }));
    setError('');
    try {
      const client = getSupabaseClient();
      const { error: saveError } = key === 'show_liked_videos'
        ? await client.from('user_settings').upsert(
          { user_id: profile.id, show_liked_videos: value },
          { onConflict: 'user_id' },
        )
        : await client.from('user_settings').upsert(
          { user_id: profile.id, personalized_recommendations: value },
          { onConflict: 'user_id' },
        );
      if (saveError) throw saveError;
    } catch (caught) {
      setSettings((current) => ({ ...current, [key]: previous }));
      setError(`Could not save setting. ${await errorMessage(caught)}`);
    }
  };

  const persistPrivacy = async (value: boolean) => {
    if (!profile) return;
    setError('');
    try {
      const { error: updateError } = await getSupabaseClient().rpc('set_account_privacy', { p_is_private: value });
      if (updateError) throw updateError;
      setProfile((current) => current ? { ...current, is_private: value } : current);
    } catch (caught) {
      const message = await errorMessage(caught);
      if (message.includes('Accounts under 18 stay private')) Alert.alert('Accounts under 18 stay private.');
      else setError(`Could not update account privacy. ${message}`);
    }
  };

  const persistMessagePolicy = async (value: PrivacyPolicy) => {
    if (!profile) return;
    setPolicyOpen(false);
    setError('');
    try {
      const { error: updateError } = await getSupabaseClient().from('profiles')
        .update({ dm_policy: value })
        .eq('id', profile.id);
      if (updateError) throw updateError;
      setProfile((current) => current ? { ...current, dm_policy: value } : current);
    } catch (caught) {
      setError(`Could not update who can message you. ${await errorMessage(caught)}`);
    }
  };

  const persistStoryReplyPolicy = async (value: StoryReplyPolicy) => {
    setStoryRepliesOpen(false);
    if (!profile) return;
    const safeValue = isMinor ? 'followers' : value;
    const previous = settings.story_replies;
    setSettings((current) => ({ ...current, story_replies: safeValue }));
    setError('');
    try {
      const { error: saveError } = await getSupabaseClient().from('user_settings').upsert(
        { user_id: profile.id, story_replies: safeValue },
        { onConflict: 'user_id' },
      );
      if (saveError) throw saveError;
    } catch (caught) {
      setSettings((current) => ({ ...current, story_replies: previous }));
      setError(`Could not save who can reply to your stories. ${await errorMessage(caught)}`);
    }
  };

  const logOut = async () => {
    setDialog(null);
    try {
      await signOutProviders();
      useAuthFlow.getState().resetSignup();
      router.replace('/(auth)/welcome');
    } catch (caught) {
      setError(`Unable to log out. ${await errorMessage(caught)}`);
    }
  };

  const deleteAccount = async () => {
    if (!profile || typedUsername.trim().toLowerCase() !== profile.username.toLowerCase()) return;
    setSaving(true);
    setError('');
    try {
      assertNoActiveVideoUploads(profile.id);
      const { error: deleteError } = await getSupabaseClient().functions.invoke('delete-own-account');
      if (deleteError) throw deleteError;
      try {
        await clearLocalUploadData(profile.id);
      } catch (cleanupError) {
        console.error('The account was deleted, but local upload data could not be fully cleared.', cleanupError);
        Alert.alert('Account deleted', 'Some temporary upload files could not be removed from this device.');
      }
      queryClient.clear();
      await signOutProviders({ localOnly: true });
      useAuthFlow.getState().resetSignup();
      router.replace('/(auth)/welcome');
    } catch (caught) {
      setError(`Unable to delete account. ${await errorMessage(caught)}`);
    } finally {
      setSaving(false);
    }
  };

  const messagePolicyLabel = messagePolicies.find((item) => item.value === profile?.dm_policy)?.label ?? 'Everyone';

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  if (!profile) {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error || 'Your profile could not be found.'}</Text></View>;
  }

  const renderRow = (
    label: string,
    icon: AppIconName,
    trailing: React.ReactNode,
    onPress?: () => void,
    disabled = false,
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={!onPress || disabled}
      style={[styles.row, disabled && styles.disabledRow]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.rowMain}>
        <View style={styles.iconWrap}><Icon name={icon} size={20} color={theme.colors.primary} /></View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {trailing}
    </Pressable>
  );

  const renderSwitch = (value: boolean, onValueChange: (next: boolean) => void, disabled = false) => (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: '#374151', true: theme.colors.success }}
      thumbColor={theme.colors.white}
    />
  );

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerButton} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.errorBanner}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Account</Text>
        {renderRow('Edit profile', 'user', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/profile/edit'))}
        {renderRow('Email', 'globe', <Text style={styles.valueText}>{email}</Text>)}

        <Text style={styles.sectionTitle}>Privacy</Text>
        {renderRow('Private account', 'shield', renderSwitch(profile.is_private, (value) => void persistPrivacy(value)), undefined, saving)}
        {renderRow('Who can message me', 'message', <View style={styles.valueWrap}><Text style={styles.valueText}>{messagePolicyLabel}</Text><Icon name="chevronRight" size={20} color={theme.colors.textMuted} /></View>, () => setPolicyOpen(true))}
        {renderRow('Close friends', 'groups', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/close-friends'))}
        {renderRow(
          'Who can reply to my stories',
          'message',
          <View style={styles.valueWrap}>
            <Text style={styles.valueText}>{isMinor ? 'Followers' : settings.story_replies[0].toUpperCase() + settings.story_replies.slice(1)}</Text>
            <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
          </View>,
          () => setStoryRepliesOpen(true),
        )}
        {renderRow('Show my online status', 'eye', renderSwitch(settings.show_online_status, (value) => void persistNotification('show_online_status', value), isMinor), undefined, isMinor)}
        {isMinor
          ? renderRow('Teen safety', 'shield', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/teen-safety'))
          : null}
        {renderRow('Show my liked videos', 'heart', renderSwitch(settings.show_liked_videos, (value) => void persistPreference('show_liked_videos', value)))}
        {renderRow('Follow requests', 'user', <View style={styles.valueWrap}>{followRequestCount > 0 ? <Text style={styles.badgeText}>{followRequestCount}</Text> : null}<Icon name="chevronRight" size={20} color={theme.colors.textMuted} /></View>, () => router.push('/follow-requests'))}
        {renderRow('Blocked users', 'ban', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/blocked-users'))}
        {renderRow('Comment controls', 'message', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/comment-controls'))}
        {renderRow('Hidden comments', 'eye', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/hidden-comments'))}
        {renderRow('Content review and appeals', 'shield', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => router.push('/moderation-review'))}
        <Text style={styles.disclosure}>Comment text, post captions, and available thumbnails may be sent to OpenRouter and routed model providers for automated safety review. If you enable automatic captions, your video is also sent for transcription. Provider processing and retention are subject to their policies.</Text>
        {renderRow('Personalized recommendations', 'sparkles', renderSwitch(settings.personalized_recommendations, (value) => void persistPreference('personalized_recommendations', value)))}

        <Text style={styles.sectionTitle}>Notifications</Text>
        {renderRow('Push notifications', 'bell', renderSwitch(settings.push_enabled && pushPermissionGranted, (value) => void persistNotification('push_enabled', value)))}
        {renderRow('Likes', 'heart', renderSwitch(settings.notify_likes, (value) => void persistNotification('notify_likes', value)))}
        {renderRow('Comments', 'comment', renderSwitch(settings.notify_comments, (value) => void persistNotification('notify_comments', value)))}
        {renderRow('New followers', 'user', renderSwitch(settings.notify_followers, (value) => void persistNotification('notify_followers', value)))}
        {renderRow('Messages', 'chats', renderSwitch(settings.notify_messages, (value) => void persistNotification('notify_messages', value)))}
        {renderRow('Live from people I follow', 'live', renderSwitch(settings.notify_live, (value) => void persistNotification('notify_live', value)))}
        {renderRow('Muted', 'bell', <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />, () => setMutedTargetsOpen(true))}

        <Text style={styles.sectionTitle}>About</Text>
        {renderRow('App version', 'info', <Text style={styles.valueText}>1.0.2</Text>)}

        <Pressable style={styles.signoutRow} onPress={() => setDialog('logout')} accessibilityRole="button">
          <View style={styles.rowMain}><View style={styles.iconWrap}><Icon name="logOut" size={20} color={theme.colors.white} /></View><Text style={styles.logoutText}>Log out</Text></View>
        </Pressable>
        <Pressable style={styles.deleteRow} onPress={() => { setTypedUsername(''); setDialog('delete'); }} accessibilityRole="button">
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent animationType="slide" visible={policyOpen} onRequestClose={() => setPolicyOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPolicyOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Who can message me</Text>
          {messagePolicies.map((item) => (
            <Pressable key={item.value} style={styles.sheetRow} onPress={() => void persistMessagePolicy(item.value)}>
              <Text style={styles.sheetRowLabel}>{item.label}</Text>
              {profile.dm_policy === item.value ? <Icon name="check" size={20} color={theme.colors.primary} /> : null}
            </Pressable>
          ))}
          <Pressable style={styles.sheetCancel} onPress={() => setPolicyOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={storyRepliesOpen} onRequestClose={() => setStoryRepliesOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setStoryRepliesOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Who can reply to my stories</Text>
          {(isMinor ? [{ value: 'followers' as const, label: 'Followers' }] : [
            { value: 'everyone' as const, label: 'Everyone' },
            { value: 'followers' as const, label: 'Followers' },
            { value: 'off' as const, label: 'Off' },
          ]).map((item) => (
            <Pressable key={item.value} style={styles.sheetRow} onPress={() => void persistStoryReplyPolicy(item.value)}>
              <Text style={styles.sheetRowLabel}>{item.label}</Text>
              {settings.story_replies === item.value ? <Icon name="check" size={20} color={theme.colors.primary} /> : null}
            </Pressable>
          ))}
          <Pressable style={styles.sheetCancel} onPress={() => setStoryRepliesOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </View>
      </Modal>

      <MutedTargetsSheet visible={mutedTargetsOpen} onClose={() => setMutedTargetsOpen(false)} />

      <Modal transparent animationType="slide" visible={dialog !== null} onRequestClose={() => setDialog(null)}>
        <KeyboardAwareScreen style={{ flex: 1 }}>
          <Pressable style={styles.modalOverlay} onPress={() => setDialog(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{dialog === 'logout' ? 'Log out' : 'Delete account'}</Text>
            {dialog === 'logout' ? <Text style={styles.sheetCopy}>Are you sure you want to log out?</Text> : (
              <>
                <Text style={styles.sheetCopy}>Type your username to confirm.</Text>
                <FocusableTextInput
                  value={typedUsername}
                  onChangeText={setTypedUsername}
                  style={styles.input}
                  placeholder={profile.username}
                  placeholderTextColor={theme.colors.textMuted}
                  autoCapitalize="none"
                  accessibilityLabel="Type your username to confirm"
                />
              </>
            )}
            <Pressable
              style={[
                styles.confirmButton,
                dialog === 'delete' && styles.deleteConfirmButton,
                dialog === 'delete' && typedUsername.trim().toLowerCase() !== profile.username.toLowerCase() && styles.disabledConfirm,
              ]}
              onPress={() => dialog === 'logout' ? void logOut() : void deleteAccount()}
              disabled={saving || (dialog === 'delete' && typedUsername.trim().toLowerCase() !== profile.username.toLowerCase())}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color={theme.colors.white} /> : <Text style={styles.confirmText}>{dialog === 'logout' ? 'Log out' : 'Delete account'}</Text>}
            </Pressable>
            <Pressable style={styles.sheetCancel} onPress={() => setDialog(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  headerButton: { width: 42, height: 42, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 22, marginBottom: 10, marginLeft: 5 },
  disclosure: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginHorizontal: 5, marginBottom: 8 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: theme.colors.surface, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  disabledRow: { opacity: 0.72 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#171C22' },
  rowLabel: { flexShrink: 1, color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  valueText: { color: theme.colors.textMuted, fontSize: 12 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeText: { overflow: 'hidden', color: theme.colors.black, fontSize: 11, fontWeight: '800', backgroundColor: theme.colors.primary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  signoutRow: { minHeight: 62, justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, marginTop: 20 },
  logoutText: { color: theme.colors.white, fontWeight: '700' },
  deleteRow: { minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 5 },
  deleteText: { color: theme.colors.danger, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black, padding: 24 },
  error: { color: theme.colors.danger, textAlign: 'center' },
  errorBanner: { color: theme.colors.danger, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  modalOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, paddingBottom: 26, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.colors.surface },
  sheetTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800', paddingVertical: 8 },
  sheetCopy: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, paddingBottom: 14 },
  sheetRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  sheetRowLabel: { color: theme.colors.white, fontSize: 14, fontWeight: '600' },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, color: theme.colors.white, backgroundColor: theme.colors.black, marginBottom: 14 },
  confirmButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.colors.primary },
  deleteConfirmButton: { backgroundColor: theme.colors.danger },
  disabledConfirm: { opacity: 0.4 },
  confirmText: { color: theme.colors.white, fontSize: 14, fontWeight: '800' },
  sheetCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.textMuted, fontWeight: '700' },
});
