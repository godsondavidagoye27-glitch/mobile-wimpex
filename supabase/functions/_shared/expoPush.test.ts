import { describe, expect, it, vi } from 'vitest';
import { parseExpoPushTickets, sendExpoPushMessages } from './expoPush';

describe('Expo push delivery helper', () => {
  it('parses successful and stale-device tickets', () => {
    expect(parseExpoPushTickets([
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])).toEqual([
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);
  });

  it('rejects malformed or incomplete ticket results', async () => {
    expect(parseExpoPushTickets([{ status: 'unknown' }])).toBeNull();
    await expect(sendExpoPushMessages([{ to: 'token' }], vi.fn(async () => new Response(
      JSON.stringify({ data: [] }),
      { status: 200 },
    )))).rejects.toThrow('invalid ticket response');
  });

  it('sends batches of at most 100 and keeps ticket order', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { to: string }[];
      return new Response(JSON.stringify({
        data: batch.map((message) => ({ status: 'ok', id: message.to })),
      }), { status: 200 });
    });
    const messages = Array.from({ length: 101 }, (_, index) => ({ to: `token-${index}` }));

    const tickets = await sendExpoPushMessages(messages, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(101);
    expect(tickets[100]?.id).toBe('token-100');
  });
});
