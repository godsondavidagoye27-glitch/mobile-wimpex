import { createContext, useContext } from 'react';
import type { KeyboardState, SharedValue } from 'react-native-reanimated';

export type KeyboardInsetValues = {
  keyboardHeight: SharedValue<number>;
  keyboardState: SharedValue<KeyboardState>;
};

export const KeyboardInsetContext = createContext<KeyboardInsetValues | null>(null);
export const KeyboardAwareContainerContext = createContext(false);

export function useKeyboardInsetValues() {
  const values = useContext(KeyboardInsetContext);
  if (!values) {
    throw new Error('KeyboardInsetProvider is missing from the app root.');
  }
  return values;
}
