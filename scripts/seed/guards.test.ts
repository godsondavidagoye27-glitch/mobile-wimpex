import { describe, expect, it } from 'vitest';
import {
  assertProjectRefConfirmation,
  assertSeedAllowed,
  getProjectRef,
  parseMeEmail,
  readSeedEnvironment,
} from './guards';

describe('seed safety guards', () => {
  it('refuses to run unless SEED_ALLOWED is exactly true', () => {
    expect(() => assertSeedAllowed(undefined)).toThrow('SEED_ALLOWED=true');
    expect(() => assertSeedAllowed('false')).toThrow('SEED_ALLOWED=true');
    expect(() => assertSeedAllowed('true')).not.toThrow();
  });

  it('requires the exact project ref typed by the operator', () => {
    expect(() => assertProjectRefConfirmation('wrong-ref', 'project-ref')).toThrow('did not match');
    expect(() => assertProjectRefConfirmation(' project-ref ', 'project-ref')).not.toThrow();
  });

  it('parses values and comments from .env.seed', () => {
    expect(readSeedEnvironment('# note\nSUPABASE_URL="https://abc123.supabase.co"\nDEMO_PASSWORD=secret'))
      .toEqual({ SUPABASE_URL: 'https://abc123.supabase.co', DEMO_PASSWORD: 'secret' });
  });

  it('extracts the project ref only from a project-specific Supabase host', () => {
    expect(getProjectRef('https://abc123.supabase.co')).toBe('abc123');
    expect(() => getProjectRef('http://localhost:54321')).toThrow('HTTPS');
    expect(() => getProjectRef('http://abc123.supabase.co')).toThrow('HTTPS');
  });

  it('parses and validates the optional real-account email', () => {
    expect(parseMeEmail(['--me', 'person@example.test'])).toBe('person@example.test');
    expect(() => parseMeEmail(['--me'])).toThrow('email address');
  });
});
