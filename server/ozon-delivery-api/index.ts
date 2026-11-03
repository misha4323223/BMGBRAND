/**
 * Ozon Delivery API — сервисный фасад.
 *
 * Токен client_credentials переживает перезапуск, справочник ПВЗ
 * синхронизируется в YDB, /v1/order/checkout считает предварительную
 * стоимость, /v1/order/create создаёт заказ. Публичный чекаут использует
 * отдельный флаг ozon_delivery_api_enabled и не меняет старый Seller-контур.
 */

import {
  OzonDeliveryApiClient,
  type OzonDeliveryApiError,
  type OzonTokenProvider,
} from "./client";
import type { OzonHttpRedirect } from "./http";
import {
  ozonDeliveryTokenService,
  type OzonTokenStatus,
} from "./token";
import {
  OzonDeliveryPointsService,
  OZON_DELIVERY_POINT_LIST_PATH,
  type OzonPointsSyncResult,
} from "./points";
import {
  OzonDeliveryQuoteService,
  type OzonQuoteRequest,
  type OzonQuoteResult,
} from "./quote";
import {
  OzonDeliveryOrderService,
  type OzonOrderCreateRequest,
  type OzonOrderCreateResult,
} from "./order";

export { OZON_DELIVERY_POINT_LIST_PATH } from "./points";
export type { OzonQuoteRequest, OzonQuoteResult } from "./quote";
export type {
  OzonOrderCreateRequest,
  OzonOrderCreateResult,
} from "./order";

export interface OzonDeliveryConnectionCheck {
  success: boolean;
  checkedAt: string;
  token: {
    ok: boolean;
    configured: boolean;
    clientIdMasked: string | null;
    expiresAt?: string;
    expiresInSeconds?: number;
    scopes?: string[];
    error?: OzonDeliveryApiError;
  };
  api: null | {
    ok: boolean;
    status: number;
    itemsCount: number | null;
    traceId?: string;
    finalUrl?: string;
    redirects?: OzonHttpRedirect[];
    error?: OzonDeliveryApiError;
  };
}

function countListItems(data: any): number | null {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return null;

  for (const key of ["items", "points", "delivery_points", "result"]) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  return null;
}

export class OzonDeliveryApiService {
  private readonly token: OzonTokenProvider;
  private readonly client: OzonDeliveryApiClient;
  private readonly points: OzonDeliveryPointsService;
  private readonly quote: OzonDeliveryQuoteService;
  private readonly order: OzonDeliveryOrderService;

  constructor(deps: {
    token?: OzonTokenProvider;
    client?: OzonDeliveryApiClient;
    points?: OzonDeliveryPointsService;
    quote?: OzonDeliveryQuoteService;
    order?: OzonDeliveryOrderService;
  } = {}) {
    this.token = deps.token ?? ozonDeliveryTokenService;
    this.client =
      deps.client ?? new OzonDeliveryApiClient({ tokenService: this.token });
    this.points =
      deps.points ?? new OzonDeliveryPointsService({ client: this.client });
    this.quote =
      deps.quote ??
      new OzonDeliveryQuoteService({
        client: this.client,
        points: this.points,
      });
    this.order =
      deps.order ??
      new OzonDeliveryOrderService({
        client: this.client,
        quote: this.quote,
      });
  }

  getStatus(): OzonTokenStatus {
    return this.token.getStatus();
  }

  getPointsStatus() {
    return this.points.getStatus();
  }

  getPoint(id: string) {
    return this.points.getPointForQuote(id);
  }

  listPointsByCity(city: string, limit = 500) {
    return this.points.listPointsByCity(city, limit);
  }

  syncPoints(options: {
    maxPages?: number;
    restart?: boolean;
  } = {}): Promise<OzonPointsSyncResult> {
    return this.points.syncBatch(options);
  }

  calculateQuote(request: OzonQuoteRequest): Promise<OzonQuoteResult> {
    return this.quote.calculate(request);
  }

  createOrder(request: OzonOrderCreateRequest): Promise<OzonOrderCreateResult> {
    return this.order.create(request);
  }

  async checkConnection(): Promise<OzonDeliveryConnectionCheck> {
    const checkedAt = new Date().toISOString();
    const tokenResult = await this.token.getAccessToken();
    const tokenStatus = this.token.getStatus();

    if (!tokenResult.ok) {
      return {
        success: false,
        checkedAt,
        token: {
          ok: false,
          configured: tokenStatus.configured,
          clientIdMasked: tokenStatus.clientIdMasked,
          error: {
            code: tokenResult.error.code,
            message: tokenResult.error.message,
            status: tokenResult.error.status,
          },
        },
        api: null,
      };
    }

    const api = await this.client.request(OZON_DELIVERY_POINT_LIST_PATH, {
      pagination: { limit: 1 },
    });

    const expiresInSeconds = Math.max(
      0,
      Math.round((tokenResult.token.expiresAt - Date.now()) / 1000),
    );

    return {
      success: api.ok,
      checkedAt,
      token: {
        ok: true,
        configured: true,
        clientIdMasked: tokenStatus.clientIdMasked,
        expiresAt: new Date(tokenResult.token.expiresAt).toISOString(),
        expiresInSeconds,
        scopes: tokenResult.token.scopes,
      },
      api: {
        ok: api.ok,
        status: api.status,
        itemsCount: api.ok ? countListItems(api.data) : null,
        traceId: api.traceId,
        finalUrl: api.finalUrl,
        redirects: api.redirects,
        error: api.error,
      },
    };
  }
}

export const ozonDeliveryApi = new OzonDeliveryApiService();
