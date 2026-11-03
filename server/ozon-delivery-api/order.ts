/**
 * Ozon Delivery API — создание заказа.
 *
 * Официальный endpoint: POST /v1/order/create. Перед созданием обязательно
 * повторяем /v1/order/checkout с теми же габаритами, стоимостью и cutoff_at:
 * так Ozon проверяет, что предварительный расчёт ещё актуален. Если расчёт
 * не прошёл, заказ не отправляем.
 *
 * Сервис используется админской диагностикой и публичным чекаутом после
 * оплаты. Публичный контур включается отдельным флагом
 * ozon_delivery_api_enabled и не меняет старый ozon_delivery_enabled.
 */

import { randomUUID } from "crypto";
import { logInfo, logWarn } from "../logger";
import type { OzonDeliveryApiClient } from "./client";
import type { OzonDeliveryQuoteService } from "./quote";
import {
  OZON_QUOTE_DEFAULT_CUTOFF_MS,
  OZON_QUOTE_MAX_ITEM_COUNT,
  buildOzonQuoteDimensions,
  normalizeOzonPhone,
  type OzonDeliveryQuote,
  type OzonQuoteDimensions,
  type OzonQuoteErrorCode,
  type OzonQuoteResult,
} from "./quote";
import {
  kopeksToOzonAmount,
  normalizeOzonId,
  toOzonApiInt64,
} from "./request";

export const OZON_DELIVERY_ORDER_CREATE_PATH = "/v1/order/create";

/** Официальное ограничение объявленной стоимости отправления — 500 000 ₽. */
export const OZON_ORDER_MAX_DECLARED_VALUE_KOPEKS = 50_000_000;
export const OZON_ORDER_MAX_DESCRIPTION_LENGTH = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OzonOrderCreateRequest {
  deliveryPointId: string;
  phoneNumber: string;
  /** Объявленная стоимость товаров в копейках. */
  declaredValueKopeks: number;
  itemCount?: number;
  /** Обязательное описание содержимого отправления, 1–500 символов. */
  description: string;
  fullName?: string;
  orderExternalId?: string;
  postingExternalId?: string;
  /** Для диагностики/тестов; по умолчанию берём метод из quote. */
  shipmentMethodId?: string;
  dimensions?: Partial<OzonQuoteDimensions>;
  cutoffAt?: string;
  /** UUID. Если не задан, генерируется и возвращается в результате. */
  idempotencyKey?: string;
}

export interface OzonDeliveryOrderPosting {
  requestId?: string;
  postingNumber: string;
  postingExternalId?: string;
  estimatedDeliveryDays?: number;
  cutoffAt?: string;
}

export interface OzonDeliveryOrder {
  orderNumber: string;
  orderExternalId?: string;
  postings: OzonDeliveryOrderPosting[];
}

export type OzonOrderErrorCode =
  | "invalid_request"
  | "quote_failed"
  | "api_error"
  | "invalid_response";

export interface OzonOrderCreateResult {
  success: boolean;
  order?: OzonDeliveryOrder;
  error?: string;
  code?: OzonOrderErrorCode;
  status?: number;
  traceId?: string;
  quote?: OzonDeliveryQuote;
  quoteCode?: OzonQuoteErrorCode;
  idempotencyKey?: string;
  /**
   * true, если запрос мог дойти до Ozon, но результат неизвестен
   * (таймаут/сеть/5xx). Повторять можно только с тем же Idempotency-Key.
   */
  mayHaveBeenCreated?: boolean;
}

export interface OzonDeliveryOrderServiceOptions {
  client: Pick<OzonDeliveryApiClient, "request">;
  quote: Pick<OzonDeliveryQuoteService, "calculate">;
  now?: () => number;
  newId?: () => string;
}

function resultError(value: any): string {
  const error = value?.error;
  if (!error) return "Ozon вернул ошибку создания заказа";
  if (typeof error === "string") return error;
  return String(error.message ?? error.code ?? "Ошибка создания заказа Ozon");
}

export interface ParsedOzonOrder {
  orderNumber: string;
  orderExternalId?: string;
  postings: OzonDeliveryOrderPosting[];
}

export function parseOzonOrderCreateResponse(
  data: any,
): { ok: true; value: ParsedOzonOrder } | { ok: false; error: string } {
  const root =
    data?.result &&
    typeof data.result === "object" &&
    !Array.isArray(data.result)
      ? data.result
      : data;

  if (root?.error) {
    return { ok: false, error: resultError(root) };
  }

  const rawOrderNumber = root?.order_number;
  const orderNumber =
    typeof rawOrderNumber === "string" || typeof rawOrderNumber === "number"
      ? String(rawOrderNumber).trim()
      : "";
  if (!orderNumber) {
    return { ok: false, error: "Ozon не вернул order_number" };
  }

  const rawPostings = Array.isArray(root?.postings) ? root.postings : [];
  if (rawPostings.length === 0) {
    return { ok: false, error: "Ozon не вернул отправления заказа" };
  }

  const postings: OzonDeliveryOrderPosting[] = [];
  for (const item of rawPostings) {
    if (item?.error) {
      return { ok: false, error: resultError(item) };
    }

    const rawPostingNumber = item?.posting_number;
    const postingNumber =
      typeof rawPostingNumber === "string" ||
      typeof rawPostingNumber === "number"
        ? String(rawPostingNumber).trim()
        : "";
    if (!postingNumber) {
      return {
        ok: false,
        error: "Ozon не вернул posting_number созданного отправления",
      };
    }

    const requestId =
      item?.request_id == null ? undefined : String(item.request_id);
    const postingExternalId =
      typeof item?.posting_external_id === "string" &&
      item.posting_external_id.trim()
        ? item.posting_external_id.trim()
        : undefined;
    const days = Number(item?.estimated_delivery_days);
    const estimatedDeliveryDays =
      Number.isFinite(days) && days >= 0 ? days : undefined;
    const cutoffAt =
      typeof item?.cutoff_at === "string" ? item.cutoff_at : undefined;

    postings.push({
      requestId,
      postingNumber,
      postingExternalId,
      estimatedDeliveryDays,
      cutoffAt,
    });
  }

  const orderExternalId =
    typeof root?.order_external_id === "string" &&
    root.order_external_id.trim()
      ? root.order_external_id.trim()
      : undefined;

  return { ok: true, value: { orderNumber, orderExternalId, postings } };
}

export class OzonDeliveryOrderService {
  private readonly client: Pick<OzonDeliveryApiClient, "request">;
  private readonly quote: Pick<OzonDeliveryQuoteService, "calculate">;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: OzonDeliveryOrderServiceOptions) {
    this.client = options.client;
    this.quote = options.quote;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  async create(request: OzonOrderCreateRequest): Promise<OzonOrderCreateResult> {
    const deliveryPointId = normalizeOzonId(request.deliveryPointId);
    if (!deliveryPointId) {
      return {
        success: false,
        code: "invalid_request",
        error: "Укажите корректный deliveryPointId",
      };
    }

    const phone = normalizeOzonPhone(request.phoneNumber);
    if (!phone) {
      return {
        success: false,
        code: "invalid_request",
        error: "Телефон должен быть в формате +7XXXXXXXXXX",
      };
    }

    const declaredValueKopeks = Math.round(
      Number(request.declaredValueKopeks),
    );
    if (
      !Number.isSafeInteger(declaredValueKopeks) ||
      declaredValueKopeks <= 0 ||
      declaredValueKopeks > OZON_ORDER_MAX_DECLARED_VALUE_KOPEKS
    ) {
      return {
        success: false,
        code: "invalid_request",
        error:
          "declaredValueKopeks должен быть положительным целым числом не больше 50 000 000 копеек",
      };
    }

    const itemCount = Number(request.itemCount ?? 1);
    if (
      !Number.isInteger(itemCount) ||
      itemCount < 1 ||
      itemCount > OZON_QUOTE_MAX_ITEM_COUNT
    ) {
      return {
        success: false,
        code: "invalid_request",
        error: `itemCount должен быть целым числом от 1 до ${OZON_QUOTE_MAX_ITEM_COUNT}`,
      };
    }

    const description = String(request.description ?? "").trim();
    if (
      description.length === 0 ||
      description.length > OZON_ORDER_MAX_DESCRIPTION_LENGTH
    ) {
      return {
        success: false,
        code: "invalid_request",
        error: `description должен содержать от 1 до ${OZON_ORDER_MAX_DESCRIPTION_LENGTH} символов`,
      };
    }

    const fullName = String(request.fullName ?? "").trim();
    const orderExternalId = String(request.orderExternalId ?? "").trim();
    const postingExternalId = String(request.postingExternalId ?? "").trim();
    const requestedMethod = request.shipmentMethodId
      ? normalizeOzonId(request.shipmentMethodId)
      : null;
    if (request.shipmentMethodId && !requestedMethod) {
      return {
        success: false,
        code: "invalid_request",
        error: "shipmentMethodId должен быть числовым ID",
      };
    }

    const requestedKey = String(request.idempotencyKey ?? "").trim();
    if (requestedKey && !UUID_RE.test(requestedKey)) {
      return {
        success: false,
        code: "invalid_request",
        error: "idempotencyKey должен быть UUID",
      };
    }
    const idempotencyKey = requestedKey || this.newId();

    const cutoffAt = String(request.cutoffAt ?? "").trim()
      ? String(request.cutoffAt).trim()
      : new Date(this.now() + OZON_QUOTE_DEFAULT_CUTOFF_MS).toISOString();
    if (!Number.isFinite(Date.parse(cutoffAt))) {
      return {
        success: false,
        code: "invalid_request",
        error: "cutoffAt должен быть корректной датой",
        idempotencyKey,
      };
    }

    const dimensions = buildOzonQuoteDimensions(
      itemCount,
      request.dimensions,
    );

    // Официальная рекомендация Ozon: перед create повторить checkout
    // с теми же параметрами. Иначе заказ может уйти с устаревшим расчётом.
    let quoteResult: OzonQuoteResult;
    try {
      quoteResult = await this.quote.calculate({
        deliveryPointId,
        phoneNumber: phone,
        declaredValueKopeks,
        itemCount,
        shipmentMethodId: requestedMethod ?? undefined,
        dimensions,
        cutoffAt,
      });
    } catch (err: any) {
      return {
        success: false,
        code: "quote_failed",
        error: err?.message || "Не удалось проверить расчёт перед созданием заказа",
        idempotencyKey,
      };
    }

    if (!quoteResult.success || !quoteResult.quote) {
      return {
        success: false,
        code: "quote_failed",
        quoteCode: quoteResult.code,
        status: quoteResult.status,
        traceId: quoteResult.traceId,
        error:
          quoteResult.error ||
          "Предварительный расчёт не прошёл, заказ не создан",
        idempotencyKey,
      };
    }

    const quote = quoteResult.quote;
    const shipmentMethodId = normalizeOzonId(quote.shipmentMethodId);
    if (!shipmentMethodId) {
      return {
        success: false,
        code: "invalid_response",
        error: "Ozon вернул некорректный shipment_method_id в расчёте",
        quote,
        idempotencyKey,
      };
    }

    // Текущий чекаут всегда формирует одну посылку. API поддерживает до 100
    // отправлений; расширим массив, когда появится корзинная упаковка.
    const body = {
      ...(orderExternalId ? { order_external_id: orderExternalId } : {}),
      recipient: {
        phone_number: phone,
        ...(fullName ? { full_name: fullName } : {}),
      },
      delivery: {
        delivery_point: {
          delivery_point_id: toOzonApiInt64(deliveryPointId),
        },
      },
      postings: [
        {
          request_id: 1,
          ...(postingExternalId
            ? { posting_external_id: postingExternalId }
            : {}),
          shipment_method_id: toOzonApiInt64(shipmentMethodId),
          description,
          declared_value: {
            amount: kopeksToOzonAmount(declaredValueKopeks),
            currency_code: "RUB",
          },
          cutoff_at: cutoffAt,
          dimensions: {
            weight_g: dimensions.weightGrams,
            length_mm: dimensions.lengthMm,
            width_mm: dimensions.widthMm,
            height_mm: dimensions.heightMm,
          },
        },
      ],
    };

    const response = await this.client.request(
      OZON_DELIVERY_ORDER_CREATE_PATH,
      body,
      { "Idempotency-Key": idempotencyKey },
    );

    if (!response.ok) {
      const message =
        response.error?.message || `Ozon Delivery API: HTTP ${response.status}`;
      const mayHaveBeenCreated =
        response.error?.code === "network_error" || response.status >= 500;
      logWarn(
        `[OzonDeliveryAPI] order/create → ${response.status}${
          mayHaveBeenCreated ? " (результат неизвестен)" : ""
        }: ${message}`,
      );
      return {
        success: false,
        code: "api_error",
        error: message,
        status: response.status,
        traceId: response.traceId,
        quote,
        idempotencyKey,
        mayHaveBeenCreated,
      };
    }

    const parsed = parseOzonOrderCreateResponse(response.data);
    if (!parsed.ok) {
      logWarn(
        `[OzonDeliveryAPI] order/create: ${parsed.error} (результат неизвестен)`,
      );
      return {
        success: false,
        code: "invalid_response",
        error: parsed.error,
        status: response.status,
        traceId: response.traceId,
        quote,
        idempotencyKey,
        // Ozon ответил 200, но разобрать ответ не удалось: заказ мог быть создан.
        mayHaveBeenCreated: true,
      };
    }

    const order: OzonDeliveryOrder = {
      orderNumber: parsed.value.orderNumber,
      orderExternalId:
        parsed.value.orderExternalId ?? (orderExternalId || undefined),
      postings: parsed.value.postings,
    };

    logInfo(
      `[OzonDeliveryAPI] Заказ ${order.orderNumber} создан: отправлений ${order.postings.length}${
        response.traceId ? `, trace ${response.traceId}` : ""
      }`,
    );

    return {
      success: true,
      order,
      quote,
      traceId: response.traceId,
      idempotencyKey,
    };
  }
}
