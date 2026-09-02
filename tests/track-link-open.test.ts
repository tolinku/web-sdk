import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Analytics } from '../src/analytics.js';
import { HttpClient } from '../src/client.js';

/**
 * A Universal Link or App Link opens the app without the browser loading, so
 * Tolinku is never contacted and the tap is not recorded. Those taps come from
 * people who already have the app, so leaving them out makes a re-engagement
 * campaign read as a failure exactly when it worked.
 *
 * What decides whether to report is the scheme the app received, and the rule
 * has to hold here as well as on the server: a custom scheme means Tolinku's own
 * hand-off page opened the app, and that tap was counted when the page was
 * served.
 */
describe('trackLinkOpen', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const reply = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

  const analytics = () =>
    new Analytics(
      new HttpClient({ apiKey: 'tolk_pub_test', baseUrl: 'https://links.example.com' }),
    );

  const posted = () => fetchMock.mock.calls.map(c => String(c[0]));

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(reply({ attribute: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.restoreAllMocks());

  it('reports a link the operating system delivered', async () => {
    await analytics().trackLinkOpen('https://links.example.com/promo');

    expect(posted()[0]).toContain('/v1/api/opens');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.url).toBe('https://links.example.com/promo');
  });

  it('says nothing about a custom scheme', async () => {
    // The hand-off page opens the app as scheme://path, and only after serving a
    // page that recorded the tap. Reporting it would count it twice.
    await analytics().trackLinkOpen('myapp://promo');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a link', async () => {
    const a = analytics();
    for (const url of ['', '   ', 'javascript:alert(1)', 'not a url']) {
      await a.trackLinkOpen(url);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the user id when one is given', async () => {
    await analytics().trackLinkOpen('https://links.example.com/x', 'user_123');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.user_id).toBe('user_123');
  });

  it('omits the user id rather than sending null', async () => {
    await analytics().trackLinkOpen('https://links.example.com/x');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('user_id' in body).toBe(false);
  });

  it('stops sending once the Appspace says it does not attribute', async () => {
    // Otherwise switching the setting off would still cost a request per link.
    fetchMock.mockResolvedValue(reply({ attribute: false }));
    const a = analytics();

    await a.trackLinkOpen('https://links.example.com/a');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await a.trackLinkOpen('https://links.example.com/b');
    await a.trackLinkOpen('https://links.example.com/c');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps reporting while the Appspace does attribute', async () => {
    const a = analytics();
    await a.trackLinkOpen('https://links.example.com/a');
    await a.trackLinkOpen('https://links.example.com/b');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws when the request fails', async () => {
    // This sits on the path that routes the user somewhere.
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(
      analytics().trackLinkOpen('https://links.example.com/a'),
    ).resolves.toBeUndefined();
  });

  it('reports one tap once, however it was delivered', async () => {
    // Cold start and the link stream can both hand over the same tap, so an app
    // instrumenting both paths would otherwise be billed twice for it.
    const a = analytics();
    await a.trackLinkOpen('https://links.example.com/promo');
    await a.trackLinkOpen('https://links.example.com/promo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still reports a different link straight after', async () => {
    const a = analytics();
    await a.trackLinkOpen('https://links.example.com/a');
    await a.trackLinkOpen('https://links.example.com/b');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
