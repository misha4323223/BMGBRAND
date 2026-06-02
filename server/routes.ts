import type { Express } from "express";
import type { Server } from "http";
import { storage, warmRatingsCache } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import express from "express";
import path from "path";
import fs from "fs";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { uploadToYandexStorage, downloadFromYandexStorage, listObjectsFromYandexStorage, downloadBinaryFromYandexStorage, deleteFromYandexStorage, checkFileExistsInYandexStorage } from "./lib/storage-s3";
import sharp from "sharp";
import { mapProductCategory, isOnSale, extractColorFromName, extractSizesFromName, mapGroupHierarchyToCategory, isIgnoredRootGroup, isAllowedRootGroup, getRootGroupCategorySlug, getArtistSlugFromName, type GroupHierarchy } from "./categoryMapper";
import { CATEGORIES, normalizeCategories, transliterateToSlug, insertPromoCodeSchema, insertLoyaltyTierSchema, insertNewsletterSubscriptionSchema, insertBonusSettingSchema, PARTNER_COOKIE_NAME, PARTNER_DEFAULT_COMMISSION_PERCENT, getProgressiveCommissionRate } from "@shared/schema";
import type { SubcategoryConfig, CategoryConfig } from "@shared/schema";
import authRoutes, { authMiddleware, requireAdminRole, type AuthRequest } from "./auth-routes";
import partnerRoutes, { partnerRefQueryMiddleware, partnerRefRedirectHandler, getApprovedPartnerCached, getGlobalPartnerCommissionPercentCached, getGlobalPartnerHoldDaysCached } from "./partner-routes";
import adminPartnerRoutes from "./admin-partner-routes";
import { authStorage } from "./auth-storage";
import { paymentService } from "./payments";
import { ozonPayService } from "./ozon-pay";
import { ozonDeliveryOAuth, OZON_OAUTH_KEYS, OZON_OAUTH_REDIRECT_URI } from "./ozon-delivery-oauth";
import { cdekService, CDEK_SENDER_CITY_CODE, CDEK_SENDER_ADDRESS, CDEK_SENDER_PVZ_CODE, CDEK_DEFAULT_PACKAGE, CDEK_TARIFFS, isTariffToDoor, isTariffFromPvz } from "./cdek";
import { yandexDeliveryService } from "./yandex-delivery";
import { sendInvoiceEmail, getNextInvoiceNumber, generateInvoicePDF } from "./invoice";
import { sendEmail, getGiftCardPaidEmailHtml, getGiftCardReceivedEmailHtml, getOrderPaidEmailHtml, getOrderShippedEmailHtml, getPreorderDepositEmailHtml, getPreorderDepositPaidEmailHtml, getPreorderRemainingPaidEmailHtml, getPreorderStatusEmailHtml, getStockNotificationEmailHtml, sendPriceDropEmail, sendPreorderNotifications } from "./email";
import { waitForDriver } from "./db";
import { sendOrderToBitrix, syncOrderStatusToBitrix } from "./bitrix24";
import { notifyNewOrder, notifyPreorderDeposit, notifyPreorderGoalReached, notifyPreorderStatusChange, registerWholesaleWebhook, sendChatNotification, registerChatWebhook, notifyNewReview, notifyMerchOrder, answerCallbackQuery, editMessageText } from "./telegram";
import { vkNotifyNewOrder, vkNotifyPreorderDeposit, vkNotifyPreorderGoalReached, vkNotifyPreorderStatusChange, vkNotifyNewReview, vkNotifyMerchOrder, verifyActionLink } from "./vk";

// ==================== Admin Auth ====================
const rateLimitMap = new Map<string, { attempts: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

let is1CSyncEnabled = true;
let lastExportedOrderIds: number[] = [];

function getAdminKey(): string | undefined {
  return process.env.ADMIN_API_KEY || process.env.SYNC_API_KEY;
}

// Подставляет реальный product.color вместо пустого/"Default" в items заказа,
// чтобы Telegram/VK уведомления показывали настоящий цвет товара.
// Не мутирует исходный массив.
async function enrichItemsWithProductColor(items: any[]): Promise<any[]> {
  if (!Array.isArray(items)) return items;
  return Promise.all(items.map(async (it) => {
    if (!it || it._discountDetails) return it;
    const current = String(it.color || "").trim();
    if (current && current.toLowerCase() !== "default") return it;
    const pid = Number(it.productId);
    if (!pid) return it;
    try {
      const product = await storage.getProduct(pid);
      const productColor = product?.color?.trim();
      if (productColor && productColor.toLowerCase() !== "default") {
        return { ...it, color: productColor };
      }
    } catch (err: any) {
      console.warn(`[Notify] enrich color: failed to load product ${pid}:`, err?.message);
    }
    return it;
  }));
}

function getSyncKey(): string | undefined {
  return process.env.SYNC_API_KEY;
}

function checkAdminKey(key: string | undefined): boolean {
  const adminKey = getAdminKey();
  if (!adminKey) return false;
  return key === adminKey;
}

function adminAuthMiddleware(req: AuthRequest, res: any, next: any) {
  const apiKey = req.headers["x-api-key"] || req.query.key;
  if (!checkAdminKey(apiKey as string)) {
    return res.status(403).json({ error: "Forbidden: Invalid API key" });
  }
  if (!req.user) {
    return res.status(401).json({ error: "Требуется авторизация. Войдите в аккаунт администратора." });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "Требуются права администратора" });
  }
  next();
}

// Cache for Object Storage files (set of existing file keys in products/ folder)
let existingFilesCache: Set<string> = new Set();
let existingFilesCacheTime: number = 0;
const CACHE_TTL = 60000; // 1 minute cache TTL

// In-memory storage for order paymentIds (orderId -> paymentId)
const orderPaymentIds: Map<string, string> = new Map();

// Cache for /api/subscription-promos.
// The endpoint hits YDB ~12 times (11x getBonusSetting + 1x getPromoCodes) on
// every call, while the underlying data changes maybe once a week. The popup
// is shown to every visitor on the homepage, so without a cache one hot
// landing page = N×12 YDB queries. TTL 5 min is plenty; admin updates call
// invalidateSubscriptionPromosCache() to drop the cache instantly.
let subscriptionPromosCache: { data: any; expires: number } | null = null;
const SUBSCRIPTION_PROMOS_TTL_MS = 5 * 60 * 1000;
function invalidateSubscriptionPromosCache() {
  subscriptionPromosCache = null;
}

const CDEK_ITEM_WEIGHT_GRAMS = 300;

const cdekWaybillLocks = new Set<number>();

async function createCdekWaybillForOrder(orderId: number): Promise<{ success: boolean; uuid?: string; error?: string }> {
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
    
    let cdekInfo: { pointCode?: string; cityCode?: number; tariffCode?: number; orderUuid?: string; status?: string; error?: string; doorAddress?: { street?: string; house?: string; flat?: string; entrance?: string; floor?: string } } = {};
    console.log(`[CDEK Waybill] Order #${orderId} raw cdekData: ${order.cdekData}`);
    if (order.cdekData) {
      try {
        cdekInfo = JSON.parse(order.cdekData);
      } catch { }
    }
    console.log(`[CDEK Waybill] Order #${orderId} parsed cdekInfo: pointCode=${cdekInfo.pointCode}, cityCode=${cdekInfo.cityCode}, tariffCode=${cdekInfo.tariffCode}`);
    
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
    
    console.log(`[CDEK Waybill] Order #${orderId}: tariff=${tariffCode}, toDoor=${deliveryToDoor}, fromPvz=${senderFromPvz}, pointCode=${cdekInfo.pointCode || 'none'}, cityCode=${cdekInfo.cityCode || 'none'}`);
    
    const senderPhone = process.env.STORE_PHONE || "+79000000000";
    const senderName = process.env.STORE_NAME || "BOOOMERANGS";
    
    const orderItems = (order.items || []).filter((item: any) => !item._discountDetails).map((item: any, idx: number) => ({
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
      packages: [{
        number: `ORDER-${orderId}`,
        weight: totalWeight || CDEK_DEFAULT_PACKAGE.weight,
        length: CDEK_DEFAULT_PACKAGE.length,
        width: CDEK_DEFAULT_PACKAGE.width,
        height: CDEK_DEFAULT_PACKAGE.height,
        items: orderItems,
      }],
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
          address: addressParts.join(', '),
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
    } catch { }
    console.error(`[CDEK Waybill] Error creating waybill for order #${orderId}:`, error.message);
    return { success: false, error: error.message };
  } finally {
    cdekWaybillLocks.delete(orderId);
  }
}

const ydWaybillLocks = new Set<number>();

async function createYandexDeliveryForOrder(orderId: number): Promise<{ success: boolean; requestId?: string; error?: string }> {
  if (ydWaybillLocks.has(orderId)) {
    console.log(`[YD Waybill] Order #${orderId} already being processed, skipping`);
    return { success: false, error: "Already processing" };
  }
  ydWaybillLocks.add(orderId);

  try {
    const order = await storage.getOrder(orderId);
    if (!order) return { success: false, error: "Order not found" };

    if (order.isWholesale) {
      console.log(`[YD Waybill] Skipping wholesale order #${orderId}`);
      return { success: false, error: "Wholesale order" };
    }

    let ydInfo: any = {};
    if (order.cdekData) {
      try { ydInfo = JSON.parse(order.cdekData); } catch {}
    }

    if (ydInfo.deliveryService !== "yandex" || !ydInfo.ydPointId) {
      console.log(`[YD Waybill] Order #${orderId} is not a Yandex delivery order, skipping`);
      return { success: false, error: "Not a Yandex delivery order" };
    }

    if (ydInfo.ydRequestId) {
      console.log(`[YD Waybill] Order #${orderId} already has Yandex request: ${ydInfo.ydRequestId}`);
      return { success: true, requestId: ydInfo.ydRequestId };
    }

    if (ydInfo.ydStatus === "creating") {
      console.log(`[YD Waybill] Order #${orderId} Yandex request already being created, skipping`);
      return { success: false, error: "Already creating" };
    }

    ydInfo.ydStatus = "creating";
    await storage.updateOrderCdekData(orderId, JSON.stringify(ydInfo));

    const rawItems = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
    const items = (Array.isArray(rawItems) ? rawItems : [])
      .filter((item: any) => !item._discountDetails)
      .map((item: any) => ({
        name: item.productName || "Товар",
        article: item.sku || String(item.productId || ""),
        count: item.quantity || 1,
        unitPrice: item.price || 0,
        weight: 300,
      }));

    if (items.length === 0) {
      ydInfo.ydStatus = "error";
      ydInfo.ydError = "No items in order";
      await storage.updateOrderCdekData(orderId, JSON.stringify(ydInfo));
      return { success: false, error: "No items" };
    }

    const operatorRequestId = `${orderId}-${Date.now()}`;
    console.log(`[YD Waybill] Creating request for order #${orderId}, point: ${ydInfo.ydPointId}, operatorId: ${operatorRequestId}`);
    const requestResult = await yandexDeliveryService.createRequest({
      operatorRequestId,
      destinationStationId: ydInfo.ydPointId,
      items,
      recipientName: order.customerName,
      recipientPhone: order.customerPhone,
      recipientEmail: order.customerEmail || "",
      comment: `Заказ #${orderId}`,
    });

    const requestId = requestResult?.request_id || requestResult?.id || null;
    if (!requestId) {
      ydInfo.ydStatus = "error";
      ydInfo.ydError = `No request_id in response: ${JSON.stringify(requestResult).slice(0, 200)}`;
      await storage.updateOrderCdekData(orderId, JSON.stringify(ydInfo));
      return { success: false, error: "No request_id" };
    }

    ydInfo.ydRequestId = requestId;
    ydInfo.ydStatus = "created";
    delete ydInfo.ydError;
    await storage.updateOrderCdekData(orderId, JSON.stringify(ydInfo));

    console.log(`[YD Waybill] Created for order #${orderId}: requestId=${requestId}`);
    return { success: true, requestId };

  } catch (error: any) {
    try {
      const order = await storage.getOrder(orderId);
      if (order?.cdekData) {
        const info = JSON.parse(order.cdekData);
        info.ydStatus = "error";
        info.ydError = error.message;
        await storage.updateOrderCdekData(orderId, JSON.stringify(info));
      }
    } catch {}
    console.error(`[YD Waybill] Error for order #${orderId}:`, error.message);
    return { success: false, error: error.message };
  } finally {
    ydWaybillLocks.delete(orderId);
  }
}

// Throttle helper to prevent YDB RESOURCE_EXHAUSTED errors during bulk imports
const THROTTLE_DELAY_MS = 600; // 600ms delay between DB write operations for YDB stability
const THROTTLE_DELAY_BULK_MS = 400; // 400ms delay for bulk operations (YDB Serverless 1000 RU/s limit)
const throttle = () => new Promise(resolve => setTimeout(resolve, THROTTLE_DELAY_MS));
const throttleBulk = () => new Promise(resolve => setTimeout(resolve, THROTTLE_DELAY_BULK_MS));

// Standard size order for sorting (from smallest to largest)
const SIZE_ORDER: Record<string, number> = {
  '3XS': 1, 'XXS': 2, 'XS': 3, 'S': 4, 'M': 5, 'L': 6, 'XL': 7, 'XXL': 8, 'XXXL': 9, '3XL': 9, '4XL': 10
};

// Sort sizes in logical order
function sortSizes(sizes: string[]): string[] {
  return sizes.sort((a, b) => {
    const orderA = SIZE_ORDER[a.toUpperCase()] ?? 100;
    const orderB = SIZE_ORDER[b.toUpperCase()] ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
}

// Normalize size key for comparison (remove spaces and parentheses, lowercase)
function normalizeSizeKey(s: string): string {
  return s.replace(/[\s()]/g, '').toLowerCase();
}

// Canonicalize size key for storage — converts all "one size" variants to "OneSize"
function canonicalizeSizeKey(s: string): string {
  if (!s) return s;
  const norm = normalizeSizeKey(s);
  if (norm === 'onesize' || norm === 'one') return 'OneSize';
  return s;
}

// Resolve available stock for a given size string from sizeStock map.
// Handles legacy key variants like "One Size", "(OneSize)", "OneSize" by normalizing.
// Returns the maximum stock found among all keys that normalize to the same form.
// Returns undefined if no matching key found (caller should fallback to product.stock).
function resolveSizeStock(sizeStock: Record<string, number>, size: string): number | undefined {
  if (sizeStock[size] !== undefined) {
    // Exact match found — but still check if a normalized match has higher stock
    const norm = normalizeSizeKey(size);
    const matches = Object.entries(sizeStock).filter(([k]) => normalizeSizeKey(k) === norm);
    if (matches.length > 1) {
      return Math.max(...matches.map(([, v]) => v));
    }
    return sizeStock[size];
  }
  const norm = normalizeSizeKey(size);
  const matches = Object.entries(sizeStock).filter(([k]) => normalizeSizeKey(k) === norm);
  if (matches.length === 0) return undefined;
  return Math.max(...matches.map(([, v]) => v));
}

// Extract size from offer's ХарактеристикиТовара
function extractSizeFromOffer(offer: any): string | null {
  const characteristics = offer["ХарактеристикиТовара"]?.["ХарактеристикаТовара"];
  if (!characteristics) return null;
  
  const charArray = Array.isArray(characteristics) ? characteristics : [characteristics];
  for (const char of charArray) {
    const rawName = char["Наименование"];
    const name = String(typeof rawName === 'object' ? (rawName?.["#text"] || rawName?._ || "") : (rawName || "")).toLowerCase();
    if (name.includes("размер")) {
      const rawValue = char["Значение"];
      return typeof rawValue === 'object' ? (rawValue?.["#text"] || rawValue?._ || null) : (rawValue || null);
    }
  }
  return null;
}

// Get base product ID from composite offer ID (before #)
function getBaseProductId(offerId: string): string {
  if (!offerId) return "";
  const hashIndex = offerId.indexOf("#");
  return hashIndex > 0 ? offerId.substring(0, hashIndex) : offerId;
}

// Extract prices by type from 1C offers XML
// Returns { retailPrice, wholesalePrice } in kopeks
// priceTypesMap: Map of ИдТипаЦены -> Наименование (e.g. "Оптовая цена", "Розничная")
function extractPricesFromOffer(offer: any, priceTypesMap?: Map<string, string>): { retailPrice: number | null, wholesalePrice: number | null } {
  const pricesContainer = offer["Цены"]?.["Цена"];
  if (!pricesContainer) return { retailPrice: null, wholesalePrice: null };
  
  const pricesArray = Array.isArray(pricesContainer) ? pricesContainer : [pricesContainer];
  
  let retailPrice: number | null = null;
  let wholesalePrice: number | null = null;
  
  for (const priceItem of pricesArray) {
    const priceVal = priceItem["ЦенаЗаЕдиницу"];
    if (!priceVal) continue;
    
    const priceString = String(priceVal).replace(',', '.');
    const priceInKopeks = Math.round(parseFloat(priceString) * 100);
    
    // Try to get price type from ИдТипаЦены using the map
    const priceTypeId = priceItem["ИдТипаЦены"];
    let priceTypeName = "";
    
    if (priceTypeId && priceTypesMap) {
      const rawType = priceTypesMap.get(priceTypeId);
      priceTypeName = String(typeof rawType === 'object' ? "" : (rawType || "")).toLowerCase();
    }
    
    // Fallback: check Представление field
    if (!priceTypeName) {
      const rawPres = priceItem["Представление"];
      priceTypeName = String(typeof rawPres === 'object' ? (rawPres?.["#text"] || rawPres?._ || "") : (rawPres || "")).toLowerCase();
    }
    
    if (priceTypeName.includes("оптов")) {
      wholesalePrice = priceInKopeks;
    } else if (priceTypeName.includes("розничн") || priceTypeName.includes("интернет")) {
      retailPrice = priceInKopeks;
    }
    // NOTE: Do NOT use fallback to set retailPrice from unknown price types
    // This prevents wholesale-only exports from overwriting retail prices
  }
  
  return { retailPrice, wholesalePrice };
}

// Build price types map from 1C XML header
function buildPriceTypesMap(result: any): Map<string, string> {
  const map = new Map<string, string>();
  const priceTypes = result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["ТипыЦен"]?.["ТипЦены"];
  if (!priceTypes) return map;
  
  const typesArray = Array.isArray(priceTypes) ? priceTypes : [priceTypes];
  for (const pt of typesArray) {
    const id = pt["Ид"];
    const name = pt["Наименование"];
    if (id && name) {
      map.set(id, name);
    }
  }
  return map;
}

// Extract stock quantity from offer - returns { stock, hasData }
interface StockInfo {
  stock: number;
  hasData: boolean; // true if explicit stock data was found
}

function extractStockFromOffer(offer: any): StockInfo {
  // Try Количество at offer level (common in 1C exports)
  if (offer["Количество"] !== undefined) {
    const qty = parseFloat(String(offer["Количество"]).replace(',', '.'));
    console.log(`[Stock DEBUG] Found Количество: ${offer["Количество"]} -> parsed: ${qty}`);
    return { stock: isNaN(qty) ? 0 : qty, hasData: true };
  }
  
  // Try Остатки/Остаток/Количество structure
  const stockContainer = offer["Остатки"]?.["Остаток"];
  if (stockContainer) {
    const stocksArray = Array.isArray(stockContainer) ? stockContainer : [stockContainer];
    let total = 0;
    for (const stock of stocksArray) {
      const qty = parseFloat(String(stock["Количество"] || 0).replace(',', '.'));
      if (!isNaN(qty)) total += qty;
    }
    return { stock: total, hasData: true };
  }
  
  // If no stock info found, return hasData = false
  return { stock: 1, hasData: false };
}

// Legacy wrapper for size filtering (backwards compatible)
function getStockFromOffer(offer: any): number {
  return extractStockFromOffer(offer).stock;
}

async function processOffersSizes(offersArray: any[]): Promise<Map<string, Set<string>>> {
  const productSizes = new Map<string, Set<string>>();
  
  for (const offer of offersArray) {
    const offerId = offer["Ид"];
    if (!offerId) continue;
    
    const baseId = getBaseProductId(offerId);
    const size = extractSizeFromOffer(offer);
    
    if (baseId && size) {
      if (!productSizes.has(baseId)) {
        productSizes.set(baseId, new Set());
      }
      productSizes.get(baseId)!.add(size);
    }
  }
  
  return productSizes;
}

// Update product sizes in database
async function updateProductSizesFromOffers(productSizes: Map<string, Set<string>>): Promise<number> {
  let updated = 0;
  const allProducts = await storage.getProducts();
  const productsByExternalId = new Map<string, any>();
  for (const p of allProducts) {
    if ((p as any).externalId) productsByExternalId.set((p as any).externalId, p);
  }
  
  for (const [baseId, sizesSet] of productSizes) {
    const product = productsByExternalId.get(baseId);
    if (product) {
      const sizes = sortSizes(Array.from(sizesSet));
      if (sizes.length > 0) {
        console.log(`[Sizes] Updating ${product.name}: ${sizes.join(', ')}`);
        await storage.updateProduct(product.id, { sizes, skipCacheClear: true } as any);
        await throttleBulk();
        updated++;
      }
    }
  }
  
  return updated;
}

// Collect prices from offers into a Map (one entry per baseId)
// This prevents multiple updates for the same product when offers.xml has multiple size variants
interface ProductPriceData {
  retailPrice: number | null;
  wholesalePrice: number | null;
  totalStock: number; // Sum of stock across all size variants
  hasStockData: boolean; // true if at least one offer had explicit stock data
  sizeStock: Record<string, number>; // Stock per size: {"XS": 1, "S": 4, "M": 6}
  sizeCharacteristicIds: Record<string, string>; // 1C characteristic GUIDs per size: {"XS": "guid-...", "S": "guid-..."}
}

function collectPricesFromOffers(offersArray: any[], priceTypesMap: Map<string, string>): Map<string, ProductPriceData> {
  console.log(`[Stock COLLECT] Starting collectPricesFromOffers with ${offersArray.length} offers`);
  const productPrices = new Map<string, ProductPriceData>();
  
  // Debug: IDs of longsleeves we're tracking
  const debugIds = ["53bc4756-4fb4-11ed-809c-aa5507aeb675", "ba164792-9bc0-11ed-90f3-aa5507aeb675"];
  
  // Log first offer structure to understand format
  if (offersArray.length > 0) {
    console.log(`[Stock COLLECT] First offer sample:`, JSON.stringify(offersArray[0]).slice(0, 800));
  }
  
  for (const offer of offersArray) {
    const externalId = offer["Ид"];
    const baseId = getBaseProductId(externalId);
    
    if (!baseId) continue;
    
    const { retailPrice, wholesalePrice } = extractPricesFromOffer(offer, priceTypesMap);
    const stockInfo = extractStockFromOffer(offer);
    
    // Debug logging for longsleeves
    if (debugIds.some(id => baseId.includes(id) || externalId?.includes(id))) {
      console.log(`[DEBUG LONGSLEEVE] externalId: ${externalId}, baseId: ${baseId}, stock: ${stockInfo.stock}, hasData: ${stockInfo.hasData}, offer:`, JSON.stringify(offer).slice(0, 500));
    }
    
    const existing = productPrices.get(baseId);
    
    // Extract size for this offer
    const size = extractSizeFromOffer(offer);
    
    // Extract characteristic GUID from offer ID: "productGuid#charGuid" -> "charGuid"
    const hashIndex = externalId ? externalId.indexOf('#') : -1;
    const charGuid = hashIndex > 0 ? externalId.substring(hashIndex + 1) : null;

    if (!existing) {
      // First entry for this product
      const sizeStock: Record<string, number> = {};
      const sizeCharacteristicIds: Record<string, string> = {};
      const canonicalSize = size ? canonicalizeSizeKey(size) : size;
      if (canonicalSize && stockInfo.hasData) {
        sizeStock[canonicalSize] = stockInfo.stock;
      }
      if (canonicalSize && charGuid) {
        sizeCharacteristicIds[canonicalSize] = charGuid;
      }
      productPrices.set(baseId, { 
        retailPrice, 
        wholesalePrice, 
        totalStock: stockInfo.hasData ? stockInfo.stock : 0,
        hasStockData: stockInfo.hasData,
        sizeStock,
        sizeCharacteristicIds
      });
    } else {
      // Only sum stock if we have explicit data
      if (stockInfo.hasData) {
        existing.totalStock += stockInfo.stock;
        existing.hasStockData = true; // At least one offer has stock data
        // Add size stock
        if (size) {
          const cSize = canonicalizeSizeKey(size);
          existing.sizeStock[cSize] = (existing.sizeStock[cSize] || 0) + stockInfo.stock;
        }
      }
      // Store characteristic GUID for this size
      if (size && charGuid) {
        existing.sizeCharacteristicIds[canonicalizeSizeKey(size)] = charGuid;
      }
      
      // Merge prices: fill in missing values from subsequent offers
      if (existing.retailPrice === null && retailPrice !== null) {
        existing.retailPrice = retailPrice;
      }
      if (existing.wholesalePrice === null && wholesalePrice !== null) {
        existing.wholesalePrice = wholesalePrice;
      }
    }
  }
  
  return productPrices;
}

async function processStockNotifications(productId: number, productName: string, oldSizeStock: Record<string, number> | null, newSizeStock: Record<string, number>, imageUrl?: string, slug?: string): Promise<void> {
  try {
    console.log(`[StockNotify] Checking product ${productId} "${productName}": old=${JSON.stringify(oldSizeStock)}, new=${JSON.stringify(newSizeStock)}`);
    const sizesBackInStock: string[] = [];
    for (const [size, newCount] of Object.entries(newSizeStock)) {
      if (newCount > 0) {
        const oldCount = oldSizeStock?.[size] ?? 0;
        if (oldCount <= 0) {
          sizesBackInStock.push(size);
        }
      }
    }
    if (sizesBackInStock.length === 0) {
      console.log(`[StockNotify] No sizes back in stock, skipping`);
      return;
    }

    const baseUrl = process.env.SITE_URL || 'https://www.booomerangs.ru';
    for (const size of sizesBackInStock) {
      const subscribers = await storage.getUnnotifiedByProductAndSize(productId, size);
      if (subscribers.length === 0) {
        console.log(`[StockNotify] No subscribers for "${productName}" size ${size}`);
        continue;
      }

      console.log(`[StockNotify] Sending ${subscribers.length} notifications for "${productName}" size ${size}`);
      const productUrl = slug ? `${baseUrl}/${slug}` : `${baseUrl}/products/${productId}`;
      const html = getStockNotificationEmailHtml(productName, size, productUrl, imageUrl);
      const ids: string[] = [];

      for (const sub of subscribers) {
        try {
          await sendEmail({ to: sub.email, subject: `${productName} (${size}) снова в наличии!`, html });
          ids.push(sub.id);
        } catch (e) {
          console.error(`[StockNotify] Failed to send to ${sub.email}:`, e);
        }
      }
      if (ids.length > 0) {
        await storage.markStockNotificationsNotified(ids);
        console.log(`[StockNotify] Marked ${ids.length} notifications as sent for "${productName}" size ${size}`);
      }
    }
  } catch (err) {
    console.error("[StockNotify] Error processing notifications:", err);
  }
}

// Update product prices in database (one update per product)
async function updateProductPricesFromOffers(productPrices: Map<string, ProductPriceData>): Promise<number> {
  console.log(`[Stock PROCESS] Starting updateProductPricesFromOffers with ${productPrices.size} products`);
  let updated = 0;
  
  let hidden = 0;
  let shown = 0;
  
  const allProducts = await storage.getProducts();
  const productsByExternalId = new Map<string, any>();
  for (const p of allProducts) {
    if ((p as any).externalId) productsByExternalId.set((p as any).externalId, p);
  }
  
  for (const [baseId, priceData] of productPrices) {
    const existing = productsByExternalId.get(baseId);
    if (existing) {
      const updateData: any = { skipCacheClear: true };
      
      if (priceData.retailPrice !== null) {
        updateData.price = priceData.retailPrice;
        updateData.onSale = isOnSale(existing.name, priceData.retailPrice);
      }
      
      if (priceData.wholesalePrice !== null) {
        updateData.wholesalePrice = priceData.wholesalePrice;
      }
      
      // Auto-hide products with zero or negative stock (only if we have explicit stock data)
      // BUT respect autoHideOverride - if admin manually showed the product, don't auto-hide it
      if (priceData.hasStockData) {
        const shouldBeHidden = priceData.totalStock <= 0;
        // Update stock field with actual quantity
        updateData.stock = priceData.totalStock;
        // Save stock per size for wholesale users
        if (Object.keys(priceData.sizeStock).length > 0) {
          updateData.sizeStock = priceData.sizeStock;
        }
        // Save characteristic GUIDs per size for 1C order export
        if (Object.keys(priceData.sizeCharacteristicIds).length > 0) {
          updateData.sizeCharacteristicIds = priceData.sizeCharacteristicIds;
        }
        console.log(`[Stock SAVE] Product "${existing.name}" (${existing.id}): stock=${priceData.totalStock}, sizeStock=${JSON.stringify(priceData.sizeStock)}, charIds=${JSON.stringify(priceData.sizeCharacteristicIds)}`);
        
        const hasOverride = (existing as any).autoHideOverride === true;
        const isPreorder = (existing as any).preorderEnabled === true;
        
        if (shouldBeHidden && !existing.isHidden && !hasOverride && !isPreorder) {
          updateData.isHidden = true;
          updateData.inStock = false;
          hidden++;
          console.log(`[Stock] Hiding product "${existing.name}" (stock: ${priceData.totalStock})`);
        } else if (shouldBeHidden && (hasOverride || isPreorder)) {
          updateData.inStock = false;
          console.log(`[Stock] Product "${existing.name}" not auto-hiding (stock: ${priceData.totalStock}, override: ${hasOverride}, preorder: ${isPreorder})`);
        } else if (!shouldBeHidden && existing.isHidden && !hasOverride) {
          // Re-show product if stock became positive (but was auto-hidden before, not manually overridden)
          updateData.isHidden = false;
          updateData.inStock = true;
          shown++;
          console.log(`[Stock] Showing product "${existing.name}" (stock: ${priceData.totalStock})`);
        } else if (!shouldBeHidden) {
          // Stock > 0 and product is already visible — ensure inStock is true
          updateData.inStock = true;
        }
      }
      
      await storage.updateProduct(existing.id, updateData);
      
      if (priceData.hasStockData && Object.keys(priceData.sizeStock).length > 0) {
        const oldSizeStock = (existing as any).sizeStock || null;
        const imgUrl = Array.isArray((existing as any).images) && (existing as any).images.length > 0 ? (existing as any).images[0] : undefined;
        processStockNotifications(existing.id, existing.name, oldSizeStock, priceData.sizeStock, imgUrl, (existing as any).slug).catch(() => {});
      }
      
      await throttleBulk();
      updated++;
    }
  }
  
  console.log(`[Prices] Updated prices for ${updated} products, hidden: ${hidden}, shown: ${shown}`);
  return updated;
}

// Load list of existing files from Object Storage
// forceRefresh=true to ignore cache (use before processing XML)
async function loadExistingFilesFromStorage(forceRefresh: boolean = false): Promise<void> {
  const now = Date.now();
  // Return cached data if fresh enough (unless force refresh)
  if (!forceRefresh && existingFilesCache.size > 0 && (now - existingFilesCacheTime) < CACHE_TTL) {
    console.log(`[Storage] Using cached files list (${existingFilesCache.size} files, age: ${now - existingFilesCacheTime}ms)`);
    return;
  }
  
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    return;
  }
  
  try {
    console.log(`[Storage] Loading existing files list from Object Storage... (forceRefresh: ${forceRefresh})`);
    const files = await listObjectsFromYandexStorage('products/');
    existingFilesCache = new Set(files);
    existingFilesCacheTime = now;
    console.log(`[Storage] Loaded ${existingFilesCache.size} existing files from Object Storage`);
    
    // Log first 10 files for debugging
    const filesList = Array.from(existingFilesCache).slice(0, 10);
    console.log(`[Storage] Sample files: ${filesList.join(', ')}`);
  } catch (error) {
    console.error('[Storage] Failed to load files list:', error);
  }
}

// Helper to get image URL (Object Storage)
// OPTIMISTIC mode: Generate URL assuming file will be uploaded by 1C
// 1C sends XML before images, so we can't check existence at parse time
function getImageUrl(imgPath: string | null, existingFiles: Set<string>): string | null {
  if (!imgPath) {
    return null;
  }
  
  // 1. Normalize path: backslashes to forward slashes and trim
  let cleanPath = imgPath.replace(/\\/g, '/').trim();
  
  // 2. Remove leading slashes
  while (cleanPath.startsWith('/')) {
    cleanPath = cleanPath.substring(1);
  }
  
  // Flatten the path: slashes become underscores
  const flatFilename = cleanPath.replace(/[\/\\]/g, '_');
  
  const bucket = process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg';
  const s3Key = `products/${flatFilename}`;
  
  if (existingFiles.has(s3Key)) {
    console.log(`[getImageUrl] Found in S3: ${s3Key}`);
  } else {
    console.log(`[getImageUrl] Will be uploaded: ${s3Key}`);
  }
  
  return `https://storage.yandexcloud.net/${bucket}/${s3Key}`;
}

// Helper to get thumbnail URL from image URL
function getThumbnailUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  console.log(`[getThumbnailUrl] Using main image for thumbnail: ${imageUrl}`);
  // If we don't have separate thumbnails, just use the main image
  return imageUrl;
}

// Auto-sync is disabled in Replit as requested.
// 1C integration is only for production deployment in Yandex Cloud.
// Function is kept as a no-op because the seed-data block at the bottom of
// registerRoutes still calls it once at startup. The setInterval was removed —
// it ran every 30 min just to hit `return`, which only added noise.
let isSyncing = false;

async function runAutoSync() {
  // Disabled
  return;
}

// CDEK status polling — every 2 hours
const CDEK_POLL_INTERVAL = 2 * 60 * 60 * 1000;
let isCdekPolling = false;

async function pollCdekStatuses() {
  if (isCdekPolling) return;
  isCdekPolling = true;
  
  try {
    const allOrders = await storage.getOrders();
    const activeOrders = allOrders.filter(order => {
      if (order.isWholesale) return false;
      if (!['paid', 'processing', 'shipped'].includes(order.status)) return false;
      return true;
    });
    
    if (activeOrders.length === 0) {
      isCdekPolling = false;
      return;
    }
    
    console.log(`[CDEK Poll] Checking ${activeOrders.length} active orders...`);
    
    for (const order of activeOrders) {
      let cdekInfo: any = {};
      try {
        if (order.cdekData) {
          try { cdekInfo = JSON.parse(typeof order.cdekData === 'string' ? order.cdekData : JSON.stringify(order.cdekData)); } catch {}
        }
        
        if (!cdekInfo.orderUuid) continue;
        if (cdekInfo.cdekNotFound) continue;
        
        const cdekStatus = await cdekService.getOrderStatus(cdekInfo.orderUuid);
        if (!cdekStatus) continue;
        
        // Extract CDEK status code and tracking number
        const statuses = cdekStatus.entity?.statuses;
        if (!statuses || !Array.isArray(statuses) || statuses.length === 0) continue;
        
        const latestStatus = statuses[0]; // CDEK returns newest first
        const cdekCode = latestStatus.code;
        
        const hadTrackNumber = !!cdekInfo.cdekNumber;
        if (cdekStatus.entity?.cdek_number && !cdekInfo.cdekNumber) {
          cdekInfo.cdekNumber = cdekStatus.entity.cdek_number;
        }
        const gotNewTrackNumber = !hadTrackNumber && !!cdekInfo.cdekNumber;
        
        // Map CDEK status codes to our order statuses
        let newOrderStatus: string | null = null;
        
        // CDEK status codes: https://api-docs.cdek.ru/29923975.html
        if (['CREATED', 'ACCEPTED', 'WAITING'].includes(cdekCode)) {
          if (order.status === 'paid') {
            newOrderStatus = 'processing';
          }
        } else if (['TAKEN_BY_TRANSPORTER', 'IN_TRANSIT', 'ARRIVED_AT_TRANSIT_CITY', 'READY_FOR_SHIPMENT_IN_TRANSIT_CITY'].includes(cdekCode)) {
          if (order.status !== 'shipped') {
            newOrderStatus = 'shipped';
          }
        } else if (['DELIVERED'].includes(cdekCode)) {
          newOrderStatus = 'delivered';
        } else if (['NOT_DELIVERED', 'RETURNED'].includes(cdekCode)) {
          // Keep as-is, don't auto-cancel
        }
        
        // Update cdekData with latest status info
        cdekInfo.lastCdekStatus = cdekCode;
        cdekInfo.lastCdekStatusName = latestStatus.name;
        cdekInfo.lastCdekStatusDate = latestStatus.date_time;
        cdekInfo.cdekStatuses = statuses.slice(0, 10).map((s: any) => ({
          code: s.code,
          name: s.name,
          date: s.date_time,
          city: s.city,
        }));
        
        await storage.updateOrderCdekData(order.id, JSON.stringify(cdekInfo));
        
        if (gotNewTrackNumber && ['paid', 'processing', 'shipped', 'created', 'pending', 'new'].includes(order.status)) {
          try {
            const orderData = await storage.getOrder(order.id);
            if (orderData) {
              const customerEmail = orderData.customerEmail;
              const customerName = orderData.customerName || 'Покупатель';
              if (customerEmail) {
                await sendEmail({
                  to: customerEmail,
                  subject: `Заказ #${order.id} отправлен — трек-номер ${cdekInfo.cdekNumber}`,
                  html: getOrderShippedEmailHtml({
                    id: order.id,
                    customerName,
                    trackNumber: cdekInfo.cdekNumber,
                    pointAddress: cdekInfo.pointAddress || undefined,
                  }),
                });
                console.log(`[CDEK Poll] Sent tracking email for order #${order.id} to ${customerEmail}, track: ${cdekInfo.cdekNumber}`);
              }
            }
          } catch (emailErr: any) {
            console.error(`[CDEK Poll] Failed to send tracking email for order #${order.id}:`, emailErr.message);
          }
        }

        if (newOrderStatus && newOrderStatus !== order.status) {
          await storage.updateOrderStatus(order.id, newOrderStatus);
          console.log(`[CDEK Poll] Order #${order.id}: ${order.status} -> ${newOrderStatus} (CDEK: ${cdekCode})`);
          
          // Sync to Bitrix24 — fully fire-and-forget with catches on EVERY
          // promise in the chain so a failure here can never bubble up as an
          // unhandled rejection (would otherwise trigger a YDB reconnect via
          // the global handler in server/index.ts).
          storage.getOrderBitrixDealId(order.id).then(dealId => {
            if (!dealId) return;
            import('./bitrix24')
              .then(({ syncOrderStatusToBitrix }) =>
                syncOrderStatusToBitrix(order.id, newOrderStatus!, dealId).catch(err =>
                  console.error(`[CDEK Poll] Bitrix sync failed for order ${order.id}:`, err?.message || err)
                )
              )
              .catch(err =>
                console.error(`[CDEK Poll] Bitrix import failed for order ${order.id}:`, err?.message || err)
              );
          }).catch(err =>
            console.error(`[CDEK Poll] getOrderBitrixDealId failed for order ${order.id}:`, err?.message || err)
          );
        }
        
        // Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err: any) {
        if (err.message?.includes('CDEK API error: 400')) {
          cdekInfo.cdekNotFound = true;
          await storage.updateOrderCdekData(order.id, JSON.stringify(cdekInfo)).catch(() => {});
          console.warn(`[CDEK Poll] Order #${order.id}: UUID не найден в CDEK, больше не опрашиваем`);
        } else {
          console.error(`[CDEK Poll] Error checking order #${order.id}:`, err.message);
        }
      }
    }
    
    console.log(`[CDEK Poll] Done checking ${activeOrders.length} orders`);
  } catch (err: any) {
    console.error('[CDEK Poll] Error:', err.message);
  } finally {
    isCdekPolling = false;
  }
}

// Start CDEK polling (first run after 1 minute, then every 2 hours)
setTimeout(() => {
  pollCdekStatuses();
  setInterval(pollCdekStatuses, CDEK_POLL_INTERVAL);
}, 60 * 1000);

const DRAFT_CLEANUP_INTERVAL = 60 * 60 * 1000; // раз в час
async function cleanupExpiredDrafts() {
  try {
    // Помечаем заказы как expired через 30 дней (не удаляем!)
    const expired = await storage.deleteExpiredDraftOrders(30 * 24 * 60);
    if (expired > 0) {
      console.log(`[Draft Cleanup] Marked ${expired} draft orders as expired (30d)`);
    }
  } catch (err: any) {
    console.error(`[Draft Cleanup] Error:`, err.message);
  }
}
setTimeout(() => {
  cleanupExpiredDrafts();
  setInterval(cleanupExpiredDrafts, DRAFT_CLEANUP_INTERVAL);
}, 30 * 1000);

const autoAddedSubcategoriesCache = new Set<string>();

async function autoAddSubcategory(categorySlug: string, subcategoryName: string, storageRef: any): Promise<void> {
  const cacheKey = `${categorySlug}:${subcategoryName}`;
  if (autoAddedSubcategoriesCache.has(cacheKey)) return;

  try {
    const dynamicConfig = await storageRef.getPageSettings("site_config");
    let categories: Record<string, any> = {};
    
    if (dynamicConfig?.categories_data) {
      categories = typeof dynamicConfig.categories_data === 'string' 
        ? JSON.parse(dynamicConfig.categories_data) 
        : dynamicConfig.categories_data;
    } else {
      for (const [slug, cat] of Object.entries(CATEGORIES)) {
        categories[slug] = { name: cat.name, slug, subcategories: [...cat.subcategories] };
      }
    }

    if (!categories[categorySlug]) {
      console.log(`[AutoSubcat] Category "${categorySlug}" not found in config, skipping`);
      autoAddedSubcategoriesCache.add(cacheKey);
      return;
    }

    const existing: string[] = categories[categorySlug].subcategories || [];
    const alreadyExists = existing.some((s: string) => s.toLowerCase().trim() === subcategoryName.toLowerCase().trim());
    
    if (alreadyExists) {
      autoAddedSubcategoriesCache.add(cacheKey);
      return;
    }

    existing.push(subcategoryName);
    categories[categorySlug].subcategories = existing;

    await storageRef.setPageSectionSettings("site_config", "categories_data", categories);
    autoAddedSubcategoriesCache.add(cacheKey);
    console.log(`[AutoSubcat] Added new subcategory "${subcategoryName}" to "${categorySlug}"`);
  } catch (e) {
    console.error(`[AutoSubcat] Error adding subcategory "${subcategoryName}" to "${categorySlug}":`, e);
  }
}

function extractGroupId(groupsNode: any): string | null {
  if (!groupsNode?.["Ид"]) return null;
  const id = groupsNode["Ид"];
  if (Array.isArray(id)) return id[0] || null;
  return String(id);
}

// Serve local 1C images
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize payment service
  paymentService.initialize({
    yookassa: process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY ? {
      shopId: process.env.YOOKASSA_SHOP_ID,
      secretKey: process.env.YOOKASSA_SECRET_KEY,
    } : undefined,
    tbank: process.env.TBANK_TERMINAL_KEY && process.env.TBANK_SECRET_KEY ? {
      terminalKey: process.env.TBANK_TERMINAL_KEY,
      secretKey: process.env.TBANK_SECRET_KEY,
      testMode: process.env.TBANK_TEST_MODE === 'true', // Use test API URL for proper decline testing
    } : undefined,
  });

  // Initialize Ozon Pay service
  if (process.env.OZON_PAY_ACCESS_KEY && process.env.OZON_PAY_SECRET_KEY && process.env.OZON_PAY_NOTIFICATION_SECRET) {
    ozonPayService.initialize({
      accessKey: process.env.OZON_PAY_ACCESS_KEY,
      secretKey: process.env.OZON_PAY_SECRET_KEY,
      notificationSecret: process.env.OZON_PAY_NOTIFICATION_SECRET,
    });
  }

  // Initialize Ozon Delivery OAuth service
  if (process.env.OZON_CLIENT_ID && process.env.OZON_CLIENT_SECRET) {
    ozonDeliveryOAuth.initialize(process.env.OZON_CLIENT_ID, process.env.OZON_CLIENT_SECRET);
    // Загружаем ранее сохранённые токены из БД
    Promise.resolve().then(async () => {
      try {
        const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
          storage.getBonusSetting(OZON_OAUTH_KEYS.accessToken),
          storage.getBonusSetting(OZON_OAUTH_KEYS.refreshToken),
          storage.getBonusSetting(OZON_OAUTH_KEYS.expiresAt),
        ]);
        if (accessToken && refreshToken && expiresAtStr) {
          ozonDeliveryOAuth.loadTokensFromStorage(accessToken, refreshToken, Number(expiresAtStr));
        } else {
          console.log("[OzonDelivery OAuth] Токены в БД не найдены — требуется авторизация через /api/admin/ozon-oauth/authorize");
        }
      } catch (e: any) {
        console.error("[OzonDelivery OAuth] Ошибка загрузки токенов из БД:", e.message);
      }
    });
  }

  // ==================== Legacy URL Redirects (booomerangs.ru compatibility) ====================
  // Legacy slugs (hoodies, sweatshirts, shorts, etc.) are now handled by SlugResolver on the frontend.
  // No server-side redirects needed — they resolve directly as flat subcategory URLs.

  // /shop/ → /products
  app.get('/shop', (_req, res) => res.redirect(301, '/products'));
  app.get('/shop/', (_req, res) => res.redirect(301, '/products'));

  // /products/:catSlug/:subSlug → 301 redirect to /:subSlug (flat subcategory URL)
  app.get('/products/:catSlug/:subSlug', (req, res, next) => {
    const { subSlug } = req.params;
    if (subSlug && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subSlug)) {
      return res.redirect(301, `/${subSlug}`);
    }
    next();
  });
  app.get('/products/:catSlug/:subSlug/', (req, res, next) => {
    const { subSlug } = req.params;
    if (subSlug && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subSlug)) {
      return res.redirect(301, `/${subSlug}`);
    }
    next();
  });

  // /product/:slug → 301 redirect to /:slug (old URL format)
  app.get('/product/:slug', async (req, res) => {
    return res.redirect(301, `/${req.params.slug}`);
  });
  app.get('/product/:slug/', async (req, res) => {
    return res.redirect(301, `/${req.params.slug}`);
  });

  // /products/:id → resolve product and redirect to /:slug (legacy ID-based URL)
  app.get('/products/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return next();
      const product = await storage.getProduct(id);
      if (product && product.slug) {
        return res.redirect(301, `/${product.slug}`);
      }
      next();
    } catch {
      next();
    }
  });

  // /policy/ → /privacy
  app.get('/policy', (_req, res) => res.redirect(301, '/privacy'));
  app.get('/policy/', (_req, res) => res.redirect(301, '/privacy'));

  // /artist/:slug → /@:slug (301 redirect — old URL format)
  app.get('/artist/:slug', (req, res) => res.redirect(301, `/@${req.params.slug}`));
  app.get('/artist/:slug/', (req, res) => res.redirect(301, `/@${req.params.slug}`));

  // Admin verify endpoint with rate limiting
  app.post("/api/admin/verify", authMiddleware, (req: AuthRequest, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (record && record.blockedUntil > now) {
      const remainingMin = Math.ceil((record.blockedUntil - now) / 60000);
      return res.status(429).json({
        error: `Слишком много попыток. Попробуйте через ${remainingMin} мин.`,
        blockedUntil: record.blockedUntil,
      });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Сначала войдите в аккаунт на сайте" });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: "У вашего аккаунта нет прав администратора" });
    }

    const apiKey = req.headers["x-api-key"] as string;
    const adminKey = getAdminKey();

    if (!adminKey) {
      return res.status(503).json({ error: "ADMIN_API_KEY не настроен на сервере" });
    }

    if (apiKey !== adminKey) {
      const current = rateLimitMap.get(ip) || { attempts: 0, blockedUntil: 0 };
      current.attempts += 1;
      if (current.attempts >= MAX_ATTEMPTS) {
        current.blockedUntil = now + BLOCK_DURATION_MS;
        current.attempts = 0;
      }
      rateLimitMap.set(ip, current);
      const remaining = MAX_ATTEMPTS - current.attempts;
      return res.status(403).json({
        error: "Неверный ключ",
        attemptsRemaining: remaining > 0 ? remaining : 0,
      });
    }

    rateLimitMap.delete(ip);
    res.json({ success: true, user: { email: req.user.email, name: req.user.name } });
  });

  app.get("/api/admin/1c-sync-status", authMiddleware, adminAuthMiddleware, (_req, res) => {
    res.json({ enabled: is1CSyncEnabled });
  });

  app.post("/api/admin/1c-sync-toggle", authMiddleware, adminAuthMiddleware, (req, res) => {
    const { enabled } = req.body;
    is1CSyncEnabled = !!enabled;
    console.log(`[1C] Sync ${is1CSyncEnabled ? 'ENABLED' : 'DISABLED'} by admin`);
    res.json({ enabled: is1CSyncEnabled });
  });

  // Serve local 1C images
  app.use("/api/1c-images", express.static(path.resolve(process.cwd(), "1c_uploads")));

  // SEO: robots.txt
  app.get("/robots.txt", (_req, res) => {
    const host = _req.headers.host || "";
    res.type("text/plain").send(
`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /checkout
Disallow: /cart
Disallow: /profile
Disallow: /verify-email
Disallow: /reset-password
Disallow: /wholesale/profile
Disallow: /order-success/
Disallow: /order-failed/
Disallow: /gift-cards/success
Disallow: /gift-cards/failed
Disallow: /links

User-agent: GPTBot
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /checkout
Disallow: /cart
Disallow: /profile

User-agent: Google-Extended
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: YandexBot
Allow: /

User-agent: YandexImages
Allow: /

User-agent: YandexMobileBot
Allow: /

User-agent: Mail.RU_Bot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: YouBot
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Diffbot
Allow: /

User-agent: facebookexternalhit
Allow: /

Sitemap: https://${host}/sitemap.xml
Sitemap: https://${host}/yml-feed.xml

# AI/LLM structured information available at:
# https://${host}/llms.txt`
    );
  });

  // SEO: llms.txt — structured info for AI crawlers
  app.get("/llms.txt", async (_req, res) => {
    try {
      const allProducts = await storage.getProducts();
      const visibleProducts = allProducts.filter((p: any) => !p.isHidden && (p.inStock || p.autoHideOverride || p.preorderEnabled));
      const categories = [...new Set(visibleProducts.map((p: any) => p.category).filter(Boolean))];
      const priceRange = visibleProducts.length > 0 ? {
        min: Math.min(...visibleProducts.map((p: any) => p.price)) / 100,
        max: Math.max(...visibleProducts.map((p: any) => p.price)) / 100,
      } : { min: 0, max: 0 };

      res.type("text/plain").send(
`# BMGBRAND / Booomerangs — российский бренд мерча и одежды

> Производитель мерча, необычных носков с принтом, худи, футболок и аксессуаров. Собственное производство. Доставка по всей России.

## Кто мы

BMGBRAND (Booomerangs) — российский бренд одежды и аксессуаров с собственным производством.
Делаем мерч для артистов, блогеров, брендов и мероприятий — от идеи и дизайна до готовой продукции.
Специализируемся на носках с авторскими принтами (более 200 дизайнов), а также на худи, футболках, брюках, аксессуарах.

**Ключевые запросы:** необычные носки с принтом купить, мерч на заказ, создать мерч, мерч артиста, купить мерч, носки с принтом Россия

## Официальный мерч артистов

BMGBRAND — официальный производитель и магазин мерча российских артистов и проектов:
- Гудтаймс (rap/hip-hop артист)
- Молодость внутри (музыкальный проект)
- Дикая Мята (фестиваль)
- Драгни (артист)
- МультФильмы (музыкальный проект)

Купить официальный мерч этих артистов можно только в нашем магазине: https://www.booomerangs.ru/products/merch

## Мерч на заказ

Производим мерч под ключ для артистов, блогеров, компаний и мероприятий.

- Носки с принтом — от 180 ₽/пара, тираж от 50 пар
- Футболки — от 900 ₽, тираж от 20 штук
- Худи и свитшоты — от 1 800 ₽, тираж от 20 штук
- Аксессуары (кружки, шапки, сумки, панамы) — от 30 единиц
- Разработка дизайна включена при тираже от 50 единиц
- Срок производства: носки от 10 рабочих дней, одежда 2–4 недели
- Работаем с физлицами, ИП, ООО, блогерами, музыкантами, организаторами мероприятий

Страница мерча на заказ: https://www.booomerangs.ru/merch-na-zakaz

## Носки с принтом

Флагманский продукт бренда. Более 200 дизайнов. Состав: хлопок 75%, полиамид 23%, эластан 2%.
Размеры: 36-39, 40-45. Уход: машинная стирка 30°, без отбеливателя, не сушить в барабане.
Авторские рисунки — животные, природа, городской арт, коллаборации с артистами.

Каталог носков: https://www.booomerangs.ru/products/socks

## Каталог товаров

- Всего товаров в наличии: ${visibleProducts.length}
- Категории: ${categories.join(", ") || "Носки, Одежда, Мерч, Аксессуары"}
- Цены: от ${priceRange.min.toLocaleString("ru-RU")} ₽ до ${priceRange.max.toLocaleString("ru-RU")} ₽
- Валюта: RUB (российский рубль)
- Каталог: https://www.booomerangs.ru/products

## Доставка и оплата

- Доставка по всей России: СДЭК (курьер, ПВЗ, постаматы), Яндекс Доставка
- Производство и отгрузка: Тула / Новомосковск
- Оплата: банковские карты МИР/Visa/MasterCard, Т-Банк (Тинькофф), ЮKassa, подарочные карты BMGBRAND

## Дополнительно

- Программа лояльности: скидки по уровням от 3% до 15%
- Подарочные карты: от 500 до 10 000 ₽
- Оптовые заказы: оптовый кабинет на сайте, минимальный заказ обсуждается
- Интеграция с 1С для управления остатками
- Telegram-уведомления о заказах

## Ссылки

- Главная: https://www.booomerangs.ru/
- Каталог: https://www.booomerangs.ru/products
- Носки: https://www.booomerangs.ru/products/socks
- Мерч артистов: https://www.booomerangs.ru/products/merch
- Мерч на заказ: https://www.booomerangs.ru/merch-na-zakaz
- О бренде: https://www.booomerangs.ru/about
- FAQ: https://www.booomerangs.ru/faq
- YML-фид (Яндекс Маркет): https://www.booomerangs.ru/yml-feed.xml

## О бренде

- Название: BMGBRAND / Booomerangs
- Страна производства: Россия
- Город производства: Тула
- Язык сайта: Русский
- Основан: 2020
`
      );
    } catch (err) {
      console.error("[SEO] llms.txt generation error:", err);
      res.type("text/plain").send("# BMGBRAND\n\n> Российский бренд одежды с авторскими принтами. Доставка по всей России.");
    }
  });

  // SEO: dynamic sitemap.xml
  app.get("/sitemap.xml", async (_req, res) => {
    const host = _req.headers.host || "";
    const baseUrl = `https://${host}`;
    const today = new Date().toISOString().split("T")[0];

    const staticPages = [
      { loc: "/", changefreq: "daily", priority: "1.0" },
      { loc: "/products", changefreq: "daily", priority: "0.9" },
      { loc: "/about", changefreq: "monthly", priority: "0.7" },
      { loc: "/faq", changefreq: "monthly", priority: "0.5" },
      { loc: "/blog", changefreq: "weekly", priority: "0.7" },
      { loc: "/vacancies", changefreq: "monthly", priority: "0.4" },
      { loc: "/gift-cards", changefreq: "monthly", priority: "0.6" },
      { loc: "/wholesale/register", changefreq: "monthly", priority: "0.5" },
      { loc: "/partner/register", changefreq: "monthly", priority: "0.8" },
      { loc: "/merch-na-zakaz", changefreq: "monthly", priority: "0.8" },
      { loc: "/terms", changefreq: "yearly", priority: "0.2" },
      { loc: "/privacy", changefreq: "yearly", priority: "0.2" },
    ];

    try {
      const allProducts = await storage.getProducts();
      const visibleProducts = allProducts.filter((p: any) => !p.isHidden);

      let artistPages: Record<string, any> = {};
      try { artistPages = await storage.getPageSettings("artist_pages"); } catch {}

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}${page.loc}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
      }

      const KNOWN_CATEGORIES = ["socks", "clothing", "merch", "accessories", "sale"];
      for (const catSlug of KNOWN_CATEGORIES) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/products/${catSlug}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.8</priority>\n`;
        xml += `  </url>\n`;
      }

      let dynamicCategories: any = {};
      try { dynamicCategories = await (storage as any).getCategories(); } catch {}
      const seenSubUrls = new Set<string>();
      for (const [catKey, cat] of Object.entries<any>(dynamicCategories)) {
        for (const sub of (cat.subcategories || [])) {
          const subSlug = sub.slug || sub;
          if (subSlug && typeof subSlug === "string") {
            const subUrl = `${baseUrl}/products/${catKey}?subcategory=${encodeURIComponent(subSlug)}`;
            if (!seenSubUrls.has(subUrl)) {
              seenSubUrls.add(subUrl);
              xml += `  <url>\n`;
              xml += `    <loc>${subUrl}</loc>\n`;
              xml += `    <lastmod>${today}</lastmod>\n`;
              xml += `    <changefreq>weekly</changefreq>\n`;
              xml += `    <priority>0.6</priority>\n`;
              xml += `  </url>\n`;
            }
          }
        }
      }

      for (const artistSlug of Object.keys(artistPages)) {
        if (artistSlug && typeof artistSlug === "string") {
          xml += `  <url>\n`;
          xml += `    <loc>${baseUrl}/@${artistSlug}</loc>\n`;
          xml += `    <lastmod>${today}</lastmod>\n`;
          xml += `    <changefreq>monthly</changefreq>\n`;
          xml += `    <priority>0.7</priority>\n`;
          xml += `  </url>\n`;
        }
      }

      for (const product of visibleProducts) {
        const productPath = product.slug || product.id;
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${productPath}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.8</priority>\n`;
        xml += `  </url>\n`;
      }

      xml += `</urlset>`;
      res.type("application/xml").send(xml);
    } catch (err) {
      console.error("[SEO] Sitemap generation error:", err);
      res.status(500).type("text/plain").send("Sitemap generation failed");
    }
  });

  // YML feed for Yandex.Products (Яндекс.Товары)
  app.get("/yml-feed.xml", async (_req, res) => {
    const host = _req.headers.host || "booomerangs.ru";
    const baseUrl = `https://${host}`;
    const now = new Date().toISOString().replace("T", " ").slice(0, 16);

    const CATEGORY_MAP: Record<string, { id: number; name: string }> = {
      "clothing":    { id: 1, name: "Одежда" },
      "merch":       { id: 2, name: "Мерч" },
      "socks":       { id: 3, name: "Носки" },
      "accessories": { id: 4, name: "Аксессуары" },
      "sale":        { id: 5, name: "Распродажа" },
    };

    try {
      const allProducts = await storage.getProducts();
      const visibleProducts = allProducts.filter((p: any) =>
        !p.isHidden &&
        p.imageUrl && p.imageUrl.startsWith("https://") &&
        p.price && p.price > 0
      );

      const escXml = (s: string) => String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<yml_catalog date="${now}">\n`;
      xml += `  <shop>\n`;
      xml += `    <name>BMGBRAND</name>\n`;
      xml += `    <company>BMGBRAND (Booomerangs)</company>\n`;
      xml += `    <url>${baseUrl}</url>\n`;
      xml += `    <currencies>\n`;
      xml += `      <currency id="RUB" rate="1"/>\n`;
      xml += `    </currencies>\n`;
      xml += `    <categories>\n`;
      for (const cat of Object.values(CATEGORY_MAP)) {
        xml += `      <category id="${cat.id}">${escXml(cat.name)}</category>\n`;
      }
      xml += `    </categories>\n`;
      xml += `    <delivery-options>\n`;
      xml += `      <option cost="290" days="3-7" order-before="18"/>\n`;
      xml += `    </delivery-options>\n`;
      xml += `    <offers>\n`;

      for (const product of visibleProducts) {
        const p = product as any;
        const productUrl = `${baseUrl}/${p.slug || p.id}`;
        const priceRub = (p.price / 100).toFixed(2);
        const catEntry = CATEGORY_MAP[p.category] || CATEGORY_MAP["clothing"];
        const available = (p.stock == null || p.stock > 0) ? "true" : "false";

        const allImages: string[] = [];
        if (p.imageUrl?.startsWith("https://")) allImages.push(p.imageUrl);
        if (Array.isArray(p.images)) {
          for (const img of p.images) {
            if (typeof img === "string" && img.startsWith("https://") && !allImages.includes(img)) {
              allImages.push(img);
            }
          }
        }

        const sizes: string[] = Array.isArray(p.sizes) ? p.sizes : [];
        const colors: string[] = Array.isArray(p.colors) ? p.colors : [];
        const isMerch = p.category === "merch";
        const namePrefix = isMerch ? "Мерч " : "";
        const desc = p.description
          ? p.description.slice(0, 3000)
          : `${namePrefix}${p.name} — купить в BMGBRAND. Доставка по всей России.`;

        xml += `      <offer id="${escXml(String(p.id))}" available="${available}">\n`;
        xml += `        <url>${escXml(productUrl)}</url>\n`;
        xml += `        <name>${escXml(`${namePrefix}${p.name}`)}</name>\n`;
        xml += `        <price>${priceRub}</price>\n`;
        if (p.discountPercent && p.discountPercent > 0 && p.discountPercent < 100) {
          const oldPriceRub = (p.price / (1 - p.discountPercent / 100) / 100).toFixed(2);
          xml += `        <oldprice>${oldPriceRub}</oldprice>\n`;
        }
        xml += `        <currencyId>RUB</currencyId>\n`;
        xml += `        <categoryId>${catEntry.id}</categoryId>\n`;
        for (const img of allImages.slice(0, 10)) {
          xml += `        <picture>${escXml(img)}</picture>\n`;
        }
        xml += `        <description>${escXml(desc)}</description>\n`;
        xml += `        <vendor>BMGBRAND</vendor>\n`;
        xml += `        <vendorCode>${escXml(p.article || p.sku || String(p.id))}</vendorCode>\n`;
        xml += `        <condition type="new"><reason/></condition>\n`;
        xml += `        <country_of_origin>Россия</country_of_origin>\n`;
        if (sizes.length > 0) {
          xml += `        <param name="Размер">${escXml(sizes.join(", "))}</param>\n`;
        }
        if (colors.length > 0) {
          xml += `        <param name="Цвет">${escXml(colors.join(", "))}</param>\n`;
        }
        xml += `      </offer>\n`;
      }

      xml += `    </offers>\n`;
      xml += `  </shop>\n`;
      xml += `</yml_catalog>`;

      res.type("application/xml").set("Content-Language", "ru").send(xml);
      console.log(`[YML] Feed generated: ${visibleProducts.length} products`);
    } catch (err) {
      console.error("[YML] Feed generation error:", err);
      res.status(500).type("text/plain").send("YML feed generation failed");
    }
  });

  // ==================== Ozon Product Feed ====================
  // Отдельный фид для загрузки товаров на Ozon Marketplace (YML-совместимый формат)
  // URL: /ozon-feed.xml
  // Яндексовый фид (/yml-feed.xml) не затронут.
  app.get("/ozon-feed.xml", async (_req, res) => {
    const now = new Date().toISOString().replace("T", " ").slice(0, 16);

    // Маппинг наших подкатегорий → категории Ozon (путь для импорта)
    // ID подбираются по дереву категорий в ЛК Ozon (Seller Cabinet → Товары → Категории)
    const SUBCATEGORY_TO_OZON: Record<string, { id: number; name: string }> = {
      "hoodies":      { id: 101, name: "Толстовки и худи" },
      "sweatshirts":  { id: 102, name: "Свитшоты" },
      "sweaters":     { id: 103, name: "Свитеры" },
      "shorts":       { id: 104, name: "Шорты" },
      "pants":        { id: 105, name: "Брюки и джоггеры" },
      "joggers":      { id: 105, name: "Брюки и джоггеры" },
      "t-shirts":     { id: 106, name: "Футболки и поло" },
      "jackets":      { id: 107, name: "Куртки и ветровки" },
    };
    const CATEGORY_FALLBACK: Record<string, { id: number; name: string }> = {
      "clothing":    { id: 100, name: "Мужская одежда" },
      "merch":       { id: 100, name: "Мужская одежда" },
      "socks":       { id: 200, name: "Носки" },
      "accessories": { id: 300, name: "Аксессуары" },
      "sale":        { id: 100, name: "Мужская одежда" },
    };

    // Все уникальные категории для секции <categories>
    const usedCats = new Map<number, string>();

    const escXml = (s: string) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    // Определяем пол по подкатегории/названию товара
    const detectGender = (product: any): string => {
      const name = (product.name || "").toLowerCase();
      if (name.includes("женск") || name.includes("женщ")) return "Женский";
      if (name.includes("детск") || name.includes("ребён")) return "Детский";
      return "Унисекс";
    };

    // Определяем сезон по описанию/категории
    const detectSeason = (product: any): string => {
      const desc = (product.description || product.name || "").toLowerCase();
      if (desc.includes("зим") || desc.includes("утеплён") || desc.includes("флис")) return "Зима";
      if (desc.includes("лет") || desc.includes("летн")) return "Лето";
      return "Всесезонный";
    };

    // Вес и габариты по типу товара (примерные, для расчёта доставки)
    const getWeightAndDims = (product: any): { weight: string; dims: string } => {
      const sub = (product.subcategory || "").toLowerCase();
      const cat = (product.category || "").toLowerCase();
      if (cat === "socks") return { weight: "0.1", dims: "15/10/3" };
      if (["hoodies", "sweatshirts", "sweaters", "jackets"].includes(sub))
        return { weight: "0.6", dims: "40/30/5" };
      if (["shorts", "t-shirts"].includes(sub))
        return { weight: "0.3", dims: "30/25/3" };
      if (["pants", "joggers"].includes(sub))
        return { weight: "0.5", dims: "40/30/4" };
      return { weight: "0.4", dims: "35/25/4" };
    };

    try {
      const allProducts = await storage.getProducts();
      const visibleProducts = allProducts.filter((p: any) =>
        !p.isHidden &&
        p.imageUrl && p.imageUrl.startsWith("https://") &&
        p.price && p.price > 0
      );

      // Собираем используемые категории
      for (const product of visibleProducts) {
        const p = product as any;
        const sub = (p.subcategory || "").toLowerCase();
        const cat = SUBCATEGORY_TO_OZON[sub] || CATEGORY_FALLBACK[p.category] || CATEGORY_FALLBACK["clothing"];
        usedCats.set(cat.id, cat.name);
      }

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<!-- Ozon Marketplace Feed — BMGBRAND -->\n`;
      xml += `<!-- Сгенерирован: ${now} | Товаров: ${visibleProducts.length} -->\n`;
      xml += `<!-- ВАЖНО: перед загрузкой в Ozon проверьте ID категорий в ЛК продавца -->\n`;
      xml += `<yml_catalog date="${now}">\n`;
      xml += `  <shop>\n`;
      xml += `    <name>BMGBRAND</name>\n`;
      xml += `    <company>BMGBRAND (Booomerangs)</company>\n`;
      xml += `    <url>https://booomerangs.ru</url>\n`;
      xml += `    <currencies>\n`;
      xml += `      <currency id="RUB" rate="1"/>\n`;
      xml += `    </currencies>\n`;
      xml += `    <categories>\n`;
      for (const [id, name] of usedCats) {
        xml += `      <category id="${id}">${escXml(name)}</category>\n`;
      }
      xml += `    </categories>\n`;
      xml += `    <offers>\n`;

      for (const product of visibleProducts) {
        const p = product as any;
        const sub = (p.subcategory || "").toLowerCase();
        const catEntry = SUBCATEGORY_TO_OZON[sub] || CATEGORY_FALLBACK[p.category] || CATEGORY_FALLBACK["clothing"];
        const priceRub = (p.price / 100).toFixed(2);
        const available = (p.stock == null || p.stock > 0) ? "true" : "false";
        const { weight, dims } = getWeightAndDims(p);
        const gender = detectGender(p);
        const season = detectSeason(p);

        // Изображения
        const allImages: string[] = [];
        if (p.imageUrl?.startsWith("https://")) allImages.push(p.imageUrl);
        if (Array.isArray(p.images)) {
          for (const img of p.images) {
            if (typeof img === "string" && img.startsWith("https://") && !allImages.includes(img)) {
              allImages.push(img);
            }
          }
        }

        const sizes: string[] = Array.isArray(p.sizes) ? p.sizes : [];
        const colors: string[] = Array.isArray(p.colors)
          ? p.colors.filter((c: string) => c && c !== "Default")
          : [];

        const desc = p.description
          ? p.description.slice(0, 2000)
          : `${p.name} — купить в BMGBRAND. Доставка по всей России.`;

        // vendorCode = артикул из 1С или внутренний ID
        const vendorCode = p.article || p.sku || String(p.id);

        xml += `      <offer id="${escXml(String(p.id))}" available="${available}">\n`;
        xml += `        <url>https://booomerangs.ru/${escXml(p.slug || String(p.id))}</url>\n`;
        xml += `        <name>${escXml(p.name)}</name>\n`;
        xml += `        <price>${priceRub}</price>\n`;
        if (p.discountPercent && p.discountPercent > 0 && p.discountPercent < 100) {
          const oldPriceRub = (p.price / (1 - p.discountPercent / 100) / 100).toFixed(2);
          xml += `        <oldprice>${oldPriceRub}</oldprice>\n`;
        }
        xml += `        <currencyId>RUB</currencyId>\n`;
        xml += `        <categoryId>${catEntry.id}</categoryId>\n`;
        for (const img of allImages.slice(0, 15)) {
          xml += `        <picture>${escXml(img)}</picture>\n`;
        }
        xml += `        <description>${escXml(desc)}</description>\n`;
        xml += `        <vendor>BMGBRAND</vendor>\n`;
        xml += `        <vendorCode>${escXml(vendorCode)}</vendorCode>\n`;
        xml += `        <country_of_origin>Россия</country_of_origin>\n`;
        xml += `        <weight>${weight}</weight>\n`;
        xml += `        <dimensions>${dims}</dimensions>\n`;
        // Обязательные атрибуты Ozon для одежды
        xml += `        <param name="Пол">${escXml(gender)}</param>\n`;
        xml += `        <param name="Сезон">${escXml(season)}</param>\n`;
        // Состав ткани — заполните реальными данными или обновите через ЛК Ozon
        xml += `        <param name="Состав">Хлопок 80%, Полиэстер 20%</param>\n`;
        if (sizes.length > 0) {
          // Каждый размер — отдельный param для Ozon
          for (const size of sizes) {
            xml += `        <param name="Размер">${escXml(size)}</param>\n`;
          }
        }
        if (colors.length > 0) {
          for (const color of colors) {
            xml += `        <param name="Цвет">${escXml(color)}</param>\n`;
          }
        }
        xml += `        <param name="Бренд">BMGBRAND</param>\n`;
        xml += `        <param name="Вид одежды">${escXml(catEntry.name)}</param>\n`;
        xml += `      </offer>\n`;
      }

      xml += `    </offers>\n`;
      xml += `  </shop>\n`;
      xml += `</yml_catalog>`;

      res.type("application/xml").set("Content-Language", "ru").send(xml);
      console.log(`[OzonFeed] Generated: ${visibleProducts.length} products`);
    } catch (err) {
      console.error("[OzonFeed] Generation error:", err);
      res.status(500).type("text/plain").send("Ozon feed generation failed");
    }
  });

  // Stock notifications - public
  app.post("/api/stock-notify", async (req, res) => {
    try {
      const { productId, productName, size, email } = req.body;
      if (!productId || !size || !email) {
        return res.status(400).json({ error: "productId, size, and email are required" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email" });
      }
      await storage.createStockNotification(Number(productId), productName || '', size, email);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[StockNotify] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/stock-notify/count/:productId", async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });
      const size = req.query.size as string | undefined;
      const count = await storage.getStockNotificationCount(productId, size);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Price drop subscriptions - public
  app.post("/api/price-drop-notify", async (req, res) => {
    try {
      const { productId, productName, email } = req.body;
      if (!productId || !email) return res.status(400).json({ error: "productId and email are required" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ error: "Invalid email" });
      const product = await storage.getProduct(Number(productId));
      if (!product) return res.status(404).json({ error: "Product not found" });
      const alreadySubscribed = await storage.checkPriceDropSubscription(Number(productId), email);
      if (alreadySubscribed) return res.json({ success: true, alreadySubscribed: true });
      const baseP = product.price || 0;
      const discP = (product as any).discountPercent || 0;
      const effectiveP = discP > 0 ? Math.round(baseP * (1 - discP / 100)) : baseP;
      await storage.createPriceDropSubscription(Number(productId), productName || product.name || '', email, effectiveP);
      res.json({ success: true, alreadySubscribed: false });
    } catch (err: any) {
      console.error("[PriceDrop] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/price-drop-notify/check", async (req, res) => {
    try {
      const productId = Number(req.query.productId);
      const email = String(req.query.email || '');
      if (!productId || !email) return res.status(400).json({ error: "productId and email are required" });
      const subscribed = await storage.checkPriceDropSubscription(productId, email);
      res.json({ subscribed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/price-drop-notify/my", async (req, res) => {
    try {
      const email = String(req.query.email || '');
      if (!email) return res.json({ productIds: [], subscriptions: [] });
      const [productIds, subscriptions] = await Promise.all([
        storage.getSubscribedProductIdsByEmail(email),
        storage.getPriceDropSubscriptionsByEmail(email),
      ]);
      res.json({ productIds, subscriptions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/price-drop-notify", async (req, res) => {
    try {
      const { productId, email } = req.body;
      if (!productId || !email) return res.status(400).json({ error: "productId and email are required" });
      await storage.deletePriceDropSubscription(Number(productId), String(email));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/stock-notify/my", async (req, res) => {
    try {
      const email = String(req.query.email || '');
      if (!email) return res.json({ subscriptions: [] });
      const subscriptions = await storage.getStockNotificationsByEmail(email);
      res.json({ subscriptions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/stock-notify", async (req, res) => {
    try {
      const { productId, size, email } = req.body;
      if (!productId || !size || !email) return res.status(400).json({ error: "productId, size and email are required" });
      await storage.deleteStockNotification(Number(productId), String(size), String(email));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/price-drop-notify", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const subscriptions = await storage.getAllPriceDropSubscriptions();
      res.json(subscriptions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Test email (admin only)
  app.post("/api/admin/test-email", async (req, res) => {
    const reqUser = (req as any).user;
    if (!reqUser || reqUser.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "to is required" });
    try {
      const { sendEmail } = await import('./email');
      const ok = await sendEmail({
        to,
        subject: `[TEST] Тест email от BOOOMERANGS`,
        html: `<p>Это тестовое письмо от BOOOMERANGS. Если вы его видите — SMTP работает корректно.</p><p>Время: ${new Date().toISOString()}</p>`,
      });
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary: create a test order in "paid" status for artist stats testing
  app.post("/api/admin/test-order", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { items, customerName = "Тест Покупатель", customerEmail = "test-buyer@bmgtest.ru", refSlug } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array required" });
      }
      const total = items.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0);
      const order = await storage.createOrder({
        sessionId: `test_${Date.now()}`,
        customerName,
        customerEmail,
        customerPhone: "+70000000000",
        address: "Тестовый адрес, г. Москва",
        items,
        total,
        isWholesale: false,
        transportCompany: "cdek",
      });
      await storage.updateOrderStatus(order.id, "paid");

      const commissionsCreated: string[] = [];

      // Ref-commission (if refSlug provided — simulates buyer coming via ref link)
      if (refSlug) {
        try {
          const refPartner = await getApprovedPartnerCached(String(refSlug).toLowerCase());
          if (refPartner) {
            const now = new Date();
            const monthlyYear = now.getUTCFullYear();
            const monthlyMonth = now.getUTCMonth() + 1;

            if (refPartner.isArtist) {
              // Артист как реферер: собственные товары — по artistRate, чужие — по commissionOverride ?? artistRate.
              const globalPercent = await getGlobalPartnerCommissionPercentCached();

              // Считаем сумму собственных товаров артиста в тест-корзине
              let ownRaw = 0;
              for (const item of items) {
                const itemArtistSlug = item.artistSlug as string | null | undefined;
                if (itemArtistSlug === refPartner.partnerSlug) {
                  ownRaw += (item.price || 0) * (item.quantity || 1);
                }
              }
              // В тест-заказе total = сумма позиций, скидки уже учтены в total
              const ownBase = Math.min(ownRaw, total);
              const nonOwnBase = Math.max(0, total - ownBase);

              // Собственные товары артиста через его реф-ссылку — реф-комиссия НЕ создаётся.
              // Продажа учитывается только в дашборде артиста (getArtistStatsBySlug).

              // Комиссия за чужие товары (commissionOverride ?? artistRate ?? global)
              if (nonOwnBase > 0) {
                const refRate = refPartner.commissionOverride ?? refPartner.artistRate ?? globalPercent ?? PARTNER_DEFAULT_COMMISSION_PERCENT;
                const refRateSource = refPartner.commissionOverride != null ? 'override' : refPartner.artistRate != null ? 'artistRate' : 'global';
                const nonOwnAmount = Math.round(nonOwnBase * refRate / 100);
                await storage.createPartnerCommission({
                  partnerId: refPartner.id,
                  orderId: order.id,
                  orderItemsTotal: nonOwnBase,
                  commissionPercent: refRate,
                  commissionAmount: nonOwnAmount,
                  commissionType: 'referral',
                });
                commissionsCreated.push(`ref-nonown:${refSlug} ${refRate}% (${refRateSource}) = ${nonOwnAmount / 100}₽`);
                console.log(`[TestOrder] Artist non-own ref commission: order=${order.id} partner=${refSlug} base=${nonOwnBase / 100} percent=${refRate} (${refRateSource}) amount=${nonOwnAmount / 100}`);
              }

            } else if (refPartner.commissionOverride != null) {
              // Обычный партнёр с индивидуальной ставкой
              const commissionAmount = Math.round(total * refPartner.commissionOverride / 100);
              await storage.createPartnerCommission({
                partnerId: refPartner.id,
                orderId: order.id,
                orderItemsTotal: total,
                commissionPercent: refPartner.commissionOverride,
                commissionAmount,
                commissionType: 'referral',
              });
              commissionsCreated.push(`ref:${refSlug} ${refPartner.commissionOverride}% (override) = ${commissionAmount / 100}₽`);
              console.log(`[TestOrder] Ref commission: order=${order.id} partner=${refSlug} percent=${refPartner.commissionOverride} (override) amount=${commissionAmount / 100}`);

            } else {
              // Прогрессивная шкала
              const monthlyCommissions = await storage.getMonthlyRefCommissions(refPartner.id, monthlyYear, monthlyMonth);
              const monthlyTotal = monthlyCommissions.reduce((s, c) => s + c.orderItemsTotal, 0) + total;
              const effectivePercent = getProgressiveCommissionRate(monthlyTotal);
              const percentSource = `progressive(${(monthlyTotal / 100).toFixed(0)}₽)`;
              const commissionAmount = Math.round(total * effectivePercent / 100);
              await storage.createPartnerCommission({
                partnerId: refPartner.id,
                orderId: order.id,
                orderItemsTotal: total,
                commissionPercent: effectivePercent,
                commissionAmount,
                commissionType: 'referral',
              });
              await storage.recalcMonthlyCommissions(refPartner.id, monthlyYear, monthlyMonth, effectivePercent);
              commissionsCreated.push(`ref:${refSlug} ${effectivePercent}% (${percentSource}) = ${commissionAmount / 100}₽`);
              console.log(`[TestOrder] Ref commission: order=${order.id} partner=${refSlug} percent=${effectivePercent} (${percentSource}) amount=${commissionAmount / 100}`);
            }
          } else {
            console.warn(`[TestOrder] refSlug '${refSlug}' not found or not approved`);
          }
        } catch (e: any) {
          console.error('[TestOrder] Ref commission error:', e?.message);
        }
      }

      // Artist-commissions: per item artistSlug field
      try {
        const artistItemsMap = new Map<string, { totalAmount: number }>();
        for (const item of items) {
          const artistSlug = item.artistSlug as string | null | undefined;
          if (!artistSlug) continue;
          const itemAmount = (item.price || 0) * (item.quantity || 1);
          const entry = artistItemsMap.get(artistSlug);
          if (entry) { entry.totalAmount += itemAmount; }
          else { artistItemsMap.set(artistSlug, { totalAmount: itemAmount }); }
        }
        for (const [artistSlug, { totalAmount }] of artistItemsMap) {
          if (totalAmount <= 0) continue;
          const artist = await getApprovedPartnerCached(artistSlug);
          if (!artist || !artist.isArtist || artist.artistRate == null) continue;
          const commissionAmount = Math.round(totalAmount * artist.artistRate / 100);
          await storage.createPartnerCommission({
            partnerId: artist.id,
            orderId: order.id,
            orderItemsTotal: totalAmount,
            commissionPercent: artist.artistRate,
            commissionAmount,
            commissionType: 'artist',
          });
          commissionsCreated.push(`artist:${artistSlug} ${artist.artistRate}% = ${commissionAmount / 100}₽`);
          console.log(`[TestOrder] Artist commission: order=${order.id} artist=${artistSlug} base=${totalAmount / 100} percent=${artist.artistRate} amount=${commissionAmount / 100} type=artist`);
        }
      } catch (e: any) {
        console.error('[TestOrder] Artist commission error:', e?.message);
      }

      res.json({ success: true, orderId: order.id, total, commissionsCreated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary: delete a test commission by id
  app.delete("/api/admin/test-commission/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const ydbMod = await import("ydb-sdk");
      const ydbDriver = await waitForDriver();
      if (!ydbDriver) return res.status(503).json({ error: "YDB not available" });
      await ydbDriver.tableClient.withSession(async (session: any) => {
        await session.executeQuery(
          `DECLARE $id AS Uint64; DELETE FROM partner_commissions WHERE id = $id`,
          { $id: ydbMod.TypedValues.uint64(Number(req.params.id)) }
        );
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Migrate commission_type for legacy NULL records
  // Checks each commission's order items against partner's artist products
  app.post("/api/admin/migrate-commission-types", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const ydbMod = await import("ydb-sdk");
      const ydbDriver = await waitForDriver();
      if (!ydbDriver) return res.status(503).json({ error: "YDB not available" });

      // 1. Fetch all commissions with NULL commission_type
      const nullRows: any[] = await ydbDriver.tableClient.withSession(async (session: any) => {
        const r = await session.executeQuery(
          `SELECT id, partner_id, order_id FROM partner_commissions WHERE commission_type IS NULL LIMIT 500;`
        );
        const rs = r.resultSets[0];
        if (!rs?.rows || !rs.columns) return [];
        return rs.rows.map((row: any) => {
          const cols = row.items || [];
          const getValue = (i: number) => {
            const c = cols[i];
            if (!c) return null;
            const k = Object.keys(c).find(k => k !== 'null_flag_value');
            return k ? (c as any)[k] : null;
          };
          return {
            id: Number(getValue(0)),
            partnerId: Number(getValue(1)),
            orderId: Number(getValue(2)),
          };
        });
      });

      if (nullRows.length === 0) return res.json({ updated: 0, message: "Нет записей с NULL commission_type" });

      // 2. Build map: partnerId → Set of artist product names (lowercase)
      const allProducts = (await storage.getProducts()) as any[];
      const partnerProductNames = new Map<number, Set<string>>();

      // 3. For each commission, determine type
      let updatedArtist = 0;
      let updatedReferral = 0;

      for (const row of nullRows) {
        // Get this partner's artist product names (cached per partner)
        if (!partnerProductNames.has(row.partnerId)) {
          const partner = await storage.getPartnerById(row.partnerId);
          if (partner?.partnerSlug) {
            const names = new Set<string>(
              allProducts
                .filter((p: any) => p.artistSlug === partner.partnerSlug)
                .map((p: any) => (p.name || '').toLowerCase())
            );
            partnerProductNames.set(row.partnerId, names);
          } else {
            partnerProductNames.set(row.partnerId, new Set());
          }
        }

        const artistNames = partnerProductNames.get(row.partnerId) || new Set();
        let commType = 'referral';

        if (artistNames.size > 0) {
          // Check order items
          const order = await storage.getOrder(row.orderId);
          if (order?.items && Array.isArray(order.items)) {
            const hasArtistItem = order.items.some((item: any) => {
              const name = (item.productName || item.name || '').toLowerCase();
              return artistNames.has(name);
            });
            if (hasArtistItem) commType = 'artist';
          }
        }

        // Update the record
        await ydbDriver.tableClient.withSession(async (session: any) => {
          await session.executeQuery(
            `DECLARE $id AS Uint64; DECLARE $type AS Utf8;
             UPDATE partner_commissions SET commission_type = $type WHERE id = $id;`,
            {
              $id: ydbMod.TypedValues.uint64(row.id),
              $type: ydbMod.TypedValues.utf8(commType),
            }
          );
        });

        if (commType === 'artist') updatedArtist++;
        else updatedReferral++;
      }

      res.json({ updated: nullRows.length, artist: updatedArtist, referral: updatedReferral });
    } catch (err: any) {
      console.error('[Migrate commission types]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary: delete a test order by id
  app.delete("/api/admin/test-order/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const ydbMod = await import("ydb-sdk");
      const ydbDriver = await waitForDriver();
      if (!ydbDriver) return res.status(503).json({ error: "YDB not available" });
      await ydbDriver.tableClient.withSession(async (session: any) => {
        await session.executeQuery(
          `DECLARE $id AS Uint64; DELETE FROM orders WHERE id = $id`,
          { $id: ydbMod.TypedValues.uint64(Number(req.params.id)) }
        );
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reviews - public
  app.get("/api/reviews/:productId", async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });
      const reviews = await storage.getReviewsByProduct(productId);
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/reviews", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Для отправки отзыва необходимо войти в аккаунт" });
      }
      const { productId, rating, comment } = req.body;
      if (!productId || !rating) {
        return res.status(400).json({ error: "productId and rating are required" });
      }
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" });
      }
      const review = await storage.createReview({
        productId: Number(productId),
        authorName: user.name,
        rating: Number(rating),
        comment: comment ? String(comment).trim() : null,
        userId: user.id,
      });

      try {
        const product = await storage.getProduct(Number(productId));
        notifyNewReview({
          authorName: user.name || "Аноним",
          rating: Number(rating),
          comment: comment ? String(comment).trim() : null,
          productName: product?.name || `Товар #${productId}`,
          productId: Number(productId),
          reviewId: review.id,
        });
        vkNotifyNewReview({
          authorName: user.name || "Аноним",
          rating: Number(rating),
          comment: comment ? String(comment).trim() : null,
          productName: product?.name || `Товар #${productId}`,
          productId: Number(productId),
          reviewId: review.id,
        });
      } catch (tgErr: any) {
        console.error("[Reviews] Telegram notify error:", tgErr.message);
      }

      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Merch order form
  app.post("/api/merch-order", async (req, res) => {
    try {
      const { name, company, productType, quantity, contact, message } = req.body;
      if (!name || !productType || !quantity || !contact) {
        return res.status(400).json({ error: "Заполните обязательные поля" });
      }
      notifyMerchOrder({ name: String(name), company: company ? String(company) : undefined, productType: String(productType), quantity: String(quantity), contact: String(contact), message: message ? String(message) : undefined });
      vkNotifyMerchOrder({ name: String(name), company: company ? String(company) : undefined, productType: String(productType), quantity: String(quantity), contact: String(contact), message: message ? String(message) : undefined });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Initialize default promo codes (WELCOME10 for popup, WELCOME7 for homepage)
  // Store promo IDs in bonus_settings for stable identification
  (async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const popupPromoId = await storage.getBonusSetting("popup_promo_id");
      await new Promise(resolve => setTimeout(resolve, 500));
      const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
      await new Promise(resolve => setTimeout(resolve, 500));
      const allPromos = await storage.getPromoCodes();
      
      // Find or create popup promo
      let popupPromo = popupPromoId ? allPromos.find((p: any) => String(p.id) === popupPromoId) : null;
      if (!popupPromo) {
        popupPromo = allPromos.find((p: any) => p.code === "WELCOME10");
      }
      if (!popupPromo) {
        const newPromo = await storage.createPromoCode({
          code: "WELCOME10",
          discountPercent: 10,
          isActive: true,
        });
        await storage.setBonusSetting("popup_promo_id", String(newPromo.id));
        console.log("[Init] Created WELCOME10 promo code, ID:", newPromo.id);
      } else if (!popupPromoId) {
        await storage.setBonusSetting("popup_promo_id", String(popupPromo.id));
        console.log("[Init] Stored popup promo ID:", popupPromo.id);
      }
      
      // Find or create homepage promo
      let homepagePromo = homepagePromoId ? allPromos.find((p: any) => String(p.id) === homepagePromoId) : null;
      if (!homepagePromo) {
        homepagePromo = allPromos.find((p: any) => p.code === "WELCOME7");
      }
      if (!homepagePromo) {
        const newPromo = await storage.createPromoCode({
          code: "WELCOME7",
          discountPercent: 7,
          isActive: true,
        });
        await storage.setBonusSetting("homepage_promo_id", String(newPromo.id));
        console.log("[Init] Created WELCOME7 promo code, ID:", newPromo.id);
      } else if (!homepagePromoId) {
        await storage.setBonusSetting("homepage_promo_id", String(homepagePromo.id));
        console.log("[Init] Stored homepage promo ID:", homepagePromo.id);
      }
    } catch (err) {
      console.error("[Init] Failed to create default promo codes:", err);
    }
  })();

  // Auth routes
  app.use("/api/auth", authRoutes);

  // Partner platform routes
  app.use("/api/partner", partnerRoutes);
  app.use("/api/admin", adminPartnerRoutes);
  // Redirect /r/:slug — sets ref cookie + counts click + redirects (target via ?to=/path)
  app.get("/r/:slug", partnerRefRedirectHandler);
  // Apply ?ref=slug query middleware globally so any landing URL with ?ref= sets the cookie
  app.use(partnerRefQueryMiddleware);

  // Register Telegram wholesale bot webhook
  // Strip www. prefix — Telegram does not follow 301 redirects, www→non-www redirect breaks webhooks
  const tgWebhookBase = (process.env.APP_DOMAIN || process.env.SITE_URL || 'https://booomerangs.ru')
    .replace('https://www.', 'https://')
    .replace('http://www.', 'http://');
  registerWholesaleWebhook(`${tgWebhookBase}/api/auth/telegram/webhook`).catch(err => {
    console.error('[Init] Failed to register Telegram webhook:', err);
  });

  // Register chat webhook for retail bot (replies from admin)
  setTimeout(() => {
    registerChatWebhook(`${tgWebhookBase}/api/telegram/chat-webhook`).catch(err => {
      console.error('[Init] Failed to register chat webhook:', err);
    });
  }, 2000);

  // ============================================
  // CHAT API
  // ============================================

  app.post("/api/chat/upload-image", authMiddleware, async (req: any, res) => {
    try {
      const { imageData, sessionId } = req.body;
      console.log(`[Chat] Upload image request: sessionId=${sessionId?.slice(0, 8)}, hasImageData=${!!imageData}, dataLength=${imageData?.length || 0}`);
      if (!imageData || !sessionId) {
        return res.status(400).json({ error: "imageData and sessionId are required" });
      }
      const match = imageData.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (!match) {
        console.error("[Chat] Invalid image data format");
        return res.status(400).json({ error: "Invalid image data" });
      }
      const mimeType = match[1];
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      const base64Data = imageData.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      console.log(`[Chat] Image buffer size: ${buffer.length} bytes, type: ${mimeType}`);
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "Image too large (max 5MB)" });
      }
      const filename = `chat_images/chat_${sessionId.slice(0, 8)}_${Date.now()}.${ext}`;
      const url = await uploadToYandexStorage(buffer, filename, mimeType);
      console.log(`[Chat] S3 upload result: ${url ? url : 'NULL (failed)'}`);
      if (!url) {
        return res.status(500).json({ error: "Failed to upload image" });
      }
      res.json({ url });
    } catch (err: any) {
      console.error("[Chat] Image upload error:", err.message);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.post("/api/chat/message", authMiddleware, async (req: any, res) => {
    try {
      const { sessionId, text, userName, userId, imageUrl } = req.body;
      if (!sessionId || (!text?.trim() && !imageUrl)) {
        return res.status(400).json({ error: "sessionId and text or imageUrl are required" });
      }
      const isWholesale = (req as any).user?.role === 'wholesale';
      const effectiveUserName = userName || (req as any).user?.name || undefined;
      const effectiveUserId = userId || ((req as any).user?.id ? String((req as any).user.id) : undefined);
      const { randomUUID } = await import("crypto");
      const messageId = randomUUID();
      const timestamp = Date.now();
      const msgText = text?.trim() || (imageUrl ? '📷 Фото' : '');
      const tgMessageId = await sendChatNotification(sessionId, msgText, effectiveUserName, isWholesale, imageUrl || undefined);
      await storage.saveChatMessage({
        messageId,
        sessionId,
        sender: 'client',
        text: msgText,
        timestamp,
        userId: effectiveUserId,
        userName: effectiveUserName,
        tgMessageId: tgMessageId || undefined,
        imageUrl: imageUrl || undefined,
      });
      res.json({ success: true, messageId, timestamp });
    } catch (err: any) {
      console.error("[Chat] Error saving message:", err.message);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.get("/api/chat/messages/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const since = req.query.since ? Number(req.query.since) : undefined;
      const messages = await storage.getChatMessages(sessionId, since);
      res.json({ messages });
    } catch (err: any) {
      console.error("[Chat] Error fetching messages:", err.message);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Telegram webhook for retail bot — receives admin replies
  app.post("/api/telegram/chat-webhook", async (req, res) => {
    try {
      res.sendStatus(200);
      const update = req.body;

      // Handle inline button callbacks for review moderation
      const callbackQuery = update?.callback_query;
      if (callbackQuery) {
        const callbackId = callbackQuery.id;
        const data: string = callbackQuery.data || '';
        const chatId = String(callbackQuery.message?.chat?.id || '');
        const messageId: number = callbackQuery.message?.message_id;
        const originalText: string = callbackQuery.message?.text || '';
        const retailToken = process.env.TELEGRAM_BOT_TOKEN || '';

        if (data.startsWith('review_approve:')) {
          const reviewId = parseInt(data.split(':')[1]);
          if (!isNaN(reviewId)) {
            try {
              await storage.updateReview(reviewId, { isApproved: true });
              console.log(`[Telegram] Review ${reviewId} approved via Telegram button`);
              warmRatingsCache(storage).catch(() => {});
              await answerCallbackQuery(callbackId, '✅ Отзыв одобрен!', retailToken);
              await editMessageText(chatId, messageId, originalText + '\n\n✅ <b>Одобрен</b> (через Telegram)', retailToken);
            } catch (e: any) {
              await answerCallbackQuery(callbackId, '❌ Ошибка при одобрении', retailToken);
              console.error('[Telegram] Error approving review:', e.message);
            }
          }
        } else if (data.startsWith('review_reject:')) {
          const reviewId = parseInt(data.split(':')[1]);
          if (!isNaN(reviewId)) {
            try {
              await storage.deleteReview(reviewId);
              console.log(`[Telegram] Review ${reviewId} rejected via Telegram button`);
              await answerCallbackQuery(callbackId, '❌ Отзыв отклонён', retailToken);
              await editMessageText(chatId, messageId, originalText + '\n\n❌ <b>Отклонён</b> (через Telegram)', retailToken);
            } catch (e: any) {
              await answerCallbackQuery(callbackId, '❌ Ошибка при отклонении', retailToken);
              console.error('[Telegram] Error rejecting review:', e.message);
            }
          }
        }
        return;
      }

      // Handle text replies from admin (live chat)
      const message = update?.message;
      console.log(`[Chat] Webhook received: message=${!!message}, text=${!!message?.text}, reply_to=${!!message?.reply_to_message}`);
      if (!message?.text) {
        if (message) console.log(`[Chat] Skipping: no text (possible photo/sticker/voice reply from admin)`);
        return;
      }
      // Only process replies (admin replying to bot messages)
      const replyToId = message?.reply_to_message?.message_id;
      if (!replyToId) {
        console.log(`[Chat] Skipping: admin message is not a reply (from: ${message.from?.first_name})`);
        return;
      }
      // Find which chat session this reply belongs to
      const sessionId = await storage.getSessionIdByTgMessageId(replyToId);
      if (!sessionId) {
        console.warn(`[Chat] Session not found for tgMessageId=${replyToId} — message may have been saved without tgMessageId`);
        return;
      }
      // Save admin reply
      const { randomUUID } = await import("crypto");
      const adminName = message.from?.first_name || 'Менеджер';
      await storage.saveChatMessage({
        messageId: randomUUID(),
        sessionId,
        sender: 'admin',
        text: message.text,
        timestamp: Date.now(),
        userName: adminName,
      });
      console.log(`[Chat] Admin reply saved for session ${sessionId.slice(0, 8)}, from: ${adminName}`);
    } catch (err: any) {
      console.error("[Chat] Webhook error:", err.message);
    }
  });

  // ============================================
  // VK ACTION ENDPOINT (one-click approve/reject)
  // ============================================

  app.get("/api/vk-action", async (req: any, res) => {
    const { act, id, exp, sig } = req.query as Record<string, string>;

    const htmlPage = (ok: boolean, message: string) => `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ok ? "Готово" : "Ошибка"}</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 16px; padding: 40px 32px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h2 { margin: 0 0 8px; font-size: 22px; color: #111; }
    p { margin: 0; color: #666; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${ok ? "✅" : "❌"}</div>
    <h2>${ok ? "Готово!" : "Ошибка"}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;

    if (!act || !id || !exp || !sig) {
      return res.status(400).send(htmlPage(false, "Неверная ссылка — отсутствуют параметры."));
    }

    let valid = false;
    try {
      valid = verifyActionLink(act, id, exp, sig);
    } catch {
      return res.status(400).send(htmlPage(false, "Ошибка проверки подписи."));
    }

    if (!valid) {
      return res.status(403).send(htmlPage(false, "Ссылка недействительна или срок её действия истёк (7 дней)."));
    }

    const numId = parseInt(id);
    if (isNaN(numId)) {
      return res.status(400).send(htmlPage(false, "Неверный ID."));
    }

    try {
      if (act === "wh_approve") {
        const success = await authStorage.approveWholesale(numId, true, 30);
        if (!success) return res.send(htmlPage(false, "Не удалось найти пользователя или он уже обработан."));
        await authStorage.verifyEmailAdmin(numId);
        console.log(`[VK Action] Wholesale user ${numId} approved`);
        return res.send(htmlPage(true, "Клиент принят. Скидка 30% активирована, письмо отправлено."));

      } else if (act === "wh_reject") {
        const success = await authStorage.approveWholesale(numId, false, 0);
        if (!success) return res.send(htmlPage(false, "Не удалось найти пользователя или он уже обработан."));
        console.log(`[VK Action] Wholesale user ${numId} rejected`);
        return res.send(htmlPage(true, "Заявка отклонена."));

      } else if (act === "review_approve") {
        await storage.updateReview(numId, { isApproved: true });
        warmRatingsCache(storage).catch(() => {});
        console.log(`[VK Action] Review ${numId} approved`);
        return res.send(htmlPage(true, "Отзыв опубликован на сайте."));

      } else if (act === "review_reject") {
        await storage.deleteReview(numId);
        warmRatingsCache(storage).catch(() => {});
        console.log(`[VK Action] Review ${numId} rejected`);
        return res.send(htmlPage(true, "Отзыв удалён."));

      } else {
        return res.status(400).send(htmlPage(false, "Неизвестное действие."));
      }
    } catch (err: any) {
      console.error("[VK Action] Error:", err.message);
      return res.status(500).send(htmlPage(false, "Внутренняя ошибка сервера. Попробуйте позже."));
    }
  });

  // ============================================
  // CDEK DELIVERY API (PUBLIC - before auth)
  // ============================================

  // Search cities by name or postal code (local cache for instant autocomplete)
  cdekService.loadCitiesCache().catch(() => {});

  app.get("/api/cdek/cities", async (req, res) => {
    try {
      const { city, postal_code } = req.query;
      
      if (!city && !postal_code) {
        return res.status(400).json({ error: "Укажите city или postal_code" });
      }

      if (typeof postal_code === 'string') {
        const cities = await cdekService.getCities({
          country_codes: "RU",
          postal_code,
          size: 50,
        });
        return res.json(cities);
      }

      const cityStr = typeof city === 'string' ? city : '';
      
      if (cdekService.isCitiesCacheReady()) {
        const results = cdekService.searchCitiesLocal(cityStr, 20);
        return res.json(results);
      }

      const cities = await cdekService.getCities({
        country_codes: "RU",
        city: cityStr,
        size: 50,
      });
      res.json(cities);
    } catch (error: any) {
      console.error("[CDEK] Cities error:", error.message);
      res.status(500).json({ error: "Ошибка при поиске городов" });
    }
  });

  // Get delivery points (PVZ) by city code
  app.get("/api/cdek/delivery-points", async (req, res) => {
    try {
      const { city_code, postal_code, type } = req.query;
      
      if (!city_code && !postal_code) {
        return res.status(400).json({ error: "Укажите city_code или postal_code" });
      }
      
      const cityCodeNum = city_code ? Number(city_code) : undefined;
      if (city_code && isNaN(cityCodeNum!)) {
        return res.status(400).json({ error: "city_code должен быть числом" });
      }
      
      const points = await cdekService.getDeliveryPoints({
        city_code: cityCodeNum,
        postal_code: typeof postal_code === 'string' ? postal_code : undefined,
        type: (typeof type === 'string' ? type : "PVZ") as any,
        country_code: "RU",
        size: 100,
      });
      
      res.json(points);
    } catch (error: any) {
      console.error("[CDEK] Delivery points error:", error.message);
      res.status(500).json({ error: "Ошибка при получении пунктов выдачи" });
    }
  });

  // Calculate delivery cost
  app.post("/api/cdek/calculate", async (req, res) => {
    try {
      const { to_city_code, to_postal_code, to_address, weight, tariff_code } = req.body;
      
      if (!to_city_code && !to_postal_code) {
        return res.status(400).json({ error: "Укажите to_city_code или to_postal_code" });
      }
      
      const toCityCode = to_city_code ? Number(to_city_code) : undefined;
      if (to_city_code && isNaN(toCityCode!)) {
        return res.status(400).json({ error: "to_city_code должен быть числом" });
      }
      
      const packageWeight = weight ? Math.max(100, Math.min(Number(weight), 50000)) : 500;
      
      const request = {
        from_location: { code: CDEK_SENDER_CITY_CODE },
        to_location: {
          code: toCityCode,
          postal_code: typeof to_postal_code === 'string' ? to_postal_code : undefined,
          address: typeof to_address === 'string' ? to_address : undefined,
        },
        packages: [{
          weight: packageWeight,
          length: 29,
          width: 20,
          height: 5,
        }],
      };
      
      if (tariff_code) {
        const tariffCodeNum = Number(tariff_code);
        if (isNaN(tariffCodeNum)) {
          return res.status(400).json({ error: "tariff_code должен быть числом" });
        }
        const result = await cdekService.calculateTariff({
          ...request,
          tariff_code: tariffCodeNum,
        });
        return res.json({ tariffs: result ? [result] : [] });
      }
      
      const tariffs = await cdekService.calculateTariffs(request);
      
      // Filter popular tariffs
      const popularTariffs = tariffs.filter(t => 
        [136, 137, 138, 139, 366, 368].includes(t.tariff_code)
      );
      
      const result = popularTariffs.length > 0 ? popularTariffs : tariffs.slice(0, 5);
      res.json({ tariffs: result });
    } catch (error: any) {
      console.error("[CDEK] Calculate error:", error.message);
      res.status(500).json({ error: "Ошибка при расчёте доставки", details: error.message });
    }
  });

  // Get available tariffs info
  app.get("/api/cdek/tariffs", (_req, res) => {
    res.json({
      tariffs: CDEK_TARIFFS,
      descriptions: {
        136: "Посылка дверь-дверь",
        137: "Посылка дверь-склад (до ПВЗ)",
        138: "Посылка склад-дверь",
        139: "Посылка склад-склад (ПВЗ-ПВЗ)",
        366: "Посылка дверь-склад эконом",
        368: "Посылка склад-склад эконом",
      },
      from_city: "Тульская область, г. Новомосковск, ПВЗ ул. Мира 3ж",
      from_city_code: CDEK_SENDER_CITY_CODE,
    });
  });

  // Proxy for CDEK Widget v3 - compatible with official service.php format
  // Widget sends: { action: 'offices' | 'calculate', ...params }
  app.get("/api/cdek/maps-key", (_req, res) => {
    const key = process.env.CDEK_MAPS_API_KEY || '';
    res.json({ key });
  });

  app.get("/api/cdek/widget-proxy", async (req, res) => {
    try {
      const { action, ...params } = req.query;
      
      // If no action, it's initial config check
      if (!action) {
        console.log('[CDEK Widget Proxy] Initial config check');
        res.setHeader('X-Service-Version', '3.11.1');
        return res.json({ status: 'ok', version: '3.11.1' });
      }

      console.log(`[CDEK Widget Proxy] GET action=${action}`, params);
      res.setHeader('X-Service-Version', '3.11.1');

      if (action === 'offices') {
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== '' && key !== 'action' && key !== 'default_city_code') {
            queryParams.append(key, String(value));
          }
        }
        
        // Use default_city_code if city_code not provided
        if (!queryParams.has('city_code') && !queryParams.has('postal_code')) {
          const defaultCityCode = params.default_city_code;
          if (defaultCityCode) {
            queryParams.append('city_code', String(defaultCityCode));
            console.log(`[CDEK Widget Proxy GET] Using default city_code: ${defaultCityCode}`);
          } else {
            console.log('[CDEK Widget Proxy GET] No city filter, returning empty offices');
            return res.json([]);
          }
        }
        
        const url = `/deliverypoints?${queryParams.toString()}`;
        console.log(`[CDEK Widget Proxy GET] Fetching offices: ${url}`);
        const result = await (cdekService as any).request("GET", url);
        return res.json(result);
      }

      if (action === 'calculate') {
        const result = await (cdekService as any).request("POST", "/calculator/tarifflist", params);
        return res.json(result);
      }

      res.status(400).json({ message: 'Unknown action' });
    } catch (error: any) {
      console.error("[CDEK Widget Proxy] Error:", error.message);
      res.status(500).json({ error: "Proxy error", details: error.message });
    }
  });

  app.post("/api/cdek/widget-proxy", async (req, res) => {
    try {
      // Merge query params and body (widget may send action in either)
      const requestData = { ...req.query, ...req.body };
      const { action, ...params } = requestData;

      console.log(`[CDEK Widget Proxy] POST action=${action}`, JSON.stringify(params).slice(0, 200));
      res.setHeader('X-Service-Version', '3.11.1');

      if (!action) {
        return res.status(400).json({ message: 'Action is required' });
      }

      if (action === 'offices') {
        // For offices, we need to convert params to query string for GET request
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== '' && key !== 'action' && key !== 'default_city_code') {
            if (typeof value === 'object') {
              queryParams.append(key, JSON.stringify(value));
            } else {
              queryParams.append(key, String(value));
            }
          }
        }
        
        // Use default_city_code if city_code not provided
        if (!queryParams.has('city_code') && !queryParams.has('postal_code')) {
          const defaultCityCode = params.default_city_code || req.query.default_city_code;
          if (defaultCityCode) {
            queryParams.append('city_code', String(defaultCityCode));
            console.log(`[CDEK Widget Proxy POST] Using default city_code: ${defaultCityCode}`);
          } else {
            console.log('[CDEK Widget Proxy POST] No city filter provided');
            return res.json([]);
          }
        }
        
        const url = `/deliverypoints?${queryParams.toString()}`;
        console.log(`[CDEK Widget Proxy] Fetching offices: ${url}`);
        const result = await (cdekService as any).request("GET", url);
        return res.json(result);
      }

      if (action === 'calculate') {
        const calcParams = { ...params };
        delete calcParams.action;
        delete calcParams.default_city_code;
        
        if (calcParams.from_location) {
          const fl = calcParams.from_location;
          Object.keys(fl).forEach(k => { if (fl[k] === null || fl[k] === undefined || fl[k] === '') delete fl[k]; });
        }
        if (calcParams.to_location) {
          const tl = calcParams.to_location;
          Object.keys(tl).forEach(k => { if (tl[k] === null || tl[k] === undefined || tl[k] === '') delete tl[k]; });
        }
        
        const toLocation = calcParams.to_location;
        if (!toLocation || (Object.keys(toLocation).length === 0) || 
            (!toLocation.code && !toLocation.address && !toLocation.postal_code)) {
          console.log('[CDEK Widget Proxy] Empty to_location, returning empty tariffs');
          return res.json({ tariff_codes: [] });
        }
        
        console.log(`[CDEK Widget Proxy] Calculating:`, JSON.stringify(calcParams).slice(0, 300));
        const result = await (cdekService as any).request("POST", "/calculator/tarifflist", calcParams);
        return res.json(result);
      }

      res.status(400).json({ message: 'Unknown action' });
    } catch (error: any) {
      console.error("[CDEK Widget Proxy POST] Error:", error.message);
      res.status(500).json({ error: "Proxy error", details: error.message });
    }
  });
  
  // ============================================
  // YANDEX DELIVERY API
  // ============================================

  app.post("/api/yandex-delivery/geo-id", async (req, res) => {
    try {
      const { location } = req.body;
      if (!location || typeof location !== "string" || location.trim().length < 2) {
        return res.status(400).json({ error: "Location is required (min 2 chars)" });
      }
      const variants = await yandexDeliveryService.detectGeoId(location.trim());
      res.json({ variants });
    } catch (error: any) {
      console.error("[YD Route] geo-id error:", error.message);
      res.status(500).json({ error: "Failed to detect geo_id" });
    }
  });

  app.post("/api/yandex-delivery/pickup-points", async (req, res) => {
    try {
      const { geo_id } = req.body;
      if (!geo_id || typeof geo_id !== "number") {
        return res.status(400).json({ error: "geo_id is required (number)" });
      }
      const points = await yandexDeliveryService.getPickupPoints(geo_id);
      res.json({ points });
    } catch (error: any) {
      console.error("[YD Route] pickup-points error:", error.message);
      res.status(500).json({ error: "Failed to get pickup points" });
    }
  });

  app.get("/api/yandex-delivery/warehouses", async (_req, res) => {
    try {
      const warehouses = await yandexDeliveryService.listWarehouses();
      res.json({ warehouses });
    } catch (error: any) {
      console.error("[YD Route] warehouses error:", error.message);
      res.status(500).json({ error: "Failed to list warehouses" });
    }
  });

  app.post("/api/yandex-delivery/calculate", async (req, res) => {
    try {
      const { destination_address, destination_station_id, total_weight, total_price } = req.body;
      if (!destination_address && !destination_station_id) {
        return res.status(400).json({ error: "destination_address or destination_station_id required" });
      }
      const result = await yandexDeliveryService.calculatePrice({
        destinationAddress: destination_address,
        destinationStationId: destination_station_id,
        totalWeight: total_weight ? Number(total_weight) : undefined,
        totalPrice: total_price ? Number(total_price) : undefined,
      });
      if (!result) {
        return res.status(404).json({ error: "Could not calculate price for this destination" });
      }
      const pricingValue = parseFloat(String(result.pricing_total).replace(/[^\d.]/g, "")) || 0;
      res.json({
        pricing_total_rub: pricingValue,
        delivery_days: result.delivery_days || 0,
      });
    } catch (error: any) {
      console.error("[YD Route] calculate error:", error.message);
      res.status(500).json({ error: "Failed to calculate delivery price" });
    }
  });

  app.post("/api/yandex-delivery/create-order", async (req, res) => {
    try {
      const result = await yandexDeliveryService.createOffer(req.body);
      res.json(result);
    } catch (error: any) {
      console.error("[YD Route] create-order error:", error.message);
      res.status(500).json({ error: "Failed to create Yandex Delivery order" });
    }
  });

  app.post("/api/yandex-delivery/confirm", async (req, res) => {
    try {
      const { offer_id, operator_request_id } = req.body;
      if (!offer_id || !operator_request_id) {
        return res.status(400).json({ error: "offer_id and operator_request_id required" });
      }
      const result = await yandexDeliveryService.confirmOffer(offer_id, operator_request_id);
      res.json(result);
    } catch (error: any) {
      console.error("[YD Route] confirm error:", error.message);
      res.status(500).json({ error: "Failed to confirm order" });
    }
  });

  app.post("/api/yandex-delivery/cancel", async (req, res) => {
    try {
      const { request_id } = req.body;
      if (!request_id) {
        return res.status(400).json({ error: "request_id required" });
      }
      const result = await yandexDeliveryService.cancelRequest(request_id);
      res.json(result);
    } catch (error: any) {
      console.error("[YD Route] cancel error:", error.message);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  app.post("/api/yandex-delivery/status", async (req, res) => {
    try {
      const { request_id } = req.body;
      if (!request_id) {
        return res.status(400).json({ error: "request_id required" });
      }
      const result = await yandexDeliveryService.getRequestInfo(request_id);
      if (!result) {
        return res.status(404).json({ error: "Order not found" });
      }
      res.json(result);
    } catch (error: any) {
      console.error("[YD Route] status error:", error.message);
      res.status(500).json({ error: "Failed to get order status" });
    }
  });

  // ============================================
  // STOCK DECREMENT HELPER
  // ============================================

  async function decrementStockForOrderItems(orderItems: any[]): Promise<void> {
    if (!Array.isArray(orderItems) || orderItems.length === 0) return;
    for (const item of orderItems) {
      const productId = item.productId;
      const quantity = Number(item.quantity) || 1;
      const size = item.size || null;
      if (!productId) continue;
      try {
        const product = await storage.getProduct(Number(productId));
        if (!product) continue;
        const newStock = Math.max(0, (product.stock ?? 0) - quantity);
        const updates: any = { stock: newStock };
        if (size && product.sizeStock && typeof product.sizeStock === 'object') {
          const sizeStockMap = product.sizeStock as Record<string, number>;
          const currentSizeQty = Number(sizeStockMap[size] ?? 0);
          const newSizeQty = Math.max(0, currentSizeQty - quantity);
          updates.sizeStock = { ...sizeStockMap, [size]: newSizeQty };
        }
        await storage.updateProduct(Number(productId), updates);
        console.log(`[StockDecrement] Product ${productId} (size: ${size ?? 'N/A'}): stock ${product.stock} → ${newStock}`);
      } catch (stockErr: any) {
        console.error(`[StockDecrement] Error updating stock for product ${productId}:`, stockErr.message);
      }
    }
  }

  // ============================================
  // PAYMENT WEBHOOKS
  // ============================================

  app.post("/api/webhooks/yookassa", async (req, res) => {
    console.log("[YooKassa Webhook] Received webhook:", JSON.stringify(req.body?.event), "payment:", req.body?.object?.id);
    // Anti-spoof (30.04.2026): полагаемся ТОЛЬКО на req.ip (последний хоп XFF после trust proxy=1).
    // Сырой XFF (req.headers['x-forwarded-for'].split(',')[0]) позволял злоумышленнику
    // прислать «webhook от имени ЮKassa» прямо на публичный URL контейнера, подменив XFF
    // на 185.71.76.0 — и обойти allowlist в paymentService.verifyYooKassaWebhook.
    // req.ip = адрес, который реально поставил Yandex Cloud Gateway, его подделать нельзя.
    const ip = req.ip || req.socket.remoteAddress || "";
    console.log(`[YooKassa Webhook] IP: ${ip}, raw XFF: ${req.headers['x-forwarded-for'] || 'none'}`);
    if (!paymentService.verifyYooKassaWebhook(req.body, ip)) {
      console.warn("[YooKassa Webhook] Verification failed", { ip, body: req.body });
      return res.status(400).send("Verification failed");
    }

    const { event, object } = req.body;
    if (event === "payment.succeeded") {
      const paymentId = object.id;
      const orderId = object.metadata?.order_id;
      const metadataType = object.metadata?.type;
      const metadataGiftCardId = object.metadata?.giftCardId;
      const metadataGiftCardIds = object.metadata?.giftCardIds;
      console.log(`[YooKassa Webhook] Payment succeeded: ${paymentId}, Order: ${orderId}, type: ${metadataType}, giftCardId: ${metadataGiftCardId}, giftCardIds: ${metadataGiftCardIds}`);
      
      if (orderId) {
        const isGiftCard = orderId.startsWith("GIFT-") || orderId.startsWith("BATCH-") || metadataType === "gift_card" || !!metadataGiftCardId || !!metadataGiftCardIds;
        if (isGiftCard) {
          const giftCardIdsToActivate: number[] = [];
          if (metadataGiftCardIds) {
            giftCardIdsToActivate.push(...metadataGiftCardIds.split(',').map(Number).filter((n: number) => !isNaN(n)));
          } else if (metadataGiftCardId) {
            giftCardIdsToActivate.push(Number(metadataGiftCardId));
          } else if (orderId.startsWith("GIFT-")) {
            giftCardIdsToActivate.push(parseInt(orderId.replace("GIFT-", "")));
          } else if (orderId.startsWith("BATCH-")) {
            const parts = orderId.split("-");
            const batchFirstId = Number(parts[1]);
            const batchQty = Number(parts[2]) || 1;
            if (!isNaN(batchFirstId)) {
              giftCardIdsToActivate.push(batchFirstId);
              const allCards = await storage.getGiftCards();
              const batchCards = allCards.filter(c => c.paymentId === paymentId || c.id === batchFirstId);
              for (const bc of batchCards) {
                if (!giftCardIdsToActivate.includes(bc.id)) giftCardIdsToActivate.push(bc.id);
              }
            }
          } else {
            const numId = Number(orderId);
            if (!isNaN(numId)) giftCardIdsToActivate.push(numId);
          }

          for (const cardId of giftCardIdsToActivate) {
            await storage.updateGiftCard(cardId, { status: "active" });
            console.log(`[YooKassa Webhook] Gift card ${cardId} activated`);
          }

          console.log(`[YooKassa Webhook] Activated ${giftCardIdsToActivate.length} gift cards: ${giftCardIdsToActivate.join(', ')}`);

          const activatedCards = [];
          for (const cid of giftCardIdsToActivate) {
            const card = await storage.getGiftCardById(cid);
            if (card) activatedCards.push(card);
          }

          if (activatedCards.length > 0) {
            const firstCard = activatedCards[0];
            if (firstCard.purchaserEmail) {
              try {
                if (activatedCards.length === 1) {
                  const purchaserHtml = getGiftCardPaidEmailHtml(
                    firstCard.purchaserName || 'Покупатель',
                    firstCard.code,
                    firstCard.amount,
                    firstCard.recipientName,
                    firstCard.recipientEmail,
                    firstCard.message,
                    (firstCard as any).cardColor || 'black'
                  );
                  await sendEmail({
                    to: firstCard.purchaserEmail,
                    subject: `Подарочная карта BOOOMERANGS на ${(firstCard.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
                    html: purchaserHtml
                  });
                } else {
                  const cardsHtml = activatedCards.map(c => 
                    `<li>Код: <strong>${c.code}</strong> — ${(c.amount / 100).toLocaleString('ru-RU')} ₽</li>`
                  ).join('');
                  const totalAmount = activatedCards.reduce((s, c) => s + c.amount, 0);
                  const batchHtml = `<h2>Ваши подарочные карты BOOOMERANGS оплачены!</h2>
                    <p>Вы приобрели ${activatedCards.length} подарочных карт на общую сумму ${(totalAmount / 100).toLocaleString('ru-RU')} ₽:</p>
                    <ul>${cardsHtml}</ul>
                    <p>Используйте коды при оформлении заказа на сайте booomerangs.ru</p>`;
                  await sendEmail({
                    to: firstCard.purchaserEmail,
                    subject: `Подарочные карты BOOOMERANGS (${activatedCards.length} шт.) оплачены`,
                    html: batchHtml
                  });
                }
                console.log(`[YooKassa Webhook] Email sent to purchaser: ${firstCard.purchaserEmail}`);

                for (const card of activatedCards) {
                  if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
                    try {
                      const recipientHtml = getGiftCardReceivedEmailHtml(
                        card.recipientName || 'Друг',
                        card.purchaserName || 'Друг',
                        card.code,
                        card.amount,
                        card.message,
                        (card as any).cardColor || 'black'
                      );
                      await sendEmail({
                        to: card.recipientEmail,
                        subject: `Вам подарили подарочную карту BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
                        html: recipientHtml
                      });
                      console.log(`[YooKassa Webhook] Email sent to recipient: ${card.recipientEmail}`);
                    } catch (recipientErr: any) {
                      console.error(`[YooKassa Webhook] Failed to send recipient email for card ${card.code}:`, recipientErr.message);
                    }
                  }
                }
              } catch (emailErr: any) {
                console.error(`[YooKassa Webhook] Failed to send gift card email:`, emailErr.message);
              }
            }
          }
        } else if (orderId.startsWith("PREORDER-REMAINING-")) {
          const preorderOrderId = Number(orderId.replace("PREORDER-REMAINING-", ""));
          if (!isNaN(preorderOrderId)) {
            await storage.updateOrderStatus(preorderOrderId, "paid");
            await storage.updateOrderPreorderFields(preorderOrderId, { remainingAmount: 0, preorderPaymentId: paymentId });
            console.log(`[YooKassa Webhook] Preorder remaining payment confirmed for order ${preorderOrderId}`);

            const preorderOrder = await storage.getOrder(preorderOrderId);
            if (preorderOrder && preorderOrder.customerEmail) {
              try {
                const orderItems = typeof preorderOrder.items === 'string' ? JSON.parse(preorderOrder.items) : preorderOrder.items;
                const emailHtml = getPreorderRemainingPaidEmailHtml({
                  id: preorderOrder.id,
                  customerName: preorderOrder.customerName,
                  total: preorderOrder.total,
                  items: Array.isArray(orderItems) ? orderItems : [],
                  address: preorderOrder.address,
                });
                await sendEmail({
                  to: preorderOrder.customerEmail,
                  subject: `BMGBRAND — Предзаказ #${preorderOrder.id} полностью оплачен!`,
                  html: emailHtml,
                });
                console.log(`[YooKassa Webhook] Preorder fully paid email sent to ${preorderOrder.customerEmail}`);
              } catch (emailErr: any) {
                console.error(`[YooKassa Webhook] Failed to send preorder paid email:`, emailErr.message);
              }
            }
          }
        } else if (orderId.startsWith("PREORDER-")) {
          const preorderOrderId = Number(orderId.replace("PREORDER-", ""));
          if (!isNaN(preorderOrderId)) {
            await storage.updateOrderStatus(preorderOrderId, "paid");
            await storage.updateOrderPreorderFields(preorderOrderId, { depositPaid: true, remainingAmount: 0 });

            const preorderOrder = await storage.getOrder(preorderOrderId);
            if (preorderOrder) {
              const orderItems = typeof preorderOrder.items === 'string' ? JSON.parse(preorderOrder.items) : preorderOrder.items;
              const productId = Array.isArray(orderItems) ? orderItems[0]?.productId : null;
              if (productId) {
                const newCurrent = await storage.incrementPreorderCurrent(productId);
                const product = await storage.getProduct(productId);
                console.log(`[YooKassa Webhook] Preorder paid for order ${preorderOrderId}, product ${productId}, count: ${newCurrent}`);

                notifyPreorderDeposit({
                  orderId: preorderOrderId,
                  productName: orderItems[0]?.productName || product?.name || '',
                  customerName: preorderOrder.customerName,
                  customerEmail: preorderOrder.customerEmail,
                  depositAmount: preorderOrder.total,
                  totalAmount: preorderOrder.total,
                  items: orderItems.map((i: any) => ({ size: i.size, quantity: i.quantity || 1 })),
                  color: orderItems[0]?.color,
                  shippingDate: (product as any)?.preorderShippingDate || null,
                });
                vkNotifyPreorderDeposit({
                  orderId: preorderOrderId,
                  productName: orderItems[0]?.productName || product?.name || '',
                  customerName: preorderOrder.customerName,
                  customerEmail: preorderOrder.customerEmail,
                  depositAmount: preorderOrder.total,
                  totalAmount: preorderOrder.total,
                  items: orderItems.map((i: any) => ({ size: i.size, quantity: i.quantity || 1 })),
                  color: orderItems[0]?.color,
                  shippingDate: (product as any)?.preorderShippingDate || null,
                });
              }

              if (preorderOrder.customerEmail) {
                try {
                  const emailHtml = getPreorderDepositPaidEmailHtml({
                    id: preorderOrder.id,
                    customerName: preorderOrder.customerName,
                    total: preorderOrder.total,
                    items: Array.isArray(orderItems) ? orderItems : [],
                  });
                  await sendEmail({
                    to: preorderOrder.customerEmail,
                    subject: `BMGBRAND — Предзаказ #${preorderOrder.id} оплачен!`,
                    html: emailHtml,
                  });
                  console.log(`[YooKassa Webhook] Preorder paid email sent to ${preorderOrder.customerEmail}`);
                } catch (emailErr: any) {
                  console.error(`[YooKassa Webhook] Failed to send preorder paid email:`, emailErr.message);
                }
              }
            }
          }
        } else {
          const numericId = Number(orderId);
          if (!isNaN(numericId)) {
            try {
              const order = await storage.getOrder(numericId);
              if (order && order.status !== "paid") {
                await storage.updateOrderStatus(numericId, "paid");
                await storage.updateOrderPaymentId(numericId, paymentId);
                console.log(`[YooKassa Webhook] Order ${numericId} marked as paid`);

                try {
                  const itemsForStock = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                  await decrementStockForOrderItems(Array.isArray(itemsForStock) ? itemsForStock : []);
                } catch (stockErr: any) {
                  console.error(`[YooKassa Webhook] Stock decrement error for order ${numericId}:`, stockErr.message);
                }

                // Start hold-period for partner commission once payment succeeded.
                // Status STAYS "pending" — admin must manually press "Подтвердить" after hold expires.
                // Fire-and-forget — must not block webhook response. Idempotent: only sets hold_until
                // if not already set, so 1C delivered-sync won't reset the hold timer.
                storage.getCommissionsByOrderId(numericId).then(async commissions => {
                  const holdDays = await getGlobalPartnerHoldDaysCached();
                  const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
                  for (const commission of commissions) {
                    if (commission.status === 'pending' && !commission.holdUntil) {
                      await storage.setCommissionHoldUntil(commission.id, holdUntil);
                      console.log(`[YooKassa Webhook] Partner commission hold started: order=${numericId} commission=${commission.id} holdDays=${holdDays} holdUntil=${holdUntil.toISOString()}`);
                    }
                  }
                }).catch(err => console.error(`[YooKassa Webhook] Commission hold-start failed for order ${numericId}:`, err?.message));

                storage.getOrderBitrixDealId(numericId).then(dealId => {
                  if (!dealId) return;
                  syncOrderStatusToBitrix(numericId, 'paid', dealId).catch(err =>
                    console.error(`[YooKassa Webhook] Bitrix sync failed for order ${numericId}:`, err?.message || err)
                  );
                }).catch(err =>
                  console.error(`[YooKassa Webhook] getOrderBitrixDealId failed for order ${numericId}:`, err?.message || err)
                );

                if (order.userId && !order.isWholesale) {
                  try {
                    await storage.updateUserTotalSpent(order.userId, order.total);
                    const newDiscount = await storage.recalculateUserLoyaltyDiscount(order.userId);
                    console.log(`[YooKassa Webhook] User ${order.userId} loyalty updated: +${order.total / 100} RUB, discount: ${newDiscount}%`);
                  } catch (loyaltyErr) {
                    console.error(`[YooKassa Webhook] Error updating loyalty for user ${order.userId}:`, loyaltyErr);
                  }
                }

                if (order.customerEmail) {
                  try {
                    const orderItems = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                    const emailHtml = getOrderPaidEmailHtml({
                      id: order.id,
                      customerName: order.customerName,
                      total: order.total,
                      items: Array.isArray(orderItems) ? orderItems : [],
                      address: order.address,
                    });
                    await sendEmail({
                      to: order.customerEmail,
                      subject: `Заказ #${order.id} оплачен — BMGBRAND`,
                      html: emailHtml,
                    });
                    console.log(`[YooKassa Webhook] Order confirmation email sent to ${order.customerEmail}`);
                  } catch (emailErr: any) {
                    console.error(`[YooKassa Webhook] Failed to send order email:`, emailErr.message);
                  }
                }
                
                createCdekWaybillForOrder(numericId).catch(err => 
                  console.error(`[YooKassa Webhook] CDEK waybill error for order ${numericId}:`, err.message)
                );
                createYandexDeliveryForOrder(numericId).catch(err =>
                  console.error(`[YooKassa Webhook] YD waybill error for order ${numericId}:`, err.message)
                );

                const orderItemsParsed = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                const itemsForNotify = await enrichItemsWithProductColor(Array.isArray(orderItemsParsed) ? orderItemsParsed : []);
                notifyNewOrder({
                  orderId: order.id,
                  customerName: order.customerName,
                  customerEmail: order.customerEmail,
                  customerPhone: order.customerPhone,
                  address: order.address || '',
                  total: order.total,
                  items: itemsForNotify,
                  paymentMethod: 'yookassa',
                  isWholesale: order.isWholesale || false,
                  promoCode: order.promoCode || undefined,
                });
                vkNotifyNewOrder({
                  orderId: order.id,
                  customerName: order.customerName,
                  customerEmail: order.customerEmail,
                  customerPhone: order.customerPhone,
                  address: order.address || '',
                  total: order.total,
                  items: itemsForNotify,
                  paymentMethod: 'yookassa',
                  isWholesale: order.isWholesale || false,
                  promoCode: order.promoCode || undefined,
                });
              }
            } catch (err: any) {
              console.error(`[YooKassa Webhook] Error processing order ${numericId}:`, err.message);
            }
          }
        }
      }
    }

    if (event === "payment.canceled") {
      const paymentId = object.id;
      const orderId = object.metadata?.order_id;
      const cancelMetadataType = object.metadata?.type;
      const cancelMetadataGiftCardIds = object.metadata?.giftCardIds;
      const cancelMetadataGiftCardId = object.metadata?.giftCardId;
      console.log(`[YooKassa Webhook] Payment canceled: ${paymentId}, Order: ${orderId}, type: ${cancelMetadataType}`);
      
      if (orderId) {
        const isCancelGiftCard = orderId.startsWith("GIFT-") || orderId.startsWith("BATCH-") || cancelMetadataType === "gift_card" || !!cancelMetadataGiftCardId || !!cancelMetadataGiftCardIds;
        if (isCancelGiftCard) {
          const cancelCardIds: number[] = [];
          if (cancelMetadataGiftCardIds) {
            cancelCardIds.push(...cancelMetadataGiftCardIds.split(',').map(Number).filter((n: number) => !isNaN(n)));
          } else if (cancelMetadataGiftCardId) {
            cancelCardIds.push(Number(cancelMetadataGiftCardId));
          } else if (orderId.startsWith("GIFT-")) {
            const cid = parseInt(orderId.replace("GIFT-", ""));
            if (!isNaN(cid)) cancelCardIds.push(cid);
          } else if (orderId.startsWith("BATCH-")) {
            const parts = orderId.split("-");
            const batchFirstId = Number(parts[1]);
            if (!isNaN(batchFirstId)) {
              cancelCardIds.push(batchFirstId);
              const allCards = await storage.getGiftCards();
              const batchCards = allCards.filter((c: any) => c.paymentId === paymentId || c.id === batchFirstId);
              for (const bc of batchCards) {
                if (!cancelCardIds.includes(bc.id)) cancelCardIds.push(bc.id);
              }
            }
          } else {
            const cid = Number(orderId);
            if (!isNaN(cid)) cancelCardIds.push(cid);
          }
          for (const cardId of cancelCardIds) {
            await storage.deleteGiftCard(cardId);
            console.log(`[YooKassa Webhook] Deleted draft gift card ${cardId} after payment cancellation`);
          }
        } else if (orderId.startsWith("PREORDER-REMAINING-")) {
          console.log(`[YooKassa Webhook] Preorder remaining payment canceled for ${orderId}, keeping order`);
        } else if (orderId.startsWith("PREORDER-")) {
          const preorderOrderId = Number(orderId.replace("PREORDER-", ""));
          if (!isNaN(preorderOrderId)) {
            const order = await storage.getOrder(preorderOrderId);
            if (order && order.status === "awaiting_payment") {
              await storage.deleteOrder(preorderOrderId);
              console.log(`[YooKassa Webhook] Deleted draft preorder ${preorderOrderId} after payment cancellation`);
            }
          }
        } else {
          const numericId = Number(orderId);
          if (!isNaN(numericId)) {
            const order = await storage.getOrder(numericId);
            if (order && order.status === "awaiting_payment") {
              await storage.deleteOrder(numericId);
              console.log(`[YooKassa Webhook] Deleted draft order ${numericId} after payment cancellation`);
            }
          }
        }
      }
    }

    res.status(200).send("OK");
  });

  app.post("/api/webhooks/tbank", async (req, res) => {
    console.log("[T-Bank Webhook] Received:", JSON.stringify(req.body));
    
    if (!paymentService.verifyTBankWebhook(req.body)) {
      console.warn("[T-Bank Webhook] Verification failed", req.body);
      return res.status(400).send("Verification failed");
    }

    const { Status, PaymentId, OrderId, Success } = req.body;
    if (Success && Status === "CONFIRMED") {
      console.log(`[T-Bank Webhook] Payment CONFIRMED: ${PaymentId}, Order: ${OrderId}`);
      
      if (OrderId) {
        if (OrderId.startsWith("GIFT-")) {
          // Single gift card payment
          const cardId = parseInt(OrderId.replace("GIFT-", ""));
          await storage.updateGiftCard(cardId, { status: "active" });
          console.log(`[T-Bank Webhook] Gift card ${cardId} activated`);
        } else if (OrderId.startsWith("BATCH-")) {
          // Batch gift cards payment - find cards by paymentId
          const paymentIdStr = String(PaymentId);
          console.log(`[T-Bank Webhook] Looking for gift cards with paymentId: ${paymentIdStr}`);
          
          const allCards = await storage.getGiftCards();
          console.log(`[T-Bank Webhook] Total cards in DB: ${allCards.length}`);
          
          // Log pending cards with their paymentIds
          const pendingCards = allCards.filter((c: any) => c.status === "pending");
          console.log(`[T-Bank Webhook] Pending cards: ${pendingCards.map((c: any) => `${c.code}:${c.paymentId}`).join(', ')}`);
          
          const batchCards = allCards.filter((c: any) => 
            c.paymentId === paymentIdStr && c.status === "pending"
          );
          console.log(`[T-Bank Webhook] Matched cards: ${batchCards.length}`);
          
          for (const card of batchCards) {
            await storage.updateGiftCard(card.id, { status: "active" });
            console.log(`[T-Bank Webhook] Gift card ${card.id} (${card.code}) activated`);
          }
          console.log(`[T-Bank Webhook] Activated ${batchCards.length} gift cards for payment ${PaymentId}`);
          
          // Send email to purchaser with all cards
          if (batchCards.length > 0 && batchCards[0].purchaserEmail) {
            const firstCard = batchCards[0];
            const totalAmount = batchCards.reduce((sum: number, c: any) => sum + c.amount, 0);
            const allCodes = batchCards.map((c: any) => c.code).join(', ');
            
            try {
              // Create custom HTML for batch purchase
              const batchHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .logo { font-size: 24px; font-weight: bold; color: #1C1C1C; }
                    .logo span { color: #E53935; }
                    .card { background: linear-gradient(135deg, #1C1C1C 0%, #333 100%); color: #fff; padding: 20px; border-radius: 12px; margin: 10px 0; text-align: center; }
                    .card-code { font-size: 20px; font-weight: bold; letter-spacing: 2px; color: #E53935; }
                    .card-amount { font-size: 18px; margin: 5px 0; }
                    .info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    .footer { margin-top: 40px; font-size: 12px; color: #666; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="logo">BMG<span>BRAND</span></div>
                    <h2>Подарочные карты оплачены!</h2>
                    <p>Привет, ${firstCard.purchaserName || 'Покупатель'}!</p>
                    <p>Ваши подарочные карты (${batchCards.length} шт.) успешно оплачены и активированы.</p>
                    
                    ${batchCards.map((c: any) => `
                      <div class="card">
                        <div class="card-code">${c.code}</div>
                        <div class="card-amount">${(c.amount / 100).toLocaleString('ru-RU')} ₽</div>
                      </div>
                    `).join('')}
                    
                    <div class="info">
                      <p><strong>Общая сумма:</strong> ${(totalAmount / 100).toLocaleString('ru-RU')} ₽</p>
                      <p><strong>Как использовать:</strong> Введите код карты при оформлении заказа на сайте booomerangs.ru</p>
                    </div>
                    
                    <div class="footer">
                      <p>&copy; ${new Date().getFullYear()} BMGBRAND. Все права защищены.</p>
                    </div>
                  </div>
                </body>
                </html>
              `;
              
              await sendEmail({
                to: firstCard.purchaserEmail,
                subject: `Подарочные карты BMGBRAND (${batchCards.length} шт.) на ${(totalAmount / 100).toLocaleString('ru-RU')} ₽ оплачены`,
                html: batchHtml
              });
              console.log(`[T-Bank Webhook] Batch email sent to: ${firstCard.purchaserEmail}`);

              for (const card of batchCards) {
                if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
                  try {
                    const recipientHtml = getGiftCardReceivedEmailHtml(
                      card.recipientName || 'Друг',
                      card.purchaserName || 'Друг',
                      card.code,
                      card.amount,
                      card.message
                    );
                    await sendEmail({
                      to: card.recipientEmail,
                      subject: `Вам подарили подарочную карту BMGBRAND на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
                      html: recipientHtml
                    });
                    console.log(`[T-Bank Webhook] Batch recipient email sent to: ${card.recipientEmail}`);
                  } catch (recipientErr: any) {
                    console.error(`[T-Bank Webhook] Failed to send batch recipient email to ${card.recipientEmail}:`, recipientErr.message);
                  }
                }
              }
            } catch (emailErr: any) {
              console.error(`[T-Bank Webhook] Failed to send batch email:`, emailErr.message);
            }
          }
        } else if (OrderId.startsWith("PREORDER-REMAINING-")) {
          const preorderOrderId = Number(OrderId.replace("PREORDER-REMAINING-", ""));
          if (!isNaN(preorderOrderId)) {
            await storage.updateOrderStatus(preorderOrderId, "paid");
            await storage.updateOrderPreorderFields(preorderOrderId, { remainingAmount: 0, preorderPaymentId: String(PaymentId) });
            console.log(`[T-Bank Webhook] Preorder remaining payment confirmed for order ${preorderOrderId}`);

            const preorderOrder = await storage.getOrder(preorderOrderId);
            if (preorderOrder && preorderOrder.customerEmail) {
              try {
                const orderItems = typeof preorderOrder.items === 'string' ? JSON.parse(preorderOrder.items) : preorderOrder.items;
                const emailHtml = getPreorderRemainingPaidEmailHtml({
                  id: preorderOrder.id,
                  customerName: preorderOrder.customerName,
                  total: preorderOrder.total,
                  items: Array.isArray(orderItems) ? orderItems : [],
                  address: preorderOrder.address,
                });
                await sendEmail({
                  to: preorderOrder.customerEmail,
                  subject: `BMGBRAND — Предзаказ #${preorderOrder.id} полностью оплачен!`,
                  html: emailHtml,
                });
                console.log(`[T-Bank Webhook] Preorder fully paid email sent to ${preorderOrder.customerEmail}`);
              } catch (emailErr: any) {
                console.error(`[T-Bank Webhook] Failed to send preorder paid email:`, emailErr.message);
              }
            }
          }
        } else if (OrderId.startsWith("PREORDER-")) {
          const preorderOrderId = Number(OrderId.replace("PREORDER-", ""));
          if (!isNaN(preorderOrderId)) {
            await storage.updateOrderStatus(preorderOrderId, "paid");
            await storage.updateOrderPreorderFields(preorderOrderId, { depositPaid: true, remainingAmount: 0 });

            const order = await storage.getOrder(preorderOrderId);
            if (order) {
              const items = Array.isArray(order.items) ? order.items : JSON.parse(String(order.items) || '[]');
              const productId = items[0]?.productId;
              if (productId) {
                const newCurrent = await storage.incrementPreorderCurrent(productId);
                const product = await storage.getProduct(productId);

                notifyPreorderDeposit({
                  orderId: preorderOrderId,
                  productName: items[0]?.productName || product?.name || '',
                  customerName: order.customerName,
                  customerEmail: order.customerEmail,
                  depositAmount: order.total,
                  totalAmount: order.total,
                  items: items.map((i: any) => ({ size: i.size, quantity: i.quantity || 1 })),
                  color: items[0]?.color,
                  shippingDate: (product as any)?.preorderShippingDate || null,
                });
                vkNotifyPreorderDeposit({
                  orderId: preorderOrderId,
                  productName: items[0]?.productName || product?.name || '',
                  customerName: order.customerName,
                  customerEmail: order.customerEmail,
                  depositAmount: order.total,
                  totalAmount: order.total,
                  items: items.map((i: any) => ({ size: i.size, quantity: i.quantity || 1 })),
                  color: items[0]?.color,
                  shippingDate: (product as any)?.preorderShippingDate || null,
                });
              }

              if (order.customerEmail) {
                try {
                  const orderItems = Array.isArray(order.items) ? order.items : JSON.parse(String(order.items) || '[]');
                  const emailHtml = getPreorderDepositPaidEmailHtml({
                    id: order.id,
                    customerName: order.customerName,
                    total: order.total,
                    items: orderItems,
                  });
                  await sendEmail({
                    to: order.customerEmail,
                    subject: `BMGBRAND — Предзаказ #${order.id} оплачен!`,
                    html: emailHtml,
                  });
                  console.log(`[T-Bank Webhook] Preorder paid email sent to ${order.customerEmail}`);
                } catch (emailErr: any) {
                  console.error(`[T-Bank Webhook] Failed to send preorder paid email:`, emailErr.message);
                }
              }
            }
            console.log(`[T-Bank Webhook] Preorder paid for order ${preorderOrderId}`);
          }
        } else {
          // Could be either a single gift card or a regular order
          const numericId = Number(OrderId);
          if (!isNaN(numericId)) {
            // First check if this is a gift card payment
            const giftCard = await storage.getGiftCardById(numericId);
            if (giftCard && giftCard.status === "pending") {
              // It's a gift card!
              await storage.updateGiftCard(numericId, { 
                status: "active", 
                paymentId: String(PaymentId) 
              });
              console.log(`[T-Bank Webhook] Gift card ${numericId} (${giftCard.code}) activated`);
              
              // Send email to purchaser
              if (giftCard.purchaserEmail) {
                try {
                  const purchaserHtml = getGiftCardPaidEmailHtml(
                    giftCard.purchaserName || 'Покупатель',
                    giftCard.code,
                    giftCard.amount,
                    giftCard.recipientName,
                    giftCard.recipientEmail,
                    giftCard.message,
                    (giftCard as any).cardColor || 'black'
                  );
                  await sendEmail({
                    to: giftCard.purchaserEmail,
                    subject: `Подарочная карта BMGBRAND на ${(giftCard.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
                    html: purchaserHtml
                  });
                  console.log(`[T-Bank Webhook] Email sent to purchaser: ${giftCard.purchaserEmail}`);
                  
                  // If there's a recipient, send them an email too
                  if (giftCard.recipientEmail && giftCard.recipientEmail !== giftCard.purchaserEmail) {
                    const recipientHtml = getGiftCardReceivedEmailHtml(
                      giftCard.recipientName || 'Друг',
                      giftCard.purchaserName || 'Друг',
                      giftCard.code,
                      giftCard.amount,
                      giftCard.message,
                      (giftCard as any).cardColor || 'black'
                    );
                    await sendEmail({
                      to: giftCard.recipientEmail,
                      subject: `Вам подарили подарочную карту BMGBRAND на ${(giftCard.amount / 100).toLocaleString('ru-RU')} ₽!`,
                      html: recipientHtml
                    });
                    console.log(`[T-Bank Webhook] Email sent to recipient: ${giftCard.recipientEmail}`);
                  }
                } catch (emailErr: any) {
                  console.error(`[T-Bank Webhook] Failed to send gift card email:`, emailErr.message);
                }
              }
            } else {
              try {
                await storage.updateOrderStatus(numericId, "paid");
                await storage.updateOrderPaymentId(numericId, String(PaymentId));
                console.log(`[T-Bank Webhook] Order ${numericId} marked as paid`);

                // Start hold-period for partner commission once payment succeeded.
                // Status STAYS "pending" — admin must manually press "Подтвердить" after hold expires.
                storage.getCommissionsByOrderId(numericId).then(async commissions => {
                  const holdDays = await getGlobalPartnerHoldDaysCached();
                  const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
                  for (const commission of commissions) {
                    if (commission.status === 'pending' && !commission.holdUntil) {
                      await storage.setCommissionHoldUntil(commission.id, holdUntil);
                      console.log(`[T-Bank Webhook] Partner commission hold started: order=${numericId} commission=${commission.id} holdDays=${holdDays} holdUntil=${holdUntil.toISOString()}`);
                    }
                  }
                }).catch(err => console.error(`[T-Bank Webhook] Commission hold-start failed for order ${numericId}:`, err?.message));

                storage.getOrderBitrixDealId(numericId).then(dealId => {
                  if (!dealId) return;
                  syncOrderStatusToBitrix(numericId, 'paid', dealId).catch(err =>
                    console.error(`[T-Bank Webhook] Bitrix sync failed for order ${numericId}:`, err?.message || err)
                  );
                }).catch(err =>
                  console.error(`[T-Bank Webhook] getOrderBitrixDealId failed for order ${numericId}:`, err?.message || err)
                );

                const order = await storage.getOrder(numericId);

                try {
                  const itemsForStock = order && (typeof order.items === 'string' ? JSON.parse(order.items) : order.items);
                  await decrementStockForOrderItems(Array.isArray(itemsForStock) ? itemsForStock : []);
                } catch (stockErr: any) {
                  console.error(`[T-Bank Webhook] Stock decrement error for order ${numericId}:`, stockErr.message);
                }
                console.log(`[T-Bank Webhook] Order ${numericId} details: userId=${order?.userId}, isWholesale=${order?.isWholesale}, email=${order?.customerEmail}`);
                if (order && order.userId && !order.isWholesale) {
                  try {
                    await storage.updateUserTotalSpent(order.userId, order.total);
                    const newDiscount = await storage.recalculateUserLoyaltyDiscount(order.userId);
                    console.log(`[T-Bank Webhook] User ${order.userId} loyalty updated: +${order.total / 100} RUB, new discount: ${newDiscount}%`);
                  } catch (loyaltyErr) {
                    console.error(`[T-Bank Webhook] Error updating loyalty for user ${order.userId}:`, loyaltyErr);
                  }
                } else if (order && !order.userId) {
                  console.log(`[T-Bank Webhook] Order ${numericId} has no userId, skipping loyalty update`);
                }
                
                if (order && order.customerEmail) {
                  try {
                    const orderItems = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                    const emailHtml = getOrderPaidEmailHtml({
                      id: order.id,
                      customerName: order.customerName,
                      total: order.total,
                      items: Array.isArray(orderItems) ? orderItems : [],
                      address: order.address,
                    });
                    await sendEmail({
                      to: order.customerEmail,
                      subject: `Заказ #${order.id} оплачен — BMGBRAND`,
                      html: emailHtml,
                    });
                    console.log(`[T-Bank Webhook] Order confirmation email sent to ${order.customerEmail}`);
                  } catch (emailErr: any) {
                    console.error(`[T-Bank Webhook] Failed to send order email:`, emailErr.message);
                  }
                }
                
                createCdekWaybillForOrder(numericId).catch(err => 
                  console.error(`[T-Bank Webhook] CDEK waybill error for order ${numericId}:`, err.message)
                );
                createYandexDeliveryForOrder(numericId).catch(err =>
                  console.error(`[T-Bank Webhook] YD waybill error for order ${numericId}:`, err.message)
                );

                if (order) {
                  const orderItemsParsed = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                  const itemsForNotify = await enrichItemsWithProductColor(Array.isArray(orderItemsParsed) ? orderItemsParsed : []);
                  notifyNewOrder({
                    orderId: order.id,
                    customerName: order.customerName,
                    customerEmail: order.customerEmail,
                    customerPhone: order.customerPhone,
                    address: order.address || '',
                    total: order.total,
                    items: itemsForNotify,
                    paymentMethod: 'tbank',
                    isWholesale: order.isWholesale || false,
                    promoCode: order.promoCode || undefined,
                  });
                  vkNotifyNewOrder({
                    orderId: order.id,
                    customerName: order.customerName,
                    customerEmail: order.customerEmail,
                    customerPhone: order.customerPhone,
                    address: order.address || '',
                    total: order.total,
                    items: itemsForNotify,
                    paymentMethod: 'tbank',
                    isWholesale: order.isWholesale || false,
                    promoCode: order.promoCode || undefined,
                  });
                }
              } catch (err: any) {
                console.error(`[T-Bank Webhook] Error updating order ${numericId}:`, err.message);
              }
            }
          }
        }
      }
    }

    if (Status === "REJECTED" || Status === "CANCELED" || Status === "DEADLINE_EXPIRED" || Status === "AUTH_FAIL") {
      console.log(`[T-Bank Webhook] Payment failed (${Status}): ${PaymentId}, Order: ${OrderId}`);
      
      if (OrderId) {
        if (OrderId.startsWith("GIFT-")) {
          const cardId = parseInt(OrderId.replace("GIFT-", ""));
          if (!isNaN(cardId)) {
            await storage.deleteGiftCard(cardId);
            console.log(`[T-Bank Webhook] Deleted draft gift card ${cardId} after payment failure`);
          }
        } else if (OrderId.startsWith("BATCH-")) {
          const paymentIdStr = String(PaymentId);
          const allCards = await storage.getGiftCards();
          const pendingCards = allCards.filter((c: any) => c.paymentId === paymentIdStr && c.status === "pending");
          for (const card of pendingCards) {
            await storage.deleteGiftCard(card.id);
          }
          console.log(`[T-Bank Webhook] Deleted ${pendingCards.length} draft gift cards after payment failure`);
        } else if (OrderId.startsWith("PREORDER-REMAINING-")) {
          console.log(`[T-Bank Webhook] Preorder remaining payment failed for ${OrderId}, keeping order`);
        } else if (OrderId.startsWith("PREORDER-")) {
          const preorderOrderId = Number(OrderId.replace("PREORDER-", ""));
          if (!isNaN(preorderOrderId)) {
            const order = await storage.getOrder(preorderOrderId);
            if (order && order.status === "awaiting_payment") {
              await storage.deleteOrder(preorderOrderId);
              console.log(`[T-Bank Webhook] Deleted draft preorder ${preorderOrderId} after payment failure`);
            }
          }
        } else {
          const numericId = Number(OrderId);
          if (!isNaN(numericId)) {
            const giftCard = await storage.getGiftCardById(numericId);
            if (giftCard && giftCard.status === "pending") {
              await storage.deleteGiftCard(numericId);
              console.log(`[T-Bank Webhook] Deleted draft gift card ${numericId} after payment failure`);
            } else {
              const order = await storage.getOrder(numericId);
              if (order && order.status === "awaiting_payment") {
                await storage.deleteOrder(numericId);
                console.log(`[T-Bank Webhook] Deleted draft order ${numericId} after payment failure`);
              }
            }
          }
        }
      }
    }

    res.status(200).send("OK");
  });

  // Get available payment methods
  app.get("/api/payment-methods", (_req, res) => {
    const methods = [];
    if (paymentService.isYooKassaEnabled()) {
      methods.push({ id: "yookassa", name: "ЮKassa", description: "Банковские карты, СБП" });
    }
    if (paymentService.isTBankEnabled()) {
      methods.push({ id: "tbank", name: "Т-Банк", description: "Оплата картой, Т-Pay" });
    }
    // Fallback for development if no keys are set
    if (methods.length === 0) {
      methods.push({ id: "yookassa", name: "ЮKassa", description: "Банковские карты, СБП" });
      methods.push({ id: "tbank", name: "Т-Банк", description: "Оплата картой, Т-Pay" });
    }
    res.json({
      methods,
      enabled: methods.length > 0,
      tbankTerminalKey: process.env.TBANK_TERMINAL_KEY || null,
      ozonPayEnabled: ozonPayService.isEnabled(),
    });
  });

  // ==================== Ozon Delivery OAuth 2.0 ====================

  // GET /api/admin/ozon-oauth/status — статус авторизации (только для админа)
  app.get("/api/admin/ozon-oauth/status", authMiddleware, requireAdminRole, (_req, res) => {
    res.json(ozonDeliveryOAuth.getStatus());
  });

  // GET /api/admin/ozon-oauth/authorize — получить URL для авторизации (только для админа)
  // Администратор переходит по возвращённому authUrl в браузере,
  // авторизуется в Ozon и разрешает доступ. Ozon редиректит на callback.
  app.get("/api/admin/ozon-oauth/authorize", authMiddleware, requireAdminRole, (_req, res) => {
    if (!ozonDeliveryOAuth.isConfigured()) {
      return res.status(503).json({ error: "Ozon OAuth не настроен: добавьте OZON_CLIENT_ID и OZON_CLIENT_SECRET в переменные окружения" });
    }
    try {
      const authUrl = ozonDeliveryOAuth.generateAuthUrl();
      console.log("[OzonDelivery OAuth] Сгенерирован URL авторизации");
      res.json({ authUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/ozon-oauth/revoke — сброс токенов (только для админа)
  app.post("/api/admin/ozon-oauth/revoke", authMiddleware, requireAdminRole, async (_req, res) => {
    ozonDeliveryOAuth.clearTokens();
    try {
      await Promise.all([
        storage.setBonusSetting(OZON_OAUTH_KEYS.accessToken, ""),
        storage.setBonusSetting(OZON_OAUTH_KEYS.refreshToken, ""),
        storage.setBonusSetting(OZON_OAUTH_KEYS.expiresAt, "0"),
      ]);
    } catch {}
    res.json({ success: true, message: "Токены сброшены" });
  });

  // GET /api/ozon/oauth/callback — публичный callback, вызывается Ozon после авторизации
  // redirect_uri должен совпадать с указанным в настройках приложения dev.ozon.ru
  app.get("/api/ozon/oauth/callback", async (req, res) => {
    const { code, state, error: ozonError } = req.query as Record<string, string>;

    if (ozonError) {
      console.error("[OzonDelivery OAuth] Ozon вернул ошибку:", ozonError);
      return res.redirect(`/admin?ozon_oauth=error&reason=${encodeURIComponent(ozonError)}`);
    }

    if (!code || !state) {
      console.warn("[OzonDelivery OAuth] Callback без code/state");
      return res.redirect("/admin?ozon_oauth=error&reason=missing_params");
    }

    if (!ozonDeliveryOAuth.validateState(state)) {
      console.warn("[OzonDelivery OAuth] Невалидный state — возможная CSRF-атака");
      return res.redirect("/admin?ozon_oauth=error&reason=invalid_state");
    }

    const result = await ozonDeliveryOAuth.exchangeCode(code);

    if (!result.success || !result.tokenData) {
      console.error("[OzonDelivery OAuth] Ошибка обмена кода:", result.error);
      return res.redirect(`/admin?ozon_oauth=error&reason=${encodeURIComponent(result.error || "exchange_failed")}`);
    }

    // Сохраняем токены в БД для персистентности
    try {
      await Promise.all([
        storage.setBonusSetting(OZON_OAUTH_KEYS.accessToken, result.tokenData.accessToken),
        storage.setBonusSetting(OZON_OAUTH_KEYS.refreshToken, result.tokenData.refreshToken),
        storage.setBonusSetting(OZON_OAUTH_KEYS.expiresAt, String(result.tokenData.expiresAt)),
      ]);
      console.log("[OzonDelivery OAuth] Токены сохранены в БД");
    } catch (e: any) {
      console.error("[OzonDelivery OAuth] Ошибка сохранения токенов в БД:", e.message);
    }

    return res.redirect("/admin?ozon_oauth=success");
  });

  // Ozon Pay webhook
  app.post("/api/webhooks/ozon-pay", async (req, res) => {
    console.log("[OzonPay Webhook] Received:", JSON.stringify(req.body?.status), "order:", req.body?.orderID, "ext:", req.body?.extOrderID);

    if (!ozonPayService.verifyWebhookSignature(req.body)) {
      console.warn("[OzonPay Webhook] Signature verification failed");
      return res.status(400).send("Verification failed");
    }

    const { status, orderID, extOrderID, amount } = req.body;

    if (status === "Completed") {
      const orderId = extOrderID ? Number(extOrderID) : null;
      if (!orderId || isNaN(orderId)) {
        console.warn("[OzonPay Webhook] Cannot find order by extOrderID:", extOrderID);
        return res.status(200).send("OK");
      }

      try {
        const order = await storage.getOrder(orderId);
        if (!order) {
          console.warn("[OzonPay Webhook] Order not found:", orderId);
          return res.status(200).send("OK");
        }

        if (order.status !== "paid") {
          await storage.updateOrderStatus(orderId, "paid");
          if (orderID) await storage.updateOrderPaymentId(orderId, orderID);
          console.log(`[OzonPay Webhook] Order ${orderId} marked as paid`);

          try {
            const itemsForStock = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
            await decrementStockForOrderItems(Array.isArray(itemsForStock) ? itemsForStock : []);
          } catch (stockErr: any) {
            console.error(`[OzonPay Webhook] Stock decrement error for order ${orderId}:`, stockErr.message);
          }

          storage.getCommissionsByOrderId(orderId).then(async (commissions) => {
            const holdDays = await getGlobalPartnerHoldDaysCached();
            const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
            for (const commission of commissions) {
              if (commission.status === "pending" && !commission.holdUntil) {
                await storage.setCommissionHoldUntil(commission.id, holdUntil);
                console.log(`[OzonPay Webhook] Partner commission hold started: order=${orderId} commission=${commission.id} holdDays=${holdDays} holdUntil=${holdUntil.toISOString()}`);
              }
            }
          }).catch(() => {});

          storage.getOrderBitrixDealId(orderId).then((dealId) => {
            if (!dealId) return;
            syncOrderStatusToBitrix(orderId, "paid", dealId).catch(() => {});
          }).catch(() => {});

          if (order.userId && !order.isWholesale) {
            try {
              await storage.updateUserTotalSpent(order.userId, order.total);
              await storage.recalculateUserLoyaltyDiscount(order.userId);
            } catch {}
          }

          if (order.customerEmail) {
            try {
              const orderItems = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
              const emailHtml = getOrderPaidEmailHtml({
                id: order.id,
                customerName: order.customerName,
                total: order.total,
                items: Array.isArray(orderItems) ? orderItems : [],
                address: order.address,
              });
              await sendEmail({
                to: order.customerEmail,
                subject: `Заказ #${order.id} оплачен — BMGBRAND`,
                html: emailHtml,
              });
            } catch (emailErr: any) {
              console.error("[OzonPay Webhook] Failed to send email:", emailErr.message);
            }
          }

          const orderItemsParsed = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
          const itemsForNotify = await enrichItemsWithProductColor(Array.isArray(orderItemsParsed) ? orderItemsParsed : []);
          notifyNewOrder({
            orderId: order.id,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            address: order.address || "",
            total: order.total,
            items: itemsForNotify,
            paymentMethod: "ozon-pay",
            isWholesale: false,
            promoCode: order.promoCode || undefined,
          });
          vkNotifyNewOrder({
            orderId: order.id,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            address: order.address || "",
            total: order.total,
            items: itemsForNotify,
            paymentMethod: "ozon-pay",
            isWholesale: false,
            promoCode: order.promoCode || undefined,
          });
        }
      } catch (err: any) {
        console.error("[OzonPay Webhook] Error processing:", err.message);
      }
    }

    res.status(200).send("OK");
  });

  // Apply auth middleware to all routes below
  app.use(authMiddleware);

    // 1C CommerceML Exchange (Standard Protocol)
  app.all("/api/1c-exchange", express.raw({ type: '*/*', limit: '500mb' }), async (req, res, next) => {
    // Log ALL requests with full details
    const bodyLen = Buffer.isBuffer(req.body) ? req.body.length : (typeof req.body === 'string' ? req.body.length : 0);
    console.log(`\n========== 1C REQUEST ==========`);
    console.log(`[1C] ${req.method} ${req.url}`);
    console.log(`[1C] Body size: ${bodyLen} bytes`);
    console.log(`[1C] Content-Type: ${req.headers['content-type']}`);
    console.log(`================================\n`);
    
    // Normalize query params
    const type = (req.query.type as string || "").toLowerCase();
    const mode = (req.query.mode as string || "").toLowerCase();
    const filename = req.query.filename as string;
    
    // Enhanced logging for file saving issue
    if (req.method === "POST" && mode === "file") {
      console.log(`[1C DEBUG] Receiving file: ${filename}, type: ${type}, body-size: ${req.body?.length || 0}`);
    }

    if (!is1CSyncEnabled) {
      console.log(`[1C] Sync disabled — rejecting request`);
      return res.status(403).send("failure\n1C sync is disabled");
    }

    if (req.method === "GET" && mode === "checkauth") {
      console.log(`[1C DEBUG] Bypassing checkauth for type: ${type}. Headers: ${JSON.stringify(req.headers)}`);
      
      // 1C standard: success\nCookieName\nCookieValue
      const cookieName = "PHPSESSID";
      const cookieValue = "replit-session-id";
      
      // Use simple \n and NO extra quotes or anything. 
      // Some 1C versions are very sensitive to any extra characters including \r
      const response = "success\n" + cookieName + "\n" + cookieValue;
      
      console.log(`[1C DEBUG] Sending checkauth response body: ${JSON.stringify(response)}`);
      
      // Ensure headers are exactly what 1C expects
      res.setHeader("Content-Type", "text/plain; charset=windows-1251");
      res.setHeader("Set-Cookie", `${cookieName}=${cookieValue}; Path=/; HttpOnly`);
      
      // Use end() with a buffer to ensure no extra encoding/formatting by Express for strings
      return res.end(Buffer.from(response, "binary"));
    }

    // Ensure session cookie for 1C (critical for sequence of requests)
    if (!req.headers.cookie) {
      console.log("[1C DEBUG] No incoming cookie, setting PHPSESSID in response headers");
      res.setHeader("Set-Cookie", "PHPSESSID=replit-session-id; Path=/; HttpOnly");
    } else {
      console.log(`[1C DEBUG] Incoming cookies: ${req.headers.cookie}`);
    }
    
    // Continue to specific handlers or handle simple GETs here
    if (req.method === "GET") {
      console.log(`[1C DEBUG] GET request: type=${type}, mode=${mode}, filename=${filename}`);
      
      if (type === "catalog" && mode === "checkauth") {
        res.setHeader("Content-Type", "text/plain; charset=windows-1251");
        return res.end(Buffer.from("success\nPHPSESSID\nreplit-session-id", "binary"));
      }
      if (type === "catalog" && mode === "init") {
        console.log("[1C] Catalog init received. Sending file limits.");
        res.setHeader("Content-Type", "text/plain; charset=windows-1251");
        const initResponse = "zip=no\nfile_limit=104857600";
        console.log(`[1C DEBUG] Sending init response: ${initResponse}`);
        return res.end(Buffer.from(initResponse, "binary"));
      }
      if (type === "sale" && mode === "checkauth") {
        res.setHeader("Content-Type", "text/plain; charset=windows-1251");
        return res.end(Buffer.from("success\nPHPSESSID\nreplit-session-id", "binary"));
      }
      if (type === "sale" && mode === "init") {
        console.log("[1C] Sale init received. Sending file limits.");
        res.setHeader("Content-Type", "text/plain; charset=windows-1251");
        const initResponse = "zip=no\nfile_limit=104857600";
        console.log(`[1C DEBUG] Sending init response: ${initResponse}`);
        return res.end(Buffer.from(initResponse, "binary"));
      }
      if (type === "sale" && mode === "query") {
        try {
          const orders = await storage.getUnsyncedOrdersFor1C();
          console.log(`[1C] Exporting ${orders.length} unsynced orders to 1C`);
          lastExportedOrderIds = orders.map(o => o.id);

          // Read global VAT settings (same as invoice PDF)
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
          } catch (e) {
            console.warn("[1C] Could not read VAT settings, using defaults (5%, included):", e);
          }
          const vatRateNum = vatRate;

          const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });
          
          const xmlObj = {
            "КоммерческаяИнформация": {
              "@_ВерсияСхемы": "2.05",
              "@_ДатаФормирования": new Date().toISOString(),
              "Документ": orders.map(order => {
                let orderDateObj: Date;
                try {
                  orderDateObj = order.createdAt ? new Date(order.createdAt) : new Date();
                  if (isNaN(orderDateObj.getTime())) orderDateObj = new Date();
                } catch {
                  orderDateObj = new Date();
                }
                const orderDate = orderDateObj.toISOString().split('T')[0];
                const orderTime = orderDateObj.toTimeString().split(' ')[0];

                const filteredItems = order.items.filter((item: any) => !item._discountDetails);
                const discountEntry = order.items.find((item: any) => item._discountDetails);
                const discountDetails = discountEntry?._discountDetails || {};
                let orderVatTotal = 0;

                const товары = filteredItems.map((item: any) => {
                  const itemPrice = item.price || 0;
                  const itemTotal = (itemPrice * item.quantity) / 100;
                  let vatAmount: number;
                  if (vatRateNum === 0) {
                    vatAmount = 0;
                  } else if (vatMode === 'on_top') {
                    vatAmount = Math.round(itemTotal * vatRateNum) / 100;
                  } else {
                    vatAmount = Math.round(itemTotal * vatRateNum / (100 + vatRateNum) * 100) / 100;
                  }
                  orderVatTotal += vatAmount;
                  const baseName = item.productName || item.name || "Товар";

                  const sizeVal = item.size ? String(item.size).trim() : "";
                  const isOneSize = !sizeVal || sizeVal.toLowerCase() === "one size" || sizeVal.toLowerCase() === "onesize";
                  const colorVal = item.color ? String(item.color).trim() : "";
                  const hasColor = colorVal && colorVal.toLowerCase() !== "default";

                  const charGuid = item.sizeCharacteristicId || null;

                  const characteristics: any[] = [];
                  if (!isOneSize) {
                    const sizeChar: any = { "Наименование": "Размер", "Значение": sizeVal };
                    if (charGuid) sizeChar["Ид"] = charGuid;
                    characteristics.push(sizeChar);
                  }
                  if (hasColor) {
                    characteristics.push({ "Наименование": "Цвет", "Значение": colorVal });
                  }

                  // Use full variant ID (productGuid#charGuid) when characteristic GUID is known
                  const itemExternalId = (charGuid && item.productExternalId && !item.productExternalId.includes('#'))
                    ? `${item.productExternalId}#${charGuid}`
                    : (item.productExternalId || item.productId?.toString() || "unknown");

                  const result: any = {
                    "Ид": itemExternalId,
                    "Артикул": item.sku || "",
                    "Наименование": baseName,
                    "БазоваяЕдиница": {
                      "@_Код": "796",
                      "@_НаименованиеПолное": "Штука",
                      "@_МеждународноеСокращение": "PCE",
                      "#text": "шт",
                    },
                    "ЦенаЗаЕдиницу": (itemPrice / 100).toFixed(2),
                    "Количество": item.quantity.toString(),
                    ...(order.isWholesale ? { "КоличествоВРезерве": item.quantity.toString() } : {}),
                    "Сумма": itemTotal.toFixed(2),
                    "СтавкиНалогов": {
                      "СтавкаНалога": {
                        "Наименование": "НДС",
                        "Ставка": vatRateNum.toString(),
                      }
                    },
                    "Налоги": {
                      "Налог": {
                        "Наименование": "НДС",
                        "УчтеноВСумме": vatMode === 'included' ? "true" : "false",
                        "Сумма": vatAmount.toFixed(2),
                        "Ставка": vatRateNum.toString(),
                      }
                    },
                    "ЗначенияРеквизитов": {
                      "ЗначениеРеквизита": [
                        { "Наименование": "ВидНоменклатуры", "Значение": "Товар" },
                        { "Наименование": "ТипНоменклатуры", "Значение": "Товар" },
                      ]
                    },
                  };

                  if (characteristics.length > 0) {
                    result["ХарактеристикиТовара"] = {
                      "ХарактеристикаТовара": characteristics.length === 1 ? characteristics[0] : characteristics,
                    };
                  }

                  return result;
                });

                const totalDiscount = (discountDetails.promoDiscountAmount || 0) + (discountDetails.loyaltyDiscountAmount || 0) + (discountDetails.giftCardAmount || 0);

                let statusText = "Новый";
                if (order.status === "paid" || order.status === "completed") statusText = "Оплачен";
                else if (order.status === "shipped") statusText = "Отгружен";
                else if (order.status === "cancelled") statusText = "Отменён";
                else if (order.status === "pending") statusText = "В обработке";

                let paymentMethodText = "Онлайн-оплата";
                if (order.isWholesale) paymentMethodText = "Безналичный расчёт";

                let deliveryMethodText = "СДЭК";
                if (order.transportCompany === "yandex") deliveryMethodText = "Яндекс Доставка";
                else if (order.transportCompany === "cdek") deliveryMethodText = "СДЭК";
                else if (order.transportCompany === "self") deliveryMethodText = "Самовывоз";
                else if (order.transportCompany) deliveryMethodText = order.transportCompany;

                const docRekvizity: any[] = [
                  { "Наименование": "Статус заказа", "Значение": statusText },
                  { "Наименование": "Способ оплаты", "Значение": paymentMethodText },
                  { "Наименование": "Способ доставки", "Значение": deliveryMethodText },
                  { "Наименование": "Заказ оптовый", "Значение": order.isWholesale ? "true" : "false" },
                ];

                if (order.isPreorder) {
                  docRekvizity.push({ "Наименование": "Предзаказ", "Значение": "true" });
                }

                const doc: any = {
                  "Ид": order.id.toString(),
                  "Номер": `SITE-${order.id}`,
                  "Дата": orderDate,
                  "Время": orderTime,
                  "ХозОперация": "Заказ товара",
                  "Роль": "Продавец",
                  "Валюта": "RUB",
                  "Курс": "1",
                  "Сумма": (order.total / 100).toFixed(2),
                  "Контрагенты": {
                    "Контрагент": {
                      "Ид": order.userId ? `user_${order.userId}` : `email_${(order.customerEmail || '').toLowerCase().trim()}`,
                      "Наименование": order.customerName,
                      "Роль": "Покупатель",
                      "ПолноеНаименование": order.customerName,
                      "Адрес": { "Представление": order.address },
                      "Контакты": {
                        "Контакт": [
                          { "Тип": "ТелефонРабочий", "Значение": order.customerPhone || "" },
                          { "Тип": "Почта", "Значение": order.customerEmail || "" }
                        ]
                      }
                    }
                  },
                  "Товары": { "Товар": товары },
                  "ЗначенияРеквизитов": {
                    "ЗначениеРеквизита": docRekvizity,
                  }
                };

                if (totalDiscount > 0) {
                  const скидки: any[] = [];
                  if (discountDetails.promoDiscountAmount > 0) {
                    скидки.push({
                      "Наименование": `Промокод ${discountDetails.promoCode || ''}`.trim(),
                      "Сумма": (discountDetails.promoDiscountAmount / 100).toFixed(2),
                      "УчтеноВСумме": "true",
                    });
                  }
                  if (discountDetails.loyaltyDiscountAmount > 0) {
                    скидки.push({
                      "Наименование": `Скидка лояльности ${discountDetails.loyaltyPercent || 0}%`,
                      "Сумма": (discountDetails.loyaltyDiscountAmount / 100).toFixed(2),
                      "УчтеноВСумме": "true",
                    });
                  }
                  if (discountDetails.giftCardAmount > 0) {
                    скидки.push({
                      "Наименование": `Подарочная карта ${discountDetails.giftCardCode || ''}`.trim(),
                      "Сумма": (discountDetails.giftCardAmount / 100).toFixed(2),
                      "УчтеноВСумме": "true",
                    });
                  }
                  if (скидки.length > 0) {
                    doc["Скидки"] = {
                      "Скидка": скидки.length === 1 ? скидки[0] : скидки,
                    };
                  }
                }

                return doc;
              })
            }
          };
          
          const xmlData = builder.build(xmlObj);
          res.set("Content-Type", "application/xml");
          return res.send(xmlData);
        } catch (e) {
          console.error("[1C] Order export error:", e);
          return res.status(500).send("failure");
        }
      }
      if (type === "sale" && mode === "success") {
        if (lastExportedOrderIds.length > 0) {
          console.log(`[1C] Marking ${lastExportedOrderIds.length} orders as synced to 1C`);
          try {
            await storage.markOrdersSyncedTo1C(lastExportedOrderIds);
            console.log(`[1C] Successfully marked orders as synced: [${lastExportedOrderIds.join(', ')}]`);
          } catch (err) {
            console.error(`[1C] Error marking orders as synced:`, err);
          }
          lastExportedOrderIds = [];
        }
        return res.send("success");
      }
      if (type === "catalog" && mode === "import") {
        const filenameStr = filename as string;
        const uploadPath = path.resolve(process.cwd(), "1c_uploads", filenameStr);
        console.log(`[1C] GET Import command received. Filename: ${filenameStr}. Reading from: ${uploadPath}`);
        
        // Ensure 1c_uploads directory exists
        const uploadDir = path.resolve(process.cwd(), "1c_uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        // In cloud environment, the file might be in Object Storage instead of local disk
        let xmlData: string | null = null;
        
        if (fs.existsSync(uploadPath)) {
          xmlData = fs.readFileSync(uploadPath, "utf-8");
        } else if (process.env.YANDEX_STORAGE_BUCKET_NAME) {
          console.log(`[1C] File not found locally, checking Object Storage for products/${filename}`);
          xmlData = await downloadFromYandexStorage(`products/${filename}`);
        }

        if (xmlData) {
          // Load existing files from Object Storage before parsing XML
          await loadExistingFilesFromStorage(true);
          
          const xmlParserOptions = {
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            allowBooleanAttributes: true,
            parseAttributeValue: true,
            trimValues: true,
            // Optimization for large files - but NOT for Картинка (we need array)
            stopNodes: ["*.Описание"],
            // Always treat these tags as arrays
            isArray: (name: string) => {
              return name === "Картинка" || name === "Товар" || name === "Предложение" || 
                     name === "ЗначениеРеквизита" || name === "ЗначенияСвойства" || name === "ХарактеристикаТовара";
            }
          };
          const parser = new XMLParser(xmlParserOptions);
          
          try {
            const result = parser.parse(xmlData);
            console.log(`[1C] Processing XML data for ${filename}`);
            
            // Handle Products
            const catalog = result?.["КоммерческаяИнформация"]?.["Каталог"];
            if (catalog?.["Товары"]?.["Товар"]) {
              const items = catalog["Товары"]["Товар"];
              const productsArray = Array.isArray(items) ? items : [items];
              console.log(`[1C IMPORT] ========== STARTING IMPORT ==========`);
              console.log(`[1C IMPORT] Total products in XML: ${productsArray.length}`);
              
              let processedCount = 0;
              let createdCount = 0;
              let updatedCount = 0;
              let errorCount = 0;
              
              const { generateUniqueSlug } = await import("./slugify");
              const allProducts = await storage.getProducts();
              const existingSlugs: string[] = allProducts
                .map((p: any) => p.slug)
                .filter(Boolean);
              const productsByExtId = new Map<string, any>();
              for (const p of allProducts) {
                if ((p as any).externalId) productsByExtId.set((p as any).externalId, p);
              }
              
              for (const item of productsArray) {
                processedCount++;
                const externalId = item["Ид"];
                const name = item["Наименование"];
                
                // When using stopNodes, the value might be in different format
                const description = typeof item["Описание"] === 'string' ? item["Описание"] : (item["Описание"]?.["#text"] || "");
                const sku = item["Артикул"] || "";
                
                // Extract sizes and colors
                let sizes: string[] = [];
                let colors: string[] = [];
                const propsData = item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"];
                if (propsData) {
                   const props = Array.isArray(propsData) ? propsData : [propsData];
                   for (const prop of props) {
                     if (prop["Наименование"] === "Размер") sizes.push(prop["Значение"]);
                     if (prop["Наименование"] === "Цвет") colors.push(prop["Значение"]);
                   }
                }

                const imgData = item["Картинка"];
                // Parse ALL images from 1C (usually 3-4 per product)
                let allImages: string[] = [];
                const fallbackUrl = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
                
                const extractPath = (img: any): string | null => {
                  if (typeof img === 'string' && img.trim()) return img.trim();
                  if (img && typeof img === 'object' && img["#text"]) return img["#text"];
                  return null;
                };
                
                // Track all paths from XML for logging
                const xmlImagePaths: string[] = [];
                const missingImages: string[] = [];
                
                if (Array.isArray(imgData)) {
                  for (const img of imgData) {
                    const path = extractPath(img);
                    if (path) {
                      xmlImagePaths.push(path);
                      const url = getImageUrl(path, existingFilesCache);
                      if (url && url !== fallbackUrl) {
                        allImages.push(url);
                      } else {
                        missingImages.push(path);
                      }
                    }
                  }
                } else {
                  const path = extractPath(imgData);
                  if (path) {
                    xmlImagePaths.push(path);
                    const url = getImageUrl(path, existingFilesCache);
                    if (url && url !== fallbackUrl) {
                      allImages.push(url);
                    } else {
                      missingImages.push(path);
                    }
                  }
                }
                
                // Detailed logging
                console.log(`[1C IMPORT] Product: ${name}, SKU: ${sku}`);
                console.log(`[1C IMPORT]   - XML paths: ${xmlImagePaths.length}, Found in S3: ${allImages.length}, Missing: ${missingImages.length}`);
                if (missingImages.length > 0) {
                  console.log(`[1C IMPORT]   - MISSING FILES (1C did not upload): ${missingImages.join(', ')}`);
                }
                const imageUrl = allImages.length > 0 ? allImages[0] : fallbackUrl;
                const thumbnailUrl = getThumbnailUrl(imageUrl);
                const images = allImages.length > 0 ? allImages : [fallbackUrl];
                
                // Extract 1C group hierarchy for auto-subcategory creation
                let importGroup1c = "";
                let importGroupHierarchy: GroupHierarchy | null = null;
                const importGroupId = extractGroupId(item["Группы"]);
                if (importGroupId) {
                  const groupId = importGroupId;
                  const xmlGroups = result?.["КоммерческаяИнформация"]?.["Каталог"]?.["Группы"]?.["Группа"];
                  if (xmlGroups) {
                    const xmlGroupsArray = Array.isArray(xmlGroups) ? xmlGroups : [xmlGroups];
                    const findGroupWithPath = (arr: any[], id: string, parentName?: string): { name: string; hierarchy: GroupHierarchy } | null => {
                      for (const g of arr) {
                        const gName = g["Наименование"] || "";
                        const rootName = parentName || gName;
                        if (g["Ид"] === id) {
                          return { name: gName, hierarchy: { rootGroup: rootName, subGroup: parentName ? gName : null } };
                        }
                        if (g["Группы"]?.["Группа"]) {
                          const nested = Array.isArray(g["Группы"]["Группа"]) ? g["Группы"]["Группа"] : [g["Группы"]["Группа"]];
                          const found = findGroupWithPath(nested, id, rootName);
                          if (found) return found;
                        }
                      }
                      return null;
                    };
                    const groupResult = findGroupWithPath(xmlGroupsArray, groupId);
                    if (groupResult) {
                      importGroup1c = groupResult.name;
                      importGroupHierarchy = groupResult.hierarchy;
                    }
                  }
                }
                
                let category: string;
                let subcategory: string | null;
                
                if (importGroupHierarchy && isIgnoredRootGroup(importGroupHierarchy.rootGroup)) {
                  console.log(`[1C IMPORT] SKIP product "${name}" — root group "${importGroupHierarchy.rootGroup}" is ignored`);
                  processedCount++;
                  continue;
                }
                
                if (importGroupHierarchy && isAllowedRootGroup(importGroupHierarchy.rootGroup)) {
                  const mapped = mapGroupHierarchyToCategory(importGroupHierarchy);
                  if (mapped) {
                    if (mapped.category === "socks") {
                      const sockResult = mapProductCategory(sku, name, importGroup1c);
                      category = sockResult.category;
                      subcategory = sockResult.subcategory;
                    } else {
                      category = mapped.category;
                      subcategory = mapped.subcategory;
                    }
                    if (subcategory) {
                      await autoAddSubcategory(category, subcategory, storage);
                    }
                  } else {
                    const fallback = mapProductCategory(sku, name, importGroup1c);
                    category = fallback.category;
                    subcategory = fallback.subcategory;
                  }
                } else {
                  const fallback = mapProductCategory(sku, name, importGroup1c);
                  category = fallback.category;
                  subcategory = fallback.subcategory;
                }
                
                if (importGroupHierarchy) {
                  console.log(`[1C IMPORT] Product "${name}" 1C group: "${importGroup1c}" (root: "${importGroupHierarchy.rootGroup}", sub: "${importGroupHierarchy.subGroup || 'N/A'}") -> ${category}/${subcategory}`);
                }
                
                const onSale = isOnSale(name, 0);
                
                const existing = productsByExtId.get(externalId);
                const hasRealNewImages = allImages.length > 0 && !allImages.every(img => img.includes(fallbackUrl));
                
                // Extract color and sizes from product name
                const { extractColorFromName, extractSizesFromName } = await import("./categoryMapper");
                const extractedColor = extractColorFromName(name);
                const extractedSizes = extractSizesFromName(name);
                
                // Use extracted sizes if XML didn't provide them
                const finalSizes = sizes.length > 0 ? sizes : extractedSizes;
                
                try {
                  if (!existing) {
                    const slug = generateUniqueSlug(name, existingSlugs);
                    existingSlugs.push(slug);
                    await storage.createProduct({ 
                      externalId, sku, name, description, price: 0, 
                      imageUrl, thumbnailUrl, images, 
                      category, subcategory, onSale, sizes: finalSizes, colors,
                      color: extractedColor,
                      slug,
                      isNew: true,
                      badgeText: "NEW",
                      artistSlug: getArtistSlugFromName(name) || undefined,
                    } as any);
                    await throttle();
                    createdCount++;
                    console.log(`[1C IMPORT] [${processedCount}/${productsArray.length}] CREATED: ${name} → ${slug} (${sku}) [Color: ${extractedColor || 'N/A'}, Sizes: ${finalSizes.join(',')}]`);
                  } else {
                    const updateData: any = { name, description, sku, category, subcategory, onSale, sizes: finalSizes, colors, color: extractedColor };
                    if (hasRealNewImages) {
                      updateData.imageUrl = imageUrl;
                      updateData.thumbnailUrl = thumbnailUrl;
                      updateData.images = images;
                    }
                    // Auto-set artistSlug only if not yet tagged (don't overwrite manual admin settings)
                    if (!(existing as any).artistSlug) {
                      const detectedArtistSlug = getArtistSlugFromName(name);
                      if (detectedArtistSlug) updateData.artistSlug = detectedArtistSlug;
                    }
                    if (!(existing as any).slug) {
                      const slug = generateUniqueSlug(name, existingSlugs);
                      existingSlugs.push(slug);
                      updateData.slug = slug;
                      console.log(`[1C IMPORT] Auto-slug for existing product: ${name} → ${slug}`);
                    }
                    await storage.updateProduct(existing.id, updateData);
                    await throttle();
                    updatedCount++;
                    console.log(`[1C IMPORT] [${processedCount}/${productsArray.length}] UPDATED: ${name} (${sku}) [Color: ${extractedColor || 'N/A'}]`);
                  }
                } catch (productError: any) {
                  errorCount++;
                  console.error(`[1C IMPORT] [${processedCount}/${productsArray.length}] ERROR for ${name}: ${productError.message}`);
                }
              }
              
              console.log(`[1C IMPORT] ========== IMPORT COMPLETE ==========`);
              console.log(`[1C IMPORT] Total in XML: ${productsArray.length}`);
              console.log(`[1C IMPORT] Created: ${createdCount}`);
              console.log(`[1C IMPORT] Updated: ${updatedCount}`);
              console.log(`[1C IMPORT] Errors: ${errorCount}`);
              storage.clearCache();
            }

            // Handle Offers (Prices + Sizes)
            const offersPkg = result?.["КоммерческаяИнформация"]?.["ПакетПредложений"];
            if (offersPkg?.["Предложения"]?.["Предложение"]) {
              const offers = offersPkg["Предложения"]["Предложение"];
              const offersArray = Array.isArray(offers) ? offers : [offers];
              console.log(`[1C] Found ${offersArray.length} offers to process`);
              
              // Build price types map from XML header
              const priceTypesMap = buildPriceTypesMap(result);
              console.log(`[1C] Price types found: ${Array.from(priceTypesMap.values()).join(', ') || 'none'}`);
              
              // Collect sizes and prices from offers (deduplicated by baseId)
              const productSizes = await processOffersSizes(offersArray);
              const productPrices = collectPricesFromOffers(offersArray, priceTypesMap);
              
              // Update prices (one update per product instead of per offer)
              await updateProductPricesFromOffers(productPrices);
              
              // Update sizes for products
              const sizesUpdated = await updateProductSizesFromOffers(productSizes);
              console.log(`[1C] Sizes updated for ${sizesUpdated} products`);
            }
            storage.clearCache(); // Clear cache once at the end
          } catch (e) {
            console.error(`[1C] XML Parse error for ${filename}:`, e);
          }
        } else {
          console.error(`[1C] File data not found for ${filename}`);
        }
        return res.send("success");
      }
      // NOTE: sale checkauth, init, query are handled earlier in this handler (lines 191-257)
    }
    
    // For POST requests with body, let the next handler take over or handle here
    if (req.method === "POST") {
      console.log(`[1C DEBUG] POST request: type=${type}, mode=${mode}, filename=${filename}, size=${req.headers['content-length']}`);
      
      // File and import handling is done in the dedicated app.post handler below
      // Just pass through to the main handler for both catalog and sale types
      if ((type === "catalog" || type === "sale") && (mode === "file" || mode === "import")) {
        console.log(`[1C DEBUG] Middleware passing through to main handler: type=${type}, mode=${mode}, filename=${filename}`);
        return next();
      }
      if (type === "sale" && mode === "success") {
        console.log("[1C] Sale exchange finished successfully");
        return res.send("success");
      }
      
      // Log unhandled POST requests
      console.log(`[1C WARNING] Unhandled POST: type=${type}, mode=${mode}, filename=${filename}`);
      console.log(`[1C WARNING] This POST was not processed! Returning success anyway.`);
    }

    res.send("success");
  });

  // Sync products from Object Storage (for production where 1c_uploads is not available)
  app.post("/api/sync-from-storage", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getSyncKey();

    if (!expectedKey || apiKey !== expectedKey) {
      console.log(`[Sync] Unauthorized sync attempt`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[Sync] Starting sync from Object Storage...");
    
    try {
      // Load existing files from Object Storage before parsing XML
      await loadExistingFilesFromStorage(true);
      
      const xmlParserOptions = {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        allowBooleanAttributes: true,
        parseAttributeValue: true,
        trimValues: true,
        // Always treat these tags as arrays
        isArray: (name: string) => {
          return name === "Картинка" || name === "Товар" || name === "Предложение" || 
                 name === "ЗначениеРеквизита" || name === "ЗначенияСвойства" || name === "ХарактеристикаТовара";
        }
      };
      const parser = new XMLParser(xmlParserOptions);
      
      // Download import.xml from Object Storage
      const importXml = await downloadFromYandexStorage("products/import.xml");
      if (!importXml) {
        return res.status(404).json({ error: "import.xml not found in Object Storage" });
      }
      
      console.log("[Sync] Downloaded import.xml, parsing...");
      const importResult = parser.parse(importXml);
      
      let productsCreated = 0;
      let productsUpdated = 0;
      
      // Parse products from import.xml
      const items = importResult?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"];
      if (items) {
        const productsArray = Array.isArray(items) ? items : [items];
        console.log(`[Sync] Found ${productsArray.length} products in import.xml`);
        
        for (const item of productsArray) {
          const externalId = item["Ид"];
          const name = item["Наименование"];
          const description = item["Описание"] || "";
          const sku = item["Артикул"] || "";
          
          let sizes: string[] = [];
          let colors: string[] = [];
          if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
            const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
              ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
              : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
            for (const prop of props) {
              const propName = prop["Наименование"];
              const propValue = prop["Значение"];
              if (propName === "Размер" && propValue) sizes.push(propValue);
              if (propName === "Цвет" && propValue) colors.push(propValue);
            }
          }
          
          const imgData = item["Картинка"];
          // Parse ALL images from 1C
          let allImages: string[] = [];
          const fallbackUrl = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
          
          const extractPath = (img: any): string | null => {
            if (typeof img === 'string' && img.trim()) return img.trim();
            if (img && typeof img === 'object' && img["#text"]) return img["#text"];
            return null;
          };
          
          if (Array.isArray(imgData)) {
            for (const img of imgData) {
              const path = extractPath(img);
              if (path) {
                const url = getImageUrl(path, existingFilesCache);
                if (url && url !== fallbackUrl) allImages.push(url);
              }
            }
          } else {
            const path = extractPath(imgData);
            if (path) {
              const url = getImageUrl(path, existingFilesCache);
              if (url && url !== fallbackUrl) allImages.push(url);
            }
          }
          const imageUrl = allImages.length > 0 ? allImages[0] : fallbackUrl;
          const thumbnailUrl = getThumbnailUrl(imageUrl);
          const images = allImages.length > 0 ? allImages : [fallbackUrl];
          
          // Extract 1C group hierarchy for category mapping
          let group1c = "";
          let groupHierarchy: GroupHierarchy | null = null;
          const syncGroupId = extractGroupId(item["Группы"]);
          if (syncGroupId) {
            const groupId = syncGroupId;
            const groups = importResult?.["КоммерческаяИнформация"]?.["Каталог"]?.["Группы"]?.["Группа"];
            if (groups) {
              const groupsArray = Array.isArray(groups) ? groups : [groups];
              const findGroupWithPath = (groupsArr: any[], id: string, parentName?: string): { name: string; hierarchy: GroupHierarchy } | null => {
                for (const g of groupsArr) {
                  const gName = g["Наименование"] || "";
                  const rootName = parentName || gName;
                  if (g["Ид"] === id) {
                    return {
                      name: gName,
                      hierarchy: { rootGroup: rootName, subGroup: parentName ? gName : null }
                    };
                  }
                  if (g["Группы"]?.["Группа"]) {
                    const nested = Array.isArray(g["Группы"]["Группа"]) ? g["Группы"]["Группа"] : [g["Группы"]["Группа"]];
                    const found = findGroupWithPath(nested, id, rootName);
                    if (found) return found;
                  }
                }
                return null;
              };
              const result = findGroupWithPath(groupsArray, groupId);
              if (result) {
                group1c = result.name;
                groupHierarchy = result.hierarchy;
              }
            }
          }
          
          let category: string;
          let subcategory: string | null;
          
          if (groupHierarchy && isIgnoredRootGroup(groupHierarchy.rootGroup)) {
            console.log(`[Sync] SKIP product "${name}" — root group "${groupHierarchy.rootGroup}" is ignored`);
            continue;
          }
          
          if (groupHierarchy && isAllowedRootGroup(groupHierarchy.rootGroup)) {
            const mapped = mapGroupHierarchyToCategory(groupHierarchy);
            if (mapped) {
              if (mapped.category === "socks") {
                const sockResult = mapProductCategory(sku, name, group1c);
                category = sockResult.category;
                subcategory = sockResult.subcategory;
              } else {
                category = mapped.category;
                subcategory = mapped.subcategory;
              }
              
              if (subcategory) {
                await autoAddSubcategory(category, subcategory, storage);
              }
            } else {
              const fallback = mapProductCategory(sku, name, group1c);
              category = fallback.category;
              subcategory = fallback.subcategory;
            }
          } else {
            const fallback = mapProductCategory(sku, name, group1c);
            category = fallback.category;
            subcategory = fallback.subcategory;
          }
          
          if (group1c || groupHierarchy) {
            console.log(`[Sync] Product "${name}" 1C group: "${group1c}" (root: "${groupHierarchy?.rootGroup || 'N/A'}", sub: "${groupHierarchy?.subGroup || 'N/A'}") -> ${category}/${subcategory}`);
          }
          const onSale = isOnSale(name, 0);
          
          try {
            const existing = await storage.getProductByExternalId(externalId);
            const hasRealNewImages = allImages.length > 0 && !allImages.every(img => img.includes(fallbackUrl));
            
            if (!existing) {
              const existingBySku = sku ? await storage.getProductBySku(sku) : null;
              if (existingBySku) {
                // Build update object - omit image fields if no real new images
                const updateData: any = { externalId, name, description, category, subcategory, onSale, sizes, colors };
                if (hasRealNewImages) {
                  updateData.imageUrl = imageUrl;
                  updateData.thumbnailUrl = thumbnailUrl;
                  updateData.images = images;
                }
                await storage.updateProduct(existingBySku.id, updateData);
                productsUpdated++;
                await throttle(); // Prevent YDB overload
              } else {
                await storage.createProduct({
                  externalId,
                  sku,
                  name,
                  description,
                  price: 0,
                  imageUrl,
                  thumbnailUrl,
                  images,
                  category,
                  subcategory,
                  onSale,
                  sizes,
                  colors,
                  color: extractColorFromName(name) || 'Default',
                  isNew: true,
                  badgeText: "NEW"
                } as any);
                productsCreated++;
                await throttle(); // Prevent YDB overload
              }
            } else {
              // Build update object - omit image fields if no real new images
              const updateData: any = { name, description, sku, category, subcategory, onSale, sizes, colors, skipCacheClear: true };
              if (hasRealNewImages) {
                updateData.imageUrl = imageUrl;
                updateData.thumbnailUrl = thumbnailUrl;
                updateData.images = images;
              }
              await storage.updateProduct(existing.id, updateData);
              productsUpdated++;
              await throttleBulk(); // Use shorter delay for bulk operations
            }
          } catch (err: any) {
            console.error(`[Sync] Failed to save product ${name}:`, err.message);
          }
        }
      }
      
      // Download and parse offers.xml for prices and sizes
      console.log("[Sync] Attempting to download offers.xml from products/offers.xml...");
      const offersXml = await downloadFromYandexStorage("products/offers.xml");
      let pricesUpdated = 0;
      let sizesUpdated = 0;

      if (offersXml) {
        console.log("[Sync] Downloaded offers.xml, parsing...");
        const offersResult = parser.parse(offersXml);
        const offers = offersResult?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"];
        
        if (offers) {
          const offersArray = Array.isArray(offers) ? offers : [offers];
          console.log(`[Sync] Found ${offersArray.length} offers in offers.xml`);
          
          // Build price types map from XML header
          const priceTypesMap = buildPriceTypesMap(offersResult);
          console.log(`[Sync] Price types found: ${Array.from(priceTypesMap.values()).join(', ') || 'none'}`);
          
          // Collect sizes from offers
          const productSizes = await processOffersSizes(offersArray);
          
          // Collect prices AND stock from offers (deduplicated by baseId)
          const productPrices = collectPricesFromOffers(offersArray, priceTypesMap);
          
          // Update prices AND stock (one update per product instead of per offer)
          pricesUpdated = await updateProductPricesFromOffers(productPrices);
          console.log(`[Sync] Prices and stock updated for ${pricesUpdated} products`);
          
          // Update sizes for products
          sizesUpdated = await updateProductSizesFromOffers(productSizes);
          console.log(`[Sync] Sizes updated for ${sizesUpdated} products`);
        }
      }
      
      storage.clearCache();
      console.log(`[Sync] Complete: ${productsCreated} created, ${productsUpdated} updated`);
      console.log(`[Sync] Prices and stock: ${pricesUpdated} products updated`);
      
      // Auto-fix colors for products with null/empty color
      const allProducts = await storage.getProducts();
      let colorsFixed = 0;
      for (const product of allProducts) {
        if (!product.color || product.color === 'Default' || product.color === 'null') {
          const extractedColor = extractColorFromName(product.name);
          if (extractedColor) {
            await storage.updateProduct(product.id, { color: extractedColor });
            colorsFixed++;
          }
        }
      }
      if (colorsFixed > 0) {
        console.log(`[Sync] Auto-fixed colors for ${colorsFixed} products`);
        storage.clearCache();
      }
      
      return res.json({ 
        success: true, 
        message: `Synced from Object Storage: ${productsCreated} created, ${productsUpdated} updated, ${colorsFixed} colors fixed` 
      });
    } catch (err: any) {
      console.error("[Sync] Critical error during synchronization:", err);
      return res.status(500).json({ error: "Synchronization failed", details: err.message });
    }
  });

  // Get list of files in Object Storage for diagnostics (protected)
  app.get("/api/storage-files", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      await loadExistingFilesFromStorage(true);
      const files = Array.from(existingFilesCache).sort();
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
      const xmlFiles = files.filter(f => /\.xml$/i.test(f));
      
      return res.json({
        total: files.length,
        images: imageFiles.length,
        xml: xmlFiles.length,
        imageFiles: imageFiles.slice(0, 100), // First 100 for preview
        hasMore: imageFiles.length > 100
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Convert existing images in Object Storage to WebP format (protected)
  // Use ?limit=20 to process in batches (default 20, max 50)
  app.post("/api/convert-images-to-webp", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      console.error("[WebP] SYNC_API_KEY not configured");
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 40, 50);
      console.log(`[WebP] Starting image conversion (limit: ${limit})...`);
      
      // Clear cache to get fresh data including newly synced products
      storage.clearCache();
      console.log(`[WebP] Cache cleared to get fresh product data`);
      
      // Get main product images (imageUrl) from database - PRIORITY
      const allProducts = await storage.getProducts();
      const mainImageKeys = new Set<string>();
      for (const product of allProducts) {
        if (product.imageUrl && /\.(jpg|jpeg|png)/i.test(product.imageUrl)) {
          // Extract key from URL: https://storage.yandexcloud.net/bmg/products/filename.jpg -> products/filename.jpg
          const match = product.imageUrl.match(/products\/[^?]+/);
          if (match) {
            mainImageKeys.add(match[0]);
          }
        }
      }
      console.log(`[WebP] Found ${mainImageKeys.size} main product images in database`);
      
      // List all images in products folder
      const allKeys = await listObjectsFromYandexStorage("products/");
      const allWebpKeys = new Set(allKeys.filter(key => /\.webp$/i.test(key)));
      
      // Find images that don't have WebP version yet
      const needsConversion = allKeys
        .filter(key => /\.(jpg|jpeg|png)$/i.test(key))
        .filter(key => {
          const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, '.webp');
          return !allWebpKeys.has(webpKey);
        });
      
      // PRIORITY: Main images first (imageUrl), then secondary images
      const mainImagesNeedConversion = needsConversion.filter(key => mainImageKeys.has(key));
      const secondaryImagesNeedConversion = needsConversion.filter(key => !mainImageKeys.has(key));
      
      console.log(`[WebP] Priority: ${mainImagesNeedConversion.length} main images, ${secondaryImagesNeedConversion.length} secondary images need conversion`);
      
      // Take main images first, then fill with secondary if limit allows
      const imageKeys = [
        ...mainImagesNeedConversion.slice(0, limit),
        ...secondaryImagesNeedConversion.slice(0, Math.max(0, limit - mainImagesNeedConversion.length))
      ];
      
      const totalRemaining = needsConversion.length;
      
      console.log(`[WebP] Found ${totalRemaining} images needing conversion, processing ${imageKeys.length}`);
      
      let converted = 0;
      let failed = 0;
      
      for (const key of imageKeys) {
        try {
          const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, '.webp');
          const thumbKey = key.replace(/\.(jpg|jpeg|png)$/i, '_thumb.webp');
          
          // Download original image
          const imageBuffer = await downloadBinaryFromYandexStorage(key);
          if (!imageBuffer) {
            console.log(`[WebP] Could not download: ${key}`);
            failed++;
            continue;
          }
          
          // Convert to WebP (full size)
          const webpBuffer = await sharp(imageBuffer)
            .webp({ quality: 85 })
            .toBuffer();
          
          const thumbBuffer = await sharp(imageBuffer)
            .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
            .sharpen()
            .webp({ quality: 88 })
            .toBuffer();
          
          // Upload WebP version
          const webpFilename = webpKey.replace('products/', '');
          await uploadToYandexStorage(webpBuffer, webpFilename, 'image/webp');
          
          // Upload thumbnail
          const thumbFilename = thumbKey.replace('products/', '');
          await uploadToYandexStorage(thumbBuffer, thumbFilename, 'image/webp');
          
          console.log(`[WebP] Converted: ${key} -> ${webpKey} + thumbnail`);
          converted++;
          
        } catch (err: any) {
          console.error(`[WebP] Failed to convert ${key}:`, err.message);
          failed++;
        }
      }
      
      const remaining = totalRemaining - converted;
      console.log(`[WebP] Batch complete: ${converted} converted, ${failed} failed, ${remaining} remaining`);
      
      // Clear cache so next request sees fresh data
      storage.clearCache();
      
      res.json({
        success: true,
        message: `Converted ${converted} images to WebP`,
        details: { converted, failed, remaining, hint: remaining > 0 ? "Run again to convert more" : "All done!" }
      });
      
    } catch (error) {
      console.error("[WebP] Error:", error);
      res.status(500).json({ error: "Conversion failed", details: String(error) });
    }
  });

  // Smart update: only switch to WebP if file exists in bucket (protected)
  app.post("/api/update-images-to-webp", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      console.error("[WebP URLs] SYNC_API_KEY not configured");
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Helper to check if webp file exists in bucket
    async function webpExists(jpgUrl: string): Promise<boolean> {
      try {
        const webpUrl = jpgUrl.replace(/\.(jpg|jpeg|png)(\?.*)?$/i, '.webp');
        const baseUrl = webpUrl.split('?')[0]; // Remove query params
        const response = await fetch(baseUrl, { method: 'HEAD' });
        return response.status === 200;
      } catch {
        return false;
      }
    }
    
    try {
      console.log("[WebP URLs] Smart update: checking which WebP files exist...");
      
      // Clear cache to get fresh data including newly synced products
      storage.clearCache();
      
      const products = await storage.getProducts();
      let updated = 0;
      let skipped = 0;
      
      const BATCH_SIZE = 5; // Smaller batches for HEAD requests
      const DELAY_MS = 300;
      
      const productsToCheck = products.filter(p => 
        p.imageUrl && /\.(jpg|jpeg|png)(\?|$)/i.test(p.imageUrl)
      );
      
      const alreadyWebp = products.filter(p => 
        p.imageUrl && /\.webp(\?|$)/i.test(p.imageUrl)
      ).length;
      
      console.log(`[WebP URLs] Checking ${productsToCheck.length} products for WebP versions (${alreadyWebp} already on WebP)...`);
      
      for (let i = 0; i < productsToCheck.length; i += BATCH_SIZE) {
        const batch = productsToCheck.slice(i, i + BATCH_SIZE);

        // allSettled — one failed product must not abort the whole batch.
        const results = await Promise.allSettled(batch.map(async (product) => {
          // Check if webp exists in bucket
          const hasWebp = await webpExists(product.imageUrl!);
          
          if (hasWebp) {
            const webpUrl = product.imageUrl!.replace(/\.(jpg|jpeg|png)(\?|$)/i, '.webp$2');
            
            const updatedImages = (product as any).images?.map((img: string) => 
              img.replace(/\.(jpg|jpeg|png)(\?|$)/i, '.webp$2')
            );
            
            const updateData: any = { imageUrl: webpUrl };
            if (updatedImages) {
              updateData.images = updatedImages;
            }
            
            await storage.updateProduct(product.id, updateData);
            updated++;
            console.log(`[WebP] Updated: ${product.name?.substring(0, 30)}`);
          } else {
            skipped++;
          }
        }));

        const failedInBatch = results.filter(r => r.status === 'rejected');
        if (failedInBatch.length) {
          console.warn(`[WebP URLs] ${failedInBatch.length}/${results.length} items failed in batch:`,
            failedInBatch.slice(0, 3).map(f => (f as PromiseRejectedResult).reason?.message || (f as PromiseRejectedResult).reason));
        }

        console.log(`[WebP URLs] Progress: ${Math.min(i + BATCH_SIZE, productsToCheck.length)}/${productsToCheck.length} (updated: ${updated}, skipped: ${skipped})`);
        
        if (i + BATCH_SIZE < productsToCheck.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
      
      console.log(`[WebP URLs] Complete: ${updated} updated, ${skipped} skipped (no WebP file), ${alreadyWebp} already on WebP`);
      storage.clearCache();
      
      const needsJpg = productsToCheck.length;
      res.json({
        success: true,
        message: updated > 0 
          ? `Обновлено ${updated} товаров на WebP, пропущено ${skipped} (нет WebP файла)`
          : needsJpg === 0 
            ? `Все ${alreadyWebp} товаров уже используют WebP`
            : `Пропущено ${skipped} товаров (нет WebP файла в бакете), ${alreadyWebp} уже на WebP`,
        details: { updated, skipped, alreadyWebp, needsJpg, total: products.length }
      });
      
    } catch (error) {
      console.error("[WebP URLs] Error:", error);
      res.status(500).json({ error: "Update failed", details: String(error) });
    }
  });

  // Rollback image URLs from WebP to JPG (protected) - use if webp files don't exist
  app.post("/api/rollback-images-to-jpg", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Rollback JPG] Rolling back image URLs to JPG...");
      
      const products = await storage.getProducts();
      let updated = 0;
      
      const BATCH_SIZE = 10;
      const DELAY_MS = 500;
      
      const productsToUpdate = products.filter(p => 
        p.imageUrl && /\.webp(\?|$)/i.test(p.imageUrl)
      );
      
      console.log(`[Rollback JPG] Found ${productsToUpdate.length} products to rollback`);
      
      for (let i = 0; i < productsToUpdate.length; i += BATCH_SIZE) {
        const batch = productsToUpdate.slice(i, i + BATCH_SIZE);

        // allSettled — one bad row must not abort the rollback batch.
        const results = await Promise.allSettled(batch.map(async (product) => {
          const jpgUrl = product.imageUrl!.replace(/\.webp(\?|$)/i, '.jpg$1');

          const updatedImages = (product as any).images?.map((img: string) =>
            img.replace(/\.webp(\?|$)/i, '.jpg$1')
          );

          const updateData: any = { imageUrl: jpgUrl };
          if (updatedImages) {
            updateData.images = updatedImages;
          }

          await storage.updateProduct(product.id, updateData);
          updated++;
        }));

        const failedInBatch = results.filter(r => r.status === 'rejected');
        if (failedInBatch.length) {
          console.warn(`[Rollback JPG] ${failedInBatch.length}/${results.length} items failed in batch:`,
            failedInBatch.slice(0, 3).map(f => (f as PromiseRejectedResult).reason?.message || (f as PromiseRejectedResult).reason));
        }

        console.log(`[Rollback JPG] Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${Math.min(i + BATCH_SIZE, productsToUpdate.length)}/${productsToUpdate.length}`);
        
        if (i + BATCH_SIZE < productsToUpdate.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
      
      console.log(`[Rollback JPG] Complete: ${updated} products rolled back`);
      storage.clearCache();
      
      res.json({
        success: true,
        message: `Rolled back ${updated} product image URLs to JPG`,
        details: { updated, total: products.length }
      });
      
    } catch (error) {
      console.error("[Rollback JPG] Error:", error);
      res.status(500).json({ error: "Rollback failed", details: String(error) });
    }
  });

  // Smart delete JPG files that have WebP versions (protected)
  // Body params:
  //   limit: number (optional) - max files to delete, default = all
  //   filter: string (optional) - filter files by name (e.g. "N024" to delete only N024 products)
  //   dryRun: boolean (optional) - if true, only show what would be deleted without deleting
  app.post("/api/delete-jpg-with-webp", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const { limit, filter, dryRun } = req.body || {};
      const maxDelete = typeof limit === 'number' && limit > 0 ? limit : Infinity;
      const filterStr = typeof filter === 'string' ? filter.toLowerCase() : null;
      const isDryRun = dryRun === true;
      
      console.log(`[Delete JPG] Smart delete: limit=${maxDelete}, filter="${filterStr || 'none'}", dryRun=${isDryRun}`);
      
      const allKeys = await listObjectsFromYandexStorage("products/");
      
      let jpgFiles = allKeys.filter(key => /\.(jpg|jpeg|png)$/i.test(key));
      const webpFiles = new Set(allKeys.filter(key => /\.webp$/i.test(key)));
      
      // Apply filter if provided
      if (filterStr) {
        jpgFiles = jpgFiles.filter(key => key.toLowerCase().includes(filterStr));
        console.log(`[Delete JPG] After filter "${filterStr}": ${jpgFiles.length} JPG/PNG files`);
      }
      
      console.log(`[Delete JPG] Found ${jpgFiles.length} JPG/PNG files, ${webpFiles.size} WebP files total`);
      
      // Get all thumbnailUrls from products to protect them
      const products = await storage.getProducts();
      const usedThumbnails = new Set<string>();
      for (const p of products) {
        if (p.thumbnailUrl) {
          // Extract key from URL (after /bmg/)
          const match = p.thumbnailUrl.match(/\/bmg\/(.+?)(\?|$)/);
          if (match) usedThumbnails.add(match[1]);
        }
      }
      console.log(`[Delete JPG] Found ${usedThumbnails.size} thumbnails in use by products`);
      
      const jpgToDelete: string[] = [];
      
      for (const jpgKey of jpgFiles) {
        const webpKey = jpgKey.replace(/\.(jpg|jpeg|png)$/i, '.webp');
        if (webpFiles.has(webpKey)) {
          // Check if this JPG is used as a thumbnail
          if (usedThumbnails.has(jpgKey)) {
            console.log(`[Delete JPG] PROTECTED (used as thumbnail): ${jpgKey}`);
            continue;
          }
          jpgToDelete.push(jpgKey);
          if (jpgToDelete.length >= maxDelete) break;
        }
      }
      
      console.log(`[Delete JPG] ${jpgToDelete.length} JPG files have WebP versions and will be deleted`);
      
      // Dry run - just return what would be deleted
      if (isDryRun) {
        return res.json({
          success: true,
          dryRun: true,
          message: `Would delete ${jpgToDelete.length} JPG files`,
          files: jpgToDelete.slice(0, 50), // Show first 50
          totalToDelete: jpgToDelete.length
        });
      }
      
      let deleted = 0;
      let errors = 0;
      const BATCH_SIZE = 10;
      const DELAY_MS = 200;
      
      for (let i = 0; i < jpgToDelete.length; i += BATCH_SIZE) {
        const batch = jpgToDelete.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (key) => {
          try {
            const success = await deleteFromYandexStorage(key);
            if (success) {
              deleted++;
            } else {
              errors++;
            }
          } catch (err) {
            console.error(`[Delete JPG] Failed to delete ${key}:`, err);
            errors++;
          }
        }));
        
        console.log(`[Delete JPG] Batch ${Math.floor(i/BATCH_SIZE) + 1}: deleted ${deleted}/${jpgToDelete.length}`);
        
        if (i + BATCH_SIZE < jpgToDelete.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
      
      console.log(`[Delete JPG] Complete: ${deleted} deleted, ${errors} errors`);
      
      res.json({
        success: true,
        message: `Deleted ${deleted} JPG files that had WebP versions`,
        details: {
          deleted,
          errors,
          filter: filterStr,
          limit: maxDelete === Infinity ? "all" : maxDelete
        }
      });
      
    } catch (error) {
      console.error("[Delete JPG] Error:", error);
      res.status(500).json({ error: "Delete JPG failed", details: String(error) });
    }
  });

  // Generate thumbnails from existing WebP images (protected)
  app.post("/api/generate-thumbnails", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      console.error("[Thumbnails] SYNC_API_KEY not configured");
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const force = req.query.force === "true";
      const folder = (req.query.folder as string) || "all"; // "products", "site", or "all"
      console.log(`[Thumbnails] Starting thumbnail generation (limit: ${limit}, force: ${force}, folder: ${folder})...`);

      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      const { S3Client: S3Regen, PutObjectCommand: PutRegen } = await import("@aws-sdk/client-s3");
      const s3Regen = new S3Regen({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
        },
      });

      const foldersToProcess: string[] = [];
      if (folder === "all" || folder === "products") foldersToProcess.push("products/");
      if (folder === "all" || folder === "site") foldersToProcess.push("site/");

      let allToProcess: string[] = [];

      for (const prefix of foldersToProcess) {
        const allKeys = await listObjectsFromYandexStorage(prefix);
        const webpKeys = allKeys.filter(key => /\.webp$/i.test(key) && !/_thumb\.webp$/i.test(key));
        const existingThumbs = new Set(allKeys.filter(key => /_thumb\.webp$/i.test(key)));

        if (force) {
          allToProcess = allToProcess.concat(webpKeys);
          console.log(`[Thumbnails] Force mode for ${prefix}: ${webpKeys.length} images`);
        } else {
          const needsThumbnail = webpKeys.filter(key => {
            const thumbKey = key.replace(/\.webp$/i, '_thumb.webp');
            return !existingThumbs.has(thumbKey);
          });
          allToProcess = allToProcess.concat(needsThumbnail);
          console.log(`[Thumbnails] ${prefix}: ${needsThumbnail.length} images need thumbnails`);
        }
      }

      const totalCount = allToProcess.length;
      const toProcess = allToProcess.slice(0, limit);
      console.log(`[Thumbnails] Total to process: ${totalCount}, this batch: ${toProcess.length}`);

      let generated = 0;
      let failed = 0;

      for (const key of toProcess) {
        try {
          const thumbKey = key.replace(/\.webp$/i, '_thumb.webp');

          const imageBuffer = await downloadBinaryFromYandexStorage(key);
          if (!imageBuffer) {
            console.log(`[Thumbnails] Could not download: ${key}`);
            failed++;
            continue;
          }

          const thumbBuffer = await sharp(imageBuffer)
            .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
            .sharpen()
            .webp({ quality: 88 })
            .toBuffer();

          if (key.startsWith("products/")) {
            const thumbFilename = thumbKey.replace('products/', '');
            await uploadToYandexStorage(thumbBuffer, thumbFilename, 'image/webp');
          } else {
            await s3Regen.send(new PutRegen({
              Bucket: bucketName,
              Key: thumbKey,
              Body: thumbBuffer,
              ContentType: "image/webp",
              ACL: "public-read",
              CacheControl: "public, max-age=31536000, immutable",
            }));
          }

          console.log(`[Thumbnails] Generated: ${thumbKey}`);
          generated++;

        } catch (err: any) {
          console.error(`[Thumbnails] Failed for ${key}:`, err.message);
          failed++;
        }
      }

      const remaining = totalCount - toProcess.length + (toProcess.length - generated);
      console.log(`[Thumbnails] Batch complete: ${generated} generated, ${failed} failed, ~${remaining} remaining`);
      res.json({
        success: true,
        message: `Generated ${generated} thumbnails (450px, quality 88, sharp)`,
        details: { generated, failed, remaining, force, folder, hint: remaining > 0 ? "Run again to generate more" : "All done!" }
      });

    } catch (error) {
      console.error("[Thumbnails] Error:", error);
      res.status(500).json({ error: "Generation failed", details: String(error) });
    }
  });

  // Add thumbnail_url column to YDB products table (migration)
  app.post("/api/migrate-thumbnail-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding thumbnail_url column to products table...");
      
      const result = await storage.addThumbnailColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add wholesale columns to users table (migration)
  app.post("/api/migrate-wholesale-columns", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding wholesale columns to users table...");
      
      const { authStorage } = await import("./auth-storage");
      const result = await authStorage.addWholesaleColumns();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add wholesale_price column to products table (migration)
  app.post("/api/migrate-wholesale-price-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding wholesale_price column to products table...");
      
      const result = await storage.addWholesalePriceColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add on_sale column to products table (migration)
  app.post("/api/migrate-on-sale-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding on_sale column to products table...");
      
      const result = await storage.addOnSaleColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add old_price column to products table (migration)
  app.post("/api/migrate-old-price-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding old_price column to products table...");
      
      const result = await (storage as any).addOldPriceColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add is_hidden column to products table (migration)
  app.post("/api/migrate-is-hidden-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding is_hidden column to products table...");
      
      const result = await storage.addIsHiddenColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add auto_hide_override column to products table (migration)
  app.post("/api/migrate-auto-hide-override-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding auto_hide_override column to products table...");
      
      const result = await storage.addAutoHideOverrideColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add product details columns (migration for admin product editor)
  app.post("/api/migrate-product-details-columns", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding product details columns...");
      
      const ydb = await import("ydb-sdk");
      const ydbDriver = await waitForDriver();
      
      if (!ydbDriver) {
        return res.status(503).json({ error: "YDB not available" });
      }
      
      const utf8Type = ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } });
      const jsonType = ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.JSON } } });

      const columnsToAdd = [
        { name: 'composition', type: utf8Type },
        { name: 'care_instructions', type: utf8Type },
        { name: 'delivery', type: utf8Type },
        { name: 'return_policy', type: utf8Type },
        { name: 'measurements', type: jsonType },
        { name: 'look_products', type: jsonType },
        { name: 'look_category', type: utf8Type },
        { name: 'look_subcategory', type: utf8Type },
        { name: 'note', type: utf8Type },
      ];
      
      const results: string[] = [];
      
      for (const col of columnsToAdd) {
        try {
          await ydbDriver.tableClient.withSession(async (session) => {
            await session.alterTable('products', {
              addColumns: [{ name: col.name, type: col.type }]
            } as any);
          });
          results.push(`${col.name}: added`);
          console.log(`[Migration] Added column: ${col.name}`);
        } catch (err: any) {
          if (err.message?.includes("already exists") || err.message?.includes("Duplicate column") || err.message?.includes("Cannot alter type")) {
            results.push(`${col.name}: already exists`);
          } else {
            results.push(`${col.name}: error - ${err.message}`);
          }
        }
      }
      
      res.json({ success: true, results });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add stock column to products table (migration)
  app.post("/api/migrate-stock-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding stock column to products table...");
      
      const result = await storage.addStockColumn();
      
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Add slug column to products table (migration)
  app.post("/api/migrate-slug-column", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Migration] Adding slug column to products table...");
      const result = await storage.addSlugColumn();
      console.log("[Migration] Result:", result.message);
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("[Migration] Error:", error);
      res.status(500).json({ error: "Migration failed", details: String(error) });
    }
  });

  // Backfill slugs for all products that don't have one
  app.post("/api/backfill-slugs", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const { generateUniqueSlug } = await import("./slugify");
      const products = await storage.getProducts();
      const existingSlugs: string[] = [];
      let updated = 0;
      let skipped = 0;
      
      for (const product of products) {
        const slugValue = (product as any).slug;
        const hasValidSlug = slugValue && !/^\d+$/.test(String(slugValue));
        if (hasValidSlug) {
          existingSlugs.push(slugValue);
          skipped++;
          continue;
        }
        
        const slug = generateUniqueSlug(product.name, existingSlugs);
        existingSlugs.push(slug);
        
        await storage.updateProduct(product.id, { slug } as any);
        updated++;
        console.log(`[Slug Backfill] ${product.name} → ${slug}`);
        await new Promise(r => setTimeout(r, 50));
      }
      
      if (updated > 0) {
        storage.clearCache();
        console.log(`[Slug Backfill] Cache cleared after ${updated} slug updates`);
      }
      console.log(`[Slug Backfill] Done: ${updated} updated, ${skipped} skipped`);
      res.json({ success: true, updated, skipped });
    } catch (error) {
      console.error("[Slug Backfill] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Get product by slug (public API)
  app.get("/api/products/by-slug/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      const product = await storage.getProductBySlug(slug);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("[API] Error fetching product by slug:", error);
      res.status(500).json({ error: "Failed to fetch product" });
    }
  });

  // Auto-hide all products without images or with zero price (admin only)
  // Optional filter: "noimage" or "zeroprice" to only hide specific type
  app.post("/api/products/auto-hide-problematic", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const { filter } = req.body; // "noimage" | "zeroprice" | undefined (both)
      const products = await storage.getProducts();
      let hiddenNoImage = 0;
      let hiddenZeroPrice = 0;
      let skippedOverride = 0;
      
      for (const product of products) {
        if ((product as any).isHidden === true) continue;
        if ((product as any).autoHideOverride === true) {
          skippedOverride++;
          continue;
        }
        if ((product as any).preorderEnabled === true) continue;
        
        // Check for issues
        const url = product.imageUrl || "";
        const hasNoRealImage = !url || 
          url === "" || 
          url === "/placeholder.svg" ||
          url.startsWith("/attached_assets/") ||
          url.startsWith("/1c_uploads/") ||
          (!url.startsWith("https://storage.yandexcloud.net/") && !url.startsWith("http"));
        const hasZeroPrice = !product.price || product.price <= 0;
        
        // Apply filter if specified
        let shouldHide = false;
        if (filter === "noimage" && hasNoRealImage) {
          shouldHide = true;
        } else if (filter === "zeroprice" && hasZeroPrice) {
          shouldHide = true;
        } else if (!filter && (hasNoRealImage || hasZeroPrice)) {
          shouldHide = true;
        }
        
        if (shouldHide) {
          await storage.updateProduct(product.id, { isHidden: true } as any);
          // Add small delay to avoid YDB resource exhaustion
          await new Promise(resolve => setTimeout(resolve, 50));
          if (hasNoRealImage) hiddenNoImage++;
          if (hasZeroPrice && !hasNoRealImage) hiddenZeroPrice++;
          console.log(`[AutoHide] Hidden product "${product.name}" (noImage=${hasNoRealImage}, zeroPrice=${hasZeroPrice})`);
        }
      }
      
      console.log(`[AutoHide] Hidden ${hiddenNoImage} products without images, ${hiddenZeroPrice} products with zero price, skipped ${skippedOverride} with override`);
      res.json({ 
        success: true, 
        hiddenNoImage, 
        hiddenZeroPrice, 
        skippedOverride,
        total: hiddenNoImage + hiddenZeroPrice
      });
    } catch (error) {
      console.error("[AutoHide] Error:", error);
      res.status(500).json({ error: "Failed to auto-hide products" });
    }
  });

  // Hide/show product (admin only)
  app.post("/api/products/:id/hide", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const { hidden } = req.body;
      
      // Get current product to check if it has issues
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      
      const updateData: any = { isHidden: hidden };
      
      // Check if product has issues (no image, zero price, or zero stock)
      const url = product.imageUrl || "";
      const hasNoRealImage = !url || 
        url === "" || 
        url === "/placeholder.svg" ||
        url.startsWith("/attached_assets/") ||
        url.startsWith("/1c_uploads/") ||
        (!url.startsWith("https://storage.yandexcloud.net/") && !url.startsWith("http"));
      const hasZeroPrice = !product.price || product.price <= 0;
      const hasZeroStock = !product.stock || product.stock <= 0;
      const hasIssues = hasNoRealImage || hasZeroPrice || hasZeroStock;
      
      if (!hidden) {
        // Admin is SHOWING the product - set inStock=true so public API shows it
        updateData.inStock = true;
        if (hasIssues) {
          // Set override so auto-hide won't touch it
          updateData.autoHideOverride = true;
          console.log(`[Admin] Product ${id} shown with autoHideOverride (has issues: noImage=${hasNoRealImage}, zeroPrice=${hasZeroPrice}, zeroStock=${hasZeroStock})`);
        }
      } else {
        // Admin is HIDING the product - remove override and set inStock=false
        updateData.autoHideOverride = false;
        updateData.inStock = false;
      }
      
      await storage.updateProduct(id, updateData);
      
      console.log(`[Admin] Product ${id} ${hidden ? 'hidden' : 'shown'}`);
      res.json({ success: true, id, hidden, autoHideOverride: updateData.autoHideOverride });
    } catch (error) {
      console.error("[Admin] Error hiding product:", error);
      res.status(500).json({ error: "Failed to update product visibility" });
    }
  });

  // Get hidden products (admin only)
  app.get("/api/products/hidden", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const products = await storage.getProducts();
      const hiddenProducts = products.filter((p: any) => p.isHidden === true);
      console.log(`[Admin] Found ${hiddenProducts.length} hidden products out of ${products.length} total`);
      res.json({ products: hiddenProducts, total: hiddenProducts.length });
    } catch (error) {
      console.error("[Admin] Error getting hidden products:", error);
      res.status(500).json({ error: "Failed to get hidden products" });
    }
  });

  // Get products without images (admin only)
  app.get("/api/products/no-image", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const products = await storage.getProducts();
      const noImageProducts = products.filter((p: any) => {
        const url = p.imageUrl || "";
        // No image, empty, placeholder, or local path (not from storage)
        return !url || 
               url === "" || 
               url === "/placeholder.svg" ||
               url.startsWith("/attached_assets/") ||
               url.startsWith("/1c_uploads/") ||
               (!url.startsWith("https://storage.yandexcloud.net/") && !url.startsWith("http"));
      });
      console.log(`[Admin] Found ${noImageProducts.length} products without proper images`);
      res.json({ products: noImageProducts, total: noImageProducts.length });
    } catch (error) {
      console.error("[Admin] Error getting products without images:", error);
      res.status(500).json({ error: "Failed to get products without images" });
    }
  });

  // Get products with zero or negative price (admin only)
  app.get("/api/products/zero-price", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const products = await storage.getProducts();
      const zeroPriceProducts = products.filter((p: any) => {
        const price = p.price || 0;
        return price <= 0;
      });
      console.log(`[Admin] Found ${zeroPriceProducts.length} products with zero or negative price`);
      res.json({ products: zeroPriceProducts, total: zeroPriceProducts.length });
    } catch (error) {
      console.error("[Admin] Error getting zero-price products:", error);
      res.status(500).json({ error: "Failed to get zero-price products" });
    }
  });

  // ============ ADMIN PRODUCT MANAGEMENT ============
  
  // Create new product (admin only)
  app.post("/api/admin/products", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const { 
        name, description, price, category, subcategory,
        sizes, colors, composition, careInstructions, delivery, returnPolicy,
        measurements, images, imageUrl, sku, color, stock, sizeStock,
        wholesalePrice, discountPercent, sizeDiscounts, seoTitle, seoDescription, imageAlts,
        additionalCategories,
      } = req.body;
      
      if (!name || !price || !category) {
        return res.status(400).json({ error: "Missing required fields: name, price, category" });
      }
      
      const { generateUniqueSlug } = await import("./slugify");
      const allProducts = await storage.getProducts();
      const existingSlugs = allProducts.map((p: any) => p.slug).filter(Boolean);
      const autoSlug = req.body.slug || generateUniqueSlug(name, existingSlugs);

      const productData: any = {
        name,
        description: description || '',
        price: parseInt(price),
        category,
        subcategory: subcategory || null,
        sizes: sizes || [],
        colors: colors || [],
        imageUrl: imageUrl || images?.[0] || "/placeholder.svg",
        thumbnailUrl: (() => {
          const firstImg = imageUrl || images?.[0];
          if (firstImg && firstImg.includes('.webp') && !firstImg.includes('_thumb.webp')) {
            return firstImg.replace('.webp', '_thumb.webp');
          }
          return firstImg || null;
        })(),
        images: images || [],
        sku: sku || `MANUAL-${Date.now()}`,
        color: color || null,
        composition: composition || null,
        careInstructions: careInstructions || null,
        delivery: delivery || null,
        returnPolicy: returnPolicy || null,
        measurements: measurements || null,
        isNew: true,
        inStock: true,
        isHidden: false,
        stock: stock !== undefined ? parseInt(stock) : 0,
        sizeStock: sizeStock || {},
        slug: autoSlug,
        wholesalePrice: wholesalePrice ? parseInt(wholesalePrice) : null,
        discountPercent: discountPercent ? parseInt(discountPercent) : 0,
        sizeDiscounts: (sizeDiscounts && typeof sizeDiscounts === 'object') ? sizeDiscounts : {},
        seoTitle: seoTitle || '',
        seoDescription: seoDescription || '',
        imageAlts: Array.isArray(imageAlts) ? imageAlts : [],
        additionalCategories: Array.isArray(additionalCategories) ? additionalCategories : [],
      };
      
      const product = await storage.createProduct(productData);
      console.log(`[Admin] Created new product: ${name} (ID: ${product.id})`);
      res.json({ success: true, product });
    } catch (error) {
      console.error("[Admin] Error creating product:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  // Admin API - Update product category (move between categories)
  // IMPORTANT: Must be registered BEFORE /api/admin/products/:id to avoid Express treating "category" as :id
  app.patch("/api/admin/products/bulk-badges", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    const { ids, isNew, badgeText } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await storage.updateProduct(id, { isNew: !!isNew, badgeText: badgeText || null } as any);
        updated++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    storage.clearCache();
    console.log(`[Admin] Bulk badge update: ${updated}/${ids.length} products, isNew=${isNew}, badgeText="${badgeText || ''}"`);
    res.json({ updated, total: ids.length, errors: errors.length > 0 ? errors.slice(0, 5) : undefined });
  });

  app.patch("/api/admin/products/bulk-discount", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    const { ids, discountPercent } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }
    const dp = parseInt(discountPercent);
    const discount = isNaN(dp) ? 0 : Math.max(0, Math.min(dp, 99));

    let updated = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        await storage.updateProduct(id, { discountPercent: discount } as any);
        updated++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    storage.clearCache();
    console.log(`[Admin] Bulk discount: ${updated}/${ids.length} products, discount=${discount}%`);
    res.json({ updated, total: ids.length, errors: errors.length > 0 ? errors.slice(0, 5) : undefined });
  });

  app.patch("/api/admin/products/category", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { productIds, category, subcategory } = req.body;
      
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ message: "productIds array required" });
      }
      
      if (!category) {
        return res.status(400).json({ message: "category required" });
      }

      let updated = 0;
      for (const id of productIds) {
        try {
          await storage.updateProduct(id, { 
            category, 
            subcategory: subcategory || null 
          } as any);
          updated++;
        } catch (err) {
          console.error(`[Admin] Failed to update product ${id}:`, err);
        }
      }

      console.log(`[Admin] Moved ${updated} products to category: ${category}/${subcategory || 'none'}`);
      res.json({ success: true, updated, category, subcategory });
    } catch (err) {
      console.error("[Admin] Update category error:", err);
      res.status(500).json({ success: false, message: "Update failed" });
    }
  });

  // Bulk add/remove additional category (admin only)
  app.patch("/api/admin/products/additional-category", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { productIds, category, subcategory, action } = req.body;

      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ message: "productIds array required" });
      }
      if (!category) {
        return res.status(400).json({ message: "category required" });
      }

      let updated = 0;
      for (const id of productIds) {
        try {
          const product = await storage.getProduct(id);
          if (!product) continue;

          const existing: Array<{ category: string; subcategory: string }> =
            (product as any).additionalCategories || [];

          let newList: Array<{ category: string; subcategory: string }>;

          if (action === "remove") {
            newList = existing.filter(
              (ac) => !(ac.category === category && (ac.subcategory || "") === (subcategory || ""))
            );
          } else {
            const alreadyExists = existing.some(
              (ac) => ac.category === category && (ac.subcategory || "") === (subcategory || "")
            );
            if (alreadyExists) {
              updated++;
              continue;
            }
            newList = [...existing, { category, subcategory: subcategory || "" }];
          }

          await storage.updateProduct(id, { additionalCategories: newList } as any);
          updated++;
        } catch (err) {
          console.error(`[Admin] Failed to update additional category for product ${id}:`, err);
        }
      }

      console.log(`[Admin] Bulk ${action || "add"} additional category: ${category}/${subcategory || "none"} for ${updated} products`);
      res.json({ success: true, updated, category, subcategory });
    } catch (err) {
      console.error("[Admin] Bulk additional category error:", err);
      res.status(500).json({ success: false, message: "Update failed" });
    }
  });

  // Update product (admin only)
  app.patch("/api/admin/products/:id", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      
      const { 
        name, description, price, category, subcategory, additionalCategories,
        sizes, colors, composition, careInstructions, note, delivery, returnPolicy,
        measurements, images, imageUrl, sku, color, wholesalePrice,
        isNew, badgeText, lookProducts, lookCategory, lookSubcategory,
        preorderEnabled, preorderGoal, preorderDeadline, preorderProductionDate, preorderShippingDate,
        stock, sizeStock, slug, discountPercent, noSize, sizeDiscounts
      } = req.body;
      
      const updateData: any = {};
      
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = parseInt(price);
      if (category !== undefined) updateData.category = category;
      if (subcategory !== undefined) updateData.subcategory = subcategory;
      if (additionalCategories !== undefined) {
        updateData.additionalCategories = Array.isArray(additionalCategories) ? additionalCategories : [];
      }
      if (sizes !== undefined) updateData.sizes = sizes;
      if (colors !== undefined) updateData.colors = colors;
      if (composition !== undefined) updateData.composition = composition;
      if (careInstructions !== undefined) updateData.careInstructions = careInstructions;
      if (note !== undefined) updateData.note = note;
      if (delivery !== undefined) updateData.delivery = delivery;
      if (returnPolicy !== undefined) updateData.returnPolicy = returnPolicy;
      if (measurements !== undefined) updateData.measurements = measurements;
      if (sku !== undefined) updateData.sku = sku;
      if (color !== undefined) updateData.color = color;
      if (wholesalePrice !== undefined) updateData.wholesalePrice = parseInt(wholesalePrice);
      if (discountPercent !== undefined) {
        const dp = parseInt(discountPercent);
        updateData.discountPercent = isNaN(dp) || dp <= 0 ? 0 : Math.min(dp, 99);
      }
      if (isNew !== undefined) updateData.isNew = isNew;
      if (badgeText !== undefined) updateData.badgeText = badgeText || null;
      if (lookProducts !== undefined) {
        const validLookProducts = Array.isArray(lookProducts) 
          ? lookProducts.filter((id: any) => typeof id === 'number' && id > 0).slice(0, 6)
          : [];
        updateData.lookProducts = [...new Set(validLookProducts)];
        console.log(`[Admin] lookProducts update for product ${id}: received=${JSON.stringify(lookProducts)}, saved=${JSON.stringify(updateData.lookProducts)}`);
      }
      if (lookCategory !== undefined) {
        updateData.lookCategory = lookCategory || null;
        console.log(`[Admin] lookCategory update for product ${id}: ${lookCategory}`);
      }
      if (lookSubcategory !== undefined) {
        updateData.lookSubcategory = lookSubcategory || null;
        console.log(`[Admin] lookSubcategory update for product ${id}: ${lookSubcategory}`);
      }
      if (stock !== undefined) {
        const parsedStock = parseInt(stock);
        updateData.stock = isNaN(parsedStock) || parsedStock < 0 ? 0 : parsedStock;
        console.log(`[Admin] Stock update for product ${id}: ${updateData.stock}`);
      }
      if (sizeStock !== undefined && typeof sizeStock === 'object') {
        const cleanedSizeStock: Record<string, number> = {};
        for (const [k, v] of Object.entries(sizeStock)) {
          const num = parseInt(String(v));
          cleanedSizeStock[k] = isNaN(num) || num < 0 ? 0 : num;
        }
        updateData.sizeStock = cleanedSizeStock;
        console.log(`[Admin] SizeStock update for product ${id}: ${JSON.stringify(cleanedSizeStock)}`);
      }
      if (sizeDiscounts !== undefined && typeof sizeDiscounts === 'object') {
        const cleanedSizeDiscounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(sizeDiscounts)) {
          const num = parseInt(String(v));
          if (!isNaN(num) && num > 0 && num <= 99) {
            cleanedSizeDiscounts[k] = num;
          }
        }
        updateData.sizeDiscounts = cleanedSizeDiscounts;
        console.log(`[Admin] SizeDiscounts update for product ${id}: ${JSON.stringify(cleanedSizeDiscounts)}`);
      }
      if (preorderEnabled !== undefined) updateData.preorderEnabled = preorderEnabled;
      if (preorderGoal !== undefined) updateData.preorderGoal = parseInt(preorderGoal) || 0;
      if (preorderDeadline !== undefined) updateData.preorderDeadline = preorderDeadline || null;
      if (preorderProductionDate !== undefined) updateData.preorderProductionDate = preorderProductionDate || null;
      if (preorderShippingDate !== undefined) updateData.preorderShippingDate = preorderShippingDate || null;
      if (preorderEnabled && !product.preorderStatus) updateData.preorderStatus = "collecting";
      if (preorderEnabled && product.isHidden) {
        updateData.isHidden = false;
        console.log(`[Admin] Auto-showing product ${id} because preorder was enabled`);
      }
      if (slug !== undefined) {
        updateData.slug = slug;
      } else if (!(product as any).slug) {
        // Product has no slug — auto-generate from current (or new) name
        const currentName = name || product.name;
        const { generateUniqueSlug } = await import("./slugify");
        const allProducts = await storage.getProducts();
        const existingSlugs = allProducts.map((p: any) => p.slug).filter(Boolean);
        updateData.slug = generateUniqueSlug(currentName, existingSlugs);
        console.log(`[Admin] Auto-generated slug for product ${id}: ${updateData.slug}`);
      }
      if (noSize !== undefined) updateData.noSize = noSize;
      if (req.body.artistSlug !== undefined) {
        updateData.artistSlug = req.body.artistSlug || null;
        console.log(`[Admin] product ${id} artistSlug from request: "${req.body.artistSlug}" → stored as: "${updateData.artistSlug}"`);
      }

      // Handle images
      if (images !== undefined) {
        // Find images removed from the array → delete from Object Storage
        const oldImages: string[] = Array.isArray((product as any).images) ? (product as any).images : (product.imageUrl ? [product.imageUrl] : []);
        const newImageSet = new Set(images);
        const removedImages = oldImages.filter(url => !newImageSet.has(url));
        if (removedImages.length > 0 && process.env.YANDEX_STORAGE_BUCKET_NAME) {
          const bucketBase = `https://storage.yandexcloud.net/${process.env.YANDEX_STORAGE_BUCKET_NAME}/`;
          for (const url of removedImages) {
            if (url.startsWith(bucketBase)) {
              const key = url.slice(bucketBase.length);
              deleteFromYandexStorage(key).then(ok => {
                console.log(`[Admin] Deleted image from storage: ${key} → ${ok}`);
              }).catch(() => {});
              // Also delete _thumb version
              const thumbKey = key.replace(/\.webp$/i, '_thumb.webp');
              if (thumbKey !== key) {
                deleteFromYandexStorage(thumbKey).then(ok => {
                  console.log(`[Admin] Deleted thumb from storage: ${thumbKey} → ${ok}`);
                }).catch(() => {});
              }
            }
          }
        }

        updateData.images = images;
        if (images.length > 0) {
          updateData.imageUrl = images[0];
          const firstImg = images[0];
          updateData.thumbnailUrl = (firstImg && firstImg.includes('.webp') && !firstImg.includes('_thumb.webp'))
            ? firstImg.replace('.webp', '_thumb.webp')
            : firstImg;
          const secondImg = images.length > 1 ? images[1] : null;
          updateData.hoverThumbnailUrl = secondImg && secondImg.includes('.webp') && !secondImg.includes('_thumb.webp')
            ? secondImg.replace('.webp', '_thumb.webp')
            : secondImg;
        } else {
          updateData.imageUrl = '';
          updateData.thumbnailUrl = '';
          updateData.hoverThumbnailUrl = null;
        }
      }
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      
      await storage.updateProduct(id, updateData);
      const updated = await storage.getProduct(id);
      
      if (product) {
        const oldStock = (product as any).stock ?? 0;
        const oldSizeStock = (product as any).sizeStock || null;
        const newStock = updateData.stock !== undefined ? updateData.stock : oldStock;
        const newSizeStock = updateData.sizeStock || null;
        
        const prodImages = Array.isArray((product as any).images) && (product as any).images.length > 0 ? (product as any).images[0] : undefined;
        const prodSlug = (product as any).slug || undefined;
        if (newSizeStock && typeof newSizeStock === 'object') {
          processStockNotifications(id, product.name, oldSizeStock, newSizeStock as Record<string, number>, prodImages, prodSlug).catch(() => {});
        } else if (newStock > 0 && oldStock <= 0 && !newSizeStock) {
          const notifySize = product.sizes?.length > 0 ? product.sizes[0] : "one-size";
          processStockNotifications(id, product.name, { [notifySize]: 0 }, { [notifySize]: newStock }, prodImages, prodSlug).catch(() => {});
        }

        // Preorder notifications — отправляем при включении предзаказа
        if (preorderEnabled === true && !(product as any).preorderEnabled) {
          storage.getAllPreorderSubscribers().then(subscribers => {
            if (subscribers.length > 0) {
              const prodUrl = prodSlug ? `/products/${prodSlug}` : undefined;
              sendPreorderNotifications(product.name, subscribers, prodImages, prodUrl).catch(() => {});
              console.log(`[PreorderNotify] Sent notifications to ${subscribers.length} subscribers for "${product.name}"`);
            }
          }).catch(() => {});
        }

        // Price drop notifications — учитываем и прямое изменение цены, и скидку процентом
        const oldBasePrice = product.price || 0;
        const oldDiscountPct = (product as any).discountPercent || 0;
        const oldEffectivePrice = oldDiscountPct > 0 ? Math.round(oldBasePrice * (1 - oldDiscountPct / 100)) : oldBasePrice;

        const newBasePrice = updateData.price !== undefined ? updateData.price : oldBasePrice;
        const newDiscountPct = updateData.discountPercent !== undefined ? updateData.discountPercent : oldDiscountPct;
        const newEffectivePrice = newDiscountPct > 0 ? Math.round(newBasePrice * (1 - newDiscountPct / 100)) : newBasePrice;

        console.log(`[PriceDrop] old effective=${oldEffectivePrice} (base=${oldBasePrice}, disc=${oldDiscountPct}%), new effective=${newEffectivePrice} (base=${newBasePrice}, disc=${newDiscountPct}%)`);

        if (newEffectivePrice < oldEffectivePrice) {
          console.log(`[PriceDrop] Price dropped from ${oldEffectivePrice} to ${newEffectivePrice} for product ${id}`);
          (async () => {
            try {
              const subscribers = await storage.getPriceDropSubscribersByProduct(id);
              console.log(`[PriceDrop] Found ${subscribers.length} subscribers for product ${id}`);
              const eligible = subscribers.filter(s => s.priceAtSubscription > newEffectivePrice);
              console.log(`[PriceDrop] ${eligible.length} eligible (subscribed at > ${newEffectivePrice})`);
              if (eligible.length === 0) return;
              const baseUrl = process.env.SITE_URL || 'https://www.booomerangs.ru';
              const prodSlugForUrl = (updated as any)?.slug || id;
              const productUrl = `${baseUrl}/${prodSlugForUrl}`;
              const notifiedIds: string[] = [];
              for (const sub of eligible) {
                try {
                  await sendPriceDropEmail(sub.email, product.name, oldEffectivePrice, newEffectivePrice, productUrl, (product as any).imageUrl || undefined);
                  notifiedIds.push(sub.id);
                  console.log(`[PriceDrop] Email sent to ${sub.email}`);
                } catch (e) {
                  console.error(`[PriceDrop] Failed to send email to ${sub.email}:`, e);
                }
              }
              if (notifiedIds.length > 0) {
                await storage.markPriceDropSubscriptionsNotified(notifiedIds, newEffectivePrice);
                console.log(`[PriceDrop] Notified ${notifiedIds.length} subscribers for product ${id}`);
              }
            } catch (e) {
              console.error("[PriceDrop] Notification error:", e);
            }
          })();
        }
      }
      
      console.log(`[Admin] Updated product ${id}: ${updated?.name}`);
      res.json({ success: true, product: updated });
    } catch (error) {
      console.error("[Admin] Error updating product:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  // Upload product image (admin only)
  app.post("/api/admin/products/:id/images", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const rawId = req.params.id;
      const id = parseInt(rawId);
      const isNewProduct = rawId === "new" || isNaN(id);

      if (!isNewProduct) {
        const product = await storage.getProduct(id);
        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }
      }
      
      // Expect base64 image data in body
      const { imageData, filename, index } = req.body;
      if (!imageData) {
        return res.status(400).json({ error: "Missing imageData" });
      }
      
      // Convert base64 to buffer
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Convert to WebP using sharp
      const sharp = await import('sharp');
      const webpBuffer = await sharp.default(buffer)
        .resize(2000, 2600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92 })
        .toBuffer();
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileId = isNewProduct ? `new_${timestamp}` : id;
      const safeFilename = `admin_${fileId}_${index || 0}_${timestamp}.webp`;
      
      // Upload to S3
      const url = await uploadToYandexStorage(webpBuffer, safeFilename, 'image/webp');
      
      if (!url) {
        return res.status(500).json({ error: "Failed to upload image to storage" });
      }
      
      // Also generate and upload thumbnail (used in product cards)
      const thumbBuffer = await sharp.default(buffer)
        .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
        .sharpen()
        .webp({ quality: 88 })
        .toBuffer();
      const thumbFilename = safeFilename.replace('.webp', '_thumb.webp');
      await uploadToYandexStorage(thumbBuffer, thumbFilename, 'image/webp');
      
      console.log(`[Admin] Uploaded image for product ${rawId}: ${url}`);
      res.json({ success: true, url, thumbnailUrl: url.replace('.webp', '_thumb.webp') });
    } catch (error) {
      console.error("[Admin] Error uploading image:", error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // Get single product for editing (admin only)
  app.get("/api/admin/products/:id", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("[Admin] Error getting product:", error);
      res.status(500).json({ error: "Failed to get product" });
    }
  });

  // ============ END ADMIN PRODUCT MANAGEMENT ============

  // Regenerate product thumbnails: generate new _thumb.webp files AND update DB (protected)
  // Now generates thumbnails for ALL images in the product's images array (not just first two)
  app.post("/api/update-thumbnail-urls", async (req, res) => {
    const expectedKey = getAdminKey();
    if (!expectedKey) {
      console.error("[Thumbnails] SYNC_API_KEY not configured");
      return res.status(503).json({ error: "Service misconfigured: SYNC_API_KEY required" });
    }
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const force = req.query.force === "true";
      console.log(`[Thumbnails] Regenerating product thumbnails (limit: ${limit}, offset: ${offset}, force: ${force})...`);
      
      const products = await storage.getProducts();
      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      
      const getThumbUrl = (url: string) => url.replace(/\.webp(\?|$)/i, '_thumb.webp$1');
      
      const needsThumb = (p: any) => {
        const hasWebp = p.imageUrl && p.imageUrl.includes('.webp');
        if (!hasWebp) return false;
        if (force) return true;
        const needsMain = !p.thumbnailUrl || p.thumbnailUrl === p.imageUrl || !p.thumbnailUrl.includes('_thumb');
        if (needsMain) return true;
        const webpImages = (p.images || []).filter((img: string) => img?.includes('.webp'));
        for (const img of webpImages) {
          const expectedThumb = getThumbUrl(img);
          if (!p.imageThumbnails || !p.imageThumbnails.includes(expectedThumb)) return true;
        }
        return false;
      };
      
      const toProcess = products.filter(needsThumb).slice(offset, offset + limit);
      const totalNeedingUpdate = products.filter(needsThumb).length;
      
      console.log(`[Thumbnails] ${totalNeedingUpdate} products need thumbnails, processing ${toProcess.length} from offset ${offset}`);
      
      let generated = 0;
      let failed = 0;
      let thumbsCreated = 0;
      
      const generateThumb = async (url: string, width: number = 800): Promise<{ thumbKey: string; thumbUrl: string } | null> => {
        const urlMatch = url.match(/\/bmg\/(.+?)(\?|$)/);
        if (!urlMatch) return null;
        const sourceKey = urlMatch[1];
        const thumbKey = sourceKey.replace(/\.webp$/i, '_thumb.webp');
        const imageBuffer = await downloadBinaryFromYandexStorage(sourceKey);
        if (!imageBuffer) return null;
        const thumbBuffer = await sharp(imageBuffer)
          .resize(width, null, { withoutEnlargement: true })
          .webp({ quality: 100 })
          .toBuffer();
        const thumbFilename = thumbKey.replace('products/', '');
        await uploadToYandexStorage(thumbBuffer, thumbFilename, 'image/webp');
        const thumbUrl = `https://storage.yandexcloud.net/${bucketName}/${thumbKey}`;
        return { thumbKey, thumbUrl };
      };
      
      for (const product of toProcess) {
        try {
          const updateData: any = {};
          
          const needsMain = force || !product.thumbnailUrl || product.thumbnailUrl === product.imageUrl || !product.thumbnailUrl.includes('_thumb');
          if (needsMain) {
            const result = await generateThumb(product.imageUrl);
            if (result) {
              updateData.thumbnailUrl = result.thumbUrl;
              thumbsCreated++;
              console.log(`[Thumbnails] Main OK: ${product.name?.slice(0, 40)}`);
            }
          }
          
          const allImages: string[] = product.images || [];
          const webpImages = allImages.filter((img: string) => img?.includes('.webp'));
          
          if (webpImages.length > 0) {
            const existingThumbs: string[] = product.imageThumbnails || [];
            const newThumbs: string[] = [...existingThumbs];
            
            for (let i = 0; i < webpImages.length; i++) {
              const img = webpImages[i];
              const expectedThumb = getThumbUrl(img);
              const alreadyExists = newThumbs.some(t => t === expectedThumb);
              
              if (force || !alreadyExists) {
                const result = await generateThumb(img);
                if (result) {
                  if (!newThumbs.includes(result.thumbUrl)) {
                    newThumbs.push(result.thumbUrl);
                  }
                  thumbsCreated++;
                  
                  if (i === 1) {
                    updateData.hoverThumbnailUrl = result.thumbUrl;
                  }
                  
                  console.log(`[Thumbnails] Image ${i + 1}/${webpImages.length} OK: ${product.name?.slice(0, 30)}`);
                }
              }
            }
            
            if (newThumbs.length > existingThumbs.length || force) {
              updateData.imageThumbnails = newThumbs;
            }
          }
          
          if (Object.keys(updateData).length > 0) {
            await storage.updateProduct(product.id, updateData);
            generated++;
          }
          
        } catch (err: any) {
          console.error(`[Thumbnails] Failed for ${product.name}: ${err.message}`);
          failed++;
        }
      }
      
      const remaining = Math.max(0, totalNeedingUpdate - offset - limit);
      if (generated > 0) storage.clearCache();
      
      console.log(`[Thumbnails] Batch done: ${generated} products updated, ${thumbsCreated} thumbnails created, ${failed} failed, ~${remaining} remaining`);
      res.json({
        success: true,
        message: `Regenerated thumbnails for ${generated} products (${thumbsCreated} thumbnails created)`,
        details: { generated, thumbsCreated, failed, remaining, nextOffset: offset + limit, hint: remaining > 0 ? `Run again with offset=${offset + limit}` : "All done!" }
      });
      
    } catch (error) {
      console.error("[Thumbnails] Error:", error);
      res.status(500).json({ error: "Update failed", details: String(error) });
    }
  });

  // Fix thumbnailUrl: replace .jpg with .webp for all products
  app.post("/api/fix-thumbnail-urls", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Fix Thumbnails] Starting to fix .jpg thumbnailUrls -> .webp...");
      
      const products = await storage.getProducts();
      let updated = 0;
      let skipped = 0;
      
      for (const product of products) {
        // Check if thumbnailUrl contains .jpg or .jpeg
        if (product.thumbnailUrl && /\.(jpg|jpeg)(\?|$)/i.test(product.thumbnailUrl)) {
          // Replace .jpg/.jpeg with .webp
          const newThumbnailUrl = product.thumbnailUrl.replace(/\.(jpg|jpeg)/i, '.webp');
          
          await storage.updateProduct(product.id, { 
            thumbnailUrl: newThumbnailUrl 
          } as any);
          
          console.log(`[Fix Thumbnails] Fixed: ${product.name?.slice(0, 40)} | ${product.thumbnailUrl?.slice(-50)} -> .webp`);
          updated++;
          
          // Throttle to prevent YDB overload
          if (updated % 10 === 0) {
            await new Promise(r => setTimeout(r, 100));
          }
        } else {
          skipped++;
        }
      }
      
      console.log(`[Fix Thumbnails] Complete: ${updated} fixed, ${skipped} skipped`);
      storage.clearCache();
      
      res.json({
        success: true,
        message: `Fixed ${updated} thumbnail URLs (.jpg -> .webp)`,
        details: { updated, skipped, total: products.length }
      });
      
    } catch (error) {
      console.error("[Fix Thumbnails] Error:", error);
      res.status(500).json({ error: "Fix failed", details: String(error) });
    }
  });

  // Backfill product categories based on SKU and name (protected)
  app.post("/api/backfill-categories", async (req, res) => {
    const expectedKey = getAdminKey();
    
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      console.log(`[Categories] Auth failed`);

      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Categories] Starting category backfill...");
      
      const products = await storage.getProducts();
      let updated = 0;
      const categoryStats: Record<string, number> = {};
      const unrecognized: Array<{id: number, name: string, sku: string}> = [];
      
      for (const product of products) {
        const sku = product.sku || "";
        const name = product.name || "";
        
        const { category, subcategory } = mapProductCategory(sku, name);
        const onSale = isOnSale(name, product.price);
        
        // SKIP products already in SALE category (manually assigned, preserve them)
        if (product.category === "sale") {
          categoryStats["sale/Распродажа"] = (categoryStats["sale/Распродажа"] || 0) + 1;
          continue;
        }
        
        // Only update if category changed or onSale status
        if (product.category !== category || product.subcategory !== subcategory || product.onSale !== onSale) {
          const oldCat = `${product.category}/${product.subcategory || "none"}`;
          const newCat = `${category}/${subcategory || "none"}`;
          console.log(`[Categories] UPDATING ${product.id} (${product.sku}): ${oldCat} -> ${newCat}`);
          
          await storage.updateProduct(product.id, { 
            category,
            subcategory,
            onSale
          } as any);
          await throttle(); // Prevent YDB overload
          
          updated++;
        }
        
        // Stats
        const key = `${category}/${subcategory || "none"}`;
        categoryStats[key] = (categoryStats[key] || 0) + 1;
        
        // Track unrecognized products (in 1C Import category)
        if (category === "1C Import") {
          unrecognized.push({ id: product.id, name: product.name, sku: product.sku || "" });
        }
      }
      
      console.log(`[Categories] Complete: ${updated} products updated`);
      storage.clearCache();
      
      // Clear TanStack Query cache on frontend might be needed, but server-side cache is handled
      console.log("[Cache] Cleared all cached data via storage.clearCache()");
      
      res.json({
        success: true,
        message: `Updated ${updated} product categories`,
        details: { updated, total: products.length, stats: categoryStats, unrecognized }
      });
      
    } catch (error) {
      console.error("[Categories] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Backfill images - initialize images array from imageUrl for existing products
  app.post("/api/backfill-images", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Images] Starting images backfill...");
      
      const products = await storage.getProducts();
      let updated = 0;
      
      for (const product of products) {
        // If images is empty or undefined, initialize from imageUrl
        const currentImages = (product as any).images as string[] | null;
        if (!currentImages || currentImages.length === 0) {
          if (product.imageUrl) {
            await storage.updateProduct(product.id, { 
              images: [product.imageUrl]
            } as any);
            await throttle(); // Prevent YDB overload
            updated++;
            console.log(`[Images] Initialized images for product ${product.id}: [${product.imageUrl}]`);
          }
        }
      }
      
      storage.clearCache();
      console.log(`[Images] Complete: ${updated} products updated`);
      
      res.json({
        success: true,
        message: `Initialized images array for ${updated} products`,
        details: { updated, total: products.length }
      });
      
    } catch (error) {
      console.error("[Images] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Move specific products to SALE category (one-time migration)
  app.post("/api/move-to-sale", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      console.log("[SALE] Starting move to SALE category...");
      
      // Keywords from 1C SALE group (from screenshots)
      const saleKeywords = [
        "бини_детская", "бини детская",
        "электроника",
        "тетрис",
        "тамагочи",
        "кассета",
        "денди",
        "маска мэнгу", "ts01 маска",
        "кибер самурай", "(самурай)",
        "футболка.*душнила",
        "девочка с зонтом",
        "cyber hare",
        "facepalm",
        "rayden",
        "fleece 1/4 zip", "fleece.*zip",
        "killer cat",
        "90-е",
        "l/01",
        "free 01", "free.01", "free 01",
        "3-х(б/н) bmg", "3-х.*б/н.*bmg",
        "zip-худи", "zip худи",
        "(logo)", "\"logo\"",
        "\"bmg\" 01", "bmg\" 01",
        "тула белая", "тула.*2-х",
        "футболка.*демон"
      ];
      
      const products = await storage.getProducts();
      console.log(`[SALE] Total products to check: ${products.length}`);
      let updated = 0;
      const movedProducts: string[] = [];
      
      for (const product of products) {
        const nameLower = (product.name || "").toLowerCase();
        
        // Debug: log products with sale-related keywords
        if (nameLower.includes("бини") || nameLower.includes("электроник") || nameLower.includes("тетрис")) {
          console.log(`[SALE] Checking: ${product.name} | category: ${product.category}`);
        }
        
        // Check if product matches any SALE keyword
        let matchesSale = false;
        for (const keyword of saleKeywords) {
          if (keyword.includes(".*")) {
            // Regex pattern
            const regex = new RegExp(keyword, "i");
            if (regex.test(nameLower)) {
              matchesSale = true;
              break;
            }
          } else if (nameLower.includes(keyword.toLowerCase())) {
            matchesSale = true;
            break;
          }
        }
        
        if (matchesSale && product.category !== "sale") {
          console.log(`[SALE] Moving to SALE: ${product.name}`);
          await storage.updateProduct(product.id, {
            category: "sale",
            subcategory: "Распродажа",
            onSale: true
          });
          movedProducts.push(product.name);
          updated++;
          await throttle();
        }
      }
      
      console.log(`[SALE] Moved ${updated} products to SALE category`);
      res.json({ 
        success: true, 
        message: `Moved ${updated} products to SALE`,
        products: movedProducts
      });
    } catch (error) {
      console.error("[SALE] Error:", error);
      res.status(500).json({ error: "Failed to move products to SALE" });
    }
  });

  // Backfill colors from product names
  app.post("/api/backfill-colors", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Colors] Starting color backfill...");
      
      const { extractColorFromName } = await import("./categoryMapper");
      const products = await storage.getProducts();
      let updated = 0;
      const colorStats: Record<string, number> = {};
      
      for (const product of products) {
        const extractedColor = extractColorFromName(product.name);
        const currentColor = (product as any).color;
        
        if (extractedColor && currentColor !== extractedColor) {
          await storage.updateProduct(product.id, { color: extractedColor, skipCacheClear: true } as any);
          await throttleBulk(); // Use shorter delay for bulk operations
          updated++;
          colorStats[extractedColor] = (colorStats[extractedColor] || 0) + 1;
          console.log(`[Colors] ${product.id}: "${currentColor || 'null'}" -> "${extractedColor}"`);
        }
      }
      
      storage.clearCache(); // Clear cache once at the end
      console.log(`[Colors] Complete: ${updated} products updated`);
      
      res.json({
        success: true,
        message: `Updated colors for ${updated} products`,
        details: { updated, total: products.length, colorStats }
      });
      
    } catch (error) {
      console.error("[Colors] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Backfill sizes from product names
  app.post("/api/backfill-sizes", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Sizes] Starting sizes backfill...");
      
      const { extractSizesFromName } = await import("./categoryMapper");
      const products = await storage.getProducts();
      let updated = 0;
      const sizeStats: Record<string, number> = {};
      
      for (const product of products) {
        const extractedSizes = extractSizesFromName(product.name);
        const currentSizes = product.sizes || [];
        
        // Update if we found sizes and they're different from current
        if (extractedSizes.length > 0 && JSON.stringify(extractedSizes.sort()) !== JSON.stringify(currentSizes.sort())) {
          await storage.updateProduct(product.id, { sizes: extractedSizes, skipCacheClear: true } as any);
          await throttleBulk(); // Use shorter delay for bulk operations
          updated++;
          for (const size of extractedSizes) {
            sizeStats[size] = (sizeStats[size] || 0) + 1;
          }
          console.log(`[Sizes] ${product.id} "${product.name}": [${currentSizes.join(', ')}] -> [${extractedSizes.join(', ')}]`);
        }
      }
      
      storage.clearCache(); // Clear cache once at the end
      console.log(`[Sizes] Complete: ${updated} products updated`);
      
      res.json({
        success: true,
        message: `Updated sizes for ${updated} products`,
        details: { updated, total: products.length, sizeStats }
      });
      
    } catch (error) {
      console.error("[Sizes] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Sync in_stock field with isHidden for existing products
  app.post("/api/backfill-stock", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Backfill Stock] Starting in_stock sync...");
      const products = await storage.getProducts();
      let updated = 0;
      
      for (const product of products) {
        // If product is hidden, set in_stock to false
        // This syncs in_stock with isHidden for older products
        const shouldBeOutOfStock = (product as any).isHidden === true;
        const currentInStock = (product as any).inStock;
        
        // Only update if they're out of sync
        if (shouldBeOutOfStock && currentInStock !== false) {
          await storage.updateProduct(product.id, { inStock: false } as any);
          updated++;
          console.log(`[Backfill Stock] Set in_stock=false for "${product.name}"`);
          await new Promise(r => setTimeout(r, 150)); // Throttle
        }
      }
      
      // Clear cache after bulk update
      storage.clearCache();
      
      console.log(`[Backfill Stock] Updated ${updated} products`);
      res.json({
        success: true,
        message: `Synced in_stock for ${updated} products`,
        details: { updated, total: products.length }
      });
      
    } catch (error) {
      console.error("[Backfill Stock] Error:", error);
      res.status(500).json({ error: "Backfill failed", details: String(error) });
    }
  });

  // Update sizes from offers.xml (for clothing items with S, M, L, XL sizes)
  app.post("/api/update-sizes-from-offers", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[UpdateSizes] Starting sizes update from offers.xml...");
      
      // Download offers.xml from storage
      const offersXml = await downloadFromYandexStorage("products/offers.xml");
      if (!offersXml) {
        return res.status(404).json({ error: "offers.xml not found in storage" });
      }
      
      console.log("[UpdateSizes] Downloaded offers.xml, parsing...");
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });
      const offersData = parser.parse(offersXml);
      
      // Navigate to offers array
      const packages = offersData["КоммерческаяИнформация"]?.["ПакетПредложений"];
      const packagesArray = Array.isArray(packages) ? packages : (packages ? [packages] : []);
      
      let totalOffers = 0;
      const allProductSizes = new Map<string, Set<string>>();
      
      for (const pkg of packagesArray) {
        const offers = pkg["Предложения"]?.["Предложение"];
        if (!offers) continue;
        
        const offersArray = Array.isArray(offers) ? offers : [offers];
        totalOffers += offersArray.length;
        
        for (const offer of offersArray) {
          const offerId = offer["Ид"];
          if (!offerId) continue;
          
          const baseId = getBaseProductId(offerId);
          const size = extractSizeFromOffer(offer);
          
          if (baseId && size) {
            if (!allProductSizes.has(baseId)) {
              allProductSizes.set(baseId, new Set());
            }
            allProductSizes.get(baseId)!.add(size);
          }
        }
      }
      
      console.log(`[UpdateSizes] Found ${totalOffers} offers, ${allProductSizes.size} products with sizes`);
      
      // Update products in database
      let updated = 0;
      const sizeStats: Record<string, number> = {};
      
      for (const [baseId, sizesSet] of allProductSizes) {
        const product = await storage.getProductByExternalId(baseId);
        if (product) {
          const sizes = sortSizes(Array.from(sizesSet));
          if (sizes.length > 0) {
            const currentSizes = product.sizes || [];
            if (JSON.stringify(sizes) !== JSON.stringify(currentSizes)) {
              console.log(`[UpdateSizes] ${product.name}: [${currentSizes.join(', ')}] -> [${sizes.join(', ')}]`);
              await storage.updateProduct(product.id, { sizes, skipCacheClear: true } as any);
              await throttleBulk(); // Use shorter delay for bulk operations
              updated++;
              for (const size of sizes) {
                sizeStats[size] = (sizeStats[size] || 0) + 1;
              }
            }
          }
        }
      }
      
      storage.clearCache();
      console.log(`[UpdateSizes] Complete: ${updated} products updated`);
      
      res.json({
        success: true,
        message: `Updated sizes for ${updated} products from offers.xml`,
        details: { 
          updated, 
          totalOffers,
          productsWithSizes: allProductSizes.size,
          sizeStats 
        }
      });
      
    } catch (error) {
      console.error("[UpdateSizes] Error:", error);
      res.status(500).json({ error: "Update sizes failed", details: String(error) });
    }
  });

  // Update stock from offers.xml (manual sync)
  app.post("/api/update-stock-from-offers", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[UpdateStock] Starting stock update from offers.xml...");
      
      const offersXml = await downloadFromYandexStorage("products/offers.xml");
      if (!offersXml) {
        return res.status(404).json({ error: "offers.xml not found in storage" });
      }
      
      console.log("[UpdateStock] Downloaded offers.xml, parsing...");
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });
      const offersData = parser.parse(offersXml);
      
      const packages = offersData["КоммерческаяИнформация"]?.["ПакетПредложений"];
      const packagesArray = Array.isArray(packages) ? packages : (packages ? [packages] : []);
      
      let totalOffers = 0;
      let updated = 0;
      
      for (const pkg of packagesArray) {
        const offers = pkg["Предложения"]?.["Предложение"];
        if (!offers) continue;
        
        const offersArray = Array.isArray(offers) ? offers : [offers];
        totalOffers += offersArray.length;
        
        const priceTypesMap = buildPriceTypesMap(offersData);
        const productPrices = collectPricesFromOffers(offersArray, priceTypesMap);
        
        console.log(`[UpdateStock] Processing ${productPrices.size} products...`);
        
        updated = await updateProductPricesFromOffers(productPrices);
      }
      
      storage.clearCache();
      
      console.log(`[UpdateStock] Updated stock for ${updated} products`);
      
      res.json({
        success: true,
        message: `Updated stock for ${updated} products from offers.xml`,
        details: { updated, totalOffers }
      });
      
    } catch (error) {
      console.error("[UpdateStock] Error:", error);
      res.status(500).json({ error: "Update stock failed", details: String(error) });
    }
  });

  // Delete all products from database (admin only)
  app.delete("/api/products/all", async (req, res) => {
    const expectedKey = getAdminKey();
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log("[Admin] Deleting all products from database...");
      
      const products = await storage.getProducts();
      let deleted = 0;
      
      for (const product of products) {
        await storage.deleteProduct(product.id);
        await throttle(); // Prevent YDB overload
        deleted++;
      }
      
      storage.clearCache();
      console.log(`[Admin] Deleted ${deleted} products`);
      
      res.json({
        success: true,
        message: `Deleted ${deleted} products from database`,
        deleted
      });
      
    } catch (error) {
      console.error("[Admin] Error deleting products:", error);
      res.status(500).json({ error: "Delete failed", details: String(error) });
    }
  });

  // Get categories list for navigation (dynamic from DB, fallback to hardcoded)
  app.get("/api/categories", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    try {
      const dynamicConfig = await storage.getPageSettings("site_config");
      if (dynamicConfig?.categories_data) {
        const cats = typeof dynamicConfig.categories_data === 'string' 
          ? JSON.parse(dynamicConfig.categories_data) 
          : dynamicConfig.categories_data;
        if (cats && Object.keys(cats).length > 0) {
          return res.json(normalizeCategories(cats));
        }
      }
    } catch (e) {
      // fallback to hardcoded
    }
    res.json(CATEGORIES);
  });

  // Admin: Save categories config
  app.post("/api/admin/categories", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { categories } = req.body;
      if (!categories || typeof categories !== 'object') {
        return res.status(400).json({ error: "Invalid categories data" });
      }
      const slugRegex = /^[a-z0-9_-]+$/;
      const slugsSeen = new Set<string>();
      for (const [slug, cat] of Object.entries(categories)) {
        const c = cat as any;
        if (!slug || !slugRegex.test(slug)) {
          return res.status(400).json({ error: `Invalid slug: "${slug}". Use lowercase Latin letters, numbers, hyphens, and underscores.` });
        }
        if (slugsSeen.has(slug)) {
          return res.status(400).json({ error: `Duplicate slug: "${slug}"` });
        }
        slugsSeen.add(slug);
        if (!c.name || typeof c.name !== 'string' || c.name.trim().length === 0) {
          return res.status(400).json({ error: `Category "${slug}" must have a non-empty name` });
        }
        if (!Array.isArray(c.subcategories)) {
          return res.status(400).json({ error: `Category "${slug}" subcategories must be an array` });
        }
        const normalizedSubs: SubcategoryConfig[] = [];
        const subSlugsSeen = new Set<string>();
        for (const s of c.subcategories) {
          let subName: string;
          let subSlug: string;
          if (typeof s === 'string') {
            subName = s.trim();
            subSlug = transliterateToSlug(subName);
          } else if (s && typeof s === 'object' && s.name) {
            subName = s.name.trim();
            subSlug = (s.slug && slugRegex.test(s.slug)) ? s.slug : transliterateToSlug(subName);
          } else {
            continue;
          }
          if (!subName) continue;
          if (subSlugsSeen.has(subSlug)) {
            let counter = 2;
            while (subSlugsSeen.has(`${subSlug}-${counter}`)) counter++;
            subSlug = `${subSlug}-${counter}`;
          }
          subSlugsSeen.add(subSlug);
          normalizedSubs.push({ name: subName, slug: subSlug });
        }
        (categories as any)[slug] = { name: c.name.trim(), slug, subcategories: normalizedSubs };
      }
      if (Object.keys(categories).length === 0) {
        return res.status(400).json({ error: "At least one category is required" });
      }
      await storage.setPageSectionSettings("site_config", "categories_data", categories);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get categories config (returns current dynamic or hardcoded + product counts)
  app.get("/api/admin/categories", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      let cats: any = CATEGORIES;
      let source = "default";
      const dynamicConfig = await storage.getPageSettings("site_config");
      if (dynamicConfig?.categories_data) {
        const parsed = typeof dynamicConfig.categories_data === 'string'
          ? JSON.parse(dynamicConfig.categories_data)
          : dynamicConfig.categories_data;
        if (parsed && Object.keys(parsed).length > 0) {
          cats = normalizeCategories(parsed);
          source = "dynamic";
        }
      }
      const products = await storage.getProducts();
      const productCounts: Record<string, number> = {};
      for (const p of products) {
        if (p.category) {
          productCounts[p.category] = (productCounts[p.category] || 0) + 1;
        }
      }
      res.json({ categories: cats, source, productCounts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // CRITICAL: Need separate express.raw() for POST handler to ensure body is parsed correctly
  // The app.all() middleware parses body but Express may not preserve it across next() calls in all cases
  app.post("/api/1c-exchange", express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    if (!is1CSyncEnabled) {
      console.log(`[1C] Sync disabled — rejecting POST request`);
      return res.status(403).send("failure\n1C sync is disabled");
    }
    
    const { type, mode, filename } = req.query;
    const bodySize = Buffer.isBuffer(req.body) ? req.body.length : 0;
    console.log(`[1C EXCHANGE] POST Type: ${type}, Mode: ${mode}, Filename: ${filename}, BodySize: ${bodySize} bytes`);
    
    console.log(`[1C DEBUG] POST request for mode: ${mode}`);

    // Handle file uploads for both catalog and sale types
    if ((type === "catalog" || type === "sale") && mode === "file") {
      const filenameStr = filename as string;
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filenameStr);
      console.log(`[1C FILE] Processing file: ${filenameStr}, isImage: ${isImage}, hasBody: ${!!req.body}, bodyLength: ${req.body?.length || 0}`);
      
      // Upload images to Object Storage with retry mechanism
      if (isImage && process.env.YANDEX_STORAGE_BUCKET_NAME) {
        console.log(`[1C IMAGE] *** RECEIVED: ${filenameStr}, bodySize: ${req.body?.length || 0} ***`);
        
        const imageBuffer = req.body;
        if (!imageBuffer || imageBuffer.length === 0) {
          console.error(`[1C IMAGE] ERROR: Empty body for ${filenameStr}`);
          return res.send("failure\nEmpty file body");
        }
        
        const ext = filenameStr.toLowerCase().split('.').pop() || 'jpg';
        const contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        const finalFilename = filenameStr.replace(/[\/\\]/g, '_');
        
        // Retry mechanism for S3 upload
        const MAX_RETRIES = 3;
        let lastError: any = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            console.log(`[1C IMAGE] Upload attempt ${attempt}/${MAX_RETRIES}: ${finalFilename}, size: ${imageBuffer.length}`);
            const s3Url = await uploadToYandexStorage(imageBuffer, finalFilename, contentType);
            
            if (s3Url) {
              existingFilesCache.add(`products/${finalFilename}`);
              console.log(`[1C IMAGE] *** SUCCESS (attempt ${attempt}): ${filenameStr} -> ${s3Url} ***`);
              return res.send("success");
            } else {
              lastError = "uploadToYandexStorage returned null";
              console.error(`[1C IMAGE] Attempt ${attempt} failed: returned null`);
            }
          } catch (err: any) {
            lastError = err.message || err;
            console.error(`[1C IMAGE] Attempt ${attempt} exception: ${lastError}`);
          }
          
          // Wait before retry (exponential backoff)
          if (attempt < MAX_RETRIES) {
            const delay = 1000 * attempt;
            console.log(`[1C IMAGE] Waiting ${delay}ms before retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
        
        // All retries failed
        console.error(`[1C IMAGE] *** FAILED after ${MAX_RETRIES} attempts: ${filenameStr}, error: ${lastError} ***`);
        return res.send("failure\nUpload failed after retries: " + lastError);
      }
      
      // For XML files, save to Object Storage AND locally for parsing
      const isXml = /\.(xml)$/i.test(filenameStr);
      
      console.log(`\n========== XML FILE RECEIVED ==========`);
      console.log(`[1C XML] File: ${filenameStr}, isXml: ${isXml}, size: ${req.body?.length || 0}`);
      console.log(`========================================\n`);
      
      // Upload XML to S3 so it persists across serverless container instances
      if (isXml && process.env.YANDEX_STORAGE_BUCKET_NAME) {
        try {
          const xmlBuffer = req.body;
          if (!xmlBuffer || xmlBuffer.length === 0) {
            console.error(`[1C XML] ERROR: Empty body for XML ${filenameStr}`);
            return res.send("failure\nEmpty file body");
          }
          
          // Save as products/import.xml or products/offers.xml (keep original name, no flattening)
          // Important: don't flatten slashes for XML - they need to match download path exactly
          const s3Filename = filenameStr;
          console.log(`[1C XML] *** UPLOADING TO S3: ${s3Filename}, size: ${xmlBuffer.length} ***`);
          const s3Url = await uploadToYandexStorage(xmlBuffer, s3Filename, 'application/xml');
          if (s3Url) {
            console.log(`[1C XML] *** SUCCESS: ${filenameStr} -> ${s3Url} ***`);
          } else {
            console.error(`[1C XML] ERROR: uploadToYandexStorage returned null for XML ${filenameStr}`);
          }
        } catch (err: any) {
          console.error(`[1C XML] UPLOAD ERROR for ${filenameStr}:`, err.message || err);
        }
      } else {
        console.log(`[1C XML] Skipping S3 upload: isXml=${isXml}, bucket=${!!process.env.YANDEX_STORAGE_BUCKET_NAME}`);
      }
      
      // Also save locally for immediate parsing (in case same container processes import)
      const uploadPath = path.resolve(process.cwd(), "1c_uploads", filenameStr);
      const dir = path.dirname(uploadPath);
      
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(uploadPath, req.body);
        console.log(`[1C] Saved file locally: ${filenameStr}`);
        return res.send("success");
      } catch (err) {
        console.error(`[1C] Failed to save file ${filenameStr}:`, err);
        return res.send("failure\nError saving file");
      }
    }
    
    // Handle import for both catalog and sale types
    if ((type === "catalog" || type === "sale") && mode === "import") {
      const xmlData = req.body.toString();
      
      // Save XML to Object Storage for debugging
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filenameStr = typeof filename === 'string' ? filename : `import_${timestamp}.xml`;
        const s3Key = `xml_logs/${filenameStr.replace(/\//g, '_')}`;
        await uploadToYandexStorage(Buffer.from(xmlData), s3Key, 'application/xml');
        console.log(`[1C] Saved XML to Object Storage: ${s3Key}`);
      } catch (xmlSaveErr) {
        console.error(`[1C] Failed to save XML to storage:`, xmlSaveErr);
      }
      
      // Load existing files from Object Storage before parsing XML
      await loadExistingFilesFromStorage(true);
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        // Always treat Картинка as array even if there's only one
        isArray: (name: string) => {
          return name === "Картинка" || name === "Товар" || name === "Предложение" || 
                 name === "ЗначениеРеквизита" || name === "ЗначенияСвойства" || name === "ХарактеристикаТовара";
        }
      });
      
      try {
        const result = parser.parse(xmlData);
        console.log(`[1C] Parsing XML for mode=import, filename: ${filename}`);
        
        // Basic CommerceML parsing logic
        const catalog = result?.["КоммерческаяИнформация"]?.["Классификатор"] || result?.["КоммерческаяИнформация"]?.["ПакетПредложений"];
        
        // Handle Products
        if (result?.["КоммерческаяИнформация"]?.["Каталог"]?.["Товары"]?.["Товар"]) {
          const items = result["КоммерческаяИнформация"]["Каталог"]["Товары"]["Товар"];
          const productsArray = Array.isArray(items) ? items : [items];
          
          let productsCreated = 0;
          let productsUpdated = 0;
          let productsFailed = 0;
          
          const allCachedProducts = await storage.getProducts();
          const cachedByExtId = new Map<string, any>();
          const cachedBySku = new Map<string, any>();
          for (const p of allCachedProducts) {
            if ((p as any).externalId) cachedByExtId.set((p as any).externalId, p);
            if ((p as any).sku) cachedBySku.set((p as any).sku, p);
          }
          
          for (const item of productsArray) {
            try {
              const externalId = item["Ид"];
              const name = item["Наименование"];
              const description = item["Описание"] || "";
              const sku = item["Артикул"] || "";
              
              if (!externalId || !name) {
                console.warn(`[1C] Skipping product without externalId or name`);
                productsFailed++;
                continue;
              }
              
              // Extract sizes and colors from properties if available
              let sizes: string[] = [];
              let colors: string[] = [];
              if (item["ЗначенияРеквизитов"]?.["ЗначениеРеквизита"]) {
                 const props = Array.isArray(item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]) 
                   ? item["ЗначенияРеквизитов"]["ЗначениеРеквизита"] 
                   : [item["ЗначенияРеквизитов"]["ЗначениеРеквизита"]];
                 for (const prop of props) {
                   if (prop["Наименование"] === "Размер") sizes.push(prop["Значение"]);
                   if (prop["Наименование"] === "Цвет") colors.push(prop["Значение"]);
                 }
              }

              // Image parsing - use Object Storage URL, parse ALL images
              // With isArray option, imgData should always be an array now
              const imgData = item["Картинка"];
              let allImages: string[] = [];
              const fallbackUrl = "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png";
              
              // DETAILED LOGGING FOR IMAGE DEBUGGING
              const imgDataCount = Array.isArray(imgData) ? imgData.length : (imgData ? 1 : 0);
              console.log(`[1C IMG DEBUG] Product: ${name?.slice(0,40)}, imgData count: ${imgDataCount}, type: ${typeof imgData}, isArray: ${Array.isArray(imgData)}`);
              
              const extractPath = (img: any): string | null => {
                if (typeof img === 'string' && img.trim()) return img.trim();
                if (img && typeof img === 'object' && img["#text"]) return img["#text"];
                return null;
              };
              
              // imgData is now always an array due to isArray option
              if (Array.isArray(imgData)) {
                for (let i = 0; i < imgData.length; i++) {
                  const img = imgData[i];
                  const path = extractPath(img);
                  console.log(`[1C IMG DEBUG]   [${i}] raw: ${JSON.stringify(img)?.slice(0,100)}, path: ${path?.slice(0,60)}`);
                  if (path) {
                    const url = getImageUrl(path, existingFilesCache);
                    console.log(`[1C IMG DEBUG]   [${i}] url: ${url?.slice(0,80)}, isFallback: ${url === fallbackUrl}`);
                    if (url && url !== fallbackUrl) allImages.push(url);
                  }
                }
              } else if (imgData) {
                // Fallback for single value (shouldn't happen with isArray)
                const path = extractPath(imgData);
                console.log(`[1C IMG DEBUG]   single raw: ${JSON.stringify(imgData)?.slice(0,100)}, path: ${path?.slice(0,60)}`);
                if (path) {
                  const url = getImageUrl(path, existingFilesCache);
                  console.log(`[1C IMG DEBUG]   single url: ${url?.slice(0,80)}, isFallback: ${url === fallbackUrl}`);
                  if (url && url !== fallbackUrl) allImages.push(url);
                }
              }
              
              console.log(`[1C IMG DEBUG] Result: ${allImages.length} valid images for ${name?.slice(0,30)}`);
              
              // Log if no images found
              if (allImages.length === 0) {
                console.warn(`[1C] WARNING: No images found for product ${name} (${sku}), imgData type: ${typeof imgData}, isArray: ${Array.isArray(imgData)}`);
              }
              
              const imageUrl = allImages.length > 0 ? allImages[0] : fallbackUrl;
              const thumbnailUrl = getThumbnailUrl(imageUrl);
              const images = allImages.length > 0 ? allImages : [fallbackUrl];
              const { category, subcategory } = mapProductCategory(sku, name);
              const onSale = isOnSale(name, 0);
              
              console.log(`[1C] Processing: ${name} (SKU: ${sku}, extId: ${externalId}, images: ${images.length})`);
              
              const existing = cachedByExtId.get(externalId);
              const hasRealNewImages = allImages.length > 0 && !allImages.every(img => img.includes(fallbackUrl));
              
              if (!existing) {
                const existingBySku = sku ? cachedBySku.get(sku) : null;
                if (existingBySku) {
                  // Build update object - omit image fields if no real new images
                  const updateData: any = { externalId, name, description, category, subcategory, onSale, sizes, colors };
                  if (hasRealNewImages) {
                    updateData.imageUrl = imageUrl;
                    updateData.thumbnailUrl = thumbnailUrl;
                    updateData.images = images;
                  }
                  
                  console.log(`[1C] SKU ${sku} already exists for product ${existingBySku.id}, updating by SKU instead. hasRealNewImages: ${hasRealNewImages}`);
                  await storage.updateProduct(existingBySku.id, updateData);
                  productsUpdated++;
                  await throttle(); // Prevent YDB overload
                } else {
                  console.log(`[1C] Creating new product: ${name} (${externalId})`);
                  await storage.createProduct({
                    externalId,
                    sku,
                    name,
                    description,
                    price: 0,
                    imageUrl,
                    thumbnailUrl,
                    images,
                    category,
                    subcategory,
                    onSale,
                    sizes,
                    colors,
                    color: extractColorFromName(name) || 'Default',
                    isNew: true,
                    badgeText: "NEW"
                  } as any);
                  productsCreated++;
                  await throttle(); // Prevent YDB overload
                }
              } else {
                // IMPORTANT: Only update images if we have REAL new images (not fallback)
                const hasRealNewImages = allImages.length > 0 && !allImages.every(img => img.includes(fallbackUrl));
                
                // Build update object - omit image fields if no real new images
                const updateData: any = { name, description, sku, category, subcategory, onSale, sizes, colors, skipCacheClear: true };
                if (hasRealNewImages) {
                  updateData.imageUrl = imageUrl;
                  updateData.thumbnailUrl = thumbnailUrl;
                  updateData.images = images;
                }
                
                console.log(`[1C] Updating existing product: ${name} (${externalId}), hasRealNewImages: ${hasRealNewImages}, updateImages: ${hasRealNewImages}`);
                await storage.updateProduct(existing.id, updateData);
                productsUpdated++;
                await throttleBulk(); // Use shorter delay for bulk operations
              }
            } catch (itemErr: any) {
              console.error(`[1C] Failed to process product:`, itemErr.message || itemErr);
              productsFailed++;
            }
          }
          
          console.log(`[1C] Products import: ${productsCreated} created, ${productsUpdated} updated, ${productsFailed} failed`);
        }

        // Handle Offers (Prices + Sizes)
        if (result?.["КоммерческаяИнформация"]?.["ПакетПредложений"]?.["Предложения"]?.["Предложение"]) {
          const offers = result["КоммерческаяИнформация"]["ПакетПредложений"]["Предложения"]["Предложение"];
          const offersArray = Array.isArray(offers) ? offers : [offers];
          
          // Build price types map from XML header
          const priceTypesMap = buildPriceTypesMap(result);
          console.log(`[1C] Price types found: ${Array.from(priceTypesMap.values()).join(', ') || 'none'}`);
          
          // Collect sizes and prices from offers (deduplicated by baseId)
          const productSizes = await processOffersSizes(offersArray);
          const productPrices = collectPricesFromOffers(offersArray, priceTypesMap);
          
          // Update prices (one update per product instead of per offer)
          await updateProductPricesFromOffers(productPrices);
          
          // Update sizes for products
          const sizesUpdated = await updateProductSizesFromOffers(productSizes);
          console.log(`[1C] Sizes updated for ${sizesUpdated} products`);
        }
        
        console.log("[1C] Import successful");
        storage.clearCache(); // Clear cache once at the end
        return res.send("success");
      } catch (err) {
        console.error("[1C] Import failed:", err);
        return res.send("failure\nError parsing XML");
      }
    }
    
    res.send("success");
  });

  // Serve 1C images
  app.get("/api/1c-images/*", (req, res) => {
    const filePath = (req.params as any)[0] || "";
    const fullPath = path.resolve(process.cwd(), "1c_uploads", filePath);
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).send("Image not found");
    }
  });

  // Serve attached assets
  app.use("/attached_assets", express.static(path.resolve(process.cwd(), "attached_assets")));


    // Products with pagination support + Cache-Control
    app.get(api.products.list.path, async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const requestedLimit = parseInt(req.query.limit as string) || 24;
      const maxLimit = req.query.admin === "true" ? 5000 : 1000;
      const limit = Math.min(maxLimit, Math.max(1, requestedLimit));
      const category = req.query.category as string | undefined;
      const subcategory = req.query.subcategory as string | undefined;
      const onSale = req.query.sale === "true";
      const search = req.query.search as string | undefined;
      const minPrice = req.query.minPrice ? parseInt(req.query.minPrice as string) : undefined;
      const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice as string) : undefined;
      const sizeFilter = req.query.size as string | undefined;
      const sortBy = req.query.sort as string | undefined;
      
      const allProducts = await storage.getProducts();
      const apiKey = req.headers["x-api-key"] as string;
      const isAdminRequest = req.query.admin === "true" && checkAdminKey(apiKey);
      
      let filtered = allProducts.filter(p => {
        if (!p.price || p.price <= 0) return false;
        if (!isAdminRequest && (p as any).isHidden) return false;
        const isPreorderProduct = (p as any).preorderEnabled === true;
        const hasOverride = (p as any).autoHideOverride === true;
        const stockQty = typeof (p as any).stock === 'number' ? (p as any).stock : 0;
        if (!isAdminRequest && (p as any).inStock === false && stockQty <= 0 && !isPreorderProduct && !hasOverride) return false;
        if (!isAdminRequest) {
          const url = p.imageUrl || (p.images && p.images[0]) || "";
          // Same logic as /api/products/no-image endpoint
          const hasNoRealImage = !url || 
            url === "" || 
            url === "/placeholder.svg" ||
            url.startsWith("/attached_assets/") ||
            url.startsWith("/1c_uploads/") ||
            (!url.startsWith("https://storage.yandexcloud.net/") && !url.startsWith("http"));
          if (hasNoRealImage) return false;
        }
        return true;
      });
      
      // Search filter (priority - works across all products)
      if (search && search.trim().length >= 2) {
        const searchTerms = search.toLowerCase().trim().split(/\s+/);
        filtered = filtered.filter(p => {
          const searchableText = [
            p.name,
            p.description,
            p.sku,
            p.category,
            p.subcategory,
            p.color
          ].filter(Boolean).join(' ').toLowerCase();
          
          return searchTerms.every(term => searchableText.includes(term));
        });
      } else if (onSale) {
        filtered = filtered.filter(p => p.onSale === true);
      } else if (category) {
        const catLower = category.toLowerCase();
        filtered = filtered.filter(p => {
          if (p.category?.toLowerCase() === catLower) return true;
          const addCats: Array<{category: string, subcategory: string}> = (p as any).additionalCategories || [];
          return addCats.some(ac => ac.category?.toLowerCase() === catLower);
        });
        if (subcategory) {
          const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
          const decodedSub = normalize(decodeURIComponent(subcategory));
          const rawSub = normalize(subcategory);
          
          console.log(`[API] Filtering by subcategory: "${subcategory}" (decoded: "${decodedSub}", raw: "${rawSub}")`);
          
          filtered = filtered.filter(p => {
            if (p.category?.toLowerCase() === catLower && p.subcategory) {
              const pSub = normalize(p.subcategory);
              if (pSub === decodedSub || pSub === rawSub) return true;
            }
            const addCats: Array<{category: string, subcategory: string}> = (p as any).additionalCategories || [];
            return addCats.some(ac => {
              if (ac.category?.toLowerCase() !== catLower) return false;
              const ns = normalize(ac.subcategory || '');
              return ns === decodedSub || ns === rawSub;
            });
          });
        }
      }
      
      // Price range filter
      if (minPrice !== undefined && !isNaN(minPrice)) {
        filtered = filtered.filter(p => p.price && p.price >= minPrice);
      }
      if (maxPrice !== undefined && !isNaN(maxPrice)) {
        filtered = filtered.filter(p => p.price && p.price <= maxPrice);
      }
      
      // Size filter
      if (sizeFilter) {
        const sizes = sizeFilter.split(",").map(s => s.trim().toLowerCase());
        filtered = filtered.filter(p => {
          if (!p.sizes || p.sizes.length === 0) return false;
          return p.sizes.some(ps => sizes.includes(ps.toLowerCase()));
        });
      }
      
      // Sorting (default: newest first by id)
      switch (sortBy) {
        case "price_asc":
          filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
          break;
        case "price_desc":
          filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
          break;
        case "name_asc":
          filtered.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
          break;
        case "name_desc":
          filtered.sort((a, b) => (b.name || "").localeCompare(a.name || "", "ru"));
          break;
        default:
          filtered.sort((a, b) => (b.id || 0) - (a.id || 0));
          break;
      }

      const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const products = filtered.slice(offset, offset + limit);
    
    res.set('Cache-Control', 'no-cache, no-store');
    
    res.json({
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages
      }
    });
  });

  app.get("/api/products/by-artist/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json([]);
      const products = await storage.getArtistProductsBySlug(slug);
      res.set("Cache-Control", "public, max-age=60");
      res.json(products);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/artists/:slug/promo — public: promo code for artist page display
  app.get("/api/artists/:slug/promo", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ promoCode: null });
      const partner = await storage.getPartnerBySlug(slug);
      if (!partner || !partner.isArtist) return res.json({ promoCode: null });
      const promo = await storage.getPartnerPromoCode(partner.id);
      if (!promo || !promo.isActive) return res.json({ promoCode: null });
      res.set("Cache-Control", "public, max-age=120");
      res.json({ promoCode: { code: promo.code, discountPercent: promo.discountPercent } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/artists/:slug/likes — public: get like count
  app.get("/api/artists/:slug/likes", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ likes: 0 });
      const key = `artist_likes_${slug}`;
      const raw = await storage.getBonusSetting(key);
      const likes = raw ? parseInt(raw, 10) : 0;
      res.set("Cache-Control", "public, max-age=10");
      res.json({ likes: isNaN(likes) ? 0 : likes });
    } catch {
      res.json({ likes: 0 });
    }
  });

  // POST /api/artists/:slug/like — public: increment like count
  app.post("/api/artists/:slug/like", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ likes: 0 });
      const key = `artist_likes_${slug}`;
      const raw = await storage.getBonusSetting(key);
      const current = raw ? parseInt(raw, 10) : 0;
      const newCount = (isNaN(current) ? 0 : current) + 1;
      await storage.setBonusSetting(key, String(newCount));
      res.json({ likes: newCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/artists/:slug/view — public: increment page view counter (fire-and-forget)
  app.post("/api/artists/:slug/view", async (req, res) => {
    try {
      const { slug } = req.params;
      if (slug) {
        const key = `artist_page_views_${slug}`;
        const raw = await storage.getBonusSetting(key);
        const current = raw ? parseInt(raw, 10) : 0;
        await storage.setBonusSetting(key, String((isNaN(current) ? 0 : current) + 1));
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  app.get("/api/products/by-ids", async (req, res) => {
    try {
      const idsParam = req.query.ids as string;
      if (!idsParam) {
        return res.json([]);
      }
      const ids = idsParam.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
      const results = [];
      for (const id of ids) {
        const p = await storage.getProduct(id);
        if (p) {
          results.push({
            id: p.id,
            name: p.name,
            price: p.price,
            wholesalePrice: p.wholesalePrice,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl,
            hoverThumbnailUrl: p.hoverThumbnailUrl,
            category: p.category,
            subcategory: p.subcategory,
            sizes: p.sizes,
            colors: p.colors,
            color: (p as any).color,
            isNew: p.isNew,
            badgeText: typeof (p as any).badgeText === 'string' ? (p as any).badgeText : null,
            stock: p.stock,
            images: p.images,
          });
        }
      }
      res.set('Cache-Control', 'no-cache, no-store');
      res.json(results);
    } catch (error) {
      console.error("[API] Error getting products by ids:", error);
      res.status(500).json({ message: "Failed to get products by ids" });
    }
  });

  app.get("/api/products/by-slug/:slug", async (req, res) => {
    const product = await storage.getProductBySlug(req.params.slug);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.set('Cache-Control', 'no-cache, no-store');
    res.json(product);
  });

  app.get(api.products.get.path, async (req, res) => {
    const product = await storage.getProduct(Number(req.params.id));
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.set('Cache-Control', 'no-cache, no-store');
    res.json(product);
  });

  // Extract base model name from product name (without color/size info)
  // E.g. "Куртка Cosmonaut Long 101 (Черный)" -> "cosmonaut long"
  // E.g. "Куртка Cosmonaut 102 (Шоколад)" -> "cosmonaut"
  function extractBaseModel(name: string): string {
    // Remove common prefixes
    let cleaned = name.toLowerCase()
      .replace(/куртка\s*/gi, '')
      .replace(/["«»"]/g, '')
      .replace(/puffer\/aw-\d+/gi, '')
      .replace(/\([^)]*\)\s*$/g, '') // Remove trailing parentheses (color)
      .replace(/\d{3,}\s*$/g, '') // Remove trailing 3+ digit numbers (model codes like 101, 102)
      .replace(/\s+/g, ' ')
      .trim();
    
    // Extract key model identifier (e.g., "cosmonaut long" or "cosmonaut")
    const modelMatch = cleaned.match(/([a-zа-яё\s]+)/i);
    return modelMatch ? modelMatch[1].trim() : cleaned;
  }

  // Known colors list for detecting if parentheses contain color (not model)
  const KNOWN_COLORS = new Set([
    'черный', 'черные', 'черная', 'чёрный', 'чёрная', 'чёрные',
    'белый', 'белые', 'белая', 'серый', 'серые', 'серая',
    'красный', 'красные', 'красная', 'синий', 'синие', 'синяя', 'голубой', 'голубые', 'голубая',
    'зеленый', 'зеленые', 'зеленая', 'зелёный', 'зелёная', 'зелёные',
    'желтый', 'желтые', 'желтая', 'жёлтый', 'жёлтая', 'жёлтые',
    'оранжевый', 'оранжевые', 'оранжевая',
    'фиолетовый', 'фиолетовые', 'фиолетовая', 'розовый', 'розовые', 'розовая',
    'коричневый', 'коричневые', 'коричневая',
    'тёмно-коричневый', 'тёмно-коричневая', 'тёмно-коричневые',
    'темно-коричневый', 'темно-коричневая', 'темно-коричневые',
    'бежевый', 'бежевые', 'бежевая',
    'хаки', 'бордовый', 'бордовые', 'бордовая', 'песочный', 'песочные', 'песочная',
    'сиреневый', 'сиреневые', 'сиреневая', 'мокко',
    'молочный', 'молочные', 'молочная',
    'кэмел', 'персик', 'персиковый', 'персиковая', 'шоколад', 'шоколадный', 'шоколадная',
    'графит', 'графитовый', 'графитовая',
    'оливковый', 'оливковые', 'оливковая', 'вери пери', 'т.синий', 'темно-синий', 'тёмно-синий',
    'горчичный', 'горчичные', 'горчичная', 'лайм', 'лаймовый', 'лаймовая',
    'айсберг', 'камо', 'бодовый',
    'т.серый', 'т.серая', 'т.серые'
  ]);
  
  function isKnownColor(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (KNOWN_COLORS.has(normalized)) return true;
    if (normalized.includes('/')) {
      const base = normalized.split('/')[0].trim();
      if (KNOWN_COLORS.has(base)) return true;
    }
    if (normalized.startsWith('тёмно-') || normalized.startsWith('темно-')) {
      return true;
    }
    return false;
  }

  // Extract model name from product name for variant matching
  // Supports multiple formats:
  // 1. "(Модель)" - parentheses (socks, sweatshirts)
  // 2. "«Модель»" - angle quotes (shorts)
  // 3. '"Модель"' - double quotes (pants, hoodies)
  // E.g. "Носки BOOOMERANGS (Туалетная Бумага N024) Белый" -> "туалетная бумага"
  // E.g. 'Брюки BMGBRAND "Sport" 101 (Черный)' -> "sport"
  // E.g. "Шорты BMGBRAND «ShortYou» SH024 (Голубой)" -> "shortyou"
  function extractModelName(name: string): string | null {
    // Strategy 1: Check quotes first "" and «» (jackets, pants, hoodies, shorts)
    // For products with MULTIPLE quoted parts, combine them all as model name
    // E.g. Куртка "puffer/AW-24" "Cosmonaut" 106 (Хаки) -> "puffer/aw-24 cosmonaut"
    const allDoubleQuotes: string[] = [];
    const dqRegex = /"([^"]+)"/g;
    let dqMatch;
    while ((dqMatch = dqRegex.exec(name)) !== null) {
      allDoubleQuotes.push(dqMatch[1]);
    }
    
    const allAngleQuotes: string[] = [];
    const aqRegex = /«([^»]+)»/g;
    let aqMatch;
    while ((aqMatch = aqRegex.exec(name)) !== null) {
      allAngleQuotes.push(aqMatch[1]);
    }
    
    const quotedParts = allDoubleQuotes.length > 0 ? allDoubleQuotes : allAngleQuotes;
    if (quotedParts.length > 0) {
      let model = quotedParts.map(p => p.toLowerCase().replace(/[&%]/g, '').trim()).join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (model && model.length >= 2) {
        // Include text modifiers from suffix after last quote (e.g. RFT, Softshel)
        // "Sport" 301 Softshel (Черный) -> suffix "301 Softshel" -> text mod "softshel"
        // "Sport" RFT 101 (Черный) -> suffix "RFT 101" -> text mod "rft"
        let lastQuoteEnd = -1;
        const dqr2 = /"([^"]+)"/g;
        let m2;
        while ((m2 = dqr2.exec(name)) !== null) lastQuoteEnd = m2.index + m2[0].length;
        const aqr2 = /«([^»]+)»/g;
        while ((m2 = aqr2.exec(name)) !== null) lastQuoteEnd = m2.index + m2[0].length;
        
        if (lastQuoteEnd > 0) {
          const rest = name.substring(lastQuoteEnd);
          const parenMatch = rest.match(/^([^(]*)\(/);
          const rawSuffix = (parenMatch ? parenMatch[1] : rest).replace(/["«»]/g, '').trim();
          if (rawSuffix) {
            const suffixWords = rawSuffix.split(/\s+/).filter(w => w.length > 0);
            const textMods = suffixWords.filter(w => !/\d/.test(w) && !isKnownColor(w));
            if (textMods.length > 0) {
              model = model + ' ' + textMods.join(' ').toLowerCase();
            }
          }
        }
        return model;
      }
    }
    
    // Strategy 2: Check underscore pattern (hats, bags)
    // Capture segments between BMGBRAND_ and color, keep only text segments (no digits)
    // E.g. "Шапка BMGBRAND_Бини_AW24 (Черный)" -> model "бини"
    // E.g. "Шапка BMGBRAND_Бини_Детская_B01-1 (Черный)" -> model "бини_детская"
    // E.g. "Шапка BMGBRAND_Классическая_CS01-1 (Черный)" -> model "классическая"
    const underscoreFullMatch = name.match(/BMGBRAND_(.+?)[\s(]/i);
    if (underscoreFullMatch) {
      const segments = underscoreFullMatch[1].split('_').filter(s => s.length > 0);
      const modelSegments = segments.filter(s => !/\d/.test(s));
      let model = modelSegments.join('_').toLowerCase().trim();
      if (model && model.length >= 2) {
        return model;
      }
    }
    
    // Strategy 3: Extract model from text before color parentheses (jacket pattern)
    // Only when the text contains Latin characters (SSH, SoftShell, VEL, Pilot, etc.)
    // E.g. "Куртка SoftShell SSH 2.0 (Черный) Б/П" -> "softshell ssh 2.0"
    // E.g. "Куртка BMGBRAND SSH 01 (черный)" -> "ssh 01"  
    // E.g. "Куртка Бомбер SoftShell SS/23 Pilot (Черный)" -> "бомбер softshell ss/23 pilot"
    // E.g. "Куртка Бомбер SS/25 Pilot Вельвет (Черный)" -> "бомбер ss/25 pilot вельвет"
    // Does NOT match: "Брюки BMGBRAND 90-е (Черные)" - no Latin model name after brand
    const firstParen = name.indexOf('(');
    if (firstParen > 0) {
      const beforeParen = name.substring(0, firstParen).trim();
      let modelPart = beforeParen
        .replace(/^(куртка|анорак|жилет|ветровка|футболка|свитшот|брюки|шорты|толстовка|носки|худи|лонгслив|поло|майка|рубашка|кепка|бейсболка|панама|свитер)\s+/i, '')
        .replace(/^(BMGBRAND|BOOOMERANGS|BMG)\s*/i, '')
        .replace(/(BMGBRAND|BOOOMERANGS|BMG)\s*/gi, '')
        .replace(/^(coach\s+jacket)\s*/i, '')
        .trim();
      
      if (modelPart && modelPart.length >= 3 && /[a-zA-Z]{2,}/.test(modelPart)) {
        let model = modelPart.toLowerCase()
          .replace(/[&%]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/([a-z])(\d)/gi, '$1 $2')
          .replace(/(\d)([a-z])/gi, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim();
        if (model && model.length >= 3) {
          const allParens = [...name.matchAll(/\(([^)]+)\)/g)];
          for (const pm of allParens) {
            const content = pm[1].trim();
            if (!isKnownColor(content) && content.length >= 2) {
              model = model + ' ' + content.toLowerCase();
            }
          }
          return model;
        }
      }
    }
    
    // Strategy 4a: Check nested parentheses first
    // E.g. "Футболка BMGBRAND (JDM (Subaru)) Oversize 2-х нитка Черный" -> "jdm (subaru)"
    // E.g. "Футболка BMGBRAND (JDM (Nissan 350Z )) Oversize 2-х нитка Черный" -> "jdm (nissan 350z)"
    // E.g. "Футболка BMGBRAND (JDM (GTR 33)) Oversize 2-х нитка Черный" -> "jdm (gtr 33)"
    const nestedParenMatch = name.match(/\(([^()]*\([^)]*\)[^)]*)\)/);
    if (nestedParenMatch) {
      const content = nestedParenMatch[1].trim();
      if (!isKnownColor(content)) {
        let model = content.toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (model && model.length >= 2) {
          return model;
        }
      }
    }
    
    // Strategy 4: Check parentheses (socks pattern)
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const content = parenMatch[1];
      
      if (isKnownColor(content)) {
        return null;
      }
      
      let model = content.toLowerCase()
        .replace(/[&%]/g, '')
        .replace(/№\s*(nk|gk|gr|n|g|r)?\s*0*\d+/gi, '')
        .replace(/\b(nk|gk|gr|n|g|r)\s*0*\d+\b/gi, '')
        .replace(/\bkids\s*\d*\b/gi, '')
        .replace(/v\.\d+/gi, '')
        .replace(/\b[a-z]\s+$/gi, '')
        .replace(/\bonesize\b/gi, '')
        .trim()
        .replace(/\s+/g, ' ');
      
      if (model && model.length >= 2) {
        // Check for print/design name AFTER closing parenthesis
        // E.g. "Футболка BMGBRAND (Oversize UR) Человечки Хаки" -> print = "Человечки"
        // The text after paren may have: <print_name> <color>
        // We need to include non-color words as part of the model
        const closingParenIdx = name.indexOf(')');
        if (closingParenIdx >= 0) {
          const afterParen = name.substring(closingParenIdx + 1).trim();
          if (afterParen) {
            // Remove stripe markers (Б/П, К/П, etc.) and parenthesized color groups like (черные) (Графит)
            const cleanAfter = afterParen
              .replace(/[БбКкЧчСсЗз]\/[ПпНн]/g, '')
              .replace(/\([^)]*\)/g, '')
              .trim();
            // Split into words, filter out known colors and size ranges to get print name
            const words = cleanAfter.split(/\s+/).filter(w => w.length > 0);
            const printWords = words.filter(w => {
              const stripped = w.replace(/[()]/g, '');
              if (isKnownColor(stripped)) return false;
              if (isKnownColor(w)) return false;
              if (/^\(?\d{2}[-\/]\d{2}\)?$/.test(w)) return false;
              if (/^\d+$/.test(w)) return false;
              if (/^[ОO]\/S$/i.test(w)) return false;
              return true;
            });
            if (printWords.length > 0) {
              const printName = printWords.join(' ').toLowerCase().trim();
              model = model + ' ' + printName;
            }
          }
        }
        return model;
      }
    }
    
    return null;
  }
  
  // Extract article/SKU pattern from name for matching variants
  // E.g. "Куртка BMGBRAND вельветовая VEL/01 (Песочный)" -> "VEL/01"
  // E.g. "Брюки BMGBRAND "Sport" 101 (Черный)" -> "101"
  // E.g. "Шорты BMGBRAND «ShortYou» SH024 (Голубой)" -> "SH024"
  // E.g. "Шапка BMGBRAND_Бини_AW24 (Черный)" -> "AW24"
  // E.g. "Шапка BMGBRAND_Классическая_CS01-1 (Черный)" -> "CS01" (base without color suffix)
  function extractArticleCode(name: string): string | null {
    // Check if product has multiple quoted parts (e.g. "puffer/AW-24" "Cosmonaut" 106)
    // In that case, the trailing number is a color code, not an article
    const dqCount = (name.match(/"[^"]+"/g) || []).length;
    const aqCount = (name.match(/«[^»]+»/g) || []).length;
    const hasMultipleQuotedParts = dqCount > 1 || aqCount > 1;
    
    // Pattern 1: Underscore format - extract from BRAND_Model_Article pattern
    // E.g. "Шапка BMGBRAND_Бини_AW24 (Черный)" -> "AW24"
    // E.g. "Шапка BMGBRAND_Классическая_CS01-1 (Черный)" -> "CS01" (strip -1, -2 suffix)
    const underscoreMatch = name.match(/BMGBRAND_[^_]+_([A-Z0-9][\w\-]*)/i);
    if (underscoreMatch) {
      let articlePart = underscoreMatch[1].split(/\s+/)[0];
      articlePart = articlePart.replace(/-\d+$/, '');
      return articlePart.toUpperCase();
    }
    
    // Pattern 2: VEL/01, SS/25 etc (with slash, OUTSIDE quotes only)
    // Skip if inside quotes to avoid matching "puffer/AW-24" as article
    const nameWithoutQuotes = name.replace(/"[^"]*"/g, '').replace(/«[^»]*»/g, '');
    const slashPattern = nameWithoutQuotes.match(/\b([A-Z]{2,}[\/]\d+)\b/i);
    if (slashPattern) return slashPattern[1].toUpperCase();
    
    // Pattern 3: N024, G024 etc after parentheses or standalone
    // E.g. "Панама BMGBRAND (Тактик) N024 Черная" -> "N024"
    const parenArticleMatch = name.match(/\)\s*([A-Z]\d{2,3})\b/i);
    if (parenArticleMatch) return parenArticleMatch[1].toUpperCase();
    
    // Pattern 4: SH024, BN201 etc (letters + numbers, at least 2 letters, OUTSIDE quotes)
    const letterNumPattern = nameWithoutQuotes.match(/\b([A-Z]{2,}\d{2,})\b/i);
    if (letterNumPattern) return letterNumPattern[1].toUpperCase();
    
    // Pattern 5: Standalone number after model name "Sport" 101 -> 101
    // Also handles "Sport" RFT 101 or "Sport" 301 Softshel
    // Skip for products with multiple quoted parts (number is color code, not article)
    if (!hasMultipleQuotedParts) {
      // First try: number right after quote
      const numPattern = name.match(/[»"]\s*(\d{2,3})\s*(?:\(|$)/);
      if (numPattern) return numPattern[1];
      // Second try: number after quote with text in between (e.g. "Sport" RFT 101 (...))
      const numAfterTextPattern = name.match(/[»"]\s+[A-Za-z]+\s+(\d{2,3})\b/);
      if (numAfterTextPattern) return numAfterTextPattern[1];
      // Third try: number right after quote, followed by text then parenthesis
      const numBeforeTextPattern = name.match(/[»"]\s*(\d{2,3})\s+\S+\s*\(/);
      if (numBeforeTextPattern) return numBeforeTextPattern[1];
    }
    
    return null;
  }
  
  // Extract brand and category for additional matching
  // E.g. "Носки BOOOMERANGS (Осень)" -> "носки booomerangs"
  // E.g. "Куртка BMGBRAND вельветовая VEL/01" -> "куртка bmgbrand"
  function extractBrandPrefix(name: string): string {
    // For underscore pattern (BMGBRAND_Model_Article), stop at first underscore after BMGBRAND
    const underscoreMatch = name.match(/^([^_]+_?BMGBRAND)/i);
    if (underscoreMatch) {
      // Return category + BMGBRAND only (e.g. "шапка bmgbrand")
      const prefix = underscoreMatch[0].replace(/_/g, ' ').toLowerCase().trim();
      const words = prefix.split(/\s+/);
      return words.slice(0, 2).join(' ').trim();
    }
    
    // Get text before any quotes, parentheses
    const match = name.match(/^([^("«(]+)/);
    if (!match) return '';
    // Keep only first 2-3 words (category + brand)
    const words = match[1].toLowerCase().replace(/[&%]/g, '').trim().split(/\s+/);
    return words.slice(0, 2).join(' ').trim();
  }

  // Parse SKU to extract style group and number
  // Style groups:
  // - classic: N, №, G (classic 40-45 = N/№, classic 34-39 = G)
  // - sport: R, GR (sport 40-45 = R, sport 34-39 = GR)
  // - short: NK, GK (short 40-45 = NK, short 34-39 = GK)
  // - kids: Kids
  // N138 and G138 are variants (same design, different sizes)
  // N138 and R138 are NOT variants (different styles)
  function parseSkuForVariants(sku: string): { styleGroup: string; number: string } | null {
    // Normalize: lowercase, remove spaces
    let s = sku.toLowerCase().replace(/\s+/g, '').trim();
    // Handle "№G003" format - remove № if followed by letter (it's just a prefix marker)
    s = s.replace(/№([a-z])/i, '$1');
    // Replace remaining № with n (for cases like "№003" = "n003")
    s = s.replace(/№/g, 'n');
    
    // Order matters - check longer prefixes first!
    // Short: NK, GK
    let match = s.match(/^(nk|gk)0*(\d+)$/i);
    if (match) {
      return { styleGroup: 'short', number: match[2] };
    }
    
    // Sport: GR, R (check GR before single letters)
    match = s.match(/^(gr)0*(\d+)$/i);
    if (match) {
      return { styleGroup: 'sport', number: match[2] };
    }
    match = s.match(/^(r)0*(\d+)$/i);
    if (match) {
      return { styleGroup: 'sport', number: match[2] };
    }
    
    // Classic: N, G (check after GR/GK to avoid conflicts)
    match = s.match(/^(n|g)0*(\d+)$/i);
    if (match) {
      return { styleGroup: 'classic', number: match[2] };
    }
    
    // Kids
    match = s.match(/^kids\s*0*(\d+)$/i);
    if (match) {
      return { styleGroup: 'kids', number: match[1] };
    }
    
    // SC and other special prefixes - each is its own group
    match = s.match(/^([a-z]+)0*(\d+)$/i);
    if (match) {
      return { styleGroup: match[1], number: match[2] };
    }
    
    return null;
  }
  
  // Extract SKU from product name (in parentheses) as fallback
  // E.g. "Носки BOOOMERANGS (Туалетная Бумага N024) Белый" -> "N024"
  // E.g. "Носки BOOOMERANGS (Курлык №003) Белый (40-45)" -> "N003"
  // E.g. "Носки BOOOMERANGS (Курлык №G003) Белый (34-39)" -> "G003"
  function extractSkuFromName(name: string): string | null {
    const match = name.match(/\(([^)]+)\)/);
    if (!match) return null;
    
    const content = match[1];
    
    // Look for SKU pattern in parentheses
    // Patterns: N024, G138, R024, GR024, NK17, GK17, №0138, №G003
    // Use non-word boundary pattern that works with cyrillic
    
    // First try: "№G003" or "№ G003" format (№ followed by optional space, letter then digits)
    const numSignLetterMatch = content.match(/№\s*(nk|gk|gr|n|g|r)\s*0*(\d+)/i);
    if (numSignLetterMatch) {
      return numSignLetterMatch[1].toUpperCase() + numSignLetterMatch[2];
    }
    
    // Pattern: "№ 070" or "№070" (№ followed by optional space then digits, no letter prefix)
    const numSignOnlyMatch = content.match(/№\s*0*(\d+)/i);
    if (numSignOnlyMatch) {
      return 'N' + numSignOnlyMatch[1];
    }
    
    // Pattern: letter prefix(es) followed by optional spaces and digits
    const skuMatch = content.match(/(?:^|\s)(nk|gk|gr|n|g|r)\s*0*(\d+)(?:\s|$|\))/i);
    if (skuMatch) {
      return skuMatch[1].toUpperCase() + skuMatch[2];
    }
    
    // Also try at end of content (like "Курлык №003" or "Курлык № 003")
    const endMatch = content.match(/(nk|gk|gr|n|g|r|№)\s*0*(\d+)\s*$/i);
    if (endMatch) {
      return endMatch[1].toUpperCase().replace('№', 'N') + endMatch[2];
    }
    
    return null;
  }

  // Get color variants for a product
  // Variants = same style group + same number (e.g. N138 and G138 are variants - classic style, number 138)
  app.get("/api/products/:id/variants", async (req, res) => {
    try {
      const product = await storage.getProduct(Number(req.params.id));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Extract model name and brand for matching
      const productModelName = extractModelName(product.name);
      const productBrandPrefix = extractBrandPrefix(product.name);
      
      // Try to get SKU from product field first, then from name as fallback
      const skuFromField = product.sku ? parseSkuForVariants(product.sku) : null;
      const skuFromName = extractSkuFromName(product.name);
      const skuFromNameParsed = skuFromName ? parseSkuForVariants(skuFromName) : null;
      
      // Prefer SKU from name if available (more reliable than field which may have errors)
      const productSkuParsed = skuFromNameParsed || skuFromField;
      // Debug logging (can be enabled for troubleshooting)
      // console.log(`[Variants] Product: "${product.name}" -> model: "${productModelName}", brand: "${productBrandPrefix}", skuParsed: ${JSON.stringify(productSkuParsed)}`);
      
      // Get all products
      const allProducts = await storage.getProducts();
      
      let variants: typeof product[] = [];
      const variantIds = new Set<number>();
      
      // Extract article code from name (for shorts, jackets, pants - not socks)
      const productArticle = extractArticleCode(product.name);
      
      // Check if model was extracted from quotes (not socks format)
      const hasQuotedModel = product.name.match(/["«]/) !== null;
      
      // Check if model was extracted from underscore pattern (hats, bags)
      // E.g. "Шапка BMGBRAND_Бини_AW24 (Черный)"
      const hasUnderscoreModel = product.name.match(/BMGBRAND_[^_]+_/i) !== null;
      
      // For products with quoted model AND article in name - use article-based matching first
      // This handles shorts like «ShortYou» SH024, pants like "Sport" 101
      if ((hasQuotedModel || hasUnderscoreModel) && productArticle && productModelName) {
        const articleVariants = allProducts.filter(p => {
          const pBrandPrefix = extractBrandPrefix(p.name);
          if (pBrandPrefix !== productBrandPrefix) return false;
          
          const pModelName = extractModelName(p.name);
          if (!pModelName || pModelName !== productModelName) return false;
          
          const pArticle = extractArticleCode(p.name);
          return pArticle === productArticle;
        });
        console.log(`[Variants] Found ${articleVariants.length} variants by quoted model "${productModelName}" + article "${productArticle}"`);
        articleVariants.forEach(v => {
          if (!variantIds.has(v.id)) {
            variants.push(v);
            variantIds.add(v.id);
          }
        });
      }
      
      // Find variants by: same style group + same number + same model name (SOCKS pattern)
      // Example: "Туалетная Бумага N024" and "Туалетная Бумага G024" are variants
      // But "Туалетная Бумага N024" and "LOVE G024" are NOT variants (different model names)
      // Only use this for socks-style SKU patterns (not for quoted model or underscore products)
      if (variants.length <= 1 && productSkuParsed && productModelName && !hasQuotedModel && !hasUnderscoreModel) {
        const skuVariants = allProducts.filter(p => {
          // Check model name first (must match)
          const pModelName = extractModelName(p.name);
          if (!pModelName || pModelName !== productModelName) return false;
          
          // Check brand
          const pBrandPrefix = extractBrandPrefix(p.name);
          if (pBrandPrefix !== productBrandPrefix) return false;
          
          // Check SKU style group and number
          const pSkuFromName = extractSkuFromName(p.name);
          const pSkuParsed = pSkuFromName ? parseSkuForVariants(pSkuFromName) : (p.sku ? parseSkuForVariants(p.sku) : null);
          if (!pSkuParsed) return false;
          
          // Must match style group AND number
          return pSkuParsed.styleGroup === productSkuParsed.styleGroup && 
                 pSkuParsed.number === productSkuParsed.number;
        });
        console.log(`[Variants] Found ${skuVariants.length} variants by socks model "${productModelName}" + style "${productSkuParsed.styleGroup}" + number "${productSkuParsed.number}"`);
        skuVariants.forEach(v => {
          if (!variantIds.has(v.id)) {
            variants.push(v);
            variantIds.add(v.id);
          }
        });
      }
      
      // Fallback 1: Model + Article combined (for pants/hoodies with "Sport" 101)
      // This is more specific - requires BOTH model AND article to match
      if (variants.length <= 1 && productModelName && productArticle) {
        const combinedVariants = allProducts.filter(p => {
          const pBrandPrefix = extractBrandPrefix(p.name);
          if (pBrandPrefix !== productBrandPrefix) return false;
          
          const pModelName = extractModelName(p.name);
          const pArticle = extractArticleCode(p.name);
          
          // Must match model AND article
          return pModelName === productModelName && pArticle === productArticle;
        });
        console.log(`[Variants] Fallback 1: Found ${combinedVariants.length} variants by model "${productModelName}" + article "${productArticle}"`);
        combinedVariants.forEach(v => {
          if (!variantIds.has(v.id)) {
            variants.push(v);
            variantIds.add(v.id);
          }
        });
      }
      
      // Fallback 2: Article code only (for jackets without model in quotes)
      // E.g. "Куртка BMGBRAND вельветовая VEL/01 (Песочный)" matches "VEL/01 (Хаки)"
      if (variants.length <= 1 && productArticle && !productModelName) {
        const articleVariants = allProducts.filter(p => {
          const pBrandPrefix = extractBrandPrefix(p.name);
          if (pBrandPrefix !== productBrandPrefix) return false;
          
          const pArticle = extractArticleCode(p.name);
          return pArticle === productArticle;
        });
        console.log(`[Variants] Fallback 2: Found ${articleVariants.length} variants by article "${productArticle}"`);
        articleVariants.forEach(v => {
          if (!variantIds.has(v.id)) {
            variants.push(v);
            variantIds.add(v.id);
          }
        });
      }
      
      // Fallback 3: Model name only (for products without article codes AND without SKU - sweatshirts, etc)
      if (variants.length <= 1 && productModelName && productModelName.length >= 2 && !productArticle && !productSkuParsed) {
        const nameVariants = allProducts.filter(p => {
          const pModelName = extractModelName(p.name);
          const pBrandPrefix = extractBrandPrefix(p.name);
          
          if (!pModelName) return false;
          if (pBrandPrefix !== productBrandPrefix) return false;
          
          return pModelName === productModelName;
        });
        console.log(`[Variants] Fallback 3: Found ${nameVariants.length} variants by model name "${productModelName}"`);
        nameVariants.forEach(v => {
          if (!variantIds.has(v.id)) {
            variants.push(v);
            variantIds.add(v.id);
          }
        });
      }
      
      // Fallback 4: Base name matching (for products that differ only by color in parentheses)
      // E.g. "Мантия BMGBRAND 3-х нитка (Черная)" and "Мантия BMGBRAND 3-х нитка (Графит)"
      // Strip the color parenthesis and compare base names
      if (variants.length <= 1 && !productModelName && !productArticle && !productSkuParsed) {
        const productColorMatch = product.name.match(/\(([^)]+)\)/);
        if (productColorMatch && isKnownColor(productColorMatch[1])) {
          const productBaseName = product.name.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
          
          if (productBaseName.length >= 5) {
            const baseNameVariants = allProducts.filter(p => {
              if (p.id === product.id) return false;
              const pColorMatch = p.name.match(/\(([^)]+)\)/);
              if (!pColorMatch || !isKnownColor(pColorMatch[1])) return false;
              const pBaseName = p.name.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
              return pBaseName === productBaseName;
            });
            console.log(`[Variants] Fallback 4: Found ${baseNameVariants.length} variants by base name "${productBaseName}"`);
            baseNameVariants.forEach(v => {
              if (!variantIds.has(v.id)) {
                variants.push(v);
                variantIds.add(v.id);
              }
            });
          }
        }
      }
      
      // Fallback 5: Smart base name matching (for products with color outside parentheses)
      // E.g. "Худи BMGBRAND (oneSize) Молочный" and "Худи BMGBRAND (oneSize) Розовый"
      // Keeps non-color parenthetical content, strips color parens and trailing color words
      if (variants.length <= 1 && !productModelName && !productArticle && !productSkuParsed) {
        function stripColorsFromName(n: string): string {
          let result = n;
          const allParens = [...result.matchAll(/\(([^)]+)\)/g)];
          for (const m of allParens) {
            if (isKnownColor(m[1])) {
              result = result.replace(m[0], ' ');
            }
          }
          const words = result.trim().split(/\s+/);
          while (words.length > 0 && isKnownColor(words[words.length - 1])) {
            words.pop();
          }
          return words.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        }
        
        const productStripped = stripColorsFromName(product.name);
        if (productStripped.length >= 10) {
          const strippedVariants = allProducts.filter(p => {
            if (p.id === product.id) return false;
            const pStripped = stripColorsFromName(p.name);
            return pStripped === productStripped;
          });
          console.log(`[Variants] Fallback 5: Found ${strippedVariants.length} variants by stripped name "${productStripped}"`);
          strippedVariants.forEach(v => {
            if (!variantIds.has(v.id)) {
              variants.push(v);
              variantIds.add(v.id);
            }
          });
        }
      }
      
      // Ensure current product is included
      if (!variants.some(v => v.id === product.id)) {
        variants = [product, ...variants];
      }
      
      // Extract size range from product name (40-45, 34-39, etc.)
      function extractSizeRange(name: string): string | null {
        const match = name.match(/\b(40[-\/]45|34[-\/]39|29[-\/]33)\b/i);
        return match ? match[1].replace('/', '-') : null;
      }
      
      // Filter out variants that shouldn't be displayed:
      // - hidden products
      // - no price or zero price
      // - no real product image (must be from cloud storage, not a local placeholder)
      // Note: we keep sold-out variants (stock=0) so users can see all available colors/sizes
      variants = variants.filter(v => {
        if ((v as any).isHidden) return false;
        if (!v.price || v.price <= 0) return false;
        if (!v.imageUrl || !v.imageUrl.startsWith('http')) return false;
        return true;
      });
      
      // Return simplified variant info for color picker with size grouping
      // Re-extract color from name for accurate color display
      const colorVariants = variants.map(v => {
        const extractedColor = extractColorFromName(v.name);
        return {
          id: v.id,
          slug: v.slug || '',
          color: extractedColor || (v as any).color || v.colors?.[0] || 'Default',
          name: v.name,
          imageUrl: v.imageUrl,
          thumbnailUrl: v.thumbnailUrl,
          price: v.price,
          stock: v.stock || 0,
          sizeRange: extractSizeRange(v.name)
        };
      });
      
      // Deduplicate by (color + sizeRange) — keep the one with highest stock
      const seenColorSize = new Map<string, typeof colorVariants[0]>();
      for (const cv of colorVariants) {
        const key = `${cv.color.toLowerCase()}|${cv.sizeRange || ''}`;
        const existing = seenColorSize.get(key);
        if (!existing || cv.stock > existing.stock) {
          seenColorSize.set(key, cv);
        }
      }
      const dedupedVariants = [...seenColorSize.values()];

      res.set('Cache-Control', 'public, max-age=60');
      res.json(dedupedVariants);
    } catch (error) {
      console.error("[API] Error getting color variants:", error);
      res.status(500).json({ message: "Failed to get variants" });
    }
  });

  app.get("/api/products/:id/look", async (req, res) => {
    try {
      const product = await storage.getProduct(Number(req.params.id));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      const lookIds = (product as any).lookProducts || [];
      const lookCategory = (product as any).lookCategory || null;
      const lookSubcategory = (product as any).lookSubcategory || null;
      
      const lookProducts = [];
      const addedIds = new Set<number>([product.id]);
      
      for (const pid of lookIds) {
        const p = await storage.getProduct(pid);
        if (p && !p.isHidden && !addedIds.has(p.id)) {
          addedIds.add(p.id);
          lookProducts.push({
            id: p.id,
            name: p.name,
            price: p.price,
            wholesalePrice: p.wholesalePrice,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl,
            hoverThumbnailUrl: p.hoverThumbnailUrl,
            category: p.category,
            subcategory: p.subcategory,
            sizes: p.sizes,
            colors: p.colors,
            color: (p as any).color,
            isNew: p.isNew,
            badgeText: typeof (p as any).badgeText === 'string' ? (p as any).badgeText : null,
            stock: p.stock,
            images: p.images,
          });
        }
      }
      
      let categoryProducts: any[] = [];
      if (lookCategory) {
        const allProducts = await storage.getProducts();
        console.log(`[Look] Product ${product.id}: lookCategory=${lookCategory}, lookSubcategory=${lookSubcategory}`);
        const matchingAll = allProducts.filter((p: any) => p.category === lookCategory && !p.isHidden && !addedIds.has(p.id) && p.stock > 0);
        console.log(`[Look] Products in category "${lookCategory}": ${matchingAll.length}`);
        if (lookSubcategory) {
          const matchingSub = matchingAll.filter((p: any) => p.subcategory === lookSubcategory);
          console.log(`[Look] Products with subcategory "${lookSubcategory}": ${matchingSub.length}`);
          if (matchingSub.length > 0) {
            console.log(`[Look] Sample subcategories: ${matchingAll.slice(0, 5).map((p: any) => `"${p.subcategory}"`).join(', ')}`);
          } else {
            console.log(`[Look] Available subcategories in category: ${[...new Set(matchingAll.map((p: any) => p.subcategory))].join(', ')}`);
          }
        }
        const catProds = allProducts
          .filter((p: any) => {
            if (p.category !== lookCategory) return false;
            if (p.isHidden || addedIds.has(p.id) || p.stock <= 0) return false;
            if (lookSubcategory && p.subcategory !== lookSubcategory) return false;
            return true;
          })
          .slice(0, 4);
        for (const p of catProds) {
          categoryProducts.push({
            id: p.id,
            name: p.name,
            price: p.price,
            wholesalePrice: p.wholesalePrice,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl,
            hoverThumbnailUrl: p.hoverThumbnailUrl,
            category: p.category,
            subcategory: p.subcategory,
            sizes: p.sizes,
            colors: p.colors,
            color: (p as any).color,
            isNew: p.isNew,
            badgeText: typeof (p as any).badgeText === 'string' ? (p as any).badgeText : null,
            stock: p.stock,
            images: p.images,
          });
        }
      }
      
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        products: lookProducts,
        categoryProducts,
        lookCategory,
        lookSubcategory,
      });
    } catch (error) {
      console.error("[API] Error getting look products:", error);
      res.status(500).json({ message: "Failed to get look products" });
    }
  });

  // 1C Sync API
  app.post("/api/sync/products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const items = z.array(z.object({
        externalId: z.string(),
        sku: z.string().optional(),
        name: z.string(),
        description: z.string(),
        price: z.number(),
        imageUrl: z.string(),
        category: z.string(),
        sizes: z.array(z.string()),
        colors: z.array(z.string()),
        isNew: z.boolean().optional()
      })).parse(req.body);

      const results = [];
      for (const item of items) {
        const existing = await storage.getProductByExternalId(item.externalId);
        if (existing) {
          const updated = await storage.updateProduct(existing.id, item);
          results.push({ id: updated.id, status: "updated" });
        } else {
          const created = await storage.createProduct(item as any);
          results.push({ id: created.id, status: "created" });
        }
      }

      res.json({ success: true, results });
    } catch (err) {
      res.status(400).json({ message: "Invalid data format" });
    }
  });

  app.get("/api/sync/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orders = await storage.getOrdersByStatus("pending");
    res.json(orders);
  });

  app.patch("/api/sync/orders/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const { status } = z.object({ status: z.string() }).parse(req.body);
      const orderId = Number(req.params.id);
      const order = await storage.updateOrderStatus(orderId, status);

      storage.getOrderBitrixDealId(orderId).then(dealId => {
        if (!dealId) return;
        syncOrderStatusToBitrix(orderId, status, dealId).catch(err =>
          console.error(`[Order Status] Bitrix sync failed for order ${orderId}:`, err?.message || err)
        );
      }).catch(err =>
        console.error(`[Order Status] getOrderBitrixDealId failed for order ${orderId}:`, err?.message || err)
      );

      // Partner commission status sync: delivered → confirmed; cancelled/refunded → cancelled
      // After cancellation, monthly progressive scale is recalculated downward for ref-partners.
      if (status === "delivered" || status === "cancelled" || status === "refunded") {
        storage.getCommissionByOrderId(orderId).then(async (commission) => {
          if (!commission) return;
          if (status === "delivered" && commission.status === "pending") {
            await storage.updateCommissionStatus(commission.id, "confirmed");
            console.log(`[Partner] Commission ${commission.id} confirmed (order ${orderId} delivered)`);
          } else if ((status === "cancelled" || status === "refunded") && commission.status !== "cancelled" && commission.status !== "paid") {
            await storage.updateCommissionStatus(commission.id, "cancelled");
            console.log(`[Partner] Commission ${commission.id} cancelled (order ${orderId} ${status})`);

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
                console.log(`[Partner] Monthly recalc after cancel: partner=${commission.partnerId} remainingTotal=${monthlyTotal/100}₽ newPercent=${newPercent}%`);
              }
            } catch (recalcErr: any) {
              console.error('[Partner] Monthly recalc failed after cancel:', recalcErr?.message);
            }
          }
        }).catch(err => console.error(`[Partner] Commission sync failed for order ${orderId}:`, err.message));
      }

      if (status === "paid") {
        createCdekWaybillForOrder(orderId).catch(err => 
          console.error(`[Sync] CDEK waybill error for order ${orderId}:`, err.message)
        );
        createYandexDeliveryForOrder(orderId).catch(err =>
          console.error(`[Sync] YD waybill error for order ${orderId}:`, err.message)
        );
      }

      res.json(order);
    } catch (err) {
      res.status(400).json({ message: "Invalid data" });
    }
  });

  // 1C Inventory Sync API (Update stock only)
  app.post("/api/sync/inventory", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.SYNC_API_KEY || "bmg-secret-key-123";

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const updates = z.array(z.object({
        externalId: z.string(),
        price: z.number().optional(),
        sizes: z.array(z.string()).optional()
      })).parse(req.body);

      const results = [];
      for (const update of updates) {
        const existing = await storage.getProductByExternalId(update.externalId);
        if (existing) {
          const updated = await storage.updateProduct(existing.id, update);
          results.push({ id: updated.id, status: "updated" });
        } else {
          results.push({ externalId: update.externalId, status: "not_found" });
        }
      }

      res.json({ success: true, results });
    } catch (err) {
      res.status(400).json({ message: "Invalid data format" });
    }
  });

  app.post(api.products.create.path, async (req, res) => {
    try {
      const input = api.products.create.input.parse(req.body);
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Cart
  app.get(api.cart.list.path, async (req, res) => {
    const items = await storage.getCartItems(req.params.sessionId);
    res.json(items);
  });

  app.post(api.cart.addItem.path, async (req, res) => {
    try {
      const input = api.cart.addItem.input.parse(req.body);
      
      const product = await storage.getProduct(input.productId);
      if (!product) {
        return res.status(404).json({ message: "Товар не найден" });
      }
      
      const sizeStr = input.size || "One Size";
      const sizeStock = (product as any).sizeStock as Record<string, number> | null;
      let availableStock: number;
      if (input.size && sizeStock) {
        availableStock = resolveSizeStock(sizeStock, input.size) ?? (product.stock ?? 999);
      } else if (product.stock !== undefined && product.stock !== null) {
        availableStock = product.stock;
      } else {
        availableStock = 999;
      }
      
      const existingCartItems = await storage.getCartItems(input.sessionId ?? '');
      const existingItem = existingCartItems.find(
        ci => ci.productId === input.productId &&
          (ci.size || "One Size") === sizeStr &&
          (ci.color || "Default") === (input.color || "Default")
      );
      const currentInCart = existingItem?.quantity || 0;
      const requestedQty = input.quantity || 1;
      const totalAfterAdd = currentInCart + requestedQty;
      
      if (totalAfterAdd > availableStock) {
        const canAdd = Math.max(0, availableStock - currentInCart);
        if (canAdd <= 0) {
          return res.status(400).json({ 
            message: `Товар уже в корзине в максимальном количестве (${availableStock} шт.)`,
            code: "STOCK_LIMIT",
            availableStock,
            currentInCart,
          });
        }
        const limitedInput = { ...input, quantity: canAdd };
        const item = await storage.addToCart(limitedInput);
        return res.json({ 
          ...item, 
          stockLimited: true, 
          availableStock,
          message: `Добавлено ${canAdd} шт. (максимум ${availableStock} шт.)` 
        });
      }
      
      const item = await storage.addToCart(input);
      res.json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.patch(api.cart.updateQuantity.path, async (req, res) => {
    try {
      const { quantity } = api.cart.updateQuantity.input.parse(req.body);
      const { sessionId, productId, size, color } = req.query;
      
      const product = await storage.getProduct(Number(productId));
      if (!product) {
        return res.status(404).json({ message: "Товар не найден" });
      }
      
      const sizeStr = (size as string) || "One Size";
      const sizeStock = (product as any).sizeStock as Record<string, number> | null;
      let availableStock: number;
      if (sizeStock) {
        availableStock = resolveSizeStock(sizeStock, sizeStr) ?? (product.stock ?? 999);
      } else if (product.stock !== undefined && product.stock !== null) {
        availableStock = product.stock;
      } else {
        availableStock = 999;
      }
      
      if (quantity > availableStock) {
        return res.status(400).json({ 
          message: `Максимум ${availableStock} шт. в наличии`,
          code: "STOCK_LIMIT",
          availableStock,
        });
      }
      
      const result = await storage.updateCartItemQuantity(
        Number(req.params.id),
        quantity,
        sessionId as string,
        Number(productId),
        size as string,
        color as string
      );
      if (!result) return res.status(404).json({ message: "Cart item not found" });
      res.json(result);
    } catch (err) {
      res.status(400).json({ message: "Invalid quantity" });
    }
  });

  app.delete(api.cart.removeItem.path, async (req, res) => {
    // For YDB we need composite key: sessionId, productId, size, color
    const { sessionId, productId, size, color } = req.query;
    await storage.removeFromCart(
      Number(req.params.id),
      sessionId as string,
      Number(productId),
      size as string,
      color as string
    );
    res.status(200).send();
  });
  
  app.delete(api.cart.clear.path, async (req, res) => {
      await storage.clearCart(req.params.sessionId);
      res.status(200).send();
  });

  // Validate cart stock before checkout (read-only, no side effects)
  app.get("/api/cart/:sessionId/validate", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const cartItems = await storage.getCartItems(sessionId);
      const issues: { productName: string; size?: string; requested: number; available: number }[] = [];
      for (const ci of cartItems) {
        const sizeStr = ci.size || "One Size";
        const ciSizeStock = (ci.product as any).sizeStock as Record<string, number> | null;
        let avail: number;
        if (ciSizeStock && ciSizeStock[sizeStr] !== undefined) {
          avail = ciSizeStock[sizeStr];
        } else if (ci.product.stock !== undefined && ci.product.stock !== null) {
          avail = ci.product.stock;
        } else {
          avail = 999;
        }
        if (ci.quantity > avail) {
          issues.push({
            productName: ci.product.name,
            size: sizeStr !== "One Size" ? sizeStr : undefined,
            requested: ci.quantity,
            available: avail,
          });
        }
      }
      res.json({ valid: issues.length === 0, issues });
    } catch (err) {
      res.json({ valid: true, issues: [] });
    }
  });

  app.post("/api/cart/merge", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { fromSessionId } = req.body;
      const toSessionId = `user_${user.id}`;
      if (!fromSessionId || fromSessionId === toSessionId) {
        return res.status(200).json({ merged: 0 });
      }
      if (fromSessionId.startsWith("user_")) {
        return res.status(200).json({ merged: 0 });
      }
      const guestItems = await storage.getCartItems(fromSessionId);
      if (guestItems.length === 0) {
        return res.status(200).json({ merged: 0 });
      }
      const userItems = await storage.getCartItems(toSessionId);
      let merged = 0;
      for (const guestItem of guestItems) {
        const existing = userItems.find(
          (ui) => ui.productId === guestItem.productId && ui.size === guestItem.size && ui.color === guestItem.color
        );
        if (existing) {
          const newQty = existing.quantity + guestItem.quantity;
          await storage.updateCartItemQuantity(
            existing.id, newQty,
            toSessionId, existing.productId, existing.size || undefined, existing.color || undefined
          );
          merged++;
        } else {
          await storage.addToCart({
            sessionId: toSessionId,
            productId: guestItem.productId,
            quantity: guestItem.quantity,
            size: guestItem.size,
            color: guestItem.color,
          });
          merged++;
        }
      }
      await storage.clearCart(fromSessionId);
      console.log(`[Cart] Merged ${merged} items from guest ${fromSessionId} to user ${toSessionId}`);
      res.status(200).json({ merged });
    } catch (err: any) {
      console.error("[Cart] Merge error:", err.message);
      res.status(500).json({ error: "Failed to merge carts" });
    }
  });

  // Orders
  app.post(api.orders.create.path, authMiddleware, async (req: any, res) => {
    try {
      const input = api.orders.create.input.parse(req.body);
      const paymentMethod = req.body.paymentMethod || "tbank";
      const transportCompany = req.body.transportCompany;
      const giftCardCode = req.body.giftCardCode;
      const giftCardAmount = Number(req.body.giftCardAmount) || 0;
      const userId = req.user?.id;
      
      const cdekPointCode = req.body.cdekPointCode || undefined;
      const cdekCityCode = req.body.cdekCityCode ? Number(req.body.cdekCityCode) : undefined;
      const cdekTariffCode = req.body.cdekTariffCode ? Number(req.body.cdekTariffCode) : undefined;
      const cdekDeliveryType = req.body.cdekDeliveryType || "pickup";
      const cdekDoorAddress = req.body.cdekDoorAddress || undefined;
      
      const ydPointId = req.body.ydPointId || undefined;
      const ydPointName = req.body.ydPointName || undefined;
      const ydGeoId = req.body.ydGeoId || undefined;
      const deliveryService = req.body.deliveryService === "ozon" ? "ozon" : (ydPointId ? "yandex" : "cdek");
      
      const isWholesale = req.body.isWholesale === true;
      const clientDeliveryCost = Number(req.body.deliveryCost) || 0;
      console.log(`[Order] Creating order, isWholesale: ${isWholesale}, transportCompany: ${transportCompany}, userId: ${userId}, cdekPoint: ${cdekPointCode}, cdekTariff: ${cdekTariffCode}, ydPoint: ${ydPointId}, deliveryService: ${deliveryService}, clientDeliveryCost: ${clientDeliveryCost/100}`);
      
      // Calculate total and get items from cart
      const cartItems = await storage.getCartItems(input.sessionId);
      if (cartItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      const stockIssues: { productName: string; requested: number; available: number; size?: string }[] = [];
      for (const ci of cartItems) {
        const sizeStr = ci.size || "One Size";
        const ciSizeStock = (ci.product as any).sizeStock as Record<string, number> | null;
        let avail: number;
        if (ciSizeStock && ciSizeStock[sizeStr] !== undefined) {
          avail = ciSizeStock[sizeStr];
        } else if (ci.product.stock !== undefined && ci.product.stock !== null) {
          avail = ci.product.stock;
        } else {
          avail = 999;
        }
        if (ci.quantity > avail) {
          stockIssues.push({
            productName: ci.product.name,
            requested: ci.quantity,
            available: avail,
            size: sizeStr !== "One Size" ? sizeStr : undefined,
          });
        }
      }
      if (stockIssues.length > 0) {
        const details = stockIssues.map(si => 
          `${si.productName}${si.size ? ` (${si.size})` : ''}: запрошено ${si.requested}, в наличии ${si.available}`
        ).join('; ');
        return res.status(400).json({ 
          message: `Недостаточно товара на складе: ${details}`,
          code: "STOCK_INSUFFICIENT",
          stockIssues,
        });
      }

      const total = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      
      // Use wholesale prices for wholesale orders
      const orderItems = cartItems.map(item => {
          let price = item.product.price;
          if (isWholesale && item.product.wholesalePrice) {
            price = item.product.wholesalePrice;
          } else if (!isWholesale) {
            const discountPct = (item.product as any).discountPercent;
            const sizeDiscounts = (item.product as any).sizeDiscounts as Record<string, number> | null;
            const sizeDiscount = (sizeDiscounts && item.size && sizeDiscounts[item.size]) ? sizeDiscounts[item.size] : null;
            const effectiveDiscount = sizeDiscount ?? (discountPct || 0);
            if (effectiveDiscount > 0) {
              price = Math.round(item.product.price * (1 - effectiveDiscount / 100));
            }
          }
          const sizeCharIds = (item.product as any).sizeCharacteristicIds as Record<string, string> | null | undefined;
          const sizeCharGuid = (item.size && sizeCharIds) ? (sizeCharIds[item.size] || null) : null;
          return {
            productId: item.productId,
            productExternalId: item.product.externalId || item.productId.toString(),
            productName: item.product.name,
            sku: item.product.sku,
            quantity: item.quantity,
            price,
            size: item.size,
            color: item.color,
            sizeCharacteristicId: sizeCharGuid || undefined,
            imageUrl: item.product.thumbnailUrl || (item.product.images && item.product.images[0]) || null,
          };
      });

      // Recalculate subtotal with correct prices (items only, no delivery)
      const orderSubtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      // Verify delivery cost on the server side for non-wholesale orders
      let verifiedDeliveryCost = 0;
      if (!isWholesale && clientDeliveryCost > 0 && cdekCityCode) {
        try {
          const totalItemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);
          const packageWeight = Math.max(500, totalItemCount * CDEK_ITEM_WEIGHT_GRAMS);
          const calcRequest = {
            from_location: { code: CDEK_SENDER_CITY_CODE },
            to_location: { code: cdekCityCode },
            packages: [{
              weight: packageWeight,
              length: CDEK_DEFAULT_PACKAGE.length,
              width: CDEK_DEFAULT_PACKAGE.width,
              height: CDEK_DEFAULT_PACKAGE.height,
            }],
          };
          const tariffs = await cdekService.calculateTariffs(calcRequest);
          if (tariffs && tariffs.length > 0) {
            const matchingTariff = cdekTariffCode 
              ? tariffs.find(t => t.tariff_code === cdekTariffCode) 
              : null;
            const cheapest = tariffs.reduce((min, t) => t.delivery_sum < min.delivery_sum ? t : min, tariffs[0]);
            const serverDeliveryCost = (matchingTariff?.delivery_sum || cheapest.delivery_sum) * 100;
            const tolerance = Math.round(serverDeliveryCost * 0.20);
            if (Math.abs(clientDeliveryCost - serverDeliveryCost) <= tolerance) {
              verifiedDeliveryCost = clientDeliveryCost;
            } else {
              verifiedDeliveryCost = serverDeliveryCost;
              console.warn(`[Order] CDEK delivery cost mismatch beyond 20% tolerance! client=${clientDeliveryCost/100}, server=${serverDeliveryCost/100}. Using server value.`);
            }
            console.log(`[Order] CDEK delivery cost verified: client=${clientDeliveryCost/100}, server=${serverDeliveryCost/100}, used=${verifiedDeliveryCost/100} RUB`);
          } else {
            verifiedDeliveryCost = clientDeliveryCost;
            console.log(`[Order] CDEK tariffs not available, using client delivery cost: ${clientDeliveryCost/100} RUB`);
          }
        } catch (cdekErr: any) {
          verifiedDeliveryCost = clientDeliveryCost;
          console.log(`[Order] CDEK calculation failed, using client delivery cost: ${clientDeliveryCost/100} RUB. Error: ${cdekErr.message}`);
        }
      } else if (!isWholesale && clientDeliveryCost > 0) {
        verifiedDeliveryCost = clientDeliveryCost;
        console.log(`[Order] No CDEK city code, using client delivery cost: ${clientDeliveryCost/100} RUB`);
      }

      // Free shipping for retail orders >= 5000 RUB
      const FREE_SHIPPING_THRESHOLD = 500000;
      if (!isWholesale && orderSubtotal >= FREE_SHIPPING_THRESHOLD && verifiedDeliveryCost > 0) {
        console.log(`[Order] Free shipping applied: subtotal=${orderSubtotal/100} RUB >= ${FREE_SHIPPING_THRESHOLD/100} RUB threshold. Delivery cost zeroed (was ${verifiedDeliveryCost/100} RUB)`);
        verifiedDeliveryCost = 0;
      }

      // Apply promo code discount (applied to subtotal only, not delivery)
      let promoDiscount = 0;
      const promoCode = req.body.promoCode;
      let appliedPromo: any = null;
      if (promoCode) {
        appliedPromo = await storage.getPromoCodeByCode(promoCode);
        if (appliedPromo && appliedPromo.isActive) {
          // Safety net: block reuse of promo by the same email
          const promoAlreadyUsed = await storage.isPromoUsedByEmail(input.customerEmail, promoCode);
          if (promoAlreadyUsed) {
            console.warn(`[Order] Promo ${promoCode} blocked — already used by ${input.customerEmail}`);
            appliedPromo = null;
          } else {
            // Determine eligible subtotal (may be restricted to specific categories)
            let eligibleSubtotal = orderSubtotal;
            let promoApplicableCategories: string[] | null = null;
            if (appliedPromo.applicableCategories) {
              try {
                promoApplicableCategories = typeof appliedPromo.applicableCategories === 'string'
                  ? JSON.parse(appliedPromo.applicableCategories)
                  : appliedPromo.applicableCategories;
              } catch { promoApplicableCategories = null; }
            }
            if (promoApplicableCategories && promoApplicableCategories.length > 0) {
              const cats = promoApplicableCategories.map((c: string) => c.toLowerCase().trim());
              eligibleSubtotal = orderItems.reduce((sum, item, idx) => {
                const product = cartItems[idx]?.product;
                const cat = (product?.category || '').toLowerCase().trim();
                const sub = (product?.subcategory || '').toLowerCase().trim();
                if (cats.includes(cat) || cats.includes(sub)) {
                  return sum + (item.price * item.quantity);
                }
                return sum;
              }, 0);
              console.log(`[Order] Promo ${promoCode} restricted to categories [${promoApplicableCategories.join(', ')}]: eligibleSubtotal=${eligibleSubtotal/100} RUB`);
            }
            if (appliedPromo.discountPercent) {
              promoDiscount = Math.round(eligibleSubtotal * (appliedPromo.discountPercent / 100));
            } else if (appliedPromo.discountAmount) {
              promoDiscount = appliedPromo.discountAmount;
            }
            promoDiscount = Math.min(promoDiscount, orderSubtotal);
            console.log(`[Order] Applied promo ${promoCode}: -${promoDiscount / 100} RUB`);
          }
        }
      }

      // Apply loyalty discount (only for retail, non-wholesale, applied to subtotal only)
      let loyaltyDiscountApplied = 0;
      let loyaltyPercentApplied = 0;
      if (!isWholesale && userId) {
        const user = await authStorage.getUserById(userId);
        const loyaltyPercent = user?.loyaltyDiscount || 0;
        if (loyaltyPercent > 0) {
          const canApplyLoyalty = !appliedPromo || appliedPromo.canCombineWithLoyalty !== false;
          if (canApplyLoyalty) {
            loyaltyDiscountApplied = Math.round(orderSubtotal * (loyaltyPercent / 100));
            loyaltyPercentApplied = loyaltyPercent;
            console.log(`[Order] Applied loyalty discount: ${loyaltyPercent}% = -${loyaltyDiscountApplied / 100} RUB`);
          } else {
            console.log(`[Order] Loyalty discount skipped - promo code does not allow combination`);
          }
        }
      }

      // Handle gift card if provided
      let giftCardApplied = 0;
      if (giftCardCode && giftCardAmount > 0) {
        const giftCard = await storage.getGiftCardByCode(giftCardCode.toUpperCase());
        if (giftCard && giftCard.status === 'active' && giftCard.balance >= giftCardAmount) {
          giftCardApplied = Math.min(giftCardAmount, orderSubtotal + verifiedDeliveryCost - promoDiscount - loyaltyDiscountApplied);
          // Deduct from gift card balance
          const newBalance = giftCard.balance - giftCardApplied;
          const newStatus = newBalance === 0 ? 'used' : 'active';
          await storage.updateGiftCard(giftCard.id, { balance: newBalance, status: newStatus });
          console.log(`[Order] Applied gift card ${giftCardCode}: -${giftCardApplied/100} RUB, new balance: ${newBalance/100} RUB`);
        } else {
          console.log(`[Order] Gift card ${giftCardCode} not valid or insufficient balance`);
        }
      }

      // Calculate final amount to pay: subtotal + delivery - all discounts
      const amountToPay = Math.max(0, orderSubtotal + verifiedDeliveryCost - promoDiscount - loyaltyDiscountApplied - giftCardApplied);
      // Save the final total including delivery and discounts for correct display in emails/receipts
      const finalOrderTotal = amountToPay;
      console.log(`[Order] Payment calculation: subtotal=${orderSubtotal/100}, delivery=${verifiedDeliveryCost/100}, promoDiscount=${promoDiscount/100}, loyaltyDiscount=${loyaltyDiscountApplied/100}, giftCard=${giftCardApplied/100}, amountToPay=${amountToPay/100} RUB`);

      const discountDetails = {
        subtotal: orderSubtotal,
        deliveryCost: verifiedDeliveryCost,
        promoCode: promoCode || null,
        promoDiscountPercent: appliedPromo?.discountPercent || null,
        promoDiscountAmount: promoDiscount,
        loyaltyPercent: loyaltyPercentApplied,
        loyaltyDiscountAmount: loyaltyDiscountApplied,
        giftCardCode: (giftCardApplied > 0 && giftCardCode) ? giftCardCode : null,
        giftCardAmount: giftCardApplied,
        isWholesale: isWholesale || false,
      };

      const itemsWithDiscounts = [...orderItems, { _discountDetails: discountDetails }];

      // Partner attribution: only for retail orders, only for approved partners,
      // skip self-purchase by partner. See replit.md "Партнёрская платформа".
      //
      // Priority 1 — promo code attribution: if the applied promo code belongs to a partner,
      //   attribute commission to that partner regardless of referral cookie.
      //   One order = one commission (promo code wins over cookie).
      // Priority 2 — last-click referral: req.body.ref > cookie (server-set).
      //   Body fallback covers Safari ITP / iframe widget cookie blocking.
      let attributedPartnerId: number | undefined;
      let attributedPartner: any = null;
      if (!isWholesale) {
        // Priority 1: promo code linked to a partner
        if (appliedPromo && appliedPromo.partnerId) {
          try {
            const promoPartnerId = Number(appliedPromo.partnerId);
            if (Number.isFinite(promoPartnerId) && promoPartnerId > 0) {
              const promoPartner = await storage.getPartnerById(promoPartnerId);
              if (promoPartner && promoPartner.status === 'approved') {
                if (!userId || promoPartner.userId !== userId) {
                  attributedPartnerId = promoPartner.id;
                  attributedPartner = promoPartner;
                  console.log(`[Order] Partner attribution via promo code: code=${appliedPromo.code} partnerId=${promoPartner.id}`);
                } else {
                  console.log(`[Order] Skipping promo-code partner attribution: self-purchase by partner ${promoPartner.id}`);
                }
              }
            }
          } catch (e: any) {
            console.error('[Order] Partner promo attribution lookup failed:', e?.message);
          }
        }

        // Priority 2: referral cookie / body ref (only if promo code didn't already set attribution)
        if (!attributedPartnerId) {
          try {
            const bodyRefRaw = (req.body && typeof req.body.ref === 'string') ? req.body.ref : '';
            const cookieRefRaw = (req as any).cookies?.[PARTNER_COOKIE_NAME];
            const refSlugRaw = bodyRefRaw || cookieRefRaw;
            if (typeof refSlugRaw === 'string' && /^[a-z0-9-]{3,40}$/.test(refSlugRaw)) {
              // Use cached lookup to avoid YDB fullscan on every order (60s TTL)
              const partner = await getApprovedPartnerCached(refSlugRaw.toLowerCase());
              if (partner) {
                if (!userId || partner.userId !== userId) {
                  attributedPartnerId = partner.id;
                  attributedPartner = partner;
                  console.log(`[Order] Partner attribution matched: slug=${refSlugRaw} partnerId=${partner.id} source=${bodyRefRaw ? 'body' : 'cookie'}`);
                } else {
                  console.log(`[Order] Skipping partner attribution: self-purchase by partner ${partner.id}`);
                }
              }
            }
          } catch (e: any) {
            console.error('[Order] Partner attribution lookup failed:', e?.message);
          }
        }
      }

      const order = await storage.createOrder({
        ...input,
        promoCode: input.promoCode ?? undefined,
        total: finalOrderTotal,
        isWholesale: isWholesale || false,
        transportCompany: isWholesale ? transportCompany : undefined,
        items: itemsWithDiscounts,
        userId: userId || undefined,
        partnerId: attributedPartnerId,
        cdekPointCode: cdekPointCode,
        cdekCityCode: cdekCityCode,
        cdekTariffCode: cdekTariffCode,
        cdekDeliveryType: cdekDeliveryType,
        cdekDoorAddress: cdekDoorAddress,
        ydPointId: ydPointId,
        ydPointName: ydPointName,
      });

      // Create pending commission for partner-attributed orders.
      // Priority for artists: own merch → artistRate, non-own merch → commissionOverride ?? artistRate.
      // Priority for regular partners: commissionOverride > progressive scale (15/20/25%).
      // After creating the commission, ALL commissions for the month are recalculated at the new rate.
      if (attributedPartnerId && attributedPartner) {
        try {
          const commissionBase = Math.max(0, orderSubtotal - promoDiscount - loyaltyDiscountApplied);
          const now = new Date();
          const monthlyYear = now.getUTCFullYear();
          const monthlyMonth = now.getUTCMonth() + 1;

          if (attributedPartner.isArtist) {
            // Артист как реферер: собственные товары — по artistRate, чужие — по commissionOverride ?? artistRate.
            // Скидки масштабируются пропорционально: ownBase / orderSubtotal * commissionBase.
            const globalPercent = await getGlobalPartnerCommissionPercentCached();

            // Считаем сумму собственных товаров артиста в корзине (до скидок)
            let ownRaw = 0;
            for (let i = 0; i < cartItems.length; i++) {
              const itemArtistSlug = (cartItems[i].product as any).artistSlug as string | null | undefined;
              if (itemArtistSlug === attributedPartner.partnerSlug) {
                ownRaw += orderItems[i].price * orderItems[i].quantity;
              }
            }
            // Масштабируем пропорционально с учётом скидок
            const scaledOwnBase = orderSubtotal > 0 ? Math.round(ownRaw * commissionBase / orderSubtotal) : 0;
            const nonOwnBase = Math.max(0, commissionBase - scaledOwnBase);

            // Собственные товары артиста через его реф-ссылку — реф-комиссия НЕ создаётся.
            // Продажа учитывается только в дашборде артиста (getArtistStatsBySlug).

            // Комиссия за чужие товары (commissionOverride ?? artistRate ?? global)
            if (nonOwnBase > 0) {
              const refRate = attributedPartner.commissionOverride ?? attributedPartner.artistRate ?? globalPercent ?? PARTNER_DEFAULT_COMMISSION_PERCENT;
              const refRateSource = attributedPartner.commissionOverride != null ? 'override' : attributedPartner.artistRate != null ? 'artistRate' : 'global';
              const nonOwnAmount = Math.round(nonOwnBase * refRate / 100);
              await storage.createPartnerCommission({
                partnerId: attributedPartnerId,
                orderId: order.id,
                orderItemsTotal: nonOwnBase,
                commissionPercent: refRate,
                commissionAmount: nonOwnAmount,
                commissionType: 'referral',
              });
              console.log(`[Order] Artist non-own ref commission: order=${order.id} partner=${attributedPartnerId} base=${nonOwnBase/100} percent=${refRate} (${refRateSource}) amount=${nonOwnAmount/100}`);
            }

          } else if (attributedPartner.commissionOverride != null) {
            // Обычный партнёр с индивидуальной ставкой — прогрессивная шкала не применяется
            const commissionAmount = Math.round(commissionBase * attributedPartner.commissionOverride / 100);
            await storage.createPartnerCommission({
              partnerId: attributedPartnerId,
              orderId: order.id,
              orderItemsTotal: commissionBase,
              commissionPercent: attributedPartner.commissionOverride,
              commissionAmount,
              commissionType: 'referral',
            });
            console.log(`[Order] Partner commission created: order=${order.id} partner=${attributedPartnerId} base=${commissionBase/100} percent=${attributedPartner.commissionOverride} (override) amount=${commissionAmount/100}`);

          } else {
            // Обычный реф-партнёр: прогрессивная накопительная шкала за текущий месяц
            const monthlyCommissions = await storage.getMonthlyRefCommissions(attributedPartnerId, monthlyYear, monthlyMonth);
            const monthlyTotal = monthlyCommissions.reduce((s, c) => s + c.orderItemsTotal, 0) + commissionBase;
            const effectivePercent = getProgressiveCommissionRate(monthlyTotal);
            const percentSource = `progressive(${(monthlyTotal / 100).toFixed(0)}₽)`;
            const commissionAmount = Math.round(commissionBase * effectivePercent / 100);
            await storage.createPartnerCommission({
              partnerId: attributedPartnerId,
              orderId: order.id,
              orderItemsTotal: commissionBase,
              commissionPercent: effectivePercent,
              commissionAmount,
              commissionType: 'referral',
            });
            console.log(`[Order] Partner commission created: order=${order.id} partner=${attributedPartnerId} base=${commissionBase/100} percent=${effectivePercent} (${percentSource}) amount=${commissionAmount/100}`);
            await storage.recalcMonthlyCommissions(attributedPartnerId, monthlyYear, monthlyMonth, effectivePercent);
          }
        } catch (e: any) {
          console.error('[Order] Failed to create partner commission:', e?.message);
        }
      }

      // Artist commissions: automatically attributed per item via artistSlug on the product.
      // Triggered unconditionally (no ref cookie needed) — the artist earns % on every sale
      // of their merch. Exception: if that same artist was already attributed via ref/promo
      // for this order, skip their artist-commission to avoid double-counting.
      if (!isWholesale) {
        try {
          const artistItemsMap = new Map<string, { totalAmount: number }>();
          for (let i = 0; i < cartItems.length; i++) {
            const artistSlug = (cartItems[i].product as any).artistSlug as string | null | undefined;
            if (!artistSlug) continue;
            const itemAmount = orderItems[i].price * orderItems[i].quantity;
            const entry = artistItemsMap.get(artistSlug);
            if (entry) {
              entry.totalAmount += itemAmount;
            } else {
              artistItemsMap.set(artistSlug, { totalAmount: itemAmount });
            }
          }
          for (const [artistSlug, { totalAmount }] of artistItemsMap) {
            if (totalAmount <= 0) continue;
            const artist = await getApprovedPartnerCached(artistSlug);
            if (!artist || !artist.isArtist || artist.artistRate == null) continue;
            const commissionAmount = Math.round(totalAmount * artist.artistRate / 100);
            await storage.createPartnerCommission({
              partnerId: artist.id,
              orderId: order.id,
              orderItemsTotal: totalAmount,
              commissionPercent: artist.artistRate,
              commissionAmount,
              commissionType: 'artist',
            });
            console.log(`[Order] Artist commission created: order=${order.id} artist=${artistSlug} base=${totalAmount/100} percent=${artist.artistRate} amount=${commissionAmount/100}`);
          }
        } catch (e: any) {
          console.error('[Order] Artist commission error:', e?.message);
        }
      }

      if (isWholesale) {
        await storage.updateOrderStatus(order.id, 'pending');
        console.log(`[Order] Wholesale order #${order.id} status set to 'pending'`);
      }

      // Send invoice email only for wholesale orders with "invoice" payment method
      if (isWholesale && paymentMethod === "invoice") {
        console.log(`[Order] Sending invoice for wholesale order #${order.id}`);
        
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
        
        const invoiceNum = getNextInvoiceNumber();
        storage.saveOrderInvoiceNumber(order.id, invoiceNum).catch(err => console.error('[Order] Failed to save invoice number:', err));
        sendInvoiceEmail({
          invoiceNumber: invoiceNum,
          date: new Date(),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          transportCompany: transportCompany,
          vatRate: vatRate,
          vatMode: vatMode,
          promoCode: promoCode || undefined,
          promoDiscount: promoDiscount > 0 ? promoDiscount : undefined,
          items: orderItems.map(item => ({
            name: item.productName,
            sku: item.sku || '',
            quantity: item.quantity,
            price: item.price,
          })),
        }).catch(err => console.error('[Order] Failed to send invoice:', err));
      }

      const bitrixOrderData: any = {
        id: order.id,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        address: input.address,
        total: finalOrderTotal,
        items: orderItems,
        status: 'pending',
        isWholesale: isWholesale || false,
        transportCompany: transportCompany,
        promoCode: promoCode,
        cdekPointCode: cdekPointCode,
        deliveryService: deliveryService,
        ydPointName: ydPointName,
        discountDetails: discountDetails,
      };
      if (isWholesale && req.user) {
        bitrixOrderData.companyName = req.user.companyName || undefined;
        bitrixOrderData.inn = req.user.inn || undefined;
        bitrixOrderData.kpp = req.user.kpp || undefined;
        bitrixOrderData.legalAddress = req.user.legalAddress || undefined;
        bitrixOrderData.contactPerson = req.user.contactPerson || undefined;
        bitrixOrderData.contactPhone = req.user.contactPhone || undefined;
        bitrixOrderData.storeName = req.user.storeName || undefined;
        bitrixOrderData.storeAddress = req.user.storeAddress || undefined;
      }
      // Notify immediately only for wholesale (invoice) or gift-card-covered orders.
      // For online payment (tbank/yookassa), notification fires after payment webhook.
      if (isWholesale || amountToPay === 0) {
        const itemsForNotify = await enrichItemsWithProductColor(orderItems);
        notifyNewOrder({
          orderId: order.id,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          address: input.address,
          total: finalOrderTotal,
          items: itemsForNotify,
          paymentMethod: paymentMethod,
          isWholesale: isWholesale || false,
          promoCode: promoCode,
          transportCompany: transportCompany,
          companyName: isWholesale && req.user ? req.user.companyName : undefined,
          inn: isWholesale && req.user ? req.user.inn : undefined,
          deliveryService: deliveryService,
          ydPointName: ydPointName,
        });
        vkNotifyNewOrder({
          orderId: order.id,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          address: input.address,
          total: finalOrderTotal,
          items: itemsForNotify,
          paymentMethod: paymentMethod,
          isWholesale: isWholesale || false,
          promoCode: promoCode,
          transportCompany: transportCompany,
          companyName: isWholesale && req.user ? req.user.companyName : undefined,
          inn: isWholesale && req.user ? req.user.inn : undefined,
          deliveryService: deliveryService,
          ydPointName: ydPointName,
        });
      }

      sendOrderToBitrix(bitrixOrderData).then(async (result) => {
        if (result.success && result.dealId) {
          try {
            await storage.updateOrderBitrixDealId(order.id, result.dealId);
          } catch (e: any) {
            console.warn(`[Bitrix24] Failed to save deal ID for order #${order.id}:`, e.message);
          }
        }
      }).catch(err => console.error(`[Bitrix24] Failed to send order #${order.id}:`, err.message));

      // Create payment if payment method is specified
      let paymentUrl: string | undefined;
      let confirmationToken: string | undefined;
      
      // Skip payment if gift card covers entire order
      if (amountToPay === 0) {
        console.log(`[Order] Gift card covers entire order, skipping payment`);
        await storage.updateOrderStatus(order.id, 'paid');
        
        setTimeout(() => {
          storage.getOrderBitrixDealId(order.id).then(dealId => {
            if (!dealId) return;
            syncOrderStatusToBitrix(order.id, 'paid', dealId).catch(err =>
              console.error(`[Order GiftCard] Bitrix sync failed for order ${order.id}:`, err?.message || err)
            );
          }).catch(err =>
            console.error(`[Order GiftCard] getOrderBitrixDealId failed for order ${order.id}:`, err?.message || err)
          );
        }, 5000);

        createCdekWaybillForOrder(order.id).catch(err => 
          console.error(`[Order] CDEK waybill error for gift-card order ${order.id}:`, err.message)
        );
        createYandexDeliveryForOrder(order.id).catch(err =>
          console.error(`[Order] YD waybill error for gift-card order ${order.id}:`, err.message)
        );
      } else if (paymentMethod === "tbank" && paymentService.isTBankEnabled()) {
        const baseUrl = process.env.APP_DOMAIN || `https://${req.get('host')}`;
        const receiptItems = orderItems.map(item => ({
          name: item.productName,
          quantity: item.quantity,
          price: item.price,
        }));
        if (verifiedDeliveryCost > 0) {
          receiptItems.push({ name: "Доставка", quantity: 1, price: verifiedDeliveryCost });
        }
        const paymentResult = await paymentService.createPayment({
          amount: amountToPay,
          description: `Заказ #${order.id}`,
          orderId: String(order.id),
          returnUrl: `${baseUrl}/order-success/${order.id}`,
          paymentMethod: "tbank",
          receiptEmail: input.customerEmail,
          receiptItems,
        });
        
        if (paymentResult.success && paymentResult.confirmationUrl) {
          paymentUrl = paymentResult.confirmationUrl;
          if (paymentResult.paymentId) {
            await storage.updateOrderPaymentId(order.id, paymentResult.paymentId);
            orderPaymentIds.set(String(order.id), paymentResult.paymentId); // backup in-memory
          }
          console.log(`[Payment] T-Bank payment created for order ${order.id}: ${paymentUrl}`);
        } else {
          console.error(`[Payment] T-Bank payment failed:`, paymentResult.error);
        }
      } else if (paymentMethod === "yookassa" && paymentService.isYooKassaEnabled()) {
        const baseUrl = process.env.APP_DOMAIN || `https://${req.get('host')}`;
        const paymentResult = await paymentService.createPayment({
          amount: amountToPay,
          description: `Заказ #${order.id}`,
          orderId: String(order.id),
          returnUrl: `${baseUrl}/order-success/${order.id}`,
          paymentMethod: "yookassa",
          useWidget: true,
        });
        
        if (paymentResult.success && paymentResult.confirmationToken) {
          confirmationToken = paymentResult.confirmationToken;
          if (paymentResult.paymentId) {
            await storage.updateOrderPaymentId(order.id, paymentResult.paymentId);
          }
          console.log(`[Payment] YooKassa widget payment created for order ${order.id}`);
        } else if (paymentResult.success && paymentResult.confirmationUrl) {
          paymentUrl = paymentResult.confirmationUrl;
          if (paymentResult.paymentId) {
            await storage.updateOrderPaymentId(order.id, paymentResult.paymentId);
          }
          console.log(`[Payment] YooKassa redirect payment created for order ${order.id}: ${paymentUrl}`);
        } else {
          console.error(`[Payment] YooKassa payment failed:`, paymentResult.error);
        }
      } else if (paymentMethod === "ozon-pay" && ozonPayService.isEnabled()) {
        const baseUrl = process.env.APP_DOMAIN || `https://${req.get("host")}`;
        const notificationUrl = `${baseUrl}/api/webhooks/ozon-pay`;
        const ozonItems = orderItems.map((item) => {
          const numericId = Number(item.productId);
          return {
            extId: String(item.productId),
            name: item.productName,
            quantity: item.quantity,
            price: item.price,
            color: (item.color && item.color !== "Default") ? item.color : undefined,
            size: item.size || undefined,
            sku: Number.isSafeInteger(numericId) && numericId > 0 ? numericId : undefined,
          };
        });
        const ozonResult = await ozonPayService.createOrder({
          extId: String(order.id),
          amount: amountToPay,
          items: ozonItems,
          successUrl: `${baseUrl}/order-success/${order.id}`,
          failUrl: `${baseUrl}/checkout`,
          receiptEmail: input.customerEmail,
          notificationUrl,
          withDelivery: true,
        });

        if (ozonResult.success && ozonResult.payLink) {
          paymentUrl = ozonResult.payLink;
          if (ozonResult.ozonOrderId) {
            await storage.updateOrderPaymentId(order.id, ozonResult.ozonOrderId);
          }
          console.log(`[OzonPay] Payment link created for order ${order.id}: ${paymentUrl}`);
        } else {
          console.error("[OzonPay] Payment creation failed:", ozonResult.error);
        }
      }

      if (amountToPay > 0 && !paymentUrl && !confirmationToken && (paymentMethod === "yookassa" || paymentMethod === "tbank" || paymentMethod === "ozon-pay")) {
        console.error(`[Payment] No payment info generated for order ${order.id}, method: ${paymentMethod}`);
        // Delete the created order to avoid orphaned unpaid orders
        try { await storage.deleteOrder(order.id); } catch {}
        return res.status(500).json({ message: "Не удалось создать платёж через Ozon Pay. Попробуйте ещё раз или выберите другой способ оплаты." });
      }

      // Clear cart
      await storage.clearCart(input.sessionId);

      res.status(201).json({ ...order, paymentUrl, confirmationToken });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Public CDEK tracking by tracking number
  app.get("/api/track/:trackNumber", async (req, res) => {
    try {
      const trackNumber = req.params.trackNumber;
      if (!trackNumber) {
        return res.status(400).json({ error: "Укажите трек-номер" });
      }
      
      const allOrders = await storage.getOrders();
      const order = allOrders.find(o => {
        if (!o.cdekData) return false;
        try {
          const data = JSON.parse(typeof o.cdekData === 'string' ? o.cdekData : JSON.stringify(o.cdekData));
          return data.cdekNumber === trackNumber || data.orderUuid === trackNumber;
        } catch { return false; }
      });
      
      if (!order) {
        return res.status(404).json({ error: "Заказ с таким трек-номером не найден" });
      }
      
      let cdekInfo: any = {};
      try { cdekInfo = JSON.parse(typeof order.cdekData === 'string' ? order.cdekData : JSON.stringify(order.cdekData)); } catch {}
      
      res.json({
        orderId: order.id,
        status: order.status,
        trackNumber: cdekInfo.cdekNumber || null,
        lastStatus: cdekInfo.lastCdekStatusName || null,
        lastStatusDate: cdekInfo.lastCdekStatusDate || null,
        statuses: cdekInfo.cdekStatuses || [],
      });
    } catch (err: any) {
      console.error("[Track] Error:", err.message);
      res.status(500).json({ error: "Ошибка отслеживания" });
    }
  });

  // Get order status
  app.get("/api/orders/:orderId/status", async (req, res) => {
    try {
      const orderId = req.params.orderId;
      const order = await storage.getOrder(Number(orderId));
      
      if (!order) {
        return res.status(404).json({ error: "Заказ не найден" });
      }

      // If order already has a final status, return it
      if (order.status === "paid" || order.status === "cancelled") {
        return res.json({ 
          orderId: order.id,
          status: order.status,
          paid: order.status === "paid"
        });
      }

      // Get paymentId from order (YDB) or fallback to in-memory
      const paymentId = order.paymentId || orderPaymentIds.get(orderId);
      
      // Check payment status via T-Bank or YooKassa
      if (paymentId) {
        let paymentStatus: any = null;
        let paymentProvider = "";

        if (paymentService.isTBankEnabled()) {
          paymentStatus = await paymentService.getPaymentStatus(paymentId, "tbank");
          paymentProvider = "T-Bank";
        }
        if (!paymentStatus?.paid && paymentService.isYooKassaEnabled()) {
          paymentStatus = await paymentService.getPaymentStatus(paymentId, "yookassa");
          paymentProvider = "YooKassa";
        }

        if (paymentStatus) {
          console.log(`[Orders] ${paymentProvider} status for order ${orderId}:`, paymentStatus);
          
          if (paymentStatus.paid && order.status !== "paid") {
            await storage.updateOrderStatus(order.id, "paid");
            
            if (order.userId && !order.isWholesale) {
              try {
                await storage.updateUserTotalSpent(order.userId, order.total);
                const newDiscount = await storage.recalculateUserLoyaltyDiscount(order.userId);
                console.log(`[Loyalty] Updated user ${order.userId}: +${order.total / 100} RUB, new discount: ${newDiscount}%`);
              } catch (loyaltyErr) {
                console.error(`[Loyalty] Error updating user ${order.userId}:`, loyaltyErr);
              }
            }
            
            createCdekWaybillForOrder(order.id).catch(err => 
              console.error(`[Orders] CDEK waybill error for order ${order.id}:`, err.message)
            );
            createYandexDeliveryForOrder(order.id).catch(err =>
              console.error(`[Orders] YD waybill error for order ${order.id}:`, err.message)
            );

            storage.getOrderBitrixDealId(order.id).then(dealId => {
              if (!dealId) return;
              syncOrderStatusToBitrix(order.id, 'paid', dealId).catch(err =>
                console.error(`[Payment Poll] Bitrix paid-sync failed for order ${order.id}:`, err?.message || err)
              );
            }).catch(err =>
              console.error(`[Payment Poll] getOrderBitrixDealId failed for order ${order.id}:`, err?.message || err)
            );

            return res.json({
              orderId: order.id,
              status: "paid",
              paid: true
            });
          } else if (paymentStatus.status === "canceled") {
            await storage.updateOrderStatus(order.id, "cancelled");

            storage.getOrderBitrixDealId(order.id).then(dealId => {
              if (!dealId) return;
              syncOrderStatusToBitrix(order.id, 'cancelled', dealId).catch(err =>
                console.error(`[Payment Poll] Bitrix cancelled-sync failed for order ${order.id}:`, err?.message || err)
              );
            }).catch(err =>
              console.error(`[Payment Poll] getOrderBitrixDealId failed for order ${order.id}:`, err?.message || err)
            );

            return res.json({ 
              orderId: order.id,
              status: "cancelled",
              paid: false
            });
          }
        }
      }

      res.json({ 
        orderId: order.id,
        status: order.status,
        paid: order.status === "paid"
      });
    } catch (err: any) {
      console.error("[Orders] Status check error:", err.message);
      res.status(500).json({ error: "Ошибка проверки статуса" });
    }
  });

  // Newsletter subscription with database storage
  app.post("/api/newsletter/subscribe", async (req, res) => {
    try {
      const { email, source } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, message: "Email обязателен" });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: "Некорректный email" });
      }
      
      // Get configured promo codes from admin settings
      let promoCode = source === "popup" ? "WELCOME10" : "WELCOME7";
      try {
        const popupPromoId = await storage.getBonusSetting("popup_promo_id");
        const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
        const allPromos = await storage.getPromoCodes();
        
        if (source === "popup" && popupPromoId) {
          const promo = allPromos.find((p: any) => String(p.id) === popupPromoId);
          if (promo) promoCode = promo.code;
        } else if (homepagePromoId) {
          const promo = allPromos.find((p: any) => String(p.id) === homepagePromoId);
          if (promo) promoCode = promo.code;
        }
      } catch (e) {
        console.warn('[Newsletter] Could not fetch configured promo codes, using defaults');
      }
      
      // Check if already subscribed
      const existing = await storage.getNewsletterSubscription(email.toLowerCase());
      if (existing) {
        return res.status(200).json({ 
          success: true, 
          message: "Вы уже подписаны", 
          promoCode: existing.promoCodeGiven || promoCode
        });
      }
      
      // Save to database
      await storage.createNewsletterSubscription({
        email: email.toLowerCase(),
        promoCodeGiven: promoCode
      });
      
      console.log(`[Newsletter] New subscriber: ${email} from ${source || 'unknown'}. Promo: ${promoCode}`);
      
      res.status(201).json({ 
        success: true, 
        message: "Спасибо за подписку!", 
        promoCode 
      });
    } catch (err) {
      console.error("[Newsletter] Error:", err);
      res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
  });

  // User API - Get my newsletter subscription
  app.get("/api/newsletter/my-subscription", async (req, res) => {
    try {
      const email = String(req.query.email || '').toLowerCase().trim();
      if (!email) return res.json({ subscribed: false });
      const all = await storage.getAllNewsletterSubscriptions();
      const sub = all.find((s: any) => (s.email || '').toLowerCase().trim() === email);
      res.json({ subscribed: !!sub, promoCode: (sub as any)?.promoCodeGiven || (sub as any)?.promo_code_given || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // User API - Unsubscribe from newsletter
  app.delete("/api/newsletter/my-subscription", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      const all = await storage.getAllNewsletterSubscriptions();
      const sub = all.find((s: any) => (s.email || '').toLowerCase().trim() === String(email).toLowerCase().trim());
      if (!sub) return res.json({ success: true });
      await storage.deleteNewsletterSubscription(Number(sub.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Preorder subscribers
  app.post("/api/preorder-subscribers/subscribe", async (req, res) => {
    try {
      const { email, name } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      const existing = await storage.getPreorderSubscriberByEmail(String(email).toLowerCase().trim());
      if (existing) {
        if (!existing.isActive) {
          await storage.updatePreorderSubscriberStatus(String(email).toLowerCase().trim(), true);
        }
        return res.json({ success: true, alreadySubscribed: true });
      }
      await storage.addPreorderSubscriber(String(email).toLowerCase().trim(), name || undefined);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/preorder-subscribers/my-status", async (req, res) => {
    try {
      const email = String(req.query.email || '').toLowerCase().trim();
      if (!email) return res.json({ subscribed: false, isActive: false });
      const sub = await storage.getPreorderSubscriberByEmail(email);
      res.json({ subscribed: !!sub, isActive: sub ? sub.isActive : false });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/preorder-subscribers/unsubscribe", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      await storage.updatePreorderSubscriberStatus(String(email).toLowerCase().trim(), false);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/preorder-subscribers", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const all = await storage.getAllPreorderSubscribers();
      res.json({ subscribers: all, count: all.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin API - Delete newsletter subscription
  app.delete("/api/admin/newsletter-subscriptions/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid subscription ID" });
      }
      
      const success = await storage.deleteNewsletterSubscription(id);
      if (success) {
        res.json({ success: true, message: `Subscription ${id} deleted` });
      } else {
        res.status(404).json({ success: false, message: "Subscription not found" });
      }
    } catch (err) {
      console.error("[Admin] Delete subscription error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });

  // Admin API - List artist-only products
  app.get("/api/admin/artist-only-products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const raw = (storage as any).getRawProductsCache?.() as any[] | undefined;
      let all: any[];
      if (raw && raw.length > 0) {
        all = raw;
      } else {
        const { fetchProductsFromYdb } = storage as any;
        all = fetchProductsFromYdb ? await fetchProductsFromYdb.call(storage) : await storage.getProducts();
      }
      const artistOnly = all.filter((p: any) => p.artistOnly === true);
      res.json({ products: artistOnly });
    } catch (err) {
      console.error("[Admin] artist-only-products error:", err);
      res.status(500).json({ message: "Failed" });
    }
  });

  // Admin API - Delete single product
  app.delete("/api/admin/products/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      console.error("[Admin] SYNC_API_KEY not configured");
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const success = await storage.deleteProduct(id);
      if (success) {
        console.log(`[Admin] Deleted product ${id}`);
        res.json({ success: true, message: `Product ${id} deleted` });
      } else {
        res.status(404).json({ success: false, message: "Product not found" });
      }
    } catch (err) {
      console.error("[Admin] Delete product error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });


  // Admin API - Fix colors for all products
  app.post("/api/admin/fix-colors", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const allProducts = await storage.getProducts();
      let colorsFixed = 0;
      const fixed: string[] = [];
      
      // Known invalid colors that should be replaced
      const invalidColors = ['боковой карман', 'default', 'null', 'резинка', 'тактик', 'tube'];
      
      for (const product of allProducts) {
        const extractedColor = extractColorFromName(product.name);
        const currentColorLower = (product.color || '').toLowerCase();
        
        // Update if: no color, Default/null, or current color is in invalid list
        const needsUpdate = extractedColor && (
          !product.color || 
          product.color === 'Default' || 
          product.color === 'null' ||
          invalidColors.includes(currentColorLower) ||
          (extractedColor !== product.color && currentColorLower.includes('карман'))
        );
        
        if (needsUpdate) {
          await storage.updateProduct(product.id, { color: extractedColor });
          fixed.push(`${product.name}: "${product.color}" => "${extractedColor}"`);
          colorsFixed++;
        }
      }
      
      storage.clearCache();
      console.log(`[Admin] Fixed colors for ${colorsFixed} products`);
      res.json({ success: true, count: colorsFixed, fixed: fixed.slice(0, 50) });
    } catch (err) {
      console.error("[Admin] Fix colors error:", err);
      res.status(500).json({ success: false, message: "Fix colors failed" });
    }
  });

  // Admin API - Normalize sizeStock keys (clean up legacy "One Size", "(OneSize)" etc.)
  app.post("/api/admin/fix-sizestock", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    try {
      const allProducts = await storage.getProducts();
      let fixed = 0;
      const details: string[] = [];

      for (const product of allProducts) {
        const sizeStock = (product as any).sizeStock as Record<string, number> | null;
        if (!sizeStock || Object.keys(sizeStock).length === 0) continue;

        // Group keys by normalized form, keep max stock per group
        const normalized: Record<string, number> = {};
        for (const [key, val] of Object.entries(sizeStock)) {
          const canonical = canonicalizeSizeKey(key);
          normalized[canonical] = Math.max(normalized[canonical] ?? 0, Number(val));
        }

        const oldKeys = Object.keys(sizeStock).sort().join(',');
        const newKeys = Object.keys(normalized).sort().join(',');
        if (oldKeys !== newKeys) {
          await storage.updateProduct(product.id, { sizeStock: normalized } as any);
          details.push(`${product.name} (${product.id}): {${oldKeys}} → {${newKeys}}`);
          fixed++;
        }
      }

      storage.clearCache();
      console.log(`[Admin] Fixed sizeStock keys for ${fixed} products`);
      res.json({ success: true, count: fixed, details: details.slice(0, 100) });
    } catch (err) {
      console.error("[Admin] Fix sizeStock error:", err);
      res.status(500).json({ success: false, message: String(err) });
    }
  });

  // Admin API - Delete all products
  app.delete("/api/admin/products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      console.error("[Admin] SYNC_API_KEY not configured");
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const count = await storage.deleteAllProducts();
      console.log(`[Admin] Deleted all products (${count} items)`);
      res.json({ success: true, message: `Deleted ${count} products`, count });
    } catch (err) {
      console.error("[Admin] Delete all products error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });

  // ============ Gift Cards API ============

  // Create gift card table migration
  app.post("/api/migrate-gift-cards-table", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await storage.migrateGiftCardsTable();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get gift cards by batch ID (for success page)
  app.get("/api/gift-cards/batch/:id", async (req, res) => {
    try {
      const batchId = req.params.id;
      const giftCards = await storage.getGiftCards();
      
      // Find cards that were created around the same time as the batch ID
      const batchTime = parseInt(batchId);
      const matchingCards = giftCards.filter(gc => {
        const cardTime = gc.id;
        // Cards within 10 seconds of batch creation
        return Math.abs(cardTime - batchTime) < 10000;
      });
      
      res.json({ giftCards: matchingCards });
    } catch (err: any) {
      console.error("[GiftCards] Batch fetch error:", err);
      res.status(500).json({ error: "Ошибка получения сертификатов" });
    }
  });

  // Get gift card amounts (denominations)
  app.get("/api/gift-cards/amounts", async (req, res) => {
    const amounts = [
      { value: 50000, label: "500 ₽" },
      { value: 100000, label: "1 000 ₽" },
      { value: 200000, label: "2 000 ₽" },
      { value: 500000, label: "5 000 ₽" },
      { value: 1000000, label: "10 000 ₽" },
    ];
    res.json(amounts);
  });

  // ============ Bonus System API ============

  // Migrate bonus tables (one-time setup)
  app.post("/api/migrate-bonus-tables", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const results: string[] = [];
      const { driver: dbDriver } = await import("./db");
      
      const executeSchemeQuery = async (query: string, actionName: string) => {
        try {
          if (!dbDriver) throw new Error("Driver not initialized");
          await dbDriver.tableClient.withSession(async (session: any) => {
            await session.executeQuery(query);
          });
          results.push(`${actionName}: success`);
        } catch (e: any) {
          if (e.message?.includes("already exists") || e.message?.includes("Duplicate column") || e.message?.includes("Member not found")) {
            results.push(`${actionName}: exists/skipped`);
          } else {
            results.push(`${actionName}: error ${e.message}`);
          }
        }
      };

      await executeSchemeQuery(`CREATE TABLE promo_codes (
        id Uint64,
        code Utf8,
        discount_percent Int32,
        discount_amount Int32,
        min_order_amount Int32,
        max_uses Int32,
        used_count Int32,
        is_active Bool,
        starts_at Timestamp,
        expires_at Timestamp,
        can_combine_with_loyalty Bool,
        created_at Timestamp,
        description Utf8,
        applicable_categories Utf8,
        PRIMARY KEY (id)
      )`, "create promo_codes");
      
      await executeSchemeQuery(`ALTER TABLE promo_codes ADD COLUMN description Utf8`, "add description column");
      await executeSchemeQuery(`ALTER TABLE promo_codes ADD COLUMN applicable_categories Utf8`, "add applicable_categories column");

      await executeSchemeQuery(`CREATE TABLE loyalty_tiers (
        id Uint64,
        name Utf8,
        min_spent Int32,
        discount_percent Int32,
        sort_order Int32,
        PRIMARY KEY (id)
      )`, "create loyalty_tiers");

      await executeSchemeQuery(`CREATE TABLE newsletter_subscriptions (
        id Uint64,
        email Utf8,
        promo_code_given Utf8,
        subscribed_at Timestamp,
        PRIMARY KEY (id)
      )`, "create newsletter_subscriptions");

      await executeSchemeQuery(`CREATE TABLE bonus_settings (
        id Uint64,
        key Utf8,
        value Utf8,
        updated_at Timestamp,
        PRIMARY KEY (id)
      )`, "create bonus_settings");

      await executeSchemeQuery(`CREATE TABLE page_settings (
        id Uint64,
        page_name Utf8,
        section_id Utf8,
        settings Json,
        updated_at Timestamp,
        PRIMARY KEY (id)
      )`, "create page_settings");

      await executeSchemeQuery("ALTER TABLE users ADD COLUMN total_spent Int32", "alter users.total_spent");
      await executeSchemeQuery("ALTER TABLE users ADD COLUMN loyalty_discount Int32", "alter users.loyalty_discount");
      await executeSchemeQuery("ALTER TABLE orders ADD COLUMN promo_code Utf8", "alter orders.promo_code");
      await executeSchemeQuery("ALTER TABLE orders ADD COLUMN created_at Timestamp", "alter orders.created_at");
      await executeSchemeQuery("ALTER TABLE orders ADD COLUMN bitrix_deal_id Utf8", "alter orders.bitrix_deal_id");
      await executeSchemeQuery("ALTER TABLE promo_codes ADD COLUMN description Utf8", "alter promo_codes.description");
      await executeSchemeQuery("ALTER TABLE promo_codes ADD COLUMN applicable_categories Utf8", "alter promo_codes.applicable_categories");
      await executeSchemeQuery("ALTER TABLE orders ADD COLUMN invoice_number Int32", "alter orders.invoice_number");

      // Partner platform tables
      await executeSchemeQuery(`CREATE TABLE partners (
        id Uint64,
        user_id Uint64,
        partner_slug Utf8,
        store_name Utf8,
        contact_name Utf8,
        contact_email Utf8,
        contact_phone Utf8,
        status Utf8,
        commission_override Int32,
        clicks_count Int32,
        total_earned Int64,
        payout_requested Bool,
        created_at Timestamp,
        approved_at Timestamp,
        PRIMARY KEY (id)
      )`, "create partners");

      await executeSchemeQuery(`CREATE TABLE partner_products (
        id Utf8,
        partner_id Uint64,
        product_id Uint64,
        created_at Timestamp,
        PRIMARY KEY (id)
      )`, "create partner_products");

      await executeSchemeQuery(`CREATE TABLE partner_commissions (
        id Uint64,
        partner_id Uint64,
        order_id Uint64,
        order_items_total Int64,
        commission_percent Int32,
        commission_amount Int64,
        status Utf8,
        confirmed_at Timestamp,
        paid_at Timestamp,
        created_at Timestamp,
        PRIMARY KEY (id)
      )`, "create partner_commissions");

      // Defensive ALTERs for partners table (idempotent — skipped if column exists)
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN contact_phone Utf8", "alter partners.contact_phone");
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN commission_override Int32", "alter partners.commission_override");
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN clicks_count Int32", "alter partners.clicks_count");
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN total_earned Int64", "alter partners.total_earned");
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN payout_requested Bool", "alter partners.payout_requested");
      await executeSchemeQuery("ALTER TABLE partners ADD COLUMN approved_at Timestamp", "alter partners.approved_at");
      await executeSchemeQuery("ALTER TABLE orders ADD COLUMN partner_id Uint64", "alter orders.partner_id");

      // Manual hold-period for partner commissions (added Apr 2026)
      await executeSchemeQuery("ALTER TABLE partner_commissions ADD COLUMN hold_until Timestamp", "alter partner_commissions.hold_until");

      // Partner payouts history (added Apr 2026)
      await executeSchemeQuery(`CREATE TABLE partner_payouts (
        id Uint64,
        partner_id Uint64,
        amount Int64,
        commission_count Int32,
        commission_ids Utf8,
        method Utf8,
        recipient_name Utf8,
        recipient_details Utf8,
        note Utf8,
        created_by Utf8,
        created_at Timestamp,
        PRIMARY KEY (id)
      )`, "create partner_payouts");

      // Defensive ALTERs for partner_payouts (idempotent — handles user-created table with different shape)
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN amount Int64", "alter partner_payouts.amount");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN commission_count Int32", "alter partner_payouts.commission_count");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN commission_ids Utf8", "alter partner_payouts.commission_ids");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN method Utf8", "alter partner_payouts.method");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN recipient_name Utf8", "alter partner_payouts.recipient_name");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN recipient_details Utf8", "alter partner_payouts.recipient_details");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN note Utf8", "alter partner_payouts.note");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN created_by Utf8", "alter partner_payouts.created_by");
      await executeSchemeQuery("ALTER TABLE partner_payouts ADD COLUMN created_at Timestamp", "alter partner_payouts.created_at");

      res.json({ success: true, message: results.join("; ") });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all promo codes (admin)
  app.get("/api/promo-codes", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const codes = await storage.getPromoCodes();
      res.json({ promoCodes: codes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create promo code (admin)
  app.post("/api/promo-codes", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      // Pre-process body to ensure ISO strings are converted to Date objects for Zod
      const body = { ...req.body };
      if (body.startsAt && typeof body.startsAt === 'string') {
        const d = new Date(body.startsAt);
        if (!isNaN(d.getTime())) body.startsAt = d;
      }
      if (body.expiresAt && typeof body.expiresAt === 'string') {
        const d = new Date(body.expiresAt);
        if (!isNaN(d.getTime())) body.expiresAt = d;
      }

      const parsed = insertPromoCodeSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation error", details: parsed.error.errors });
      }
      const code = await storage.createPromoCode(parsed.data);
      invalidateSubscriptionPromosCache();
      res.json(code);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update promo code (admin)
  app.patch("/api/promo-codes/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const code = await storage.updatePromoCode(Number(req.params.id), req.body);
      invalidateSubscriptionPromosCache();
      res.json(code);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete promo code (admin)
  app.delete("/api/promo-codes/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await storage.deletePromoCode(Number(req.params.id));
      invalidateSubscriptionPromosCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Validate promo code (public - for checkout)
  app.post("/api/promo-codes/validate", async (req, res) => {
    try {
      const { code, orderAmount, email, cartItems } = req.body;
      if (!code) {
        return res.status(400).json({ valid: false, message: "Промокод не указан" });
      }
      
      const promo = await storage.getPromoCodeByCode(code);
      if (!promo) {
        return res.status(404).json({ valid: false, message: "Промокод не найден" });
      }
      
      // Check if active
      if (!promo.isActive) {
        return res.json({ valid: false, message: "Промокод неактивен" });
      }
      
      // Check dates
      const now = new Date();
      if (promo.startsAt && new Date(promo.startsAt) > now) {
        return res.json({ valid: false, message: "Промокод ещё не активен" });
      }
      if (promo.expiresAt && new Date(promo.expiresAt) < now) {
        return res.json({ valid: false, message: "Промокод истёк" });
      }
      
      // Check usage limit
      if (promo.maxUses && (promo.usedCount ?? 0) >= promo.maxUses) {
        return res.json({ valid: false, message: "Лимит использований исчерпан" });
      }
      
      // Check per-email usage (one-time promo protection)
      const emailToCheck = email || (req as any).user?.email;
      if (emailToCheck) {
        const alreadyUsed = await storage.isPromoUsedByEmail(emailToCheck, code);
        if (alreadyUsed) {
          return res.json({ valid: false, message: "Этот промокод уже был использован вами ранее" });
        }
      }

      // Parse applicable categories (if any)
      let applicableCategories: string[] | null = null;
      if (promo.applicableCategories) {
        try {
          applicableCategories = typeof promo.applicableCategories === 'string'
            ? JSON.parse(promo.applicableCategories)
            : promo.applicableCategories;
        } catch { applicableCategories = null; }
      }

      // Compute eligible amount (sum of cart items matching categories)
      let eligibleAmount: number | null = null;
      if (applicableCategories && applicableCategories.length > 0 && Array.isArray(cartItems)) {
        const cats = applicableCategories.map((c: string) => c.toLowerCase().trim());
        eligibleAmount = cartItems.reduce((sum: number, item: any) => {
          const cat = (item.category || '').toLowerCase().trim();
          const sub = (item.subcategory || '').toLowerCase().trim();
          if (cats.includes(cat) || cats.includes(sub)) {
            return sum + (item.price * item.quantity);
          }
          return sum;
        }, 0);
        if (eligibleAmount === 0) {
          const catNames = applicableCategories.join(', ');
          return res.json({ valid: false, message: `Промокод действует только на: ${catNames}` });
        }
      }
      
      // Check minimum order (against eligible amount or full order)
      const amountToCheck = eligibleAmount ?? orderAmount;
      if (promo.minOrderAmount && amountToCheck && amountToCheck < promo.minOrderAmount) {
        const minRub = promo.minOrderAmount / 100;
        return res.json({ valid: false, message: `Минимальная сумма заказа: ${minRub} ₽` });
      }
      
      res.json({
        valid: true,
        code: promo.code,
        discountPercent: promo.discountPercent,
        discountAmount: promo.discountAmount,
        canCombineWithLoyalty: promo.canCombineWithLoyalty,
        applicableCategories,
        eligibleAmount,
      });
    } catch (err: any) {
      res.status(500).json({ valid: false, message: err.message });
    }
  });

  // Get loyalty tiers (admin)
  app.get("/api/loyalty-tiers", async (req, res) => {
    try {
      const tiers = await storage.getLoyaltyTiers();
      res.json(tiers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create loyalty tier (admin)
  app.post("/api/loyalty-tiers", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const parsed = insertLoyaltyTierSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation error", details: parsed.error.errors });
      }
      const tier = await storage.createLoyaltyTier(parsed.data);
      res.json(tier);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update loyalty tier (admin)
  app.patch("/api/loyalty-tiers/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const tier = await storage.updateLoyaltyTier(Number(req.params.id), req.body);
      res.json(tier);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete loyalty tier (admin)
  app.delete("/api/loyalty-tiers/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await storage.deleteLoyaltyTier(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get bonus settings (admin)
  app.get("/api/bonus-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const settings = await storage.getAllBonusSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update bonus setting (admin)
  app.post("/api/bonus-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const parsed = insertBonusSettingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation error", details: parsed.error.errors });
      }
      await storage.setBonusSetting(parsed.data.key, parsed.data.value);
      invalidateSubscriptionPromosCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get available payment methods
  app.get("/api/payment-methods", (req, res) => {
    const methods = [];
    if (paymentService.isYooKassaEnabled()) {
      methods.push({ id: "yookassa", name: "ЮKassa", icon: "credit-card" });
    }
    if (paymentService.isTBankEnabled()) {
      methods.push({ id: "tbank", name: "Т-Банк", icon: "credit-card" });
    }
    res.json({ methods, enabled: methods.length > 0, tbankTerminalKey: process.env.TBANK_TERMINAL_KEY || null });
  });

  // Create a new gift card (initiate purchase)
  app.post("/api/gift-cards", async (req, res) => {
    try {
      const { purchaseGiftCardSchema } = await import("@shared/schema");
      const quantity = Math.max(1, Math.min(Number(req.body.quantity) || 1, 10));
      const input = purchaseGiftCardSchema.parse(req.body);
      // Use T-Bank as default if configured, otherwise yookassa
      const defaultPayment = paymentService.isTBankEnabled() ? "tbank" : "yookassa";
      const paymentMethod = (req.body.paymentMethod as "yookassa" | "tbank") || defaultPayment;
      
      const createdCards = [];
      for (let i = 0; i < quantity; i++) {
        // Create pending gift card
        const giftCard = await storage.createGiftCard({
          amount: input.amount,
          balance: input.amount,
          purchaserEmail: input.purchaserEmail,
          purchaserName: input.purchaserName,
          recipientEmail: input.recipientEmail || null,
          recipientName: input.recipientName || null,
          message: input.message || null,
          cardColor: req.body.cardColor || 'black',
          paymentId: null,
          paymentMethod: paymentMethod,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        } as any);
        createdCards.push(giftCard);
      }

      const firstCard = createdCards[0];
      const totalAmount = input.amount * quantity;

      // If payment service is configured, create payment
      const baseUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;
      const returnUrl = `${baseUrl}/gift-cards/success?id=${firstCard.id}`;

      if (paymentService.isYooKassaEnabled() || paymentService.isTBankEnabled()) {
        const amountRub = totalAmount / 100;
        const description = quantity > 1 
          ? `Подарочные карты BMGBRAND (${quantity} шт.) на ${amountRub} ₽`
          : `Подарочная карта BMGBRAND на ${amountRub} ₽`;

        const useWidget = paymentMethod === "yookassa" || (!paymentMethod && paymentService.isYooKassaEnabled());
        const amountPerCard = input.amount;
        const giftCardReceiptItems = quantity > 1
          ? [{ name: `Подарочная карта BMGBRAND (${quantity} шт.)`, quantity: quantity, price: amountPerCard }]
          : [{ name: `Подарочная карта BMGBRAND`, quantity: 1, price: totalAmount }];
        const payment = await paymentService.createPayment({
          amount: totalAmount,
          description,
          orderId: quantity > 1 ? `BATCH-${firstCard.id}-${quantity}` : String(firstCard.id),
          returnUrl,
          metadata: { 
            giftCardId: String(firstCard.id), 
            giftCardIds: createdCards.map(c => String(c.id)).join(','),
            type: "gift_card",
            isBatch: quantity > 1 ? "true" : "false"
          },
          paymentMethod,
          useWidget: useWidget,
          receiptEmail: input.purchaserEmail,
          receiptItems: giftCardReceiptItems,
        });

        if (payment.success && payment.paymentId) {
          for (const card of createdCards) {
            await storage.updateGiftCard(card.id, { paymentId: payment.paymentId });
          }
          
          return res.status(201).json({
            success: true,
            giftCard: {
              id: firstCard.id,
              code: firstCard.code,
              amount: firstCard.amount,
              status: firstCard.status,
            },
            giftCards: createdCards,
            paymentUrl: payment.confirmationUrl,
            confirmationToken: payment.confirmationToken,
            message: payment.confirmationToken ? undefined : "Перенаправление на страницу оплаты...",
          });
        } else {
          console.error("[GiftCards] Payment creation failed:", payment.error);
        }
      }
      
      // Fallback if payment not configured
      res.status(201).json({
        success: true,
        giftCard: {
          id: firstCard.id,
          code: firstCard.code,
          amount: firstCard.amount,
          status: firstCard.status,
        },
        giftCards: createdCards,
        message: "Подарочные карты созданы. Оплата временно недоступна.",
      });
    } catch (err: any) {
      console.error("[GiftCards] Create error:", err);
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0]?.message || "Ошибка валидации" });
      }
      res.status(500).json({ error: "Ошибка создания подарочной карты" });
    }
  });

  // T-Bank webhook for gift cards is handled by the main T-Bank webhook handler above
  // YooKassa webhook is handled by the main handler at /api/webhooks/yookassa above

  // Validate gift card code (check balance)
  app.get("/api/gift-cards/validate/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const giftCard = await storage.getGiftCardByCode(code.toUpperCase());
      
      if (!giftCard) {
        return res.status(404).json({ valid: false, error: "Карта не найдена" });
      }
      
      if (giftCard.status === "pending") {
        return res.status(400).json({ valid: false, error: "Карта ещё не оплачена" });
      }
      
      if (giftCard.status === "used") {
        return res.status(400).json({ valid: false, error: "Карта уже использована" });
      }
      
      if (new Date() > giftCard.expiresAt) {
        return res.status(400).json({ valid: false, error: "Срок действия карты истёк" });
      }
      
      res.json({
        valid: true,
        balance: giftCard.balance,
        expiresAt: giftCard.expiresAt,
      });
    } catch (err: any) {
      console.error("[GiftCards] Validate error:", err);
      res.status(500).json({ error: "Ошибка проверки карты" });
    }
  });

  // Apply gift card to order (redeem)
  app.post("/api/gift-cards/redeem", async (req, res) => {
    try {
      const { code, amount, userId } = req.body;
      
      if (!code || !amount) {
        return res.status(400).json({ error: "Код и сумма обязательны" });
      }
      
      const updatedCard = await storage.redeemGiftCard(
        code.toUpperCase(), 
        userId || 0, 
        amount
      );
      
      res.json({
        success: true,
        newBalance: updatedCard.balance,
        amountUsed: amount,
        status: updatedCard.status,
      });
    } catch (err: any) {
      console.error("[GiftCards] Redeem error:", err);
      res.status(400).json({ error: err.message || "Ошибка использования карты" });
    }
  });

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
      console.error("[Admin] Get orders error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Order analytics (admin)
  app.get("/api/admin/analytics/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const data = await storage.getOrderAnalytics();
      res.json(data);
    } catch (err: any) {
      console.error("[Admin] Analytics error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/analytics/artists", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const data = await storage.getArtistAnalytics();
      res.json(data);
    } catch (err: any) {
      console.error("[Admin] Artist analytics error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary: get artist stats by slug (for testing)
  app.get("/api/admin/test-artist-stats/:slug", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const stats = await storage.getArtistStatsBySlug(req.params.slug);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get draft/expired orders (admin)
  app.get("/api/admin/draft-orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const drafts = await storage.getDraftOrders();
      res.json(drafts);
    } catch (err: any) {
      console.error("[Admin] getDraftOrders error:", err.message);
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
      console.error("[Admin] deleteDraftOrder error:", err.message);
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
      const order = await storage.updateOrderStatus(orderId, status);

      storage.getOrderBitrixDealId(orderId).then(dealId => {
        if (!dealId) return;
        syncOrderStatusToBitrix(orderId, status, dealId).catch(err =>
          console.error(`[Order Status] Bitrix sync failed for order ${orderId}:`, err?.message || err)
        );
      }).catch(err =>
        console.error(`[Order Status] getOrderBitrixDealId failed for order ${orderId}:`, err?.message || err)
      );

      // Partner commission status sync: delivered → confirmed; cancelled/refunded → cancelled
      // After cancellation, monthly progressive scale is recalculated downward for ref-partners.
      if (status === "delivered" || status === "cancelled" || status === "refunded") {
        storage.getCommissionByOrderId(orderId).then(async (commission) => {
          if (!commission) return;
          if (status === "delivered" && commission.status === "pending") {
            await storage.updateCommissionStatus(commission.id, "confirmed");
            console.log(`[Partner] Commission ${commission.id} confirmed (order ${orderId} delivered)`);
          } else if ((status === "cancelled" || status === "refunded") && commission.status !== "cancelled" && commission.status !== "paid") {
            await storage.updateCommissionStatus(commission.id, "cancelled");
            console.log(`[Partner] Commission ${commission.id} cancelled (order ${orderId} ${status})`);

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
                console.log(`[Partner] Monthly recalc after cancel: partner=${commission.partnerId} remainingTotal=${monthlyTotal/100}₽ newPercent=${newPercent}%`);
              }
            } catch (recalcErr: any) {
              console.error('[Partner] Monthly recalc failed after cancel:', recalcErr?.message);
            }
          }
        }).catch(err => console.error(`[Partner] Commission sync failed for order ${orderId}:`, err.message));
      }

      if (status === "paid") {
        createCdekWaybillForOrder(orderId).catch(err => 
          console.error(`[Admin] CDEK waybill error for order ${orderId}:`, err.message)
        );
        createYandexDeliveryForOrder(orderId).catch(err =>
          console.error(`[Admin] YD waybill error for order ${orderId}:`, err.message)
        );
      }

      res.json(order);
    } catch (err: any) {
      console.error("[Admin] Update order status error:", err.message);
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
      console.error("[Admin] Delete order error:", err.message);
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

      if (order.cdekData) {
        const cdekInfo = JSON.parse(order.cdekData);
        if (cdekInfo.status === "creating" || cdekInfo.status === "error") {
          cdekInfo.status = "pending_retry";
          delete cdekInfo.error;
          await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));
        }
      }

      const result = await createCdekWaybillForOrder(orderId);
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] CDEK retry error:", err.message);
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
      console.error("[Admin] CDEK status error:", err.message);
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

  // Get all gift cards (admin)
  app.get("/api/admin/gift-cards", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const cards = await storage.getGiftCards();
      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update gift card (admin)
  app.patch("/api/admin/gift-cards/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const card = await storage.updateGiftCard(Number(req.params.id), req.body);
      res.json(card);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete gift card (admin)
  app.delete("/api/admin/gift-cards/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await storage.deleteGiftCard(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Reviews
  app.get("/api/admin/reviews", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const reviews = await storage.getAllReviews();
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/reviews/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const id = parseInt(req.params.id);
      const review = await storage.updateReview(id, req.body);
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/reviews/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const id = parseInt(req.params.id);
      await storage.deleteReview(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/migrate-reviews", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await storage.migrateReviewsTable();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Newsletter subscription stats
  app.get("/api/admin/stock-notifications", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const notifications = await storage.getAllStockNotifications();
      res.json(notifications);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload image for email editor
  app.post("/api/admin/upload-email-image", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file data" });
      }
      const mimeType = (req.headers["content-type"] || "image/jpeg").split(";")[0].trim();
      const ext = mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : mimeType === "image/webp" ? "webp" : "jpg";
      const filename = `email_images/email_img_${Date.now()}.${ext}`;
      const url = await uploadToYandexStorage(buffer, filename, mimeType);
      if (!url) {
        return res.status(500).json({ error: "Failed to upload image" });
      }
      console.log(`[Admin] Uploaded email image: ${url}`);
      res.json({ url });
    } catch (error) {
      console.error("[Admin] Error uploading email image:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.get("/api/admin/newsletter-stats", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const subscriptions = await storage.getAllNewsletterSubscriptions();
      res.json({ 
        subscriptions: subscriptions || [], 
        count: subscriptions?.length || 0 
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Send broadcast email to newsletter subscribers
  app.post("/api/admin/newsletter-broadcast", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { subject, html, emails } = req.body;
      if (!subject || !html || !emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "subject, html и emails обязательны" });
      }

      const { sendEmail } = await import('./email');
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const email of emails) {
        try {
          const success = await sendEmail({ to: email, subject, html });
          if (success) {
            sent++;
          } else {
            failed++;
            errors.push(email);
          }
        } catch (e: any) {
          failed++;
          errors.push(email);
        }
      }

      res.json({ sent, failed, total: emails.length, errors });
    } catch (err: any) {
      console.error("[Newsletter Broadcast] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Page settings API (public read, admin write)
  app.get("/api/page-settings/:pageName", async (req, res) => {
    try {
      const settings = await storage.getPageSettings(req.params.pageName);
      res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/page-settings/:pageName/:sectionId", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { pageName, sectionId } = req.params;
      const settings = req.body;
      await storage.setPageSectionSettings(pageName, sectionId, settings);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/page-settings/:pageName/:sectionId", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { pageName, sectionId } = req.params;
      await storage.deletePageSectionSettings(pageName, sectionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Upload image for page settings
  app.post("/api/admin/upload-image", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const contentType = req.headers["content-type"] || "image/webp";
      const rawFilename = (req.headers["x-filename"] as string) || `upload_${Date.now()}.webp`;
      const filename = (() => { try { return decodeURIComponent(rawFilename); } catch { return rawFilename; } })();
      
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      
      if (buffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }
      
      const sharp = (await import("sharp")).default;
      const webpBuffer = await sharp(buffer)
        .webp({ quality: 85 })
        .toBuffer();

      const thumbBuffer = await sharp(buffer)
        .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
        .sharpen()
        .webp({ quality: 88 })
        .toBuffer();
      
      const ts = Date.now();
      const cleanName = filename.replace(/\.[^.]+$/, ".webp").replace(/[^a-zA-Z0-9._-]/g, "_");
      
      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      const s3Key = `site/${ts}_${cleanName}`;
      const s3ThumbKey = s3Key.replace('.webp', '_thumb.webp');
      
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
        },
      });
      
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: webpBuffer,
        ContentType: "image/webp",
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3ThumbKey,
        Body: thumbBuffer,
        ContentType: "image/webp",
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      
      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
      console.log(`[Upload] Image uploaded: ${url}`);
      
      res.json({ url, success: true });
    } catch (err: any) {
      console.error("[Upload] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Upload video file
  app.post("/api/admin/upload-video", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const contentType = req.headers["content-type"] || "video/mp4";
      const rawFilenameVideo = (req.headers["x-filename"] as string) || `video_${Date.now()}.mp4`;
      const filename = (() => { try { return decodeURIComponent(rawFilenameVideo); } catch { return rawFilenameVideo; } })();

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }

      if (buffer.length > 100 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large (max 100MB)" });
      }

      const ts = Date.now();
      const ext = filename.match(/\.(mp4|webm|mov|avi)$/i)?.[0] || ".mp4";
      const cleanName = filename.replace(/\.[^.]+$/, ext).replace(/[^a-zA-Z0-9._-]/g, "_");

      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      const s3Key = `site/video/${ts}_${cleanName}`;

      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
        },
      });

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));

      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
      console.log(`[Upload] Video uploaded: ${url} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

      res.json({ url, success: true });
    } catch (err: any) {
      console.error("[Upload] Video error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get users with loyalty data
  app.get("/api/admin/loyalty-users", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const users = await storage.getUsersWithLoyalty();
      res.json({ users: users || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get all users' favorites
  app.get("/api/admin/favorites", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const allFavorites = await authStorage.getAllFavorites();
      
      const userFavoritesMap: Record<number, { productIds: number[], count: number }> = {};
      const productFavoritesCount: Record<number, number> = {};
      
      for (const fav of allFavorites) {
        if (!userFavoritesMap[fav.userId]) {
          userFavoritesMap[fav.userId] = { productIds: [], count: 0 };
        }
        userFavoritesMap[fav.userId].productIds.push(fav.productId);
        userFavoritesMap[fav.userId].count++;
        
        productFavoritesCount[fav.productId] = (productFavoritesCount[fav.productId] || 0) + 1;
      }

      const usersWithFavorites = await Promise.all(
        Object.entries(userFavoritesMap).map(async ([userId, data]) => {
          const user = await authStorage.getUserById(Number(userId));
          return {
            userId: Number(userId),
            userName: user?.name || user?.email || "Unknown",
            userEmail: user?.email || "",
            productIds: data.productIds,
            count: data.count,
          };
        })
      );

      const popularProducts = Object.entries(productFavoritesCount)
        .map(([productId, count]) => ({ productId: Number(productId), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      res.json({
        users: usersWithFavorites.sort((a, b) => b.count - a.count),
        popularProducts,
        totalFavorites: allFavorites.length,
        totalUsers: usersWithFavorites.length,
      });
    } catch (err: any) {
      console.error("[Admin] Get favorites error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Список всех розничных клиентов
  app.get("/api/admin/users", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const users = await authStorage.getAllRetailUsers();
      const allOrders = await storage.getOrders();
      const allFavorites = await authStorage.getAllFavorites();

      const favCountByUser: Record<number, number> = {};
      for (const f of allFavorites) {
        favCountByUser[f.userId] = (favCountByUser[f.userId] || 0) + 1;
      }

      const ordersByUser: Record<number, any[]> = {};
      for (const o of allOrders) {
        if (o.status === 'awaiting_payment') continue;
        if (o.userId) {
          if (!ordersByUser[o.userId]) ordersByUser[o.userId] = [];
          ordersByUser[o.userId].push(o);
        }
      }
      // Также индексируем по email для заказов без userId
      const ordersByEmail: Record<string, any[]> = {};
      for (const o of allOrders) {
        if (o.status === 'awaiting_payment') continue;
        if (o.customerEmail) {
          const key = o.customerEmail.toLowerCase();
          if (!ordersByEmail[key]) ordersByEmail[key] = [];
          ordersByEmail[key].push(o);
        }
      }

      const result = users.map(u => {
        const byId = ordersByUser[u.id] || [];
        const byEmail = u.email ? (ordersByEmail[u.email.toLowerCase()] || []) : [];
        const seen = new Set<number>();
        const userOrders: any[] = [];
        for (const o of [...byId, ...byEmail]) {
          if (!seen.has(o.id)) { seen.add(o.id); userOrders.push(o); }
        }
        const lastOrder = userOrders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const paidOrders = userOrders.filter((o: any) => !['cancelled', 'awaiting_payment'].includes(o.status));
        const computedTotalSpent = paidOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone || null,
          createdAt: u.createdAt,
          totalSpent: computedTotalSpent,
          loyaltyDiscount: u.loyaltyDiscount || 0,
          orderCount: userOrders.length,
          lastOrderAt: lastOrder?.createdAt || null,
          favoritesCount: favCountByUser[u.id] || 0,
          emailVerified: u.emailVerified,
        };
      });

      res.json({ users: result });
    } catch (err: any) {
      console.error("[Admin] Get users error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Карточка конкретного клиента
  app.get("/api/admin/users/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const userId = Number(req.params.id);
      if (!userId) return res.status(400).json({ error: "Invalid id" });

      const [user, ordersByUserId, ordersByEmail, favoriteIds, cartItems] = await Promise.all([
        authStorage.getUserById(userId),
        storage.getOrdersByUserId(userId),
        (async () => {
          const u = await authStorage.getUserById(userId);
          if (!u?.email) return [];
          return storage.getOrdersByEmail(u.email);
        })(),
        authStorage.getFavorites(userId),
        storage.getCartByUserId(userId),
      ]);

      // Объединяем заказы по id (убираем дубликаты)
      const ordersMap = new Map<number, any>();
      for (const o of [...ordersByUserId, ...ordersByEmail]) {
        ordersMap.set(o.id, o);
      }
      const orders = Array.from(ordersMap.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      if (!user) return res.status(404).json({ error: "User not found" });

      // Промокоды использованные этим пользователем (из заказов)
      const usedPromoCodes = orders
        .filter((o: any) => o.promoCode)
        .map((o: any) => ({ code: o.promoCode, orderId: o.id, orderDate: o.createdAt, orderTotal: o.total }));

      // Подписка на рассылку
      let newsletterSubscribed = false;
      try {
        const newsletters = await storage.getAllNewsletterSubscriptions();
        newsletterSubscribed = newsletters.some((s: any) => s.email?.toLowerCase() === user.email?.toLowerCase());
      } catch { }

      // Подписки на снижение цены
      let priceDropSubs: any[] = [];
      try {
        priceDropSubs = await storage.getPriceDropSubscriptionsByEmail(user.email);
      } catch { }

      // Товары из избранного с деталями
      const favoriteProducts = await Promise.all(
        favoriteIds.slice(0, 50).map(async (pid: number) => {
          const p = await storage.getProduct(pid);
          return p ? { id: p.id, name: p.name, price: p.price, thumbnailUrl: p.thumbnailUrl || p.imageUrl } : null;
        })
      ).then(r => r.filter(Boolean));

      const paidOrders = orders.filter((o: any) => !['cancelled', 'awaiting_payment'].includes(o.status));
      const computedTotalSpent = paidOrders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          createdAt: user.createdAt,
          emailVerified: user.emailVerified,
          totalSpent: computedTotalSpent,
          loyaltyDiscount: user.loyaltyDiscount || 0,
        },
        orders: orders.slice(0, 100),
        favorites: favoriteProducts,
        cart: cartItems.map(ci => ({
          productId: ci.productId,
          name: ci.product?.name || "",
          price: ci.product?.price || 0,
          thumbnailUrl: ci.product?.thumbnailUrl || ci.product?.imageUrl || "",
          size: ci.size,
          color: ci.color,
          quantity: ci.quantity,
        })),
        usedPromoCodes,
        newsletterSubscribed,
        priceDropSubs,
      });
    } catch (err: any) {
      console.error("[Admin] Get user detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

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
          createdAt: u.createdAt,
          orderCount: userOrders.length,
          totalSpent,
          lastOrderAt: lastOrder?.createdAt || null,
        };
      });

      res.json({ users: result });
    } catch (err: any) {
      console.error("[Admin] Get wholesale users error:", err);
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
      console.error("[Admin] Get wholesale user detail error:", err);
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
      console.log(`[Admin] Password changed for wholesale user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Admin] Set wholesale password error:", err);
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
      console.error("[Wholesale] Final invoice error:", err.message);
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
      console.error("[Wholesale] Download final invoice error:", err.message);
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
            },
          };
        });

      res.json({ orders: wholesaleOrders, total: wholesaleOrders.length });
    } catch (err: any) {
      console.error("[Admin] Get wholesale preorder orders error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Public: Get subscription promo settings (for homepage/popup display)
  app.get("/api/subscription-promos", async (req, res) => {
    try {
      // Serve from in-memory cache when fresh — avoids ~12 YDB queries per call.
      if (subscriptionPromosCache && Date.now() < subscriptionPromosCache.expires) {
        return res.json(subscriptionPromosCache.data);
      }

      const popupPromoId = await storage.getBonusSetting("popup_promo_id");
      const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
      const popupEnabled = (await storage.getBonusSetting("popup_enabled")) || "true";
      
      const allPromos = await storage.getPromoCodes();
      
      const popupPromo = popupPromoId 
        ? allPromos.find((p: any) => String(p.id) === popupPromoId)
        : allPromos.find((p: any) => p.code === "WELCOME10");
      const homepagePromo = homepagePromoId 
        ? allPromos.find((p: any) => String(p.id) === homepagePromoId)
        : allPromos.find((p: any) => p.code === "WELCOME7");
      
      // New customization fields
      const popupTitle = (await storage.getBonusSetting("popup_title")) || "ЭКСКЛЮЗИВНОЕ ПРЕДЛОЖЕНИЕ";
      const popupSubtitle = (await storage.getBonusSetting("popup_subtitle")) || "NEW_MEMBER_BONUS";
      const popupDescription = (await storage.getBonusSetting("popup_description")) || "Скидка на первый заказ при подписке на рассылку. Будьте первыми, кто узнаёт о новых дропах.";
      const popupButtonText = (await storage.getBonusSetting("popup_button_text")) || "ПОЛУЧИТЬ СКИДКУ";
      const popupSuccessTitle = (await storage.getBonusSetting("popup_success_title")) || "ДОБРО ПОЖАЛОВАТЬ!";
      const popupSuccessText = (await storage.getBonusSetting("popup_success_text")) || "Ваш промокод на скидку";
      const popupDelay = parseInt((await storage.getBonusSetting("popup_delay")) || "4000");
      const popupPlaceholder = (await storage.getBonusSetting("popup_placeholder")) || "Ваш email";
      const popupCloseText = (await storage.getBonusSetting("popup_close_text")) || "Продолжить покупки";

      // Return only public info (code, discount, isActive)
      const payload = {
        popup: popupPromo ? {
          code: popupPromo.code,
          discountPercent: popupPromo.discountPercent,
          isActive: popupPromo.isActive,
          enabled: popupEnabled === "true",
          settings: {
            title: popupTitle,
            subtitle: popupSubtitle,
            description: popupDescription,
            buttonText: popupButtonText,
            successTitle: popupSuccessTitle,
            successText: popupSuccessText,
            delay: popupDelay,
            placeholder: popupPlaceholder,
            closeText: popupCloseText
          }
        } : null,
        homepage: homepagePromo ? {
          code: homepagePromo.code,
          discountPercent: homepagePromo.discountPercent,
          isActive: homepagePromo.isActive
        } : null
      };

      subscriptionPromosCache = {
        data: payload,
        expires: Date.now() + SUBSCRIPTION_PROMOS_TTL_MS,
      };

      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get popup promo settings
  app.get("/api/admin/popup-promo", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const popupPromoId = await storage.getBonusSetting("popup_promo_id");
      const homepagePromoId = await storage.getBonusSetting("homepage_promo_id");
      const popupEnabled = (await storage.getBonusSetting("popup_enabled")) || "true";
      
      const allPromos = await storage.getPromoCodes();
      
      const popupPromo = popupPromoId 
        ? allPromos.find((p: any) => String(p.id) === popupPromoId)
        : allPromos.find((p: any) => p.code === "WELCOME10");
      const homepagePromo = homepagePromoId 
        ? allPromos.find((p: any) => String(p.id) === homepagePromoId)
        : allPromos.find((p: any) => p.code === "WELCOME7");
      
      const settings = {
        enabled: popupEnabled === "true",
        title: (await storage.getBonusSetting("popup_title")) || "ЭКСКЛЮЗИВНОЕ ПРЕДЛОЖЕНИЕ",
        subtitle: (await storage.getBonusSetting("popup_subtitle")) || "NEW_MEMBER_BONUS",
        description: (await storage.getBonusSetting("popup_description")) || "Скидка на первый заказ при подписке на рассылку. Будьте первыми, кто узнаёт о новых дропах.",
        buttonText: (await storage.getBonusSetting("popup_button_text")) || "ПОЛУЧИТЬ СКИДКУ",
        successTitle: (await storage.getBonusSetting("popup_success_title")) || "ДОБРО ПОЖАЛОВАТЬ!",
        successText: (await storage.getBonusSetting("popup_success_text")) || "Ваш промокод на скидку",
        delay: parseInt((await storage.getBonusSetting("popup_delay")) || "4000"),
        placeholder: (await storage.getBonusSetting("popup_placeholder")) || "Ваш email",
        closeText: (await storage.getBonusSetting("popup_close_text")) || "Продолжить покупки",
      };

      res.json({ 
        popup: popupPromo || null, 
        homepage: homepagePromo || null,
        settings
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Update popup promo code settings
  app.put("/api/admin/popup-promo", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { popup, homepage, settings } = req.body;
      
      // Update popup promo by ID (not by code - code may have been changed)
      if (popup && popup.id) {
        await storage.updatePromoCode(popup.id, {
          code: popup.code,
          discountPercent: popup.discountPercent,
          isActive: popup.isActive,
        });
      }
      
      // Update homepage promo by ID
      if (homepage && homepage.id) {
        await storage.updatePromoCode(homepage.id, {
          code: homepage.code,
          discountPercent: homepage.discountPercent,
          isActive: homepage.isActive,
        });
      }

      if (settings) {
        const settingKeys = {
          enabled: "popup_enabled",
          title: "popup_title",
          subtitle: "popup_subtitle",
          description: "popup_description",
          buttonText: "popup_button_text",
          successTitle: "popup_success_title",
          successText: "popup_success_text",
          delay: "popup_delay",
          placeholder: "popup_placeholder",
          closeText: "popup_close_text"
        };

        for (const [key, value] of Object.entries(settings)) {
          const dbKey = settingKeys[key as keyof typeof settingKeys];
          if (dbKey) {
            await storage.setBonusSetting(dbKey, String(value));
          }
        }
      }

      invalidateSubscriptionPromosCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get user's gift cards (by email)
  app.get("/api/gift-cards/my", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) {
        return res.status(400).json({ error: "Email обязателен" });
      }
      
      const cards = await storage.getGiftCardsByEmail(email);
      res.json(cards.map(card => ({
        id: card.id,
        code: card.code,
        amount: card.amount,
        balance: card.balance,
        status: card.status,
        expiresAt: card.expiresAt,
        createdAt: card.createdAt,
      })));
    } catch (err: any) {
      console.error("[GiftCards] Get my cards error:", err);
      res.status(500).json({ error: "Ошибка получения карт" });
    }
  });

  // Admin: Activate gift card after payment confirmation
  app.post("/api/gift-cards/:id/activate", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const { paymentId, paymentMethod } = req.body;
      
      const card = await storage.getGiftCardById(id);
      if (!card) {
        return res.status(404).json({ error: "Карта не найдена" });
      }
      
      const updated = await storage.updateGiftCard(id, {
        status: "active",
        paymentId: paymentId || null,
        paymentMethod: paymentMethod || null,
      });
      
      console.log(`[GiftCards] Activated card ${card.code} for ${card.amount / 100} RUB`);
      
      if (card.purchaserEmail) {
        try {
          const purchaserHtml = getGiftCardPaidEmailHtml(
            card.purchaserName || 'Покупатель',
            card.code,
            card.amount,
            card.recipientName,
            card.recipientEmail,
            card.message,
            (card as any).cardColor || 'black'
          );
          await sendEmail({
            to: card.purchaserEmail,
            subject: `Подарочная карта BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
            html: purchaserHtml
          });
          if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
            const recipientHtml = getGiftCardReceivedEmailHtml(
              card.recipientName || 'Друг',
              card.purchaserName || 'Друг',
              card.code,
              card.amount,
              card.message,
              (card as any).cardColor || 'black'
            );
            await sendEmail({
              to: card.recipientEmail,
              subject: `Вам подарили подарочную карту BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
              html: recipientHtml
            });
          }
        } catch (emailErr: any) {
          console.error(`[GiftCards] Failed to send activation email:`, emailErr.message);
        }
      }
      
      res.json({ success: true, card: updated });
    } catch (err: any) {
      console.error("[GiftCards] Activate error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/gift-cards/:id/resend-email", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const id = parseInt(req.params.id);
      const card = await storage.getGiftCardById(id);
      if (!card) {
        return res.status(404).json({ error: "Карта не найдена" });
      }
      if (card.status !== "active") {
        return res.status(400).json({ error: "Карта не активна" });
      }
      
      const sent: string[] = [];
      if (card.purchaserEmail) {
        const purchaserHtml = getGiftCardPaidEmailHtml(
          card.purchaserName || 'Покупатель',
          card.code,
          card.amount,
          card.recipientName,
          card.recipientEmail,
          card.message,
          (card as any).cardColor || 'black'
        );
        await sendEmail({
          to: card.purchaserEmail,
          subject: `Подарочная карта BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽ оплачена`,
          html: purchaserHtml
        });
        sent.push(card.purchaserEmail);
      }
      if (card.recipientEmail && card.recipientEmail !== card.purchaserEmail) {
        const recipientHtml = getGiftCardReceivedEmailHtml(
          card.recipientName || 'Друг',
          card.purchaserName || 'Друг',
          card.code,
          card.amount,
          card.message,
          (card as any).cardColor || 'black'
        );
        await sendEmail({
          to: card.recipientEmail,
          subject: `Вам подарили подарочную карту BOOOMERANGS на ${(card.amount / 100).toLocaleString('ru-RU')} ₽!`,
          html: recipientHtml
        });
        sent.push(card.recipientEmail);
      }
      
      console.log(`[GiftCards] Resent emails for card ${card.code} to: ${sent.join(', ')}`);
      res.json({ success: true, sentTo: sent });
    } catch (err: any) {
      console.error("[GiftCards] Resend email error:", err);
      res.status(500).json({ error: err.message });
    }
  });

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
      console.error("[WholesaleFeed] get-products error:", err);
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
      console.error("[WholesaleFeed] add error:", err);
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
      console.error("[WholesaleFeed] delete error:", err);
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
      console.error("[WholesaleFeed] xml error:", err);
      res.status(500).type("text").send("Internal error");
    }
  });

  // ==================== Wholesale Preorder Routes ====================

  app.get("/api/wholesale-preorder/slides", async (_req, res) => {
    try {
      const raw = await storage.getBonusSetting("wholesale_slides");
      const slides: string[] = raw ? JSON.parse(raw) : [];
      res.json({ slides });
    } catch (err: any) {
      console.error("[WholesalePreorder] Get slides error:", err.message);
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
      console.log(`[Admin] Wholesale slide uploaded: ${url}`);
      res.json({ success: true, url, slides });
    } catch (err: any) {
      console.error("[Admin] Upload slide error:", err.message);
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

  // Dadata proxy routes (address and party/INN autocomplete)
  app.post("/api/dadata/address", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 7 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/dadata/party", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 5 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Подсказка банка по БИК (для автозаполнения банковских реквизитов партнёра)
  app.post("/api/dadata/bank", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 5 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/bank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Public endpoint: текст активной версии юридического документа.
  // Используется на странице регистрации партнёра и admin-просмотрщиком.
  app.get("/api/legal-documents/:slug", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    try {
      const doc = await storage.getActiveLegalDocument(req.params.slug);
      if (!doc) return res.status(404).json({ error: "Документ не найден" });
      res.json({
        id: doc.id,
        slug: doc.slug,
        version: doc.version,
        title: doc.title,
        body: doc.body,
        bodyHash: doc.bodyHash,
        createdAt: doc.createdAt,
      });
    } catch (e: any) {
      console.error("[Legal Public]", e);
      res.status(500).json({ error: e?.message || "Ошибка загрузки документа" });
    }
  });

  app.get("/api/wholesale-preorder/products", async (_req, res) => {
    try {
      const products = await storage.getWholesalePreorderProducts();
      res.json(products);
    } catch (err: any) {
      console.error("[WholesalePreorder] Get products error:", err.message);
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
      console.error("[WholesalePreorder] Toggle error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== Preorder Routes ====================

  app.get("/api/preorder/products", async (_req, res) => {
    try {
      const products = await storage.getPreorderProducts();
      res.json(products);
    } catch (err: any) {
      console.error("[Preorder] Get products error:", err.message);
      res.status(500).json({ error: "Failed to get preorder products" });
    }
  });

  app.post("/api/preorder/order", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Для оформления предзаказа необходимо авторизоваться" });
      }

      const { productId, color, customerName, customerEmail, customerPhone, customerLastName, customerFirstName, customerMiddleName, address, paymentMethod, items: reqItems, cdekPointCode, cdekCityCode, cdekTariffCode, cdekPointAddress, cdekDeliverySum } = req.body;
      if (!productId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!customerLastName?.trim() || !customerFirstName?.trim()) {
        return res.status(400).json({ error: "Необходимо указать фамилию и имя" });
      }
      if (!customerEmail?.trim() || !customerEmail.includes("@")) {
        return res.status(400).json({ error: "Необходимо указать корректный email" });
      }
      const fullName = [customerLastName?.trim(), customerFirstName?.trim(), customerMiddleName?.trim()].filter(Boolean).join(" ");
      const finalName = fullName || customerName || user?.name || user?.email || "Клиент";
      const finalEmail = customerEmail?.trim() || user?.email || "";
      const finalPhone = customerPhone || user?.phone || "";

      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ error: "Товар не найден" });
      if (!(product as any).preorderEnabled) return res.status(400).json({ error: "Предзаказ для этого товара недоступен" });
      if ((product as any).preorderStatus !== "collecting") return res.status(400).json({ error: "Сбор предзаказов завершён" });

      const deadline = (product as any).preorderDeadline;
      if (deadline && new Date(deadline) < new Date()) {
        return res.status(400).json({ error: "Срок приёма предзаказов истёк. Следите за обновлениями — возможно, будет новый сбор!" });
      }

      const sizeItems: Array<{ size?: string; quantity: number }> = Array.isArray(reqItems) && reqItems.length > 0
        ? reqItems.filter((i: any) => i.quantity > 0)
        : [{ size: undefined, quantity: 1 }];

      const totalQty = sizeItems.reduce((s: number, i: any) => s + i.quantity, 0);
      const deliveryCost = cdekDeliverySum ? Number(cdekDeliverySum) : 0;
      const totalPrice = product.price * totalQty + deliveryCost;

      const orderItems = sizeItems.map((item: any) => {
        const sizeCharIds = (product as any).sizeCharacteristicIds as Record<string, string> | null | undefined;
        const sizeCharGuid = (item.size && sizeCharIds) ? (sizeCharIds[item.size] || null) : null;
        return {
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          price: product.price,
          size: item.size || undefined,
          color: color || undefined,
          sizeCharacteristicId: sizeCharGuid || undefined,
          imageUrl: (product as any).images?.[0] || product.imageUrl || '',
        };
      });

      const order = await storage.createOrder({
        sessionId: req.sessionID || `preorder-${Date.now()}`,
        customerName: finalName,
        customerEmail: finalEmail,
        customerPhone: finalPhone,
        address: address || '',
        items: orderItems,
        total: totalPrice,
        userId: user?.id,
      });

      await storage.updateOrderPreorderFields(order.id, {
        isPreorder: true,
        depositPaid: false,
        remainingAmount: 0,
      });

      if (cdekPointCode || cdekCityCode) {
        const cdekData = JSON.stringify({
          pointCode: cdekPointCode || undefined,
          cityCode: cdekCityCode ? Number(cdekCityCode) : undefined,
          tariffCode: cdekTariffCode ? Number(cdekTariffCode) : 136,
          pointAddress: cdekPointAddress || undefined,
          deliveryCost: deliveryCost || undefined,
        });
        await storage.updateOrderCdekData(order.id, cdekData);
      }

      let paymentUrl: string | undefined;
      let preorderConfirmationToken: string | undefined;
      const baseUrl = process.env.APP_DOMAIN || `https://${req.get('host')}`;

      const chosenMethod = paymentMethod || (paymentService.isTBankEnabled() ? "tbank" : "yookassa");
      const useMethod = chosenMethod === "yookassa" && paymentService.isYooKassaEnabled() ? "yookassa"
        : chosenMethod === "tbank" && paymentService.isTBankEnabled() ? "tbank"
        : paymentService.isTBankEnabled() ? "tbank"
        : paymentService.isYooKassaEnabled() ? "yookassa"
        : null;

      if (useMethod) {
        const preorderReceiptItems = orderItems.map((item: any) => ({
          name: item.productName,
          quantity: item.quantity,
          price: item.price,
        }));
        if (deliveryCost > 0) {
          preorderReceiptItems.push({ name: "Доставка", quantity: 1, price: deliveryCost });
        }
        const paymentResult = await paymentService.createPayment({
          amount: totalPrice,
          description: `Предзаказ #${order.id}`,
          orderId: `PREORDER-${order.id}`,
          returnUrl: `${baseUrl}/order-success/${order.id}`,
          paymentMethod: useMethod,
          useWidget: useMethod === "yookassa",
          receiptEmail: finalEmail,
          receiptItems: preorderReceiptItems,
        });

        if (paymentResult.success && paymentResult.confirmationToken) {
          preorderConfirmationToken = paymentResult.confirmationToken;
          if (paymentResult.paymentId) {
            await storage.updateOrderPaymentId(order.id, paymentResult.paymentId);
          }
        } else if (paymentResult.success && paymentResult.confirmationUrl) {
          paymentUrl = paymentResult.confirmationUrl;
          if (paymentResult.paymentId) {
            await storage.updateOrderPaymentId(order.id, paymentResult.paymentId);
          }
        }
      }

      if (!paymentUrl && !preorderConfirmationToken) {
        console.error("[Preorder] Payment not generated for order", order.id);
        return res.status(500).json({ error: "Не удалось инициировать оплату. Попробуйте позже." });
      }

      res.status(201).json({ orderId: order.id, paymentUrl, confirmationToken: preorderConfirmationToken, isPreorder: true });
    } catch (err: any) {
      console.error("[Preorder] Create order error:", err.message);
      res.status(500).json({ error: "Произошла ошибка при создании предзаказа. Попробуйте позже." });
    }
  });

  app.post("/api/preorder/:orderId/pay-remaining", authMiddleware, async (req: any, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const { paymentMethod } = req.body || {};
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!(order as any).isPreorder) return res.status(400).json({ error: "Not a preorder" });
      if (!(order as any).depositPaid) return res.status(400).json({ error: "Deposit not yet paid" });

      const remainingAmount = (order as any).remainingAmount || Math.round(order.total / 2);
      if (remainingAmount <= 0) return res.status(400).json({ error: "No remaining amount" });

      const items = Array.isArray(order.items) ? order.items : JSON.parse(String(order.items) || '[]');
      const productId = items[0]?.productId;
      if (productId) {
        const product = await storage.getProduct(productId);
        if (product) {
          const status = (product as any).preorderStatus;
          if (status !== "production" && status !== "shipping") {
            return res.status(400).json({ error: "Remaining payment is not available yet" });
          }
        }
      }

      let paymentUrl: string | undefined;
      let remainConfirmationToken: string | undefined;
      const baseUrl = process.env.APP_DOMAIN || `https://${req.get('host')}`;

      const chosenMethod = paymentMethod || (paymentService.isTBankEnabled() ? "tbank" : "yookassa");
      const useMethod = chosenMethod === "yookassa" && paymentService.isYooKassaEnabled() ? "yookassa"
        : chosenMethod === "tbank" && paymentService.isTBankEnabled() ? "tbank"
        : paymentService.isTBankEnabled() ? "tbank"
        : paymentService.isYooKassaEnabled() ? "yookassa"
        : null;

      if (useMethod) {
        const remainReceiptItems = [{ name: `Предзаказ #${orderId} — остаток`, quantity: 1, price: remainingAmount }];
        const paymentResult = await paymentService.createPayment({
          amount: remainingAmount,
          description: `Предзаказ #${orderId} — остаток оплаты`,
          orderId: `PREORDER-REMAINING-${orderId}`,
          returnUrl: `${baseUrl}/order-success/${orderId}`,
          paymentMethod: useMethod,
          useWidget: useMethod === "yookassa",
          receiptEmail: order.customerEmail,
          receiptItems: remainReceiptItems,
        });
        if (paymentResult.success && paymentResult.confirmationToken) {
          remainConfirmationToken = paymentResult.confirmationToken;
          if (paymentResult.paymentId) {
            await storage.updateOrderPreorderFields(orderId, { preorderPaymentId: paymentResult.paymentId });
          }
        } else if (paymentResult.success && paymentResult.confirmationUrl) {
          paymentUrl = paymentResult.confirmationUrl;
          if (paymentResult.paymentId) {
            await storage.updateOrderPreorderFields(orderId, { preorderPaymentId: paymentResult.paymentId });
          }
        }
      }

      if (!paymentUrl && !remainConfirmationToken) return res.status(500).json({ error: "Payment creation failed" });
      res.json({ paymentUrl, confirmationToken: remainConfirmationToken, remainingAmount });
    } catch (err: any) {
      console.error("[Preorder] Pay remaining error:", err.message);
      res.status(500).json({ error: "Failed to create remaining payment" });
    }
  });

  app.get("/api/preorder/my-orders", authMiddleware, async (req: any, res) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "Not authenticated" });
      const orders = await storage.getPreorderOrdersByUser(req.user.id);

      const enrichedOrders = await Promise.all(orders.map(async (order: any) => {
        const items = Array.isArray(order.items) ? order.items : JSON.parse(String(order.items) || '[]');
        const productId = items[0]?.productId;
        let productPreorder = null;
        if (productId) {
          const product = await storage.getProduct(productId);
          if (product) {
            productPreorder = {
              preorderGoal: (product as any).preorderGoal || 0,
              preorderCurrent: (product as any).preorderCurrent || 0,
              preorderDeadline: (product as any).preorderDeadline || null,
              preorderProductionDate: (product as any).preorderProductionDate || null,
              preorderShippingDate: (product as any).preorderShippingDate || null,
              preorderStatus: (product as any).preorderStatus || null,
              productName: product.name,
              productImage: (product as any).images?.[0] || product.imageUrl || '',
            };
          }
        }
        let parsedCdekData: any = {};
        try {
          const raw = order.cdekData;
          if (raw) {
            parsedCdekData = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
        } catch {}
        const orderPreorderStatus = parsedCdekData?.preorderStatus || null;
        return { ...order, productPreorder, orderPreorderStatus };
      }));

      res.set('Cache-Control', 'no-store').json(enrichedOrders);
    } catch (err: any) {
      console.error("[Preorder] My orders error:", err.message);
      res.status(500).json({ error: "Failed to get preorder orders" });
    }
  });

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

      console.log(`[Wholesale Preorder] Created order #${order.id} for user ${user.id} (${customerEmail}), total: ${total / 100} ₽`);

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
      storage.saveOrderInvoiceNumber(order.id, preorderInvoiceNum).catch(err => console.error('[Wholesale Preorder] Failed to save invoice number:', err));
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
      }).catch(err => console.error("[Wholesale Preorder] Failed to send invoice:", err));

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
      console.error("[Wholesale Preorder] Error:", err.message);
      return res.status(500).json({ error: "Не удалось создать заявку. Попробуйте ещё раз." });
    }
  });

  app.get("/api/admin/preorder/orders", async (req: any, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const allOrders = await storage.getOrders();
      const preorderOrders = allOrders.filter((o: any) => o.isPreorder === true);

      const productCache: Record<number, any> = {};
      const userCache: Record<string, any> = {};

      const parsedOrders = preorderOrders.map((order: any) => {
        const items = Array.isArray(order.items) ? order.items : JSON.parse(String(order.items) || '[]');
        return { order, items, productId: items[0]?.productId, userId: order.userId };
      });

      const uniqueProductIds = [...new Set(parsedOrders.map(o => o.productId).filter(Boolean))] as number[];
      const uniqueUserIds = [...new Set(parsedOrders.map(o => o.userId).filter(Boolean).map(String))] as string[];

      // allSettled — one failed product lookup must not nuke the whole list.
      const productResults = await Promise.allSettled(uniqueProductIds.map(async (pid) => {
        const p = await storage.getProduct(pid);
        if (p) {
          productCache[pid] = {
            id: p.id, name: p.name, price: p.price,
            thumbnailUrl: (p as any).thumbnailUrl || p.imageUrl,
            preorderGoal: (p as any).preorderGoal || 0,
            preorderCurrent: (p as any).preorderCurrent || 0,
            preorderStatus: (p as any).preorderStatus || "collecting",
            preorderDeadline: (p as any).preorderDeadline || null,
          };
        }
      }));
      const failedProducts = productResults.filter(r => r.status === 'rejected');
      if (failedProducts.length) {
        console.warn(`[Preorder] ${failedProducts.length}/${productResults.length} product lookups failed`);
      }

      await Promise.all(uniqueUserIds.map(async (uid) => {
        try {
          const user = await authStorage.getUserById(Number(uid));
          if (user) userCache[uid] = user;
        } catch {}
      }));

      const enriched = parsedOrders.map(({ order, items, productId, userId }) => {
        const product = productId ? productCache[productId] || null : null;
        const cached = userId ? userCache[String(userId)] : null;
        // Order form data takes priority over account data
        const customerName = order.customerName || cached?.name || cached?.email || "Unknown";
        const customerEmail = order.customerEmail || cached?.email || "";
        const customerPhone = order.customerPhone || (cached as any)?.phone || "";
        let cdekInfo: any = null;
        if (order.cdekData) {
          try { cdekInfo = JSON.parse(typeof order.cdekData === 'string' ? order.cdekData : JSON.stringify(order.cdekData)); } catch {}
        }
        return {
          orderId: order.id, userId: userId || null,
          customerName, customerEmail, customerPhone,
          address: order.address || "", total: order.total,
          depositPaid: order.depositPaid || false, remainingAmount: order.remainingAmount || 0,
          status: order.status, createdAt: order.createdAt,
          size: items[0]?.size || null, color: items[0]?.color || null, product,
          orderItems: items.map((i: any) => ({ size: i.size || null, quantity: i.quantity || 1, price: i.price || 0 })),
          cdekPointAddress: cdekInfo?.pointAddress || null,
          cdekCity: cdekInfo?.cityName || null,
          cdekDeliveryCost: cdekInfo?.deliveryCost || null,
          cdekTrackNumber: cdekInfo?.cdekNumber || cdekInfo?.trackNumber || null,
          orderPreorderStatus: cdekInfo?.preorderStatus || null,
        };
      });

      const userMap: Record<string, { userName: string; userEmail: string; userPhone: string; orders: any[] }> = {};
      for (const o of enriched) {
        const key = o.customerEmail || o.customerName || String(o.orderId);
        if (!userMap[key]) {
          userMap[key] = { userName: o.customerName, userEmail: o.customerEmail, userPhone: o.customerPhone, orders: [] };
        }
        userMap[key].orders.push(o);
      }

      const users = Object.values(userMap).sort((a, b) => b.orders.length - a.orders.length);

      const totalDeposits = enriched.filter(o => o.status === "paid").reduce((sum, o) => sum + o.total, 0);
      const totalRemaining = enriched.filter(o => o.depositPaid && o.status !== "paid").reduce((sum, o) => sum + (o.remainingAmount || Math.round(o.total / 2)), 0);

      res.json({
        orders: enriched,
        users,
        totalOrders: enriched.length,
        totalUsers: users.length,
        totalDeposits,
        totalRemaining,
        paidFull: enriched.filter(o => o.status === "paid").length,
        depositOnly: enriched.filter(o => o.depositPaid && o.status !== "paid").length,
      });
    } catch (err: any) {
      console.error("[Admin] Get preorder orders error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/preorder/order/:orderId/status", async (req: any, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orderId = Number(req.params.orderId);
      const { status } = req.body;
      const validStatuses = ["production", "shipping", "shipped", "cancelled"];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Save per-order preorder status into cdekData
      let cdekInfo: any = {};
      if (order.cdekData) { try { cdekInfo = JSON.parse(order.cdekData); } catch {} }
      cdekInfo.preorderStatus = status;
      await storage.updateOrderCdekData(orderId, JSON.stringify(cdekInfo));

      // Get product name for email
      const items = Array.isArray(order.items) ? order.items : (() => { try { return JSON.parse(String(order.items || '[]')); } catch { return []; } })();
      const productId = items[0]?.productId;
      const product = productId ? await storage.getProduct(productId) : null;
      const productName = product?.name || "Предзаказ";

      // Send email to this customer
      const notifyStatuses = ["production", "shipping", "shipped", "cancelled"];
      if (notifyStatuses.includes(status) && order.customerEmail) {
        const siteUrl = process.env.SITE_URL || "https://booomerangs.ru";
        const html = getPreorderStatusEmailHtml({
          customerName: order.customerName || "Покупатель",
          productName,
          newStatus: status,
          trackNumber: cdekInfo?.cdekNumber || cdekInfo?.trackNumber || undefined,
          pointAddress: cdekInfo?.pointAddress || undefined,
          productUrl: productId ? `${siteUrl}/products/${productId}` : siteUrl,
        });
        const subjectMap: Record<string, string> = {
          production: `Ваш предзаказ в производстве — ${productName}`,
          shipping: `Ваш предзаказ готовится к отправке — ${productName}`,
          shipped: `Ваш предзаказ отправлен — ${productName}`,
          cancelled: `Предзаказ отменён — ${productName}`,
        };
        sendEmail({ to: order.customerEmail, subject: subjectMap[status], html })
          .then(ok => console.log(`[Preorder] Per-order status email to ${order.customerEmail}: ${ok ? 'OK' : 'FAIL'}`))
          .catch(err => console.error(`[Preorder] Per-order email error:`, err.message));
      }

      // If shipping — create CDEK waybill for this order only
      if (status === "shipping") {
        createCdekWaybillForOrder(orderId).then(r => {
          console.log(`[Preorder] Per-order waybill #${orderId}: ${r.success ? 'OK uuid=' + r.uuid : 'FAIL ' + r.error}`);
        }).catch(err => console.error(`[Preorder] Per-order waybill error:`, err.message));
      }

      // Also update order status to "processing" when shipping starts
      if (status === "shipping" && order.status === "paid") {
        await storage.updateOrderStatus(orderId, "processing");
      }

      console.log(`[Preorder] Per-order status set for order #${orderId}: ${status}`);
      res.json({ success: true, orderId, status });
    } catch (err: any) {
      console.error("[Preorder] Per-order status error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/preorder/:productId/status", async (req: any, res) => {
    try {
      const productId = Number(req.params.productId);
      const { status } = req.body;
      const validStatuses = ["collecting", "production", "shipping", "shipped", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ error: "Product not found" });

      const oldStatus = (product as any).preorderStatus || "collecting";
      if (status === oldStatus) {
        return res.json({ success: true, oldStatus, newStatus: status });
      }
      await storage.updatePreorderStatus(productId, status);

      notifyPreorderStatusChange(product.name, productId, oldStatus, status);
      vkNotifyPreorderStatusChange(product.name, productId, oldStatus, status);

      const allOrders = await storage.getOrders();
      const preorderOrders = allOrders.filter((o: any) => o.isPreorder === true && ["paid", "processing", "shipped", "delivered"].includes(o.status));
      const productOrders = preorderOrders.filter((o: any) => {
        const items = Array.isArray(o.items) ? o.items : (() => { try { return JSON.parse(String(o.items || '[]')); } catch { return []; } })();
        return items.some((i: any) => i.productId === productId);
      });

      // Send status change email to each customer (only for statuses customers care about)
      const notifyStatuses = ["production", "shipping", "shipped", "cancelled"];
      if (notifyStatuses.includes(status)) {
        const siteUrl = process.env.SITE_URL || "https://booomerangs.ru";
        for (const o of productOrders) {
          const email = o.customerEmail;
          if (!email) continue;
          let cdekInfo: any = null;
          if (o.cdekData) {
            try { cdekInfo = JSON.parse(typeof o.cdekData === 'string' ? o.cdekData : JSON.stringify(o.cdekData)); } catch {}
          }
          const html = getPreorderStatusEmailHtml({
            customerName: o.customerName || "Покупатель",
            productName: product.name,
            newStatus: status,
            trackNumber: cdekInfo?.cdekNumber || cdekInfo?.trackNumber || undefined,
            pointAddress: cdekInfo?.pointAddress || undefined,
            productUrl: `${siteUrl}/products/${productId}`,
          });
          const subjectMap: Record<string, string> = {
            production: `Ваш предзаказ в производстве — ${product.name}`,
            shipping: `Ваш предзаказ готовится к отправке — ${product.name}`,
            shipped: `Ваш предзаказ отправлен — ${product.name}`,
            cancelled: `Предзаказ отменён — ${product.name}`,
          };
          sendEmail({ to: email, subject: subjectMap[status] || `Обновление предзаказа — ${product.name}`, html })
            .then(ok => console.log(`[Preorder] Status email to ${email}: ${ok ? 'OK' : 'FAIL'}`))
            .catch(err => console.error(`[Preorder] Status email error for ${email}:`, err.message));
        }
        console.log(`[Preorder] Sending status emails to ${productOrders.length} customers for status=${status}`);
      }

      if (status === "shipping") {
        console.log(`[Preorder] Triggering CDEK waybills for ${productOrders.length} orders of product ${productId}`);
        for (const o of productOrders) {
          createCdekWaybillForOrder(o.id).then(r => {
            console.log(`[Preorder] Waybill for order #${o.id}: ${r.success ? 'OK uuid=' + r.uuid : 'FAIL ' + r.error}`);
          }).catch(err => console.error(`[Preorder] Waybill error for order #${o.id}:`, err.message));
        }
      }

      console.log(`[Preorder] Status changed for product ${productId}: ${oldStatus} -> ${status}`);
      res.json({ success: true, oldStatus, newStatus: status });
    } catch (err: any) {
      console.error("[Preorder] Status update error:", err.message);
      res.status(500).json({ error: "Failed to update preorder status" });
    }
  });

  // Seed data
  if ((await storage.getProducts()).length === 0) {
    await runAutoSync();
    
    // If after 1C sync we still have no products (e.g. 1c_uploads is empty), add fallback samples
    if ((await storage.getProducts()).length === 0) {
      await storage.createProduct({
        name: "Футболка 'CHAOS'",
        description: "Оверсайз футболка с фирменным принтом CHAOS. 100% хлопок.",
        price: 3500,
        imageUrl: "/attached_assets/generated_images/oversized_black_t-shirt_streetwear.png",
        category: "Футболки",
        sizes: ["S", "M", "L", "XL"],
        colors: ["Черный", "Белый"],
        isNew: true
      });
      // ... other samples
    }
  }

  const ADMIN_EMAILS = ['dmitrij.sob@mail.ru', 'pimashin2015@gmail.com'];
  (async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      for (const email of ADMIN_EMAILS) {
        try {
          const ok = await authStorage.setUserRoleByEmail(email, 'admin');
          if (ok) console.log(`[Admin] Role 'admin' set for ${email}`);
        } catch (err: any) {
          console.error(`[Admin] Failed to set role for ${email}:`, err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err: any) {
      console.error("[Admin] Init error:", err.message);
    }
  })();

  return httpServer;
}
