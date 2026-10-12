export function useAuthFlow() {
  return {
    currentStep: 0,
    mode: 'login' as const,
  };
}
