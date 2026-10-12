import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme/theme';

export default function IndexRoute() {
  const [failed, setFailed] = useState(false);

  const resolveInitialRoute = async () => {
    setFailed(false);
    try {
      const session = await SecureStore.getItemAsync('wimpex-session');
      router.replace(session ? '/(tabs)' : '/(auth)/welcome');
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
