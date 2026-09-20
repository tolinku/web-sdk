import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Messages, sanitizeCssUrl } from '../src/messages.js';
import { isSafeUrl } from '../src/url-safety.js';
import type { HttpClient } from '../src/client.js';
import type { Message } from '../src/types.js';

// The helpers themselves, not a copy of them. The copy that used to live here
// had drifted from the real rule, so these tests passed on behaviour the SDK
// does not have.

/** Where the renderer would have sent the page, since jsdom cannot navigate. */
function captureNavigation(): { href: string | null } {
  const captured: { href: string | null } = { href: null };
  const original = window.location.href;
  const stub = { ...window.location } as unknown as Location;
  Object.defineProperty(stub, 'href', {
    get: () => captured.href ?? original,
    set: (value: string) => {
      captured.href = value;
    },
    configurable: true,
  });
  vi.spyOn(window, 'location', 'get').mockReturnValue(stub);
  return captured;
}

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

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    name: 'Test Message',
    title: 'Welcome',
    body: 'Hello world',
    trigger: 'manual',
    trigger_value: '',
    content: {
      root: { props: {} },
      content: [
        {
          type: 'Heading',
          props: { text: 'Welcome!', fontSize: 24, color: '#000000', alignment: 'center' },
        },
        {
          type: 'Button',
          props: {
            label: 'Visit Site',
            action: 'https://example.com',
            bgColor: '#1B1B1B',
            textColor: '#ffffff',
          },
        },
      ],
    },
    background_color: '#ffffff',
    priority: 10,
    dismiss_days: 7,
    max_impressions: null,
    min_interval_hours: null,
    ...overrides,
  };
}

describe('isSafeUrl', () => {
  it('should block javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('should block javascript: with mixed case', () => {
    // URL constructor normalizes the protocol, so this still gets caught
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
  });

  it('should block data: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('should allow http: URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
  });

  it('should allow https: URLs', () => {
    expect(isSafeUrl('https://example.com/path?query=1')).toBe(true);
  });

  it('should allow relative URLs (resolved against base)', () => {
    expect(isSafeUrl('/some/path')).toBe(true);
  });

  it('should treat an empty or absent URL as unsafe', () => {
    // An empty string resolves to the current page, which is not a URL anyone
    // authored. There is nothing to open, so there is nothing safe about it.
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });
});

describe('sanitizeCssUrl', () => {
  it('should escape backslashes', () => {
    expect(sanitizeCssUrl('https://example.com/path\\file')).toBe('https://example.com/path\\\\file');
  });

  it('should escape double quotes', () => {
    expect(sanitizeCssUrl('https://example.com/path"file')).toBe('https://example.com/path\\"file');
  });

  it('should strip newlines', () => {
    expect(sanitizeCssUrl('https://example.com/path\nfile')).toBe('https://example.com/pathfile');
  });

  it('should strip carriage returns', () => {
    expect(sanitizeCssUrl('https://example.com/path\rfile')).toBe('https://example.com/pathfile');
  });

  it('should return null for javascript: URLs', () => {
    expect(sanitizeCssUrl('javascript:alert(1)')).toBeNull();
  });

  it('should allow valid https URLs', () => {
    expect(sanitizeCssUrl('https://cdn.example.com/image.jpg')).toBe('https://cdn.example.com/image.jpg');
  });
});

describe('Messages - button click handler', () => {
  let client: ReturnType<typeof createMockClient>;
  let messages: Messages;

  beforeEach(() => {
    // dismiss() fades the overlay out and removes it on a timer, so the card
    // from the previous test is still in the document when the next one runs
    // and document.querySelector finds that one instead of this one's.
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    client = createMockClient();
    messages = new Messages(client);
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    messages.dismiss();
    vi.restoreAllMocks();
  });

  it('should call onButtonPress callback when button is clicked', async () => {
    const message = makeMessage();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [message] });

    const onButtonPress = vi.fn();
    await messages.show({ onButtonPress });

    const button = document.querySelector('.tolk-msg-card button:not(.tolk-msg-close)') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button?.click();

    expect(onButtonPress).toHaveBeenCalledWith('https://example.com', 'msg-1');
  });

  it('should navigate to action URL for safe URLs when no onButtonPress', async () => {
    const message = makeMessage();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [message] });

    const navigation = captureNavigation();
    await messages.show();

    const button = document.querySelector('.tolk-msg-card button:not(.tolk-msg-close)') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Visit Site');
    button?.click();

    expect(navigation.href).toBe('https://example.com');
  });

  it('should NOT navigate for javascript: URLs in button actions', async () => {
    const message = makeMessage({
      content: {
        root: { props: {} },
        content: [
          {
            type: 'Button',
            props: {
              label: 'Evil Button',
              action: 'javascript:alert(1)',
              bgColor: '#000',
              textColor: '#fff',
            },
          },
        ],
      },
    });

    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [message] });

    const navigation = captureNavigation();
    await messages.show();

    const button = document.querySelector('.tolk-msg-card button:not(.tolk-msg-close)') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button?.click();

    // The assertion the old version of this test left out: it installed a
    // location spy and then asserted nothing about it, so a button that did
    // navigate to javascript: would have passed.
    expect(navigation.href).toBeNull();
  });
});
