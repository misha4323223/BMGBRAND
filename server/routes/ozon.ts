import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { ozonDeliveryService } from "../ozon-delivery";
import { ozonDeliveryOAuth, OZON_OAUTH_KEYS } from "../ozon-delivery-oauth";
import { runAbandonedCartCheck } from "../abandoned-cart";

// Ozon Delivery admin + public routes extracted from routes.ts verbatim.
export function registerOzonRoutes(
  app: Express,
  authMiddleware: (req: any, res: any, next: any) => void,
  requireAdminRole: (req: any, res: any, next: any) => void
) {
  // ==================== Ozon Delivery Admin ====================

  // GET /api/admin/ozon-delivery/settings — статус + флаг включения
  app.get("/api/admin/ozon-delivery/settings", authMiddleware, requireAdminRole, async (_req, res) => {
    res.json(ozonDeliveryService.getStatus());
  });

  // POST /api/admin/ozon-delivery/settings — включить/выключить доставку в чекауте
  app.post("/api/admin/ozon-delivery/settings", authMiddleware, requireAdminRole, async (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    if (!ozonDeliveryService.isConfigured()) {
      return res.status(503).json({ error: "Добавьте OZON_CLIENT_ID и OZON_CLIENT_SECRET в переменные окружения контейнера и перезапустите сервер" });
    }
    const value = enabled ? "true" : "false";
    await storage.setBonusSetting("ozon_delivery_enabled", value).catch(() => {});
    ozonDeliveryService.setEnabled(enabled);
    logInfo(`[OzonDelivery] Доставка ${enabled ? "включена" : "отключена"} администратором`);
    res.json({ success: true, enabled });
  });

  // POST /api/admin/ozon-delivery/check-order — статус заказа по ozonOrderId
  app.post("/api/admin/ozon-delivery/check-order", authMiddleware, requireAdminRole, async (req, res) => {
    const { ozonOrderId } = req.body as { ozonOrderId: string };
    if (!ozonOrderId) return res.status(400).json({ error: "ozonOrderId required" });
    const result = await ozonDeliveryService.getOrder(ozonOrderId);
    res.json(result);
  });

  // POST /api/admin/ozon-delivery/retry-order — повторная отправка заказа в Ozon после сбоя API.
  // Читает данные заказа из YDB и вызывает createOrder заново.
  // Используется менеджером когда в addonData.ozonCreateFailed === true.
  app.post("/api/admin/ozon-delivery/retry-order", authMiddleware, requireAdminRole, async (req, res) => {
    const { orderId } = req.body as { orderId: number | string };
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    const numId = Number(orderId);
    if (isNaN(numId)) return res.status(400).json({ error: "orderId must be a number" });

    const order = await storage.getOrder(numId);
    if (!order) return res.status(404).json({ error: "Заказ не найден" });
    if (order.deliveryService !== "ozon") return res.status(400).json({ error: "Заказ не использует Ozon доставку" });
    if (!ozonDeliveryService.isEnabled()) return res.status(503).json({ error: "Ozon Delivery не включён или не авторизован" });

    const existingAddon = (() => { try { return JSON.parse(order.addonData || '{}'); } catch { return {}; } })();
    if (existingAddon.ozonOrderId) {
      return res.status(400).json({ error: "У заказа уже есть ozonOrderId — повтор не нужен", ozonOrderId: existingAddon.ozonOrderId });
    }

    const items = (() => { try { return JSON.parse((order.items as unknown as string) || '[]'); } catch { return []; } })();
    let pvzId: string | undefined;
    try { pvzId = order.cdekData ? JSON.parse(order.cdekData as string)?.ozonPvzId || undefined : undefined; } catch {}

    const result = await ozonDeliveryService.createOrder({
      externalOrderId: String(order.id),
      customerPhone: order.customerPhone || "",
      customerName: order.customerName || "",
      amount: order.total,
      pvzId,
      items: (Array.isArray(items) ? items : []).map((item: any) => ({
        offerId: item.article || item.sku || String(item.productId),
        quantity: item.quantity || 1,
        price: item.price || 0,
        name: item.productName || item.name || "",
      })),
    });

    if (result.success && result.ozonOrderId) {
      await storage.updateOrderAddonData(numId, JSON.stringify({
        ...existingAddon,
        ozonOrderId: result.ozonOrderId,
        ozonCreateFailed: false,
        ozonRetrySuccessAt: new Date().toISOString(),
      })).catch(e => logError(`[OzonRetry] Failed to save ozonOrderId for order ${numId}:`, e?.message));
      logInfo(`[OzonRetry] Admin retry succeeded: ozonOrderId=${result.ozonOrderId} for order ${numId}`);
      return res.json({ success: true, ozonOrderId: result.ozonOrderId });
    } else {
      await storage.updateOrderAddonData(numId, JSON.stringify({
        ...existingAddon,
        ozonCreateFailed: true,
        ozonCreateError: result.error || "unknown",
        ozonCreateFailedAt: new Date().toISOString(),
        ozonRetryAttemptAt: new Date().toISOString(),
      })).catch(e => logError(`[OzonRetry] Failed to save retry error for order ${numId}:`, e?.message));
      logError(`[OzonRetry] Admin retry failed for order ${numId}:`, result.error);
      return res.status(502).json({ success: false, error: result.error });
    }
  });

  // ==================== Ozon Delivery OAuth ====================

  // GET /api/admin/ozon-oauth/authorize — URL для авторизации в Ozon
  app.get("/api/admin/ozon-oauth/authorize", authMiddleware, requireAdminRole, (_req, res) => {
    if (!ozonDeliveryOAuth.isConfigured()) {
      return res.status(503).json({ error: "OZON_CLIENT_ID / OZON_CLIENT_SECRET не заданы" });
    }
    try {
      const authUrl = ozonDeliveryOAuth.generateAuthUrl();
      res.json({ authUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ozon/oauth/callback — OAuth callback от Ozon (redirect_uri)
  app.get("/api/ozon/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) {
      logError("[OzonOAuth] Callback error:", error);
      return res.redirect(`/admin?tab=integrations&ozon_error=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return res.redirect("/admin?tab=integrations&ozon_error=missing_params");
    }
    if (!ozonDeliveryOAuth.validateState(state)) {
      return res.redirect("/admin?tab=integrations&ozon_error=invalid_state");
    }
    const result = await ozonDeliveryOAuth.exchangeCode(code);
    if (!result.success || !result.tokenData) {
      logError("[OzonOAuth] Exchange failed:", result.error);
      return res.redirect(`/admin?tab=integrations&ozon_error=${encodeURIComponent(result.error || "exchange_failed")}`);
    }
    // Сохраняем токены в БД
    const { tokenData } = result;
    await Promise.all([
      storage.setBonusSetting(OZON_OAUTH_KEYS.accessToken, tokenData.accessToken).catch(() => {}),
      storage.setBonusSetting(OZON_OAUTH_KEYS.refreshToken, tokenData.refreshToken).catch(() => {}),
      storage.setBonusSetting(OZON_OAUTH_KEYS.expiresAt, String(tokenData.expiresAt)).catch(() => {}),
    ]);
    logInfo("[OzonOAuth] Токены сохранены, авторизация успешна");
    res.redirect("/admin?tab=integrations&ozon_success=1");
  });

  // POST /api/admin/ozon-oauth/reload — перечитать токены из YDB без рестарта сервера
  app.post("/api/admin/ozon-oauth/reload", authMiddleware, requireAdminRole, async (_req, res) => {
    try {
      const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
        storage.getBonusSetting(OZON_OAUTH_KEYS.accessToken).catch(() => null),
        storage.getBonusSetting(OZON_OAUTH_KEYS.refreshToken).catch(() => null),
        storage.getBonusSetting(OZON_OAUTH_KEYS.expiresAt).catch(() => null),
      ]);
      if (accessToken && refreshToken && expiresAtStr) {
        ozonDeliveryOAuth.loadTokensFromStorage(accessToken, refreshToken, Number(expiresAtStr));
        logInfo("[OzonOAuth] Токены перечитаны из YDB по запросу");
        res.json({ success: true, status: ozonDeliveryOAuth.getStatus() });
      } else {
        res.json({ success: false, error: "Токены в YDB не найдены — авторизуйтесь заново" });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/ozon-oauth/revoke — отключить Ozon (очистить токены)
  app.post("/api/admin/ozon-oauth/revoke", authMiddleware, requireAdminRole, async (_req, res) => {
    ozonDeliveryOAuth.clearTokens();
    ozonDeliveryService.setEnabled(false);
    await Promise.all([
      storage.setBonusSetting(OZON_OAUTH_KEYS.accessToken, "").catch(() => {}),
      storage.setBonusSetting(OZON_OAUTH_KEYS.refreshToken, "").catch(() => {}),
      storage.setBonusSetting(OZON_OAUTH_KEYS.expiresAt, "").catch(() => {}),
      storage.setBonusSetting("ozon_delivery_enabled", "false").catch(() => {}),
    ]);
    logInfo("[OzonOAuth] Токены удалены");
    res.json({ success: true });
  });

  // POST /api/admin/trigger-abandoned-cart — ручной запуск проверки брошенных корзин
  app.post("/api/admin/trigger-abandoned-cart", authMiddleware, requireAdminRole, async (_req, res) => {
    res.json({ success: true, message: "Запущено — результат появится в логах" });
    runAbandonedCartCheck().catch(err =>
      logError("[AbandonedCart] Manual trigger error:", err.message)
    );
  });

  // POST /api/admin/clear-cart-reminders — сброс cooldown-записей (если письма не дошли)
  app.post("/api/admin/clear-cart-reminders", authMiddleware, requireAdminRole, async (_req, res) => {
    const db = storage as any;
    if (typeof db.clearCartReminders !== 'function') {
      return res.status(400).json({ success: false, message: "Метод недоступен (dev-режим без YDB)" });
    }
    try {
      const count = await db.clearCartReminders();
      logInfo(`[AbandonedCart] Cleared ${count} cart_reminders records by admin`);
      res.json({ success: true, message: `Сброшено ${count} записей cooldown` });
    } catch (err: any) {
      logError('[AbandonedCart] Clear reminders error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ==================== Ozon Delivery: проверка доступности и стоимости ====================
  // POST /api/ozon-delivery/points — публичный, список ПВЗ по городу
  app.post("/api/ozon-delivery/points", async (req, res) => {
    const { city, limit } = req.body as { city?: string; limit?: number };
    if (!ozonDeliveryService.isEnabled()) {
      return res.json({ success: false, points: [], error: "Ozon Доставка не подключена" });
    }
    try {
      const result = await ozonDeliveryService.getPvzList(city, limit || 100);
      res.json(result);
    } catch (err: any) {
      logError("[OzonDelivery] points error:", err.message);
      res.json({ success: false, points: [], error: err.message });
    }
  });

  // POST /api/ozon-delivery/map-points — только координаты всех ПВЗ из кэша (без Ozon API вызовов)
  app.post("/api/ozon-delivery/map-points", async (req, res) => {
    const { city } = req.body as { city?: string };
    if (!ozonDeliveryService.isEnabled()) {
      return res.json({ success: false, points: [], error: "Ozon Доставка не подключена" });
    }
    try {
      const result = await ozonDeliveryService.getPvzMapPoints(city);
      res.json(result);
    } catch (err: any) {
      logError("[OzonDelivery] map-points error:", err.message);
      res.json({ success: false, points: [], error: err.message });
    }
  });

  // POST /api/ozon-delivery/point-detail — детали одного ПВЗ по id (для балуна на карте)
  app.post("/api/ozon-delivery/point-detail", async (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) return res.json({ success: false, error: "id required" });
    if (!ozonDeliveryService.isEnabled()) {
      return res.json({ success: false, error: "Ozon Доставка не подключена" });
    }
    try {
      const result = await ozonDeliveryService.getPvzPointDetail(id);
      res.json(result);
    } catch (err: any) {
      logError("[OzonDelivery] point-detail error:", err.message);
      res.json({ success: false, error: err.message });
    }
  });

  // POST /api/ozon-delivery/check — публичный, вызывается из чекаута
  app.post("/api/ozon-delivery/check", async (req, res) => {
    const { phone, items } = req.body as { phone?: string; items?: Array<{ offerId: string; quantity: number }> };
    if (!phone) {
      return res.status(400).json({ error: "Требуется номер телефона" });
    }
    if (!ozonDeliveryService.isEnabled()) {
      return res.json({ available: false, cost: 0, error: "Ozon Доставка не подключена" });
    }
    try {
      const result = await ozonDeliveryService.checkDelivery(phone, items);
      res.json(result);
    } catch (err: any) {
      logError("[OzonDelivery] check error:", err.message);
      res.json({ available: false, cost: 0, error: err.message });
    }
  });
}
