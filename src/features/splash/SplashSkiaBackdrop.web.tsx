import type { SharedValue } from 'react-native-reanimated';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { StyleSheet, View } from 'react-native';
import { theme } from '../../theme/theme';

type SplashSkiaBackdropProps = {
  backdropOpacity: SharedValue<number>;
};

export default function SplashSkiaBackdrop(_props: SplashSkiaBackdropProps) {
  return null;
}

export function SplashLogoGlow({ opacity }: { opacity: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Animated.View style={[styles.glow, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: '55%',
    left: '28%',
    right: '28%',
    height: 32,
    borderRadius: 24,
    backgroundColor: theme.colors.gold,
    shadowColor: theme.colors.gold,
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 8,
  },
});
