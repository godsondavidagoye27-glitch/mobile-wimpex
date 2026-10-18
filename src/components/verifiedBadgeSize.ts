export const verifiedBadgeSizes = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 24,
} as const;

export type VerifiedBadgeSize = keyof typeof verifiedBadgeSizes;
