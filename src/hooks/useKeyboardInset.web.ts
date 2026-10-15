import { createElement, useCallback, useEffect, type ReactNode } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateKeyboardLayout } from './keyboardLayout';

export { calculateKeyboardLayout } from './keyboardLayout';

export function useKeyboardInset() {
  const insets = useSafeAreaInsets();
  const containerHeight = useSharedValue(0);
  const keyboardHeight = useSharedValue(0);
  const keyboardState = useSharedValue(4);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    // Shared values are written from layout events to avoid a React render per frame.
    // eslint-disable-next-line react-hooks/immutability
    containerHeight.value = event.nativeEvent.layout.height;
  }, [containerHeight]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const baselineHeight = window.innerHeight;
    const updateKeyboardInset = () => {
      const height = Math.max(0, baselineHeight - viewport.height);
      keyboardHeight.value = height;
      keyboardState.value = height > 0 ? 2 : 4;
    };
    viewport.addEventListener('resize', updateKeyboardInset);
    updateKeyboardInset();
    return () => viewport.removeEventListener('resize', updateKeyboardInset);
  }, [keyboardHeight, keyboardState]);

  const contentStyle = useAnimatedStyle(() => {
    const layout = calculateKeyboardLayout(
      containerHeight.value,
      insets.bottom,
      keyboardHeight.value,
    );
    return containerHeight.value > 0
      ? { height: layout.availableHeight, flex: 0 }
      : { flex: 1 };
  }, [insets.bottom]);

  return {
    keyboardHeight,
    keyboardState,
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
