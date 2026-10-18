import { describe, expect, it } from 'vitest';
import { constantTimeEquals } from './constantTime.ts';

describe('constantTimeEquals', () => {
  it('accepts identical strings', () => {
    expect(constantTimeEquals('secret-value', 'secret-value')).toBe(true);
  });

  it('rejects different and missing values', () => {
    expect(constantTimeEquals('secret-value', 'secret-value2')).toBe(false);
    expect(constantTimeEquals(null, 'secret-value')).toBe(false);
  });

  it('compares UTF-8 encoded values', () => {
    expect(constantTimeEquals('café🔒', 'café🔒')).toBe(true);
    expect(constantTimeEquals('café🔒', 'cafe🔒')).toBe(false);
  });
});
