import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

export function AuthCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Auth</Text>
      <Text style={styles.subtitle}>Phase 1 placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#0A0C0F',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: 140,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
  },
  title: {
    color: theme.colors.white,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.colors.mutedDark,
    fontSize: 13,
    marginTop: 8,
  },
});
