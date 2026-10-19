import { describe, expect, it } from 'vitest';
import { createPostShareUrl, createProfileShareUrl } from './shareLinks';

describe('public share URLs', () => {
  it('uses the HTTPS placeholder base when no domain is configured', () => {
    expect(createPostShareUrl('a/b')).toBe('https://wimpex.example/post/a%2Fb');
  });

  it('creates profile links under the configured domain', () => {
    expect(createProfileShareUrl('my-name', 'https://links.example/')).toBe('https://links.example/user/my-name');
  });

  it('rejects non-HTTPS domains', () => {
    expect(() => createPostShareUrl('id', 'http://links.example')).toThrow('must use HTTPS');
  });
});
