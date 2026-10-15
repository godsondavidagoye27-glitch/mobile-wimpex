import { forwardRef, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { theme } from '../theme/theme';

type AuthFieldProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style' | 'secureTextEntry'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  inputRef?: RefObject<TextInput | null>;
  onFocusInput?: () => void;
  secureTextEntry?: boolean;
  shakeOnError?: boolean;
  fieldStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
};

export function AuthField({
  label,
  value,
  onChangeText,
  error,
  inputRef,
  onFocusInput,
  secureTextEntry = false,
  shakeOnError = false,
  fieldStyle,
  inputStyle,
  errorStyle,
  onFocus,
  onBlur,
  ...inputProps
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const localInputRef = useRef<TextInput>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));
  const floated = focused || value.length > 0;

  useEffect(() => {
    if (!error || !shakeOnError) return;
    shake.value = withSequence(
      withTiming(-6, { duration: 70 }),
      withTiming(6, { duration: 70 }),
      withTiming(-6, { duration: 70 }),
      withTiming(6, { duration: 70 }),
      withTiming(0, { duration: 70 }),
    );
  }, [error, shake, shakeOnError]);

  return (
    <Animated.View style={shakeStyle}>
      <Pressable
        onPress={() => resolvedInputRef.current?.focus()}
        style={[styles.field, focused && styles.fieldFocused, error && styles.fieldError, fieldStyle]}
        accessibilityRole="none"
      >
        <TextInput
          {...inputProps}
          ref={resolvedInputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
            onFocusInput?.();
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          secureTextEntry={secureTextEntry && !passwordVisible}
          blurOnSubmit={inputProps.returnKeyType === 'next' ? false : inputProps.blurOnSubmit}
          autoCapitalize={inputProps.autoCapitalize ?? 'none'}
          autoCorrect={inputProps.autoCorrect ?? false}
          cursorColor={theme.colors.primary}
          keyboardAppearance={inputProps.keyboardAppearance ?? 'dark'}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          style={[styles.input, floated && styles.inputFloated, secureTextEntry && styles.passwordInput, inputStyle]}
        />
        <Text
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.fieldLabel, floated && styles.fieldLabelFloated, focused && styles.fieldLabelFocused]}
        >
          {label}
        </Text>
        {secureTextEntry ? (
          <Pressable
            onPress={() => setPasswordVisible((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            style={styles.eyeButton}
          >
            <Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {error ? <Text style={[styles.error, errorStyle]}>{error}</Text> : null}
    </Animated.View>
  );
}

export const FocusableTextInput = forwardRef<TextInput, TextInputProps>(function FocusableTextInput(
  { onTouchStart, ...props },
  forwardedRef,
) {
  const inputRef = useRef<TextInput>(null);
  const setInputRef = useCallback((input: TextInput | null) => {
    inputRef.current = input;
    if (typeof forwardedRef === 'function') forwardedRef(input);
    else if (forwardedRef) forwardedRef.current = input;
  }, [forwardedRef]);

  return (
    <TextInput
      {...props}
      ref={setInputRef}
      onTouchStart={(event) => {
        inputRef.current?.focus();
        onTouchStart?.(event);
      }}
    />
  );
});

const styles = StyleSheet.create({
  field: {
    height: 56,
    position: 'relative',
    overflow: 'hidden',
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
    ...StyleSheet.absoluteFillObject,
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
  error: {
    color: theme.colors.danger,
    fontSize: 13,
    marginTop: 5,
    paddingHorizontal: 3,
  },
});
