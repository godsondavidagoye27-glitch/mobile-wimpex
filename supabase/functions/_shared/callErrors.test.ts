import { describe, expect, it } from 'vitest';
import { getCallErrorDetails, mapCallFailure } from './callErrors';

describe('call failure mapping', () => {
  it('maps undefined call_sessions columns to an actionable schema response', () => {
    expect(mapCallFailure({
      code: '42703',
      message: 'column call_sessions.last_activity_at does not exist',
    })).toEqual({
      status: 503,
      code: 'call_schema_outdated',
      message: 'Calling is being updated. Try again soon.',
    });
  });

  it('maps a missing call_sessions table to an actionable schema response', () => {
    expect(mapCallFailure({
      code: '42P01',
      message: 'relation "public.call_sessions" does not exist',
    }).code).toBe('call_schema_outdated');
  });

  it('does not misclassify unrelated schema errors', () => {
    expect(mapCallFailure({
      code: '42703',
      message: 'column profiles.unknown_field does not exist',
    }).code).toBe('call_server_error');
  });

  it('uses a generic safe response for unexpected errors', () => {
    expect(mapCallFailure({
      code: 'XX000',
      message: 'internal detail must not be returned',
    })).toEqual({
      status: 500,
      code: 'call_server_error',
      message: 'Could not process this call request.',
    });
  });

  it('extracts diagnostic details only for server logs', () => {
    expect(getCallErrorDetails({ code: '42703', message: 'column missing' })).toEqual({
      code: '42703',
      message: 'column missing',
    });
  });
});
