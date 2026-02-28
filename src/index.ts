import { HttpClient, TolinkuError } from './client.js';
import { Analytics } from './analytics.js';
import { Referrals } from './referrals.js';
import { Deferred } from './deferred.js';
import { Banners } from './banners.js';
import { Messages } from './messages.js';
import type {
  TolinkuConfig,
  TrackProperties,
  ShowBannerOptions,
  ShowMessageOptions,
} from './types.js';

export class Tolinku {
  private client: HttpClient;

  /** Analytics: track custom events */
  readonly analytics: Analytics;
  /** Referrals: create, complete, milestone, leaderboard */
  readonly referrals: Referrals;
  /** Deferred deep links: claim by token or signals */
  readonly deferred: Deferred;

  private banners: Banners;
  private messages: Messages;

  /** The current user ID, used for segment targeting and analytics. */
  private _userId: string | null = null;

  constructor(config: TolinkuConfig) {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw new Error('Tolinku: apiKey is required and must be a non-empty string');
    }
    const resolvedConfig = {
      ...config,
      baseUrl: config.baseUrl || 'https://api.tolinku.com',
    };

    // Validate baseUrl is a proper URL
    try {
      const parsed = new URL(resolvedConfig.baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Tolinku: baseUrl must use http: or https: protocol');
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Tolinku:')) throw e;
      throw new Error('Tolinku: baseUrl must be a valid URL (e.g. https://api.tolinku.com)');
    }

    this.client = new HttpClient(resolvedConfig);
    this.analytics = new Analytics(this.client);
    this.referrals = new Referrals(this.client);
    this.deferred = new Deferred(this.client);
    this.banners = new Banners(this.client);
    this.messages = new Messages(this.client);
  }

  /**
   * Set the user ID for segment targeting and analytics attribution.
   * Pass null to clear the user ID.
   */
  setUserId(userId: string | null): void {
    this._userId = userId;
  }

  /**
   * Track a custom event (shorthand for analytics.track).
   * Event type is auto-prefixed with "custom." if not already.
   * If a userId has been set, it is automatically injected into event properties.
   */
  async track(eventType: string, properties?: TrackProperties): Promise<void> {
    const mergedProps = this._userId
      ? { user_id: this._userId, ...properties }
      : properties;
    return this.analytics.track(eventType, mergedProps);
  }

  /** Show a smart banner at the top or bottom of the page */
  async showBanner(options?: ShowBannerOptions): Promise<void> {
    return this.banners.show(options, this._userId);
  }

  /** Dismiss the currently visible smart banner */
  dismissBanner(): void {
    this.banners.dismiss();
  }

  /** Show an in-app message as a modal overlay */
  async showMessage(options?: ShowMessageOptions): Promise<void> {
    return this.messages.show(options, this._userId);
  }

  /** Dismiss the currently visible in-app message */
  dismissMessage(): void {
    this.messages.dismiss();
  }

  /** Flush any queued analytics events immediately */
  async flush(): Promise<void> {
    return this.analytics.flush();
  }

  /** Clean up all DOM elements, flush events, and cancel in-flight requests (e.g. before unmounting in SPAs) */
  destroy(): void {
    this.analytics.destroy();
    this.client.abort();
    this.banners.dismiss();
    this.messages.dismiss();
  }
}

// Re-export types and error class
export { TolinkuError } from './client.js';
export type {
  TolinkuConfig,
  TrackProperties,
  CreateReferralOptions,
  CreateReferralResult,
  CompleteReferralOptions,
  CompleteReferralResult,
  MilestoneOptions,
  MilestoneResult,
  ReferralInfo,
  LeaderboardEntry,
  DeferredLink,
  ClaimBySignalsOptions,
  BannerConfig,
  BannerItem,
  ShowBannerOptions,
  Message,
  MessageContent,
  MessageComponent,
  ShowMessageOptions,
} from './types.js';
