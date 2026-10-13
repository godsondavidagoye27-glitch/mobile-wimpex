import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import { rehydrateAuthFlow, useAuthFlow } from '../features/auth/useAuthFlow';

export default function IndexRoute() {
  const [failed, setFailed] = useState(false);

  const resolveInitialRoute = async () => {
    setFailed(false);
    try {
      await rehydrateAuthFlow();
      if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
        router.replace('/(auth)/welcome');
        return;
      }

      const { data, error } = await getSupabaseClient().auth.getSession();
      if (error) throw error;
      if (!data.session) {
        router.replace('/(auth)/welcome');
        return;
      }

      const { data: profile, error: profileError } = await getSupabaseClient()
        .from('profiles')
        .select('id')
        .eq('id', data.session.user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      if (profile) {
        router.replace('/(tabs)');
        return;
      }

      const flow = useAuthFlow.getState();
      flow.setSignupData({
        flowType: flow.flowType,
        email: data.session.user.email ?? useAuthFlow.getState().email,
        password: '',
        currentStep: flow.flowType === 'social' ? flow.currentStep : 3,
      });
      router.replace('/(auth)/welcome?resume=signup');
    } catch (error) {
      setFailed(true);
      Alert.alert('Unable to check your session', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  useEffect(() => {
    void resolveInitialRoute();
  }, []);

  return (
    <View style={styles.screen}>
      {failed ? (
        <Pressable onPress={() => void resolveInitialRoute()} accessibilityRole="button">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : (
        <ActivityIndicator color={theme.colors.primary} />
      )}
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
  retry: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
});
