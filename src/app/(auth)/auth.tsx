import { StyleSheet, View } from 'react-native';
import { AuthCard } from '../../features/auth/AuthCard';

export default function AuthScreen() {
  return (
    <View style={styles.container}>
      <AuthCard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
