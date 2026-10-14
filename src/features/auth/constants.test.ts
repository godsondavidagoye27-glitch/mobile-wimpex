import { describe, expect, it } from 'vitest';
import {
  createEmptyOtp,
  DEFAULT_OTP_LENGTH,
  isOtpComplete,
  normalizeOtpDigits,
  parseOtpLength,
} from './constants';

describe('OTP configuration', () => {
  it('defaults to six digits and validates configurable lengths from four to eight', () => {
    expect(parseOtpLength(undefined)).toBe(DEFAULT_OTP_LENGTH);
    expect(parseOtpLength('')).toBe(DEFAULT_OTP_LENGTH);
    expect(parseOtpLength('8')).toBe(8);
    expect(parseOtpLength('4')).toBe(4);
    expect(() => parseOtpLength('3')).toThrow(/between 4 and 8/);
    expect(() => parseOtpLength('9')).toThrow(/between 4 and 8/);
    expect(() => parseOtpLength('6.5')).toThrow(/whole number/);
  });

  it('creates and validates OTP arrays at the configured length', () => {
    expect(createEmptyOtp(8)).toEqual(Array(8).fill(''));
    expect(isOtpComplete(['1', '2', '3', '4'], 4)).toBe(true);
    expect(isOtpComplete(['1', '2', '', '4'], 4)).toBe(false);
    expect(isOtpComplete(['1', '2', '3'], 4)).toBe(false);
  });

  it('normalizes pasted text to digits and pads remaining cells', () => {
    expect(normalizeOtpDigits('Code: 12-34', 6)).toEqual(['1', '2', '3', '4', '', '']);
    expect(normalizeOtpDigits('123456789', 8)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });
});
