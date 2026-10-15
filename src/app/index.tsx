import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { beginProfileCompletion, rehydrateAuthFlow } from '../features/auth/useAuthFlow';

export default function IndexRoute() {
  const resolveInitialRoute = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const destination = await Promise.race([
        (async () => {
          await rehydrateAuthFlow();
          if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
            return { route: 'welcome' as const };
          }

          const { data, error } = await getSupabaseClient().auth.getSession();
          if (error) throw error;
          console.log('session result', data.session ? 'authenticated' : 'no session');
          if (!data.session) return { route: 'welcome' as const };

          const { data: profile, error: profileError } = await getSupabaseClient()
            .from('profiles')
            .select('id')
            .eq('id', data.session.user.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (profile) return { route: 'tabs' as const };

          return { route: 'signup' as const, email: data.session.user.email ?? '' };
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Session check timed out.')), 5000);
        }),
      ]);

      if (destination.route === 'tabs') {
        router.replace('/(tabs)');
      } else if (destination.route === 'signup') {
        beginProfileCompletion(destination.email);
        router.replace('/(auth)/welcome?resume=signup');
      } else {
        router.replace('/(auth)/welcome');
      }
    } catch (error) {
      console.error('Unable to resolve the initial route; opening welcome.', error);
      router.replace('/(auth)/welcome');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  useEffect(() => {
    console.log('index start');
    void resolveInitialRoute();
  }, []);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.black,
  },
});
