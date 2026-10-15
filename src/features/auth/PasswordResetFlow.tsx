import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import Animated, {
  FadeInRight,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../../components/Icon';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import { runWithMinimumDuration } from './authTiming';
import { createEmptyOtp, isOtpComplete, normalizeOtpDigits, OTP_CELL_WIDTH, OTP_LENGTH } from './constants';
import {
  changePasswordResetStep,
  getPasswordStrength,
  validatePasswordMatch,
} from './signupValidation';

type ButtonState = 'idle' | 'loading' | 'success';

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value);

function ResetField({
  label,
  value,
  onChangeText,
  keyboardType,
  secureTextEntry,
  error,
  inputRef,
  autoComplete,
  textContentType,
  importantForAutofill,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'email-address';
  secureTextEntry?: boolean;
  error?: string;
  inputRef?: React.RefObject<TextInput | null>;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  importantForAutofill?: TextInputProps['importantForAutofill'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const floated = focused || value.length > 0;

  return (
    <View>
      <View style={[styles.field, focused && styles.fieldFocused, error && styles.fieldError]}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={returnKeyType === 'next' ? false : undefined}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          textContentType={textContentType}
          importantForAutofill={importantForAutofill}
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor={theme.colors.primary}
          secureTextEntry={secureTextEntry && !visible}
          keyboardAppearance="dark"
          returnKeyType={returnKeyType}
          accessibilityLabel={label}
          style={[styles.input, floated && styles.inputFloated, secureTextEntry && styles.passwordInput]}
        />
        <Text style={[styles.fieldLabel, floated && styles.fieldLabelFloated, focused && styles.fieldLabelFocused]}>
          {label}
        </Text>
        {secureTextEntry ? (
          <Pressable
            onPress={() => setVisible((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            style={styles.eyeButton}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function isRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number; code?: string; message?: string };
  return candidate.status === 429 || /rate.?limit|too many requests/i.test(
    `${candidate.code ?? ''} ${candidate.message ?? ''}`,
  );
}

function isNetworkError(error: unknown) {
  return error instanceof Error && /network|fetch|offline|connection|internet/i.test(error.message);
}

export function PasswordResetFlow({
  email: initialEmail,
  step,
  setStep,
  onToast,
  onFinished,
}: {
  email: string;
  step: number;
  setStep: (step: number) => void;
  onToast: (message: string) => void;
  onFinished: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState<string[]>(() => createEmptyOtp());
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [resendSeconds, setResendSeconds] = useState(30);
  const [resendCycle, setResendCycle] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [passwordError, setPasswordError] = useState('');
  const reduceMotion = useReducedMotion();
  const refs = useRef<(TextInput | null)[]>([]);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const submitting = useRef(false);
  const verifying = useRef(false);
  const strength = getPasswordStrength(newPassword);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const progressPercent = ((step + 1) / 3) * 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (step === 0) emailRef.current?.focus();
      if (step === 1) refs.current[0]?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [resendCycle, step]);

  useEffect(() => {
    if (step !== 1) return;
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
  }, [resendCycle, step]);

  useEffect(() => {
    if (!error || reduceMotion) return;
    // Reanimated shared values are intentionally updated imperatively for this shake.
    // eslint-disable-next-line react-hooks/immutability
    shake.value = withSequence(
      withTiming(-7, { duration: 55 }),
      withTiming(7, { duration: 55 }),
      withTiming(-7, { duration: 55 }),
      withTiming(7, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  }, [error, reduceMotion, shake]);

  const runAction = async (action: () => Promise<() => void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setError('');
    setButtonState('loading');
    try {
      const advance = await runWithMinimumDuration(action);
      setButtonState('success');
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      advance();
    } catch (caught) {
      setError(
        isRateLimitError(caught)
          ? 'Too many attempts. Wait a minute and try again.'
          : isNetworkError(caught)
            ? 'No connection. Check your internet and try again.'
            : caught instanceof Error
              ? caught.message
              : 'Unable to reset your password. Try again.',
      );
    } finally {
      setButtonState('idle');
      submitting.current = false;
    }
  };

  const verifyCode = async (token: string) => {
    if (verifying.current || token.length !== OTP_LENGTH) return;
    verifying.current = true;
    setError('');
    setButtonState('loading');
    try {
      await runWithMinimumDuration(async () => {
        const { error: verifyError } = await getSupabaseClient().auth.verifyOtp({
          email: email.trim(),
          token,
          type: 'recovery',
        });
        if (verifyError) throw verifyError;
      });
      setButtonState('success');
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      setCode(createEmptyOtp());
      setStep(changePasswordResetStep(step, 'next'));
    } catch (caught) {
      setError(
        isRateLimitError(caught)
          ? 'Too many attempts. Wait a minute and try again.'
          : isNetworkError(caught)
            ? 'No connection. Check your internet and try again.'
            : 'That code is not right. Check it and try again.',
      );
      setCode(createEmptyOtp());
      setTimeout(() => refs.current[0]?.focus(), 80);
    } finally {
      setButtonState('idle');
      verifying.current = false;
    }
  };

  const setDigit = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    setError('');
    if (digits.length > 1) {
      const filled = normalizeOtpDigits(digits);
      setCode(filled);
      if (isOtpComplete(filled)) void verifyCode(filled.join(''));
      else refs.current[filled.findIndex((digit) => !digit)]?.focus();
      return;
    }
    const next = [...code];
    next[index] = digits;
    setCode(next);
    if (digits && index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
    if (isOtpComplete(next)) void verifyCode(next.join(''));
  };

  const resendCode = async () => {
    if (resendBusy || resendSeconds > 0) return;
    setResendBusy(true);
    setError('');
    try {
      const { error: requestError } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim());
      if (requestError) throw requestError;
      setResendSeconds(30);
      setResendCycle((cycle) => cycle + 1);
      onToast('New code sent');
    } catch (caught) {
      setError(
        isRateLimitError(caught)
          ? 'Too many attempts. Wait a minute and try again.'
          : isNetworkError(caught)
            ? 'No connection. Check your internet and try again.'
            : 'Unable to send a new code. Try again.',
      );
    } finally {
      setResendBusy(false);
    }
  };

  const submit = async () => {
    Keyboard.dismiss();
    if (step === 0) {
      if (!validEmail(email.trim())) {
        setEmailError('Enter a valid email address.');
        return;
      }
      setEmailError('');
      await runAction(async () => {
        const { error: requestError } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim());
        if (requestError) throw requestError;
        return () => setStep(changePasswordResetStep(step, 'next'));
      });
      return;
    }
    if (step === 1) {
      if (!isOtpComplete(code)) {
        setError('That code is not right. Check it and try again.');
        return;
      }
      await verifyCode(code.join(''));
      return;
    }
    const validationError = validatePasswordMatch(newPassword, confirmation);
    setPasswordError(validationError ?? '');
    if (validationError) return;
    await runAction(async () => {
      const { error: updateError } = await getSupabaseClient().auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;
      return () => {
        onToast('Password updated');
        onFinished();
      };
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <Animated.View
          layout={reduceMotion ? undefined : LinearTransition.duration(500)}
          style={[styles.progressFill, { width: `${progressPercent}%` }]}
        />
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View key={step} entering={reduceMotion ? undefined : FadeInRight.duration(400)} style={styles.step}>
          {step === 0 ? (
            <>
              <Text style={styles.title}>Reset your password</Text>
              <Text style={styles.description}>Enter your email and we will send you a {OTP_LENGTH} digit code.</Text>
              <ResetField
                label="Email"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailError('');
                }}
                keyboardType="email-address"
                error={emailError}
                inputRef={emailRef}
                autoComplete="email"
                textContentType="emailAddress"
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
              />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            </>
          ) : step === 1 ? (
            <>
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.description}>
                If an account exists for {email.trim()}, enter the {OTP_LENGTH} digit code we sent.
              </Text>
              <Animated.View style={[styles.codeRow, shakeStyle]}>
                {code.map((digit, index) => (
                  <View key={index} style={[styles.codeCell, digit && styles.codeCellFilled]}>
                    <TextInput
                      ref={(input) => {
                        refs.current[index] = input;
                      }}
                      value={digit}
                      onChangeText={(value) => setDigit(index, value)}
                      onSubmitEditing={() => {
                        if (index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
                        else void verifyCode(code.join(''));
                      }}
                      onKeyPress={({ nativeEvent }) => {
                        if (nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
                          refs.current[index - 1]?.focus();
                        }
                      }}
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
                  </View>
                ))}
              </Animated.View>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={() => void resendCode()}
                disabled={resendSeconds > 0 || resendBusy}
                accessibilityRole="button"
                style={styles.resend}
              >
                {resendBusy ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
                <Text style={[styles.link, resendSeconds > 0 && styles.mutedLink]}>
                  {resendSeconds > 0 ? `Resend code in ${resendSeconds}` : 'Resend code'}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Choose a new password</Text>
              <ResetField
                label="New password"
                value={newPassword}
                onChangeText={(value) => {
                  setNewPassword(value);
                  setPasswordError('');
                }}
                secureTextEntry
                inputRef={passwordRef}
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
                returnKeyType="next"
                onSubmitEditing={() => confirmationRef.current?.focus()}
              />
              <View style={styles.strengthMeter}>
                {[0, 1, 2, 3].map((segment) => (
                  <View
                    key={segment}
                    style={[
                      styles.strengthSegment,
                      segment < strength.score && styles.strengthSegmentActive,
                      strength.score === 4 && segment < strength.score && styles.strengthSegmentStrong,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.checklist}>
                {['At least 8 characters', 'A number', 'An uppercase letter'].map((rule, index) => (
                  <View key={rule} style={styles.checklistRow}>
                    <View style={[styles.ruleCheck, strength.rules[index] && styles.ruleCheckActive]}>
                      {strength.rules[index] ? <Icon name="check" size={20} color={theme.colors.black} /> : null}
                    </View>
                    <Text style={styles.checklistText}>{rule}</Text>
                  </View>
                ))}
              </View>
              <ResetField
                label="Confirm password"
                value={confirmation}
                onChangeText={(value) => {
                  setConfirmation(value);
                  setPasswordError('');
                }}
                secureTextEntry
                inputRef={confirmationRef}
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
                error={passwordError}
              />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            </>
          )}
        </Animated.View>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={() => void submit()}
          disabled={buttonState !== 'idle' || (step === 1 && !isOtpComplete(code))}
          accessibilityRole="button"
          style={[styles.submit, buttonState !== 'idle' && styles.disabled]}
        >
          {buttonState === 'loading' ? (
            <ActivityIndicator size="small" color={theme.colors.black} />
          ) : buttonState === 'success' ? (
            <Icon name="check" size={24} color={theme.colors.black} />
          ) : (
            <Text style={styles.submitText}>
              {step === 0 ? 'Send code' : step === 1 ? 'Verify' : 'Update password'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignSelf: 'stretch', minHeight: 0 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 14,
    overflow: 'hidden',
    backgroundColor: theme.colors.line,
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: theme.colors.success },
  body: { flex: 1, marginTop: 14 },
  bodyContent: { paddingHorizontal: 2, paddingBottom: 16, gap: 12 },
  step: { gap: 12 },
  title: { color: theme.colors.white, fontSize: 22, fontWeight: '700' },
  description: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
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
  fieldError: { borderColor: theme.colors.danger },
  input: { height: 56, color: theme.colors.white, fontSize: 16, paddingHorizontal: 14, paddingTop: 18 },
  inputFloated: { paddingTop: 22 },
  passwordInput: { paddingRight: 54 },
  fieldLabel: { position: 'absolute', left: 15, top: 17, color: theme.colors.textMuted, fontSize: 16 },
  fieldLabelFloated: { top: 6, fontSize: 11 },
  fieldLabelFocused: { color: theme.colors.primary },
  eyeButton: {
    position: 'absolute',
    right: 4,
    top: 5,
    width: OTP_CELL_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  codeCell: {
    width: 44,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.line,
    backgroundColor: '#14181D',
  },
  codeCellFilled: { borderColor: theme.colors.primary },
  codeInput: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  error: { color: theme.colors.danger, fontSize: 13 },
  resend: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  link: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  mutedLink: { color: theme.colors.textMuted },
  strengthMeter: { flexDirection: 'row', gap: 6, marginTop: -4 },
  strengthSegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.colors.line },
  strengthSegmentActive: { backgroundColor: theme.colors.primary },
  strengthSegmentStrong: { backgroundColor: theme.colors.success },
  checklist: { gap: 5 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleCheckActive: { borderColor: theme.colors.success, backgroundColor: theme.colors.success },
  checklistText: { color: theme.colors.textMuted, fontSize: 13 },
  footer: { paddingTop: 8 },
  submit: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  submitText: { color: theme.colors.black, fontSize: 16, fontWeight: '700' },
});
