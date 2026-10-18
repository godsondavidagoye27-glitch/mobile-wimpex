import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/supabase';

export function useNotificationUnreadCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    let observedUserId: string | null | undefined;
    const client = getSupabaseClient();

    const observeUser = (userId: string | null) => {
      if (observedUserId === userId) return;
      observedUserId = userId;
      if (channel) {
        void client.removeChannel(channel);
        channel = null;
      }
      setUnreadCount(0);
      if (!userId) return;

      const refreshCount = async () => {
        const { count, error } = await client
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('read_at', null);
        if (error) throw error;
        if (active) setUnreadCount(count ?? 0);
      };

      void refreshCount().catch((error: unknown) => {
        console.error('Unable to load the unread notification count.', error);
      });

      channel = client
        .channel(`notification-center:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => {
            void refreshCount().catch((error: unknown) => {
              console.error('Unable to refresh the unread notification count.', error);
            });
          },
        )
        .subscribe((status, error) => {
          if (error) console.error('Unable to subscribe to notification updates.', error);
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('Notification update subscription failed.', status);
          }
        });
    };

    const { data: authState } = client.auth.onAuthStateChange((_event, session) => {
      observeUser(session?.user.id ?? null);
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) observeUser(data.session?.user.id ?? null);
    }).catch((error: unknown) => {
      console.error('Unable to load the notification session.', error);
    });

    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
      authState.subscription.unsubscribe();
    };
  }, []);

  return unreadCount;
}
