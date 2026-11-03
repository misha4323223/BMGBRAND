/**
 * HTTP-клиент Ozon Delivery API.
 *
 * Особенности, из-за которых нельзя использовать «голый» fetch:
 *  - Ozon отвечает 302/307 с Location и Set-Cookie (testcookie); POST нужно
 *    повторить с тем же телом, сохранив cookie;
 *  - cookie приходят с Domain=.ozon.ru и должны переживать переходы между
 *    поддоменами Ozon;
 *  - часть запросов «зависает» — нужен короткий таймаут и повтор;
 *  - 429/5xx нужно повторять с паузой;
 *  - Authorization и тело с client_secret нельзя передавать на сторонний хост.
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

export interface OzonHttpRedirect {
  status: number;
  from: string;
  to?: string;
  hadLocation: boolean;
  cookieNames: string[];
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
  redirectCount: number;
  redirects: OzonHttpRedirect[];
  /** Заполняется, если Ozon не отпустил запрос после цепочки редиректов. */
  redirectError?: string;
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  expiresAt: number | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT =
  "Boomerangs-OzonDelivery/1.0 (+https://boomerangs.ru)";

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

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
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

function defaultCookiePath(pathname: string): string {
  if (!pathname || pathname[0] !== "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function domainMatches(host: string, cookie: StoredCookie): boolean {
  if (cookie.hostOnly) return host === cookie.domain;
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname: string, cookiePath: string): boolean {
  if (cookiePath === pathname) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return pathname[cookiePath.length] === "/";
}

/**
 * Разбирает Set-Cookie с учётом Domain/Path/Secure/Max-Age/Expires.
 * Некорректную cookie не сохраняем: лучше новый запрос, чем чужой домен.
 */
function parseSetCookie(
  raw: string,
  requestUrl: string,
  now: number,
): StoredCookie | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return null;
  }

  const parts = raw.split(";");
  const pair = parts.shift() ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;

  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  const host = parsedUrl.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  let path = defaultCookiePath(parsedUrl.pathname || "/");
  let secure = false;
  let expiresAt: number | null = null;

  for (const rawAttribute of parts) {
    const attribute = rawAttribute.trim();
    if (!attribute) continue;
    const separator = attribute.indexOf("=");
    const key = (separator >= 0 ? attribute.slice(0, separator) : attribute)
      .trim()
      .toLowerCase();
    const attrValue =
      separator >= 0 ? attribute.slice(separator + 1).trim() : "";

    if (key === "domain" && attrValue) {
      const candidate = attrValue.replace(/^\./, "").toLowerCase();
      if (!candidate) return null;
      if (host !== candidate && !host.endsWith(`.${candidate}`)) return null;
      domain = candidate;
      hostOnly = false;
    } else if (key === "path" && attrValue.startsWith("/")) {
      path = attrValue;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "max-age") {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        expiresAt = seconds <= 0 ? now - 1 : now + seconds * 1000;
      }
    } else if (key === "expires") {
      const expires = Date.parse(attrValue);
      if (Number.isFinite(expires)) expiresAt = expires;
    }
  }

  return { name, value, domain, path, hostOnly, secure, expiresAt };
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
    redirectCount: 0,
    redirects: [],
  };
}

function parseResponseBody(text: string): any {
  if (!text) return null;
  try {
    return parseOzonJson(text);
  } catch {
    return null;
  }
}

export class OzonHttpClient {
  private readonly fetchImpl: OzonFetchLike;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRedirects: number;
  private readonly cookies = new Map<string, StoredCookie>();

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

  /** Имена cookie без значений — для безопасной диагностики. */
  cookieNamesFor(url: string): string[] {
    return this.matchingCookies(url).map((cookie) => cookie.name);
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

      const outsideOzon = !!result.redirectError?.includes("не-Ozon");
      const retryable =
        !outsideOzon &&
        (!!result.networkError ||
          result.status === 429 ||
          result.status >= 500 ||
          !!result.redirectError);
      if (!retryable) return result;

      if (attempt + 1 < this.attempts) {
        let path = url;
        try {
          path = new URL(url).pathname;
        } catch {
          /* оставляем url как есть */
        }
        logWarn(
          `[OzonDeliveryAPI] ${path} → ${
            result.redirectError ||
            result.networkError ||
            `HTTP ${result.status}`
          }, повтор ${attempt + 1}/${this.attempts - 1}`,
        );
        await this.sleep(this.baseDelayMs * (attempt + 1));
      }
    }

    return last ?? emptyResult(url, "request failed");
  }

  private matchingCookies(url: string): StoredCookie[] {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return [];
    }

    const host = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname || "/";
    const now = Date.now();
    const matches: StoredCookie[] = [];

    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt != null && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (!domainMatches(host, cookie)) continue;
      if (!pathMatches(pathname, cookie.path)) continue;
      if (cookie.secure && parsedUrl.protocol !== "https:") continue;
      matches.push(cookie);
    }

    // Более конкретный путь имеет приоритет, как в RFC 6265.
    return matches.sort((a, b) => b.path.length - a.path.length);
  }

  private cookieHeader(url: string): string | null {
    const cookies = this.matchingCookies(url);
    if (cookies.length === 0) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  private storeCookies(url: string, headers: Headers): string[] {
    const setCookies = readSetCookies(headers);
    const names: string[] = [];
    for (const raw of setCookies) {
      const cookie = parseSetCookie(raw, url, Date.now());
      if (!cookie) continue;
      names.push(cookie.name);
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (cookie.expiresAt != null && cookie.expiresAt <= Date.now()) {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, cookie);
      }
    }
    return names;
  }

  private async postWithRedirects(
    startUrl: string,
    payload: string,
    baseHeaders: Record<string, string>,
  ): Promise<OzonHttpResult> {
    let url = startUrl;
    const headers = { ...baseHeaders };
    const redirects: OzonHttpRedirect[] = [];

    for (let redirect = 0; redirect <= this.maxRedirects; redirect++) {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
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

      const cookieNames = this.storeCookies(url, response.headers);
      const location = response.headers.get("location");
      let nextUrl: string | null = null;
      if (location) {
        try {
          nextUrl = new URL(location, url).toString();
        } catch {
          nextUrl = null;
        }
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        redirects.push({
          status: response.status,
          from: safeUrl(url),
          to: nextUrl ? safeUrl(nextUrl) : undefined,
          hadLocation: !!nextUrl,
          cookieNames,
        });
      }

      if (
        REDIRECT_STATUSES.has(response.status) &&
        nextUrl &&
        redirect < this.maxRedirects
      ) {
        // Тело промежуточного ответа нужно прочитать, иначе соединение
        // остаётся занятым до сборки мусора.
        await response.text().catch(() => "");

        // Тело запроса к токену содержит client_secret. Не отправляем его
        // на сторонний хост ни при каких обстоятельствах.
        if (!isOzonHost(nextUrl)) {
          const redirectError = `Ozon перенаправил на не-Ozon хост ${safeUrl(nextUrl)}`;
          logWarn(`[OzonDeliveryAPI] ${safeUrl(url)} → ${redirectError}`);
          return {
            status: response.status,
            ok: false,
            headers: response.headers,
            data: null,
            text: "",
            finalUrl: url,
            redirectCount: redirects.length,
            redirects,
            redirectError,
          };
        }

        url = nextUrl;
        continue;
      }

      const text = await response.text().catch(() => "");
      const result: OzonHttpResult = {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        data: parseResponseBody(text),
        text,
        finalUrl: url,
        traceId: response.headers.get("x-o3-trace-id") || undefined,
        redirectCount: redirects.length,
        redirects,
      };

      if (REDIRECT_STATUSES.has(response.status)) {
        result.redirectError = nextUrl
          ? `Ozon вернул ${response.status} после ${redirects.length} редиректов (${safeUrl(url)})`
          : `Ozon вернул ${response.status} без Location`;
        logWarn(
          `[OzonDeliveryAPI] ${safeUrl(url)} → ${result.redirectError}`,
        );
      }

      return result;
    }

    return emptyResult(url, "too many redirects");
  }
}

/**
 * Общий cookie-jar для токена и API. Ozon testcookie может выставить cookie
 * на xapi.ozon.ru с Domain=.ozon.ru и ожидать её в запросах к api-delivery.
 */
export const ozonDeliveryHttpClient = new OzonHttpClient();
