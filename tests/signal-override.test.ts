import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tolinku } from '../src/index.js';

/**
 * Signals passed to `claimBySignals` override what the browser reports.
 *
 * The case worth holding is a blank one. An unset configuration value and a
 * failed lookup both arrive as an empty or whitespace string, and taking one
 * literally would replace a good value with one the matcher cannot use. A signal
 * that is present and disagrees counts against the match, where an absent one is
 * skipped, so a blank override is worse than no override at all.
 */
describe('signal overrides', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'not found' }),
      text: async () => '{"error":"not found"}',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    // jsdom reports a zero-sized screen, which is the value the override is
    // meant to fall back to, so it has to be a real one for these to mean
    // anything.
    vi.stubGlobal('screen', { width: 1440, height: 900 });
    vi.stubGlobal('devicePixelRatio', 2);
  });

  afterEach(() => vi.restoreAllMocks());

  const client = () =>
    new Tolinku({ apiKey: 'tolk_pub_test', baseUrl: 'https://links.example.com' });

  it('sends what the browser reports when nothing is passed', async () => {
    await client().deferred.claimBySignals({ appspaceId: 'app123' });

    expect(body().timezone).toBeTruthy();
    expect(body().language).toBeTruthy();
  });

  it('a passed signal wins', async () => {
    await client().deferred.claimBySignals({
      appspaceId: 'app123',
      timezone: 'Asia/Seoul',
    });

    expect(body().timezone).toBe('Asia/Seoul');
  });

  it('a blank override does not discard what the browser reported', async () => {
    await client().deferred.claimBySignals({
      appspaceId: 'app123',
      timezone: '',
      language: '   ',
    });

    expect(body().timezone).not.toBe('');
    expect(body().language).not.toBe('   ');
    expect(body().timezone).toBeTruthy();
    expect(body().language).toBeTruthy();
  });

  it('a non-positive measurement does not discard what was reported', async () => {
    await client().deferred.claimBySignals({
      appspaceId: 'app123',
      screenWidth: 0,
      screenHeight: -1,
    });

    expect(body().screen_width).toBeGreaterThan(0);
    expect(body().screen_height).toBeGreaterThan(0);
  });

  it('overriding one signal keeps the rest', async () => {
    // Matching compares only what both sides supplied, so dropping the others
    // would leave less to compare on than passing nothing at all.
    await client().deferred.claimBySignals({
      appspaceId: 'app123',
      timezone: 'Asia/Seoul',
    });

    expect(body().language).toBeTruthy();
    expect(body().screen_width).toBeGreaterThan(0);
  });

  it('trims a real override', async () => {
    await client().deferred.claimBySignals({
      appspaceId: 'app123',
      timezone: '  Asia/Seoul  ',
    });

    expect(body().timezone).toBe('Asia/Seoul');
  });
});
