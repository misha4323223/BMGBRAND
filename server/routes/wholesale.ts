import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { authStorage } from "../auth-storage";
import { sendInvoiceEmail, getNextInvoiceNumber, generateInvoicePDF } from "../invoice";
import { uploadToYandexStorage } from "../lib/storage-s3";
import { notifyNewOrder } from "../telegram";
import { vkNotifyNewOrder } from "../vk";

// Wholesale / partner routes extracted from routes.ts:
// - admin wholesale-users + wholesale-orders + final-invoice (email + PDF)
// - wholesale XML feed (approved-wholesaler products + public YML by token)
// - wholesale-preorder slides (admin upload/delete/reorder)
// - wholesale-preorder products + toggle (admin)
// - wholesale-preorder/order (customer order creation → invoice + TG/VK notify)
export function registerWholesaleAdminRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
  authMiddleware: any
) {
  // Admin: Список оптовых клиентов с их статистикой заказов
  app.get("/api/admin/wholesale-users", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const [wholesaleUsers, allOrders] = await Promise.all([
        authStorage.getWholesaleUsers(),
        storage.getOrders(),
      ]);

      const wholesaleOrders = allOrders.filter((o: any) => o.isWholesale && o.status !== 'awaiting_payment');

      const ordersByUserId: Record<number, any[]> = {};
      const ordersByEmail: Record<string, any[]> = {};
      for (const o of wholesaleOrders) {
        if (o.userId) {
          if (!ordersByUserId[o.userId]) ordersByUserId[o.userId] = [];
          ordersByUserId[o.userId].push(o);
        }
        if (o.customerEmail) {
          const key = o.customerEmail.toLowerCase();
          if (!ordersByEmail[key]) ordersByEmail[key] = [];
          ordersByEmail[key].push(o);
        }
      }

      const result = wholesaleUsers.map(u => {
        const byId = ordersByUserId[u.id] || [];
        const byEmail = u.email ? (ordersByEmail[u.email.toLowerCase()] || []) : [];
        const seen = new Set<number>();
        const userOrders: any[] = [];
        for (const o of [...byId, ...byEmail]) {
          if (!seen.has(o.id)) { seen.add(o.id); userOrders.push(o); }
        }
        const totalSpent = userOrders.reduce((s, o) => s + (o.total || 0), 0);
        const lastOrder = userOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          companyName: u.companyName,
          inn: u.inn,
          kpp: u.kpp,
          legalAddress: u.legalAddress,
          storeName: u.storeName,
          storeAddress: u.storeAddress,
          contactPerson: u.contactPerson,
          contactPhone: u.contactPhone,
          wholesaleApproved: u.wholesaleApproved,
          wholesaleDiscount: u.wholesaleDiscount,
          wholesaleMarkup: u.wholesaleMarkup,
          createdAt: u.createdAt,
          orderCount: userOrders.length,
          totalSpent,
          lastOrderAt: lastOrder?.createdAt || null,
        };
      });

      res.json({ users: result });
    } catch (err: any) {
      logError("[Admin] Get wholesale users error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Детальная карточка оптового клиента
  app.get("/api/admin/wholesale-users/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const userId = Number(req.params.id);
      if (!userId) return res.status(400).json({ error: "Invalid id" });

      const users = await authStorage.getWholesaleUsers();
      const user = users.find(u => u.id === userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const [ordersByUserId, ordersByEmail] = await Promise.all([
        storage.getOrdersByUserId(userId),
        user.email ? storage.getOrdersByEmail(user.email) : Promise.resolve([]),
      ]);

      const ordersMap = new Map<number, any>();
      for (const o of [...ordersByUserId, ...ordersByEmail]) {
        if (o.isWholesale) ordersMap.set(o.id, o);
      }
      const orders = Array.from(ordersMap.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      res.json({ user, orders });
    } catch (err: any) {
      logError("[Admin] Get wholesale user detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Сменить пароль оптовику вручную
  app.post("/api/admin/wholesale-users/:id/set-password", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const userId = Number(req.params.id);
      if (!userId) return res.status(400).json({ error: "Invalid id" });
      const { password } = req.body;
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "Пароль должен быть не менее 6 символов" });
      }
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(password, 10);
      const ok = await authStorage.updatePassword(userId, passwordHash);
      if (!ok) return res.status(404).json({ error: "Пользователь не найден" });
      logInfo(`[Admin] Password changed for wholesale user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      logError("[Admin] Set wholesale password error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Все оптовые предзаказы (заявки)
  // Выставить финальный счёт (оставшиеся 50%) по оптовому предзаказу
  app.post("/api/admin/wholesale-orders/:id/final-invoice", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Заказ не найден" });
      if (!order.isWholesale) return res.status(400).json({ error: "Не оптовый заказ" });

      // Данные покупателя
      const customerEmail = order.customerEmail;
      const customerName = order.customerName;
      const customerPhone = order.customerPhone || "";

      // Получаем ИНН из профиля оптовика если есть
      let customerInn: string | undefined;
      try {
        const wholesaleUsers = await authStorage.getWholesaleUsers();
        const wUser = wholesaleUsers.find(u =>
          u.id === (order as any).userId || u.email.toLowerCase() === customerEmail.toLowerCase()
        );
        customerInn = wUser?.inn || undefined;
      } catch {}

      // НДС
      let vatRate = 5;
      let vatMode: 'included' | 'on_top' = 'included';
      try {
        const vatSetting = await storage.getBonusSetting("invoice_vat_rate");
        if (vatSetting) { const p = parseFloat(vatSetting); if (!isNaN(p)) vatRate = p; }
        const modeSetting = await storage.getBonusSetting("invoice_vat_mode");
        if (modeSetting === 'on_top' || modeSetting === 'included') vatMode = modeSetting;
      } catch {}

      const remainingAmount = Math.round(order.total / 2);
      const invoiceNum = getNextInvoiceNumber();
      const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);

      const invoiceItems = items.map((item: any) => ({
        name: `[Финал] ${item.productName || item.name || "Товар"}${item.size && item.size !== "One Size" ? ` (${item.size})` : ""}`,
        sku: item.sku || "",
        quantity: item.quantity || 1,
        price: Math.round((item.price || 0) / 2),
      }));

      const invoiceData = {
        invoiceNumber: invoiceNum,
        date: new Date(),
        customerName,
        customerPhone,
        customerEmail,
        customerInn,
        transportCompany: order.transportCompany || "cdek",
        vatRate,
        vatMode,
        subjectOverride: `Финальный счёт (50%) — Оптовый предзаказ #${orderId} — BMGBRAND`,
        noteText: `Это финальный счёт на <strong>оставшиеся 50%</strong> оплаты по предзаказу #${orderId}.<br>Спасибо за ожидание — товар готов к отгрузке! 🚀`,
        items: invoiceItems,
      };

      await sendInvoiceEmail(invoiceData);

      // Сохраняем номер финального счёта в заказ чтобы показать в ЛК
      await storage.updateOrderPreorderFields(orderId, { preorderPaymentId: `final:${invoiceNum}` });

      res.json({ ok: true, invoiceNumber: invoiceNum, remainingAmount });
    } catch (err: any) {
      logError("[Wholesale] Final invoice error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Скачать финальный счёт (PDF) — для оптового покупателя в ЛК
  app.get("/api/auth/orders/:orderId/final-invoice-pdf", authMiddleware, async (req: any, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Заказ не найден" });
      if ((order as any).userId !== req.user.id && order.customerEmail !== req.user.email) {
        return res.status(403).json({ error: "Нет доступа" });
      }
      const preorderPaymentId = (order as any).preorderPaymentId || "";
      if (!preorderPaymentId.startsWith("final:")) {
        return res.status(404).json({ error: "Финальный счёт ещё не выставлен" });
      }
      const invoiceNum = Number(preorderPaymentId.replace("final:", ""));

      let customerInn: string | undefined;
      try {
        const wholesaleUsers = await authStorage.getWholesaleUsers();
        const wUser = wholesaleUsers.find(u =>
          u.id === (order as any).userId || u.email.toLowerCase() === order.customerEmail.toLowerCase()
        );
        customerInn = wUser?.inn || undefined;
      } catch {}

      let vatRate = 5;
      let vatMode: 'included' | 'on_top' = 'included';
      try {
        const vatSetting = await storage.getBonusSetting("invoice_vat_rate");
        if (vatSetting) { const p = parseFloat(vatSetting); if (!isNaN(p)) vatRate = p; }
        const modeSetting = await storage.getBonusSetting("invoice_vat_mode");
        if (modeSetting === 'on_top' || modeSetting === 'included') vatMode = modeSetting;
      } catch {}

      const items = typeof order.items === 'string' ? JSON.parse(order.items as string) : (order.items || []);
      const pdfBuffer = await generateInvoicePDF({
        invoiceNumber: invoiceNum,
        date: new Date(),
        customerName: order.customerName,
        customerPhone: order.customerPhone || "",
        customerEmail: order.customerEmail,
        customerInn,
        transportCompany: order.transportCompany || "cdek",
        vatRate,
        vatMode,
        subjectOverride: `Финальный счёт (50%) — Оптовый предзаказ #${orderId} — BMGBRAND`,
        noteText: `Это финальный счёт на оставшиеся 50% оплаты по предзаказу #${orderId}.`,
        items: items.map((item: any) => ({
          name: `[Финал] ${item.productName || item.name || "Товар"}${item.size && item.size !== "One Size" ? ` (${item.size})` : ""}`,
          sku: item.sku || "",
          quantity: item.quantity || 1,
          price: Math.round((item.price || 0) / 2),
        })),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="final-invoice-${invoiceNum}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      logError("[Wholesale] Download final invoice error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Переключение типа оптового заказа (предзаказ / обычный заказ)
  app.patch("/api/admin/wholesale-orders/:id/type", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = Number(req.params.id);
      const { isPreorder } = req.body;
      if (typeof isPreorder !== "boolean") return res.status(400).json({ error: "isPreorder must be boolean" });
      await storage.updateOrderPreorderFields(id, { isPreorder });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Одноразовая миграция: проставляем isPreorder=true всем оптовым заказам без этого флага
  app.post("/api/admin/wholesale-preorder/migrate-ispreorder", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      // Используем специальный метод без фильтра статуса — иначе awaiting_payment заказы невидимы
      const wholesaleOrders = await storage.getAllWholesaleOrdersIncludingDrafts();
      const toMarkPreorder = wholesaleOrders.filter((o: any) => o.isPreorder !== true);
      const toFixStatus = wholesaleOrders.filter((o: any) => o.status === 'awaiting_payment');
      await Promise.all([
        ...toMarkPreorder.map((o: any) => storage.updateOrderPreorderFields(o.id, { isPreorder: true })),
        ...toFixStatus.map((o: any) => storage.updateOrderStatus(o.id, 'pending')),
      ]);
      res.json({ migrated: toMarkPreorder.length, statusFixed: toFixStatus.length, ids: wholesaleOrders.map((o: any) => o.id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/wholesale-preorder/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const [allOrders, wholesaleUsers] = await Promise.all([
        storage.getOrders(),
        authStorage.getWholesaleUsers(),
      ]);

      const userMap = new Map(wholesaleUsers.map(u => [u.id, u]));
      const emailMap = new Map(wholesaleUsers.map(u => [u.email.toLowerCase(), u]));

      const wholesaleOrders = allOrders
        .filter((o: any) => o.isWholesale && o.status !== 'awaiting_payment')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((o: any) => {
          const wUser = (o.userId && userMap.get(o.userId)) ||
            (o.customerEmail && emailMap.get(o.customerEmail.toLowerCase())) || null;
          const items = typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : (o.items || []);
          return {
            id: o.id,
            createdAt: o.createdAt,
            status: o.status,
            total: o.total,
            items,
            isPreorder: o.isPreorder === true,
            invoiceNumber: o.invoiceNumber || null,
            transportCompany: o.transportCompany || null,
            trackingNumber: o.trackingNumber || null,
            shippingAddress: o.address || null,
            comment: o.comment || null,
            customer: {
              id: wUser?.id || o.userId || null,
              name: wUser?.name || o.customerName || "—",
              email: wUser?.email || o.customerEmail || "—",
              companyName: wUser?.companyName || null,
              contactPerson: wUser?.contactPerson || null,
              contactPhone: wUser?.contactPhone || o.customerPhone || null,
              wholesaleDiscount: wUser?.wholesaleDiscount || 0,
              wholesaleMarkup: wUser?.wholesaleMarkup || 0,
            },
          };
        });

      res.json({ orders: wholesaleOrders, total: wholesaleOrders.length });
    } catch (err: any) {
      logError("[Admin] Get wholesale preorder orders error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

export function registerWholesaleFeedRoutes(
  app: Express,
  authMiddleware: any
) {
  // ==================== Wholesale XML Feed Routes ====================

  // Helper: ensure user is approved wholesaler
  function isApprovedWholesale(user: any): boolean {
    if (!user || user.role !== "wholesale") return false;
    return user.wholesaleApproved === true || user.approved === true;
  }

  // GET selected products + token
  app.get("/api/wholesale/feed-products", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!isApprovedWholesale(user)) {
        return res.status(403).json({ error: "Доступ только для одобренных оптовых покупателей" });
      }
      const [productIds, token] = await Promise.all([
        storage.getWholesaleFeedProductIds(user.id),
        storage.getOrCreateWholesaleFeedToken(user.id),
      ]);
      const baseUrl = process.env.SITE_URL || "https://www.booomerangs.ru";
      res.json({
        productIds,
        token,
        feedUrl: `${baseUrl}/api/wholesale/feed/${token}`,
      });
    } catch (err: any) {
      logError("[WholesaleFeed] get-products error:", err);
      res.status(500).json({ error: "Ошибка получения списка товаров" });
    }
  });

  // POST add product to feed
  app.post("/api/wholesale/feed-products", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!isApprovedWholesale(user)) {
        return res.status(403).json({ error: "Доступ только для одобренных оптовых покупателей" });
      }
      const productId = Number(req.body?.productId);
      if (!Number.isFinite(productId) || productId <= 0) {
        return res.status(400).json({ error: "Некорректный productId" });
      }
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ error: "Товар не найден" });
      await storage.addWholesaleFeedProduct(user.id, productId);
      res.json({ success: true });
    } catch (err: any) {
      logError("[WholesaleFeed] add error:", err);
      res.status(500).json({ error: "Ошибка добавления товара" });
    }
  });

  // DELETE remove product from feed
  app.delete("/api/wholesale/feed-products/:productId", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!isApprovedWholesale(user)) {
        return res.status(403).json({ error: "Доступ только для одобренных оптовых покупателей" });
      }
      const productId = Number(req.params.productId);
      if (!Number.isFinite(productId) || productId <= 0) {
        return res.status(400).json({ error: "Некорректный productId" });
      }
      await storage.removeWholesaleFeedProduct(user.id, productId);
      res.json({ success: true });
    } catch (err: any) {
      logError("[WholesaleFeed] delete error:", err);
      res.status(500).json({ error: "Ошибка удаления товара" });
    }
  });

  // PUBLIC XML feed (YML format — compatible with Bitrix, WooCommerce import plugins, Yandex.Market)
  app.get("/api/wholesale/feed/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "").trim();
      if (!token) return res.status(404).type("text").send("Not found");

      const userId = await storage.getUserIdByWholesaleFeedToken(token);
      if (!userId) return res.status(404).type("text").send("Not found");

      const productIds = await storage.getWholesaleFeedProductIds(userId);
      const allProducts = productIds.length > 0 ? await storage.getProducts() : [];
      const idSet = new Set(productIds);
      const products = allProducts.filter(p => idSet.has(p.id) && !p.isHidden);

      const escape = (s: any): string =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");

      const baseUrl = process.env.SITE_URL || "https://www.booomerangs.ru";
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      // Collect categories
      const categoryMap = new Map<string, string>();
      for (const p of products) {
        if (p.category && !categoryMap.has(p.category)) {
          categoryMap.set(p.category, p.category);
        }
      }

      const categoriesXml = Array.from(categoryMap.entries())
        .map(([slug, name], idx) => `      <category id="${idx + 1}">${escape(name)}</category>`)
        .join("\n");

      const slugToCatId = new Map<string, number>();
      Array.from(categoryMap.keys()).forEach((slug, idx) => slugToCatId.set(slug, idx + 1));

      const offersXml = products.map(p => {
        const priceKopeks = p.price;
        const priceRub = (priceKopeks / 100).toFixed(2);
        const productUrl = p.slug ? `${baseUrl}/${p.slug}` : `${baseUrl}/products`;
        const catId = slugToCatId.get(p.category) || 1;
        const images = Array.isArray(p.images) && p.images.length > 0 ? p.images : [p.imageUrl].filter(Boolean);
        const picturesXml = images
          .filter(Boolean)
          .slice(0, 10)
          .map(url => `      <picture>${escape(url)}</picture>`)
          .join("\n");
        const sizes = Array.isArray(p.sizes) ? p.sizes.filter(Boolean) : [];
        const colors = Array.isArray(p.colors) ? p.colors.filter(Boolean) : [];
        const params: string[] = [];
        if (p.color) params.push(`      <param name="Цвет">${escape(p.color)}</param>`);
        if (sizes.length > 0) params.push(`      <param name="Размеры">${escape(sizes.join(", "))}</param>`);
        if (colors.length > 0 && !p.color) params.push(`      <param name="Цвета">${escape(colors.join(", "))}</param>`);
        if (p.composition) params.push(`      <param name="Состав">${escape(p.composition)}</param>`);
        if (p.careInstructions) params.push(`      <param name="Уход">${escape(p.careInstructions)}</param>`);

        return `    <offer id="${p.id}" available="true">
      <url>${escape(productUrl)}</url>
      <price>${priceRub}</price>
      <currencyId>RUB</currencyId>
      <categoryId>${catId}</categoryId>
${picturesXml}
      <name>${escape(p.name)}</name>${p.sku ? `\n      <vendorCode>${escape(p.sku)}</vendorCode>` : ""}
      <description><![CDATA[${(p.description || "").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></description>
${params.join("\n")}
    </offer>`;
      }).join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${dateStr}">
  <shop>
    <name>BMGBRAND</name>
    <company>BMGBRAND</company>
    <url>${baseUrl}</url>
    <currencies>
      <currency id="RUB" rate="1"/>
    </currencies>
    <categories>
${categoriesXml}
    </categories>
    <offers>
${offersXml}
    </offers>
  </shop>
</yml_catalog>`;

      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=300"); // 5 минут кэш
      res.send(xml);
    } catch (err: any) {
      logError("[WholesaleFeed] xml error:", err);
      res.status(500).type("text").send("Internal error");
    }
  });
}

export function registerWholesaleSlidesRoutes(
  app: Express
) {
  // ==================== Wholesale Preorder Routes ====================

  app.get("/api/wholesale-preorder/slides", async (_req, res) => {
    try {
      const raw = await storage.getBonusSetting("wholesale_slides");
      const slides: string[] = raw ? JSON.parse(raw) : [];
      res.json({ slides });
    } catch (err: any) {
      logError("[WholesalePreorder] Get slides error:", err.message);
      res.status(500).json({ error: "Failed to get slides" });
    }
  });

  app.post("/api/admin/wholesale-preorder/slides", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== process.env.ADMIN_API_KEY) return res.status(403).json({ error: "Forbidden" });
      const { fileData } = req.body;
      if (!fileData) return res.status(400).json({ error: "Missing fileData" });

      const match = fileData.match(/^data:(image\/[a-z]+);base64,/);
      const mimeType = match ? match[1] : "image/jpeg";
      const base64Data = fileData.replace(/^data:image\/[a-z]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const filename = `wholesale_slide_${Date.now()}.${ext}`;
      const url = await uploadToYandexStorage(buffer, `products/${filename}`, mimeType);
      if (!url) return res.status(500).json({ error: "Failed to upload image" });

      const raw = await storage.getBonusSetting("wholesale_slides");
      const slides: string[] = raw ? JSON.parse(raw) : [];
      slides.push(url);
      await storage.setBonusSetting("wholesale_slides", JSON.stringify(slides));
      logInfo(`[Admin] Wholesale slide uploaded: ${url}`);
      res.json({ success: true, url, slides });
    } catch (err: any) {
      logError("[Admin] Upload slide error:", err.message);
      res.status(500).json({ error: "Failed to upload slide" });
    }
  });

  app.delete("/api/admin/wholesale-preorder/slides/:index", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== process.env.ADMIN_API_KEY) return res.status(403).json({ error: "Forbidden" });
      const idx = parseInt(req.params.index);
      const raw = await storage.getBonusSetting("wholesale_slides");
      const slides: string[] = raw ? JSON.parse(raw) : [];
      if (idx < 0 || idx >= slides.length) return res.status(400).json({ error: "Invalid index" });
      slides.splice(idx, 1);
      await storage.setBonusSetting("wholesale_slides", JSON.stringify(slides));
      res.json({ success: true, slides });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete slide" });
    }
  });

  app.put("/api/admin/wholesale-preorder/slides/reorder", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== process.env.ADMIN_API_KEY) return res.status(403).json({ error: "Forbidden" });
      const { slides } = req.body;
      if (!Array.isArray(slides)) return res.status(400).json({ error: "slides must be array" });
      await storage.setBonusSetting("wholesale_slides", JSON.stringify(slides));
      res.json({ success: true, slides });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to reorder slides" });
    }
  });
}

export function registerWholesalePreorderProductsRoutes(
  app: Express
) {
  app.get("/api/wholesale-preorder/products", async (_req, res) => {
    try {
      const products = await storage.getWholesalePreorderProducts();
      res.json(products);
    } catch (err: any) {
      logError("[WholesalePreorder] Get products error:", err.message);
      res.status(500).json({ error: "Failed to get wholesale preorder products" });
    }
  });

  app.post("/api/admin/wholesale-preorder/products/:id/toggle", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const id = Number(req.params.id);
      const { enabled, preorderDeadline, preorderShippingDate, preorderProductionDate, wholesalePreorderSizes, wholesalePreorderRrp, wholesalePreorderPrice, wholesalePrice } = req.body;
      await storage.updateProduct(id, {
        wholesalePreorderEnabled: enabled,
        ...(preorderDeadline !== undefined ? { preorderDeadline } : {}),
        ...(preorderShippingDate !== undefined ? { preorderShippingDate } : {}),
        ...(preorderProductionDate !== undefined ? { preorderProductionDate } : {}),
        ...(wholesalePreorderSizes !== undefined ? { wholesalePreorderSizes } : {}),
        ...(wholesalePreorderRrp !== undefined ? { wholesalePreorderRrp } : {}),
        ...(wholesalePreorderPrice !== undefined ? { wholesalePreorderPrice } : {}),
        ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
      } as any);
      storage.clearProductCache(id);
      res.json({ ok: true });
    } catch (err: any) {
      logError("[WholesalePreorder] Toggle error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

export function registerWholesalePreorderOrderRoute(
  app: Express,
  authMiddleware: any,
  enrichItemsWithProductColor: (items: any[]) => Promise<any[]>
) {
  // ==================== Wholesale Preorder Route ====================

  app.post("/api/wholesale-preorder/order", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Необходима авторизация" });
      if (user.role !== "wholesale") return res.status(403).json({ error: "Доступ только для оптовых покупателей" });

      const isApproved = user.wholesaleApproved === true || user.approved === true;
      if (!isApproved) return res.status(403).json({ error: "Ваш аккаунт ещё не одобрен администратором" });

      const { items, transportCompany, deliveryAddress, comment, customerPhone: phoneOverride, customerEmail: emailOverride } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Список товаров не может быть пустым" });
      }

      for (const item of items) {
        if (!item.productId || !item.size || !item.quantity || item.quantity < 1) {
          return res.status(400).json({ error: "Некорректные данные в списке товаров" });
        }
      }

      const customerName = user.name || user.email || "Оптовый покупатель";
      const customerEmail = (typeof emailOverride === "string" && emailOverride.trim()) ? emailOverride.trim() : (user.email || "");
      const customerPhone = (typeof phoneOverride === "string" && phoneOverride.trim()) ? phoneOverride.trim() : (user.phone || "");

      const total = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

      const productIds = [...new Set(items.map((item: any) => item.productId))];
      const productMap = new Map<number, any>();
      for (const pid of productIds) {
        try {
          const prod = await storage.getProduct(pid);
          if (prod) productMap.set(pid, prod);
        } catch {}
      }

      // Минимум 2 пары на размер для носков в оптовом заказе (категория берётся из БД)
      for (const item of items) {
        const prod = productMap.get(item.productId);
        if (prod?.category === "socks" && item.quantity < 2) {
          return res.status(400).json({ error: `Носки заказываются минимум по 2 пары на размер (${item.productName || prod?.name || "товар"}, размер ${item.size})` });
        }
      }

      const orderItems = items.map((item: any) => {
        const prod = productMap.get(item.productId);
        const sizeCharIds = prod?.sizeCharacteristicIds as Record<string, string> | null | undefined;
        const sizeCharGuid = (item.size && sizeCharIds) ? (sizeCharIds[item.size] || null) : null;
        return {
          productId: item.productId,
          productName: item.productName || prod?.name || "Товар",
          productExternalId: prod?.externalId || String(item.productId),
          sku: item.sku || prod?.sku || "",
          quantity: item.quantity,
          price: item.price,
          size: item.size,
          color: item.color || prod?.color || null,
          sizeCharacteristicId: sizeCharGuid || undefined,
          imageUrl: prod?.thumbnailUrl || (prod?.images && prod.images[0]) || null,
        };
      });

      const sessionId = req.sessionID || `wholesale-preorder-${Date.now()}`;

      const resolvedAddress = deliveryAddress || user.legalAddress || user.storeAddress || "Оптовый предзаказ";

      const order = await storage.createOrder({
        sessionId,
        userId: user.id,
        customerName,
        customerEmail,
        customerPhone,
        address: resolvedAddress,
        total,
        items: orderItems,
        isWholesale: true,
        transportCompany: transportCompany || "cdek",
      });

      // Помечаем как предзаказ и сразу переводим в pending (иначе фильтруется из личного кабинета)
      await storage.updateOrderPreorderFields(order.id, { isPreorder: true });
      await storage.updateOrderStatus(order.id, "pending");

      logInfo(`[Wholesale Preorder] Created order #${order.id} for user ${user.id} (${customerEmail}), total: ${total / 100} ₽`);

      let vatRate = 5;
      let vatMode: 'included' | 'on_top' = 'included';
      try {
        const vatSetting = await storage.getBonusSetting("invoice_vat_rate");
        if (vatSetting) {
          const parsed = parseFloat(vatSetting);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) vatRate = parsed;
        }
        const modeSetting = await storage.getBonusSetting("invoice_vat_mode");
        if (modeSetting === 'on_top' || modeSetting === 'included') vatMode = modeSetting;
      } catch (e) {}

      const preorderInvoiceNum = getNextInvoiceNumber();
      storage.saveOrderInvoiceNumber(order.id, preorderInvoiceNum).catch(err => logError('[Wholesale Preorder] Failed to save invoice number:', err));
      sendInvoiceEmail({
        invoiceNumber: preorderInvoiceNum,
        date: new Date(),
        customerName,
        customerPhone,
        customerEmail,
        customerInn: user.inn || undefined,
        transportCompany: transportCompany || "cdek",
        vatRate,
        vatMode,
        depositPercent: 50,
        subjectOverride: `Счет на предоплату 50% — Оптовый предзаказ #${order.id} — BMGBRAND`,
        noteText: `Спасибо за ваш предзаказ! 🎉<br>Это счёт на <strong>предоплату 50%</strong> от суммы заказа. Оставшиеся 50% выставим перед отгрузкой.${deliveryAddress ? `<br><br><strong>Адрес доставки:</strong> ${deliveryAddress}` : ""}${comment ? `<br><strong>Комментарий:</strong> ${comment}` : ""}`,
        items: orderItems.map((item: any) => ({
          name: `[Предзаказ] ${item.productName}${item.size && item.size !== "One Size" ? ` (${item.size})` : ""}`,
          sku: item.sku || "",
          quantity: item.quantity,
          price: item.price,
        })),
      }).catch(err => logError("[Wholesale Preorder] Failed to send invoice:", err));

      const tgAddress = [
        `[ОПТОВЫЙ ПРЕДЗАКАЗ]`,
        resolvedAddress,
        comment ? `💬 ${comment}` : null,
      ].filter(Boolean).join("\n");

      const itemsForNotify = await enrichItemsWithProductColor(orderItems);
      notifyNewOrder({
        orderId: order.id,
        customerName,
        customerEmail,
        customerPhone,
        address: tgAddress,
        total,
        items: itemsForNotify,
        paymentMethod: "invoice",
        isWholesale: true,
        transportCompany: transportCompany || "cdek",
        companyName: user.companyName || undefined,
        inn: user.inn || undefined,
      });
      vkNotifyNewOrder({
        orderId: order.id,
        customerName,
        customerEmail,
        customerPhone,
        address: tgAddress,
        total,
        items: itemsForNotify,
        paymentMethod: "invoice",
        isWholesale: true,
        transportCompany: transportCompany || "cdek",
        companyName: user.companyName || undefined,
        inn: user.inn || undefined,
      });

      return res.json({ success: true, orderId: order.id });
    } catch (err: any) {
      logError("[Wholesale Preorder] Error:", err.message);
      return res.status(500).json({ error: "Не удалось создать заявку. Попробуйте ещё раз." });
    }
  });
}
