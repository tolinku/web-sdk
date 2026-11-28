import type { TolinkuConfig } from './types.js';
import { SDK_VERSION } from './types.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_JITTER_MS = 250;

export class HttpClient {
  private _baseUrl: string;
  private apiKey: string;
  private abortController: AbortController | null = null;

  constructor(config: Required<TolinkuConfig>) {
    this._baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  /** Abort all in-flight requests (called by Tolinku.destroy()) */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /** Get a signal for the current request batch, creating a controller if needed */
  private get signal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }

  /** Public accessor for the base URL */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /** Public accessor for the API key (used by sendBeacon which cannot set custom headers) */
  get key(): string {
    return this.apiKey;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = this._baseUrl + path;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    }

    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.headers(),
      signal: this.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new TolinkuError(body.error || res.statusText, res.status, body.code);
    }

    return this.parseJson<T>(res);
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchWithRetry(this._baseUrl + path, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: this.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TolinkuError(data.error || res.statusText, res.status, data.code);
    }

    return this.parseJson<T>(res);
  }

  /**
   * One POST, no retries, with a time limit, reporting what came back instead
   * of throwing.
   *
   * For questions where asking twice is worse than not getting an answer:
   * resolving an email link makes the server request the email platform's
   * tracked link once, which is how that platform counts the click (Tolinku
   * records no click of its own), so a retry could count it again. The caller decides what a reply means, so
   * this hands back the status, the parsed JSON body and whether Tolinku
   * marked the reply as its own (X-Tolinku: 1). It resolves to null
   * when there was no readable reply: a network error, a CORS refusal (which a browser reports
   * as a network error), the time limit, or a body that is not JSON.
   *
   * `url` is absolute. With `authenticated` the SDK's normal headers go along
   * (the API key); without it only Content-Type does, for a request to a host
   * taken from a URL the caller was handed, which is not necessarily ours.
   */
  async postOnce(
    url: string,
    body: Record<string, unknown>,
    options: { authenticated: boolean; timeoutMs: number },
  ): Promise<{ status: number; data: unknown; tolinku: boolean } | null> {
    const controller = new AbortController();
    const outer = this.signal;
    const onAbort = () => controller.abort();
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: options.authenticated
          ? { ...this.headers(), 'Content-Type': 'application/json' }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return null;
      }
      // X-Tolinku: 1 is on every answer Tolinku's own API gives (a host that is not ours won't send it).
      return { status: res.status, data, tolinku: res.headers?.get?.('X-Tolinku') === '1' };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', onAbort);
    }
  }

  /** GET without API key auth (for public endpoints like banner config) */
  async getPublic<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = this._baseUrl + path;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    }

    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      signal: this.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new TolinkuError(body.error || res.statusText, res.status, body.code);
    }

    return this.parseJson<T>(res);
  }

  /** POST without API key auth (for public endpoints like deferred claim) */
  async postPublic<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchWithRetry(this._baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: this.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new TolinkuError(data.error || res.statusText, res.status, data.code);
    }

    return this.parseJson<T>(res);
  }

  /**
   * Fetch with retry logic. Retries on network errors, HTTP 429, and 5xx responses.
   * Uses exponential backoff: BASE_DELAY_MS * 2^attempt + random jitter.
   * Respects Retry-After header on 429 responses.
   * Does NOT retry on 4xx errors (except 429) or successful responses.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, init);

        // Successful or non-retryable 4xx: return immediately
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          return res;
        }

        // Retryable status (429 or 5xx): retry if attempts remain
        if (attempt < MAX_RETRIES) {
          const delay = this.computeDelay(attempt, res);
          await this.sleep(delay, init.signal as AbortSignal | undefined);
          continue;
        }

        // Out of retries: return the last response so the caller can handle the error
        return res;
      } catch (err) {
        // If the request was aborted, do not retry
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }

        lastError = err;

        // Network error: retry if attempts remain
        if (attempt < MAX_RETRIES) {
          const delay = this.computeDelay(attempt);
          await this.sleep(delay, init.signal as AbortSignal | undefined);
          continue;
        }
      }
    }

    // All retries exhausted due to network errors
    throw lastError;
  }

  /** Compute backoff delay: BASE_DELAY_MS * 2^attempt + random jitter (0 to MAX_JITTER_MS) */
  private computeDelay(attempt: number, res?: Response): number {
    // Respect Retry-After header on 429 responses
    if (res && res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
      }
    }

    const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * MAX_JITTER_MS;
    return exponential + jitter;
  }

  /** Sleep for a given duration, but throw if the signal is aborted */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }

      const timer = setTimeout(resolve, ms);

      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    });
  }

  /** Safely parse JSON from a response, handling non-JSON 200s */
  private async parseJson<T>(res: Response): Promise<T> {
    try {
      return await res.json() as T;
    } catch {
      throw new TolinkuError('Invalid JSON in response body', res.status);
    }
  }

  private headers(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      // Which SDK and version made the call. The other Tolinku SDKs say this in
      // User-Agent, which a browser will not let a script set, so it goes in a
      // header of our own. Without it a web integration is unidentifiable in the
      // field and a version-specific bug cannot be traced to a version.
      'X-Tolinku-SDK': `web/${SDK_VERSION}`,
      // Browsers default to "Accept: */*", which a server content-negotiating an
      // error page reads as "HTML is fine". Saying so explicitly keeps an error
      // parseable instead of arriving as a rendered page.
      'Accept': 'application/json',
    };
  }
}

export class TolinkuError extends Error {
  status: number;
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'TolinkuError';
    this.status = status;
    this.code = code;
  }
}
