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
      });
    } catch (err) {
      console.warn('[Tolinku] Failed to claim deferred link by signals:', err);
      return null;
    }
  }
}
