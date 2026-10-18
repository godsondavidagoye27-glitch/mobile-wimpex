import { describe, expect, it, vi } from 'vitest';
import { getErrorMessage } from './errorMessage';

describe('getErrorMessage', () => {
  it('reads messages from plain error objects', async () => {
    await expect(getErrorMessage({ message: 'PostgREST rejected the query.' }, 'Try again.'))
      .resolves.toBe('PostgREST rejected the query.');
  });

  it('extracts the error from FunctionsHttpError response JSON', async () => {
    await expect(getErrorMessage({
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: { json: async () => ({ error: 'The live service is not configured on the server.' }) },
    }, 'Try again.')).resolves.toBe('The live service is not configured on the server.');
  });

  it('maps missing RPC functions to the app-update message', async () => {
    await expect(getErrorMessage({
      code: 'PGRST202',
      message: 'Could not find the function public.start_live in the schema cache',
    }, 'Try again.')).resolves.toBe("This feature isn't available yet. Update the app and try again.");
  });

  it('maps network failures and uses the fallback when no message exists', async () => {
    await expect(getErrorMessage({ message: 'Network request failed' }, 'Try again.'))
      .resolves.toBe('Check your connection and try again.');
    await expect(getErrorMessage({}, 'Try again.')).resolves.toBe('Try again.');
  });

  it('logs a response parsing failure and keeps the original function message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(getErrorMessage({
      name: 'FunctionsHttpError',
      message: 'Function request failed.',
      context: { json: async () => { throw new Error('invalid JSON'); } },
    }, 'Try again.')).resolves.toBe('Function request failed.');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
