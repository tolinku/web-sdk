import type { HttpClient } from './client.js';
import type {
  EcommerceItem, PurchaseParams, AddToCartParams, RemoveFromCartParams,
  AddToWishlistParams, BeginCheckoutParams, RefundParams, ViewItemParams,
  SearchParams, ShareParams, RateParams, SpendCreditsParams, AddPaymentInfoParams,
} from './types.js';

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE_SIZE = 500;
const CART_ID_KEY = 'tolk_cart_id';

interface QueuedEcomEvent {
  event_type: string;
  transaction_id?: string;
  revenue?: number;
  currency?: string;
  cart_id?: string;
  coupon_code?: string;
  discount?: number;
  shipping?: number;
  tax?: number;
  items?: EcommerceItem[];
  properties?: Record<string, string>;
  user_id?: string;
  campaign?: string;
  source?: string;
  medium?: string;
  platform?: string;
}

export class Ecommerce {
  private queue: QueuedEcomEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private unloadHandler: (() => void) | null = null;
  private getUserId: () => string | null;
  private memoryCartId: string | null = null; // fallback when sessionStorage unavailable

  constructor(private client: HttpClient, getUserId: () => string | null) {
    this.getUserId = getUserId;

    if (typeof window !== 'undefined') {
      this.unloadHandler = () => this.flushBeacon();
      window.addEventListener('beforeunload', this.unloadHandler);
    }
  }

  // ─── Public methods (13 event types) ────────────────────

  async viewItem(params: ViewItemParams): Promise<void> {
    await this.enqueue({ event_type: 'view_item', items: params.items });
  }

  async addToCart(params: AddToCartParams): Promise<void> {
    const cartId = params.cart_id || this.getOrCreateCartId();
    await this.enqueue({ event_type: 'add_to_cart', items: params.items, cart_id: cartId });
  }

  async removeFromCart(params: RemoveFromCartParams): Promise<void> {
    await this.enqueue({ event_type: 'remove_from_cart', items: params.items, cart_id: params.cart_id || this.getCartId() });
  }

  async addToWishlist(params: AddToWishlistParams): Promise<void> {
    await this.enqueue({ event_type: 'add_to_wishlist', items: params.items });
  }

  async viewCart(): Promise<void> {
    await this.enqueue({ event_type: 'view_cart', cart_id: this.getCartId() });
  }

  async addPaymentInfo(params?: AddPaymentInfoParams): Promise<void> {
    await this.enqueue({ event_type: 'add_payment_info', cart_id: params?.cart_id || this.getCartId() });
  }

  async beginCheckout(params: BeginCheckoutParams): Promise<void> {
    await this.enqueue({
      event_type: 'begin_checkout',
      revenue: params.revenue,
      currency: params.currency,
      cart_id: params.cart_id || this.getCartId(),
      items: params.items,
    });
  }

  async purchase(params: PurchaseParams): Promise<void> {
    const cartId = params.cart_id || this.getCartId();
    await this.enqueue({
      event_type: 'purchase',
      transaction_id: params.transaction_id,
      revenue: params.revenue,
      currency: params.currency,
      cart_id: cartId,
      coupon_code: params.coupon_code,
      discount: params.discount,
      shipping: params.shipping,
      tax: params.tax,
      items: params.items,
    });
    // Clear cart ID after purchase
    this.clearCartId();
  }

  async refund(params: RefundParams): Promise<void> {
    await this.enqueue({
      event_type: 'refund',
      transaction_id: params.transaction_id,
      revenue: params.revenue,
      currency: params.currency,
      items: params.items,
    });
  }

  async search(params: SearchParams): Promise<void> {
    await this.enqueue({ event_type: 'search', properties: { search_term: params.search_term } });
  }

  async share(params: ShareParams): Promise<void> {
    const props: Record<string, string> = {};
    if (params.item_id) props.item_id = params.item_id;
    if (params.url) props.url = params.url;
    if (params.method) props.method = params.method;
    await this.enqueue({ event_type: 'share', properties: props });
  }

  async rate(params: RateParams): Promise<void> {
    await this.enqueue({
      event_type: 'rate',
      properties: {
        item_id: params.item_id,
        rating: String(params.rating),
        ...(params.max_rating != null ? { max_rating: String(params.max_rating) } : {}),
      },
    });
  }

  async spendCredits(params: SpendCreditsParams): Promise<void> {
    await this.enqueue({ event_type: 'spend_credits', revenue: params.revenue, currency: params.currency });
  }

  // ─── Flush ─────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) return;

    const events = this.queue.splice(0);

    try {
      const result = await this.client.post<{ ok: boolean; accepted?: number; errors?: string[] }>(
        '/v1/api/analytics/ecommerce/batch',
        { events },
      );
      if (result.errors && result.errors.length > 0) {
        console.warn('[TolinkuSDK] Ecommerce batch partial failure:', result.errors);
      }
    } catch {
      // Re-queue on failure
      this.queue.unshift(...events);
      if (this.queue.length > MAX_QUEUE_SIZE) {
        this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
      }
    }
  }

  destroy(): void {
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

  // ─── Private ───────────────────────────────────────────

  private async enqueue(event: QueuedEcomEvent): Promise<void> {
    // Auto-inject user_id
    const userId = this.getUserId();
    if (userId) event.user_id = userId;

    this.queue.push(event);

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

  private flushBeacon(): void {
    if (this.queue.length === 0) return;

    const events = this.queue.splice(0);
    const url = this.client.baseUrl + '/v1/api/analytics/ecommerce/batch';
    const body = JSON.stringify({ events, apiKey: this.client.key });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
  }

  // ─── Cart ID lifecycle ─────────────────────────────────

  private getOrCreateCartId(): string {
    const existing = this.getCartId();
    if (existing) return existing;

    const cartId = this.generateId();
    this.setCartId(cartId);
    return cartId;
  }

  private getCartId(): string | undefined {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(CART_ID_KEY);
        if (stored) return stored;
      }
    } catch { /* ignore */ }
    return this.memoryCartId || undefined;
  }

  private setCartId(cartId: string): void {
    this.memoryCartId = cartId;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(CART_ID_KEY, cartId);
      }
    } catch { /* Safari private mode throws QuotaExceededError, memoryCartId is the fallback */ }
  }

  private clearCartId(): void {
    this.memoryCartId = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(CART_ID_KEY);
      }
    } catch { /* ignore */ }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
