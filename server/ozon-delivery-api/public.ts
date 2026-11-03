/**
 * Публичный чекаут Ozon Delivery API.
 *
 * Старый Seller-контур управляется флагом ozon_delivery_enabled. Новый контур
 * включается отдельным флагом, чтобы миграция не меняла поведение старого
 * чекаута. Публичный Ozon показываем только когда заданы новые ключи и
 * справочник ПВЗ полностью синхронизирован.
 */

import { logWarn } from "../logger";
import { storage } from "../storage";
import { ozonDeliveryApi } from "./index";

export const OZON_DELIVERY_API_PUBLIC_FLAG_KEY =
  "ozon_delivery_api_enabled";

export async function getOzonDeliveryApiPublicFlag(): Promise<boolean> {
  try {
    return (
      (await storage.getBonusSetting(OZON_DELIVERY_API_PUBLIC_FLAG_KEY)) ===
      "true"
    );
  } catch (err: any) {
    logWarn(
      "[OzonDeliveryAPI] Не удалось прочитать флаг публичного чекаута:",
      err?.message || err,
    );
    return false;
  }
}

/**
 * Новый Ozon можно показывать покупателю только при:
 *  - заданных OZON_DELIVERY_API_CLIENT_ID/SECRET;
 *  - включённом отдельном флаге;
 *  - завершённой синхронизации ПВЗ (по умолчанию).
 */
export async function isOzonDeliveryApiPublicEnabled(options?: {
  requirePoints?: boolean;
}): Promise<boolean> {
  if (!ozonDeliveryApi.getStatus().configured) return false;
  if (!(await getOzonDeliveryApiPublicFlag())) return false;
  if (options?.requirePoints === false) return true;

  try {
    const { state } = await ozonDeliveryApi.getPointsStatus();
    return !!state?.completedAt && state.hasMore === false;
  } catch (err: any) {
    logWarn(
      "[OzonDeliveryAPI] Не удалось проверить готовность справочника ПВЗ:",
      err?.message || err,
    );
    return false;
  }
}
