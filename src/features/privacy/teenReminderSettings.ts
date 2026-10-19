type ReminderSettingsEvent = { userId: string; reminderMinutes: number | null };
type Listener = (settings: ReminderSettingsEvent) => void;

const listeners = new Set<Listener>();

export function publishTeenReminderSettings(settings: ReminderSettingsEvent) {
  listeners.forEach((listener) => listener(settings));
}

export function subscribeTeenReminderSettings(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
