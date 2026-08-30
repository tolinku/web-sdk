import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Deferred } from '../src/deferred.js';
import type { HttpClient } from '../src/client.js';

/**
 * claimDeferredLink exists on the web for the bookkeeping rather than for the
 * install referrer, which has no web equivalent. A claim is consumed the first
 * time it succeeds, so an app calling claimBySignals on every page load asks
 * again after the answer is spent and each of those is recorded as a miss. The
 * match rate then falls while the integration is working.
 */

const LINK = { deep_link_path: '/product/42', appspace_id: 'app123' };

function clientThat(behaviour: () => Promise<unknown>): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    post: vi.fn(), get: vi.fn(), getPublic: vi.fn(), abort: vi.fn(),
    postPublic: vi.fn().mockImplementation(behaviour),
  } as unknown as HttpClient;
}

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status, statusCode: status });
}

/** A localStorage that actually stores, since jsdom is not assumed here. */
function installStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
  });
  vi.stubGlobal('navigator', { language: 'en-GB' });
  return mem;
}

describe('claimDeferredLink on the web', () => {
  beforeEach(() => { vi.unstubAllGlobals(); installStorage(); });

  it('claims once and does not ask again', async () => {
    const client = clientThat(async () => LINK);
    const d = new Deferred(client);

    expect(await d.claimDeferredLink({ appspaceId: 'app123' })).toEqual(LINK);
    expect(await d.claimDeferredLink({ appspaceId: 'app123' })).toBeNull();
    expect(client.postPublic).toHaveBeenCalledTimes(1);
  });

  it('remembers a 404, because nothing waiting is a real answer', async () => {
    const client = clientThat(async () => { throw httpError(404); });
    const d = new Deferred(client);

    expect(await d.claimDeferredLink({ appspaceId: 'app123' })).toBeNull();
    await d.claimDeferredLink({ appspaceId: 'app123' });
    expect(client.postPublic).toHaveBeenCalledTimes(1);
  });

  it('does not spend the attempt when the request never landed', async () => {
    // A dropped connection is not an answer. Burning the install's one chance
    // on it is worse than one extra request.
    const client = clientThat(async () => { throw new Error('network down'); });
    const d = new Deferred(client);

    await d.claimDeferredLink({ appspaceId: 'app123' });
    await d.claimDeferredLink({ appspaceId: 'app123' });
    expect(client.postPublic).toHaveBeenCalledTimes(2);
  });

  it('does not spend the attempt on a misconfigured appspaceId', async () => {
    // 403 means the id is wrong. They fix it and the next run must be free to try.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = clientThat(async () => { throw httpError(403); });
    const d = new Deferred(client);

    await d.claimDeferredLink({ appspaceId: 'wrong' });
    await d.claimDeferredLink({ appspaceId: 'wrong' });
    expect(client.postPublic).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('force claims again, for tests', async () => {
    const client = clientThat(async () => LINK);
    const d = new Deferred(client);

    await d.claimDeferredLink({ appspaceId: 'app123' });
    expect(await d.claimDeferredLink({ appspaceId: 'app123', force: true })).toEqual(LINK);
    expect(client.postPublic).toHaveBeenCalledTimes(2);
  });

  it('rejects a blank appspaceId rather than claiming against nothing', async () => {
    const d = new Deferred(clientThat(async () => LINK));
    await expect(d.claimDeferredLink({ appspaceId: '  ' })).rejects.toThrow(/appspaceId/);
  });

  it('still claims when storage is blocked, as in a private window', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
      },
      screen: { width: 390, height: 844 }, devicePixelRatio: 3,
    });
    const client = clientThat(async () => LINK);
    const d = new Deferred(client);

    expect(await d.claimDeferredLink({ appspaceId: 'app123' })).toEqual(LINK);
  });

  it('leaves claimBySignals asking every time it is called', async () => {
    // The older call is unchanged: it is the caller's job to invoke it once.
    const client = clientThat(async () => LINK);
    const d = new Deferred(client);

    await d.claimBySignals({ appspaceId: 'app123' });
    await d.claimBySignals({ appspaceId: 'app123' });
    expect(client.postPublic).toHaveBeenCalledTimes(2);
  });
});
