import { router } from 'expo-router';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  PanResponder,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { theme } from '../../theme/theme';
import { motion } from '../../theme/motion';
import { Icon } from '../../components/Icon';
import { AuthField } from '../../components/AuthField';
import { getSupabaseClient } from '../../lib/supabase';
import { SignUpFlow } from '../auth/SignUpFlow';
import { PasswordResetFlow } from '../auth/PasswordResetFlow';
import { runWithMinimumDuration } from '../auth/authTiming';
import { changePasswordResetStep } from '../auth/signupValidation';
import { signInWithApple, signInWithGoogle, signOutProviders, SocialSignInError } from '../auth/socialAuth';
import { beginProfileCompletion, useAuthFlow } from '../auth/useAuthFlow';
import { LogoMark } from './LogoMark';
import SplashSkiaBackdrop, { SplashLogoGlow } from './SplashSkiaBackdrop';
import { Wordmark } from './Wordmark';
import { scrollFocusedInputIntoView, useKeyboardInset } from '../../hooks/useKeyboardInset';

const slides = [
  { title: 'Short videos made for you', art: 'video' },
  { title: 'Chat with friends in real time', art: 'chat' },
  { title: 'Join communities you care about', art: 'community' },
] as const;

const wait = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration));

type AuthMode = 'login' | 'signup';
type LoginFieldName = 'email' | 'password';

const AnimatedFinishPath = Animated.createAnimatedComponent(Path);

class SkiaSetupBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unable to initialize the splash animation.', error, info.componentStack);
    this.props.onError();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

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

function SignupFinish({
  displayName,
  username,
  title,
  subtitle,
  onComplete,
}: {
  displayName: string;
  username: string;
  title?: string;
  subtitle?: string;
  onComplete: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const washScale = useSharedValue(0);
  const washOpacity = useSharedValue(1);
  const contentOpacity = useSharedValue(0);
  const checkOffset = useSharedValue(40);
  const washStyle = useAnimatedStyle(() => ({
    opacity: washOpacity.value,
    transform: [{ scale: washScale.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: checkOffset.value }));

  useEffect(() => {
    washScale.value = withTiming(3.2, { duration: reduceMotion ? 0 : 800 });
    const reveal = setTimeout(() => {
      washOpacity.value = withTiming(0, { duration: reduceMotion ? 0 : 600 });
      contentOpacity.value = withTiming(1, { duration: reduceMotion ? 0 : 500 });
      checkOffset.value = withDelay(
        reduceMotion ? 0 : 200,
        withTiming(0, { duration: reduceMotion ? 0 : 600 }),
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error: unknown) => {
        console.warn('Unable to play the signup confirmation haptic.', error);
      });
    }, reduceMotion ? 0 : 900);
    const complete = setTimeout(onComplete, reduceMotion ? 0 : 2400);

    return () => {
      clearTimeout(reveal);
      clearTimeout(complete);
    };
  }, [checkOffset, contentOpacity, onComplete, reduceMotion, washOpacity, washScale]);

  return (
    <View style={finishStyles.container}>
      <Animated.View
        style={[
          finishStyles.wash,
          { left: width / 2 - 600, top: height * 0.85 - 600 },
          washStyle,
        ]}
      >
        <LinearGradient
          colors={[theme.colors.primary, theme.colors.success]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={finishStyles.gradient}
        />
      </Animated.View>
      <Animated.View style={[finishStyles.content, contentStyle]}>
        <Text style={finishStyles.wordmark}>Wimpex</Text>
        <Svg width={84} height={84} viewBox="0 0 24 24" fill="none">
          <AnimatedFinishPath
            d="M20 6 9 17 4 12"
            stroke={theme.colors.white}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[40, 100]}
            animatedProps={checkProps}
          />
        </Svg>
        <Text style={finishStyles.title}>{title ?? `Welcome, ${displayName}`}</Text>
        <Text style={finishStyles.subtitle}>{subtitle ?? `@${username} is ready.`}</Text>
      </Animated.View>
    </View>
  );
}

const finishStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.black,
    zIndex: 20,
  },
  wash: {
    position: 'absolute',
    width: 1200,
    height: 1200,
    borderRadius: 600,
  },
  gradient: {
    flex: 1,
    borderRadius: 600,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 30,
  },
  wordmark: {
    color: theme.colors.gold,
    fontSize: 34,
    fontWeight: '800',
    textShadowColor: 'rgba(255, 215, 0, 0.67)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  title: {
    color: theme.colors.white,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.67)',
    fontSize: 15,
    textAlign: 'center',
  },
});

export function SplashSequence() {
  const { height } = useWindowDimensions();
  const [stableWindowHeight] = useState(() => height);
  const authCardHeight = stableWindowHeight * 0.7;
  const {
    keyboardHeight,
    safeAreaTop,
    safeAreaBottom,
    containerHeight,
    onLayout: onRootLayout,
  } = useKeyboardInset();
  const reduceMotion = useReducedMotion();
  const signupStep = useAuthFlow((state) => state.currentStep);
  const signupFlowType = useAuthFlow((state) => state.flowType);
  const signupHydrated = useAuthFlow((state) => state.hasHydrated);
  const setSignupData = useAuthFlow((state) => state.setSignupData);
  const [phase, setPhase] = useState<'splash' | 'welcome'>('splash');
  const [authOpen, setAuthOpen] = useState(false);
  const [authTransitionReady, setAuthTransitionReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [signupFinish, setSignupFinish] = useState<{
    displayName: string;
    username: string;
    title?: string;
    subtitle?: string;
  } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [socialState, setSocialState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<LoginFieldName, string>>>({});
  const [authError, setAuthError] = useState('');
  const loginEmailRef = useRef<TextInput>(null);
  const loginPasswordRef = useRef<TextInput>(null);
  const loginScrollRef = useRef<ScrollView>(null);
  const loginScrollOffset = useRef(0);
  const [buttonState, setButtonState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [toast, setToast] = useState('');
  const [segmentWidth, setSegmentWidth] = useState(0);
  const [skiaFailed, setSkiaFailed] = useState(false);
  const translateY = useSharedValue(290);
  const logoScale = useSharedValue(1.25);
  const welcomeOpacity = useSharedValue(0);
  const welcomeTranslateY = useSharedValue(0);
  const pulseScale = useSharedValue(0.6);
  const pulseOpacity = useSharedValue(0.9);
  const backdropOpacity = useSharedValue(0);
  const goldGlowOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(height * 0.735);
  const segmentOffset = useSharedValue(0);
  const segmentOpacity = useSharedValue(1);
  const segmentHeight = useSharedValue(42);
  const authTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginAuthTransition = useCallback(() => {
    setAuthTransitionReady(false);
    if (authTransitionTimer.current) clearTimeout(authTransitionTimer.current);
    authTransitionTimer.current = setTimeout(() => {
      setAuthTransitionReady(true);
      authTransitionTimer.current = null;
    }, skiaFailed ? 0 : 850);
  }, [skiaFailed]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    void import('expo-apple-authentication')
      .then((AppleAuthentication) => AppleAuthentication.isAvailableAsync())
      .then((available) => {
        if (mounted) setAppleAvailable(available);
      })
      .catch((error: unknown) => {
        console.warn('Unable to check Apple sign in availability.', error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const offset = authMode === 'signup' ? (segmentWidth - 6) / 2 : 0;
    if (skiaFailed) segmentOffset.value = offset;
    else {
      segmentOffset.value = withTiming(offset, {
        duration: 400,
        easing: Easing.bezier(0.3, 1.4, 0.5, 1),
      });
    }
  }, [authMode, segmentOffset, segmentWidth, skiaFailed]);

  useEffect(() => {
    const duration = reduceMotion ? 0 : 220;
    if (skiaFailed) {
      segmentOpacity.value = resetOpen ? 0 : 1;
      segmentHeight.value = resetOpen ? 0 : 42;
    } else {
      segmentOpacity.value = withTiming(resetOpen ? 0 : 1, { duration });
      segmentHeight.value = withTiming(resetOpen ? 0 : 42, { duration });
    }
  }, [reduceMotion, resetOpen, segmentHeight, segmentOpacity, skiaFailed]);

  useEffect(() => {
    if (skiaFailed) {
      translateY.value = authOpen ? 16 : 54;
      logoScale.value = authOpen ? 0.5 : 0.85;
      welcomeOpacity.value = authOpen ? 0 : 1;
      welcomeTranslateY.value = 0;
      pulseOpacity.value = 0;
      backdropOpacity.value = 0;
      goldGlowOpacity.value = 0.15;
      cardTranslateY.value = authOpen ? 0 : height * 0.735;
      return;
    }

    if (authOpen) {
      translateY.value = withTiming(16, { duration: 500, easing: Easing.bezier(0.7, 0, 0.2, 1) });
      logoScale.value = withTiming(0.5, { duration: 500, easing: Easing.bezier(0.7, 0, 0.2, 1) });
      welcomeOpacity.value = withTiming(0, { duration: 350 });
      welcomeTranslateY.value = withTiming(50, { duration: 500 });
      cardTranslateY.value = withTiming(0, { duration: 850, easing: Easing.bezier(0.2, 1.1, 0.3, 1) });
      return;
    }

    if (phase === 'splash') {
      translateY.value = 290;
      logoScale.value = 1.25;
      welcomeOpacity.value = 0;
      welcomeTranslateY.value = 0;
      pulseScale.value = 0.6;
      pulseOpacity.value = 0.9;
      backdropOpacity.value = 0;
      goldGlowOpacity.value = 0;
      cardTranslateY.value = height * 0.735;
      pulseScale.value = withDelay(1200, withTiming(2.6, { duration: 900, easing: Easing.out(Easing.cubic) }));
      pulseOpacity.value = withDelay(1200, withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }));
      goldGlowOpacity.value = withDelay(1200, withTiming(0.2, { duration: 800 }));
      const timer = setTimeout(() => setPhase('welcome'), motion.durations.splash);
      return () => clearTimeout(timer);
    }

    translateY.value = withTiming(54, { duration: 1000, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    logoScale.value = withTiming(0.85, { duration: 1000, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    welcomeOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
    welcomeTranslateY.value = withTiming(0, { duration: 500 });
    backdropOpacity.value = withDelay(500, withTiming(0.32, { duration: 1200 }));
    const interval = setInterval(() => {
      setSlideIndex((index) => (index + 1) % slides.length);
    }, 3500);

    return () => clearInterval(interval);
  }, [authOpen, backdropOpacity, cardTranslateY, goldGlowOpacity, height, logoScale, phase, pulseOpacity, pulseScale, replayKey, skiaFailed, translateY, welcomeOpacity, welcomeTranslateY]);

  useEffect(
    () => () => {
      if (authTransitionTimer.current) clearTimeout(authTransitionTimer.current);
      cancelAnimation(translateY);
      cancelAnimation(logoScale);
      cancelAnimation(welcomeOpacity);
      cancelAnimation(welcomeTranslateY);
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
      cancelAnimation(backdropOpacity);
      cancelAnimation(goldGlowOpacity);
      cancelAnimation(cardTranslateY);
    },
    [backdropOpacity, cardTranslateY, goldGlowOpacity, logoScale, pulseOpacity, pulseScale, translateY, welcomeOpacity, welcomeTranslateY],
  );

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: logoScale.value }],
  }));
  const welcomeStyle = useAnimatedStyle(() => ({ opacity: welcomeOpacity.value }));
  const welcomeContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: welcomeTranslateY.value }],
  }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: cardTranslateY.value }] }));
  const authKeyboardStyle = useAnimatedStyle(() => {
    const rootHeight = containerHeight.value || height;
    const currentKeyboardHeight = keyboardHeight.value;
    const bottomInset = currentKeyboardHeight > 0
      ? Math.max(currentKeyboardHeight, safeAreaBottom)
      : 0;
    const availableHeight = Math.max(0, rootHeight - bottomInset);
    const keyboardOpen = currentKeyboardHeight > 0;
    return {
      bottom: bottomInset,
      height: keyboardOpen
        ? Math.max(0, availableHeight - safeAreaTop)
        : authCardHeight,
    };
  }, [authCardHeight, containerHeight, height, safeAreaBottom, safeAreaTop]);
  const keyboardAwareLogoStyle = useAnimatedStyle(() => {
    const keyboardAmount = keyboardHeight.value;
    return {
      opacity: Math.max(0.45, 1 - keyboardAmount / 650),
      transform: [
        { translateY: translateY.value - keyboardAmount * 0.1 },
        { scale: logoScale.value * Math.max(0.72, 1 - keyboardAmount / 1500) },
      ],
    };
  });
  const fallbackGlowStyle = useAnimatedStyle(() => ({
    opacity: goldGlowOpacity.value,
  }));
  const segmentPillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: segmentOffset.value }],
  }));
  const segmentSlotStyle = useAnimatedStyle(() => ({
    height: segmentHeight.value,
    opacity: segmentOpacity.value,
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  const panHandlers = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 20,
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 40) return;
        setSlideIndex((index) => (index + (gesture.dx < 0 ? 1 : slides.length - 1)) % slides.length);
      },
    }).panHandlers,
    [],
  );

  const openAuth = (mode: AuthMode) => {
    Keyboard.dismiss();
    beginAuthTransition();
    setAuthMode(mode);
    setResetOpen(false);
    setResetStep(0);
    if (mode === 'signup') setSignupData({ flowType: 'email' });
    setAuthError('');
    setErrors({});
    setButtonState('idle');
    setAuthOpen(true);
  };

  useEffect(() => {
    if (!signupHydrated || (signupStep === 0 && signupFlowType === 'email')) return;
    const timer = setTimeout(() => {
      setPhase('welcome');
      setAuthMode('signup');
      beginAuthTransition();
      setAuthOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [beginAuthTransition, signupFlowType, signupHydrated, signupStep]);

  const handleAuthBack = () => {
    Keyboard.dismiss();
    if (resetOpen) {
      if (resetStep > 0) {
        setResetStep(changePasswordResetStep(resetStep, 'back'));
      } else {
        setResetOpen(false);
        setResetStep(0);
      }
      return;
    }
    if (authMode === 'signup') {
      const currentStep = useAuthFlow.getState().currentStep;
      if (currentStep > 0) {
        setSignupData({ currentStep: currentStep - 1 });
        return;
      }
    }
    closeAuth();
  };

  const closeAuth = () => {
    Keyboard.dismiss();
    setAuthTransitionReady(false);
    if (authTransitionTimer.current) {
      clearTimeout(authTransitionTimer.current);
      authTransitionTimer.current = null;
    }
    setResetOpen(false);
    setResetStep(0);
    if (skiaFailed) {
      setAuthOpen(false);
      return;
    }
    cardTranslateY.value = withTiming(height * 0.735, {
      duration: 500,
      easing: Easing.bezier(0.7, 0, 0.2, 1),
    });
    translateY.value = withTiming(54, { duration: 500, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    logoScale.value = withTiming(0.85, { duration: 500, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    welcomeTranslateY.value = withTiming(0, { duration: 500 });
    welcomeOpacity.value = withDelay(150, withTiming(1, { duration: 450 }));
    setTimeout(() => setAuthOpen(false), 850);
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 1600);
  };

  const completeSignup = useCallback(() => router.replace('/(tabs)'), []);

  const beginSocialProfile = (result: {
    email: string;
    displayName: string;
    avatarUri: string | null;
  }) => {
    Keyboard.dismiss();
    useAuthFlow.getState().resetSignup();
    setSignupData({
      flowType: 'social',
      email: result.email,
      displayName: result.displayName,
      avatarUri: result.avatarUri,
      currentStep: 0,
    });
    setAuthMode('signup');
    setAuthError('');
  };

  const submitSocialSignIn = async (provider: 'google' | 'apple') => {
    if (socialState !== 'idle') return;
    Keyboard.dismiss();
    setSocialState('loading');
    setAuthError('');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error: unknown) => {
      console.warn('Unable to play the sign in haptic.', error);
    });
    try {
      const result = await runWithMinimumDuration(() =>
        provider === 'google' ? signInWithGoogle() : signInWithApple(),
      );
      if (!result) return;
      setSocialState('success');
      await wait(350);
      if (result.profileNeeded) {
        beginSocialProfile(result);
      } else {
        setSignupFinish({
          displayName: '',
          username: '',
          title: 'Welcome back',
          subtitle: 'You are signed in.',
        });
      }
    } catch (error) {
      if (error instanceof SocialSignInError && error.kind === 'expo-go') {
        showToast(error.message);
      } else {
        setAuthError(
          error instanceof SocialSignInError
            ? error.message
            : provider === 'google'
              ? 'Google sign in failed. Try again.'
              : 'Apple sign in failed. Try again.',
        );
      }
    } finally {
      setSocialState('idle');
    }
  };

  const deleteUnderageSocialAccount = async () => {
    const { error } = await getSupabaseClient().functions.invoke('delete-own-account');
    if (error) throw error;
    await signOutProviders();
    useAuthFlow.getState().resetSignup();
    setAuthMode('login');
    closeAuth();
  };

  const submitLogin = async () => {
    Keyboard.dismiss();
    const nextErrors: Partial<Record<LoginFieldName, string>> = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.';
    if (password.length < 8) nextErrors.password = 'Password must be at least 8 characters.';
    setErrors(nextErrors);
    setAuthError('');
    if (Object.keys(nextErrors).length) return;

    setButtonState('loading');
    await new Promise((resolve) => setTimeout(resolve, 500));
    setButtonState('success');
    await new Promise((resolve) => setTimeout(resolve, 350));

    try {
      const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('The sign-in completed without an active session.');
      const { data: profile, error: profileError } = await getSupabaseClient()
        .from('profiles')
        .select('id')
        .eq('id', data.session.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) {
        beginProfileCompletion(data.session.user.email ?? email.trim());
        setButtonState('idle');
        setAuthMode('signup');
        setAuthError('');
        return;
      }
      router.replace('/(tabs)');
    } catch (error) {
      setButtonState('idle');
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
    }
  };

  const replay = () => {
    if (authOpen) {
      closeAuth();
      return;
    }
    setSlideIndex(0);
    if (skiaFailed) return;
    setReplayKey((key) => key + 1);
    setPhase('splash');
  };
  const displayedPhase = skiaFailed ? 'welcome' : phase;

  return (
    <View onLayout={onRootLayout} style={styles.container}>
      <SkiaSetupBoundary onError={() => setSkiaFailed(true)}>
      <SplashSkiaBackdrop backdropOpacity={backdropOpacity} />
      </SkiaSetupBoundary>

      <Animated.View style={[styles.logoStack, { top: 0 }, logoStyle, keyboardAwareLogoStyle]}>
        {skiaFailed ? (
          <Animated.View style={[styles.logoGlowFallback, fallbackGlowStyle]} pointerEvents="none" />
        ) : (
          <SkiaSetupBoundary onError={() => setSkiaFailed(true)}>
            <SplashLogoGlow opacity={goldGlowOpacity} />
          </SkiaSetupBoundary>
        )}
        <View style={styles.logoMarkWrap}>
          <Animated.View style={[styles.pulseRing, pulseStyle]} />
          <LogoMark key={replayKey} size={120} />
        </View>
        <Wordmark key={`wordmark-${replayKey}`} />
      </Animated.View>

      <Animated.View
        style={[styles.welcome, welcomeStyle]}
        pointerEvents={displayedPhase === 'welcome' && !authOpen ? 'auto' : 'none'}
      >
        {displayedPhase === 'welcome' && !authOpen ? (
          <>
            {__DEV__ ? (
              <Pressable style={styles.replayButton} onPress={replay} accessibilityRole="button" accessibilityLabel="Replay splash">
                <Text style={styles.replayLabel}>Replay</Text>
              </Pressable>
            ) : null}

            <Animated.View
              key={slideIndex}
              entering={skiaFailed ? undefined : FadeInDown.duration(500)}
              {...panHandlers}
            >
              <Animated.View style={[styles.slide, { top: height * 0.2625 }, welcomeContentStyle]}>
                <SlideArt index={slideIndex} />
                <Text style={styles.slideTitle}>{slides[slideIndex].title}</Text>
              </Animated.View>
            </Animated.View>

            <Animated.View style={[styles.dots, { top: height * 0.5375 }, welcomeContentStyle]}>
              {slides.map((slide, index) => (
                <Pressable
                  key={slide.title}
                  onPress={() => setSlideIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show slide ${index + 1}`}
                  style={[styles.dot, index === slideIndex && styles.dotActive]}
                />
              ))}
            </Animated.View>

            <Animated.View style={[styles.actions, welcomeContentStyle]}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => openAuth('signup')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Create account</Text>
              </Pressable>
              <Pressable
                style={styles.outlineButton}
                onPress={() => openAuth('login')}
                accessibilityRole="button"
              >
                <Text style={styles.outlineButtonText}>Log in</Text>
              </Pressable>
              <Text style={styles.legal}>By continuing you accept the Terms and Privacy Policy</Text>
            </Animated.View>
          </>
        ) : null}
      </Animated.View>

      <Animated.View
        style={[styles.authCard, { height: authCardHeight, maxHeight: '100%' }, cardStyle, authKeyboardStyle]}
        pointerEvents={authOpen ? 'auto' : 'none'}
        collapsable={false}
      >
        <Pressable
          onPress={Keyboard.dismiss}
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.authCardKeyboard}>
        <View style={styles.authHeader}>
          <Pressable onPress={handleAuthBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={20} color={theme.colors.white} />
          </Pressable>
          <Animated.View
            style={[
              styles.segmentSlot,
              segmentSlotStyle,
              resetOpen && styles.segmentSlotHidden,
            ]}
            pointerEvents={resetOpen ? 'none' : 'auto'}
          >
            <View style={styles.segment} onLayout={(event) => setSegmentWidth(event.nativeEvent.layout.width)}>
              <Animated.View style={[styles.segmentPill, segmentPillStyle]} />
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setAuthMode('login');
                }}
                style={styles.segmentButton}
                accessibilityRole="button"
                accessibilityState={{ selected: authMode === 'login' }}
              >
                <Text style={[styles.segmentText, authMode === 'login' && styles.segmentTextActive]}>Log in</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setAuthMode('signup');
                  setSignupData({ flowType: 'email' });
                  setErrors({});
                  setAuthError('');
                }}
                style={styles.segmentButton}
                accessibilityRole="button"
                accessibilityState={{ selected: authMode === 'signup' }}
              >
                <Text style={[styles.segmentText, authMode === 'signup' && styles.segmentTextActive]}>Create account</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>

        {resetOpen ? (
          <PasswordResetFlow
            canAutofocus={authTransitionReady}
            email={email}
            step={resetStep}
            setStep={setResetStep}
            onToast={showToast}
            onFinished={() => {
              Keyboard.dismiss();
              setResetOpen(false);
              setResetStep(0);
              setSignupFinish({
                displayName: '',
                username: '',
                title: 'Welcome back',
                subtitle: 'You are signed in.',
              });
            }}
          />
        ) : authMode === 'login' ? (
          <>
            <ScrollView
              ref={loginScrollRef}
              onScroll={(event) => {
                loginScrollOffset.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              style={styles.authBody}
              contentContainerStyle={styles.authBodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              <AuthField
                label="Email"
                inputRef={loginEmailRef}
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setErrors((current) => ({ ...current, email: undefined }));
                }}
                keyboardType="email-address"
                error={errors.email}
                shakeOnError
                returnKeyType="next"
                autoComplete="email"
                textContentType="emailAddress"
                importantForAutofill="yes"
                onSubmitEditing={() => loginPasswordRef.current?.focus()}
                onFocusInput={() => scrollFocusedInputIntoView(
                  loginScrollRef.current,
                  loginEmailRef.current,
                  loginScrollOffset.current,
                )}
              />
              <AuthField
                label="Password"
                inputRef={loginPasswordRef}
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setErrors((current) => ({ ...current, password: undefined }));
                }}
                secureTextEntry
                error={errors.password}
                shakeOnError
                returnKeyType="done"
                autoComplete="current-password"
                textContentType="password"
                importantForAutofill="yes"
                onSubmitEditing={() => void submitLogin()}
                onFocusInput={() => scrollFocusedInputIntoView(
                  loginScrollRef.current,
                  loginPasswordRef.current,
                  loginScrollOffset.current,
                )}
              />
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setResetStep(0);
                  setResetOpen(true);
                  setAuthError('');
                }}
                style={styles.forgotButton}
              >
                <Text style={styles.linkText}>Forgot password</Text>
              </Pressable>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <Pressable
                onPress={() => void submitSocialSignIn('google')}
                disabled={socialState !== 'idle' || buttonState !== 'idle'}
                style={({ pressed }) => [
                  styles.socialButton,
                  pressed && styles.socialButtonPressed,
                  (socialState !== 'idle' || buttonState !== 'idle') && styles.socialButtonDisabled,
                ]}
                accessibilityRole="button"
              >
                {socialState === 'loading' ? (
                  <ActivityIndicator size="small" color={theme.colors.white} />
                ) : socialState === 'success' ? (
                  <Icon name="check" size={24} color={theme.colors.white} />
                ) : (
                  <Text style={styles.socialButtonText}>Continue with Google</Text>
                )}
              </Pressable>
              {appleAvailable ? (
                <Pressable
                  onPress={() => void submitSocialSignIn('apple')}
                  disabled={socialState !== 'idle' || buttonState !== 'idle'}
                  style={({ pressed }) => [
                    styles.socialButton,
                    pressed && styles.socialButtonPressed,
                    (socialState !== 'idle' || buttonState !== 'idle') && styles.socialButtonDisabled,
                  ]}
                  accessibilityRole="button"
                >
                  {socialState === 'loading' ? (
                    <ActivityIndicator size="small" color={theme.colors.white} />
                  ) : socialState === 'success' ? (
                    <Icon name="check" size={24} color={theme.colors.white} />
                  ) : (
                    <Text style={styles.socialButtonText}>Continue with Apple</Text>
                  )}
                </Pressable>
              ) : null}
              {authError ? <Text accessibilityRole="alert" style={styles.authError}>{authError}</Text> : null}
            </ScrollView>

            <View style={styles.authFooter}>
              <Pressable
                onPress={() => void submitLogin()}
                disabled={buttonState !== 'idle' || socialState !== 'idle'}
                style={[styles.authSubmit, (buttonState !== 'idle' || socialState !== 'idle') && styles.authSubmitDisabled]}
                accessibilityRole="button"
              >
                {buttonState === 'loading' ? (
                  <ActivityIndicator size="small" color={theme.colors.black} />
                ) : buttonState === 'success' ? (
                  <Icon name="check" size={24} color={theme.colors.black} />
                ) : (
                  <Text style={styles.authSubmitText}>Log in</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <SignUpFlow
            canAutofocus={authTransitionReady}
            onToast={showToast}
            onSwitchToLogin={() => {
              Keyboard.dismiss();
              setAuthMode('login');
            }}
            onFinished={(displayName, username) => setSignupFinish({ displayName, username })}
            onUnderage={deleteUnderageSocialAccount}
          />
        )}
        </View>
      </Animated.View>

      {signupFinish ? (
        <SignupFinish
          displayName={signupFinish.displayName}
          username={signupFinish.username}
          title={signupFinish.title}
          subtitle={signupFinish.subtitle}
          onComplete={completeSignup}
        />
      ) : null}

      {toast ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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
  logoGlowFallback: {
    position: 'absolute',
    top: 104,
    left: 28,
    right: 28,
    height: 34,
    borderRadius: 24,
    backgroundColor: theme.colors.gold,
    shadowColor: theme.colors.gold,
    shadowOpacity: 0.28,
    shadowRadius: 26,
    elevation: 8,
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
  authCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4,
    backgroundColor: theme.colors.black,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  authCardKeyboard: {
    flex: 1,
    minHeight: 0,
  },
  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#14181D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
    backgroundColor: '#14181D',
    borderRadius: 22,
    padding: 3,
  },
  segmentSlot: {
    flex: 1,
    overflow: 'hidden',
  },
  segmentSlotHidden: {
    flex: 0,
  },
  segmentPill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    width: '50%',
    borderRadius: 19,
    backgroundColor: theme.colors.primary,
  },
  segmentButton: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: theme.colors.black,
  },
  authBody: {
    flex: 1,
    marginTop: 14,
  },
  authBodyContent: {
    paddingHorizontal: 2,
    paddingBottom: 16,
    gap: 12,
  },
  field: {
    height: 56,
    position: 'relative',
    backgroundColor: '#14181D',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#222A33',
    justifyContent: 'center',
  },
  fieldFocused: {
    borderColor: theme.colors.primary,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  fieldError: {
    borderColor: theme.colors.danger,
  },
  input: {
    height: 56,
    color: theme.colors.white,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 5,
  },
  inputFloated: {
    paddingTop: 22,
  },
  passwordInput: {
    paddingRight: 54,
  },
  fieldLabel: {
    position: 'absolute',
    left: 15,
    top: 17,
    color: theme.colors.textMuted,
    fontSize: 16,
  },
  fieldLabelFloated: {
    top: 6,
    fontSize: 11,
  },
  fieldLabelFocused: {
    color: theme.colors.primary,
  },
  eyeButton: {
    position: 'absolute',
    right: 4,
    top: 5,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    marginTop: 5,
    paddingHorizontal: 3,
  },
  forgotButton: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  linkText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#222A33',
  },
  dividerText: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  socialButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#14181D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialButtonPressed: {
    opacity: 0.78,
  },
  socialButtonDisabled: {
    opacity: 0.65,
  },
  socialButtonText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  authError: {
    color: theme.colors.danger,
    fontSize: 13,
  },
  signupNotice: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  authFooter: {
    paddingTop: 8,
  },
  authSubmit: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authSubmitDisabled: {
    opacity: 0.4,
  },
  authSubmitText: {
    color: theme.colors.black,
    fontSize: 16,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    zIndex: 8,
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toastText: {
    color: theme.colors.black,
    fontSize: 13,
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
