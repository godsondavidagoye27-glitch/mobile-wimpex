import { describe, expect, it } from 'vitest';
import { getSingleRouteParam, isUuidRouteParam } from './routeParams';

describe('route parameter validation', () => {
  it('normalizes a single route value and rejects repeated or empty values', () => {
    expect(getSingleRouteParam('  hello ')).toBe('hello');
    expect(getSingleRouteParam(['hello'])).toBe('hello');
    expect(getSingleRouteParam(['hello', 'other'])).toBeNull();
    expect(getSingleRouteParam('  ')).toBeNull();
  });

  it('recognizes UUID route identifiers', () => {
    expect(isUuidRouteParam('22000000-0000-4000-8000-000000000010')).toBe(true);
    expect(isUuidRouteParam('not-a-uuid')).toBe(false);
    expect(isUuidRouteParam(null)).toBe(false);
  });
});
