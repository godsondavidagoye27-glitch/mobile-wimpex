export type CallLifecycleStatus = 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';

export type StaleCallCandidate = {
  status: CallLifecycleStatus;
  created_at: string;
  expires_at: string;
  last_activity_at: string | null;
};

export function getStaleCallTerminalStatus(
  call: StaleCallCandidate,
  now = Date.now(),
): 'ended' | 'missed' | null {
  if (call.status === 'ringing') {
    return Date.parse(call.expires_at) <= now ? 'missed' : null;
  }
  if (call.status === 'connecting') {
    const lastActivity = Date.parse(call.last_activity_at ?? call.created_at);
    return now - lastActivity >= 60_000 ? 'ended' : null;
  }
  if (call.status === 'active') {
    const lastActivity = Date.parse(call.last_activity_at ?? call.created_at);
    return now - lastActivity >= 90_000 ? 'ended' : null;
  }
  return null;
}
