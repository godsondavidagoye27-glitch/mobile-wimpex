import { createElement, useCallback, type ReactNode } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateKeyboardLayout } from './keyboardLayout';

export { calculateKeyboardLayout } from './keyboardLayout';

export function useKeyboardInset() {
  const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: false });
  const insets = useSafeAreaInsets();
  const containerHeight = useSharedValue(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    // Shared values are written from layout events to avoid a React render per frame.
    // eslint-disable-next-line react-hooks/immutability
    containerHeight.value = event.nativeEvent.layout.height;
  }, [containerHeight]);

  const contentStyle = useAnimatedStyle(() => {
    const layout = calculateKeyboardLayout(
      containerHeight.value,
      insets.bottom,
      keyboard.height.value,
    );
    return containerHeight.value > 0
      ? { height: layout.availableHeight, flex: 0 }
      : { flex: 1 };
  }, [insets.bottom]);

  return {
    keyboardHeight: keyboard.height,
    keyboardState: keyboard.state,
    safeAreaTop: insets.top,
    safeAreaBottom: insets.bottom,
    containerHeight,
    contentStyle,
    onLayout,
  };
}

export function KeyboardAwareScreen({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { contentStyle, onLayout } = useKeyboardInset();

  return createElement(
    View,
    { onLayout, style: [styles.root, style] },
    createElement(Animated.View, { style: [styles.content, contentStyle] }, children),
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { width: '100%', minHeight: 0 },
});
