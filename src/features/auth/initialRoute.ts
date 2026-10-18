export function routeForSessionCheckFailure(hasRestoredSession: boolean): '/(tabs)' | '/(auth)/welcome' {
  return hasRestoredSession ? '/(tabs)' : '/(auth)/welcome';
}
