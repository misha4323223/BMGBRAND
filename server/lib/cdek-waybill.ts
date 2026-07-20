/**
 * CDEK waybill creation helpers.
 * Extracted from routes.ts so they can be shared between the route handlers
 * and the preorder status scheduler.
 */

import { storage } from "../storage";
import {
  cdekService,
  CDEK_SENDER_CITY_CODE,
  CDEK_SENDER_ADDRESS,
  CDEK_SENDER_PVZ_CODE,
  CDEK_DEFAULT_PACKAGE,
  isTariffToDoor,
  isTariffFromPvz,
} from "../cdek";
import { notifyError } from "../error-monitor";

const CDEK_ITEM_WEIGHT_GRAMS = 300;

// Per-process lock — prevents double-creation if two code paths race
const cdekWaybillLocks = new Set<number>();

export async function createCdekWaybillForOrder(
  orderId: number
): Promise<{ success: boolean; uuid?: string; error?: string }> {
  if (cdekWaybillLocks.has(orderId)) {
    console.log(`[CDEK Waybill] Order #${orderId} is already being processed, skipping`);
    return { success: false, error: "Already processing" };
  }

  cdekWaybillLocks.add(orderId);

  try {
    const order = await storage.getOrder(orderId);
    if (!order) {
      return { success: false, error: `Order ${orderId} not found` };
    }

    if (order.isWholesale) {
      console.log(`[CDEK Waybill] Skipping wholesale order #${orderId}`);
      return { success: false, error: "Wholesale orders use their own transport" };
    }

    let cdekInfo: {
      pointCode?: string;
      cityCode?: number;
      tariffCode?: number;
      orderUuid?: string;
      status?: string;
      error?: string;
      doorAddress?: {
        street?: string;
        house?: string;
        flat?: string;
        entrance?: string;
        floor?: string;
      };
    } = {};

    console.log(`[CDEK Waybill] Order #${orderId} raw cdekData: ${order.cdekData}`);
    if (order.cdekData) {
      try {
        cdekInfo = JSON.parse(order.cdekData);
      } catch {}
    }
    console.log(
      `[CDEK Waybill] Order #${orderId} parsed cdekInfo: pointCode=${cdekInfo.pointCode}, cityCode=${cdekInfo.cityCode}, tariffCode=${cdekInfo.tariffCode}`
    );

    if (cdekInfo.orderUuid) {
      console.log(`[CDEK Waybill] Order #${orderId} already has CDEK waybill: ${cdekInfo.orderUuid}`);
      return { success: true, uuid: cdekInfo.orderUuid };
    }

    if (cdekInfo.status === "creating") {
      console.log(`[CDEK Waybill] Order #${orderId} waybill is already being created by another process, skipping`);
      return { success: false, error: "Already creating" };
    }

    if (!cdekInfo.tariffCode && !cdekInfo.pointCode && !cdekInfo.cityCode) {
      console.log(`[CDEK Waybill] No CDEK data for order #${orderId}, skipping`);
      return { success: false, error: "No CDEK delivery data" };
    }

    cdekInfo.status = "creating";
    await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));

    const tariffCode = cdekInfo.tariffCode || 139;
    const deliveryToDoor = isTariffToDoor(tariffCode);
    const senderFromPvz = isTariffFromPvz(tariffCode);

    console.log(
      `[CDEK Waybill] Order #${orderId}: tariff=${tariffCode}, toDoor=${deliveryToDoor}, fromPvz=${senderFromPvz}, pointCode=${cdekInfo.pointCode || "none"}, cityCode=${cdekInfo.cityCode || "none"}`
    );

    const senderPhone = process.env.STORE_PHONE || "+79000000000";
    const senderName = process.env.STORE_NAME || "BOOOMERANGS";

    const orderItems = (order.items || [])
      .filter((item: any) => !item._discountDetails)
      .map((item: any, idx: number) => ({
        name: (item.productName || item.name || `Товар ${idx + 1}`).substring(0, 255),
        ware_key: item.sku || item.productId?.toString() || `item-${idx}`,
        payment: { value: 0 },
        cost: (item.price || 0) / 100,
        weight: CDEK_ITEM_WEIGHT_GRAMS,
        amount: item.quantity || 1,
      }));

    const totalItemCount = orderItems.reduce((sum: number, item: any) => sum + item.amount, 0);
    const totalWeight = totalItemCount * CDEK_ITEM_WEIGHT_GRAMS;

    const orderData: any = {
      type: 1,
      number: `BOOOMERANGS-${orderId}`,
      tariff_code: tariffCode,
      sender: {
        name: senderName,
        phones: [{ number: senderPhone }],
      },
      recipient: {
        name: order.customerName,
        phones: [{ number: order.customerPhone }],
        email: order.customerEmail,
      },
      packages: [
        {
          number: `ORDER-${orderId}`,
          weight: totalWeight || CDEK_DEFAULT_PACKAGE.weight,
          length: CDEK_DEFAULT_PACKAGE.length,
          width: CDEK_DEFAULT_PACKAGE.width,
          height: CDEK_DEFAULT_PACKAGE.height,
          items: orderItems,
        },
      ],
    };

    if (senderFromPvz && CDEK_SENDER_PVZ_CODE) {
      orderData.shipment_point = CDEK_SENDER_PVZ_CODE;
    } else {
      orderData.from_location = {
        code: CDEK_SENDER_CITY_CODE,
        address: CDEK_SENDER_ADDRESS,
      };
    }

    if (deliveryToDoor) {
      const doorAddr = cdekInfo.doorAddress;
      if (doorAddr && doorAddr.street && doorAddr.house) {
        const addressParts = [doorAddr.street, `д. ${doorAddr.house}`];
        if (doorAddr.flat) addressParts.push(`кв. ${doorAddr.flat}`);
        if (doorAddr.entrance) addressParts.push(`подъезд ${doorAddr.entrance}`);
        if (doorAddr.floor) addressParts.push(`этаж ${doorAddr.floor}`);
        orderData.to_location = {
          code: cdekInfo.cityCode,
          address: addressParts.join(", "),
          ...(doorAddr.flat ? { flat: doorAddr.flat } : {}),
        };
      } else {
        const addressText = order.address || "";
        const cleanAddress = addressText.replace(/^СДЭК (ПВЗ|Курьер):\s*/i, "").trim();
        orderData.to_location = {
          code: cdekInfo.cityCode,
          address: cleanAddress || "Адрес не указан",
        };
      }
    } else {
      if (cdekInfo.pointCode) {
        orderData.delivery_point = cdekInfo.pointCode;
      } else if (cdekInfo.cityCode) {
        orderData.to_location = {
          code: cdekInfo.cityCode,
        };
      }
    }

    if (!orderData.to_location && !orderData.delivery_point) {
      cdekInfo.status = "error";
      cdekInfo.error = "Missing destination: no city code and no point code";
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
      console.error(`[CDEK Waybill] Order #${orderId}: missing both to_location and delivery_point`);
      return { success: false, error: "Missing destination data" };
    }

    console.log(`[CDEK Waybill] Creating waybill for order #${orderId}...`);

    const result = await cdekService.createOrder(orderData);

    if (result?._validationErrors) {
      cdekInfo.status = "error";
      cdekInfo.error = result._validationErrors;
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
      console.error(`[CDEK Waybill] Validation errors for order #${orderId}: ${result._validationErrors}`);
      return { success: false, error: result._validationErrors };
    }

    if (result?.entity?.uuid) {
      cdekInfo.orderUuid = result.entity.uuid;
      cdekInfo.status = "created";
      delete cdekInfo.error;
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
      console.log(`[CDEK Waybill] Waybill created for order #${orderId}: UUID=${result.entity.uuid}`);
      return { success: true, uuid: result.entity.uuid };
    } else {
      cdekInfo.status = "error";
      cdekInfo.error = `Unexpected response: ${JSON.stringify(result).substring(0, 200)}`;
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
      console.error(`[CDEK Waybill] Unexpected response for order #${orderId}:`, JSON.stringify(result));
      return { success: false, error: "Unexpected CDEK response" };
    }
  } catch (error: any) {
    try {
      const order = await storage.getOrder(orderId);
      if (order?.cdekData) {
        const info = JSON.parse(order.cdekData);
        info.status = "error";
        info.error = error.message;
        await storage.updateOrderCdekData(orderId, JSON.stringify(info));
      }
    } catch {}
    console.error(`[CDEK Waybill] Error creating waybill for order #${orderId}:`, error.message);
    notifyError("CDEK накладная", `Заказ #${orderId} — ошибка создания накладной CDEK`, error.message);
    return { success: false, error: error.message };
  } finally {
    cdekWaybillLocks.delete(orderId);
  }
}

export async function recreateCdekWaybillForOrder(orderId: number): Promise<void> {
  const order = await storage.getOrder(orderId);
  if (!order?.cdekData) return;
  let cdekInfo: any = {};
  try {
    cdekInfo = JSON.parse(order.cdekData);
  } catch {
    return;
  }
  if (!cdekInfo.orderUuid) {
    await createCdekWaybillForOrder(orderId);
    return;
  }
  try {
    await cdekService.deleteOrder(cdekInfo.orderUuid);
    console.log(`[CDEK Recreate] Deleted old waybill ${cdekInfo.orderUuid} for order #${orderId}`);
  } catch (err: any) {
    console.warn(`[CDEK Recreate] Could not delete old waybill for order #${orderId}:`, err.message);
  }
  delete cdekInfo.orderUuid;
  cdekInfo.status = undefined;
  await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
  await createCdekWaybillForOrder(orderId);
}
