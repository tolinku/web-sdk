import type { HttpClient } from './client.js';
import type { DeferredLink, ClaimBySignalsOptions } from './types.js';

/**
 * Where a completed claim attempt is remembered.
 *
 * Same name the React Native and Flutter SDKs use, so an app sharing code
 * across them reads one key rather than three.
 */
const CLAIMED_KEY = 'tolinku_deferred_claimed';

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

  /**
   * Recover the link that led here, once.
   *
   * There is no Play Install Referrer on the web, so this is signal matching
   * with the bookkeeping that makes calling it safe. That bookkeeping is the
   * point: a claim is consumed the first time it succeeds, so an app calling
   * claimBySignals on every page load asks again after the answer is already
   * spent, and every one of those asks is recorded as a miss. The match rate on
   * the dashboard then falls towards zero while the integration is working
   * correctly, which is a hard thing to diagnose from the outside.
   *
   * Call it once on first run. Calling it again is free after the first.
   *
   * Named to match the Android, React Native and Flutter SDKs, where the same
   * call also tries the install referrer before falling back to here.
   */
  async claimDeferredLink(options: {
    appspaceId: string;
    /** Claim again even if an attempt was already recorded. For tests. */
    force?: boolean;
  }): Promise<DeferredLink | null> {
    if (!options.appspaceId || !options.appspaceId.trim()) {
      throw new Error('Tolinku: appspaceId is required and must not be blank for claimDeferredLink.');
    }

    if (!options.force && this.alreadyAttempted()) return null;

    const { link, settled } = await this.attemptSignals({ appspaceId: options.appspaceId });
    // Only a real answer is remembered. A dropped request leaves this unwritten
    // so the next run tries again: losing an install's attribution to one bad
    // connection is worse than one extra request.
    if (settled) this.rememberAttempt();
    return link;
  }

  private alreadyAttempted(): boolean {
    try {
      return window.localStorage.getItem(CLAIMED_KEY) !== null;
    } catch {
      // Storage blocked, as in a private window or with cookies disabled.
      // Attempt the claim rather than skip it: an extra request costs less than
      // an install nobody can attribute.
      return false;
    }
  }

  private rememberAttempt(): void {
    try {
      window.localStorage.setItem(CLAIMED_KEY, new Date().toISOString());
    } catch {
      // Not worth failing a claim that already succeeded.
    }
  }

  /** Claim a deferred deep link by device signal matching */
  async claimBySignals(options: ClaimBySignalsOptions): Promise<DeferredLink | null> {
    return (await this.attemptSignals(options)).link;
  }

  /**
   * The signal claim, with whether the server actually answered.
   *
   * `settled` separates "nothing is waiting for this device", which no amount
   * of asking will change, from "the request never got there". Both surface as
   * null to callers of claimBySignals, but claimDeferredLink has to tell them
   * apart: recording an attempt that never reached the server would spend an
   * install's one chance at attribution on a dropped connection.
   */
  private async attemptSignals(
    options: ClaimBySignalsOptions,
  ): Promise<{ link: DeferredLink | null; settled: boolean }> {
    try {
      const link = await this.client.postPublic<DeferredLink>('/v1/api/deferred/claim-by-signals', {
        appspace_id: options.appspaceId,
        timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: options.language || navigator.language,
        screen_width: options.screenWidth || window.screen.width,
        screen_height: options.screenHeight || window.screen.height,
        // Separates devices reporting identical logical dimensions.
        device_pixel_ratio: options.devicePixelRatio || window.devicePixelRatio || 1,
      });
      return { link, settled: true };
    } catch (err) {
      // A 404 is the ordinary "nothing waiting for this device" outcome. Any other
      // status is a configuration problem worth naming: a 403 in particular means
      // appspaceId is wrong, and a generic warning sends people looking elsewhere.
      const status = (err as { statusCode?: number; status?: number })?.statusCode
        ?? (err as { status?: number })?.status;
      if (status === 404) {
        // Nothing is waiting for this device. The ordinary outcome, not a fault,
        // and a real answer: worth remembering so it is not asked again.
        return { link: null, settled: true };
      }
      if (status === 403) {
        console.warn(
          '[Tolinku] Failed to claim deferred link by signals: HTTP 403.',
          'Check that appspaceId is your Appspace ID (copy it from the dashboard',
          'under Settings), not your subdomain or slug.',
          err,
        );
        // Not settled: the caller can fix the id and the next run should try
        // again rather than find the attempt already spent.
        return { link: null, settled: false };
      }
      console.warn('[Tolinku] Failed to claim deferred link by signals:', err);
      return { link: null, settled: false };
    }
  }
}
