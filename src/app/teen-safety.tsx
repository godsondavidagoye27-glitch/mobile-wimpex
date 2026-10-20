import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { FocusableTextInput } from '../components/AuthField';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { getSupabaseClient } from '../lib/supabase';
import { publishTeenReminderSettings } from '../features/privacy/teenReminderSettings';
import { theme } from '../theme/theme';
import { KeyboardAwareScreen } from '../hooks/useKeyboardInset';
export { RouteErrorFallback as ErrorBoundary } from '../components/RouteErrorFallback';

type TeenSafetySettings = {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  daily_reminder_minutes: number | null;
  hide_restricted_content: boolean;
  time_zone: string;
};

const reminderOptions: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '1 hour 30 minutes', value: 90 },
  { label: '2 hours', value: 120 },
];

function isUnder18(dateOfBirth: string) {
  const birthday = new Date(`${dateOfBirth}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  if (today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())) age -= 1;
  return age < 18;
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export default function TeenSafetyScreen() {
  const [settings, setSettings] = useState<TeenSafetySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reminderOpen, setReminderOpen] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (!user) throw new Error('Sign in to open Teen safety settings.');
        if (!active) return;
        setOwnerId(user.id);
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('date_of_birth')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;
        if (!profile || !isUnder18(profile.date_of_birth)) {
          throw new Error('Teen safety settings are available only to people under 18.');
        }
        const { data, error: settingsError } = await client.rpc('get_my_teen_safety_settings');
        if (settingsError) throw settingsError;
        if (active) {
          const settingsValue = data[0] ?? null;
          setSettings(settingsValue);
          if (settingsValue) {
            publishTeenReminderSettings({
              userId: user.id,
              reminderMinutes: settingsValue.daily_reminder_minutes,
            });
          }
        }
      } catch (caught) {
        if (active) setError(await getErrorMessage(caught, 'Could not load Teen safety settings.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: TeenSafetySettings) => {
    if (!settings || saving) return;
    const previous = settings;
    setSettings(next);
    setSaving(true);
    setError('');
    try {
      const { data, error: saveError } = await getSupabaseClient().rpc('update_my_teen_safety_settings', {
        p_quiet_hours_enabled: next.quiet_hours_enabled,
        p_quiet_hours_start: next.quiet_hours_start,
        p_quiet_hours_end: next.quiet_hours_end,
        p_daily_reminder_minutes: next.daily_reminder_minutes,
        p_hide_restricted_content: next.hide_restricted_content,
        p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || next.time_zone,
      });
      if (saveError) throw saveError;
      const updated = data[0] ?? next;
      setSettings(updated);
      if (ownerId) {
        publishTeenReminderSettings({
          userId: ownerId,
          reminderMinutes: updated.daily_reminder_minutes,
        });
      }
    } catch (caught) {
      setSettings(previous);
      setError(`Could not save Teen safety settings. ${await getErrorMessage(caught, 'Try again.')}`);
    } finally {
      setSaving(false);
    }
  };

  const saveQuietTime = (field: 'quiet_hours_start' | 'quiet_hours_end', value: string) => {
    if (!settings) return;
    const normalized = value.trim();
    if (!validTime(normalized)) {
      setError('Enter a time in 24-hour format, for example 22:00.');
      return;
    }
    setError('');
    void persist({ ...settings, [field]: normalized.length === 5 ? `${normalized}:00` : normalized });
  };

  const reminderLabel = reminderOptions.find((option) => option.value === settings?.daily_reminder_minutes)?.label ?? 'Off';

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <KeyboardAwareScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Teen safety</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!settings ? (
          <Text style={styles.description}>Teen safety settings could not be loaded.</Text>
        ) : (
          <>
            <Text style={styles.description}>
              These protections are checked by Wimpex servers. Your account remains private while you are under 18.
            </Text>
            <View style={styles.lockedCard}>
              <Text style={styles.rowTitle}>Direct messages</Text>
              <Text style={styles.description}>Only mutual accepted followers can start a conversation with you.</Text>
            </View>
            <View style={styles.lockedCard}>
              <Text style={styles.rowTitle}>Suggestions and Explore</Text>
              <Text style={styles.description}>Your profile is excluded from people suggestions and public Explore results.</Text>
            </View>
            <View style={styles.lockedCard}>
              <Text style={styles.rowTitle}>Location</Text>
              <Text style={styles.description}>Wimpex does not collect device location for this account.</Text>
            </View>

            <View style={styles.settingCard}>
              <View style={styles.settingHeader}>
                <View style={styles.settingCopy}>
                  <Text style={styles.rowTitle}>Quiet hours</Text>
                  <Text style={styles.description}>Pause chat and call push notifications during your local quiet hours.</Text>
                </View>
                <Switch
                  value={settings.quiet_hours_enabled}
                  disabled={saving}
                  onValueChange={(enabled) => void persist({ ...settings, quiet_hours_enabled: enabled })}
                  trackColor={{ false: theme.colors.line, true: theme.colors.success }}
                />
              </View>
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Start</Text>
                  <FocusableTextInput
                    defaultValue={settings.quiet_hours_start.slice(0, 5)}
                    onEndEditing={(event) => saveQuietTime('quiet_hours_start', event.nativeEvent.text)}
                    style={styles.timeInput}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    editable={!saving && settings.quiet_hours_enabled}
                    accessibilityLabel="Quiet hours start time"
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>End</Text>
                  <FocusableTextInput
                    defaultValue={settings.quiet_hours_end.slice(0, 5)}
                    onEndEditing={(event) => saveQuietTime('quiet_hours_end', event.nativeEvent.text)}
                    style={styles.timeInput}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    editable={!saving && settings.quiet_hours_enabled}
                    accessibilityLabel="Quiet hours end time"
                  />
                </View>
              </View>
              <Text style={styles.helper}>Time zone: {settings.time_zone}</Text>
            </View>

            <Pressable
              onPress={() => setReminderOpen(true)}
              style={styles.settingCard}
              accessibilityRole="button"
              disabled={saving}
            >
              <View style={styles.settingHeader}>
                <View style={styles.settingCopy}>
                  <Text style={styles.rowTitle}>Daily time reminder</Text>
                  <Text style={styles.description}>A private, on-device reminder after your chosen daily app-use time.</Text>
                </View>
                <Text style={styles.choice}>{reminderLabel}</Text>
              </View>
            </Pressable>

            <View style={styles.settingCard}>
              <View style={styles.settingHeader}>
                <View style={styles.settingCopy}>
                  <Text style={styles.rowTitle}>Restricted content</Text>
                  <Text style={styles.description}>Hide posts flagged for nudity or violence from your feed and search.</Text>
                </View>
                <Switch
                  value={settings.hide_restricted_content}
                  disabled={saving}
                  onValueChange={(enabled) => void persist({ ...settings, hide_restricted_content: enabled })}
                  trackColor={{ false: theme.colors.line, true: theme.colors.success }}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <Modal transparent animationType="slide" visible={reminderOpen} onRequestClose={() => setReminderOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setReminderOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Daily time reminder</Text>
          {reminderOptions.map((option) => (
            <Pressable
              key={String(option.value)}
              style={styles.option}
              onPress={() => {
                setReminderOpen(false);
                if (settings) void persist({ ...settings, daily_reminder_minutes: option.value });
              }}
            >
              <Text style={styles.optionLabel}>{option.label}</Text>
              {settings?.daily_reminder_minutes === option.value
                ? <Icon name="check" size={20} color={theme.colors.primary} />
                : null}
            </Pressable>
          ))}
          <Pressable style={styles.cancel} onPress={() => setReminderOpen(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.black },
  header: { minHeight: 62, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  backButton: { width: 42, height: 42, justifyContent: 'center' },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  content: { padding: 16, gap: 12 },
  description: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  helper: { color: theme.colors.textMuted, fontSize: 11, marginTop: 8 },
  error: { color: theme.colors.danger, lineHeight: 20 },
  lockedCard: { padding: 14, borderRadius: 15, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line, gap: 5 },
  settingCard: { padding: 14, borderRadius: 15, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.line },
  settingHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingCopy: { flex: 1, gap: 4 },
  rowTitle: { color: theme.colors.white, fontSize: 15, fontWeight: '700' },
  timeRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  timeField: { flex: 1, gap: 6 },
  fieldLabel: { color: theme.colors.textMuted, fontSize: 12 },
  timeInput: { minHeight: 42, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.colors.black, color: theme.colors.white },
  choice: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: { marginTop: 'auto', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: theme.colors.surface },
  sheetTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  option: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  optionLabel: { color: theme.colors.white, fontSize: 14 },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelText: { color: theme.colors.textMuted, fontWeight: '700' },
});
