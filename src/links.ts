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
   * The question goes to the link's own host first, because that is how Tolinku
   * knows which Appspace is being asked about, which also means a link on a
   * domain that is not yours simply answers nothing there.
   *
   * If that host gives no reply Tolinku would give (on the web, a third-party
   * click-tracking host usually refuses the request outright under CORS),
   * Tolinku's own API is asked once with the whole link. A link in an email
   * usually arrives wrapped in the email platform's click-tracking URL, on a
   * host that has never heard of Tolinku; the API knows how to unwrap those,
   * and the publishable key tells it which Appspace is asking.
   *
   * Each question is asked once, with a short time limit: resolving a link
   * is recorded as an API call on the server (not a click), so a retry would count it twice.
   *
   * Never throws. A link that cannot be resolved, for a bad network or any
   * other reason, is one to fall back to your own handling for.
   */
  async resolve(url: string): Promise<ResolvedLink | null> {
    try {
      return await this.resolveLink(url);
    } catch {
      return null;
    }
  }

  private async resolveLink(url: string): Promise<ResolvedLink | null> {
    if (!url || typeof url !== 'string') return null;

    const link = normaliseLink(url);
    if (!link) return null;

    // The whole link goes along with the path. Older servers read only the
    // path; a click-tracking domain needs the rest, because SendGrid and others
    // keep the real destination in the query string.
    const own = await this.client.postOnce(
      link.origin + '/v1/api/path',
      { path: link.path, url: link.whole },
      { authenticated: false, timeoutMs: RESOLVE_TIMEOUT_MS },
    );
    if (own && own.status === 200 && isAnswer(own.data)) return own.data;

    // Tolinku's own reply, even a "no": the host is ours and has answered, and
    // asking again would count a second API call.
    if (own && isTolinkuReply(own.data)) return null;

    if (!this.shouldAskApi(link.hostname)) return null;

    const api = await this.client.postOnce(
      this.client.baseUrl + '/v1/api/links/resolve',
      { url: link.whole },
      { authenticated: true, timeoutMs: RESOLVE_TIMEOUT_MS },
    );
    if (api && api.status === 200 && isAnswer(api.data)) return api.data;
    return null;
  }

  /**
   * Whether a second question to Tolinku's own API could add anything.
   *
   * Not without a key, since the API would not know which Appspace is asking.
   * Not when the link is already on the API's host either: that host was just
   * asked, and asking again only doubles the wait for the same answer.
   */
  private shouldAskApi(hostname: string): boolean {
    if (!this.client.key) return false;
    try {
      return new URL(this.client.baseUrl).hostname.toLowerCase() !== hostname;
    } catch {
      return false;
    }
  }
}

/** How long each of the two resolve questions may take. */
const RESOLVE_TIMEOUT_MS = 5000;

interface NormalisedLink {
  /** https://host[:port], the port only when it is not a default one */
  origin: string;
  /** Lowercased, without the port */
  hostname: string;
  /** The percent-encoded path */
  path: string;
  /** origin + path + query, without the fragment */
  whole: string;
}

/**
 * The one form of a link used for everything that follows: trimmed, without
 * the fragment, scheme and host lowercased, http upgraded to https (every
 * Tolinku and click domain serves https), a default port (443 or 80) dropped,
 * and the path and query left as they were.
 */
function normaliseLink(input: string): NormalisedLink | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  // http and https only. A custom scheme link already carries the path that
  // is wanted, and anything else is not a link this could answer for.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port === '' || parsed.port === '443' || parsed.port === '80' ? '' : ':' + parsed.port;
  const origin = 'https://' + hostname + port;
  const path = parsed.pathname;
  return { origin, hostname, path, whole: origin + path + parsed.search };
}

/** A reply in Tolinku's own shape: a JSON object with a string `error`. */
function isTolinkuReply(data: unknown): boolean {
  return typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string';
}

/**
 * Whether a reply is a usable answer: a route, and a deep link path that is a
 * path and nothing else.
 */
function isAnswer(data: unknown): data is ResolvedLink {
  if (typeof data !== 'object' || data === null) return false;
  const result = data as ResolvedLink;
  return !!result.route && isRoutablePath(result.deep_link_path);
}
