export type NotificationMuteRow = {
  owner_id: string;
  target_type: 'user' | 'community' | 'conversation';
  target_id: string;
  muted_until: string | null;
  mute_calls: boolean;
};

export function isNotificationMuteActive(mutedUntil: string | null, now = Date.now()) {
  if (mutedUntil === null) return true;
  const expiry = Date.parse(mutedUntil);
  return Number.isFinite(expiry) && expiry > now;
}

export function isNotificationTargetMuted(
  mutes: readonly NotificationMuteRow[],
  ownerId: string,
  targetType: NotificationMuteRow['target_type'],
  targetId: string,
  now = Date.now(),
  callsOnly = false,
) {
  return mutes.some((mute) => (
    mute.owner_id === ownerId
    && mute.target_type === targetType
    && mute.target_id === targetId
    && (!callsOnly || mute.mute_calls)
    && isNotificationMuteActive(mute.muted_until, now)
  ));
}
