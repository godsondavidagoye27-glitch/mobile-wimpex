import { StyleSheet, View } from 'react-native';
import { SplashSequence } from '../../features/splash/SplashSequence';

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <SplashSequence />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
