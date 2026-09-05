// ============================================================================
// YCP — Yandex Commerce Protocol («Кнопка „Купить“» / универсальный чекаут)
// ============================================================================
// Яндекс дёргает ЭТИ эндпоинты нашего магазина:
//   GET  {base}/ping      — проверка доступности (публичный)
//   POST {base}/cart      — Яндекс передаёт корзину → мы возвращаем цены/наличие/доставку
//   POST {base}/checkout  — Яндекс оформляет заказ → мы создаём заказ в своей БД
//   POST {base}/status    — отмены/возвраты от Яндекса (статусы заказа)
//
// Аутентификация: заголовок `Authorization: Token <YCP_TOKEN>` (env YCP_TOKEN).
//   • Если YCP_TOKEN задан — запросы без валидного токена отклоняются (401).
//   • Если YCP_TOKEN НЕ задан, а NODE_ENV != production — модуль работает без
//     токена (режим разработки/песочницы). В production без YCP_TOKEN все
//     запросы, кроме ping, отклоняются.
//
// ⚠️ ФОРМАТ ЗАПРОСОВ/ОТВЕТОВ: ниже собран формат по документации YCP. Перед
// тестом в песочнице merchants.yandex.ru сверьте поля со «Справкой» кабинета
// (раздел «Кнопка „Купить“» → «другие решения» → описание API) — все места,
// где маппится тело запроса, вынесены в функции parse*/build* этого файла,
// чтобы правки были точечными. Цены — В КОПЕЙКАХ (целое число), как принято в API Яндекса.
//
// Заказ из YCP создаётся обычным createOrder (та же таблица orders), поэтому
// автоматически попадает в админку, VK/telegram-уведомления и выгрузку в 1С.
// Способ оплаты помечается paymentMethod='yandex'.
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logError, logInfo, logWarn } from "./logger";
import { storage } from "./storage";
import { vkNotifyNewOrder } from "./vk";
import { notifyNewOrder } from "./telegram";

const YCP_BASE = (process.env.YCP_BASE_PATH || "/ycp").replace(/\/+$/, "");
const YCP_TOKEN = (process.env.YCP_TOKEN || "").trim();
// Статус, в который переводится заказ «с кнопки» сразу после создания.
// createOrder всегда пишет 'awaiting_payment' (скрыт из списка заказов), поэтому
// мы сразу переводим заказ в видимый статус — как делают оптовые заказы.
// По умолчанию 'pending' (виден в админке, уходит в 1С); если в песочнице
// окажется, что Яндекс подтверждает оплату до checkout — можно выставить 'paid'
// через env YCP_ORDER_STATUS, без правок кода.
const YCP_ORDER_STATUS = process.env.YCP_ORDER_STATUS || "pending";

// Данные основного склада для GET /api/v1/warehouses (переопределяются env-ом).
const YCP_WAREHOUSE = {
  id: "main",
  title: process.env.YCP_WAREHOUSE_TITLE || "Основной склад BOOOMERANGS",
  address: process.env.YCP_WAREHOUSE_ADDRESS || "Россия",
  phone: process.env.YCP_WAREHOUSE_PHONE || "",
  description: process.env.YCP_WAREHOUSE_DESCRIPTION || "",
  selfPickup: (process.env.YCP_WAREHOUSE_SELF_PICKUP || "").toLowerCase() === "true",
};

let noTokenWarned = false;

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function rur(value: number): { currency: string; value: number } {
  return { currency: "RUR", value: Math.round(Number(value) || 0) };
}

function isoDateOffset(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function pick(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function extractToken(req: Request): string {
  const h =
    req.headers.authorization ||
    (req.headers as any)["x-ycp-token"] ||
    (req.headers as any)["x-yandex-token"] ||
    "";
  return String(h).replace(/^(Token|Bearer)\s+/i, "").trim();
}

function isAuthorized(req: Request): boolean {
  if (!YCP_TOKEN) {
    if (process.env.NODE_ENV === "production") return false;
    if (!noTokenWarned) {
      noTokenWarned = true;
      logWarn(
        "[YCP] YCP_TOKEN не задан. NODE_ENV != production — принимаем запросы БЕЗ токена " +
          "(только для разработки/песочницы). В production без YCP_TOKEN все запросы, кроме ping, будут отклоняться."
      );
    }
    return true;
  }
  const provided = extractToken(req);
  if (!provided) return false;
  const a = Buffer.from(YCP_TOKEN, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireYcpAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthorized(req)) return next();
  res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid or missing YCP token" });
}

/** Ответ об ошибке в формате, понятном Яндексу (код + человекочитаемое сообщение). */
function ycpError(res: Response, status: number, code: string, message: string): void {
  logWarn(`[YCP] ${code}: ${message}`);
  res.status(status).json({ code, message });
}

// ---------------------------------------------------------------------------
// Товары: поиск по offerId (в фиде offer id = числовой id товара), остатки, цена
// ---------------------------------------------------------------------------

async function buildOfferIndex(): Promise<{ byId: Map<string, any>; bySku: Map<string, any> }> {
  const byId = new Map<string, any>();
  const bySku = new Map<string, any>();
  let products: any[] = [];
  try {
    products = (await storage.getProducts()) as any[];
  } catch (e: any) {
    logError("[YCP] storage.getProducts failed:", e?.message);
  }
  for (const p of products) {
    if (!p || p.id === undefined || p.id === null) continue;
    byId.set(String(p.id), p);
    const sku = p.sku || p.article || p.vendorCode;
    if (sku && !bySku.has(String(sku))) bySku.set(String(sku), p);
  }
  return { byId, bySku };
}

async function resolveOffer(offerIdRaw: string | number | undefined): Promise<any | null> {
  const raw = String(offerIdRaw ?? "").trim();
  if (!raw) return null;
  const { byId, bySku } = await buildOfferIndex();
  return byId.get(raw) || bySku.get(raw) || null;
}

function hasStock(p: any): boolean {
  const s = p?.stock;
  if (typeof s === "number") return s > 0;
  if (typeof s === "string") return Number(s) > 0;
  const ss = p?.sizeStock || p?.stockBySize;
  if (ss && typeof ss === "object") {
    const vals = Object.values(ss);
    if (vals.length > 0) return vals.some((v: any) => Number(v) > 0);
  }
  // Нет данных об остатках — считаем доступным (как в YML-фиде: available=true).
  return true;
}

function isSellable(p: any): boolean {
  return !!p && !p.isHidden && !p.artistOnly && Number(p.price) > 0;
}

// ---------------------------------------------------------------------------
// Какие товары можно заказать через Кнопку «Купить» (YCP)
// ---------------------------------------------------------------------------
// YCP не передаёт выбранный размер (оффер без модификаций), поэтому через кнопку
// заказываются ТОЛЬКО товары, где размер выбирать не нужно:
//   • носки (p.category === "socks" или в additionalCategories) — числовые размеры;
//   • товары с флагом noSize (выбор размера скрыт, авто-OneSize);
//   • товары вообще без буквенных размеров (S/M/L/XL...).
// Такие товары исключаются и из YML-фида (кнопка не показывается), и из
// cart/checkout (страховка от устаревшего фида/прямых вызовов).

/** Буквенные размеры одежды, требующие выбора покупателем (регистронезависимо). */
const LETTER_SIZES = new Set(["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "xxxxl"]);

/**
 * Все размеры товара. ВАЖНО: у части товаров поле `sizes` пустое, а размеры
 * лежат в `sizeStock`/`stockBySize` (ключи) — как у брюк «Classic»: sizes=[],
 * sizeStock={XL:5}. Поэтому смотрим оба источника, иначе размерный товар
 * ошибочно считается «безразмерным» и попадает в Кнопку «Купить».
 */
function collectSizes(p: any): string[] {
  const out: string[] = [];
  if (Array.isArray(p?.sizes)) {
    for (const s of p.sizes) {
      if (s !== undefined && s !== null && String(s).trim() !== "") out.push(String(s));
    }
  }
  const ss = p?.sizeStock || p?.stockBySize;
  if (ss && typeof ss === "object") {
    for (const k of Object.keys(ss)) {
      if (k && String(k).trim() !== "") out.push(String(k));
    }
  }
  return out;
}

export function hasLetterSizes(p: any): boolean {
  const sizes = collectSizes(p);
  // Нормализуем значение: убираем скобки/пробелы/дефисы и разбиваем по запятым,
  // чтобы ловить и такие записи из 1С, как "(XS)" или "S, M, L".
  for (const s of sizes) {
    const parts = String(s)
      .split(",")
      .map((x) => x.toLowerCase().replace(/[^a-z]/g, ""))
      .filter(Boolean);
    if (parts.some((v) => LETTER_SIZES.has(v))) return true;
  }
  return false;
}

/** Товар можно заказать через Кнопку «Купить»: носки или товар без выбора буквенного размера. */
export function isYcpBuyable(p: any): boolean {
  if (!p) return false;
  if (p.noSize === true) return true;
  if (p.category === "socks") return true;
  if (Array.isArray(p.additionalCategories)) {
    for (const ac of p.additionalCategories) {
      if (ac && ac.category === "socks") return true;
    }
  }
  return !hasLetterSizes(p);
}

function finalPriceKop(p: any): number {
  return Math.round(Number(p?.price) || 0);
}

function oldPriceKop(p: any): number {
  const d = Number(p?.discountPercent) || 0;
  if (d > 0 && d < 100 && Number(p?.price) > 0) {
    return Math.round(Number(p.price) / (1 - d / 100));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Разбор тела запроса (формат YCP — см. шапку файла)
// ---------------------------------------------------------------------------

interface RequestedItem {
  feedId?: string | number;
  offerId: string;
  count: number;
  deliveryType?: string;
}

/** Достаёт список позиций из body.cart.items (или body.items, как запасной вариант). */
function readItems(body: any): RequestedItem[] {
  const src = body?.cart?.items ?? body?.items;
  if (!Array.isArray(src)) return [];
  const out: RequestedItem[] = [];
  for (const it of src) {
    if (!it) continue;
    const offerId = String(it.offerId ?? it.id ?? "").trim();
    if (!offerId) continue;
    const count = Math.max(1, Math.min(99, Math.floor(Number(it.count) || 1)));
    out.push({
      feedId: it.feedId,
      offerId,
      count,
      deliveryType: it.deliveryType ? String(it.deliveryType) : undefined,
    });
    if (out.length >= 50) break;
  }
  return out;
}

interface ResolvedItem {
  requested: RequestedItem;
  product: any;
  unitPriceKop: number;
}

/** Резолвит позиции в товары БД, проверяя доступность. Кидает Error с code. */
async function resolveItems(requested: RequestedItem[]): Promise<ResolvedItem[]> {
  if (requested.length === 0) {
    const err: any = new Error("Корзина пуста");
    err.ycpCode = "EMPTY_CART";
    err.ycpStatus = 400;
    throw err;
  }
  const resolved: ResolvedItem[] = [];
  for (const item of requested) {
    const product = await resolveOffer(item.offerId);
    if (!product || !isSellable(product)) {
      const err: any = new Error(`Товар ${item.offerId} не найден или недоступен для продажи`);
      err.ycpCode = "UNKNOWN_OFFER";
      err.ycpStatus = 400;
      err.offerId = item.offerId;
      throw err;
    }
    if (!hasStock(product)) {
      const err: any = new Error(`Товар «${product.name}» закончился`);
      err.ycpCode = "OUT_OF_STOCK";
      err.ycpStatus = 400;
      err.offerId = item.offerId;
      throw err;
    }
    if (!isYcpBuyable(product)) {
      // YCP не передаёт размер — товары с буквенными размерами (S/M/L/XL) через
      // Кнопку «Купить» не продаём: покупатель должен выбрать размер на сайте.
      const err: any = new Error(
        `Товар «${product.name}» нельзя заказать через Кнопку «Купить» — выберите размер на сайте`
      );
      err.ycpCode = "SIZE_REQUIRED";
      err.ycpStatus = 400;
      err.offerId = item.offerId;
      throw err;
    }
    resolved.push({
      requested: item,
      product,
      unitPriceKop: finalPriceKop(product),
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Доставка (MVP)
// ---------------------------------------------------------------------------

/**
 * Базовый вариант доставки — зеркалит <delivery-options> из YML-фида
 * (СДЭК, 290 ₽, 3–7 дней). Полноценный расчёт тарифов СДЭК по городу
 * (курьер/ПВЗ) добавим после первого теста в песочнице Яндекса, когда увидим,
 * какие данные о регионе/городе Яндекс реально передаёт в cart.
 */
function buildDeliveryOptions(): Array<Record<string, unknown>> {
  return [
    {
      type: "delivery",
      serviceName: "СДЭК (по России)",
      price: rur(29000),
      dates: { fromDate: isoDateOffset(3), toDate: isoDateOffset(7) },
    },
  ];
}

// ---------------------------------------------------------------------------
// Контакты и адрес покупателя
// ---------------------------------------------------------------------------

function readCustomer(body: any): { name: string; email: string; phone: string } {
  const u = body?.user || body?.customer || {};
  const full =
    pick(u, ["name", "full_name", "fio", "contactName"]) ||
    ([pick(u, ["firstName"]), pick(u, ["lastName"])].filter(Boolean).join(" ") as string) ||
    "Покупатель (Кнопка «Купить», Яндекс)";
  return {
    name: full,
    email: pick(u, ["email"]),
    phone: pick(u, ["phone", "mobilePhone", "mobile"]),
  };
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(", ");
}

function buildAddressText(delivery: any): string {
  if (!delivery || typeof delivery !== "object") return "";
  const p = delivery.pickupPoint;
  if (p) {
    const addr =
      pick(p, ["address", "location", "name", "description"]) ||
      (typeof p === "string" ? p : "");
    return addr ? `ПВЗ: ${addr}` : "";
  }
  const a = delivery.address;
  if (!a) return "";
  if (typeof a === "string") return a.trim();
  return joinParts([
    pick(a, ["postalCode", "postal_code"]),
    pick(a, ["country"]),
    pick(a, ["region", "province", "state"]),
    pick(a, ["city", "locality"]),
    pick(a, ["street"]),
    pick(a, ["house"]),
    pick(a, ["apartment", "flat", "room"]),
  ]);
}

function readDeliveryCost(body: any): number {
  const v = body?.delivery?.price?.value;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function readDeliveryServiceName(body: any): string {
  return pick(body?.delivery, ["serviceName", "service", "type"]) || "СДЭК";
}

// ---------------------------------------------------------------------------
// Создание заказа (общий путь для YCP)
// ---------------------------------------------------------------------------

/**
 * Создаёт заказ в orders через общий storage.createOrder (как розничный/оптовый),
 * помечает paymentMethod='yandex', переводит в видимый статус, сохраняет метаданные
 * в addon_data и шлёт уведомления владельцу (VK + telegram).
 */
async function createYcpOrder(params: {
  items: ResolvedItem[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressText: string;
  deliveryCostKop: number;
  deliveryServiceName: string;
  yandexOrderId: string;
  /** session_id из запроса Яндекса — кладётся в sessionId заказа (идемпотентность). */
  ycpSessionId?: string;
}): Promise<any> {
  const { items, customerName, customerEmail, customerPhone, addressText, deliveryCostKop, yandexOrderId, ycpSessionId } = params;

  const goodsTotal = items.reduce((s, it) => s + it.unitPriceKop * it.requested.count, 0);
  const total = goodsTotal + deliveryCostKop;

  // items в том же виде, что и у обычных заказов (productId/productName/quantity/price/size/color).
  const orderItems: any[] = [];
  let needsSizeConfirmation = false;
  for (const it of items) {
    const p = it.product;
    // YCP не передаёт размер (оффер без модификаций). Если товар требует выбора
    // буквенного размера (такие в checkout не попадают — отклоняются в resolveItems,
    // но страховка не помешает) — помечаем позицию для уточнения с покупателем.
    const needsSize = !isYcpBuyable(p);
    const sizeMarker = needsSize ? "⚠️ уточнить размер" : undefined;
    if (needsSize) needsSizeConfirmation = true;
    orderItems.push({
      productId: p.id,
      productName: p.name || `Товар ${p.id}`,
      quantity: it.requested.count,
      price: it.unitPriceKop,
      size: sizeMarker,
      sku: p.sku || p.article || undefined,
    });
  }

  const order = await storage.createOrder({
    sessionId: ycpSessionId ? `ycp-${ycpSessionId}` : `ycp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    customerName: customerName || "Покупатель (Яндекс)",
    customerEmail: customerEmail || "",
    customerPhone: customerPhone || "",
    address: addressText || "Доставка через Кнопку «Купить» Яндекса (адрес уточняется)",
    total,
    items: orderItems,
    paymentMethod: "yandex",
  });

  // createOrder пишет 'awaiting_payment' (скрыт из списка) — переводим в видимый статус.
  await storage.updateOrderStatus(order.id, YCP_ORDER_STATUS);

  // Метаданные YCP в addon_data (не затираем чужие ключи — до уведомлений их ещё нет,
  // а VK-флаг позже дозапишется своим merge-механизмом).
  try {
    await storage.updateOrderAddonData(
      order.id,
      JSON.stringify({
        source: "yandex-buy-button",
        yandexOrderId: yandexOrderId || "",
        ycpSessionId: ycpSessionId || "",
        needsSizeConfirmation,
        delivery: {
          serviceName: params.deliveryServiceName,
          costKop: deliveryCostKop,
          address: addressText || "",
        },
        receivedAt: new Date().toISOString(),
      })
    );
  } catch (e: any) {
    logError(`[YCP] Failed to save addon_data for order ${order.id}:`, e?.message);
  }

  // Уведомление владельцу — сразу, как для оптовых/полностью оплаченных заказов.
  const notifyItems = orderItems.map((it) => ({
    productName: it.productName,
    quantity: it.quantity,
    price: it.price,
    size: it.size,
    color: it.color,
  }));
  const notifyPayload = {
    orderId: order.id,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    address: order.address,
    total: order.total,
    items: notifyItems,
    paymentMethod: "yandex" as string,
    isWholesale: false,
  };
  try {
    notifyNewOrder(notifyPayload);
  } catch (e: any) {
    logError(`[YCP] telegram notify failed for order ${order.id}:`, e?.message);
  }
  vkNotifyNewOrder(notifyPayload).catch((e: any) => {
    logError(`[YCP] VK notify failed for order ${order.id}:`, e?.message);
  });

  logInfo(
    `[YCP] Order ${order.id} created (total ${total / 100} ₽, ${orderItems.length} items, ` +
      `yandexOrderId=${yandexOrderId || "-"})${needsSizeConfirmation ? " — ТРЕБУЕТ УТОЧНЕНИЯ РАЗМЕРА" : ""}`
  );

  return { order, goodsTotal, orderItems, needsSizeConfirmation };
}

// ---------------------------------------------------------------------------
// YCP v1 — методы, которые реально вызывает кабинет checkout.merchants.yandex.ru
// ---------------------------------------------------------------------------
// Кабинет ходит на «URL для API» из настроек + /api/v1/<метод>. Форматы собраны
// по справке YCP и рабочей интеграции WooCommerce (perfinn/YCP-Yandex-Commerce-
// Woocommerce), прошедшей проверку с кабинетом Яндекса. Цены — в РУБЛЯХ целыми,
// габариты — в мм, вес — в граммах.

function handleV1Warehouses(_req: Request, res: Response): void {
  res.json({
    warehouses: [
      {
        id: YCP_WAREHOUSE.id,
        title: YCP_WAREHOUSE.title,
        address: YCP_WAREHOUSE.address,
        phone: YCP_WAREHOUSE.phone,
        description: YCP_WAREHOUSE.description,
        self_pickup_options: { enabled: YCP_WAREHOUSE.selfPickup },
      },
    ],
    total_count: 1,
  });
}

function stockNumber(p: any): number {
  const direct = Number(p?.stock);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const ss = p?.sizeStock || p?.stockBySize;
  if (ss && typeof ss === "object") {
    const vals = Object.values(ss);
    if (vals.length > 0) return vals.reduce((s: number, v: any) => s + (Number(v) || 0), 0);
  }
  return 0;
}

async function handleV1BasketCheck(req: Request, res: Response): Promise<void> {
  const itemsIn = Array.isArray(req.body?.items) ? req.body.items : [];
  const outItems: any[] = [];
  for (const it of itemsIn) {
    const id = String(it?.id ?? it?.offerId ?? "").trim();
    if (!id) continue;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it?.quantity) || 1)));
    const p = await resolveOffer(id);
    const entry: any = {
      id,
      name: "",
      regular_price: 0,
      final_price: 0,
      warehouses: [{ id: YCP_WAREHOUSE.id, available_quantity: 0 }],
      // Габариты по умолчанию (коробка), как в референс-интеграции: 32×22×13 см, 850 г.
      width: 320,
      height: 130,
      depth: 220,
      weight: 850,
      characteristics: [],
      variations: [],
    };
    if (p && isSellable(p) && isYcpBuyable(p)) {
      const stock = stockNumber(p);
      const final = Math.round(finalPriceKop(p) / 100);
      const old = Math.round(oldPriceKop(p) / 100);
      entry.name = String(p.name || "");
      entry.regular_price = old > final ? old : final;
      entry.final_price = final;
      entry.warehouses = [
        { id: YCP_WAREHOUSE.id, available_quantity: Math.max(0, stock > 0 ? stock : (hasStock(p) ? qty : 0)) },
      ];
      const img = (Array.isArray(p.images) && p.images[0]) || p.imageUrl || p.image;
      if (img) entry.image = String(img);
      const base = (process.env.SITE_URL || "https://booomerangs.ru").replace(/\/+$/, "");
      entry.url = `${base}/${p.slug || p.id}`;
    }
    outItems.push(entry);
  }
  res.json({ items: outItems });
}

function handleV1DeliveryOptions(req: Request, res: Response): void {
  const method = String(req.body?.delivery_method || "courier");
  const options: any[] = [];
  if (method === "pickup_point") {
    options.push({
      id: "pickup-default",
      cost: 0,
      delivery_date_interval: {
        date_from: isoDateOffset(1),
        date_to: isoDateOffset(2),
        time_zone: 3,
      },
    });
  } else {
    options.push({
      id: "courier-standard",
      cost: 290,
      delivery_date_interval: {
        date_from: isoDateOffset(3),
        date_to: isoDateOffset(7),
        time_from: "10:00",
        time_to: "22:00",
        time_zone: 3,
      },
    });
  }
  res.json({ delivery_options: options });
}

function handleV1PickupPoints(_req: Request, res: Response): void {
  // Своих ПВЗ нет — Яндекс предложит свои точки выдачи.
  res.json({ pickup_points: [], total_count: 0 });
}

async function handleV1CheckoutCreate(req: Request, res: Response): Promise<void> {
  const body = req.body || {};
  const sessionId = String(body.session_id || "").trim();
  if (!sessionId) {
    ycpError(res, 400, "SESSION_REQUIRED", "session_id обязателен");
    return;
  }
  // Идемпотентность: Яндекс шлёт checkout минимум один раз (at-least-once),
  // при повторе с тем же session_id возвращаем уже созданный заказ.
  const existing = await storage.getOrderBySessionId(`ycp-${sessionId}`);
  if (existing) {
    res.status(201).json({ order_number: String(existing.id) });
    return;
  }
  const itemsIn = Array.isArray(body.items) ? body.items : [];
  const requested: RequestedItem[] = itemsIn
    .map((it: any) => ({
      offerId: String(it?.id ?? it?.offerId ?? "").trim(),
      count: Math.max(1, Math.min(99, Math.floor(Number(it?.quantity) || 1))),
    }))
    .filter((i: { offerId: string }) => i.offerId);
  const resolved = await resolveItems(requested);
  const customer = readCustomer(body);
  const delivery = (body.delivery && typeof body.delivery === "object" ? body.delivery : {}) as any;
  const addr = delivery.address && typeof delivery.address === "object" ? delivery.address : {};
  const addressText =
    joinParts([pick(addr, ["locality", "city"]), pick(addr, ["address", "street", "house"])]) ||
    buildAddressText(delivery);
  const deliveryCostKop = Math.round((Number(delivery.cost) || 0) * 100);
  const { order } = await createYcpOrder({
    items: resolved,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    addressText,
    deliveryCostKop,
    deliveryServiceName: String(delivery.delivery_method || "courier"),
    yandexOrderId: String(body.order_id || ""),
    ycpSessionId: sessionId,
  });
  res.status(201).json({ order_number: String(order.id) });
}

async function handleV1CheckoutPlaced(req: Request, res: Response): Promise<void> {
  const body = req.body || {};
  const sessionId = String(body.session_id || "").trim();
  const order = await storage.getOrderBySessionId(`ycp-${sessionId}`);
  if (!order) {
    ycpError(res, 404, "ORDER_NOT_FOUND", "Заказ по session_id не найден");
    return;
  }
  const payMethod = String(body.payment_method || "online");
  const yandexOrderId = String(body.order_id || "");
  // Онлайн-оплата (Яндекс Пэй и т.п.) → сразу paid; постоплата/COD → processing.
  await storage.updateOrderStatus(order.id, payMethod === "online" ? "paid" : "processing");
  try {
    const prevRaw = order.addonData;
    let prev: any = {};
    if (prevRaw) {
      try {
        const parsed = JSON.parse(prevRaw);
        if (parsed && typeof parsed === "object") prev = parsed;
      } catch { /* ignore */ }
    }
    await storage.updateOrderAddonData(
      order.id,
      JSON.stringify({ ...prev, yandexOrderId, paymentMethod: payMethod, placedAt: new Date().toISOString() })
    );
  } catch (e: any) {
    logError(`[YCP] Failed to save placed addon_data for order ${order.id}:`, e?.message);
  }
  res.json({ status: "ok" });
}

async function handleV1CheckoutCancel(req: Request, res: Response): Promise<void> {
  const sessionId = String(req.body?.session_id || "").trim();
  const order = await storage.getOrderBySessionId(`ycp-${sessionId}`);
  if (!order) {
    ycpError(res, 404, "ORDER_NOT_FOUND", "Заказ по session_id не найден");
    return;
  }
  await storage.updateOrderStatus(order.id, "cancelled");
  res.json({ status: "ok" });
}

function orderStatusTs(iso?: string | number | Date | null): number {
  const d = new Date((iso as any) || Date.now());
  const t = d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

async function handleV1OrderGet(req: Request, res: Response): Promise<void> {
  const raw = String(req.query?.order_id ?? req.query?.id ?? "").trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    ycpError(res, 400, "ORDER_NOT_FOUND", "order_id обязателен");
    return;
  }
  const order = await storage.getOrder(id);
  if (!order) {
    ycpError(res, 404, "ORDER_NOT_FOUND", `Заказ ${id} не найден`);
    return;
  }
  const items = (Array.isArray(order.items) ? order.items : []).map((it: any) => ({
    id: String(it.productId ?? ""),
    quantity: Number(it.quantity) || 1,
    refused_quantity: 0,
  }));
  const createdTs = orderStatusTs(order.createdAt as any);
  const statuses: any[] = [{ status: "new", datetime: createdTs }];
  const st = order.status;
  if (st === "cancelled") {
    statuses.push({ status: "cancelled", datetime: createdTs });
  } else if (st === "delivered" || st === "ready_for_pickup") {
    statuses.push({ status: "in_progress", datetime: createdTs });
    statuses.push({ status: "delivered", datetime: createdTs });
  } else if (st === "paid" || st === "processing" || st === "shipped") {
    statuses.push({ status: "in_progress", datetime: createdTs });
  }
  res.json({ items, delivery_statuses: statuses });
}

async function handleV1OrderCancel(req: Request, res: Response): Promise<void> {
  const raw = String(req.body?.order_id ?? req.query?.order_id ?? "").trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    ycpError(res, 400, "ORDER_NOT_FOUND", "order_id обязателен");
    return;
  }
  const order = await storage.getOrder(id);
  if (!order) {
    ycpError(res, 404, "ORDER_NOT_FOUND", `Заказ ${id} не найден`);
    return;
  }
  await storage.updateOrderStatus(id, "cancelled");
  res.json({ status: "ok" });
}

async function handleV1OrderDelivered(req: Request, res: Response): Promise<void> {
  const raw = String(req.body?.order_id ?? req.query?.order_id ?? "").trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    ycpError(res, 400, "ORDER_NOT_FOUND", "order_id обязателен");
    return;
  }
  const order = await storage.getOrder(id);
  if (!order) {
    ycpError(res, 404, "ORDER_NOT_FOUND", `Заказ ${id} не найден`);
    return;
  }
  await storage.updateOrderStatus(id, "delivered");
  res.json({ status: "ok" });
}

// ---------------------------------------------------------------------------
// Маршруты
// ---------------------------------------------------------------------------

export function registerYcpRoutes(app: Express): void {
  logInfo(`[YCP] Routes mounted at ${YCP_BASE}/* (token ${YCP_TOKEN ? "set" : "NOT SET"})`);

  // --- ping: проверка доступности (публичный) ---
  const pingHandler = (_req: Request, res: Response): void => {
    res.json({ status: "ok", service: "booomerangs-ycp" });
  };
  app.get(`${YCP_BASE}/ping`, pingHandler);
  app.post(`${YCP_BASE}/ping`, pingHandler);

  // --- cart: актуальные цены, наличие, доставка ---
  app.post(`${YCP_BASE}/cart`, requireYcpAuth, async (req: Request, res: Response) => {
    try {
      logInfo(`[YCP] /cart request: ${JSON.stringify(req.body).slice(0, 4000)}`);
      const items = readItems(req.body);
      const resolved = await resolveItems(items);

      const cartItems: any[] = [];
      let goodsTotal = 0;
      for (const it of resolved) {
        const p = it.product;
        const itemOut: any = {
          offerId: String(p.id),
          count: it.requested.count,
          price: rur(it.unitPriceKop),
          delivery: true,
        };
        if (it.requested.feedId !== undefined && it.requested.feedId !== null) {
          itemOut.feedId = Number(it.requested.feedId) || 0;
        }
        const old = oldPriceKop(p);
        if (old > 0) itemOut.oldprice = rur(old);
        cartItems.push(itemOut);
        goodsTotal += it.unitPriceKop * it.requested.count;
      }

      res.json({
        cart: {
          items: cartItems,
          deliveryOptions: buildDeliveryOptions(),
          total: rur(goodsTotal),
        },
      });
    } catch (e: any) {
      const status = e.ycpStatus || 500;
      const code = e.ycpCode || "INTERNAL_ERROR";
      ycpError(res, status, code, e?.message || String(e));
    }
  });

  // --- checkout: Яндекс оформляет заказ → создаём заказ в своей БД ---
  app.post(`${YCP_BASE}/checkout`, requireYcpAuth, async (req: Request, res: Response) => {
    try {
      logInfo(`[YCP] /checkout request: ${JSON.stringify(req.body).slice(0, 6000)}`);
      const items = readItems(req.body);
      const resolved = await resolveItems(items);
      const customer = readCustomer(req.body);
      const addressText = buildAddressText(req.body?.delivery);
      const deliveryCostKop = readDeliveryCost(req.body);
      const deliveryServiceName = readDeliveryServiceName(req.body);
      const yandexOrderId = pick(req.body, ["orderId", "yandexOrderId"]) || "";

      const { order, goodsTotal, orderItems } = await createYcpOrder({
        items: resolved,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        addressText,
        deliveryCostKop,
        deliveryServiceName,
        yandexOrderId,
      });

      // Ответ: наш id заказа + итог (в копейках). Яндекс покажет его покупателю.
      res.json({
        order: {
          id: String(order.id),
          status: "ACCEPTED",
          accepted: true,
          total: rur(order.total),
          items: orderItems.map((it: any) => ({
            offerId: String(it.productId),
            count: it.quantity,
            price: rur(it.price),
          })),
        },
        currency: "RUR",
        goodsTotal: rur(goodsTotal),
        deliveryCost: rur(deliveryCostKop),
      });
    } catch (e: any) {
      const status = e.ycpStatus || 500;
      const code = e.ycpCode || "INTERNAL_ERROR";
      ycpError(res, status, code, e?.message || String(e));
    }
  });

  // --- status: отмены/возвраты (Яндекс → магазин) ---
  // Формат уточняется в песочнице; обработчик толерантен к вариантам тела:
  // {order:{id,status}}, {orderId, status}, {id, status}.
  app.post(`${YCP_BASE}/status`, requireYcpAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const srcOrder = body.order && typeof body.order === "object" ? body.order : body;
      const rawStatus = String(srcOrder.status || body.status || "").toUpperCase();
      const ourIdRaw = srcOrder.id ?? body.orderId ?? body.id ?? null;
      const yandexIdRaw = pick(body, ["yandexOrderId"]) || pick(srcOrder, ["yandexOrderId"]) || "";

      let ourOrderId: number | null = null;
      if (ourIdRaw !== null && ourIdRaw !== undefined && ourIdRaw !== "") {
        const n = Number(ourIdRaw);
        if (Number.isInteger(n) && n > 0) {
          const found = await storage.getOrder(n);
          if (found) ourOrderId = n;
        }
      }

      if (ourOrderId === null) {
        logWarn(`[YCP] /status: не нашли наш заказ по ${ourIdRaw ?? "-"} / yandexId=${yandexIdRaw || "-"} (status=${rawStatus})`);
        return res.status(404).json({ code: "ORDER_NOT_FOUND", message: `Order not found: ${ourIdRaw ?? ""}` });
      }

      const CANCELLED = new Set(["CANCELLED", "CANCELED", "CANCELLED_BY_USER", "REFUNDED", "REFUND", "RETURNED"]);
      if (CANCELLED.has(rawStatus)) {
        await storage.updateOrderStatus(ourOrderId, "cancelled");
        logInfo(`[YCP] Order ${ourOrderId} cancelled/refunded by Yandex (${rawStatus})`);
      } else {
        logInfo(`[YCP] Order ${ourOrderId}: статус ${rawStatus || "(пусто)"} — обрабатывается как есть (без изменений)`);
      }
      res.json({ ok: true, orderId: String(ourOrderId) });
    } catch (e: any) {
      ycpError(res, 500, "INTERNAL_ERROR", e?.message || String(e));
    }
  });

  // --- YCP v1: кабинет checkout.merchants.yandex.ru ходит на {URL}/api/v1/<метод> ---
  // URL в кабинете может быть с /ycp (→ /ycp/api/v1/*) или без (→ /api/v1/*) —
  // регистрируем оба набора. Методы v1 НЕ дублируются на {YCP_BASE}/checkout,
  // чтобы не конфликтовать со старым POST {YCP_BASE}/checkout.
  // Async-обёртка: ошибки v1-хендлеров (resolveItems кидает 400 SIZE_REQUIRED /
  // OUT_OF_STOCK / UNKNOWN_OFFER и т.п.) должны вернуться Яндексу как JSON,
  // а не уронить запрос в таймаут.
  const wrapV1 =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (e: any) {
        const status = e?.ycpStatus || 500;
        const code = e?.ycpCode || "INTERNAL_ERROR";
        ycpError(res, status, code, e?.message || String(e));
      }
    };

  const mountV1 = (base: string): void => {
    const p = (a: string) => `${base}/${a}`;
    app.all(p("warehouses"), requireYcpAuth, handleV1Warehouses);
    app.all(p("checkout/basket/check"), requireYcpAuth, wrapV1(handleV1BasketCheck));
    app.all(p("checkout/delivery/options"), requireYcpAuth, handleV1DeliveryOptions);
    app.all(p("checkout/delivery/pickup_points"), requireYcpAuth, handleV1PickupPoints);
    app.all(p("checkout"), requireYcpAuth, wrapV1(handleV1CheckoutCreate));
    app.all(p("checkout/placed"), requireYcpAuth, wrapV1(handleV1CheckoutPlaced));
    app.all(p("checkout/cancel"), requireYcpAuth, wrapV1(handleV1CheckoutCancel));
    app.all(p("order"), requireYcpAuth, wrapV1(handleV1OrderGet));
    app.all(p("order/cancel"), requireYcpAuth, wrapV1(handleV1OrderCancel));
    app.all(p("order/delivered"), requireYcpAuth, wrapV1(handleV1OrderDelivered));
  };
  mountV1(`${YCP_BASE}/api/v1`);
  mountV1(`/api/v1`);

  // Healthcheck на корне «URL для API» и на /ping (публичный, как GET {base}/ping).
  const healthHandler = (_req: Request, res: Response): void => {
    res.json({ status: "ok", service: "booomerangs-ycp", version: "1.0.0", time: new Date().toISOString() });
  };
  app.all(`${YCP_BASE}/`, healthHandler);
  app.all(`${YCP_BASE}/healthcheck`, healthHandler);
  app.all(`/ping`, healthHandler);
  app.all(`/healthcheck`, healthHandler);
}
