export type SignupValidationErrors = {
  email?: string;
  password?: string;
};

export function getPasswordStrength(password: string) {
  const rules = [
    password.length >= 8,
    /\d/.test(password),
    /[A-Z]/.test(password),
  ] as const;
  const score = rules.filter(Boolean).length + (/[^\w]/.test(password) ? 1 : 0);

  return { rules, score };
}

export function validateCredentials(email: string, password: string): SignupValidationErrors {
  const errors: SignupValidationErrors = {};
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!getPasswordStrength(password).rules.every(Boolean)) {
    errors.password = 'Meet all three password rules below.';
  }
  return errors;
}

export function validatePasswordMatch(password: string, confirmation: string) {
  if (password !== confirmation) return 'Passwords do not match.';
  if (!getPasswordStrength(password).rules.every(Boolean)) {
    return 'Meet all three password rules below.';
  }
  return undefined;
}

export function changePasswordResetStep(step: number, direction: 'back' | 'next') {
  return Math.min(2, Math.max(0, step + (direction === 'next' ? 1 : -1)));
}

export function shouldCompleteSocialProfile(profileExists: boolean) {
  return !profileExists;
}

export function calculateAge(
  year: number,
  month: number,
  day: number,
  today = new Date(),
): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const birthDate = new Date(year, month - 1, day);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  let age = today.getFullYear() - year;
  const birthdayHasPassed =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);
  if (!birthdayHasPassed) age -= 1;
  return age;
}

export function isValidUsername(username: string) {
  return /^[a-z0-9._]{3,20}$/.test(username);
}

export function validateBirthday(
  month: number | null,
  day: number | null,
  year: number | null,
  today = new Date(),
) {
  if (month === null || day === null || year === null) {
    return { error: 'Choose your month, day and year.' } as const;
  }

  const age = calculateAge(year, month, day, today);
  if (age === null) return { error: 'Choose a valid date.' } as const;
  if (age < 13) return { error: 'You must be 13 or older to join Wimpex.' } as const;
  return { age } as const;
}

export function validateProfile(username: string, displayName: string) {
  if (!isValidUsername(username)) {
    return 'Use 3 to 20 letters, numbers, dots or underscores.';
  }
  if (!displayName.trim()) return 'Enter the name people will see.';
  return undefined;
}

export function validateInterests(interests: string[]) {
  return interests.length >= 3;
}
