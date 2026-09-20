import { describe, it, expect } from 'vitest';
import { isSafeUrl, isNavigableUrl } from '../src/url-safety.js';

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

/**
 * The rule that decides where a button in a message may send someone.
 *
 * Deliberately not isSafeUrl: this is a deep linking product, so `myapp://` is
 * the most natural destination a call to action can have, and an http/https
 * allowlist made every one of those buttons do nothing. What cannot be allowed
 * is the small set of schemes that run code or forge an origin, so those are
 * named and everything else navigates.
 */
describe('isNavigableUrl', () => {
  it('allows the two web schemes', () => {
    expect(isNavigableUrl('https://example.com/promo')).toBe(true);
    expect(isNavigableUrl('http://example.com/promo')).toBe(true);
  });

  it('allows the custom schemes this product exists for', () => {
    expect(isNavigableUrl('myapp://promo/42')).toBe(true);
    expect(isNavigableUrl('market://details?id=com.example')).toBe(true);
    expect(isNavigableUrl('intent://x#Intent;scheme=myapp;end')).toBe(true);
    expect(isNavigableUrl('mailto:hi@example.com')).toBe(true);
    expect(isNavigableUrl('tel:+15550123')).toBe(true);
  });

  it('allows a relative action, which carries no scheme to execute', () => {
    expect(isNavigableUrl('/promo')).toBe(true);
    expect(isNavigableUrl('promo')).toBe(true);
  });

  it('blocks the schemes that run code or forge an origin', () => {
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false);
    expect(isNavigableUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isNavigableUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isNavigableUrl('blob:https://example.com/abc')).toBe(false);
    expect(isNavigableUrl('file:///etc/passwd')).toBe(false);
  });

  it('is not fooled by the case of the scheme', () => {
    expect(isNavigableUrl('JavaScript:alert(1)')).toBe(false);
    expect(isNavigableUrl('DATA:text/html,x')).toBe(false);
  });

  it('is not fooled by whitespace inside or in front of the scheme', () => {
    // Browsers ignore tabs and newlines inside a scheme, so this navigates as
    // javascript:, and the URL parser strips them the same way before it
    // reports the protocol.
    expect(isNavigableUrl('java\tscript:alert(1)')).toBe(false);
    expect(isNavigableUrl('java\nscript:alert(1)')).toBe(false);
    expect(isNavigableUrl('  javascript:alert(1)')).toBe(false);
  });

  it('treats absent or empty as nowhere to go', () => {
    expect(isNavigableUrl('')).toBe(false);
    expect(isNavigableUrl('   ')).toBe(false);
    expect(isNavigableUrl(null)).toBe(false);
    expect(isNavigableUrl(undefined)).toBe(false);
    expect(isNavigableUrl(42 as unknown as string)).toBe(false);
  });
});
