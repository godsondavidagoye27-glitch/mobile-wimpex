type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function getString(record: ErrorRecord, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] as string : null;
}

function friendlyMessage(message: string, code: string | null, fallback: string): string {
  if (
    code === 'PGRST202'
    || code === '42883'
    || /could not find (?:the )?function .*schema cache|function .* does not exist/i.test(message)
  ) {
    return "This feature isn't available yet. Update the app and try again.";
  }
  if (/network request failed|failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return 'Check your connection and try again.';
  }
  return message || fallback;
}

export async function getErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!isRecord(error)) return fallback;

  const context = error.context;
  if (
    getString(error, 'name') === 'FunctionsHttpError'
    && isRecord(context)
    && typeof context.json === 'function'
  ) {
    try {
      const body: unknown = await (context.json as () => Promise<unknown>)();
      if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) {
        return friendlyMessage(body.error, getString(body, 'code'), fallback);
      }
    } catch (parseError) {
      console.error('Unable to read the function error response body.', parseError);
    }
  }

  const message = getString(error, 'message') ?? '';
  return friendlyMessage(message, getString(error, 'code'), fallback);
}
