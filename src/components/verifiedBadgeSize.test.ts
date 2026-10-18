import { describe, expect, it } from 'vitest';
import { verifiedBadgeSizes } from './verifiedBadgeSize';

describe('verified badge size mapping', () => {
  it('maps the size variants to compact display dimensions', () => {
    expect(verifiedBadgeSizes).toEqual({ xs: 12, sm: 14, md: 18, lg: 24 });
  });
});
