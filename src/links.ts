import type { HttpClient } from './client.js';
import type { ResolvedLink } from './types.js';

/**
 * Whether the platform's answer is the path it promises to be.
 *
 * `resolve` sends its question to a host taken from the URL it was given, so a
 * page resolving a link from somewhere it does not control is talking to a
 * stranger. The contract is a path and nothing else: a full URL, or a protocol
 * relative "//host" that reads as one, is a redirect waiting to happen in
 * whatever is done with it next.
 */
function isRoutablePath(path: unknown): path is string {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//');
}

/**
 * Working out what a link actually means.
 *
 * On the open web this rarely comes up: a browser follows a short link to
 * Tolinku, which resolves it and serves the page, so nothing on the page ever
 * sees an unreadable URL.
 *
 * Inside a Capacitor or Cordova app it comes up constantly. There the operating
 * system hands the web layer the URL that was tapped, exactly as written, and
 * the routing happens in JavaScript. A short link arrives as an opaque code:
 *
 *   https://links.example.com/s7k2p9q/4821
 *
 * Nothing in that URL says which route it is, and nothing on the device can work
 * it out. Code parsing the path itself sees a first segment it has never heard
 * of and does nothing, so the link opens the app and then appears to fail: no
 * error, no screen, no clue.
 *
 * `resolve` asks Tolinku, which answers with the route, the token and the
 * canonical path. A readable URL comes back unchanged, so everything can be
 * resolved rather than guessing which kind it is.
 */
export class Links {
  constructor(private client: HttpClient) {}

  /**
   * What this link means, or null if it means nothing here.
   *
   * The question goes to the link's own host, because that is how Tolinku knows
   * which Appspace is being asked about, which also means a link on a domain
   * that is not yours simply answers nothing.
   *
   * Never throws. A link that cannot be resolved, for a bad network or any
   * other reason, is one to fall back to your own handling for.
   */
  async resolve(url: string): Promise<ResolvedLink | null> {
    if (!url || typeof url !== 'string') return null;

    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return null;
    }

    // http and https only. A custom scheme link already carries the path that
    // is wanted, and anything else is not a link this could answer for.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

    try {
      const result = await this.client.postPublicToOrigin<ResolvedLink>(
        parsed.origin,
        '/v1/api/path',
        { path: parsed.pathname },
      );
      if (!result || !result.route || !isRoutablePath(result.deep_link_path)) return null;
      return result;
    } catch {
      return null;
    }
  }
}
