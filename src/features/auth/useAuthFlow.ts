import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type SignupData = {
  flowType: 'email' | 'social';
  email: string;
  password: string;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  username: string;
  displayName: string;
  avatarUri: string | null;
  interests: string[];
  currentStep: number;
};

type PersistedSignupData = Omit<SignupData, 'password'>;

type AuthFlowState = SignupData & {
  hasHydrated: boolean;
  setSignupData: (data: Partial<SignupData>) => void;
  setHasHydrated: (value: boolean) => void;
  clearPassword: () => void;
  resetSignup: () => void;
};

const initialSignupData: SignupData = {
  flowType: 'email',
  email: '',
  password: '',
  birthMonth: null,
  birthDay: null,
  birthYear: null,
  username: '',
  displayName: '',
  avatarUri: null,
  interests: [],
  currentStep: 0,
};

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const useAuthFlow = create<AuthFlowState>()(
  persist<AuthFlowState, [], [], PersistedSignupData>(
    (set) => ({
      ...initialSignupData,
      hasHydrated: false,
      setSignupData: (data) => set(data),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      clearPassword: () => set({ password: '' }),
      resetSignup: () => set({ ...initialSignupData }),
    }),
    {
      name: 'wimpex-signup-state',
      storage: createJSONStorage(() => secureStorage),
      partialize: ({
        flowType,
        email,
        birthMonth,
        birthDay,
        birthYear,
        username,
        displayName,
        avatarUri,
        interests,
        currentStep,
      }) => ({
        flowType,
        email,
        birthMonth,
        birthDay,
        birthYear,
        username,
        displayName,
        avatarUri,
        interests,
        currentStep,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);

export function rehydrateAuthFlow() {
  return useAuthFlow.persist.rehydrate();
}
