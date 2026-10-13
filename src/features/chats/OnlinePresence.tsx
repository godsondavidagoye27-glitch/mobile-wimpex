import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getSupabaseClient } from '../../lib/supabase';

function isUnder18(dateOfBirth: string) {
  const today = new Date();
  const birthday = new Date(`${dateOfBirth}T00:00:00`);
  let age = today.getFullYear() - birthday.getFullYear();
  if (
    today.getMonth() < birthday.getMonth()
    || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())
  ) {
    age -= 1;
  }
  return age < 18;
}

export function OnlinePresence() {
  useEffect(() => {
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = getSupabaseClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let currentUserId: string | null = null;
    let active = true;

    const stop = () => {
      const currentChannel = channel;
      channel = null;
      if (currentChannel) void supabase.removeChannel(currentChannel);
    };

    const start = async (userId: string | null) => {
      stop();
      currentUserId = userId;
      if (!active || !userId || AppState.currentState !== 'active') return;
      try {
        const [settingsResult, profileResult] = await Promise.all([
          supabase.from('user_settings').select('show_online_status').eq('user_id', userId).maybeSingle(),
          supabase.from('profiles').select('date_of_birth').eq('id', userId).maybeSingle(),
        ]);
        if (settingsResult.error) throw settingsResult.error;
        if (profileResult.error) throw profileResult.error;
        if (!active || currentUserId !== userId) return;
        if (settingsResult.data?.show_online_status === false || (
          profileResult.data && isUnder18(profileResult.data.date_of_birth)
        )) return;

        const presenceChannel = supabase.channel(`presence:${userId}`, {
          config: { private: true, presence: { key: userId } },
        });
        channel = presenceChannel;
        presenceChannel.subscribe((status, subscribeError) => {
          if (subscribeError) {
            console.error('Unable to subscribe to online presence.', subscribeError);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('Online presence subscription failed.', status);
          }
          if (status === 'SUBSCRIBED' && active && currentUserId === userId) {
            void presenceChannel.track({ user_id: userId }).then((trackStatus) => {
              if (trackStatus !== 'ok') console.error('Unable to publish online presence.', trackStatus);
            }).catch((trackError: unknown) => {
              console.error('Unable to publish online presence.', trackError);
            });
          }
        });
      } catch (error) {
        console.error('Unable to prepare online presence.', error);
      }
    };

    const authState = supabase.auth.onAuthStateChange((_event, session) => {
      void start(session?.user.id ?? null);
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start(currentUserId);
      else stop();
    });
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) throw error;
      return start(data.user?.id ?? null);
    }).catch((error: unknown) => {
      console.error('Unable to load the signed-in user for online presence.', error);
    });

    return () => {
      active = false;
      stop();
      authState.data.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  return null;
}
