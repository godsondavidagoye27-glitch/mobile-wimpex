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
    let channelUserId: string | null = null;
    let startingUserId: string | null = null;
    let generation = 0;
    let active = true;

    const stop = (forgetUser = false) => {
      generation += 1;
      startingUserId = null;
      if (forgetUser) currentUserId = null;
      const currentChannel = channel;
      channel = null;
      channelUserId = null;
      if (currentChannel) {
        void supabase.removeChannel(currentChannel).then((status) => {
          if (status !== 'ok') console.error('Unable to remove online presence subscription.', status);
        }).catch((error: unknown) => {
          console.error('Unable to remove online presence subscription.', error);
        });
      }
    };

    const start = async (userId: string | null) => {
      if (
        currentUserId === userId
        && (userId === null || channelUserId === userId || startingUserId === userId)
      ) return;
      currentUserId = userId;
      const requestGeneration = ++generation;
      startingUserId = userId;
      const previousChannel = channel;
      channel = null;
      channelUserId = null;
      if (previousChannel) {
        try {
          const status = await supabase.removeChannel(previousChannel);
          if (status !== 'ok') console.error('Unable to remove previous online presence subscription.', status);
        } catch (error) {
          console.error('Unable to remove previous online presence subscription.', error);
        }
      }
      if (!active || !userId || AppState.currentState !== 'active') {
        if (requestGeneration === generation) startingUserId = null;
        return;
      }
      try {
        const [settingsResult, profileResult] = await Promise.all([
          supabase.from('user_settings').select('show_online_status').eq('user_id', userId).maybeSingle(),
          supabase.from('profiles').select('date_of_birth').eq('id', userId).maybeSingle(),
        ]);
        if (settingsResult.error) throw settingsResult.error;
        if (profileResult.error) throw profileResult.error;
        if (!active || requestGeneration !== generation || currentUserId !== userId) return;
        if (settingsResult.data?.show_online_status === false || (
          profileResult.data && isUnder18(profileResult.data.date_of_birth)
        )) {
          startingUserId = null;
          return;
        }

        const presenceChannel = supabase.channel(`presence:${userId}`, {
          config: { private: true, presence: { key: userId } },
        });
        channel = presenceChannel;
        channelUserId = userId;
        startingUserId = null;
        presenceChannel.subscribe((status, subscribeError) => {
          if (subscribeError) {
            console.error('Unable to subscribe to online presence.', subscribeError);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('Online presence subscription failed.', status);
          }
          if (
            status === 'SUBSCRIBED'
            && active
            && requestGeneration === generation
            && currentUserId === userId
          ) {
            void presenceChannel.track({ user_id: userId }).then((trackStatus) => {
              if (trackStatus !== 'ok') console.error('Unable to publish online presence.', trackStatus);
            }).catch((trackError: unknown) => {
              console.error('Unable to publish online presence.', trackError);
            });
          }
        });
      } catch (error) {
        if (requestGeneration === generation) {
          startingUserId = null;
          console.error('Unable to prepare online presence.', error);
        }
      }
    };

    const authState = supabase.auth.onAuthStateChange((_event, session) => {
      void start(session?.user.id ?? null);
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start(currentUserId);
      else stop();
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return start(data.session?.user.id ?? null);
    }).catch((error: unknown) => {
      console.error('Unable to load the authentication session for online presence.', error);
    });

    return () => {
      active = false;
      stop(true);
      authState.data.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  return null;
}
