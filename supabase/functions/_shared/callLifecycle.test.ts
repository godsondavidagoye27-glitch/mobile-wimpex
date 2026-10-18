import { describe, expect, it } from 'vitest';
import { getStaleCallTerminalStatus } from './callLifecycle';

const now = Date.parse('2026-10-18T12:00:00.000Z');

describe('stale call lifecycle', () => {
  it('marks expired ringing calls missed', () => {
    expect(getStaleCallTerminalStatus({
      status: 'ringing',
      created_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now - 1).toISOString(),
      last_activity_at: null,
    }, now)).toBe('missed');
  });

  it('bounds connecting and active calls without recent activity', () => {
    const base = {
      created_at: new Date(now - 100_000).toISOString(),
      expires_at: new Date(now + 45_000).toISOString(),
      last_activity_at: new Date(now - 100_000).toISOString(),
    };
    expect(getStaleCallTerminalStatus({ ...base, status: 'connecting' }, now)).toBe('ended');
    expect(getStaleCallTerminalStatus({ ...base, status: 'active' }, now)).toBe('ended');
  });

  it('keeps a call live while recent activity or its ring window remains', () => {
    expect(getStaleCallTerminalStatus({
      status: 'active',
      created_at: new Date(now - 200_000).toISOString(),
      expires_at: new Date(now + 45_000).toISOString(),
      last_activity_at: new Date(now - 20_000).toISOString(),
    }, now)).toBeNull();
    expect(getStaleCallTerminalStatus({
      status: 'ringing',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 45_000).toISOString(),
      last_activity_at: null,
    }, now)).toBeNull();
  });
});
