export const minimumChatListHeight = 120;

export function calculateChatKeyboardInset(keyboardHeight: number, safeAreaBottom: number) {
  'worklet';
  return Math.max(0, keyboardHeight, safeAreaBottom);
}

export function calculateChatComposerHeight(
  contentHeight: number,
  minimumHeight = 44,
  maximumHeight = 120,
) {
  return Math.min(maximumHeight, Math.max(minimumHeight, contentHeight));
}

export function calculateMinimumChatListHeight(availableHeight: number, minimumHeight = minimumChatListHeight) {
  return Math.max(minimumHeight, availableHeight);
}
