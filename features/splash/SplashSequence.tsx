import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Circle, Group, Paint, Blur, RoundedRect } from '@shopify/react-native-skia';
import { LogoMark } from './LogoMark';
import { Wordmark } from './Wordmark';
import { motion } from '../../theme/motion';

export function SplashSequence() {
  const scale = useSharedValue(1.25);
  const opacity = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const wordTranslate = useSharedValue(16);
  const pulseScale = useSharedValue(0.6);
  const pulseOpacity = useSharedValue(0.9);

  useEffect(() => {
    scale.value = withDelay(1200, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    opacity.value = withDelay(1200, withTiming(1, { duration: 800, easing: Easing.linear }));
    wordOpacity.value = withDelay(1500, withTiming(1, { duration: 500, easing: Easing.linear }));
    wordTranslate.value = withDelay(1500, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
    pulseScale.value = withDelay(1200, withTiming(2.6, { duration: 900, easing: Easing.linear }));
    pulseOpacity.value = withDelay(1200, withTiming(0, { duration: 900, easing: Easing.linear }));

    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(wordOpacity);
      cancelAnimation(wordTranslate);
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
    };
  }, [opacity, pulseOpacity, pulseScale, scale, wordOpacity, wordTranslate]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 1,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: 1 + (1 - opacity.value) * 0.1 }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordTranslate.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  return (
    <View style={styles.container}>
      <Canvas style={styles.canvas}>
        <Group>
          <Paint color="rgba(255, 215, 0, 0.4)">
            <Blur blur={14} />
          </Paint>
          <Circle cx={180} cy={190} r={46} color="rgba(255, 215, 0, 0.18)" />
        </Group>
      </Canvas>

      <Animated.View style={[styles.halo, glowStyle]}>
        <View style={styles.glowInner} />
      </Animated.View>

      <Animated.View style={[styles.markWrap, markStyle]}>
        <LogoMark size={120} />
      </Animated.View>

      <Animated.View style={[styles.pulseRing, pulseStyle]} />

      <Animated.View style={[styles.wordWrap, wordStyle]}>
        <Wordmark />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  canvas: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  halo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 180,
    height: 180,
  },
  glowInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    shadowColor: '#FFD700',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  markWrap: {
    position: 'absolute',
    top: '50%',
    marginTop: -72,
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: '#FFD700',
    backgroundColor: 'transparent',
    top: '50%',
    marginTop: -55,
  },
  wordWrap: {
    position: 'absolute',
    top: '50%',
    marginTop: 54,
  },
});
