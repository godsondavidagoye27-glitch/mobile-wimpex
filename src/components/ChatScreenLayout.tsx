import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScreen, useKeyboardInset } from '../hooks/useKeyboardInset';
import { minimumChatListHeight } from '../features/chats/chatLayout';
import { theme } from '../theme/theme';

type ChatScreenLayoutProps = {
  header: ReactNode;
  list: ReactNode;
  composer?: ReactNode;
  notice?: ReactNode;
  contextHeader?: ReactNode;
  hideContextHeaderWhenKeyboardOpen?: boolean;
  safeAreaTop?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ChatScreenLayout({
  header,
  list,
  composer,
  notice,
  contextHeader,
  hideContextHeaderWhenKeyboardOpen = false,
  safeAreaTop = true,
  style,
}: ChatScreenLayoutProps) {
  const { keyboardHeight, safeAreaBottom } = useKeyboardInset();
  const contextHeaderStyle = useAnimatedStyle(() => {
    const hidden = hideContextHeaderWhenKeyboardOpen && keyboardHeight.value > 0;
    return {
      height: hidden ? 0 : undefined,
      opacity: hidden ? 0 : 1,
      overflow: 'hidden',
    };
  }, [hideContextHeaderWhenKeyboardOpen]);
  const composerInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardHeight.value > 0 ? 0 : safeAreaBottom,
  }), [safeAreaBottom]);

  return (
    <KeyboardAwareScreen style={[styles.root, style]}>
      <SafeAreaView edges={safeAreaTop ? ['top'] : []} style={styles.content}>
        <View style={styles.header}>{header}</View>
        {notice}
        {contextHeader ? (
          <Animated.View style={contextHeaderStyle}>{contextHeader}</Animated.View>
        ) : null}
        <View style={styles.list}>{list}</View>
        {composer ? (
          <Animated.View style={[styles.composer, composerInsetStyle]}>{composer}</Animated.View>
        ) : null}
      </SafeAreaView>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  content: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.black,
  },
  header: {
    flexShrink: 0,
  },
  list: {
    flex: 1,
    minHeight: minimumChatListHeight,
  },
  composer: {
    flexShrink: 0,
    backgroundColor: theme.colors.black,
  },
});
