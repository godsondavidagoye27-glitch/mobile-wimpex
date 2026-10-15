export type KeyboardLayout = {
  bottomInset: number;
  availableHeight: number;
};

export function calculateKeyboardLayout(
  containerHeight: number,
  safeAreaBottom: number,
  keyboardHeight: number,
): KeyboardLayout {
  const bottomInset = keyboardHeight > 0
    ? Math.max(keyboardHeight, safeAreaBottom)
    : 0;

  return {
    bottomInset,
    availableHeight: Math.max(0, containerHeight - bottomInset),
  };
}
