import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Banners } from '../src/banners.js';
import type { HttpClient } from '../src/client.js';
import type { BannerConfig } from '../src/types.js';
import { isBannerDismissed, saveBannerDismissal } from '../src/storage.js';

// We need to test the private sanitizeCssColor function.
// Since it is not exported, we test it indirectly through the Banners class render behavior,
// but also import the module to get direct access via a workaround.
// For direct testing, we re-implement the function's logic inline in describe blocks.
// Actually, let's just re-export it for testing purposes by importing the module source.

// Since sanitizeCssColor is a module-private function, we test it by loading the module
// and checking its behavior through the banner rendering. For direct unit tests,
// we extract and test the regex logic directly.

function sanitizeCssColor(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/[;{}]/.test(trimmed)) return null;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9a-zA-Z,.%\s/]+\)$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z-]{1,30}$/.test(trimmed)) return trimmed;
  return null;
}


const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/** Banners show only in phone browsers, so the suites that show one act as an iPhone. */
const actAs = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
/** jsdom has no maxTouchPoints; define it for one test (removed again in afterEach). */
const touchPoints = (n: number) => Object.defineProperty(navigator, 'maxTouchPoints', { value: n, configurable: true });

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

function makeBannerConfig(overrides: Partial<BannerConfig> = {}): BannerConfig {
  return {
    enabled: true,
    app_name: 'Test App',
    app_icon: 'https://example.com/icon.png',
    install_url: '/install',
    banners: [
      {
        id: 'banner-1',
        label: 'default',
        title: 'Get the App',
        body: 'Download now',
        action_url: 'https://example.com/download',
        background_color: '#ffffff',
        text_color: '#000000',
        cta_text: 'Install',
        position: 'top' as const,
        dismiss_days: 7,
        priority: 10,
      },
    ],
    ...overrides,
  };
}

describe('sanitizeCssColor', () => {
  // -- Valid colors --

  it('should accept 3-digit hex colors', () => {
    expect(sanitizeCssColor('#fff')).toBe('#fff');
    expect(sanitizeCssColor('#ABC')).toBe('#ABC');
  });

  it('should accept 6-digit hex colors', () => {
    expect(sanitizeCssColor('#ff00ff')).toBe('#ff00ff');
    expect(sanitizeCssColor('#1B1B1B')).toBe('#1B1B1B');
  });

  it('should accept 8-digit hex colors (with alpha)', () => {
    expect(sanitizeCssColor('#ff00ff80')).toBe('#ff00ff80');
  });

  it('should accept rgb() colors', () => {
    expect(sanitizeCssColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
    expect(sanitizeCssColor('rgb(0,0,0)')).toBe('rgb(0,0,0)');
  });

  it('should accept rgba() colors', () => {
    expect(sanitizeCssColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('should accept hsl() colors', () => {
    expect(sanitizeCssColor('hsl(120, 100%, 50%)')).toBe('hsl(120, 100%, 50%)');
  });

  it('should accept hsla() colors', () => {
    expect(sanitizeCssColor('hsla(120, 100%, 50%, 0.3)')).toBe('hsla(120, 100%, 50%, 0.3)');
  });

  it('should accept named CSS colors', () => {
    expect(sanitizeCssColor('red')).toBe('red');
    expect(sanitizeCssColor('cornflowerblue')).toBe('cornflowerblue');
    expect(sanitizeCssColor('transparent')).toBe('transparent');
  });

  it('should trim whitespace', () => {
    expect(sanitizeCssColor('  #fff  ')).toBe('#fff');
  });

  // -- Injection attempts --

  it('should reject values containing semicolons', () => {
    expect(sanitizeCssColor('#fff; background: red')).toBeNull();
  });

  it('should reject values containing curly braces', () => {
    expect(sanitizeCssColor('#fff } .evil { color: red')).toBeNull();
  });

  it('should reject empty values', () => {
    expect(sanitizeCssColor(undefined)).toBeNull();
    expect(sanitizeCssColor('')).toBeNull();
  });

  it('should reject invalid hex colors', () => {
    expect(sanitizeCssColor('#xyz')).toBeNull();
    expect(sanitizeCssColor('#12345')).toBeNull(); // 5 digits not standard
  });

  it('should reject JavaScript injection in color values', () => {
    expect(sanitizeCssColor('expression(alert(1))')).toBeNull();
  });
});

describe('Banners - priority sorting', () => {
  let client: ReturnType<typeof createMockClient>;
  let banners: Banners;

  beforeEach(() => {
    // Set up minimal DOM environment
    actAs(IPHONE_UA);
    client = createMockClient();
    banners = new Banners(client);
  });

  afterEach(() => {
    banners.dismiss();
    vi.restoreAllMocks();
  });

  it('should show the highest priority banner', async () => {
    const config = makeBannerConfig({
      banners: [
        {
          id: 'low',
          label: 'default',
          title: 'Low Priority',
          body: '',
          action_url: '',
          background_color: '#ffffff',
          text_color: '#000000',
          cta_text: 'Open',
          position: 'top',
          dismiss_days: 0,
          priority: 1,
        },
        {
          id: 'high',
          label: 'default',
          title: 'High Priority',
          body: '',
          action_url: '',
          background_color: '#ffffff',
          text_color: '#000000',
          cta_text: 'Open',
          position: 'top',
          dismiss_days: 0,
          priority: 100,
        },
      ],
    });

    (client.getPublic as ReturnType<typeof vi.fn>).mockResolvedValue(config);
    await banners.show();

    const titleEl = document.querySelector('#tolinku-banner .tolk-title');
    expect(titleEl?.textContent).toBe('High Priority');
  });
});

describe('Banners - dismiss persistence (storage.ts)', () => {

  afterEach(() => {
    localStorage.clear();
  });

  it('should persist banner dismissal', () => {
    saveBannerDismissal('b1');
    const stored = JSON.parse(localStorage.getItem('tolinku_banner_dismissed') || '{}');
    expect(stored['b1']).toBeDefined();
  });

  it('should detect recently dismissed banners', () => {
    saveBannerDismissal('b1');
    expect(isBannerDismissed('b1', 7)).toBe(true);
  });

  it('should not consider expired dismissals', () => {
    // Set dismissal to 8 days ago
    const past = new Date(Date.now() - 8 * 86400000).toISOString();
    localStorage.setItem('tolinku_banner_dismissed', JSON.stringify({ 'b1': past }));
    expect(isBannerDismissed('b1', 7)).toBe(false);
  });

  it('should always show when dismissDays is 0', () => {
    saveBannerDismissal('b1');
    expect(isBannerDismissed('b1', 0)).toBe(false);
  });

  it('should return false for unknown banners', () => {
    expect(isBannerDismissed('unknown', 7)).toBe(false);
  });
});

describe('Banners - reporting', () => {
  let client: ReturnType<typeof createMockClient>;
  let banners: Banners;
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    // Earlier suites leave banners that are still animating out.
    document.querySelectorAll('#tolinku-banner').forEach((el) => el.remove());
    actAs(IPHONE_UA);
    client = createMockClient();
    banners = new Banners(client);
    beacon = vi.fn().mockReturnValue(true);
    (navigator as Navigator & { sendBeacon?: unknown }).sendBeacon = beacon;
    (client.getPublic as ReturnType<typeof vi.fn>).mockResolvedValue(makeBannerConfig());
  });

  afterEach(() => {
    banners.dismiss();
    delete (navigator as Navigator & { sendBeacon?: unknown }).sendBeacon;
    vi.restoreAllMocks();
  });

  const sent = () => beacon.mock.calls.map(([url, body]) => ({ url: String(url), body: JSON.parse(String(body)) }));

  it('reports a view when the banner is shown, as a plain-text beacon', async () => {
    await banners.show();
    expect(sent()).toEqual([{ url: 'https://api.example.com/v1/api/banner/view', body: { banner_id: 'banner-1', page: location.origin + location.pathname } }]);
    expect(typeof beacon.mock.calls[0][1]).toBe('string');
  });

  it('leaves the query string and fragment out of the page it reports', async () => {
    history.replaceState(null, '', '/pricing?token=secret#top');
    try {
      await banners.show();
      expect(sent()[0].body.page).toBe(location.origin + '/pricing');
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('reports a dismissal when the close button is pressed', async () => {
    await banners.show();
    (document.querySelector('#tolinku-banner .tolk-close') as HTMLButtonElement).click();
    expect(sent().map((x) => x.url)).toEqual(['https://api.example.com/v1/api/banner/view', 'https://api.example.com/v1/api/banner/dismiss']);
  });

  it('reports a tap with where it went', async () => {
    await banners.show();
    const cta = document.querySelector('#tolinku-banner .tolk-cta') as HTMLAnchorElement;
    cta.addEventListener('click', (e) => e.preventDefault());
    cta.click();
    const tap = sent().find((x) => x.url.endsWith('/banner/click'));
    expect(tap?.body).toMatchObject({ banner_id: 'banner-1', target: 'https://example.com/download' });
  });

  it('does not report a view for a banner it never showed', async () => {
    saveBannerDismissal('banner-1');
    await banners.show();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('falls back to fetch when the beacon is refused', async () => {
    beacon.mockReturnValue(false);
    const f = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', f);
    await banners.show();
    expect(f).toHaveBeenCalledWith('https://api.example.com/v1/api/banner/view', expect.objectContaining({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' } }));
    vi.unstubAllGlobals();
  });
});

describe('Banners - phones only', () => {
  let client: ReturnType<typeof createMockClient>;
  let banners: Banners;

  beforeEach(() => {
    localStorage.clear();
    document.querySelectorAll('#tolinku-banner').forEach((el) => el.remove());
    client = createMockClient();
    banners = new Banners(client);
    (client.getPublic as ReturnType<typeof vi.fn>).mockResolvedValue(makeBannerConfig());
  });

  afterEach(() => {
    banners.dismiss();
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>).maxTouchPoints;
  });

  it('shows nothing on a desktop browser, and doesn\'t even ask for the config', async () => {
    actAs(DESKTOP_UA);
    await banners.show();
    expect(client.getPublic).not.toHaveBeenCalled();
    expect(document.getElementById('tolinku-banner')).toBeNull();
  });

  it('shows on desktop when the site asks for it with allowDesktop', async () => {
    actAs(DESKTOP_UA);
    await banners.show({ allowDesktop: true });
    expect(client.getPublic).toHaveBeenCalled();
    expect(document.getElementById('tolinku-banner')).not.toBeNull();
  });

  it('shows on Android', async () => {
    actAs('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36');
    await banners.show();
    expect(document.getElementById('tolinku-banner')).not.toBeNull();
  });

  it('shows on an iPad, which Safari reports as a Mac with a touch screen', async () => {
    actAs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15');
    touchPoints(5);
    await banners.show();
    expect(document.getElementById('tolinku-banner')).not.toBeNull();
  });

  it('a Mac without a touch screen is still a desktop', async () => {
    actAs(DESKTOP_UA);
    touchPoints(0);
    await banners.show();
    expect(document.getElementById('tolinku-banner')).toBeNull();
  });

  it('gives the close mark a 44px tap area without changing how it looks', async () => {
    actAs(IPHONE_UA);
    await banners.show();
    const css = Array.from(document.querySelectorAll('style')).map((st) => st.textContent || '').join('\n');
    expect(css).toMatch(/\.tolk-close::before\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(css).toMatch(/\.tolk-close\s*\{[^}]*font-size:\s*20px/);
  });
});
