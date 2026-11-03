/**
 * Ozon Delivery API — предварительный расчёт доставки.
 *
 * Официальный endpoint: POST /v1/order/checkout. Он проверяет доступность
 * доставки в выбранный ПВЗ и возвращает срок, стоимость доставки и страховки.
 * В запросе нужен shipment_method_id, который приходит в delivery-point/list
 * вместе с пунктом выдачи.
 *
 * Сервис не ходит в Ozon за справочником: ПВЗ и методы берутся из локальной
 * таблицы, синхронизированной на этапе 3. Этот же расчёт используется
 * публичным чекаутом после выбора ПВЗ.
 */

import { logInfo, logWarn } from "../logger";
import type { OzonDeliveryApiClient } from "./client";
import type { OzonDeliveryPointsService } from "./points";
import type { OzonQuotePoint } from "./points-store";
import {
  kopeksToOzonAmount,
  normalizeOzonId,
  toOzonApiInt64,
} from "./request";

export const OZON_DELIVERY_ORDER_CHECKOUT_PATH = "/v1/order/checkout";

/** Средняя посылка: 500 г на товар, но не меньше 500 г на посылку. */
export const OZON_QUOTE_ITEM_WEIGHT_G = 500;
export const OZON_QUOTE_MIN_WEIGHT_G = 500;
export const OZON_QUOTE_DEFAULT_BOX = {
  lengthMm: 300,
  widthMm: 250,
  heightMm: 50,
};

export const OZON_QUOTE_MAX_ITEM_COUNT = 100;
export const OZON_QUOTE_DEFAULT_CUTOFF_MS = 2 * 60 * 60 * 1000;

export interface OzonQuoteDimensions {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface OzonQuoteRequest {
  deliveryPointId: string;
  phoneNumber: string;
  /** Объявленная стоимость товаров в копейках. */
  declaredValueKopeks: number;
  itemCount?: number;
  /** Для диагностики/тестов; по умолчанию берём первый метод ПВЗ. */
  shipmentMethodId?: string;
  dimensions?: Partial<OzonQuoteDimensions>;
  cutoffAt?: string;
}

export interface OzonDeliveryQuote {
  deliveryPointId: string;
  shipmentMethodId: string;
  deliveryCostKopeks: number;
  insuranceCostKopeks: number;
  /** Доставка + страховка. */
  costKopeks: number;
  estimatedDeliveryDays?: number;
  cutoffAt?: string;
  requestIds: string[];
  traceId?: string;
}

export type OzonQuoteErrorCode =
  | "invalid_request"
  | "point_not_found"
  | "point_inactive"
  | "no_shipment_method"
  | "points_unavailable"
  | "api_error"
  | "empty_result";

export interface OzonQuoteResult {
  success: boolean;
  quote?: OzonDeliveryQuote;
  error?: string;
  code?: OzonQuoteErrorCode;
  status?: number;
  traceId?: string;
}

export interface OzonDeliveryQuoteServiceOptions {
  client: OzonDeliveryApiClient;
  points: Pick<OzonDeliveryPointsService, "getPointForQuote">;
  now?: () => number;
}

/**
 * Приводит российский номер к формату Ozon: +7XXXXXXXXXX.
 * Возвращает null, если номер не похож на телефон.
 */
export function normalizeOzonPhone(input: string): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function buildOzonQuoteDimensions(
  itemCount = 1,
  overrides: Partial<OzonQuoteDimensions> = {},
): OzonQuoteDimensions {
  const count = Math.max(
    1,
    Math.min(
      OZON_QUOTE_MAX_ITEM_COUNT,
      Math.floor(Number.isFinite(itemCount) ? itemCount : 1),
    ),
  );
  const pick = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };

  return {
    weightGrams: pick(
      overrides.weightGrams,
      Math.max(OZON_QUOTE_MIN_WEIGHT_G, count * OZON_QUOTE_ITEM_WEIGHT_G),
    ),
    lengthMm: pick(overrides.lengthMm, OZON_QUOTE_DEFAULT_BOX.lengthMm),
    widthMm: pick(overrides.widthMm, OZON_QUOTE_DEFAULT_BOX.widthMm),
    heightMm: pick(overrides.heightMm, OZON_QUOTE_DEFAULT_BOX.heightMm),
  };
}

function moneyToKopeks(value: any): number | null {
  if (value == null) return null;

  let amount = value;
  if (typeof value === "object") {
    const currency = String(value.currency_code ?? "RUB").toUpperCase();
    if (currency !== "RUB") return null;
    amount = value.amount;
  }

  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100);
  }

  if (typeof amount === "string") {
    const normalized = amount.trim().replace(",", ".");
    const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const rubles = Number(match[1]);
    const kopeks = Number((match[2] ?? "").padEnd(2, "0"));
    if (!Number.isSafeInteger(rubles) || !Number.isFinite(kopeks)) return null;
    return rubles * 100 + kopeks;
  }

  return null;
}

function resultError(value: any): string {
  const error = value?.error;
  if (!error) return "Ozon не вернул расчёт";
  if (typeof error === "string") return error;
  return String(error.message ?? error.code ?? "Ошибка расчёта Ozon");
}

export interface ParsedOzonQuote {
  deliveryCostKopeks: number;
  insuranceCostKopeks: number;
  estimatedDeliveryDays?: number;
  cutoffAt?: string;
  requestIds: string[];
}

export function parseOzonOrderCheckoutResponse(
  data: any,
): { ok: true; value: ParsedOzonQuote } | { ok: false; error: string } {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.result?.results)
        ? data.result.results
        : [];

  if (raw.length === 0) {
    return { ok: false, error: "Ozon не вернул результаты расчёта" };
  }

  let deliveryCostKopeks = 0;
  let insuranceCostKopeks = 0;
  let estimatedDeliveryDays: number | undefined;
  let cutoffAt: string | undefined;
  const requestIds: string[] = [];

  for (const result of raw) {
    if (result?.error) {
      return { ok: false, error: resultError(result) };
    }

    const posting = result?.posting ?? result;
    const deliveryRaw = posting?.estimated_delivery_cost;
    const delivery =
      deliveryRaw == null ? 0 : moneyToKopeks(deliveryRaw);
    if (delivery == null) {
      return {
        ok: false,
        error: "Ozon не вернул корректную стоимость доставки",
      };
    }
    const insuranceRaw = posting?.estimated_insurance_cost;
    const insurance =
      insuranceRaw == null ? 0 : moneyToKopeks(insuranceRaw);
    if (insurance == null) {
      return {
        ok: false,
        error: "Ozon не вернул корректную стоимость страховки",
      };
    }

    deliveryCostKopeks += delivery;
    insuranceCostKopeks += insurance;

    if (posting?.estimated_delivery_days != null) {
      const days = Number(posting.estimated_delivery_days);
      if (Number.isFinite(days) && days >= 0) {
        estimatedDeliveryDays = Math.max(estimatedDeliveryDays ?? 0, days);
      }
    }

    if (!cutoffAt && typeof posting?.cutoff_at === "string") {
      cutoffAt = posting.cutoff_at;
    }

    const requestId = result?.request_id;
    if (requestId != null) requestIds.push(String(requestId));
  }

  return {
    ok: true,
    value: {
      deliveryCostKopeks,
      insuranceCostKopeks,
      estimatedDeliveryDays,
      cutoffAt,
      requestIds,
    },
  };
}

export class OzonDeliveryQuoteService {
  private readonly client: OzonDeliveryApiClient;
  private readonly points: Pick<OzonDeliveryPointsService, "getPointForQuote">;
  private readonly now: () => number;

  constructor(options: OzonDeliveryQuoteServiceOptions) {
    this.client = options.client;
    this.points = options.points;
    this.now = options.now ?? Date.now;
  }

  async calculate(request: OzonQuoteRequest): Promise<OzonQuoteResult> {
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
      declaredValueKopeks <= 0
    ) {
      return {
        success: false,
        code: "invalid_request",
        error: "declaredValueKopeks должен быть положительным целым числом",
      };
    }

    let point: OzonQuotePoint | null;
    try {
      point = await this.points.getPointForQuote(deliveryPointId);
    } catch (err: any) {
      return {
        success: false,
        code: "points_unavailable",
        error: err?.message || "Справочник ПВЗ недоступен",
      };
    }

    if (!point) {
      return {
        success: false,
        code: "point_not_found",
        error: "ПВЗ не найден в локальном справочнике. Синхронизируйте ПВЗ.",
      };
    }
    if (!point.isActive) {
      return {
        success: false,
        code: "point_inactive",
        error: "ПВЗ неактивен",
      };
    }

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
    const shipmentMethodId =
      requestedMethod ?? point.shipmentMethodIds[0] ?? null;
    if (!shipmentMethodId) {
      return {
        success: false,
        code: "no_shipment_method",
        error:
          "У ПВЗ нет shipment_method_id. Создайте метод доставки в Ozon Доставке и повторите синхронизацию ПВЗ.",
      };
    }

    const itemCount = Math.max(
      1,
      Math.min(
        OZON_QUOTE_MAX_ITEM_COUNT,
        Math.floor(Number(request.itemCount) || 1),
      ),
    );
    const dimensions = buildOzonQuoteDimensions(itemCount, request.dimensions);
    const cutoffAt =
      request.cutoffAt ??
      new Date(this.now() + OZON_QUOTE_DEFAULT_CUTOFF_MS).toISOString();

    const body = {
      recipient: { phone_number: phone },
      postings: [
        {
          request_id: 1,
          shipment_method_id: toOzonApiInt64(shipmentMethodId),
          cutoff_at: cutoffAt,
          declared_value: {
            amount: kopeksToOzonAmount(declaredValueKopeks),
            currency_code: "RUB",
          },
          dimensions: {
            weight_g: dimensions.weightGrams,
            length_mm: dimensions.lengthMm,
            width_mm: dimensions.widthMm,
            height_mm: dimensions.heightMm,
          },
        },
      ],
      delivery: {
        delivery_point: {
          delivery_point_id: toOzonApiInt64(deliveryPointId),
        },
      },
    };

    const response = await this.client.request(
      OZON_DELIVERY_ORDER_CHECKOUT_PATH,
      body,
    );

    if (!response.ok) {
      const message =
        response.error?.message || `Ozon Delivery API: HTTP ${response.status}`;
      logWarn(
        `[OzonDeliveryAPI] quote ${deliveryPointId} → ${response.status}: ${message}`,
      );
      return {
        success: false,
        code: "api_error",
        error: message,
        status: response.status,
        traceId: response.traceId,
      };
    }

    const parsed = parseOzonOrderCheckoutResponse(response.data);
    if (!parsed.ok) {
      logWarn(
        `[OzonDeliveryAPI] quote ${deliveryPointId}: ${parsed.error}`,
      );
      return {
        success: false,
        code: "empty_result",
        error: parsed.error,
        status: response.status,
        traceId: response.traceId,
      };
    }

    const quote: OzonDeliveryQuote = {
      deliveryPointId,
      shipmentMethodId,
      deliveryCostKopeks: parsed.value.deliveryCostKopeks,
      insuranceCostKopeks: parsed.value.insuranceCostKopeks,
      costKopeks:
        parsed.value.deliveryCostKopeks + parsed.value.insuranceCostKopeks,
      estimatedDeliveryDays: parsed.value.estimatedDeliveryDays,
      cutoffAt: parsed.value.cutoffAt,
      requestIds: parsed.value.requestIds,
      traceId: response.traceId,
    };

    logInfo(
      `[OzonDeliveryAPI] quote ${deliveryPointId}: доставка ${(
        quote.deliveryCostKopeks / 100
      ).toFixed(2)} ₽, страховка ${(quote.insuranceCostKopeks / 100).toFixed(
        2,
      )} ₽, срок ${quote.estimatedDeliveryDays ?? "—"} дн.`,
    );

    return { success: true, quote };
  }
}
