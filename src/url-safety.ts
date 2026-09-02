/**
 * Whether a URL is safe to open or render.
 *
 * Only `http` and `https`. A banner or an in-app message names URLs that came
 * from the server, and every other scheme a URL can carry is a way of doing
 * something besides opening a web page: `javascript:` executes, `data:` renders
 * markup, `file:` reads local storage.
 *
 * Relative URLs are resolved against the current page, which is what a browser
 * would do with them anyway, so a message may name `/promo` and have it treated
 * as the ordinary link it is. The other SDKs have no page to resolve against and
 * require an absolute URL, which is the one place the rule differs by necessity
 * rather than by accident.
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;

  // Leading whitespace would otherwise let " javascript:..." past a naive check,
  // and is never meaningful in a URL.
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const base = typeof window !== 'undefined' ? window.location.href : undefined;
    const parsed = new URL(trimmed, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
