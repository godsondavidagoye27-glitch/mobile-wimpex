export type FollowStatus = 'none' | 'pending' | 'accepted';
export type FollowAction = 'follow' | 'cancel-request' | 'unfollow';

export function followActionForStatus(status: FollowStatus): FollowAction {
  if (status === 'pending') return 'cancel-request';
  if (status === 'accepted') return 'unfollow';
  return 'follow';
}

export function followStatusAfterAction(
  action: FollowAction,
  serverStatus?: FollowStatus,
): FollowStatus {
  if (action === 'follow') return serverStatus ?? 'accepted';
  return 'none';
}
