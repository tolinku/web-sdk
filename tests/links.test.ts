import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Links } from '../src/links.js';
import { HttpClient } from '../src/client.js';
import type { ResolvedLink } from '../src/types.js';

/**
 * Turning a link into something routable.
 *
 * On the open web this rarely comes up: a browser follows a short link to
 * Tolinku, which resolves it before the page is served. Inside a Capacitor or
 * Cordova app it comes up constantly, because there the operating system hands
 * the web layer the URL that was tapped, exactly as written, and routing
 * happens in JavaScript. A short link arrives as an opaque code that nothing on
 * the device can interpret.
 *
 * The question goes to the link's own host first, because that is how Tolinku
 * knows which Appspace is being asked about. The client is deliberately
 * configured with a different base URL, so a request sent there instead shows
 * up as a failure rather than passing by accident.
 *
 * These run a real HttpClient against a stubbed fetch, so the number of
 * requests and the time limit are the client's own, not a mock's.
 */

const answer: ResolvedLink = {
  route: { prefix: 'order/{token}/receipt', name: 'Order Receipt', template: 'none', link_type: 'dynamic' },
  token: '4821',
  deep_link_path: '/order/4821/receipt',
};

const OWN_PATH = '/v1/api/path';
const API_RESOLVE = 'https://api.example.com/v1/api/links/resolve';

type Reply = { status: number; body?: unknown; notJson?: boolean; tolinku?: boolean } | Error;

function response(reply: Exclude<Reply, Error>): Response {
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    statusText: 'x',
    headers: new Headers(reply.tolinku ? { 'X-Tolinku': '1' } : {}),
    json: reply.notJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <'))
      : vi.fn().mockResolvedValue(reply.body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Stub fetch: the link's own host answers `own`, the API answers `api`.
 * Anything else is a test bug and fails loudly.
 */
function serve(own: Reply, api: Reply = { status: 404, body: { error: 'Not found' } }) {
  fetchMock.mockImplementation(async (url: string) => {
    const reply = url === API_RESOLVE ? api : url.endsWith(OWN_PATH) ? own : new Error('unexpected ' + url);
    if (reply instanceof Error) throw reply;
    return response(reply);
  });
}

function links(key = 'tolk_pub_test', baseUrl = 'https://api.example.com') {
  return new Links(new HttpClient({ apiKey: key, baseUrl }));
}

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url),
  body: JSON.parse(String((init as RequestInit).body)),
  headers: (init as RequestInit).headers as Record<string, string>,
  signal: (init as RequestInit).signal as AbortSignal,
}));

const ownCalls = () => calls().filter((c) => c.url.endsWith(OWN_PATH));
const apiCalls = () => calls().filter((c) => c.url === API_RESOLVE);

const ok = { status: 200, body: answer };
const corsFailure = new TypeError('Failed to fetch');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolving a short link', () => {
  it('asks the link its own host, with the path and the whole link, without the key', async () => {
    serve(ok);

    const link = await links().resolve('https://links.example.com/s7k2p9q/4821');

    expect(calls()).toHaveLength(1);
    const [own] = calls();
    expect(own.url).toBe('https://links.example.com/v1/api/path');
    expect(own.body).toEqual({ path: '/s7k2p9q/4821', url: 'https://links.example.com/s7k2p9q/4821' });
    expect(own.headers['X-API-Key']).toBeUndefined();
    expect(link?.token).toBe('4821');
    expect(link?.deep_link_path).toBe('/order/4821/receipt');
    expect(link?.route.prefix).toBe('order/{token}/receipt');
  });

  it('leaves the query string out of the path but keeps it in the link', async () => {
    // A tapped link usually carries utm parameters, and they say nothing about
    // which route it is. A click-tracking link, though, keeps its destination in
    // the query, so the whole link goes too.
    serve(ok);
    await links().resolve('https://links.example.com/s7k2p9q/4821?utm_source=qr');
    expect(ownCalls()[0].body).toEqual({
      path: '/s7k2p9q/4821',
      url: 'https://links.example.com/s7k2p9q/4821?utm_source=qr',
    });
  });

  it('keeps an encoded slash in the token encoded', async () => {
    // Decoding it would turn a token of "a/b" on "promo" into a route of "a" and a
    // token of "a/b" on "promo", which resolves to a different route or none.
    serve(ok);
    await links().resolve('https://links.example.com/promo/a%2Fb?q=x%20y');
    expect(ownCalls()[0].body).toEqual({
      path: '/promo/a%2Fb',
      url: 'https://links.example.com/promo/a%2Fb?q=x%20y',
    });
  });
});

describe('normalising the link', () => {
  it.each([
    ['upgrades http to https', 'http://links.example.com/s/1', 'https://links.example.com', 'https://links.example.com/s/1'],
    ['lowercases the scheme and host, not the path', 'HTTPS://Links.Example.COM/S/Ab?Q=Z', 'https://links.example.com', 'https://links.example.com/S/Ab?Q=Z'],
    ['drops the fragment', 'https://links.example.com/s/1?a=b#section', 'https://links.example.com', 'https://links.example.com/s/1?a=b'],
    ['trims whitespace', '  \thttps://links.example.com/s/1\n ', 'https://links.example.com', 'https://links.example.com/s/1'],
    ['drops :443', 'https://links.example.com:443/s/1', 'https://links.example.com', 'https://links.example.com/s/1'],
    ['drops :80 on http', 'http://links.example.com:80/s/1', 'https://links.example.com', 'https://links.example.com/s/1'],
    ['drops :443 on http', 'http://links.example.com:443/s/1', 'https://links.example.com', 'https://links.example.com/s/1'],
    ['keeps any other port', 'http://links.example.com:8443/s/1', 'https://links.example.com:8443', 'https://links.example.com:8443/s/1'],
  ])('%s', async (_label, input, origin, whole) => {
    serve(ok);
    await links().resolve(input);
    expect(ownCalls()[0].url).toBe(origin + OWN_PATH);
    expect(ownCalls()[0].body.url).toBe(whole);
  });

  it('sends the normalised link to the API too', async () => {
    serve(corsFailure, ok);
    await links().resolve(' HTTP://Click.Mailer.com:80/ls/click?upn=XYZ#frag ');
    expect(apiCalls()[0].body).toEqual({ url: 'https://click.mailer.com/ls/click?upn=XYZ' });
  });
});

describe('an answer that is not a path', () => {
  // The question goes to a host taken from the URL, so the reply may come from a
  // stranger. Anything but a path is a redirect waiting to happen.
  it.each([
    ['a full URL', 'https://evil.example.com/take-over'],
    ['a protocol relative URL', '//evil.example.com/take-over'],
    ['a bare word', 'order/4821'],
    ['nothing', ''],
  ])('refuses %s from the link\'s own host', async (_label, deep_link_path) => {
    serve({ status: 200, body: { ...answer, deep_link_path } }, { status: 404, body: { error: 'Not found' } });
    expect(await links().resolve('https://links.example.com/s7k2p9q/4821')).toBeNull();
  });

  it.each([
    ['a full URL', 'https://evil.example.com/take-over'],
    ['a protocol relative URL', '//evil.example.com/take-over'],
  ])('refuses %s from the API', async (_label, deep_link_path) => {
    serve(corsFailure, { status: 200, body: { ...answer, deep_link_path } });
    expect(await links().resolve('https://click.mailer.com/ls/click?upn=XYZ')).toBeNull();
    expect(apiCalls()).toHaveLength(1);
  });
});

describe('what it declines to ask about', () => {
  it('says nothing for a custom scheme link', async () => {
    // That one already carries the path that is wanted.
    serve(ok, ok);
    expect(await links().resolve('myapp://order/4821/receipt')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says nothing for something that is not a URL', async () => {
    serve(ok, ok);
    expect(await links().resolve('/order/4821')).toBeNull();
    expect(await links().resolve('')).toBeNull();
    expect(await links().resolve(undefined as unknown as string)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('when the link\'s own host is Tolinku and says no', () => {
  // The host is ours and has answered. Asking the API as well would count the
  // email click twice.
  it.each([
    ['a plain 404', { error: 'Route not found' }],
    ['a 404 with a web_url', { error: 'Route not found', web_url: 'https://example.com/fallback' }],
  ])('stops at %s', async (_label, body) => {
    serve({ status: 404, body }, ok);
    expect(await links().resolve('https://links.example.com/x/1')).toBeNull();
    expect(apiCalls()).toHaveLength(0);
    expect(ownCalls()).toHaveLength(1);
  });

  it('stops at any status with an error field, a 500 included, without retrying', async () => {
    serve({ status: 500, body: { error: 'Internal error' } }, ok);
    expect(await links().resolve('https://links.example.com/x/1')).toBeNull();
    expect(calls()).toHaveLength(1);
  });
});

describe('telling Tolinku\'s reply from an email platform\'s', () => {
  const esp = 'https://click.mailer.com/ls/click?upn=XYZ';

  it('an email platform that answers in JSON with an error field does not stop the unwrap', async () => {
    serve({ status: 404, body: { error: 'Link not found' } }, ok);
    const link = await links().resolve(esp);
    expect(apiCalls()).toHaveLength(1);
    expect(link?.deep_link_path).toBe('/order/4821/receipt');
  });

  it('a reply marked X-Tolinku is Tolinku\'s answer on any host, and stops there', async () => {
    serve({ status: 404, body: { error: 'Route not found' }, tolinku: true }, ok);
    expect(await links().resolve('https://go.brand.com/x/1')).toBeNull();
    expect(apiCalls()).toHaveLength(0);
  });

  it('a marked reply stops even without an error field', async () => {
    serve({ status: 200, body: {}, tolinku: true }, ok);
    expect(await links().resolve('https://go.brand.com/x/1')).toBeNull();
    expect(apiCalls()).toHaveLength(0);
  });

  it('a server that sends no header is trusted by its error body only on Tolinku\'s own domain', async () => {
    serve({ status: 404, body: { error: 'Route not found' } }, ok);
    expect(await links().resolve('https://api.example.com/x/1')).toBeNull();
    expect(await links().resolve('https://links.example.com/x/1')).toBeNull();
    expect(apiCalls()).toHaveLength(0);
    expect(await links().resolve('https://go.brand.com/x/1')).not.toBeNull();
    expect(apiCalls()).toHaveLength(1);
  });
});

describe('a link wrapped by an email platform', () => {
  // Email platforms wrap every link in a click-tracking URL on their own host,
  // which has never heard of Tolinku. On the web that host usually refuses the
  // request outright under CORS, so Tolinku's API is asked with the whole link,
  // and it does the unwrapping.
  const wrapped = 'https://url1234.email.brand.com/uni/ls/click?upn=XYZ';

  it.each<[string, Reply]>([
    ['a network or CORS failure', corsFailure],
    ['a non-JSON 404', { status: 404, notJson: true }],
    ['a non-JSON 200', { status: 200, notJson: true }],
    ['JSON without an error field', { status: 404, body: { message: 'nope' } }],
    ['a 200 that is not an answer', { status: 200, body: {} }],
  ])('asks the API once, with the key, after %s', async (_label, own) => {
    serve(own, ok);

    const link = await links().resolve(wrapped);

    expect(ownCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(1);
    const api = apiCalls()[0];
    expect(api.body).toEqual({ url: wrapped });
    expect(api.headers['X-API-Key']).toBe('tolk_pub_test');
    expect(link?.deep_link_path).toBe('/order/4821/receipt');
  });

  it('does not retry either request', async () => {
    serve(corsFailure, corsFailure);
    expect(await links().resolve(wrapped)).toBeNull();
    expect(ownCalls()).toHaveLength(1);
    expect(apiCalls()).toHaveLength(1);
  });

  it('does not retry a 503 from either', async () => {
    serve({ status: 503, notJson: true }, { status: 503, body: { error: 'Unavailable' } });
    expect(await links().resolve(wrapped)).toBeNull();
    expect(calls()).toHaveLength(2);
  });

  it.each([
    ['the same host', 'https://api.example.com/s7k2p9q/4821'],
    ['the same host in capitals', 'https://API.Example.com/s7k2p9q/4821'],
    ['the same host on another port', 'https://api.example.com:8443/s7k2p9q/4821'],
  ])('does not ask the API about a link on %s', async (_label, link) => {
    serve(corsFailure, ok);
    expect(await links().resolve(link)).toBeNull();
    expect(apiCalls()).toHaveLength(0);
  });

  it('compares with the API host ignoring its case and port too', async () => {
    serve(corsFailure, ok);
    expect(await links('tolk_pub_test', 'https://Links.Example.com:8443').resolve('https://links.example.com/s/1')).toBeNull();
    expect(calls()).toHaveLength(1);
  });

  it('does not ask the API without a key', async () => {
    serve(corsFailure, ok);
    expect(await links('').resolve(wrapped)).toBeNull();
    expect(apiCalls()).toHaveLength(0);
  });

  it('does not ask the API when the link\'s own host answered', async () => {
    serve(ok, ok);
    expect(await links().resolve(wrapped)).not.toBeNull();
    expect(apiCalls()).toHaveLength(0);
  });

  it('returns null rather than throwing when the API says no', async () => {
    serve(corsFailure, { status: 404, body: { error: 'Not found' } });
    await expect(links().resolve(wrapped)).resolves.toBeNull();
    expect(apiCalls()).toHaveLength(1);
  });
});

describe('the time limit', () => {
  /** A fetch that never answers, and fails the way fetch does when aborted. */
  function hang(_url: string, init: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }

  it('gives each request 5 seconds, then moves on', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);

    const pending = links().resolve('https://click.mailer.com/ls/click?upn=XYZ');

    await vi.advanceTimersByTimeAsync(4999);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls()[0].signal.aborted).toBe(true);
    expect(calls()).toHaveLength(2);
    expect(calls()[1].url).toBe(API_RESOLVE);

    await vi.advanceTimersByTimeAsync(5000);
    expect(calls()[1].signal.aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(calls()).toHaveLength(2);
  });

});
