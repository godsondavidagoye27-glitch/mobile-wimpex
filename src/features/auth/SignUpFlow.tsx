import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeInRight,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../../components/Icon';
import { AuthField } from '../../components/AuthField';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import { scrollFocusedInputIntoView } from '../../hooks/useKeyboardInset';
import { runWithMinimumDuration } from './authTiming';
import { createEmptyOtp, isOtpComplete, normalizeOtpDigits, OTP_CELL_WIDTH, OTP_LENGTH } from './constants';
import {
  calculateAge,
  getSignupErrorMessage,
  getPasswordStrength,
  isReservedUsername,
  validateBirthday,
  validateCredentials,
  validateInterests,
  validateProfile,
} from './signupValidation';
import { useAuthFlow } from './useAuthFlow';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const interests = ['Music', 'Food', 'Sport', 'Travel', 'Gaming', 'Art', 'Tech', 'Fashion'];

type ButtonState = 'idle' | 'loading' | 'success';
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'failed';

function isNetworkError(error: unknown) {
  return getSignupErrorMessage(error).startsWith('No connection.');
}

function isRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number; code?: string; message?: string };
  return (
    candidate.status === 429 ||
    /rate.?limit|too many requests|over_request_rate_limit/i.test(
      `${candidate.code ?? ''} ${candidate.message ?? ''}`,
    )
  );
}

function OtpCell({
  index,
  digit,
  reduceMotion,
  inputRef,
  onChangeText,
  onKeyPress,
  onSubmitEditing,
  onFocusInput,
}: {
  index: number;
  digit: string;
  reduceMotion: boolean;
  inputRef: (input: TextInput | null) => void;
  onChangeText: (value: string) => void;
  onKeyPress: (key: string) => void;
  onSubmitEditing: () => void;
  onFocusInput?: () => void;
}) {
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (!digit || reduceMotion) return;
    scale.value = withSequence(
      withSpring(1.12, { damping: 8 }),
      withSpring(1, { damping: 10 }),
    );
  }, [digit, reduceMotion, scale]);

  return (
    <Animated.View style={[styles.codeCell, digit && styles.codeCellFilled, popStyle]}>
      <TextInput
        ref={inputRef}
        value={digit}
        onChangeText={onChangeText}
        onFocus={onFocusInput}
        onSubmitEditing={onSubmitEditing}
        onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key)}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete={index === 0 ? 'sms-otp' : 'off'}
        textContentType={index === 0 ? 'oneTimeCode' : 'none'}
        importantForAutofill={index === 0 ? 'yes' : 'no'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={index === OTP_LENGTH - 1 ? 'done' : 'next'}
        blurOnSubmit={false}
        maxLength={OTP_LENGTH}
        accessibilityLabel={`Digit ${index + 1}`}
        style={styles.codeInput}
      />
    </Animated.View>
  );
}

export function SignUpFlow({
  canAutofocus = true,
  onToast,
  onSwitchToLogin,
  onFinished,
  onUnderage,
}: {
  canAutofocus?: boolean;
  onToast: (message: string) => void;
  onSwitchToLogin: () => void;
  onFinished: (displayName: string, username: string) => void;
  onUnderage: () => Promise<void>;
}) {
  const flow = useAuthFlow();
  const reduceMotion = useReducedMotion();
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [screenError, setScreenError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [birthdayError, setBirthdayError] = useState('');
  const [code, setCode] = useState<string[]>(() => createEmptyOtp());
  const [codeError, setCodeError] = useState('');
  const [resendSeconds, setResendSeconds] = useState(30);
  const [resendCycle, setResendCycle] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameStatusText, setUsernameStatusText] = useState('');
  const [usernameStatusFor, setUsernameStatusFor] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [nameError, setNameError] = useState('');
  const [pickerError, setPickerError] = useState('');
  const [finishError, setFinishError] = useState('');
  const isSubmitting = useRef(false);
  const isVerifying = useRef(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const displayNameRef = useRef<TextInput>(null);
  const codeShake = useSharedValue(0);
  const codeShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: codeShake.value }],
  }));
  const step = flow.currentStep;
  const previousStep = useRef(step);
  const isAuthenticatedProfileFlow = flow.flowType !== 'email';
  const birthdayStep = isAuthenticatedProfileFlow ? 0 : 1;
  const codeStep = isAuthenticatedProfileFlow ? -1 : 2;
  const profileStep = isAuthenticatedProfileFlow ? 1 : 3;
  const interestsStep = isAuthenticatedProfileFlow ? 2 : 4;
  const stepCount = isAuthenticatedProfileFlow ? 3 : 5;
  const progressPercent = ((step + 1) / stepCount) * 100;
  const passwordStrength = getPasswordStrength(flow.password);
  const todayYear = new Date().getFullYear();
  const age =
    flow.birthMonth !== null && flow.birthDay !== null && flow.birthYear !== null
      ? calculateAge(flow.birthYear, flow.birthMonth, flow.birthDay)
      : null;

  useEffect(() => {
    if (!flow.hasHydrated) return;
    const stepChanged = previousStep.current !== step;
    if (stepChanged) {
      previousStep.current = step;
      Keyboard.dismiss();
    } else if (!canAutofocus || step !== codeStep) {
      return;
    }
    if (!canAutofocus) return;
    const timer = setTimeout(() => {
      if (step === codeStep) inputRefs.current[0]?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [canAutofocus, codeStep, flow.hasHydrated, step]);

  useEffect(() => {
    if (step !== codeStep) return;
    const interval = setInterval(() => {
      setResendSeconds((remaining) => {
        if (remaining <= 1) {
          clearInterval(interval);
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [codeStep, resendCycle, step]);

  const currentUsernameStatus =
    flow.username.length < 3
      ? 'idle'
      : isReservedUsername(flow.username)
        ? 'taken'
      : usernameStatusFor === flow.username
        ? usernameStatus
        : 'checking';
  const currentUsernameStatusText =
    flow.username.length < 3
      ? ''
      : isReservedUsername(flow.username)
        ? 'That username is not available.'
      : usernameStatusFor === flow.username
        ? usernameStatusText
        : 'Checking';

  useEffect(() => {
    if (step !== profileStep) return;
    const candidate = flow.username.toLowerCase();
    if (candidate.length < 3) return;
    if (isReservedUsername(candidate)) return;

    let active = true;
    const timer = setTimeout(() => {
      setUsernameStatusFor(candidate);
      setUsernameStatus('checking');
      setUsernameStatusText('Checking');
      void (async () => {
        try {
          const { data, error } = await getSupabaseClient().rpc('is_username_available', {
            name: candidate,
          });
          if (!active) return;
          if (error) throw error;
          const available = data === true;
          setUsernameStatus(available ? 'available' : 'taken');
          setUsernameStatusText(
            available ? 'Available' : 'That username is taken. Try another.',
          );
        } catch (error) {
          if (!active) return;
          if (__DEV__) console.error('Could not check signup username availability.', error);
          setUsernameStatus('failed');
          setUsernameStatusText(getSignupErrorMessage(error));
        }
      })();
    }, 450);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [flow.username, profileStep, step]);

  useEffect(() => {
    if (!codeError) return;
    if (reduceMotion) return;
    codeShake.value = withSequence(
      withTiming(-7, { duration: 55 }),
      withTiming(7, { duration: 55 }),
      withTiming(-7, { duration: 55 }),
      withTiming(7, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  }, [codeError, codeShake, reduceMotion]);

  const performAction = async (
    action: () => Promise<() => void>,
    onError: (error: unknown) => void,
  ) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setScreenError('');
    setButtonState('loading');

    try {
      const advance = await runWithMinimumDuration(action);
      setButtonState('success');
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      advance();
    } catch (error) {
      if (__DEV__) console.error('Signup action failed.', error);
      onError(error);
    } finally {
      setButtonState('idle');
      isSubmitting.current = false;
    }
  };

  const handleSignup = async () => {
    Keyboard.dismiss();
    setScreenError('');
    setFieldErrors({});

    if (step === 0 && !isAuthenticatedProfileFlow) {
      const errors = validateCredentials(flow.email.trim(), flow.password);
      if (errors.email) {
        setFieldErrors({ email: errors.email });
        return;
      }
      if (errors.password) {
        setFieldErrors({ password: errors.password });
        return;
      }
      setFieldErrors({});

      await performAction(
        async () => {
          const { data, error } = await getSupabaseClient().auth.signUp({
            email: flow.email.trim(),
            password: flow.password,
          });
          if (error) throw error;
          if (data.user?.identities?.length === 0) {
            throw new Error('An account with this email already exists. Log in instead.');
          }
          return () => {
            setCode(createEmptyOtp());
            setCodeError('');
            setResendSeconds(30);
            setResendCycle((cycle) => cycle + 1);
            flow.setSignupData({ currentStep: 1 });
          };
        },
        (error) => {
          setScreenError(
            isNetworkError(error)
              ? 'No connection. Check your internet and try again.'
              : getSignupErrorMessage(error),
          );
        },
      );
      return;
    }

    if (step === birthdayStep) {
      const result = validateBirthday(
        flow.birthMonth,
        flow.birthDay,
        flow.birthYear,
      );
      if ('error' in result && typeof result.error === 'string') {
        setBirthdayError(result.error);
        if (isAuthenticatedProfileFlow && result.error === 'You must be 13 or older to join Wimpex.') {
          await performAction(
            async () => {
              await onUnderage();
              return () => undefined;
            },
            (error) => setScreenError(getSignupErrorMessage(error)),
          );
        }
        return;
      }
      setBirthdayError('');
      await performAction(
        async () => () => {
          if (!isAuthenticatedProfileFlow) {
            setCode(createEmptyOtp());
            setCodeError('');
            setResendSeconds(30);
            setResendCycle((cycle) => cycle + 1);
          }
          flow.setSignupData({ currentStep: isAuthenticatedProfileFlow ? 1 : 2 });
        },
        (error) => setScreenError(getSignupErrorMessage(error)),
      );
      return;
    }

    if (step === codeStep) {
      if (!isOtpComplete(code)) {
        setCodeError('That code is not right. Check it and try again.');
        return;
      }
      await verifyCode(code.join(''));
      return;
    }

    if (step === profileStep) {
      const username = flow.username.toLowerCase();
      const validationError = validateProfile(username, flow.displayName);
      setUsernameError(
        validationError === 'Enter the name people will see.' ? '' : validationError ?? '',
      );
      setNameError(
        validationError === 'Enter the name people will see.'
          ? 'Enter the name people will see.'
          : '',
      );
      if (validationError) return;

      await performAction(
        async () => {
          const { data, error } = await getSupabaseClient().rpc('is_username_available', {
            name: username,
          });
          if (error) throw error;
          if (!data) {
            throw new Error(
              isReservedUsername(username)
                ? 'That username is not available.'
                : 'That username is taken. Try another.',
            );
          }
          return () => {
            flow.setSignupData({ username, currentStep: interestsStep });
            setUsernameError('');
          };
        },
        (error) => {
          const message = isNetworkError(error)
            ? 'Could not check this username. Try again.'
            : getSignupErrorMessage(error);
          setUsernameError(message);
          setUsernameStatus(message.includes('taken') ? 'taken' : 'failed');
          setUsernameStatusText(message);
        },
      );
      return;
    }

    if (step === interestsStep) {
      if (!validateInterests(flow.interests)) return;
      setFinishError('');
      await performAction(
        async () => {
          const client = getSupabaseClient();
          const { data: sessionData, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          const user = sessionData.session?.user;
          if (!user) throw new Error('Your session expired. Log in and try again.');

          let avatarUrl: string | null = null;
          if (flow.avatarUri) {
            const photo = await fetch(flow.avatarUri);
            if (!photo.ok) throw new Error('Unable to read the selected photo.');
            const photoBlob = await photo.blob();
            const { error: uploadError } = await client.storage
              .from('avatars')
              .upload(`${user.id}/avatar.jpg`, photoBlob, {
                contentType: 'image/jpeg',
                upsert: true,
              });
            if (uploadError) throw uploadError;
            avatarUrl = client.storage
              .from('avatars')
              .getPublicUrl(`${user.id}/avatar.jpg`).data.publicUrl;
          }

          if (flow.birthMonth === null || flow.birthDay === null || flow.birthYear === null) {
            throw new Error('Choose your month, day and year.');
          }

          const dateOfBirth = new Date(
            Date.UTC(flow.birthYear, flow.birthMonth - 1, flow.birthDay),
          )
            .toISOString()
            .slice(0, 10);
          const profile = {
            id: user.id,
            username: flow.username,
            display_name: flow.displayName.trim(),
            avatar_url: avatarUrl,
            date_of_birth: dateOfBirth,
          };
          const { error: profileError } = await client.from('profiles').insert(profile);
          if (profileError) {
            if (profileError.code === '23505') {
              const { data: existingProfile, error: lookupError } = await client
                .from('profiles')
                .select('username, display_name, avatar_url, date_of_birth')
                .eq('id', user.id)
                .maybeSingle();
              if (lookupError) throw lookupError;
              const isSameProfile = existingProfile
                && existingProfile.username === profile.username
                && existingProfile.display_name === profile.display_name
                && existingProfile.avatar_url === profile.avatar_url
                && existingProfile.date_of_birth === profile.date_of_birth;
              if (!isSameProfile) throw profileError;
            } else {
              if (isAuthenticatedProfileFlow && profileError.code === '23514') await onUnderage();
              throw profileError;
            }
          }

          const profileInterests = flow.interests.map((interest) => ({
            profile_id: user.id,
            interest,
          }));
          const { error: interestsError } = await client
            .from('profile_interests')
            .upsert(profileInterests, { onConflict: 'profile_id,interest' });
          if (interestsError) throw interestsError;

          return () => {
            const { displayName, username } = flow;
            flow.resetSignup();
            onFinished(displayName.trim(), username);
          };
        },
        (error) => {
          if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
            flow.setSignupData({ currentStep: profileStep });
            setUsernameStatus('taken');
            setUsernameStatusText('That username is taken. Try another.');
            setUsernameError('That username is taken. Try another.');
            return;
          }
          setFinishError(getSignupErrorMessage(error));
        },
      );
    }
  };

  const verifyCode = async (token: string) => {
    if (isVerifying.current || token.length !== OTP_LENGTH) return;
    isVerifying.current = true;
    setCodeError('');
    setButtonState('loading');

    try {
      await runWithMinimumDuration(async () => {
        const { data, error } = await getSupabaseClient().auth.verifyOtp({
          email: flow.email.trim(),
          token,
          type: 'signup',
        });
        if (error) throw error;
        if (!data.session) throw new Error('Email verification did not create a session.');
      });
      flow.clearPassword();
      setButtonState('success');
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      flow.setSignupData({ currentStep: 3 });
      setCode(createEmptyOtp());
    } catch (error) {
      if (__DEV__) console.error('Signup email verification failed.', error);
      setCodeError(
        isRateLimitError(error)
          ? 'Too many attempts. Wait a minute and try again.'
          : isNetworkError(error)
            ? 'No connection. Check your internet and try again.'
            : 'That code is not right. Check it and try again.',
      );
      setCode(createEmptyOtp());
      setTimeout(() => inputRefs.current[0]?.focus(), 80);
    } finally {
      setButtonState('idle');
      isVerifying.current = false;
    }
  };

  const setOtpDigit = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    setCodeError('');
    if (digits.length > 1) {
      const filled = normalizeOtpDigits(digits);
      setCode(filled);
      if (isOtpComplete(filled)) void verifyCode(filled.join(''));
      else inputRefs.current[Math.min(filled.join('').length, OTP_LENGTH - 1)]?.focus();
      return;
    }

    const next = [...code];
    next[index] = digits;
    setCode(next);
    if (digits && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    if (isOtpComplete(next)) void verifyCode(next.join(''));
  };

  const resendCode = async () => {
    if (resendBusy || resendSeconds > 0) return;
    setResendBusy(true);
    setCodeError('');
    try {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup',
        email: flow.email.trim(),
      });
      if (error) throw error;
      setResendSeconds(30);
      setResendCycle((cycle) => cycle + 1);
      onToast('New code sent');
    } catch (error) {
      setCodeError(
        isRateLimitError(error)
          ? 'Too many attempts. Wait a minute and try again.'
          : isNetworkError(error)
            ? 'No connection. Check your internet and try again.'
            : getSignupErrorMessage(error),
      );
    } finally {
      setResendBusy(false);
    }
  };

  const chooseAvatar = async () => {
    setPickerError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickerError('Allow photo library access to choose a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        flow.setSignupData({ avatarUri: result.assets[0].uri });
      }
    } catch (error) {
      setPickerError(getSignupErrorMessage(error));
    }
  };

  const renderStep = () => {
    if (step === 0 && !isAuthenticatedProfileFlow) {
      return (
        <>
          <Text style={styles.title}>Create your account</Text>
          <AuthField
            label="Email"
            value={flow.email}
            onChangeText={(email) => {
              flow.setSignupData({ email });
              setFieldErrors((current) => ({ ...current, email: undefined }));
              setScreenError('');
            }}
            keyboardType="email-address"
            textContentType="emailAddress"
            importantForAutofill="yes"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={fieldErrors.email}
            inputRef={emailRef}
            onFocusInput={() => scrollFocusedInputIntoView(scrollRef.current, emailRef.current, scrollOffset.current)}
          />
          <AuthField
            label="Password"
            value={flow.password}
            onChangeText={(password) => {
              flow.setSignupData({ password });
              setFieldErrors((current) => ({ ...current, password: undefined }));
              setScreenError('');
            }}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            importantForAutofill="yes"
            returnKeyType="done"
            onSubmitEditing={() => void handleSignup()}
            error={fieldErrors.password}
            inputRef={passwordRef}
            onFocusInput={() => scrollFocusedInputIntoView(scrollRef.current, passwordRef.current, scrollOffset.current)}
          />
          <View style={styles.strengthMeter} accessibilityLabel={`Password strength ${passwordStrength.score} of 4`}>
            {[0, 1, 2, 3].map((segment) => (
              <View
                key={segment}
                style={[
                  styles.strengthSegment,
                  segment < passwordStrength.score && styles.strengthSegmentActive,
                  passwordStrength.score === 4 && segment < passwordStrength.score && styles.strengthSegmentStrong,
                ]}
              />
            ))}
          </View>
          <View style={styles.checklist}>
            {['At least 8 characters', 'A number', 'An uppercase letter'].map((rule, index) => (
              <View key={rule} style={styles.checklistRow}>
                <View style={[styles.ruleCheck, passwordStrength.rules[index] && styles.ruleCheckActive]}>
                  {passwordStrength.rules[index] ? (
                    <Icon name="check" size={20} color={theme.colors.black} />
                  ) : null}
                </View>
                <Text style={[styles.checklistText, passwordStrength.rules[index] && styles.checklistTextActive]}>
                  {rule}
                </Text>
              </View>
            ))}
          </View>
          {screenError ? (
            <View>
              <Text accessibilityRole="alert" style={styles.errorText}>{screenError}</Text>
              {screenError === 'An account with this email already exists. Log in instead.' ? (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    onSwitchToLogin();
                  }}
                  accessibilityRole="button"
                  style={styles.inlineAction}
                >
                  <Text style={styles.linkText}>Log in</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      );
    }

    if (step === birthdayStep) {
      const yearOptions = Array.from({ length: 121 }, (_, index) => todayYear - index);
      return (
        <>
          <Text style={styles.title}>When is your birthday?</Text>
          <Text style={styles.description}>We use this to set the right privacy defaults.</Text>
          <View style={styles.dateRow}>
            <View style={[styles.pickerWrap, styles.monthPicker]}>
              <Picker
                selectedValue={flow.birthMonth ?? 0}
                onValueChange={(value) => {
                  flow.setSignupData({ birthMonth: value === 0 ? null : Number(value) });
                  setBirthdayError('');
                }}
                dropdownIconColor={theme.colors.textMuted}
                style={styles.picker}
              >
                <Picker.Item label="Month" value={0} color={theme.colors.textMuted} />
                {monthNames.map((month, index) => (
                  <Picker.Item key={month} label={month} value={index + 1} color={theme.colors.white} />
                ))}
              </Picker>
            </View>
            <View style={[styles.pickerWrap, styles.dayPicker]}>
              <Picker
                selectedValue={flow.birthDay ?? 0}
                onValueChange={(value) => {
                  flow.setSignupData({ birthDay: value === 0 ? null : Number(value) });
                  setBirthdayError('');
                }}
                dropdownIconColor={theme.colors.textMuted}
                style={styles.picker}
              >
                <Picker.Item label="Day" value={0} color={theme.colors.textMuted} />
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <Picker.Item key={day} label={String(day)} value={day} color={theme.colors.white} />
                ))}
              </Picker>
            </View>
            <View style={[styles.pickerWrap, styles.yearPicker]}>
              <Picker
                selectedValue={flow.birthYear ?? 0}
                onValueChange={(value) => {
                  flow.setSignupData({ birthYear: value === 0 ? null : Number(value) });
                  setBirthdayError('');
                }}
                dropdownIconColor={theme.colors.textMuted}
                style={styles.picker}
              >
                <Picker.Item label="Year" value={0} color={theme.colors.textMuted} />
                {yearOptions.map((year) => (
                  <Picker.Item key={year} label={String(year)} value={year} color={theme.colors.white} />
                ))}
              </Picker>
            </View>
          </View>
          {age !== null && age >= 13 && age < 18 ? (
            <View style={styles.privacyNote}>
              <Text style={styles.description}>
                Your account starts private and only friends can message you.
              </Text>
            </View>
          ) : null}
          {birthdayError ? <Text accessibilityRole="alert" style={styles.errorText}>{birthdayError}</Text> : null}
        </>
      );
    }

    if (step === codeStep) {
      return (
        <>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.description}>
            Enter the {OTP_LENGTH} digit code sent to {flow.email.trim()}.
          </Text>
          <Animated.View style={[styles.codeRow, codeShakeStyle]}>
            {code.map((digit, index) => (
              <OtpCell
                key={index}
                index={index}
                digit={digit}
                reduceMotion={reduceMotion}
                inputRef={(input) => {
                  inputRefs.current[index] = input;
                }}
                onChangeText={(value) => setOtpDigit(index, value)}
                onFocusInput={() => scrollFocusedInputIntoView(
                  scrollRef.current,
                  inputRefs.current[index],
                  scrollOffset.current,
                )}
                onSubmitEditing={() => {
                  if (index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
                  else void verifyCode(code.join(''));
                }}
                onKeyPress={(key) => {
                  if (key === 'Backspace' && !code[index] && index > 0) {
                    inputRefs.current[index - 1]?.focus();
                  }
                }}
              />
            ))}
          </Animated.View>
          {codeError ? <Text accessibilityRole="alert" style={styles.errorText}>{codeError}</Text> : null}
          <Pressable
            onPress={() => void resendCode()}
            disabled={resendSeconds > 0 || resendBusy}
            accessibilityRole="button"
            style={styles.resendButton}
          >
            {resendBusy ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
            <Text style={[styles.linkText, resendSeconds > 0 && styles.mutedLink]}>
              {resendSeconds > 0 ? `Resend code in ${resendSeconds}` : 'Resend code'}
            </Text>
          </Pressable>
        </>
      );
    }

    if (step === profileStep) {
      const avatarInitial = flow.displayName.trim().slice(0, 1).toUpperCase();
      return (
        <>
          <Pressable
            onPress={() => void chooseAvatar()}
            accessibilityRole="button"
            accessibilityLabel="Choose profile photo"
            style={styles.avatarPicker}
          >
            {flow.avatarUri ? (
              <Image source={{ uri: flow.avatarUri }} style={styles.avatarImage} />
            ) : avatarInitial ? (
              <Text style={styles.avatarInitial}>{avatarInitial}</Text>
            ) : (
              <Icon name="plus" size={24} color={theme.colors.primary} />
            )}
          </Pressable>
          <AuthField
            label="Username"
            value={flow.username}
            onChangeText={(username) => {
              flow.setSignupData({ username: username.toLowerCase() });
              setUsernameError('');
            }}
            autoComplete="off"
            textContentType="none"
            error={usernameError && !currentUsernameStatusText ? usernameError : undefined}
            inputRef={usernameRef}
            returnKeyType="next"
            onSubmitEditing={() => displayNameRef.current?.focus()}
            onFocusInput={() => scrollFocusedInputIntoView(scrollRef.current, usernameRef.current, scrollOffset.current)}
          />
          <View style={styles.usernameStatus}>
            {currentUsernameStatus === 'checking' ? (
              <>
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
                <Text style={styles.statusMuted}>Checking</Text>
              </>
            ) : currentUsernameStatus === 'available' ? (
              <>
                <Icon name="check" size={20} color={theme.colors.success} />
                <Text style={styles.statusSuccess}>Available</Text>
              </>
            ) : currentUsernameStatusText ? (
              <Text
                style={[
                  styles.statusError,
                  currentUsernameStatus === 'failed' && styles.statusMuted,
                ]}
              >
                {currentUsernameStatusText}
              </Text>
            ) : null}
          </View>
          <AuthField
            label="Display name"
            value={flow.displayName}
            onChangeText={(displayName) => {
              flow.setSignupData({ displayName });
              setNameError('');
            }}
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
            onSubmitEditing={() => void handleSignup()}
            inputRef={displayNameRef}
            error={nameError}
            onFocusInput={() => scrollFocusedInputIntoView(scrollRef.current, displayNameRef.current, scrollOffset.current)}
          />
          {pickerError ? <Text accessibilityRole="alert" style={styles.errorText}>{pickerError}</Text> : null}
          {screenError ? <Text accessibilityRole="alert" style={styles.errorText}>{screenError}</Text> : null}
        </>
      );
    }

    return (
      <>
        <Text style={styles.title}>Pick your interests</Text>
        <Text style={styles.description}>
          {flow.interests.length === 0
            ? 'Choose at least 3.'
            : flow.interests.length < 3
              ? `${flow.interests.length} selected, choose at least 3.`
              : `${flow.interests.length} selected.`}
        </Text>
        <View style={styles.interests}>
          {interests.map((interest) => {
            const selected = flow.interests.includes(interest);
            return (
              <Pressable
                key={interest}
                onPress={() => {
                  const next = selected
                    ? flow.interests.filter((item) => item !== interest)
                    : [...flow.interests, interest];
                  flow.setSignupData({ interests: next });
                  setFinishError('');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.interestChip, selected && styles.interestChipSelected]}
              >
                <Text style={[styles.interestText, selected && styles.interestTextSelected]}>
                  {interest}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {finishError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>{finishError}</Text>
        ) : null}
      </>
    );
  };

  const submitLabel = step === codeStep ? 'Verify' : step === interestsStep ? 'Create account' : 'Continue';
  const disabled =
    buttonState !== 'idle' ||
    (step === codeStep && !isOtpComplete(code)) ||
    (step === interestsStep && !validateInterests(flow.interests));

  if (!flow.hasHydrated) {
    return (
      <View style={styles.hydrating}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
        <View style={styles.progressTrack}>
          <Animated.View
            layout={reduceMotion ? undefined : LinearTransition.duration(500)}
            style={[styles.progressFill, { width: `${progressPercent}%` }]}
          />
        </View>
        <ScrollView
          ref={scrollRef}
          onScroll={(event) => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            key={step}
            entering={reduceMotion ? undefined : FadeInRight.duration(400)}
            style={styles.stepContent}
          >
            {renderStep()}
          </Animated.View>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            onPress={() => void handleSignup()}
            disabled={disabled}
            accessibilityRole="button"
            style={[styles.submitButton, disabled && styles.submitButtonDisabled]}
          >
            {buttonState === 'loading' ? (
              <ActivityIndicator size="small" color={theme.colors.black} />
            ) : buttonState === 'success' ? (
              <Icon name="check" size={24} color={theme.colors.black} />
            ) : (
              <Text style={styles.submitText}>{submitLabel}</Text>
            )}
          </Pressable>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
  },
  hydrating: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 14,
    overflow: 'hidden',
    backgroundColor: theme.colors.line,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.colors.success,
  },
  body: {
    flex: 1,
    marginTop: 14,
  },
  bodyContent: {
    paddingHorizontal: 2,
    paddingBottom: 16,
    gap: 12,
  },
  stepContent: {
    gap: 12,
  },
  title: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    height: 56,
    position: 'relative',
    backgroundColor: '#111418',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#1e242b',
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
    width: OTP_CELL_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  strengthMeter: {
    flexDirection: 'row',
    gap: 6,
    marginTop: -4,
  },
  strengthSegment: {
    height: 5,
    flex: 1,
    borderRadius: 3,
    backgroundColor: theme.colors.line,
  },
  strengthSegmentActive: {
    backgroundColor: theme.colors.primary,
  },
  strengthSegmentStrong: {
    backgroundColor: theme.colors.success,
  },
  checklist: {
    gap: 8,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ruleCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleCheckActive: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
  },
  checklistText: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  checklistTextActive: {
    color: theme.colors.white,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
  },
  linkText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pickerWrap: {
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.colors.line,
    backgroundColor: '#111418',
  },
  monthPicker: {
    flex: 1.4,
  },
  dayPicker: {
    flex: 1,
  },
  yearPicker: {
    flex: 1.1,
  },
  picker: {
    color: theme.colors.white,
    height: 56,
    marginHorizontal: -6,
  },
  privacyNote: {
    backgroundColor: '#111418',
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  codeCell: {
    width: 44,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.colors.line,
    backgroundColor: '#111418',
  },
  codeCellFilled: {
    borderColor: theme.colors.primary,
    transform: [{ scale: 1.02 }],
  },
  codeInput: {
    width: '100%',
    height: '100%',
    color: theme.colors.white,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
  },
  resendButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mutedLink: {
    color: theme.colors.textMuted,
  },
  avatarPicker: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 28,
  },
  usernameStatus: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -7,
  },
  statusMuted: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  statusSuccess: {
    color: theme.colors.success,
    fontSize: 13,
  },
  statusError: {
    color: theme.colors.danger,
    fontSize: 13,
  },
  interests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#111418',
  },
  interestChipSelected: {
    backgroundColor: theme.colors.primary,
    transform: [{ scale: 1.05 }],
  },
  interestText: {
    color: theme.colors.white,
    fontWeight: '600',
  },
  interestTextSelected: {
    color: theme.colors.black,
  },
  footer: {
    paddingTop: 8,
  },
  submitButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: theme.colors.black,
    fontSize: 16,
    fontWeight: '700',
  },
});
