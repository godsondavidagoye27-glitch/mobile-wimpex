import { useEffect } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { theme } from '../../theme/theme';

function Letter({ character, index }: { character: string; index: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    const delay = 1500 + index * 40;
    opacity.value = withDelay(delay, withTiming(1, { duration: 500 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.Text style={[styles.letter, animatedStyle]}>{character}</Animated.Text>;
}

export function Wordmark({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.wordmark, style]}>
      {'Wimpex'.split('').map((character, index) => (
        <Letter key={`${character}-${index}`} character={character} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    flexDirection: 'row',
    marginTop: 8,
  },
  letter: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.colors.gold,
    textShadowColor: 'rgba(255, 215, 0, 0.67)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
