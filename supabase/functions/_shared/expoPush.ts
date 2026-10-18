export type ExpoPushMessage = Record<string, unknown> & { to: string };

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export function parseExpoPushTickets(value: unknown): ExpoPushTicket[] | null {
  if (!Array.isArray(value)) return null;
  const tickets: ExpoPushTicket[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !('status' in item)) return null;
    const ticket = item as Record<string, unknown>;
    if (ticket.status !== 'ok' && ticket.status !== 'error') return null;
    const details = ticket.details && typeof ticket.details === 'object' && 'error' in ticket.details
      && typeof ticket.details.error === 'string'
      ? { error: ticket.details.error }
      : undefined;
    tickets.push({
      status: ticket.status,
      ...(typeof ticket.id === 'string' ? { id: ticket.id } : {}),
      ...(typeof ticket.message === 'string' ? { message: ticket.message } : {}),
      ...(details ? { details } : {}),
    });
  }
  return tickets;
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  fetcher: typeof fetch = fetch,
): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    const response = await fetcher('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`Expo Push Service returned HTTP ${response.status}.`);
    const result: unknown = await response.json();
    const data = result && typeof result === 'object' && 'data' in result ? result.data : null;
    const batchTickets = parseExpoPushTickets(data);
    if (!batchTickets || batchTickets.length !== batch.length) {
      throw new Error('Expo Push Service returned an invalid ticket response.');
    }
    tickets.push(...batchTickets);
  }
  return tickets;
}
