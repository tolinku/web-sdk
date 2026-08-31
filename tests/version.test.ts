import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { SDK_VERSION } from '../src/types.js';
import { HttpClient } from '../src/client.js';

/**
 * SDK_VERSION is sent on every request as `X-Tolinku-SDK`, so a drift from the
 * published version silently misreports which SDK is in the field. The Flutter
 * SDK's constant sat at 0.1.0 through two releases before a guard like this
 * existed, and nothing about that failure was specific to Flutter.
 *
 * This SDK sent no version at all until 0.4.1, which is why the second group
 * matters as much as the first: a constant nothing transmits identifies nothing.
 */
describe('SDK_VERSION', () => {
  // Relative to the package root, which is where vitest runs. import.meta.url is
  // not a file: URL under the jsdom environment these tests use.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string;
  };

  it('matches package.json', () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('looks like a version rather than a placeholder', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  describe('reaches the server', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('rides on every request as X-Tolinku-SDK', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'ok' }),
        text: async () => '{"data":"ok"}',
      } as unknown as Response);

      const client = new HttpClient({
        apiKey: 'tolk_pub_test_123',
        baseUrl: 'https://api.example.com',
      });
      await client.get('/v1/test');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['X-Tolinku-SDK']).toBe(`web/${SDK_VERSION}`);
    });

    it('still sends the API key alongside it', async () => {
      // Adding a header by rewriting the object that carries the key is exactly
      // how the key would go missing, so both are asserted on the same request.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '{}',
      } as unknown as Response);

      const client = new HttpClient({
        apiKey: 'tolk_pub_test_123',
        baseUrl: 'https://api.example.com',
      });
      await client.get('/v1/test');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['X-API-Key']).toBe('tolk_pub_test_123');
    });
  });
});
