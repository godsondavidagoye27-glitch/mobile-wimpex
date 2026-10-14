import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/supabase';

export function useFollowRequestCount(enabled = true) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    const client = getSupabaseClient();

    if (!enabled) {
      return () => {
        active = false;
      };
    }

    const watchUser = (userId: string | null) => {
      if (channel) {
        void client.removeChannel(channel);
        channel = null;
      }
      setCount(0);
      if (!userId) return;

      const refresh = async () => {
        const { count: nextCount, error } = await client
          .from('follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('following_id', userId)
          .eq('status', 'pending');
        if (error) throw error;
        if (active) setCount(nextCount ?? 0);
      };

      void refresh().catch((error: unknown) => {
        console.error('Unable to load follow request count.', error);
      });

      channel = client
        .channel(`follow-requests:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${userId}` },
          () => {
            void refresh().catch((error: unknown) => {
              console.error('Unable to refresh follow request count.', error);
            });
          },
        )
        .subscribe((status, error) => {
          if (error) console.error('Unable to subscribe to follow requests.', error);
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('Follow request subscription failed.', status);
          }
        });
    };

    const { data: authState } = client.auth.onAuthStateChange((_event, session) => {
      watchUser(session?.user.id ?? null);
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) watchUser(data.session?.user.id ?? null);
    }).catch((error: unknown) => {
      console.error('Unable to load the follow request session.', error);
    });

    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
      authState.subscription.unsubscribe();
    };
  }, [enabled]);

  return enabled ? count : 0;
}
