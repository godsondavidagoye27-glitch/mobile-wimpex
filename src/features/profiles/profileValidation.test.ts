import { describe, expect, it } from 'vitest';
import { validateProfileLink } from './profileValidation';

describe('profile link validation', () => {
  it('allows an empty link and valid HTTPS links', () => {
    expect(validateProfileLink('')).toBeNull();
    expect(validateProfileLink(' https://wimpex.app/ari ')).toBeNull();
  });

  it('requires HTTPS and enforces the 100 character maximum', () => {
    expect(validateProfileLink('wimpex.app/ari')).toBe('Enter a link that starts with https://');
    expect(validateProfileLink('http://wimpex.app')).toBe('Enter a link that starts with https://');
    expect(validateProfileLink(`https://${'a'.repeat(100)}`)).toBe('Enter a link that starts with https://');
  });
});
