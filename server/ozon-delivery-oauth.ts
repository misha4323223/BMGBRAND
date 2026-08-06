/**
 * Ozon Delivery OAuth 2.0 Service
 *
 * Реализует OAuth 2.0 Authorization Code flow для подключения
 * Ozon Seller API (Ozon Доставка) через частное приложение dev.ozon.ru.
 *
 * Docs: https://xapi.ozon.ru/oauth
 * Auth URL: https://seller.ozon.ru/app/appstore/oauth/authorize
 *
 * Токены хранятся:
 *  - in-memory: для быстрого доступа без обращения к БД
 *  - bonus_settings (YDB): для персистентности между перезапусками
 *
 * Ключи в bonus_settings:
 *   ozon_oauth_access_token  — Bearer-токен для api-seller.ozon.ru
 *   ozon_oauth_refresh_token — токен обновления (offline access)
 *   ozon_oauth_expires_at    — Unix timestamp истечения (ms)
 */

import crypto from "crypto";
import { config } from "./config";

const OZON_TOKEN_URL = "https://xapi.ozon.ru/oauth/token";
const OZON_AUTH_BASE = "https://seller.ozon.ru/app/appstore/oauth/authorize";
export const OZON_OAUTH_REDIRECT_URI = "https://booomerangs.ru/api/ozon/oauth/callback";

// Ключи для хранения в bonus_settings
export const OZON_OAUTH_KEYS = {
  accessToken: "ozon_oauth_access_token",
  refreshToken: "ozon_oauth_refresh_token",
  expiresAt: "ozon_oauth_expires_at",
} as const;

// CSRF-защита через HMAC (не in-memory, работает на любом инстансе сервера)
function makeState(): string {
  const ts = Date.now().toString(36);
  const nonce = crypto.randomBytes(8).toString("hex");
  const sig = crypto.createHmac("sha256", config.jwt.secret).update(`${ts}.${nonce}`).digest("hex").slice(0, 16);
  return `${ts}.${nonce}.${sig}`;
}

function verifyState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = crypto.createHmac("sha256", config.jwt.secret).update(`${ts}.${nonce}`).digest("hex").slice(0, 16);
  if (sig !== expected) return false;
  const created = parseInt(ts, 36);
  return Date.now() - created < 15 * 60 * 1000; // 15 минут
}

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

let cachedToken: TokenData | null = null;

class OzonDeliveryOAuthService {
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Callback для сохранения токенов в БД после авто-рефреша */
  private persistCallback: ((accessToken: string, refreshToken: string, expiresAt: number) => Promise<void>) | null = null;

  initialize(clientId: string, clientSecret: string): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    console.log("[OzonDelivery OAuth] Сервис инициализирован, client_id:", clientId.slice(0, 8) + "...");
  }

  /**
   * Регистрирует callback для сохранения токенов после авто-рефреша.
   * Вызывается в routes.ts при инициализации.
   */
  setPersistCallback(fn: (accessToken: string, refreshToken: string, expiresAt: number) => Promise<void>): void {
    this.persistCallback = fn;
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Загружает ранее сохранённые токены (вызывается при старте сервера).
   * Если токен истёк — автоматически запускает refresh.
   */
  loadTokensFromStorage(accessToken: string, refreshToken: string, expiresAt: number): void {
    cachedToken = { accessToken, refreshToken, expiresAt };
    console.log("[OzonDelivery OAuth] Токены загружены из хранилища, истекают:", new Date(expiresAt).toISOString());
    this.scheduleRefresh();
  }

  /**
   * Генерирует URL для авторизации. Администратор переходит по нему,
   * авторизуется в Ozon и разрешает доступ. Ozon перенаправляет
   * на callback с кодом.
   */
  generateAuthUrl(): string {
    if (!this.clientId) throw new Error("OAuth не настроен: отсутствует OZON_CLIENT_ID");

    const state = makeState();

    const params = new URLSearchParams({
      response_type: "code",
      access_type: "offline",
      client_id: this.clientId,
      redirect_uri: OZON_OAUTH_REDIRECT_URI,
      state,
    });

    // scope обязателен по документации Ozon.
    // Значения берём из OZON_SCOPES (через пробел), либо используем разумный дефолт
    // для доставки. Формат: "seller-api.fbs seller-api.analytics" и т.д.
    const scopes = process.env.OZON_SCOPES?.trim();
    if (scopes) {
      params.set("scope", scopes);
    }

    return `${OZON_AUTH_BASE}?${params.toString()}`;
  }

  /**
   * Проверяет CSRF state и удаляет его из списка ожидающих.
   */
  validateState(state: string): boolean {
    return verifyState(state);
  }

  /**
   * Обменивает authorization code на access_token + refresh_token.
   * Возвращает данные токена для сохранения в БД.
   */
  async exchangeCode(code: string): Promise<{ success: boolean; tokenData?: TokenData; error?: string }> {
    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: "OAuth не настроен: отсутствуют OZON_CLIENT_ID / OZON_CLIENT_SECRET" };
    }

    try {
      const resp = await fetch(OZON_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: OZON_OAUTH_REDIRECT_URI,
          code,
        }),
      });

      const data = await resp.json() as any;

      if (!resp.ok) {
        console.error("[OzonDelivery OAuth] Ошибка обмена кода:", data);
        return { success: false, error: data?.message || `HTTP ${resp.status}` };
      }

      const expiresIn = Number(data.expires_in) || 3600;
      const tokenData: TokenData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (expiresIn - 120) * 1000, // -2 минуты запаса
      };

      cachedToken = tokenData;
      this.scheduleRefresh();

      console.log(`[OzonDelivery OAuth] Токены получены, expires_in=${expiresIn}s`);
      return { success: true, tokenData };
    } catch (err: any) {
      console.error("[OzonDelivery OAuth] Сетевая ошибка при обмене кода:", err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Обновляет access_token через refresh_token.
   * Возвращает новые данные токена для сохранения в БД.
   */
  async refreshAccessToken(): Promise<{ success: boolean; tokenData?: TokenData; error?: string }> {
    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: "OAuth не настроен" };
    }
    if (!cachedToken?.refreshToken) {
      return { success: false, error: "Нет refresh_token" };
    }

    try {
      const resp = await fetch(OZON_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: cachedToken.refreshToken,
        }),
      });

      const data = await resp.json() as any;

      if (!resp.ok) {
        console.error("[OzonDelivery OAuth] Ошибка refresh:", data);
        cachedToken = null;
        // Очищаем протухшие токены из YDB, чтобы после рестарта они не подгрузились
        if (this.persistCallback) {
          this.persistCallback("", "", 0).catch(() => {});
        }
        return { success: false, error: data?.error || data?.message || `HTTP ${resp.status}` };
      }

      const expiresIn = Number(data.expires_in) || 3600;
      const tokenData: TokenData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || cachedToken.refreshToken,
        expiresAt: Date.now() + (expiresIn - 120) * 1000,
      };

      cachedToken = tokenData;
      this.scheduleRefresh();

      console.log("[OzonDelivery OAuth] Токен обновлён успешно");

      // Персистим новые токены в БД (если callback зарегистрирован)
      if (this.persistCallback) {
        this.persistCallback(tokenData.accessToken, tokenData.refreshToken, tokenData.expiresAt)
          .catch(e => console.error("[OzonDelivery OAuth] Ошибка сохранения токенов:", e.message));
      }

      return { success: true, tokenData };
    } catch (err: any) {
      console.error("[OzonDelivery OAuth] Сетевая ошибка при refresh:", err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Возвращает текущий access_token. Если истёк — автоматически обновляет.
   * Используется другими сервисами для запросов к api-seller.ozon.ru.
   */
  async getAccessToken(): Promise<string | null> {
    if (!cachedToken) return null;

    if (Date.now() >= cachedToken.expiresAt) {
      console.log("[OzonDelivery OAuth] Токен истёк, обновляем...");
      const result = await this.refreshAccessToken();
      if (!result.success) return null;
    }

    return cachedToken?.accessToken || null;
  }

  /**
   * Планирует автоматическое обновление токена за 5 минут до истечения.
   *
   * Ограничение: setTimeout в Node.js не работает с задержками > 2^31-1 мс (~24.8 дней).
   * Если токен живёт дольше (Ozon даёт токены сроком ~1 год), планируем проверку
   * каждые 23 часа — при каждом срабатывании просто перепланируем снова,
   * пока до истечения не останется < 10 минут.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (!cachedToken) return;

    const msUntilExpiry = cachedToken.expiresAt - Date.now();

    if (msUntilExpiry <= 0) {
      // Уже истёк — обновляем немедленно в фоне
      this.refreshAccessToken().catch(e =>
        console.error("[OzonDelivery OAuth] Фоновый refresh провалился:", e.message)
      );
      return;
    }

    // Хотим обновить за 5 минут до истечения, но setTimeout не может
    // принять значение > 2^31-1 мс (~24.8 дней). Ограничиваем 23 часами.
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const MAX_DELAY_MS = 23 * 60 * 60 * 1000; // 23 часа — безопасный лимит
    const idealDelay = Math.max(0, msUntilExpiry - FIVE_MIN_MS);
    const delayMs = Math.min(idealDelay, MAX_DELAY_MS);

    console.log(`[OzonDelivery OAuth] Следующая проверка токена через ${Math.round(delayMs / 60000)} мин (истекает через ${Math.round(msUntilExpiry / 60000)} мин)`);

    this.refreshTimer = setTimeout(async () => {
      if (!cachedToken) return;
      const remaining = cachedToken.expiresAt - Date.now();

      if (remaining > FIVE_MIN_MS) {
        // До истечения ещё далеко (мы достигли предела 23ч) — просто перепланируем
        this.scheduleRefresh();
        return;
      }

      // Осталось < 5 минут — обновляем
      console.log("[OzonDelivery OAuth] Плановое обновление токена...");
      await this.refreshAccessToken().catch(e =>
        console.error("[OzonDelivery OAuth] Плановый refresh провалился:", e.message)
      );
    }, delayMs);
  }

  /**
   * Текущие данные токена (для сохранения в БД после обмена/refresh).
   */
  getTokenData(): TokenData | null {
    return cachedToken;
  }

  /**
   * Сбрасывает токены (деавторизация).
   */
  clearTokens(): void {
    cachedToken = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    console.log("[OzonDelivery OAuth] Токены сброшены");
  }

  /**
   * Статус для отображения в админке.
   */
  getStatus(): {
    configured: boolean;
    authenticated: boolean;
    expiresAt?: string;
    isExpired?: boolean;
  } {
    if (!this.isConfigured()) {
      return { configured: false, authenticated: false };
    }
    if (!cachedToken?.accessToken) {
      return { configured: true, authenticated: false };
    }
    const isExpired = Date.now() >= cachedToken.expiresAt;
    return {
      configured: true,
      authenticated: true,
      expiresAt: new Date(cachedToken.expiresAt).toISOString(),
      isExpired,
    };
  }
}

export const ozonDeliveryOAuth = new OzonDeliveryOAuthService();
