import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { secureStorage } from '../../lib/storage';
import { getSupabaseClient } from '../../lib/supabase';

const installationKey = 'wimpex-push-installation-id';
let installationIdPromise: Promise<string> | undefined;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function getInstallationId() {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const existingId = await secureStorage.getItem(installationKey);
      if (existingId) return existingId;
      const installationId = Crypto.randomUUID();
      await secureStorage.setItem(installationKey, installationId);
      return installationId;
    })().catch((error: unknown) => {
      installationIdPromise = undefined;
      throw error;
    });
  }
  return installationIdPromise;
}

async function getCurrentUserId() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) return null;
  return data.user.id;
}

async function removeCurrentInstallationToken(userId: string) {
  const installationId = await secureStorage.getItem(installationKey);
  if (!installationId) return;
  const { error } = await getSupabaseClient()
    .from('device_push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('installation_id', installationId);
  if (error) throw error;
}

async function registerCurrentInstallationToken(userId: string) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Push notifications are available in iOS and Android builds only.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Notification permission was not granted. Enable it in device settings to receive pushes.');
  }

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('The EAS project ID is missing; push token registration is unavailable.');
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const installationId = await getInstallationId();
  const client = getSupabaseClient();
  const activeUserId = await getCurrentUserId();
  if (activeUserId !== userId) {
    throw new Error('Your sign-in changed before the push token could be saved. Try again.');
  }

  const { error } = await client.from('device_push_tokens').upsert({
    user_id: userId,
    installation_id: installationId,
    expo_push_token: token.data,
    platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,installation_id' });
  if (error) throw error;
}

export async function syncPushTokenForCurrentSession(requestPermission = false) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const client = getSupabaseClient();
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { data: settings, error: settingsError } = await client
    .from('user_settings')
    .select('push_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (settings && !settings.push_enabled) {
    await removeCurrentInstallationToken(userId);
    return;
  }

  if (requestPermission) {
    await registerCurrentInstallationToken(userId);
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) {
    await registerCurrentInstallationToken(userId);
  } else {
    await removeCurrentInstallationToken(userId);
  }
}

export async function getPushPermissionGranted() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function unregisterPushTokenBeforeSignOut() {
  const userId = await getCurrentUserId();
  if (userId) await removeCurrentInstallationToken(userId);
}
