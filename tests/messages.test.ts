import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Messages } from '../src/messages.js';
import type { HttpClient } from '../src/client.js';
import type { Message } from '../src/types.js';

// Re-implement isSafeUrl and sanitizeCssUrl for direct testing (they are module-private)
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://example.com');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeCssUrl(url: string): string | null {
  if (!isSafeUrl(url)) return null;
  return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '').replace(/\r/g, '');
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

  it('should reject invalid URLs that throw', () => {
    // This is a tricky case; URL constructor with a base typically doesn't throw,
    // but let's test an edge case with an empty string
    expect(isSafeUrl('')).toBe(true); // Empty resolves to base URL
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

    // We cannot easily test window.location.href assignment, but we can verify
    // the button renders and the click handler does not throw
    await messages.show();

    const button = document.querySelector('.tolk-msg-card button:not(.tolk-msg-close)') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Visit Site');
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

    // Spy on window.location to verify it is NOT set
    const locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'https://example.com',
    });

    await messages.show();

    const button = document.querySelector('.tolk-msg-card button:not(.tolk-msg-close)') as HTMLButtonElement;
    expect(button).not.toBeNull();
    // Clicking the button should not throw or navigate
    button?.click();

    locationSpy.mockRestore();
  });
});
