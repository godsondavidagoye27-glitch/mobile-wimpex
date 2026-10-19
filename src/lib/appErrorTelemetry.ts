import { secureStorage } from './storage';

export function persistAppError(error: Error, componentStack: string, retried: boolean) {
  const payload = JSON.stringify({
    message: error.message,
    stack: error.stack ?? '',
    componentStack,
    occurredAt: new Date().toISOString(),
    retried,
  });
  void secureStorage.setItem('wimpex-last-app-error', payload).catch((storageError: unknown) => {
    console.error('Unable to persist the last uncaught app error.', storageError);
  });
}
