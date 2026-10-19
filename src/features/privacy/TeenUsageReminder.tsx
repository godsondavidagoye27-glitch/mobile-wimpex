import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { getSupabaseClient } from '../../lib/supabase';
import { preferenceStorage } from '../../lib/storage';
import { addForegroundUsage, isDailyUsageState, type DailyUsageState } from './teenSafetyRules';
import { subscribeTeenReminderSettings } from './teenReminderSettings';

type UsageTracker = {
  userId: string | null;
  reminderMinutes: number | null;
  usage: DailyUsageState | null;
  active: boolean;
  lastRecordedAt: number;
};

function currentLocalDay() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isMinor(dateOfBirth: string) {
  const birthday = new Date(`${dateOfBirth}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  if (today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())) age -= 1;
  return age < 18;
}

export function TeenUsageReminder() {
  const tracker = useRef<UsageTracker>({
    userId: null,
    reminderMinutes: null,
    usage: null,
    active: AppState.currentState === 'active',
    lastRecordedAt: 0,
  });

  useEffect(() => {
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return undefined;
    let mounted = true;
    let authRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const record = async () => {
      const current = tracker.current;
      const now = Date.now();
      const elapsed = current.active ? Math.max(0, now - current.lastRecordedAt) : 0;
      current.lastRecordedAt = now;
      if (!current.userId || current.reminderMinutes === null) return;
      const update = addForegroundUsage(current.usage, elapsed, current.reminderMinutes, currentLocalDay());
      current.usage = update.state;
      try {
        await preferenceStorage.setItem(
          `wimpex:teen-usage:${current.userId}`,
          JSON.stringify(update.state),
        );
      } catch (error) {
        console.error('Unable to persist teen screen-time reminder state.', error);
      }
      if (update.shouldRemind && mounted) {
        Alert.alert(
          'Daily time reminder',
          'You have reached the screen-time reminder you set. Take a break whenever you are ready.',
        );
      }
    };

    const refresh = async () => {
      try {
        const client = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (!user) {
          if (tracker.current.userId) await record();
          tracker.current.userId = null;
          tracker.current.reminderMinutes = null;
          return;
        }
        if (tracker.current.userId !== user.id) {
          if (tracker.current.userId) await record();
          tracker.current.userId = user.id;
          tracker.current.usage = null;
          tracker.current.reminderMinutes = null;
        }
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('date_of_birth')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile || !isMinor(profile.date_of_birth)) {
          tracker.current.reminderMinutes = null;
          tracker.current.userId = null;
          return;
        }
        const { data, error: settingsError } = await client.rpc('get_my_teen_safety_settings');
        if (settingsError) throw settingsError;
        tracker.current.reminderMinutes = data[0]?.daily_reminder_minutes ?? null;
        if (!tracker.current.usage || tracker.current.usage.day !== currentLocalDay()) {
          const serialized = await preferenceStorage.getItem(`wimpex:teen-usage:${user.id}`);
          if (serialized) {
            const parsed: unknown = JSON.parse(serialized);
            if (isDailyUsageState(parsed) && parsed.day === currentLocalDay()) {
              tracker.current.usage = parsed;
            } else {
              tracker.current.usage = null;
            }
          }
        }
        tracker.current.lastRecordedAt = Date.now();
      } catch (error) {
        console.error('Unable to load teen screen-time reminder settings.', error);
      }
    };

    tracker.current.active = AppState.currentState === 'active';
    tracker.current.lastRecordedAt = Date.now();
    void refresh();
    const timer = setInterval(() => {
      void record();
    }, 30_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void record();
        tracker.current.active = false;
      } else {
        tracker.current.active = true;
        tracker.current.lastRecordedAt = Date.now();
        void refresh();
      }
    });
    const unsubscribeSettings = subscribeTeenReminderSettings(({ userId, reminderMinutes }) => {
      if (tracker.current.userId === userId) tracker.current.reminderMinutes = reminderMinutes;
    });

    const authSubscription = getSupabaseClient().auth.onAuthStateChange(() => {
      authRefreshTimer = setTimeout(() => {
        authRefreshTimer = null;
        void refresh();
      }, 0);
    }).data.subscription;

    return () => {
      mounted = false;
      if (authRefreshTimer) clearTimeout(authRefreshTimer);
      clearInterval(timer);
      appStateSubscription.remove();
      authSubscription.unsubscribe();
      unsubscribeSettings();
      void record();
    };
  }, []);

  return null;
}
