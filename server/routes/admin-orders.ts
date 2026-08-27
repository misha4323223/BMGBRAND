import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage, isLoyaltyCountedStatus } from "../storage";
import { orderStatusPushPayload, sendPushToUser } from "../push-service";
import { sendEmail, getOrderReadyForPickupEmailHtml } from "../email";
import { syncOrderStatusToBitrix } from "../bitrix24";
import { createCdekWaybillForOrder, recreateCdekWaybillForOrder } from "../lib/cdek-waybill";
import { cdekService } from "../cdek";
import { getProgressiveCommissionRate } from "@shared/schema";
import { registerAnalyticsRoutes } from "./analytics";

// Admin orders management routes extracted from routes.ts verbatim.
export function registerAdminOrdersRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // ===== ADMIN ORDERS MANAGEMENT =====
  
  // Get all orders (admin)
  app.get("/api/admin/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (err: any) {
      logError("[Admin] Get orders error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin analytics (server/routes/analytics.ts)
  registerAnalyticsRoutes(app, getAdminKey);

  // Get draft/expired orders (admin)
  app.get("/api/admin/draft-orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const drafts = await storage.getDraftOrders();
      res.json(drafts);
    } catch (err: any) {
      logError("[Admin] getDraftOrders error:", err.message);
      res.status(500).json({ error: "Ошибка сервера" });
    }
  });

  // Delete a specific draft/expired order (admin)
  app.delete("/api/admin/draft-orders/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await storage.deleteOrder(id);
      res.json({ success: true });
    } catch (err: any) {
      logError("[Admin] deleteDraftOrder error:", err.message);
      res.status(500).json({ error: "Ошибка сервера" });
    }
  });

  // Update order status (admin)
  app.patch("/api/admin/orders/:id/status", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ error: "Status required" });
      }
      const orderId = Number(req.params.id);
      const prevOrder = await storage.getOrder(orderId);
      const order = await storage.updateOrderStatus(orderId, status);

      // Лояльность: списываем total_spent при возврате/отмене оплаченного заказа
      if ((status === "cancelled" || status === "refunded") && prevOrder && isLoyaltyCountedStatus(prevOrder.status)) {
        storage.revokeOrderLoyalty(orderId).then(r => {
          if (r.revoked) logInfo(`[Admin] Loyalty revoked for order ${orderId} (${status}), discount: ${r.discount}%`);
        }).catch(err => logError(`[Admin] Loyalty revoke failed for order ${orderId}:`, err?.message));
      }

      // Push-уведомление пользователю о смене статуса
      if (prevOrder?.userId) {
        const pushData = orderStatusPushPayload(orderId, status);
        if (pushData) sendPushToUser(String(prevOrder.userId), pushData).catch(() => {});
      }

      // Email клиенту: заказ привезён в пункт самовывоза
      if (status === "ready_for_pickup" && prevOrder?.status !== "ready_for_pickup") {
        try {
          const customerEmail = prevOrder?.customerEmail;
          if (customerEmail) {
            let isPickup = /^самовывоз:/i.test(String(prevOrder?.address || ""));
            try {
              const d = typeof prevOrder?.cdekData === "string" ? JSON.parse(prevOrder.cdekData) : prevOrder?.cdekData;
              if (d?.deliveryService === "pickup") isPickup = true;
            } catch { /* ignore malformed cdekData */ }
            if (isPickup) {
              const pickupPoint = String(prevOrder?.address || "").replace(/^Самовывоз:\s*/i, "").trim() || undefined;
              const ok = await sendEmail({
                to: customerEmail,
                subject: `Заказ #${orderId} готов к выдаче — BOOOMERANGS`,
                html: getOrderReadyForPickupEmailHtml({
                  id: orderId,
                  customerName: prevOrder?.customerName || "Покупатель",
                  pickupPoint,
                }),
              });
              logInfo(`[Pickup] Ready-for-pickup email for order #${orderId} -> ${customerEmail}: ${ok ? "sent" : "failed/disabled"}`);
            } else {
              logInfo(`[Pickup] Status ready_for_pickup set for order #${orderId}, but order is not pickup — email skipped`);
            }
          }
        } catch (emailErr: any) {
          logError(`[Pickup] Failed to send ready-for-pickup email for order #${orderId}:`, emailErr?.message);
        }
      }

      storage.getOrderBitrixDealId(orderId).then(dealId => {
        if (!dealId) return;
        syncOrderStatusToBitrix(orderId, status, dealId).catch(err =>
          logError(`[Order Status] Bitrix sync failed for order ${orderId}:`, err?.message || err)
        );
      }).catch(err =>
        logError(`[Order Status] getOrderBitrixDealId failed for order ${orderId}:`, err?.message || err)
      );

      // Partner commission status sync: delivered → confirmed; cancelled/refunded → cancelled
      // After cancellation, monthly progressive scale is recalculated downward for ref-partners.
      if (status === "delivered" || status === "cancelled" || status === "refunded") {
        storage.getCommissionByOrderId(orderId).then(async (commission) => {
          if (!commission) return;
          if (status === "delivered" && commission.status === "pending") {
            await storage.updateCommissionStatus(commission.id, "confirmed");
            logInfo(`[Partner] Commission ${commission.id} confirmed (order ${orderId} delivered)`);
          } else if ((status === "cancelled" || status === "refunded") && commission.status !== "cancelled" && commission.status !== "paid") {
            await storage.updateCommissionStatus(commission.id, "cancelled");
            logInfo(`[Partner] Commission ${commission.id} cancelled (order ${orderId} ${status})`);

            // Пересчёт месячной шкалы вниз для обычных реф-партнёров
            try {
              const partner = await storage.getPartnerById(commission.partnerId);
              if (partner && !partner.isArtist && partner.commissionOverride == null) {
                const commCreatedAt = commission.createdAt ?? new Date();
                const commYear = commCreatedAt.getUTCFullYear();
                const commMonth = commCreatedAt.getUTCMonth() + 1;
                const remaining = await storage.getMonthlyRefCommissions(commission.partnerId, commYear, commMonth);
                const monthlyTotal = remaining.reduce((s, c) => s + c.orderItemsTotal, 0);
                const newPercent = getProgressiveCommissionRate(monthlyTotal);
                await storage.recalcMonthlyCommissions(commission.partnerId, commYear, commMonth, newPercent);
                logInfo(`[Partner] Monthly recalc after cancel: partner=${commission.partnerId} remainingTotal=${monthlyTotal/100}₽ newPercent=${newPercent}%`);
              }
            } catch (recalcErr: any) {
              logError('[Partner] Monthly recalc failed after cancel:', recalcErr?.message);
            }
          }
        }).catch(err => logError(`[Partner] Commission sync failed for order ${orderId}:`, err.message));
      }

      if (status === "paid") {
        createCdekWaybillForOrder(orderId).catch(err => 
          logError(`[Admin] CDEK waybill error for order ${orderId}:`, err.message)
        );
      }

      res.json(order);
    } catch (err: any) {
      logError("[Admin] Update order status error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete order (admin)
  app.delete("/api/admin/orders/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const deleted = await storage.deleteOrder(Number(req.params.id));
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Order not found" });
      }
    } catch (err: any) {
      logError("[Admin] Delete order error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/orders/:id/cdek-retry", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      await recreateCdekWaybillForOrder(orderId);
      res.json({ success: true });
    } catch (err: any) {
      logError("[Admin] CDEK retry error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/orders/:id/cdek-status", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      let cdekInfo: any = {};
      if (order.cdekData) {
        try { cdekInfo = JSON.parse(order.cdekData); } catch {}
      }

      let cdekOrderStatus = null;
      if (cdekInfo.orderUuid) {
        try {
          cdekOrderStatus = await cdekService.getOrderStatus(cdekInfo.orderUuid);
        } catch (e: any) {
          cdekOrderStatus = { error: e.message };
        }
      }

      res.json({
        orderId,
        isWholesale: order.isWholesale,
        cdekData: cdekInfo,
        cdekOrderStatus,
      });
    } catch (err: any) {
      logError("[Admin] CDEK status error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: update order items (no notifications sent to customer)
  app.patch("/api/admin/orders/:id/items", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orderId = Number(req.params.id);
      if (!orderId) return res.status(400).json({ error: "Invalid order id" });
      const { items } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ error: "items must be an array" });
      // Recalculate total from items (price in kopeks * quantity)
      const totalKopeks = items.reduce((sum: number, item: any) => {
        return sum + Math.round((item.price || 0) * (item.quantity || 1));
      }, 0);
      await storage.updateOrderItems(orderId, items, totalKopeks);
      logInfo(`[Admin] Order #${orderId} items updated by admin: ${items.length} items, total ${totalKopeks} kopeks`);
      res.json({ success: true, total: totalKopeks });
    } catch (err: any) {
      logError("[Admin] Update order items error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/orders/:id/cdek-data", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orderId = Number(req.params.id);
      const { pointAddress, cdekNumber, deliveryCost } = req.body;
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      let cdekInfo: any = {};
      if (order.cdekData) { try { cdekInfo = JSON.parse(order.cdekData); } catch {} }
      if (pointAddress !== undefined) cdekInfo.pointAddress = pointAddress;
      if (cdekNumber !== undefined) cdekInfo.cdekNumber = cdekNumber;
      if (deliveryCost !== undefined) cdekInfo.deliveryCost = deliveryCost;
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
