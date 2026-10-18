import { describe, expect, it, vi } from 'vitest';
import { createVerifiedMapLoader } from './verifiedMapCache';

describe('verified map loader', () => {
  it('batches requests made during the same tick and de-duplicates ids', async () => {
    const query = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, is_verified: id === 'a' })));
    const fetchMap = createVerifiedMapLoader(query);
    const [first, second] = await Promise.all([fetchMap(['a', 'b']), fetchMap(['b', 'c'])]);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(first).toEqual({ a: true, b: false });
    expect(second).toEqual({ b: false, c: false });
  });

  it('caches results and treats RLS-hidden ids as not verified until the cache expires', async () => {
    let now = 100;
    const query = vi.fn(async (ids: string[]) => ids.filter((id) => id !== 'hidden')
      .map((id) => ({ id, is_verified: id === 'yes' })));
    const fetchMap = createVerifiedMapLoader(query, 50, () => now);
    expect(await fetchMap(['yes', 'hidden'])).toEqual({ yes: true, hidden: false });
    expect(await fetchMap(['yes', 'hidden'])).toEqual({ yes: true, hidden: false });
    expect(query).toHaveBeenCalledOnce();
    now = 151;
    await fetchMap(['yes']);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns an empty result without querying for empty ids', async () => {
    const query = vi.fn(async () => []);
    expect(await createVerifiedMapLoader(query)([])).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });
});
