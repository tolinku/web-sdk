import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Analytics } from '../src/analytics.js';
import type { HttpClient } from '../src/client.js';

function createMockClient(): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    key: 'tolk_pub_test',
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    getPublic: vi.fn().mockResolvedValue({}),
    postPublic: vi.fn().mockResolvedValue({}),
    abort: vi.fn(),
  } as unknown as HttpClient;
}

describe('Analytics', () => {
  let client: ReturnType<typeof createMockClient>;
  let analytics: Analytics;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    analytics = new Analytics(client);
  });

  afterEach(() => {
    analytics.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -- Queuing --

  it('should queue events instead of sending immediately', async () => {
    await analytics.track('signup');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('should auto-prefix event type with "custom."', async () => {
    await analytics.track('signup');
    await analytics.flush();

    expect(client.post).toHaveBeenCalledOnce();
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].event_type).toBe('custom.signup');
  });

  it('should not double-prefix event type already starting with "custom."', async () => {
    await analytics.track('custom.purchase');
    await analytics.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].event_type).toBe('custom.purchase');
  });

  // -- Batch flush at 10 events --

  it('should flush automatically when queue reaches 10 events', async () => {
    for (let i = 0; i < 10; i++) {
      await analytics.track(`event_${i}`);
    }

    expect(client.post).toHaveBeenCalledOnce();
    const [path, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/v1/api/analytics/batch');
    expect(body.events).toHaveLength(10);
  });

  // -- Timer flush after 5 seconds --

  it('should flush after 5 seconds if queue is not full', async () => {
    await analytics.track('page_view');
    expect(client.post).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(client.post).toHaveBeenCalledOnce();
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events).toHaveLength(1);
  });

  // -- Manual flush --

  it('should send all queued events on manual flush()', async () => {
    await analytics.track('event_a');
    await analytics.track('event_b');
    await analytics.track('event_c');

    await analytics.flush();

    expect(client.post).toHaveBeenCalledOnce();
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events).toHaveLength(3);
  });

  it('should not send if queue is empty on flush()', async () => {
    await analytics.flush();
    expect(client.post).not.toHaveBeenCalled();
  });

  // -- Event format --

  it('should include event_type and properties', async () => {
    await analytics.track('purchase', { campaign: 'summer' });
    await analytics.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const event = body.events[0];
    expect(event.event_type).toBe('custom.purchase');
    expect(event.properties).toEqual({ campaign: 'summer' });
  });

  // -- Validation --

  it('should reject empty event names', async () => {
    await expect(analytics.track('')).rejects.toThrow('event name must be a non-empty string');
  });

  it('should reject non-string event names', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(analytics.track(123 as any)).rejects.toThrow('event name must be a non-empty string');
  });

  it('should reject whitespace-only event names', async () => {
    await expect(analytics.track('   ')).rejects.toThrow('event name must be a non-empty string');
  });

  it('should reject event names with uppercase letters', async () => {
    await expect(analytics.track('custom.MyEvent')).rejects.toThrow('event name "custom.MyEvent" is invalid');
  });

  it('should reject event names with hyphens', async () => {
    await expect(analytics.track('custom.my-event')).rejects.toThrow('event name "custom.my-event" is invalid');
  });

  it('should reject event names with spaces', async () => {
    await expect(analytics.track('custom.my event')).rejects.toThrow('event name "custom.my event" is invalid');
  });

  it('should reject event names with special characters', async () => {
    await expect(analytics.track('custom.my@event')).rejects.toThrow('event name "custom.my@event" is invalid');
  });

  it('should accept valid event names with lowercase, numbers, and underscores', async () => {
    await analytics.track('custom.valid_event_123');
    await analytics.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].event_type).toBe('custom.valid_event_123');
  });

  // -- Error recovery --

  it('should re-queue events if flush fails', async () => {
    (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await analytics.track('event_a');
    await analytics.track('event_b');
    await analytics.flush();

    // Events should be re-queued; flush again should retry
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    await analytics.flush();

    expect(client.post).toHaveBeenCalledTimes(2);
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(body.events).toHaveLength(2);
  });

  // -- Destroy --

  it('should use sendBeacon on destroy', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: sendBeaconMock });

    // Queue an event synchronously (we need to capture the track call)
    // track() is async but queuing happens synchronously before the batch check
    analytics.track('final_event');

    // Allow microtask to complete
    analytics.destroy();

    expect(sendBeaconMock).toHaveBeenCalledOnce();
    const [url, blob] = sendBeaconMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/api/analytics/batch');
    expect(blob).toBeInstanceOf(Blob);
  });

  // -- Batch endpoint --

  it('should POST to /v1/api/analytics/batch', async () => {
    await analytics.track('test_event');
    await analytics.flush();

    expect(client.post).toHaveBeenCalledWith('/v1/api/analytics/batch', expect.any(Object));
  });
});
