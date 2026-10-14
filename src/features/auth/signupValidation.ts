export type SignupValidationErrors = {
  email?: string;
  password?: string;
};

const reservedUsernames = new Set([
  'wimpex', 'admin', 'support', 'help', 'official', 'moderator', 'null', 'undefined',
  'api', 'login', 'logout', 'signup', 'sign-up', 'register', 'account', 'profile',
  'settings', 'notifications', 'notification', 'message', 'messages', 'chat', 'chats',
  'search', 'discover', 'explore', 'about', 'terms', 'privacy', 'report', 'block',
  'follow', 'followers', 'following', 'live', 'video', 'videos', 'post', 'posts',
  'community', 'communities', 'create', 'verify', 'email', 'auth', 'feed', 'home',
]);

type SignupErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function errorText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getSignupErrorMessage(error: unknown) {
  const candidate: SignupErrorLike = error && typeof error === 'object'
    ? error as SignupErrorLike
    : {};
  const code = errorText(candidate.code);
  const message = errorText(candidate.message) || (error instanceof Error ? error.message : '');
  const details = errorText(candidate.details);
  const hint = errorText(candidate.hint);
  const searchable = `${code} ${message} ${details} ${hint}`;

  if (code === '23505') return 'That username is taken. Try another.';
  if (code === '23514') return 'You must be 13 or older to join Wimpex.';
  if (code === '42501') return 'You do not have permission to complete this step.';
  if (/network|fetch|offline|connection|internet|failed to fetch|authretryablefetcherror/i.test(searchable)) {
    return 'No connection. Check your internet and try again.';
  }

  const explanation = [message, details, hint, code && `Code: ${code}`]
    .filter(Boolean)
    .join(' ');
  return explanation || (typeof error === 'string' && error.trim())
    || 'Unable to complete sign up. Try again.';
}

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

export function isReservedUsername(username: string) {
  return reservedUsernames.has(username.trim().toLowerCase());
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
  if (isReservedUsername(username)) return 'That username is not available.';
  if (!isValidUsername(username)) {
    return 'Use 3 to 20 letters, numbers, dots or underscores.';
  }
  if (!displayName.trim()) return 'Enter the name people will see.';
  return undefined;
}

export function validateInterests(interests: string[]) {
  return interests.length >= 3;
}
