import type { HttpClient } from './client.js';
import type { DeferredLink, ClaimBySignalsOptions } from './types.js';

export class Deferred {
  constructor(private client: HttpClient) {}

  /** Claim a deferred deep link by referrer token (from Play Store referrer or clipboard) */
  async claimByToken(token: string): Promise<DeferredLink | null> {
    try {
      return await this.client.getPublic<DeferredLink>('/v1/api/deferred/claim', { token });
    } catch (err) {
      console.warn('[Tolinku] Failed to claim deferred link by token:', err);
      return null;
    }
  }

  /** Claim a deferred deep link by device signal matching */
  async claimBySignals(options: ClaimBySignalsOptions): Promise<DeferredLink | null> {
    try {
      return await this.client.postPublic<DeferredLink>('/v1/api/deferred/claim-by-signals', {
        appspace_id: options.appspaceId,
        timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: options.language || navigator.language,
        screen_width: options.screenWidth || window.screen.width,
        screen_height: options.screenHeight || window.screen.height,
        // Separates devices reporting identical logical dimensions.
        device_pixel_ratio: options.devicePixelRatio || window.devicePixelRatio || 1,
      });
    } catch (err) {
      // A 404 is the ordinary "nothing waiting for this device" outcome. Any other
      // status is a configuration problem worth naming: a 403 in particular means
      // appspaceId is wrong, and a generic warning sends people looking elsewhere.
      const status = (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { status?: number })?.status;
      if (status === 404) {
        // Nothing is waiting for this device. The ordinary outcome, not a fault.
        return null;
      }
      if (status === 403) {
        console.warn(
          '[Tolinku] Failed to claim deferred link by signals: HTTP 403.',
          'Check that appspaceId is your Appspace ID (copy it from the dashboard',
          'under Settings), not your subdomain or slug.',
          err,
        );
        return null;
      }
      console.warn('[Tolinku] Failed to claim deferred link by signals:', err);
      return null;
    }
  }
}
