import { createElement, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type ScrollView, type StyleProp, type TextInput, type ViewStyle } from 'react-native';
import Animated, { KeyboardState, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareContainerContext, KeyboardInsetContext, useKeyboardInsetValues } from './keyboardInsetContext';

export { calculateKeyboardLayout } from './keyboardLayout';

export function KeyboardInsetProvider({ children }: { children: ReactNode }) {
  const keyboardHeight = useSharedValue(0);
  const keyboardState = useSharedValue(KeyboardState.CLOSED);
  const values = useMemo(
    () => ({ keyboardHeight, keyboardState }),
    [keyboardHeight, keyboardState],
  );

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    let baselineHeight = window.innerHeight;
    let baselineWidth = window.innerWidth;
    const updateKeyboardInset = () => {
      if (window.innerWidth !== baselineWidth) {
        baselineWidth = window.innerWidth;
        baselineHeight = window.innerHeight;
      }
      const height = Math.max(0, baselineHeight - viewport.height - viewport.offsetTop);
      if (height === 0) baselineHeight = window.innerHeight;
      // Web viewport events write shared values without causing a React render per frame.
      // eslint-disable-next-line react-hooks/immutability
      keyboardHeight.value = height;
      // eslint-disable-next-line react-hooks/immutability
      keyboardState.value = height > 0 ? KeyboardState.OPEN : KeyboardState.CLOSED;
    };
    viewport.addEventListener('resize', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);
    updateKeyboardInset();
    return () => {
      viewport.removeEventListener('resize', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
    };
  }, [keyboardHeight, keyboardState]);

  return createElement(KeyboardInsetContext.Provider, { value: values }, children);
}

export function useKeyboardInset() {
  const keyboard = useKeyboardInsetValues();
  const insets = useSafeAreaInsets();
  const containerHeight = useSharedValue(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    // eslint-disable-next-line react-hooks/immutability
    containerHeight.value = event.nativeEvent.layout.height;
  }, [containerHeight]);

  const contentStyle = useAnimatedStyle(() => {
    const keyboardHeight = keyboard.keyboardHeight.value;
    const bottomInset = keyboardHeight > 0
      ? Math.max(keyboardHeight, insets.bottom)
      : 0;
    const availableHeight = Math.max(0, containerHeight.value - bottomInset);
    return containerHeight.value > 0
      ? { height: availableHeight, flex: 0 }
      : { flex: 1 };
  }, [insets.bottom]);

  return {
    keyboardHeight: keyboard.keyboardHeight,
    keyboardState: keyboard.keyboardState,
    safeAreaTop: insets.top,
    safeAreaBottom: insets.bottom,
    containerHeight,
    contentStyle,
    onLayout,
  };
}

export function scrollFocusedInputIntoView(
  scrollView: ScrollView | null,
  input: TextInput | null,
  currentScrollOffset: number,
  margin = 16,
) {
  if (!scrollView || !input) return;

  setTimeout(() => {
    input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
      scrollView.getNativeScrollRef()?.measureInWindow((_scrollX, scrollY, _scrollWidth, scrollHeight) => {
        const topLimit = scrollY + margin;
        const bottomLimit = scrollY + scrollHeight - margin;
        const down = inputY + inputHeight - bottomLimit;
        const up = topLimit - inputY;
        const delta = down > 0 ? down : up > 0 ? -up : 0;
        if (delta !== 0) {
          scrollView.scrollTo({
            y: Math.max(0, currentScrollOffset + delta),
            animated: true,
          });
        }
      });
    });
  }, 100);
}

export function KeyboardAwareScreen({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const nested = useContext(KeyboardAwareContainerContext);
  const { contentStyle, onLayout } = useKeyboardInset();

  if (nested) {
    return createElement(
      View,
      { style: [styles.root, style] },
      createElement(KeyboardAwareContainerContext.Provider, { value: true }, children),
    );
  }

  return createElement(
    View,
    { onLayout, style: [styles.root, style] },
    createElement(
      Animated.View,
      { style: [styles.content, contentStyle] },
      createElement(KeyboardAwareContainerContext.Provider, { value: true }, children),
    ),
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { width: '100%', minHeight: 0 },
});
