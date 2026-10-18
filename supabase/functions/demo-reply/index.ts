import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';

const replyLines = [
  'That sounds good. How did it go?',
  'Nice, I will have to try that too.',
  'Thanks for telling me. Are you free this weekend?',
  'I have been meaning to catch up. What are you up to later?',
  'That made me smile. Hope the rest of your day goes well.',
  'Good idea. Let me know what you think when you try it.',
];

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const expectedSecret = Deno.env.get('DEMO_REPLY_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.error('DEMO_REPLY_WEBHOOK_SECRET is not configured.');
    return jsonResponse(503, { error: 'Demo replies are not configured.' });
  }
  if (!constantTimeEquals(request.headers.get('x-webhook-secret'), expectedSecret)) {
    return jsonResponse(401, { error: 'Unauthorized webhook.' });
  }
  if (Deno.env.get('DEMO_MODE') !== 'true') {
    return jsonResponse(200, { skipped: 'Demo mode is disabled.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('The demo-reply function is missing its Supabase service configuration.');
    return jsonResponse(503, { error: 'Demo replies are not configured.' });
  }

  try {
    const payload = await request.json();
    if (
      payload?.type !== 'INSERT'
      || payload?.table !== 'messages'
      || payload?.schema !== 'public'
      || typeof payload?.record?.id !== 'string'
      || typeof payload?.record?.conversation_id !== 'string'
      || typeof payload?.record?.sender_id !== 'string'
    ) {
      return jsonResponse(400, { error: 'Invalid messages webhook payload.' });
    }

    const message = payload.record;
    if (message.kind !== 'text' || typeof message.body !== 'string' || !message.body.trim()) {
      return jsonResponse(200, { skipped: 'Only text messages receive demo replies.' });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sender, error: senderError } = await serviceClient
      .from('profiles')
      .select('is_demo')
      .eq('id', message.sender_id)
      .maybeSingle();
    if (senderError) throw senderError;
    if (!sender || sender.is_demo) {
      return jsonResponse(200, { skipped: 'Demo accounts do not reply to demo messages.' });
    }

    const { data: conversation, error: conversationError } = await serviceClient
      .from('conversations')
      .select('read_only')
      .eq('id', message.conversation_id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation || conversation.read_only) {
      return jsonResponse(200, { skipped: 'Read-only or missing conversation.' });
    }

    const { data: recipientRows, error: recipientsError } = await serviceClient
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', message.conversation_id)
      .is('left_at', null)
      .neq('user_id', message.sender_id);
    if (recipientsError) throw recipientsError;
    if (!recipientRows.length) return jsonResponse(200, { skipped: 'No recipients.' });

    const { data: demoRecipients, error: demoRecipientError } = await serviceClient
      .from('profiles')
      .select('id,is_demo')
      .in('id', recipientRows.map((row) => row.user_id))
      .eq('is_demo', true)
      .limit(1);
    if (demoRecipientError) throw demoRecipientError;
    const recipient = demoRecipients[0];
    if (!recipient) return jsonResponse(200, { skipped: 'The recipient is not a demo account.' });

    const { data: existingReply, error: existingReplyError } = await serviceClient
      .from('messages')
      .select('id')
      .eq('sender_id', recipient.id)
      .eq('client_id', message.id)
      .maybeSingle();
    if (existingReplyError) throw existingReplyError;
    if (existingReply) return jsonResponse(200, { skipped: 'This message already received a demo reply.' });

    await wait(1000 + Math.floor(Math.random() * 2001));
    const channel = serviceClient.channel(`chat:${message.conversation_id}`, {
      config: { private: true },
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out subscribing to the demo chat channel.')), 5000);
      channel.subscribe((status, error) => {
        if (error || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          reject(error ?? new Error(`Could not subscribe to demo chat: ${status}.`));
        } else if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    let typingStatus: string;
    try {
      typingStatus = await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: recipient.id },
      });
    } finally {
      await serviceClient.removeChannel(channel);
    }
    if (typingStatus !== 'ok') {
      console.warn('The demo typing update was not delivered.', typingStatus);
    }

    const reply = replyLines[Math.floor(Math.random() * replyLines.length)];
    const { error: insertError } = await serviceClient.from('messages').upsert({
      conversation_id: message.conversation_id,
      sender_id: recipient.id,
      client_id: message.id,
      kind: 'text',
      is_demo: true,
      body: reply,
    }, { onConflict: 'sender_id,client_id', ignoreDuplicates: true });
    if (insertError) throw insertError;
    return jsonResponse(200, { replied: true });
  } catch (error) {
    console.error('Demo reply processing failed.', error);
    return jsonResponse(500, { error: 'Could not process demo reply.' });
  }
});
