import { describe, expect, it } from 'vitest';
import {
  calculateAge,
  changePasswordResetStep,
  getPasswordStrength,
  isValidUsername,
  validateBirthday,
  validateCredentials,
  validateInterests,
  validateProfile,
  validatePasswordMatch,
  shouldCompleteSocialProfile,
} from './signupValidation';

describe('signup validation', () => {
  it('scores password strength across four segments', () => {
    expect(getPasswordStrength('short').score).toBe(0);
    expect(getPasswordStrength('longpassword').score).toBe(1);
    expect(getPasswordStrength('longpass1').score).toBe(2);
    expect(getPasswordStrength('Longpass1').score).toBe(3);
    expect(getPasswordStrength('Longpass1!').score).toBe(4);
  });

  it('validates password confirmation and password rules', () => {
    expect(validatePasswordMatch('Longpass1', 'different')).toBe('Passwords do not match.');
    expect(validatePasswordMatch('short', 'short')).toBe(
      'Meet all three password rules below.',
    );
    expect(validatePasswordMatch('Longpass1', 'Longpass1')).toBeUndefined();
  });

  it('keeps password reset steps within their three-step flow', () => {
    expect(changePasswordResetStep(0, 'back')).toBe(0);
    expect(changePasswordResetStep(0, 'next')).toBe(1);
    expect(changePasswordResetStep(1, 'next')).toBe(2);
    expect(changePasswordResetStep(2, 'next')).toBe(2);
    expect(changePasswordResetStep(2, 'back')).toBe(1);
  });

  it('chooses profile completion only when a profile is missing', () => {
    expect(shouldCompleteSocialProfile(false)).toBe(true);
    expect(shouldCompleteSocialProfile(true)).toBe(false);
  });

  it('calculates age around leap days and birthdays today', () => {
    expect(calculateAge(2012, 2, 29, new Date(2025, 1, 28))).toBe(12);
    expect(calculateAge(2012, 2, 29, new Date(2025, 2, 1))).toBe(13);
    expect(calculateAge(2010, 10, 13, new Date(2026, 9, 13))).toBe(16);
    expect(calculateAge(2010, 10, 14, new Date(2026, 9, 13))).toBe(15);
    expect(calculateAge(2010, 2, 31, new Date(2026, 9, 13))).toBeNull();
  });

  it('validates the exact username format', () => {
    expect(isValidUsername('wimpex.user_1')).toBe(true);
    expect(isValidUsername('Abc')).toBe(false);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(21))).toBe(false);
    expect(isValidUsername('bad-name')).toBe(false);
  });

  it('validates credentials, dates, profile details, and interests', () => {
    expect(validateCredentials('bad-email', 'Longpass1')).toEqual({
      email: 'Enter a valid email address.',
    });
    expect(validateCredentials('person@example.com', 'short').password).toBe(
      'Meet all three password rules below.',
    );
    expect(validateCredentials('person@example.com', 'Longpass!').password).toBe(
      'Meet all three password rules below.',
    );
    expect(validateBirthday(null, null, null).error).toBe('Choose your month, day and year.');
    expect(validateBirthday(2, 31, 2010).error).toBe('Choose a valid date.');
    expect(validateBirthday(10, 13, 2014, new Date(2026, 9, 13)).error).toBe(
      'You must be 13 or older to join Wimpex.',
    );
    expect(validateProfile('bad-name', 'Name')).toBe(
      'Use 3 to 20 letters, numbers, dots or underscores.',
    );
    expect(validateProfile('valid_name', '  ')).toBe('Enter the name people will see.');
    expect(validateInterests(['Music', 'Food'])).toBe(false);
    expect(validateInterests(['Music', 'Food', 'Art'])).toBe(true);
  });
});
