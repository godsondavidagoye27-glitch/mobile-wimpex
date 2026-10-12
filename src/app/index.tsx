import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';

const slides = [
  {
    title: 'Short videos made for you',
    art: 'video',
  },
  {
    title: 'Chat with friends in real time',
    art: 'chat',
  },
  {
    title: 'Join communities you care about',
    art: 'community',
  },
] as const;

function BrandMark() {
  const ringScale = useRef(new Animated.Value(0.62)).current;
  const glowOpacity = useRef(new Animated.Value(0.1)).current;

  useEffect(() => {
    const ringAnimation = Animated.sequence([
      Animated.timing(ringScale, {
        toValue: 2.4,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]);

    Animated.parallel([
      Animated.timing(glowOpacity, {
        toValue: 0.9,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      ringAnimation,
    ]).start();
  }, [glowOpacity, ringScale]);

  return (
    <View style={styles.logoMarkWrap}>
      <Animated.View
        style={[
          styles.ringPulse,
          {
            transform: [{ scale: ringScale }],
            opacity: glowOpacity,
          },
        ]}
      />
      <Svg width={120} height={100} viewBox="0 0 120 100" style={styles.markSvg}>
        <Path d="M14 14 L38 84 L62 28" stroke={theme.colors.primary} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="1" />
        <Path d="M58 28 L82 84 L106 14" stroke={theme.colors.success} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="1" />
      </Svg>
    </View>
  );
}

function Wordmark() {
  const letters = 'Wimpex'.split('');

  return (
    <View style={styles.wordmarkWrap}>
      {letters.map((letter, index) => (
        <Text key={`${letter}-${index}`} style={styles.wordmarkLetter}>
          {letter}
        </Text>
      ))}
    </View>
  );
}

function SlideArt({ art }: { art: (typeof slides)[number]['art'] }) {
  if (art === 'video') {
    return (
      <Svg width={210} height={126} viewBox="0 0 200 120">
        <Rect x={40} y={8} width={120} height={84} rx={14} fill="none" stroke={theme.colors.primary} strokeWidth={3} />
        <Path d="M92 34 L120 50 L92 66 Z" fill={theme.colors.primary} />
        <Rect x={40} y={104} width={120} height={6} rx={3} fill="rgba(255,255,255,0.18)" />
        <Rect x={40} y={104} width={120} height={6} rx={3} fill={theme.colors.success} opacity={0.95} />
      </Svg>
    );
  }

  if (art === 'chat') {
    return (
      <Svg width={210} height={126} viewBox="0 0 200 120">
        <Rect x={20} y={14} width={110} height={42} rx={18} fill="#111418" stroke="rgba(255,255,255,0.25)" />
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

export default function SplashWelcomeScreen() {
  const [phase, setPhase] = useState<'splash' | 'welcome'>('splash');
  const [slideIndex, setSlideIndex] = useState(0);
  const logoY = useRef(new Animated.Value(290)).current;
  const logoScale = useRef(new Animated.Value(1.25)).current;
  const glowOpacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setPhase('welcome');
    }, 2300);

    const slideTimer = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, 3500);

    Animated.parallel([
      Animated.spring(logoY, {
        toValue: phase === 'splash' ? 290 : 54,
        tension: 42,
        friction: 13,
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: phase === 'splash' ? 1.25 : 0.85,
        duration: 900,
        easing: Easing.cubic,
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: phase === 'splash' ? 0.32 : 0.12,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      clearTimeout(splashTimer);
      clearInterval(slideTimer);
    };
  }, [phase, glowOpacity, logoScale, logoY]);

  const handleReplay = () => {
    setPhase('splash');
    setSlideIndex(0);
    setTimeout(() => setPhase('welcome'), 2400);
  };

  return (
    <View style={styles.scene}>
      <LinearGradient colors={['#000000', '#0A0C0F']} style={styles.fullGradient} />
      <View pointerEvents="none" style={styles.backgroundLayer}>
        <View style={[styles.blob, styles.blobOne]} />
        <View style={[styles.blob, styles.blobTwo]} />
      </View>

      <Animated.View style={[styles.logoStack, { transform: [{ translateY: logoY }, { scale: logoScale }] }]}>
        <View style={styles.logoWrap}>
          <View style={styles.ringPulse} />
          <BrandMark />
        </View>
        <Wordmark />
      </Animated.View>

      {phase === 'welcome' ? (
        <>
          <Pressable style={styles.replayButton} onPress={handleReplay} accessibilityRole="button" accessibilityLabel="Replay splash">
            <Text style={styles.replayText}>Replay</Text>
          </Pressable>

          <View style={styles.welcomePanel}>
            <View style={styles.slideWrap}>
              <SlideArt art={slides[slideIndex].art} />
              <Text style={styles.slideTitle}>{slides[slideIndex].title}</Text>
            </View>

            <View style={styles.dotsWrap}>
              {slides.map((slide, index) => (
                <Pressable
                  key={slide.title}
                  accessibilityRole="button"
                  accessibilityLabel={`Show slide ${index + 1}`}
                  onPress={() => setSlideIndex(index)}
                  style={[styles.dot, index === slideIndex && styles.dotActive]}
                />
              ))}
            </View>

            <View style={styles.actionsWrap}>
              <Pressable style={styles.primaryButton} accessibilityRole="button" accessibilityLabel="Create account">
                <Text style={styles.primaryButtonText}>Create account</Text>
              </Pressable>

              <Pressable style={[styles.primaryButton, styles.secondaryButton]} accessibilityRole="button" accessibilityLabel="Log in">
                <Text style={styles.secondaryButtonText}>Log in</Text>
              </Pressable>

              <Text style={styles.legalText}>By continuing you accept the Terms and Privacy Policy</Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullGradient: {
    ...StyleSheet.absoluteFill,
  },
  backgroundLayer: {
    position: 'absolute',
    inset: 0,
  },
  blob: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    filter: 'blur(60px)',
    opacity: 0.32,
  },
  blobOne: {
    top: -80,
    left: -120,
    backgroundColor: theme.colors.primary,
  },
  blobTwo: {
    right: -120,
    bottom: -60,
    backgroundColor: theme.colors.success,
  },
  logoStack: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  logoWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 120,
    height: 100,
  },
  ringPulse: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
    borderColor: theme.colors.gold,
    opacity: 0.8,
  },
  logoMarkWrap: {
    width: 120,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markSvg: {
    marginTop: 8,
  },
  wordmarkWrap: {
    flexDirection: 'row',
    marginTop: 8,
  },
  wordmarkLetter: {
    color: theme.colors.gold,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 1,
    textShadowColor: 'rgba(255, 215, 0, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    opacity: 1,
    transform: [{ translateY: 0 }],
  },
  welcomePanel: {
    position: 'absolute',
    inset: 0,
    paddingTop: 180,
    paddingBottom: 36,
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  slideWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    marginTop: 24,
  },
  slideTitle: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
    maxWidth: 240,
  },
  dotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotActive: {
    width: 24,
    backgroundColor: theme.colors.primary,
  },
  actionsWrap: {
    width: '100%',
    paddingHorizontal: 24,
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
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  secondaryButtonText: {
    color: theme.colors.white,
  },
  legalText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  replayButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  replayText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
