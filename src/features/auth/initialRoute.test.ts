import { describe, expect, it } from 'vitest';
import { routeForSessionCheckFailure } from './initialRoute';

describe('routeForSessionCheckFailure', () => {
  it('keeps a restored signed-in session out of the welcome screen', () => {
    expect(routeForSessionCheckFailure(true)).toBe('/(tabs)');
  });

  it('routes to welcome when there is no restored session', () => {
    expect(routeForSessionCheckFailure(false)).toBe('/(auth)/welcome');
  });
});
