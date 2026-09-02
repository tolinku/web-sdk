import { describe, it, expect } from 'vitest';
import { isSafeUrl } from '../src/url-safety.js';

/**
 * The rule that decides whether a banner or message URL may be opened.
 *
 * It existed twice in this SDK, once in banners.ts and once in messages.ts,
 * identical and untested in both places. Two copies of a security rule is one
 * copy waiting to be fixed while the other is forgotten.
 */
describe('isSafeUrl', () => {
  it('allows the two web schemes', () => {
    expect(isSafeUrl('https://example.com/promo')).toBe(true);
    expect(isSafeUrl('http://example.com/promo')).toBe(true);
  });

  it('is not fooled by the case of the scheme', () => {
    expect(isSafeUrl('HTTPS://example.com')).toBe(true);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('blocks schemes that do something other than open a page', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('myapp://promo')).toBe(false);
  });

  it('blocks a scheme hidden behind whitespace', () => {
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('\tdata:text/html,x')).toBe(false);
  });

  it('treats absent or empty as unsafe', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(42 as unknown as string)).toBe(false);
  });

  it('resolves a relative URL against the page, as a browser would', () => {
    // The one place this SDK differs from the others by necessity: it has a page
    // to resolve against, and a message naming /promo means the ordinary link.
    expect(isSafeUrl('/promo')).toBe(true);
    expect(isSafeUrl('promo')).toBe(true);
  });

  it('refuses rather than throwing on something that will not parse', () => {
    expect(() => isSafeUrl('ht!tp://[bad')).not.toThrow();
  });
});
