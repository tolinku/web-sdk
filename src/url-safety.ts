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

/**
 * The schemes that can run code or forge an origin when a browser follows them.
 *
 * Named one by one, because a list of what to allow cannot be written here: the
 * whole point of a call to action on a deep linking product is that the
 * customer's own scheme is one we have never seen.
 *
 * Deliberately the same five as `platform/src/helpers/safe-url.ts`, which
 * applies this rule to the same URL when it renders the message server side.
 * They are kept identical so that a URL cannot be refused in one place and
 * followed in the other; change one and change both.
 *
 * Shorter than the four app SDKs' list, which also names `content:`, `jar:`
 * and `filesystem:`. An action there can end up at an Android Intent, where
 * `content:` reads a ContentProvider and `jar:` carries a second URL inside
 * it, and neither scheme exists in a browser. `filesystem:` does exist in a
 * browser, but it resolves inside the sandbox of the origin named in the URL,
 * so it cannot reach ours, and browsers already refuse to navigate to one at
 * the top level. It is in their list because it is reachable through an Intent,
 * not because this list is missing it.
 */
const EXECUTABLE_SCHEMES = new Set(['javascript:', 'vbscript:', 'data:', 'blob:', 'file:']);

/**
 * Whether a URL an author gave a button may be navigated to.
 *
 * `isSafeUrl` allows http and https only, which is right for an image or a
 * background but wrong for a call to action: this is a deep linking product, so
 * `myapp://promo` is the most natural destination a message can have and every
 * customer's scheme is different. There is no list of schemes to allow, so the
 * small known set of dangerous ones is refused and everything else is left to
 * navigate, which is the rule the platform already applies to the same URL
 * where it renders it server side.
 *
 * A value with no scheme cannot execute, so a relative action such as `/promo`
 * is allowed through as the ordinary link it is.
 */
export function isNavigableUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return true;
  }
  // Parsing first is what makes this hold: browsers ignore tabs and newlines
  // inside a scheme, so "java<TAB>script:alert(1)" navigates as javascript:,
  // and the URL parser strips them the same way before reporting the protocol.
  return !EXECUTABLE_SCHEMES.has(parsed.protocol);
}
