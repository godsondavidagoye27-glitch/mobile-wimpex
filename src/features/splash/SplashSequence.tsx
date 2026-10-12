import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Blur, Canvas, Circle as SkiaCircle, Group, Paint, useCanvasSize } from '@shopify/react-native-skia';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme } from '../../theme/theme';
import { motion } from '../../theme/motion';
import { LogoMark } from './LogoMark';
import { Wordmark } from './Wordmark';

const slides = [
  { title: 'Short videos made for you', art: 'video' },
  { title: 'Chat with friends in real time', art: 'chat' },
  { title: 'Join communities you care about', art: 'community' },
] as const;

function SlideArt({ index }: { index: number }) {
  if (index === 0) {
    return (
      <Svg width={210} height={126} viewBox="0 0 200 120">
        <Rect x={40} y={8} width={120} height={84} rx={14} fill="none" stroke={theme.colors.primary} strokeWidth={3} />
        <Path d="M92 34 L120 50 L92 66 Z" fill={theme.colors.primary} />
        <Rect x={40} y={104} width={120} height={6} rx={3} fill="rgba(255,255,255,0.13)" />
        <Rect x={40} y={104} width={120} height={6} rx={3} fill={theme.colors.success} />
      </Svg>
    );
  }

  if (index === 1) {
    return (
      <Svg width={210} height={126} viewBox="0 0 200 120">
        <Rect x={20} y={14} width={110} height={42} rx={18} fill="#111418" stroke="rgba(255,255,255,0.2)" />
        <Rect x={70} y={64} width={110} height={42} rx={18} fill={theme.colors.primary} />
        <Circle cx={48} cy={35} r={4} fill={theme.colors.white} />
        <Circle cx={62} cy={35} r={4} fill={theme.colors.white} />
      </Svg>
    );
  }

  return (
    <Svg width={210} height={126} viewBox="0 0 200 120">
      <Circle cx={78} cy={60} r={34} fill="rgba(56,189,248,0.8)" />
      <Circle cx={122} cy={60} r={34} fill="rgba(34,197,94,0.8)" />
      <Circle cx={100} cy={36} r={22} fill="none" stroke={theme.colors.white} strokeWidth={3} />
    </Svg>
  );
}

export function SplashSequence() {
  const { height } = useWindowDimensions();
  const { ref: canvasRef, size: canvasSize } = useCanvasSize();
  const [phase, setPhase] = useState<'splash' | 'welcome'>('splash');
  const [slideIndex, setSlideIndex] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const translateY = useSharedValue(290);
  const logoScale = useSharedValue(1.25);
  const welcomeOpacity = useSharedValue(0);
  const pulseScale = useSharedValue(0.6);
  const pulseOpacity = useSharedValue(0.9);
  const backdropOpacity = useSharedValue(0);
  const goldGlowOpacity = useSharedValue(0);

  useEffect(() => {
    if (phase === 'splash') {
      translateY.value = 290;
      logoScale.value = 1.25;
      welcomeOpacity.value = 0;
      pulseScale.value = 0.6;
      pulseOpacity.value = 0.9;
      backdropOpacity.value = 0;
      goldGlowOpacity.value = 0;
      pulseScale.value = withDelay(1200, withTiming(2.6, { duration: 900, easing: Easing.out(Easing.cubic) }));
      pulseOpacity.value = withDelay(1200, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
      goldGlowOpacity.value = withDelay(1200, withTiming(0.2, { duration: 800 }));
      const timer = setTimeout(() => setPhase('welcome'), motion.durations.splash);
      return () => clearTimeout(timer);
    }

    translateY.value = withTiming(54, { duration: 1000, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    logoScale.value = withTiming(0.85, { duration: 1000, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    welcomeOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
    backdropOpacity.value = withDelay(500, withTiming(0.32, { duration: 1200 }));
    const interval = setInterval(() => {
      setSlideIndex((index) => (index + 1) % slides.length);
    }, 3500);

    return () => clearInterval(interval);
  }, [backdropOpacity, goldGlowOpacity, logoScale, phase, pulseOpacity, pulseScale, replayKey, translateY, welcomeOpacity]);

  useEffect(
    () => () => {
      cancelAnimation(translateY);
      cancelAnimation(logoScale);
      cancelAnimation(welcomeOpacity);
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
      cancelAnimation(backdropOpacity);
      cancelAnimation(goldGlowOpacity);
    },
    [backdropOpacity, goldGlowOpacity, logoScale, pulseOpacity, pulseScale, translateY, welcomeOpacity],
  );

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: logoScale.value }],
  }));
  const welcomeStyle = useAnimatedStyle(() => ({ opacity: welcomeOpacity.value }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 20,
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 40) return;
        setSlideIndex((index) => (index + (gesture.dx < 0 ? 1 : slides.length - 1)) % slides.length);
      },
    }),
  ).current;

  const replay = () => {
    setSlideIndex(0);
    setReplayKey((key) => key + 1);
    setPhase('splash');
  };

  return (
    <View style={styles.container}>
      <Canvas ref={canvasRef} style={styles.canvas}>
        <Group layer={<Paint><Blur blur={motion.blur.blob} /></Paint>}>
          <SkiaCircle cx={canvasSize.width * 0.12} cy={canvasSize.height * 0.08} r={160} color={theme.colors.primary} opacity={backdropOpacity} />
          <SkiaCircle cx={canvasSize.width * 0.9} cy={canvasSize.height * 0.92} r={160} color={theme.colors.success} opacity={backdropOpacity} />
        </Group>
        <Group layer={<Paint><Blur blur={14} /></Paint>}>
          <SkiaCircle cx={canvasSize.width / 2} cy={canvasSize.height / 2 - 16} r={46} color={theme.colors.gold} opacity={goldGlowOpacity} />
        </Group>
      </Canvas>

      <Animated.View style={[styles.logoStack, { top: 0 }, logoStyle]}>
        <View style={styles.logoMarkWrap}>
          <Animated.View style={[styles.pulseRing, pulseStyle]} />
          <LogoMark key={replayKey} size={120} />
        </View>
        <Wordmark key={`wordmark-${replayKey}`} />
      </Animated.View>

      <Animated.View style={[styles.welcome, welcomeStyle]} pointerEvents={phase === 'welcome' ? 'auto' : 'none'}>
        {phase === 'welcome' ? (
          <>
            <Pressable style={styles.replayButton} onPress={replay} accessibilityRole="button" accessibilityLabel="Replay splash">
              <Text style={styles.replayLabel}>Replay</Text>
            </Pressable>

            <Animated.View
              key={slideIndex}
              style={[styles.slide, { top: height * 0.2625 }]}
              entering={FadeInDown.duration(500)}
              {...responder.panHandlers}
            >
              <SlideArt index={slideIndex} />
              <Text style={styles.slideTitle}>{slides[slideIndex].title}</Text>
            </Animated.View>

            <View style={[styles.dots, { top: height * 0.5375 }]}>
              {slides.map((slide, index) => (
                <Pressable
                  key={slide.title}
                  onPress={() => setSlideIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show slide ${index + 1}`}
                  style={[styles.dot, index === slideIndex && styles.dotActive]}
                />
              ))}
            </View>

            <View style={styles.actions}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push({ pathname: '/(auth)/auth', params: { mode: 'signup' } })}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Create account</Text>
              </Pressable>
              <Pressable
                style={styles.outlineButton}
                onPress={() => router.push({ pathname: '/(auth)/auth', params: { mode: 'login' } })}
                accessibilityRole="button"
              >
                <Text style={styles.outlineButtonText}>Log in</Text>
              </Pressable>
              <Text style={styles.legal}>By continuing you accept the Terms and Privacy Policy</Text>
            </View>
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.colors.black,
    overflow: 'hidden',
  },
  canvas: {
    ...StyleSheet.absoluteFill,
  },
  logoStack: {
    position: 'absolute',
    width: 200,
    alignItems: 'center',
    transformOrigin: 'top',
    zIndex: 3,
  },
  logoMarkWrap: {
    width: 120,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: theme.colors.gold,
  },
  welcome: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  replayButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  replayLabel: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  slide: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  slideTitle: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.27)',
  },
  dotActive: {
    width: 24,
    backgroundColor: theme.colors.primary,
  },
  actions: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 36,
    gap: 12,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: theme.colors.black,
    fontWeight: '700',
    fontSize: 16,
  },
  outlineButton: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButtonText: {
    color: theme.colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  legal: {
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    fontSize: 12,
  },
});
