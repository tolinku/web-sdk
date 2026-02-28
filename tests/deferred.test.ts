import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Deferred } from '../src/deferred.js';
import type { HttpClient } from '../src/client.js';
import type { DeferredLink } from '../src/types.js';

function createMockClient(): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    getPublic: vi.fn().mockResolvedValue({}),
    postPublic: vi.fn().mockResolvedValue({}),
    abort: vi.fn(),
  } as unknown as HttpClient;
}

describe('Deferred', () => {
  let client: ReturnType<typeof createMockClient>;
  let deferred: Deferred;

  beforeEach(() => {
    client = createMockClient();
    deferred = new Deferred(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- Claim by token --

  it('should claim a deferred link by token', async () => {
    const link: DeferredLink = {
      deep_link_path: '/product/123',
      appspace_id: 'app-1',
      referrer_id: 'user-abc',
    };
    (client.getPublic as ReturnType<typeof vi.fn>).mockResolvedValue(link);

    const result = await deferred.claimByToken('token-xyz');

    expect(client.getPublic).toHaveBeenCalledWith('/v1/api/deferred/claim', { token: 'token-xyz' });
    expect(result).toEqual(link);
  });

  it('should return null and warn on claimByToken error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (client.getPublic as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await deferred.claimByToken('bad-token');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('Failed to claim deferred link by token');
  });

  // -- Claim by signals --

  it('should claim a deferred link by signals', async () => {
    const link: DeferredLink = {
      deep_link_path: '/onboarding',
      appspace_id: 'app-1',
    };
    (client.postPublic as ReturnType<typeof vi.fn>).mockResolvedValue(link);

    const result = await deferred.claimBySignals({
      appspaceId: 'app-1',
      timezone: 'America/New_York',
      language: 'en-US',
      screenWidth: 1920,
      screenHeight: 1080,
    });

    expect(client.postPublic).toHaveBeenCalledWith('/v1/api/deferred/claim-by-signals', {
      appspace_id: 'app-1',
      timezone: 'America/New_York',
      language: 'en-US',
      screen_width: 1920,
      screen_height: 1080,
    });
    expect(result).toEqual(link);
  });

  it('should use default timezone and language when not provided', async () => {
    const link: DeferredLink = {
      deep_link_path: '/home',
      appspace_id: 'app-2',
    };
    (client.postPublic as ReturnType<typeof vi.fn>).mockResolvedValue(link);

    await deferred.claimBySignals({ appspaceId: 'app-2' });

    const [, body] = (client.postPublic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.appspace_id).toBe('app-2');
    // Should use Intl defaults
    expect(typeof body.timezone).toBe('string');
    expect(typeof body.language).toBe('string');
    expect(typeof body.screen_width).toBe('number');
    expect(typeof body.screen_height).toBe('number');
  });

  it('should return null and warn on claimBySignals error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (client.postPublic as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error'));

    const result = await deferred.claimBySignals({ appspaceId: 'app-1' });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('Failed to claim deferred link by signals');
  });
});
