import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getSupabaseClient } from '../../lib/supabase';
import {
  parseChatNotificationRoute,
  parseIncomingCallNotificationRoute,
  type NotificationRoute,
} from './chatNotificationRoute';
import { syncPushTokenForCurrentSession } from './pushNotifications';

export function NotificationLifecycle() {
  const userIdRef = useRef<string | null>(null);
  const pendingRouteRef = useRef<NotificationRoute | null>(null);
  const handledResponsesRef = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();

    const routeIfAuthorized = async (intent: NotificationRoute, userId: string) => {
      if (intent.recipientId !== userId) {
        console.warn('Ignoring a notification intended for a different signed-in account.');
        return;
      }
      if (intent.kind === 'incoming_call') {
        const { data, error } = await client
          .from('call_sessions')
          .select('id,conversation_id,callee_id,media_type,status,expires_at')
          .eq('id', intent.callId)
          .eq('conversation_id', intent.conversationId)
          .eq('callee_id', userId)
          .maybeSingle();
        if (error) {
          console.error('Could not verify the incoming call notification.', error);
          return;
        }
        const terminal = data?.status === 'ended' || data?.status === 'declined' || data?.status === 'missed';
        const expired = data
          && data.status !== 'active'
          && Date.parse(data.expires_at) <= Date.now();
        if (!data || data.status !== 'ringing' || terminal || expired || data.media_type !== intent.mode) {
          console.warn('Ignoring a terminal, expired, or mismatched incoming call notification.');
          return;
        }
        router.push({
          pathname: '/call/[conversationId]',
          params: {
            conversationId: data.conversation_id,
            callId: data.id,
            direction: 'incoming',
            mode: data.media_type,
          },
        });
        return;
      }
      const { data, error } = await client
        .from('conversation_members')
        .select('conversation_id')
        .eq('conversation_id', intent.conversationId)
        .eq('user_id', userId)
        .is('left_at', null)
        .maybeSingle();
      if (error) {
        console.error('Could not verify access to the notification conversation.', error);
        return;
      }
      if (!data) {
        console.warn('Ignoring a chat notification for a conversation this account can no longer access.');
        return;
      }
      router.push({ pathname: '/chat/[id]', params: { id: intent.conversationId } });
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (handledResponsesRef.current.has(responseId)) return;
      handledResponsesRef.current.add(responseId);
      const data = response.notification.request.content.data;
      const intent = parseIncomingCallNotificationRoute(data) ?? parseChatNotificationRoute(data);
      if (!intent) {
        console.warn('Ignoring an unsupported or malformed notification tap.');
        return;
      }
      const userId = userIdRef.current;
      if (!userId) {
        pendingRouteRef.current = intent;
        return;
      }
      void routeIfAuthorized(intent, userId);
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (mounted && response) handleResponse(response);
      })
      .catch((error: unknown) => {
        console.error('Could not read the notification that opened the app.', error);
      });

    const scheduleSessionWork = (userId: string | null) => {
      setTimeout(() => {
        if (!mounted) return;
        userIdRef.current = userId;
        if (userId) {
          void syncPushTokenForCurrentSession().catch((error: unknown) => {
            console.error('Could not synchronize the current device push token.', error);
          });
          const pendingRoute = pendingRouteRef.current;
          if (pendingRoute) {
            pendingRouteRef.current = null;
            void routeIfAuthorized(pendingRoute, userId);
          }
        }
      }, 0);
    };

    void client.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        scheduleSessionWork(data.session?.user.id ?? null);
      })
      .catch((error: unknown) => {
        console.error('Could not determine the current notification session.', error);
      });

    const { data: authSubscription } = client.auth.onAuthStateChange((_event, session) => {
      scheduleSessionWork(session?.user.id ?? null);
    });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userIdRef.current) {
        void syncPushTokenForCurrentSession().catch((error: unknown) => {
          console.error('Could not refresh push token permissions.', error);
        });
      }
    });

    return () => {
      mounted = false;
      responseSubscription.remove();
      appStateSubscription.remove();
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  return null;
}
