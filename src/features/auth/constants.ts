export const DEFAULT_OTP_LENGTH = 6;
export const MIN_OTP_LENGTH = 4;
export const MAX_OTP_LENGTH = 8;

export function parseOtpLength(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_OTP_LENGTH;
  const length = Number(value);
  if (!Number.isInteger(length) || length < MIN_OTP_LENGTH || length > MAX_OTP_LENGTH) {
    throw new Error(`EXPO_PUBLIC_OTP_LENGTH must be a whole number between ${MIN_OTP_LENGTH} and ${MAX_OTP_LENGTH}.`);
  }
  return length;
}

export const OTP_LENGTH = parseOtpLength(process.env.EXPO_PUBLIC_OTP_LENGTH);
export const OTP_CELL_WIDTH = OTP_LENGTH === MAX_OTP_LENGTH ? 28 : 44;

export function createEmptyOtp(length = OTP_LENGTH): string[] {
  return Array.from({ length }, () => '');
}

export function normalizeOtpDigits(value: string, length = OTP_LENGTH): string[] {
  const digits = value.replace(/\D/g, '').slice(0, length);
  return [...digits, ...createEmptyOtp(length - digits.length)];
}

export function isOtpComplete(code: string[], length = OTP_LENGTH): boolean {
  return code.length === length && code.every((digit) => /^\d$/.test(digit));
}
