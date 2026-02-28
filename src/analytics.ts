import type { HttpClient } from './client.js';
import type { TrackProperties } from './types.js';

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE_SIZE = 1000;

interface QueuedEvent {
  event_type: string;
  properties: TrackProperties;
}

export class Analytics {
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private unloadHandler: (() => void) | null = null;

  constructor(private client: HttpClient) {
    // Listen for page unload to send remaining events via sendBeacon
    if (typeof window !== 'undefined') {
      this.unloadHandler = () => this.flushBeacon();
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  /**
   * Track a custom event. Event type must start with "custom." and match
   * the pattern custom.[a-z0-9_]+
   *
   * Events are queued and sent in batches for efficiency.
   */
  async track(eventType: string, properties?: TrackProperties): Promise<void> {
    if (typeof eventType !== 'string' || eventType.trim().length === 0) {
      throw new Error('Tolinku: event name must be a non-empty string');
    }

    if (!eventType.startsWith('custom.')) {
      eventType = 'custom.' + eventType;
    }

    // Validate the full event name matches the required pattern
    const eventNameRegex = /^custom\.[a-z0-9_]+$/;
    if (!eventNameRegex.test(eventType)) {
      throw new Error(
        `Tolinku: event name "${eventType}" is invalid. Event names must match the pattern "custom.[a-z0-9_]+" (lowercase letters, numbers, and underscores only after "custom.")`
      );
    }

    this.queue.push({
      event_type: eventType,
      properties: properties || {},
    });

    // Start the flush timer if this is the first queued event
    if (this.queue.length === 1 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_INTERVAL_MS);
    }

    // Flush immediately if the batch is full
    if (this.queue.length >= BATCH_SIZE) {
      await this.flush();
    }
  }

  /** Send all queued events to the server */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) return;

    // Drain the queue before sending (so new events during the request are not lost)
    const events = this.queue.splice(0);

    try {
      const result = await this.client.post<{ ok: boolean; accepted?: number; errors?: string[] }>('/v1/api/analytics/batch', { events });
      if (result.errors && result.errors.length > 0) {
        console.warn('[TolinkuSDK] Batch partial failure:', result.errors);
      }
    } catch {
      // If sending fails, re-queue the events at the front so they can be retried
      this.queue.unshift(...events);

      // Drop the oldest events if the queue exceeds the max size to prevent memory leaks
      if (this.queue.length > MAX_QUEUE_SIZE) {
        this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
      }
    }
  }

  /**
   * Flush remaining events using navigator.sendBeacon (best-effort).
   * Called on page unload when a normal fetch may not complete.
   */
  private flushBeacon(): void {
    if (this.queue.length === 0) return;

    const events = this.queue.splice(0);
    const url = this.client.baseUrl + '/v1/api/analytics/batch';
    const body = JSON.stringify({ events, apiKey: this.client.key });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
  }

  /** Clean up timers and event listeners. Called by Tolinku.destroy(). */
  destroy(): void {
    // Flush remaining events (best-effort via beacon since destroy may be called during teardown)
    this.flushBeacon();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (typeof window !== 'undefined' && this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }
  }
}
