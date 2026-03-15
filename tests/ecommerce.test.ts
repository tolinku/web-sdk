import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ecommerce } from '../src/ecommerce.js';
import type { HttpClient } from '../src/client.js';

function createMockClient(): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    key: 'tolk_pub_test',
    post: vi.fn().mockResolvedValue({ ok: true }),
    get: vi.fn().mockResolvedValue({}),
    getPublic: vi.fn().mockResolvedValue({}),
    postPublic: vi.fn().mockResolvedValue({}),
    abort: vi.fn(),
  } as unknown as HttpClient;
}

describe('Ecommerce', () => {
  let client: ReturnType<typeof createMockClient>;
  let ecommerce: Ecommerce;
  let userId: string | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
    userId = null;
    ecommerce = new Ecommerce(client, () => userId);
  });

  afterEach(() => {
    ecommerce.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -- Queuing --

  it('should queue events without sending immediately', async () => {
    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('should flush at batch size (10 events)', async () => {
    for (let i = 0; i < 10; i++) {
      await ecommerce.viewItem({ items: [{ item_id: `sku_${i}` }] });
    }
    expect(client.post).toHaveBeenCalledOnce();
    const [path, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/v1/api/analytics/ecommerce/batch');
    expect(body.events).toHaveLength(10);
  });

  it('should flush after 5 seconds', async () => {
    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    expect(client.post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.post).toHaveBeenCalledOnce();
  });

  // -- Purchase --

  it('should send purchase with all fields', async () => {
    await ecommerce.purchase({
      transaction_id: 'order_123',
      revenue: 49.99,
      currency: 'USD',
      coupon_code: 'SAVE10',
      discount: 5.0,
      shipping: 4.99,
      tax: 3.75,
      items: [{ item_id: 'sku_1', item_name: 'T-Shirt', price: 24.99, quantity: 2 }],
    });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const event = body.events[0];
    expect(event.event_type).toBe('purchase');
    expect(event.transaction_id).toBe('order_123');
    expect(event.revenue).toBe(49.99);
    expect(event.currency).toBe('USD');
    expect(event.coupon_code).toBe('SAVE10');
    expect(event.discount).toBe(5.0);
    expect(event.shipping).toBe(4.99);
    expect(event.tax).toBe(3.75);
    expect(event.items).toHaveLength(1);
    expect(event.items[0].item_id).toBe('sku_1');
  });

  // -- User ID injection --

  it('should inject user_id when set', async () => {
    userId = 'user_456';
    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].user_id).toBe('user_456');
  });

  it('should not inject user_id when null', async () => {
    userId = null;
    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].user_id).toBeUndefined();
  });

  // -- Cart ID lifecycle --

  it('should auto-generate cart_id on addToCart', async () => {
    await ecommerce.addToCart({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const cartId = body.events[0].cart_id;
    expect(cartId).toBeDefined();
    expect(typeof cartId).toBe('string');
    expect(cartId.length).toBeGreaterThan(0);
  });

  it('should reuse cart_id across cart events', async () => {
    await ecommerce.addToCart({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.viewCart();
    await ecommerce.beginCheckout({});
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const cartIds = body.events.map((e: any) => e.cart_id).filter(Boolean);
    // All non-undefined cart_ids should be the same
    expect(new Set(cartIds).size).toBe(1);
  });

  it('should clear cart_id after purchase', async () => {
    await ecommerce.addToCart({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.purchase({ transaction_id: 'order_1', revenue: 10, currency: 'USD' });
    // Start a new cart
    await ecommerce.addToCart({ items: [{ item_id: 'sku_2' }] });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const firstCartId = body.events[0].cart_id;
    const lastCartId = body.events[2].cart_id;
    // New cart should have a different ID
    expect(firstCartId).not.toBe(lastCartId);
  });

  // -- All 13 event types --

  it('should track all 13 event types', async () => {
    await ecommerce.viewItem({ items: [{ item_id: 'a' }] });
    await ecommerce.addToCart({ items: [{ item_id: 'a' }] });
    await ecommerce.removeFromCart({ items: [{ item_id: 'a' }] });
    await ecommerce.addToWishlist({ items: [{ item_id: 'a' }] });
    await ecommerce.viewCart();
    await ecommerce.addPaymentInfo();
    await ecommerce.beginCheckout({});
    await ecommerce.purchase({ transaction_id: 't', revenue: 1, currency: 'USD' });
    await ecommerce.refund({ transaction_id: 't', revenue: 1 });
    await ecommerce.search({ search_term: 'shoes' });
    // Batch should have flushed at 10, now queue the rest
    await ecommerce.share({ item_id: 'a' });
    await ecommerce.rate({ item_id: 'a', rating: 5 });
    await ecommerce.spendCredits({ revenue: 10, currency: 'USD' });
    await ecommerce.flush();

    // Collect all events from both flushes
    const allEvents: any[] = [];
    for (const call of (client.post as ReturnType<typeof vi.fn>).mock.calls) {
      allEvents.push(...call[1].events);
    }
    const types = allEvents.map((e: any) => e.event_type);
    expect(types).toContain('view_item');
    expect(types).toContain('add_to_cart');
    expect(types).toContain('remove_from_cart');
    expect(types).toContain('add_to_wishlist');
    expect(types).toContain('view_cart');
    expect(types).toContain('add_payment_info');
    expect(types).toContain('begin_checkout');
    expect(types).toContain('purchase');
    expect(types).toContain('refund');
    expect(types).toContain('search');
    expect(types).toContain('share');
    expect(types).toContain('rate');
    expect(types).toContain('spend_credits');
  });

  // -- Error recovery --

  it('should re-queue events on flush failure', async () => {
    (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.viewItem({ items: [{ item_id: 'sku_2' }] });
    await ecommerce.flush();

    // Events should be re-queued
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await ecommerce.flush();

    expect(client.post).toHaveBeenCalledTimes(2);
    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(body.events).toHaveLength(2);
  });

  // -- Endpoint --

  it('should POST to /v1/api/analytics/ecommerce/batch', async () => {
    await ecommerce.viewItem({ items: [{ item_id: 'sku_1' }] });
    await ecommerce.flush();
    expect(client.post).toHaveBeenCalledWith('/v1/api/analytics/ecommerce/batch', expect.any(Object));
  });

  // -- Search properties --

  it('should send search_term in properties', async () => {
    await ecommerce.search({ search_term: 'blue shoes' });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].properties.search_term).toBe('blue shoes');
  });

  // -- Rate properties --

  it('should send rating as string in properties', async () => {
    await ecommerce.rate({ item_id: 'sku_1', rating: 4.5, max_rating: 5 });
    await ecommerce.flush();

    const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.events[0].properties.rating).toBe('4.5');
    expect(body.events[0].properties.max_rating).toBe('5');
  });
});
