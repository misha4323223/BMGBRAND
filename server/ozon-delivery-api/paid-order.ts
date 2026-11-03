/**
 * Создание заказа Ozon Delivery после оплаты заказа магазина.
 *
 * Idempotency-Key детерминирован от ID заказа магазина: повторный webhook
 * (ЮKassa/Т-Банк) или ретрай после таймаута использует тот же ключ и не
 * создаёт второе отправление.
 */

import { createHash } from "crypto";
import { logInfo, logWarn } from "../logger";
import {
  OZON_ORDER_MAX_DECLARED_VALUE_KOPEKS,
  type OzonOrderCreateRequest,
  type OzonOrderCreateResult,
} from "./order";
import { OZON_QUOTE_MAX_ITEM_COUNT } from "./quote";
import { ozonDeliveryApi } from "./index";

export interface PaidOzonOrderLike {
  id: number;
  items: unknown;
  cdekData?: unknown;
  addonData?: unknown;
  customerPhone?: string | null;
  customerName?: string | null;
}

export interface PaidOzonOrderResult {
  success: boolean;
  skipped?: boolean;
  orderNumber?: string;
  postingNumber?: string;
  idempotencyKey?: string;
  error?: string;
  mayHaveBeenCreated?: boolean;
  traceId?: string;
  status?: number;
}

function parseJson(value: unknown): any {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildOzonOrderIdempotencyKey(orderId: number | string): string {
  const hex = createHash("sha256")
    .update(`ozon-delivery-order:${orderId}`)
    .digest("hex")
    .slice(0, 32);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16,
  )}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function orderItems(value: unknown): any[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.productId != null ||
            item.productName != null ||
            item.name != null ||
            item.price != null),
      )
    : [];
}

function orderOzonFields(order: PaidOzonOrderLike): {
  deliveryPointId?: string;
  shipmentMethodId?: string;
} {
  const data = parseJson(order.cdekData) ?? {};
  const direct = order as PaidOzonOrderLike & {
    ozonPvzId?: string | null;
    ozonShipmentMethodId?: string | null;
  };
  return {
    deliveryPointId:
      data.ozonPvzId != null
        ? String(data.ozonPvzId)
        : direct.ozonPvzId != null
          ? String(direct.ozonPvzId)
          : undefined,
    shipmentMethodId:
      data.ozonShipmentMethodId != null
        ? String(data.ozonShipmentMethodId)
        : direct.ozonShipmentMethodId != null
          ? String(direct.ozonShipmentMethodId)
          : undefined,
  };
}

export function buildPaidOzonOrderRequest(
  order: PaidOzonOrderLike,
):
  | { ok: true; request: OzonOrderCreateRequest; idempotencyKey: string }
  | { ok: false; error: string; idempotencyKey: string } {
  const idempotencyKey = buildOzonOrderIdempotencyKey(order.id);
  const items = orderItems(order.items);
  const itemCount = items.reduce(
    (sum, item) => sum + Math.max(1, Math.floor(Number(item.quantity) || 1)),
    0,
  );
  const declaredValueKopeks = items.reduce((sum, item) => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const price = Math.max(0, Math.round(Number(item.price) || 0));
    return sum + price * quantity;
  }, 0);

  if (items.length === 0 || itemCount === 0) {
    return {
      ok: false,
      error: "В заказе нет товаров для передачи в Ozon",
      idempotencyKey,
    };
  }
  if (itemCount > OZON_QUOTE_MAX_ITEM_COUNT) {
    return {
      ok: false,
      error: `Ozon Delivery принимает не больше ${OZON_QUOTE_MAX_ITEM_COUNT} товаров в одном заказе`,
      idempotencyKey,
    };
  }
  if (
    !Number.isSafeInteger(declaredValueKopeks) ||
    declaredValueKopeks <= 0 ||
    declaredValueKopeks > OZON_ORDER_MAX_DECLARED_VALUE_KOPEKS
  ) {
    return {
      ok: false,
      error:
        "Объявленная стоимость заказа должна быть положительной и не больше 500 000 ₽",
      idempotencyKey,
    };
  }

  const { deliveryPointId, shipmentMethodId } = orderOzonFields(order);
  if (!deliveryPointId) {
    return {
      ok: false,
      error: "В заказе не сохранён ID ПВЗ Ozon",
      idempotencyKey,
    };
  }

  const names = items
    .map((item) => String(item.productName || item.name || "").trim())
    .filter(Boolean)
    .join(", ");
  const description = `Заказ #${order.id}${names ? `: ${names}` : ""}`.slice(
    0,
    500,
  );

  return {
    ok: true,
    idempotencyKey,
    request: {
      deliveryPointId,
      phoneNumber: String(order.customerPhone || ""),
      declaredValueKopeks,
      itemCount,
      description,
      fullName: String(order.customerName || "").trim() || undefined,
      orderExternalId: String(order.id),
      postingExternalId: String(order.id),
      shipmentMethodId: shipmentMethodId || undefined,
      idempotencyKey,
    },
  };
}

export async function createOzonDeliveryForPaidOrder(
  order: PaidOzonOrderLike,
): Promise<PaidOzonOrderResult> {
  const addon = parseJson(order.addonData) ?? {};
  if (addon.ozonOrderId) {
    return {
      success: true,
      skipped: true,
      orderNumber: String(addon.ozonOrderId),
    };
  }

  if (!ozonDeliveryApi.getStatus().configured) {
    return {
      success: false,
      error:
        "Ozon Delivery API не настроен: задайте OZON_DELIVERY_API_CLIENT_ID и OZON_DELIVERY_API_CLIENT_SECRET",
    };
  }

  const built = buildPaidOzonOrderRequest(order);
  if (!built.ok) {
    return {
      success: false,
      error: built.error,
      idempotencyKey: built.idempotencyKey,
    };
  }

  let result: OzonOrderCreateResult;
  try {
    result = await ozonDeliveryApi.createOrder(built.request);
  } catch (err: any) {
    logWarn(
      `[OzonDeliveryAPI] Ошибка создания заказа для #${order.id}:`,
      err?.message || err,
    );
    return {
      success: false,
      error: err?.message || "Ошибка создания заказа Ozon",
      idempotencyKey: built.idempotencyKey,
      mayHaveBeenCreated: true,
    };
  }

  if (!result.success || !result.order) {
    logWarn(
      `[OzonDeliveryAPI] Заказ магазина #${order.id} не создан в Ozon: ${
        result.error || "неизвестная ошибка"
      }`,
    );
    return {
      success: false,
      error: result.error || "Ozon не создал заказ",
      idempotencyKey: result.idempotencyKey ?? built.idempotencyKey,
      mayHaveBeenCreated: result.mayHaveBeenCreated,
      traceId: result.traceId,
      status: result.status,
    };
  }

  const firstPosting = result.order.postings[0];
  logInfo(
    `[OzonDeliveryAPI] Заказ магазина #${order.id} создан в Ozon: ${result.order.orderNumber}${
      firstPosting ? `, отправление ${firstPosting.postingNumber}` : ""
    }`,
  );

  return {
    success: true,
    orderNumber: result.order.orderNumber,
    postingNumber: firstPosting?.postingNumber,
    idempotencyKey: result.idempotencyKey ?? built.idempotencyKey,
    traceId: result.traceId,
  };
}
