/**
 * Клиент api-delivery.ozon.ru.
 *
 * Все методы — POST с JSON и Bearer-токеном. При 401 токен получается
 * заново и запрос повторяется один раз.
 */

import { logWarn } from "../logger";
import {
  OzonHttpClient,
  type OzonHttpClientOptions,
} from "./http";
import {
  OZON_DELIVERY_BASE_URL,
  ozonDeliveryTokenService,
  type OzonTokenResult,
  type OzonTokenStatus,
} from "./token";

export interface OzonTokenProvider {
  getAccessToken(force?: boolean): Promise<OzonTokenResult>;
  getStatus(): OzonTokenStatus;
}

export interface OzonDeliveryApiError {
  code: string;
  message: string;
  status?: number;
}

export interface OzonDeliveryApiResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: OzonDeliveryApiError;
  traceId?: string;
}

export interface OzonDeliveryApiClientOptions extends OzonHttpClientOptions {
  tokenService?: OzonTokenProvider;
  baseUrl?: string;
}

function extractApiError(data: any, status: number): OzonDeliveryApiError {
  const raw = data?.error;
  let code = "http_error";
  let message = `HTTP ${status}`;

  if (typeof raw === "string" && raw) {
    code = raw;
    message = raw;
  } else if (raw && typeof raw === "object") {
    code = String(raw.code ?? raw.error ?? "api_error");
    message = String(raw.message ?? raw.description ?? code);
  } else if (typeof data?.message === "string") {
    message = data.message;
  }

  return { code, message: message.slice(0, 300), status };
}

export class OzonDeliveryApiClient {
  private readonly http: OzonHttpClient;
  private readonly token: OzonTokenProvider;
  private readonly baseUrl: string;

  constructor(options: OzonDeliveryApiClientOptions = {}) {
    this.http = new OzonHttpClient(options);
    this.token = options.tokenService ?? ozonDeliveryTokenService;
    this.baseUrl = (options.baseUrl ?? OZON_DELIVERY_BASE_URL).replace(/\/+$/, "");
  }

  async request<T = any>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<OzonDeliveryApiResult<T>> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseUrl}${normalizedPath}`;

    const initial = await this.token.getAccessToken();
    if (!initial.ok) {
      return {
        ok: false,
        status: 0,
        error: {
          code: "token_error",
          message: initial.error.message,
        },
      };
    }

    // Дополнительные заголовки (например, Idempotency-Key) должны пережить
    // refresh токена. Authorization ставим последним, чтобы его нельзя было
    // случайно переопределить через headers.
    let response = await this.http.post(url, body, {
      ...headers,
      Authorization: `Bearer ${initial.token.accessToken}`,
    });

    if (response.status === 401) {
      logWarn(`[OzonDeliveryAPI] ${normalizedPath} → 401, обновляем токен`);
      const refreshed = await this.token.getAccessToken(true);
      if (!refreshed.ok) {
        return {
          ok: false,
          status: 401,
          error: {
            code: "unauthorized",
            message: refreshed.error.message,
          },
          traceId: response.traceId,
        };
      }
      response = await this.http.post(url, body, {
        ...headers,
        Authorization: `Bearer ${refreshed.token.accessToken}`,
      });
    }

    if (response.networkError) {
      return {
        ok: false,
        status: 0,
        error: { code: "network_error", message: response.networkError },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: extractApiError(response.data, response.status),
        traceId: response.traceId,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: response.data as T,
      traceId: response.traceId,
    };
  }
}
