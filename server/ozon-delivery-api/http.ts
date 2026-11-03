/**
 * HTTP-клиент Ozon Delivery API.
 *
 * Особенности, из-за которых нельзя использовать «голый» fetch:
 *  - Ozon отвечает 302/307 с Location и Set-Cookie; POST нужно повторить
 *    с тем же телом, сохранив cookie (защита от DDoS);
 *  - часть запросов «зависает» — нужен короткий таймаут и повтор;
 *  - 429/5xx нужно повторять с паузой;
 *  - Authorization нельзя передавать на сторонний хост при редиректе.
 */

import { logWarn } from "../logger";
import { parseOzonJson } from "./json";

export type OzonFetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OzonHttpClientOptions {
  fetchImpl?: OzonFetchLike;
  timeoutMs?: number;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRedirects?: number;
}

export interface OzonHttpResult {
  status: number;
  ok: boolean;
  headers: Headers;
  data: any;
  text: string;
  finalUrl: string;
  traceId?: string;
  networkError?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOzonHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "ozon.ru" || host.endsWith(".ozon.ru");
  } catch {
    return false;
  }
}

function readSetCookies(headers: Headers): string[] {
  // Node 20+ (undici) отдаёт несколько Set-Cookie отдельным методом.
  // В типах DOM его может не быть, поэтому обращаемся через any.
  const anyHeaders = headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie() as string[];
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function emptyResult(url: string, networkError: string): OzonHttpResult {
  return {
    status: 0,
    ok: false,
    headers: new Headers(),
    data: null,
    text: "",
    finalUrl: url,
    networkError,
  };
}

export class OzonHttpClient {
  private readonly fetchImpl: OzonFetchLike;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRedirects: number;
  private readonly cookies = new Map<string, Map<string, string>>();

  constructor(options: OzonHttpClientOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) => fetch(input as any, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  async post(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<OzonHttpResult> {
    const payload = JSON.stringify(body);
    let last: OzonHttpResult | null = null;

    for (let attempt = 0; attempt < this.attempts; attempt++) {
      const result = await this.postWithRedirects(url, payload, headers);
      last = result;

      const retryable =
        !!result.networkError || result.status === 429 || result.status >= 500;
      if (!retryable) return result;

      if (attempt + 1 < this.attempts) {
        let path = url;
        try {
          path = new URL(url).pathname;
        } catch {
          /* оставляем url как есть */
        }
        logWarn(
          `[OzonDeliveryAPI] ${path} → ${result.networkError || `HTTP ${result.status}`}, повтор ${attempt + 1}/${this.attempts - 1}`,
        );
        await this.sleep(this.baseDelayMs * (attempt + 1));
      }
    }

    return last ?? emptyResult(url, "request failed");
  }

  private cookieHeader(url: string): string | null {
    try {
      const host = new URL(url).hostname;
      const jar = this.cookies.get(host);
      if (!jar || jar.size === 0) return null;
      return Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    } catch {
      return null;
    }
  }

  private storeCookies(url: string, headers: Headers): void {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }

    const setCookies = readSetCookies(headers);
    if (setCookies.length === 0) return;

    const jar = this.cookies.get(host) ?? new Map<string, string>();
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && value) jar.set(name, value);
    }
    if (jar.size > 0) this.cookies.set(host, jar);
  }

  private async postWithRedirects(
    startUrl: string,
    payload: string,
    baseHeaders: Record<string, string>,
  ): Promise<OzonHttpResult> {
    let url = startUrl;
    let headers = { ...baseHeaders };

    for (let redirect = 0; redirect <= this.maxRedirects; redirect++) {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      };
      const cookie = this.cookieHeader(url);
      if (cookie) requestHeaders.Cookie = cookie;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: requestHeaders,
          body: payload,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err: any) {
        const message =
          err?.name === "AbortError"
            ? `timeout ${this.timeoutMs}ms`
            : err?.message || String(err);
        return emptyResult(url, message);
      } finally {
        clearTimeout(timer);
      }

      this.storeCookies(url, response.headers);

      const location = response.headers.get("location");
      if (
        REDIRECT_STATUSES.has(response.status) &&
        location &&
        redirect < this.maxRedirects
      ) {
        // Тело промежуточного ответа нужно прочитать, иначе соединение
        // остаётся занятым до сборки мусора.
        await response.text().catch(() => "");
        const nextUrl = new URL(location, url).toString();

        // Токен и служебные заголовки не должны уйти на чужой хост
        // даже при редиректе.
        if (!isOzonHost(nextUrl)) {
          delete headers.Authorization;
          delete headers["Idempotency-Key"];
        }

        url = nextUrl;
        continue;
      }

      const text = await response.text().catch(() => "");
      let data: any = null;
      if (text) {
        try {
          data = parseOzonJson(text);
        } catch {
          data = null;
        }
      }

      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        data,
        text,
        finalUrl: url,
        traceId: response.headers.get("x-o3-trace-id") || undefined,
      };
    }

    return emptyResult(url, "too many redirects");
  }
}
