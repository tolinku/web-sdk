import { describe, it, expect, vi } from 'vitest';
import { Links } from '../src/links.js';
import type { HttpClient } from '../src/client.js';
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
 * The question has to go to the link's own host, because that is how Tolinku
 * knows which Appspace is being asked about. The client is deliberately
 * configured with a different base URL, so a request sent there instead shows
 * up as a failure rather than passing by accident.
 */

const answer: ResolvedLink = {
  route: { prefix: 'order/{token}/receipt', name: 'Order Receipt', template: 'none', link_type: 'dynamic' },
  token: '4821',
  deep_link_path: '/order/4821/receipt',
};

function mockClient(impl?: ReturnType<typeof vi.fn>) {
  const postPublicToOrigin = impl ?? vi.fn().mockResolvedValue(answer);
  return {
    client: { baseUrl: 'https://api.example.com', postPublicToOrigin } as unknown as HttpClient,
    postPublicToOrigin,
  };
}

describe('resolving a short link', () => {
  it('asks the link its own host, with just the path', async () => {
    const { client, postPublicToOrigin } = mockClient();

    const link = await new Links(client).resolve('https://links.example.com/s7k2p9q/4821');

    expect(postPublicToOrigin).toHaveBeenCalledWith(
      'https://links.example.com',
      '/v1/api/path',
      { path: '/s7k2p9q/4821' },
    );
    expect(link?.token).toBe('4821');
    expect(link?.deep_link_path).toBe('/order/4821/receipt');
    expect(link?.route.prefix).toBe('order/{token}/receipt');
  });

  it('leaves the query string out of the question', async () => {
    // A tapped link usually carries utm parameters, and they say nothing about
    // which route it is.
    const { client, postPublicToOrigin } = mockClient();
    await new Links(client).resolve('https://links.example.com/s7k2p9q/4821?utm_source=qr');
    expect(postPublicToOrigin).toHaveBeenCalledWith(expect.anything(), '/v1/api/path', { path: '/s7k2p9q/4821' });
  });

  it('keeps an encoded slash in the token encoded', async () => {
    // Decoding first turns "/promo/a%2Fb" into a path three deep rather than a
    // token of "a/b" on "promo", which resolves to a different route or none.
    const { client, postPublicToOrigin } = mockClient();
    await new Links(client).resolve('https://links.example.com/promo/a%2Fb');
    expect(postPublicToOrigin).toHaveBeenCalledWith(expect.anything(), '/v1/api/path', { path: '/promo/a%2Fb' });
  });
});

describe('an answer that is not a path', () => {
  // resolve sends its question to a host taken from the URL it was given, so
  // resolving a link from somewhere you do not control is talking to a
  // stranger. Anything but a path is a redirect waiting to happen.
  it.each([
    ['a full URL', 'https://evil.example.com/take-over'],
    ['a protocol relative URL', '//evil.example.com/take-over'],
    ['a bare word', 'order/4821'],
    ['nothing', ''],
  ])('refuses %s', async (_label, deep_link_path) => {
    const { client } = mockClient(vi.fn().mockResolvedValue({ ...answer, deep_link_path }));
    expect(await new Links(client).resolve('https://links.example.com/s7k2p9q/4821')).toBeNull();
  });
});

describe('what it declines to ask about', () => {
  it('says nothing for a custom scheme link', async () => {
    // That one already carries the path that is wanted.
    const { client, postPublicToOrigin } = mockClient();
    expect(await new Links(client).resolve('myapp://order/4821/receipt')).toBeNull();
    expect(postPublicToOrigin).not.toHaveBeenCalled();
  });

  it('says nothing for something that is not a URL', async () => {
    const { client, postPublicToOrigin } = mockClient();
    expect(await new Links(client).resolve('/order/4821')).toBeNull();
    expect(await new Links(client).resolve('')).toBeNull();
    expect(postPublicToOrigin).not.toHaveBeenCalled();
  });
});

describe('when the answer does not come', () => {
  it('returns null rather than throwing', async () => {
    const { client } = mockClient(vi.fn().mockRejectedValue(new Error('network down')));
    await expect(new Links(client).resolve('https://links.example.com/s7k2p9q/4821')).resolves.toBeNull();
  });

  it('returns null for a link this Appspace does not own', async () => {
    const { client } = mockClient(vi.fn().mockResolvedValue({}));
    expect(await new Links(client).resolve('https://links.example.com/x/1')).toBeNull();
  });
});
