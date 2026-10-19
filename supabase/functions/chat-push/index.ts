import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEquals } from '../_shared/constantTime.ts';
import { sendExpoPushMessages, type ExpoPushTicket } from '../_shared/expoPush.ts';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: string;
  is_demo: boolean;
  deleted_at: string | null;
};

type PushToken = {
  user_id: string;
  installation_id: string;
  expo_push_token: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function releaseClaims(
  serviceClient: ReturnType<typeof createClient>,
  messageId: string,
  recipientId: string,
  installationIds: string[],
) {
  if (!installationIds.length) return;
  const { error } = await serviceClient
    .from('push_notification_deliveries')
    .delete()
    .eq('message_id', messageId)
    .eq('recipient_id', recipientId)
    .in('installation_id', installationIds)
    .is('delivered_at', null);
  if (error) throw error;
}

async function deliverToRecipient(
  serviceClient: ReturnType<typeof createClient>,
  message: Message,
  conversationId: string,
  title: string,
  recipientId: string,
  tokens: PushToken[],
) {
  if (!tokens.length) return 0;

  const staleClaim = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error: staleClaimError } = await serviceClient
    .from('push_notification_deliveries')
    .delete()
    .eq('message_id', message.id)
    .eq('recipient_id', recipientId)
    .is('delivered_at', null)
    .lt('claimed_at', staleClaim);
  if (staleClaimError) throw staleClaimError;

  const { data: claims, error: claimError } = await serviceClient
    .from('push_notification_deliveries')
    .upsert(tokens.map((token) => ({
      message_id: message.id,
      recipient_id: recipientId,
      installation_id: token.installation_id,
    })), {
      onConflict: 'message_id,recipient_id,installation_id',
      ignoreDuplicates: true,
    })
    .select('installation_id');
  if (claimError) throw claimError;
  if (!claims?.length) return 0;

  const claimedIds = claims.map((claim: { installation_id: string }) => claim.installation_id);
  const claimedTokens = tokens.filter((token) => claimedIds.includes(token.installation_id));
  const messages = claimedTokens.map((token) => ({
    to: token.expo_push_token,
    title,
    body: 'Open Wimpex to view your message.',
    sound: 'default',
    channelId: 'default',
    data: {
      type: 'chat_message',
      conversation_id: conversationId,
      message_id: message.id,
      recipient_id: recipientId,
    },
  }));

  let tickets: ExpoPushTicket[];
  try {
    tickets = await sendExpoPushMessages(messages);
  } catch (error) {
    await releaseClaims(serviceClient, message.id, recipientId, claimedIds);
    throw error;
  }

  let delivered = 0;
  const deliveryErrors: string[] = [];
  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    const token = claimedTokens[index];
    if (ticket.status === 'ok') {
      const { error } = await serviceClient
        .from('push_notification_deliveries')
        .update({ delivered_at: new Date().toISOString(), expo_ticket_id: ticket.id ?? null })
        .eq('message_id', message.id)
        .eq('recipient_id', recipientId)
        .eq('installation_id', token.installation_id);
      if (error) {
        await releaseClaims(serviceClient, message.id, recipientId, claimedIds);
        throw error;
      }
      delivered += 1;
      continue;
    }

    if (ticket.details?.error === 'DeviceNotRegistered') {
      const { error } = await serviceClient
        .from('device_push_tokens')
        .delete()
        .eq('user_id', recipientId)
        .eq('installation_id', token.installation_id);
      if (error) throw error;
    } else {
      const reason = ticket.message ?? ticket.details?.error ?? 'Unknown error.';
      console.error('Expo rejected a chat notification.', reason);
      deliveryErrors.push(reason);
    }
    await releaseClaims(serviceClient, message.id, recipientId, [token.installation_id]);
  }
  if (deliveryErrors.length) {
    throw new Error(`Expo rejected ${deliveryErrors.length} chat notification(s).`);
  }
  return delivered;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const expectedSecret = Deno.env.get('PUSH_NOTIFICATION_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.error('PUSH_NOTIFICATION_WEBHOOK_SECRET is not configured.');
    return jsonResponse(503, { error: 'Push notifications are not configured.' });
  }
  if (!constantTimeEquals(request.headers.get('x-webhook-secret'), expectedSecret)) {
    return jsonResponse(401, { error: 'Unauthorized webhook.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('The chat-push function is missing its Supabase service configuration.');
    return jsonResponse(503, { error: 'Push notifications are not configured.' });
  }

  try {
    const payload = await request.json();
    const webhookMessage = payload?.record;
    if (
      payload?.type !== 'INSERT'
      || payload?.table !== 'messages'
      || payload?.schema !== 'public'
      || !uuidPattern.test(webhookMessage?.id ?? '')
      || !uuidPattern.test(webhookMessage?.conversation_id ?? '')
      || !uuidPattern.test(webhookMessage?.sender_id ?? '')
    ) {
      return jsonResponse(400, { error: 'Invalid messages webhook payload.' });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: message, error: messageError } = await serviceClient
      .from('messages')
      .select('id,conversation_id,sender_id,kind,is_demo,deleted_at')
      .eq('id', webhookMessage.id)
      .eq('conversation_id', webhookMessage.conversation_id)
      .eq('sender_id', webhookMessage.sender_id)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message || message.deleted_at || message.is_demo || !['text', 'image', 'video', 'voice'].includes(message.kind)) {
      return jsonResponse(200, { skipped: 'Message is not eligible for a push notification.' });
    }

    const [{ data: conversation, error: conversationError }, { data: sender, error: senderError }] =
      await Promise.all([
        serviceClient
          .from('conversations')
          .select('read_only,is_demo')
          .eq('id', message.conversation_id)
          .maybeSingle(),
        serviceClient
          .from('profiles')
          .select('display_name,is_demo')
          .eq('id', message.sender_id)
          .maybeSingle(),
      ]);
    if (conversationError) throw conversationError;
    if (senderError) throw senderError;
    if (!conversation || conversation.read_only || conversation.is_demo || !sender || sender.is_demo) {
      return jsonResponse(200, { skipped: 'Demo or read-only conversations are not notified.' });
    }

    const { data: members, error: membersError } = await serviceClient
      .from('conversation_members')
      .select('user_id,muted,unread_count')
      .eq('conversation_id', message.conversation_id)
      .is('left_at', null)
      .neq('user_id', message.sender_id);
    if (membersError) throw membersError;
    const candidateIds = (members ?? [])
      .filter((member) => !member.muted && member.unread_count > 0)
      .map((member) => member.user_id);
    if (!candidateIds.length) return jsonResponse(200, { delivered: 0 });

    const [{ data: outgoingBlocks, error: outgoingBlockError }, { data: incomingBlocks, error: incomingBlockError }] =
      await Promise.all([
        serviceClient
          .from('blocks')
          .select('blocked_id')
          .eq('blocker_id', message.sender_id)
          .in('blocked_id', candidateIds),
        serviceClient
          .from('blocks')
          .select('blocker_id')
          .eq('blocked_id', message.sender_id)
          .in('blocker_id', candidateIds),
      ]);
    if (outgoingBlockError) throw outgoingBlockError;
    if (incomingBlockError) throw incomingBlockError;
    const blockedIds = new Set([
      ...(outgoingBlocks ?? []).map((block) => block.blocked_id),
      ...(incomingBlocks ?? []).map((block) => block.blocker_id),
    ]);
    const recipientIds = candidateIds.filter((userId) => !blockedIds.has(userId));
    if (!recipientIds.length) return jsonResponse(200, { delivered: 0 });

    const [{ data: settings, error: settingsError }, { data: tokens, error: tokensError }] =
      await Promise.all([
        serviceClient
          .from('user_settings')
          .select('user_id,push_enabled,notify_messages')
          .in('user_id', recipientIds),
        serviceClient
          .from('device_push_tokens')
          .select('user_id,installation_id,expo_push_token')
          .in('user_id', recipientIds),
      ]);
    if (settingsError) throw settingsError;
    if (tokensError) throw tokensError;
    const settingsByUser = new Map((settings ?? []).map((setting) => [setting.user_id, setting]));
    const eligibleRecipients = recipientIds.filter((userId) => {
      const setting = settingsByUser.get(userId);
      return setting ? setting.push_enabled && setting.notify_messages : true;
    });
    const quietHoursResults = await Promise.all(eligibleRecipients.map(async (userId) => {
      const { data: suppress, error: quietHoursError } = await serviceClient
        .rpc('teen_should_suppress_push', { p_user_id: userId });
      if (quietHoursError) {
        console.error('Could not evaluate notification quiet hours; skipping push.', {
          recipientId: userId,
          code: quietHoursError.code,
        });
        return { userId, suppress: true };
      }
      return { userId, suppress: suppress === true };
    }));
    const recipientsWithinQuietHours = new Set(
      quietHoursResults.filter((result) => result.suppress).map((result) => result.userId),
    );
    const title = `New message from ${sender.display_name || 'Wimpex user'}`;
    let delivered = 0;
    for (const recipientId of eligibleRecipients.filter((userId) => !recipientsWithinQuietHours.has(userId))) {
      const recipientTokens = (tokens ?? []).filter((token) => token.user_id === recipientId);
      delivered += await deliverToRecipient(
        serviceClient,
        message,
        message.conversation_id,
        title,
        recipientId,
        recipientTokens,
      );
    }
    return jsonResponse(200, { delivered });
  } catch (error) {
    console.error('Chat push delivery failed.', error);
    return jsonResponse(500, { error: 'Could not deliver chat notifications.' });
  }
});
