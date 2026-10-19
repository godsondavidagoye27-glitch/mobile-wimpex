export type CallFailure = {
  status: 500 | 503;
  code: 'call_server_error' | 'call_schema_outdated';
  message: string;
};

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getCallErrorDetails(error: unknown): { code: string | null; message: string } {
  if (!isRecord(error)) {
    return { code: null, message: typeof error === 'string' ? error : 'Unknown error' };
  }
  return {
    code: stringValue(error.code) || null,
    message: stringValue(error.message) || 'Unknown error',
  };
}

export function mapCallFailure(error: unknown): CallFailure {
  const details = getCallErrorDetails(error);
  const context = isRecord(error) ? `${details.message} ${stringValue(error.details)} ${stringValue(error.hint)}` : details.message;
  if (
    (details.code === '42703' || details.code === '42P01')
    && /call_sessions/i.test(context)
  ) {
    return {
      status: 503,
      code: 'call_schema_outdated',
      message: 'Calling is being updated. Try again soon.',
    };
  }
  return {
    status: 500,
    code: 'call_server_error',
    message: 'Could not process this call request.',
  };
}
