import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Messages } from '../src/messages.js';
import type { HttpClient } from '../src/client.js';
import type { Message, MessageAppContext, MessageComponent } from '../src/types.js';

/**
 * What every renderer of an in-app message owes the person who designed it,
 * as set out in MESSAGE-RENDERING-SPEC.md.
 *
 * Each test here names one thing this renderer used to drop on the floor: a
 * Section's entire contents, an authored zero, an image's height, a button's
 * variant, a deep link destination, the whole message surface. They are
 * written against the rendered DOM rather than the code, so reverting the fix
 * fails the test rather than moving it.
 */

const APP: MessageAppContext = {
  name: 'Tasonic',
  icon_url: 'https://cdn.example.com/logo.png',
  ios_store_url: 'https://apps.apple.com/app/id1',
  android_store_url: 'https://play.google.com/store/apps/details?id=x',
  deep_link_url: 'https://links.tasonic.com/install',
  ios_badge_url: 'https://api.example.com/images/defaults/badges/ios-store-badge-black.png',
  android_badge_url: 'https://api.example.com/images/defaults/badges/play-store-badge-black.png',
};

function createMockClient(): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ messages: [] }),
    getPublic: vi.fn().mockResolvedValue({}),
    postPublic: vi.fn().mockResolvedValue({}),
    abort: vi.fn(),
  } as unknown as HttpClient;
}

function makeMessage(content: Message['content'], overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    name: 'Test Message',
    title: 'Welcome',
    body: 'Hello world',
    trigger: 'manual',
    trigger_value: '',
    content,
    background_color: '#ffffff',
    priority: 10,
    dismiss_days: 7,
    max_impressions: null,
    min_interval_hours: null,
    ...overrides,
  };
}

let client: HttpClient;
let messages: Messages;

/** Show one message and hand back the card it drew. */
async function show(
  content: Message['content'],
  opts: {
    app?: MessageAppContext;
    message?: Partial<Message>;
    onDismiss?: (id: string) => void;
    onButtonPress?: (action: string, id: string) => void;
  } = {},
): Promise<HTMLElement> {
  const message = makeMessage(content, opts.message);
  (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
    messages: [message],
    ...(opts.app ? { app: opts.app } : {}),
  });
  await messages.show({ onDismiss: opts.onDismiss, onButtonPress: opts.onButtonPress });
  const card = document.querySelector('.tolk-msg-card') as HTMLElement;
  expect(card).not.toBeNull();
  return card;
}

/** The buttons the message itself drew, never the overlay's close button. */
function contentButtons(card: HTMLElement): HTMLButtonElement[] {
  return Array.from(card.querySelectorAll('button:not(.tolk-msg-close)'));
}

function component(type: string, props: Record<string, unknown>): MessageComponent {
  return { type, props };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  client = createMockClient();
  messages = new Messages(client);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  messages.dismiss();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Section children', () => {
  it('draws the children Puck wrote to the section zone', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Section', { id: 'Section-abc', padding: 12 })],
      zones: {
        'Section-abc:content': [
          component('Heading', { text: 'Inside the section' }),
          component('TextBlock', { content: 'Also inside' }),
        ],
      },
    });

    const section = card.querySelector('div[style*="min-height"]') as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.querySelector('h2')?.textContent).toBe('Inside the section');
    expect(section.querySelector('p')?.textContent).toBe('Also inside');
  });

  it('draws a section nested inside another section', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Section', { id: 'outer' })],
      zones: {
        'outer:content': [component('Section', { id: 'inner' })],
        'inner:content': [component('Heading', { text: 'Two deep' })],
      },
    });

    expect(card.querySelectorAll('h2')).toHaveLength(1);
    expect(card.querySelector('h2')?.textContent).toBe('Two deep');
  });

  it('draws an empty section rather than failing when the zone is missing', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Section', { id: 'lonely' }), component('Heading', { text: 'After' })],
      zones: {},
    });

    expect(card.querySelector('h2')?.textContent).toBe('After');
  });
});

describe('an authored zero', () => {
  it('keeps a square image, rather than rounding it by 8px', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Image', { url: 'https://cdn.example.com/a.png', borderRadius: 0 })],
    });

    const img = card.querySelector('img') as HTMLImageElement;
    expect(img.style.borderRadius).toBe('0px');
  });

  it('keeps a square button', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Button', { label: 'Go', action: 'https://example.com', borderRadius: 0 })],
    });

    expect(contentButtons(card)[0]!.style.borderRadius).toBe('0px');
  });

  it('keeps a section with no padding', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Section', { id: 's1', padding: 0 })],
      zones: { 's1:content': [] },
    });

    const section = card.querySelector('div[style*="min-height"]') as HTMLElement;
    expect(section.style.padding).toBe('0px');
  });

  it('keeps a spacer of no height and a divider of no thickness', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Spacer', { height: 0 }), component('Divider', { thickness: 0 })],
    });

    const spacer = card.querySelector('div[style*="height"]') as HTMLElement;
    expect(spacer.style.height).toBe('0px');
    expect((card.querySelector('hr') as HTMLElement).style.borderTopWidth).toBe('0px');
  });

  it('still falls back when nothing was authored', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Image', { url: 'https://cdn.example.com/a.png' }), component('Spacer', {})],
    });

    expect((card.querySelector('img') as HTMLElement).style.borderRadius).toBe('8px');
    expect((card.querySelector('div[style*="height"]') as HTMLElement).style.height).toBe('24px');
  });
});

describe('image dimensions', () => {
  const cases: Array<[string, unknown, string]> = [
    ['a unitless number is pixels', '200', '200px'],
    ['a px string is pixels', '200px', '200px'],
    ['a percentage is a percentage', '50%', '50%'],
    ['auto is the natural size', 'auto', 'auto'],
    ['an empty field is the natural size', '', 'auto'],
    ['something unreadable is the natural size', '20rem', 'auto'],
    ['a number is pixels', 200, '200px'],
  ];

  for (const [name, authored, expected] of cases) {
    it(`width: ${name}`, async () => {
      const card = await show({
        root: { props: {} },
        content: [component('Image', { url: 'https://cdn.example.com/a.png', width: authored })],
      });
      expect((card.querySelector('img') as HTMLElement).style.width).toBe(expected);
    });

    it(`height: ${name}`, async () => {
      const card = await show({
        root: { props: {} },
        content: [component('Image', { url: 'https://cdn.example.com/a.png', height: authored })],
      });
      expect((card.querySelector('img') as HTMLElement).style.height).toBe(expected);
    });
  }

  it('never produces the "autopx" the old renderer wrote', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Image', { url: 'https://cdn.example.com/a.png', width: 'auto' })],
    });
    expect((card.querySelector('img') as HTMLElement).getAttribute('style')).not.toContain('autopx');
  });

  it('sets a height at all, which it never used to', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Image', { url: 'https://cdn.example.com/a.png', height: '120px' })],
    });
    expect((card.querySelector('img') as HTMLElement).style.height).toBe('120px');
  });

  it('draws the border the author asked for', async () => {
    const card = await show({
      root: { props: {} },
      content: [
        component('Image', { url: 'https://cdn.example.com/a.png', borderWidth: 2, borderColor: '#ff0000' }),
      ],
    });
    const img = card.querySelector('img') as HTMLElement;
    expect(img.style.borderTopWidth).toBe('2px');
    expect(img.style.borderTopColor).toBe('rgb(255, 0, 0)');
  });
});

describe('button', () => {
  it('draws an outline button as an outline, with a readable label', async () => {
    const card = await show({
      root: { props: {} },
      content: [
        component('Button', {
          label: 'Learn more',
          action: 'https://example.com',
          style: 'outline',
          bgColor: '#1B1B1B',
          textColor: '#ffffff',
        }),
      ],
    });

    const button = contentButtons(card)[0]!;
    expect(button.style.backgroundColor).toBe('transparent');
    expect(button.style.color).toBe('rgb(27, 27, 27)');
    expect(button.style.borderTopWidth).toBe('2px');
  });

  it('draws a soft button as a tint of its colour', async () => {
    const card = await show({
      root: { props: {} },
      content: [
        component('Button', {
          label: 'Maybe later',
          action: 'close',
          style: 'soft',
          bgColor: '#1B1B1B',
          textColor: '#ffffff',
        }),
      ],
    });

    const button = contentButtons(card)[0]!;
    expect(button.style.backgroundColor).toBe('rgba(27, 27, 27, 0.133)');
    expect(button.style.color).toBe('rgb(27, 27, 27)');
  });

  it('draws a filled button filled, with the author\'s text colour', async () => {
    const card = await show({
      root: { props: {} },
      content: [
        component('Button', {
          label: 'Go',
          action: 'https://example.com',
          style: 'filled',
          bgColor: '#1B1B1B',
          textColor: '#ffffff',
        }),
      ],
    });

    const button = contentButtons(card)[0]!;
    expect(button.style.backgroundColor).toBe('rgb(27, 27, 27)');
    expect(button.style.color).toBe('rgb(255, 255, 255)');
  });

  it('puts the emoji in front of the label', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Button', { label: 'Get it', emoji: '🎁', action: 'https://example.com' })],
    });

    const button = contentButtons(card)[0]!;
    expect(button.textContent).toBe('🎁 Get it');
    expect(button.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('centres a button that is not full width, and leaves it compact', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Button', { label: 'Go', action: 'https://example.com', fullWidth: false })],
    });

    const button = contentButtons(card)[0]!;
    expect(button.style.width).toBe('auto');
    expect((button.parentElement as HTMLElement).style.textAlign).toBe('center');
  });

  it('stretches a full width button', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Button', { label: 'Go', action: 'https://example.com', fullWidth: true })],
    });

    expect(contentButtons(card)[0]!.style.width).toBe('100%');
  });

  it('dismisses on a close action, and does not treat it as a destination', async () => {
    const onDismiss = vi.fn();
    const onButtonPress = vi.fn();
    const card = await show(
      { root: { props: {} }, content: [component('Button', { label: 'No thanks', action: 'close' })] },
      { onDismiss, onButtonPress },
    );

    contentButtons(card)[0]!.click();

    expect(onDismiss).toHaveBeenCalledWith('msg-1');
    expect(onButtonPress).not.toHaveBeenCalled();
    expect((document.querySelector('.tolk-msg-overlay') as HTMLElement).style.opacity).toBe('0');
  });
});

describe('button URL safety', () => {
  it('opens a custom scheme, which is the point of a deep linking product', async () => {
    const onButtonPress = vi.fn();
    const card = await show(
      {
        root: { props: {} },
        content: [component('Button', { label: 'Open app', action: 'myapp://promo/42' })],
      },
      { onButtonPress },
    );

    contentButtons(card)[0]!.click();
    expect(onButtonPress).toHaveBeenCalledWith('myapp://promo/42', 'msg-1');
  });

  it('opens an intent and a market URL too', async () => {
    const onButtonPress = vi.fn();
    const card = await show(
      {
        root: { props: {} },
        content: [
          component('Button', { label: 'Store', action: 'market://details?id=com.example' }),
          component('Button', { label: 'Intent', action: 'intent://x#Intent;scheme=myapp;end' }),
        ],
      },
      { onButtonPress },
    );

    const buttons = contentButtons(card);
    buttons[0]!.click();
    buttons[1]!.click();
    expect(onButtonPress).toHaveBeenCalledTimes(2);
  });

  it('refuses the schemes that execute, handler or no handler', async () => {
    const onButtonPress = vi.fn();
    const card = await show(
      {
        root: { props: {} },
        content: [
          component('Button', { label: 'Evil', action: 'javascript:alert(1)' }),
          component('Button', { label: 'Also evil', action: 'data:text/html,<script>alert(1)</script>' }),
          component('Button', { label: 'Tabbed', action: 'java\tscript:alert(1)' }),
        ],
      },
      { onButtonPress },
    );

    for (const button of contentButtons(card)) button.click();
    expect(onButtonPress).not.toHaveBeenCalled();
  });
});

describe('markdown links', () => {
  it('turns [text](url) into a link', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('TextBlock', { content: 'Read the [docs](https://tolinku.com/docs) first.' })],
    });

    const link = card.querySelector('p a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://tolinku.com/docs');
    expect(link.textContent).toBe('docs');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(card.querySelector('p')?.textContent).toBe('Read the docs first.');
  });

  it('keeps a same-site link in the same tab', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('TextBlock', { content: 'See [pricing](/pricing).' })],
    });

    const link = card.querySelector('p a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/pricing');
    expect(link.target).toBe('');
  });

  it('shows an unsafe scheme as plain text instead of linking it', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('TextBlock', { content: 'Click [here](javascript:alert(1)) now.' })],
    });

    expect(card.querySelector('p a')).toBeNull();
    expect(card.querySelector('p')?.textContent).toContain('[here](javascript:alert(1))');
  });

  it('escapes nothing and invents nothing in ordinary text', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('TextBlock', { content: 'Plain <b>text</b> & symbols' })],
    });

    const p = card.querySelector('p') as HTMLElement;
    expect(p.textContent).toBe('Plain <b>text</b> & symbols');
    expect(p.querySelector('b')).toBeNull();
  });
});

describe('root props', () => {
  it('paints the surface the author designed', async () => {
    const card = await show({
      root: {
        props: {
          bgColor: '#101010',
          padding: 40,
          contentWidth: 480,
          verticalAlign: 'top',
        },
      },
      content: [component('Heading', { text: 'Hi' })],
    });

    expect(card.style.backgroundColor).toBe('rgb(16, 16, 16)');
    expect(card.style.padding).toBe('40px');
    expect(card.style.maxWidth).toBe('480px');
    expect((document.querySelector('.tolk-msg-overlay') as HTMLElement).style.alignItems).toBe('flex-start');
  });

  it('centres the card when the author asked for centre', async () => {
    await show({
      root: { props: { verticalAlign: 'center' } },
      content: [component('Heading', { text: 'Hi' })],
    });

    expect((document.querySelector('.tolk-msg-overlay') as HTMLElement).style.alignItems).toBe('center');
  });

  it('draws a gradient as a gradient, not as a white card', async () => {
    const card = await show({
      root: { props: { bgGradient: 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)' } },
      content: [component('Heading', { text: 'Hi' })],
    });

    expect(card.style.backgroundImage).toContain('linear-gradient');
  });

  it('draws a background image', async () => {
    const card = await show({
      root: { props: { bgImage: 'https://cdn.example.com/bg.png' } },
      content: [component('Heading', { text: 'Hi' })],
    });

    expect(card.style.backgroundImage).toContain('https://cdn.example.com/bg.png');
    expect(card.style.backgroundSize).toBe('cover');
  });

  it('refuses a gradient carrying something that is not a gradient', async () => {
    const card = await show({
      root: { props: { bgGradient: 'red;background-image:url(javascript:alert(1))' } },
      content: [component('Heading', { text: 'Hi' })],
    });

    expect(card.getAttribute('style') || '').not.toContain('javascript:');
  });

  it('falls back to the message background colour when the root sets none', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('Heading', { text: 'Hi' })] },
      { message: { background_color: '#abcdef' } },
    );

    expect(card.style.backgroundColor).toBe('rgb(171, 205, 239)');
  });
});

describe('the app components', () => {
  it('draws the app icon at the size asked for', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('AppIcon', { size: 96, borderRadius: 0 })] },
      { app: APP },
    );

    const img = card.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(APP.icon_url);
    expect(img.style.width).toBe('96px');
    expect(img.style.height).toBe('96px');
    expect(img.style.borderRadius).toBe('0px');
  });

  it('draws a placeholder rather than a gap when the app has no icon', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('AppIcon', { size: 64 })] },
      { app: { ...APP, icon_url: null } },
    );

    expect(card.querySelector('img')).toBeNull();
    const placeholder = card.querySelector('div[style*="64px"]') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.style.height).toBe('64px');
  });

  it('draws both store badges, linked to the stores', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('StoreButtons', { alignment: 'center', height: 50 })] },
      { app: APP },
    );

    const links = Array.from(card.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links.map(a => a.getAttribute('href'))).toEqual([APP.ios_store_url, APP.android_store_url]);
    expect((links[0]!.querySelector('img') as HTMLElement).style.height).toBe('50px');
    expect((card.querySelector('div[style*="flex"]') as HTMLElement).style.justifyContent).toBe('center');
  });

  it('draws the badge artwork the API sent, rather than guessing at a path', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('StoreButtons', {})] },
      { app: APP },
    );

    const badges = Array.from(card.querySelectorAll('img')) as HTMLImageElement[];
    expect(badges.map(img => img.getAttribute('src'))).toEqual([APP.ios_badge_url, APP.android_badge_url]);
  });

  it('still draws the store link when the badge artwork is missing', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('StoreButtons', { showAndroid: false })] },
      { app: { ...APP, ios_badge_url: null } },
    );

    const link = card.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(APP.ios_store_url);
    expect(link.textContent).toBe('Download on the App Store');
  });

  it('prefers an override URL over the app\'s own', async () => {
    const card = await show(
      {
        root: { props: {} },
        content: [component('StoreButtons', { iosUrlOverride: 'https://apps.apple.com/app/id999', showAndroid: false })],
      },
      { app: APP },
    );

    const links = Array.from(card.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('https://apps.apple.com/app/id999');
  });

  it('leaves out a store the app has no URL for', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('StoreButtons', {})] },
      { app: { ...APP, ios_store_url: null } },
    );

    const links = Array.from(card.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(APP.android_store_url);
  });

  it('opens the app\'s deep link from the deep link button', async () => {
    const onButtonPress = vi.fn();
    const card = await show(
      {
        root: { props: {} },
        content: [component('DeepLinkButton', { label: 'Open in App', bgColor: '#1B1B1B', borderRadius: 0 })],
      },
      { app: APP, onButtonPress },
    );

    const button = contentButtons(card)[0]!;
    expect(button.textContent).toBe('Open in App');
    expect(button.style.borderRadius).toBe('0px');
    button.click();
    expect(onButtonPress).toHaveBeenCalledWith(APP.deep_link_url, 'msg-1');
  });

  it('leaves the deep link button out when there is nowhere to go', async () => {
    const card = await show(
      { root: { props: {} }, content: [component('DeepLinkButton', { label: 'Open in App' })] },
      { app: { ...APP, deep_link_url: null } },
    );

    expect(contentButtons(card)).toHaveLength(0);
  });

  it('draws a placeholder icon when the API sends no app at all', async () => {
    const card = await show({ root: { props: {} }, content: [component('AppIcon', { size: 80 })] });

    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('div[style*="80px"]')).not.toBeNull();
  });
});

describe('a message with no content', () => {
  it('draws the title and body when the content tree is empty', async () => {
    const card = await show({ root: { props: {} }, content: [] });

    expect(card.querySelector('h2')?.textContent).toBe('Welcome');
    expect(card.querySelector('p')?.textContent).toBe('Hello world');
  });

  it('draws the title and body when there is no content at all', async () => {
    const card = await show(null);

    expect(card.querySelector('h2')?.textContent).toBe('Welcome');
    expect(card.querySelector('p')?.textContent).toBe('Hello world');
  });

  it('draws the title and body when every component was unusable', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Avatar', { url: 'https://cdn.example.com/a.png' })],
    });

    expect(card.querySelector('h2')?.textContent).toBe('Welcome');
  });

  it('leaves the fallback out once the content draws something', async () => {
    const card = await show({
      root: { props: {} },
      content: [component('Heading', { text: 'Designed heading' })],
    });

    expect(Array.from(card.querySelectorAll('h2')).map(h => h.textContent)).toEqual(['Designed heading']);
    expect(card.querySelector('p')).toBeNull();
  });
});

describe('spacing parity with the server renderer', () => {
  it('adds no margins of its own to text, images, buttons or dividers', async () => {
    const card = await show({
      root: { props: {} },
      content: [
        component('Heading', { text: 'Title' }),
        component('TextBlock', { content: 'Body' }),
        component('Image', { url: 'https://cdn.example.com/a.png' }),
        component('Button', { label: 'Go', action: 'https://example.com' }),
        component('Divider', {}),
        component('Section', { id: 's1' }),
      ],
      zones: { 's1:content': [] },
    });

    for (const el of Array.from(card.children) as HTMLElement[]) {
      if (el.classList.contains('tolk-msg-close')) continue;
      expect(el.style.margin === '' || el.style.margin === '0px').toBe(true);
      expect(el.style.marginBottom === '' || el.style.marginBottom === '0px').toBe(true);
    }
    expect((card.querySelector('img') as HTMLElement).style.margin).toBe('');
    expect((card.querySelector('hr') as HTMLElement).style.margin).toBe('0px');
  });
});
