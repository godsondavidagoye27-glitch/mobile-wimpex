import { describe, expect, it } from 'vitest';
import { resolveThemeMode } from './theme';

describe('theme mode helpers', () => {
  it('accepts the light mode setting', () => {
    expect(resolveThemeMode('light')).toBe('light');
  });

  it('defaults anything else to dark mode', () => {
    expect(resolveThemeMode(null)).toBe('dark');
    expect(resolveThemeMode('system')).toBe('dark');
  });
});
