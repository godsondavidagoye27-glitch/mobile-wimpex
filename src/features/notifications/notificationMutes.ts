import { getSupabaseClient } from '../../lib/supabase';

export type NotificationMuteTargetType = 'user' | 'community' | 'conversation';

export const notificationMuteDurations = [
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 480 },
  { label: '1 week', minutes: 10080 },
  { label: 'Until I turn it back on', minutes: null },
] as const;

export async function muteNotificationTarget(
  targetType: NotificationMuteTargetType,
  targetId: string,
  durationMinutes: number | null,
) {
  const { error } = await getSupabaseClient().rpc('mute_notification_target', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
}

export async function unmuteNotificationTarget(
  targetType: NotificationMuteTargetType,
  targetId: string,
) {
  const { error } = await getSupabaseClient().rpc('unmute_notification_target', {
    p_target_type: targetType,
    p_target_id: targetId,
  });
  if (error) throw error;
}

export async function setMutedUserCalls(targetId: string, muteCalls: boolean) {
  const { error } = await getSupabaseClient().rpc('set_muted_user_calls', {
    p_target_id: targetId,
    p_mute_calls: muteCalls,
  });
  if (error) throw error;
}
