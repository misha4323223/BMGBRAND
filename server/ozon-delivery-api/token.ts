/**
 * Ozon Delivery API — токен-сервис.
 *
 * Для частного приложения Ozon Доставки используется client_credentials:
 * POST https://xapi.ozon.ru/oauth/token
 * Никакой страницы согласия, authorization code и redirect_uri нет.
 *
 * Токен живёт около часа. Боевой Ozon возвращает expires_in абсолютным
 * Unix-временем (как exp в JWT), но документация называет его длительностью.
 * Поддерживаем оба варианта.
 *
 * Токен хранится в памяти и в bonus_settings (YDB) с привязкой к
 * SHA-256 отпечатку Client ID. После рестарта валидный токен подхватывается,
 * а токен от другого приложения игнорируется.
 */

import { logInfo, logWarn } from "../logger";
import {
  OzonHttpClient,
  ozonDeliveryHttpClient,
  type OzonHttpClientOptions,
} from "./http";
import {
  createOzonTokenStore,
  fingerprintOzonClientId,
  type OzonTokenStore,
} from "./token-store";

export const OZON_DELIVERY_TOKEN_URL = "https://xapi.ozon.ru/oauth/token";
export const OZON_DELIVERY_BASE_URL = "https://api-delivery.ozon.ru";

export const OZON_DELIVERY_MANDATORY_SCOPES = [
  "delivery-api.delivery",
  "delivery-api.delivery-point",
  "delivery-api.order",
  "delivery-api.posting",
  "delivery-api.return",
] as const;

export const OZON_DELIVERY_OPTIONAL_SCOPES = [
  "delivery-api.shipment-method",
  "delivery-api.dropoff-point",
  "delivery-api.return-point",
] as const;

export const OZON_DELIVERY_DEFAULT_SCOPES = [
  ...OZON_DELIVERY_MANDATORY_SCOPES,
  ...OZON_DELIVERY_OPTIONAL_SCOPES,
];

const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const FALLBACK_TOKEN_TTL_MS = 60 * 60 * 1000;
const ABSOLUTE_SECONDS_THRESHOLD = 1_000_000_000;
const ABSOLUTE_MS_THRESHOLD = 1_000_000_000_000;

export interface OzonTokenError {
  code: string;
  message: string;
  status?: number;
}

export interface OzonAccessToken {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  obtainedAt: number;
}

export type OzonTokenResult =
  | { ok: true; token: OzonAccessToken }
  | { ok: false; error: OzonTokenError };

export interface OzonTokenStatus {
  configured: boolean;
  authenticated: boolean;
  clientIdMasked: string | null;
  expiresAt?: string;
  expiresInSeconds?: number;
  scopes: string[];
  lastError: OzonTokenError | null;
}

export interface OzonTokenServiceOptions extends OzonHttpClientOptions {
  clientId?: string;
  clientSecret?: string;
  /** Явный список прав (для тестов). Если не задан — OZON_DELIVERY_API_SCOPES или все 8. */
  scopes?: string[];
  tokenUrl?: string;
  httpClient?: OzonHttpClient;
  now?: () => number;
  /** Хранилище токена (для тестов); по умолчанию bonus_settings в YDB. */
  store?: OzonTokenStore;
}

function uniqueScopes(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

/**
 * Разбирает OZON_DELIVERY_API_SCOPES: JSON-массив, строка через запятую/пробел или пусто.
 * По умолчанию запрашивает все 8 прав Delivery API. Чужие (seller-api.*)
 * отбрасывает, чтобы старые значения из Seller-контура не ломали запрос.
 */
export function parseOzonScopes(raw?: string): string[] {
  const defaults = [...OZON_DELIVERY_DEFAULT_SCOPES];
  const source = raw?.trim();
  if (!source) return defaults;

  let values: string[] = [];
  if (source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) values = parsed.map(String);
    } catch {
      /* ниже попробуем как строку */
    }
  }
  if (values.length === 0) {
    values = source.split(/[\s,]+/);
  }

  const deliveryScopes = values.filter((v) => v.startsWith("delivery-api."));
  if (deliveryScopes.length === 0) return defaults;

  return uniqueScopes([...defaults, ...deliveryScopes]);
}

function normalizeScopes(scopes: string[]): string[] {
  const deliveryScopes = scopes.filter((s) => s.startsWith("delivery-api."));
  return uniqueScopes([
    ...OZON_DELIVERY_MANDATORY_SCOPES,
    ...deliveryScopes,
  ]);
}

/**
 * Ozon может вернуть:
 *  - 1_780_000_000 — абсолютное Unix-время в секундах;
 *  - 1_780_000_000_000 — абсолютное время в миллисекундах;
 *  - 3600 — длительность в секундах.
 */
export function normalizeOzonExpiresAt(
  raw: unknown,
  nowMs: number = Date.now(),
): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return nowMs + FALLBACK_TOKEN_TTL_MS;
  }
  if (value > ABSOLUTE_MS_THRESHOLD) return value;
  if (value > ABSOLUTE_SECONDS_THRESHOLD) return value * 1000;
  return nowMs + value * 1000;
}

function maskClientId(clientId: string): string | null {
  const value = clientId.trim();
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

function extractTokenError(data: any, status: number): OzonTokenError {
  let code = "http_error";
  let message = `HTTP ${status}`;

  const raw = data?.error;
  if (typeof raw === "string" && raw) {
    code = raw;
    message =
      typeof data?.error_description === "string" ? data.error_description : raw;
  } else if (raw && typeof raw === "object") {
    code = String(raw.code ?? raw.error ?? "api_error");
    message = String(raw.message ?? raw.description ?? code);
  } else if (typeof data?.message === "string") {
    message = data.message;
  } else if (typeof data?.error_description === "string") {
    message = data.error_description;
  }

  return { code, message: message.slice(0, 300), status };
}

export class OzonDeliveryTokenService {
  private readonly http: OzonHttpClient;
  private readonly tokenUrl: string;
  private readonly now: () => number;
  private readonly explicitScopes: string[] | null;
  private readonly clientIdOverride: string | null;
  private readonly clientSecretOverride: string | null;
  private readonly store: OzonTokenStore;

  private cached: OzonAccessToken | null = null;
  private pending: Promise<OzonTokenResult> | null = null;
  private workingScopes: string[] | null = null;
  private lastError: OzonTokenError | null = null;
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  constructor(options: OzonTokenServiceOptions = {}) {
    this.http =
      options.httpClient ??
      (options.fetchImpl ? new OzonHttpClient(options) : ozonDeliveryHttpClient);
    this.tokenUrl = options.tokenUrl ?? OZON_DELIVERY_TOKEN_URL;
    this.now = options.now ?? Date.now;
    this.clientIdOverride = options.clientId ?? null;
    this.clientSecretOverride = options.clientSecret ?? null;
    this.store = options.store ?? createOzonTokenStore();
    this.explicitScopes = options.scopes
      ? normalizeScopes(options.scopes)
      : null;
  }

  private get clientId(): string {
    return (
      this.clientIdOverride ??
      process.env.OZON_DELIVERY_API_CLIENT_ID ??
      ""
    ).trim();
  }

  private get clientSecret(): string {
    return (
      this.clientSecretOverride ??
      process.env.OZON_DELIVERY_API_CLIENT_SECRET ??
      ""
    ).trim();
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  private scopes(): string[] {
    return (
      this.workingScopes ??
      this.explicitScopes ??
      parseOzonScopes(process.env.OZON_DELIVERY_API_SCOPES)
    );
  }

  /**
   * Подхватывает токен из YDB один раз за жизнь процесса. Ошибка хранилища
   * не блокирует получение нового токена — просто попробуем в следующий раз.
   */
  async restoreFromStorage(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) return this.hydrating;

    this.hydrating = this.hydrateFromStorage().finally(() => {
      this.hydrating = null;
    });
    return this.hydrating;
  }

  private async hydrateFromStorage(): Promise<void> {
    if (!this.isConfigured()) {
      this.hydrated = true;
      return;
    }

    try {
      const stored = await this.store.load(
        fingerprintOzonClientId(this.clientId),
      );
      if (stored && !this.cached) {
        this.cached = stored;
        this.workingScopes = stored.scopes;
        logInfo(
          `[OzonDeliveryAPI] Токен восстановлен из YDB, действует до ${new Date(stored.expiresAt).toISOString()} (${stored.scopes.length} прав)`,
        );
      }
      this.hydrated = true;
    } catch (err: any) {
      logWarn(
        "[OzonDeliveryAPI] Не удалось прочитать сохранённый токен:",
        err?.message || err,
      );
    }
  }

  /**
   * Возвращает действующий токен. При force=true игнорирует кэш
   * (используется после 401 от API).
   */
  async getAccessToken(force = false): Promise<OzonTokenResult> {
    if (!this.isConfigured()) {
      const error: OzonTokenError = {
        code: "not_configured",
        message:
          "OZON_DELIVERY_API_CLIENT_ID / OZON_DELIVERY_API_CLIENT_SECRET не заданы",
      };
      this.lastError = error;
      return { ok: false, error };
    }

    // Читаем YDB только когда в памяти ещё нет токена: после первого
    // успешного получения/восстановления лишние чтения не нужны.
    if (!this.cached) await this.restoreFromStorage();

    const now = this.now();
    if (
      !force &&
      this.cached &&
      now < this.cached.expiresAt - REFRESH_AHEAD_MS
    ) {
      return { ok: true, token: this.cached };
    }

    if (this.pending) return this.pending;

    this.pending = this.requestToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  getStatus(): OzonTokenStatus {
    const now = this.now();
    const token = this.cached;
    return {
      configured: this.isConfigured(),
      authenticated: !!token && now < token.expiresAt,
      clientIdMasked: maskClientId(this.clientId),
      expiresAt: token ? new Date(token.expiresAt).toISOString() : undefined,
      expiresInSeconds: token
        ? Math.max(0, Math.round((token.expiresAt - now) / 1000))
        : undefined,
      scopes: this.scopes(),
      lastError: this.lastError,
    };
  }

  async clearToken(): Promise<void> {
    this.cached = null;
    this.lastError = null;
    try {
      await this.store.clear();
    } catch (err: any) {
      logWarn(
        "[OzonDeliveryAPI] Не удалось удалить сохранённый токен:",
        err?.message || err,
      );
    }
  }

  private async requestToken(): Promise<OzonTokenResult> {
    const requested = this.scopes();
    let result = await this.fetchToken(requested);

    // Приложению могли выдать не все права. Тогда повторяем с обязательными.
    const scopeRejected =
      !result.ok &&
      (result.error.code === "invalid_scope" ||
        /invalid[^.]*scope|scope[^.]*invalid|некорректн\w* список разрешений/i.test(
          result.error.message,
        ));
    if (
      !result.ok &&
      scopeRejected &&
      requested.length > OZON_DELIVERY_MANDATORY_SCOPES.length
    ) {
      const fallback = [...OZON_DELIVERY_MANDATORY_SCOPES];
      logWarn(
        "[OzonDeliveryAPI] Ozon отклонил расширенный список прав, повторяем с обязательными",
      );
      const retry = await this.fetchToken(fallback);
      if (retry.ok) this.workingScopes = fallback;
      result = retry;
    }

    if (result.ok) {
      this.cached = result.token;
      this.workingScopes = result.token.scopes;
      this.lastError = null;
      await this.persistToken(result.token);
      logInfo(
        `[OzonDeliveryAPI] Токен получен, действует до ${new Date(result.token.expiresAt).toISOString()} (${result.token.scopes.length} прав)`,
      );
    } else {
      this.lastError = result.error;
      logWarn(
        `[OzonDeliveryAPI] Не удалось получить токен: ${result.error.code} — ${result.error.message}`,
      );
    }

    return result;
  }

  private async persistToken(token: OzonAccessToken): Promise<void> {
    try {
      await this.store.save(
        fingerprintOzonClientId(this.clientId),
        token,
      );
    } catch (err: any) {
      // Токен уже получен — сбой записи в YDB не должен ломать запрос.
      logWarn(
        "[OzonDeliveryAPI] Не удалось сохранить токен в YDB:",
        err?.message || err,
      );
    }
  }

  private async fetchToken(scopes: string[]): Promise<OzonTokenResult> {
    const response = await this.http.post(this.tokenUrl, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: scopes,
    });

    if (response.networkError) {
      return {
        ok: false,
        error: { code: "network_error", message: response.networkError },
      };
    }

    if (!response.ok) {
      const error = extractTokenError(response.data, response.status);
      if (response.redirectError) {
        error.code = "redirect_error";
        error.message = response.redirectError.slice(0, 300);
      }
      return { ok: false, error };
    }

    const accessToken =
      typeof response.data?.access_token === "string"
        ? response.data.access_token
        : "";
    if (!accessToken) {
      return {
        ok: false,
        error: {
          code: "invalid_response",
          message: "Ozon не вернул access_token",
          status: response.status,
        },
      };
    }

    return {
      ok: true,
      token: {
        accessToken,
        expiresAt: normalizeOzonExpiresAt(response.data?.expires_in, this.now()),
        // Для следующего обновления запрашиваем тот же набор прав.
        scopes,
        obtainedAt: this.now(),
      },
    };
  }
}

export const ozonDeliveryTokenService = new OzonDeliveryTokenService();
