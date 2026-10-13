import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import { SplashSequence } from '../../features/splash/SplashSequence';

export default function WelcomeScreen() {
  useEffect(() => {
    console.log('welcome mounted');
  }, []);

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
