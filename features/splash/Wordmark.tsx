import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

export function Wordmark({ style }: { style?: any }) {
  return (
    <View style={style}>
      <Text style={styles.wordmark}>Wimpex</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.colors.gold,
    textShadowColor: 'rgba(255, 215, 0, 0.67)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
