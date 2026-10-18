import { describe, expect, it } from 'vitest';
import { theme } from './theme';

describe('app theme', () => {
  it('uses the dark color palette consistently', () => {
    expect(theme.colors.black).toBe('#000000');
    expect(theme.colors.white).toBe('#FFFFFF');
  });
});
