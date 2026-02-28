import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, TolinkuError } from '../src/client.js';

function createClient() {
  return new HttpClient({ apiKey: 'tolk_pub_test_123', baseUrl: 'https://api.example.com' });
}

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('HttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0); // Remove jitter for deterministic tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- Successful requests --

  it('should make a successful GET request with API key header', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { data: 'ok' }));
    const client = createClient();
    const result = await client.get<{ data: string }>('/v1/test');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/test');
    expect(init.method).toBe('GET');
    expect(init.headers['X-API-Key']).toBe('tolk_pub_test_123');
    expect(result).toEqual({ data: 'ok' });
  });

  it('should make a successful GET request with query params', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { data: 'ok' }));
    const client = createClient();
    await client.get('/v1/test', { foo: 'bar', baz: '123' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/test?foo=bar&baz=123');
  });

  it('should make a successful POST request with JSON body', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { id: 'abc' }));
    const client = createClient();
    const result = await client.post<{ id: string }>('/v1/create', { name: 'test' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/create');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'test' }));
    expect(result).toEqual({ id: 'abc' });
  });

  it('should make a getPublic request without API key', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { config: true }));
    const client = createClient();
    await client.getPublic('/v1/public');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toBeUndefined();
  });

  it('should make a postPublic request without API key', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));
    const client = createClient();
    await client.postPublic('/v1/public', { data: 1 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  // -- Error handling --

  it('should throw TolinkuError on non-OK responses (4xx)', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, { error: 'Forbidden' }));
    const client = createClient();

    await expect(client.get('/v1/test')).rejects.toThrow(TolinkuError);
    await expect(client.get('/v1/test')).rejects.toMatchObject({
      message: 'Forbidden',
      status: 403,
    });
  });

  it('should handle JSON parse errors in response body', async () => {
    const res = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as Response;
    fetchMock.mockResolvedValue(res);

    const client = createClient();
    await expect(client.get('/v1/test')).rejects.toThrow('Invalid JSON in response body');
  });

  it('should handle JSON parse error in error response gracefully', async () => {
    const res = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('bad')),
    } as unknown as Response;
    fetchMock.mockResolvedValue(res);

    const client = createClient();
    await expect(client.get('/v1/test')).rejects.toMatchObject({
      message: 'Bad Request',
      status: 400,
    });
  });

  // -- Retry on 5xx --

  it('should retry on 5xx errors up to 3 times', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // eliminate jitter
    const client = createClient();

    fetchMock
      .mockResolvedValueOnce(mockResponse(500, { error: 'Internal Server Error' }))
      .mockResolvedValueOnce(mockResponse(502, { error: 'Bad Gateway' }))
      .mockResolvedValueOnce(mockResponse(503, { error: 'Service Unavailable' }))
      .mockResolvedValueOnce(mockResponse(200, { data: 'success' }));

    const promise = client.get<{ data: string }>('/v1/test');

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toEqual({ data: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('should return error response after all retries exhausted on 5xx', async () => {
    const client = createClient();

    fetchMock.mockImplementation(() =>
      Promise.resolve(mockResponse(500, { error: 'Server Error' }))
    );

    try {
      await client.get('/v1/test');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TolinkuError);
      expect((err as TolinkuError).status).toBe(500);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  // -- Retry on 429 with Retry-After --

  it('should retry on 429 and respect Retry-After header', async () => {
    vi.useFakeTimers();
    const client = createClient();

    fetchMock
      .mockResolvedValueOnce(mockResponse(429, { error: 'Rate limited' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

    const promise = client.get<{ data: string }>('/v1/test');

    // Retry-After: 2 means wait 2000ms
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -- No retry on 4xx --

  it('should NOT retry on 4xx errors (except 429)', async () => {
    const client = createClient();
    fetchMock.mockResolvedValue(mockResponse(404, { error: 'Not Found' }));

    await expect(client.get('/v1/test')).rejects.toThrow(TolinkuError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No retries
  });

  it('should NOT retry on 401', async () => {
    const client = createClient();
    fetchMock.mockResolvedValue(mockResponse(401, { error: 'Unauthorized' }));

    await expect(client.get('/v1/test')).rejects.toThrow(TolinkuError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -- Retry on network errors --

  it('should retry on network errors (fetch throws)', async () => {
    vi.useFakeTimers();
    const client = createClient();

    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResponse(200, { data: 'recovered' }));

    const promise = client.get<{ data: string }>('/v1/test');
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toEqual({ data: 'recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -- Abort cancels requests --

  it('should throw AbortError when abort() is called', async () => {
    const client = createClient();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      });
    });

    const promise = client.get('/v1/test');
    // Allow the fetch call to be initiated before aborting
    await new Promise((r) => setTimeout(r, 10));
    client.abort();

    await expect(promise).rejects.toThrow();
  });

  // -- Input validation --

  it('should strip trailing slashes from baseUrl', () => {
    const client = new HttpClient({ apiKey: 'tolk_pub_test', baseUrl: 'https://api.example.com///' });
    expect(client.baseUrl).toBe('https://api.example.com');
  });
});
