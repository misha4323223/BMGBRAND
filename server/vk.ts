import crypto from "crypto";
import { logError } from "./logger";
import { storage } from "./storage";

const SITE_URL = process.env.SITE_URL || "https://www.booomerangs.ru";
const VK_MAX_LENGTH = 4000;
const LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getConfig() {
  const groupToken = process.env.VK_GROUP_TOKEN || "";
  return {
    // Приоритет у ключа доступа сообщества: он не зависит от лимитов user-токенов
    // (новые правила VK API от 07.09.2026) и не истекает через час, как VK ID токен.
    // Отправка при этом идёт от имени сообщества.
    token: groupToken || process.env.VK_USER_TOKEN || "",
    isCommunity: !!groupToken,
    groupId: process.env.VK_GROUP_ID || "",
    peerId: process.env.VK_CHAT_PEER_ID || "",
    secret: process.env.VK_ACTION_SECRET || "",
  };
}

function randomId(): number {
  return Math.floor(Math.random() * 2147483647);
}

// ── Flood control guard ──
// С 07.09.2026 VK ограничил API для сторонних интеграций: лимит вызовов на аккаунт
// в Кабинете для бизнеса VK ID (10 000/мес без верификации бизнес-профиля).
// При превышении VK отдаёт code 9 «Flood control» на ЛЮБОЙ метод. Продолжать слать
// запросы бессмысленно — это расходует остаток лимита и продлевает блокировку,
// поэтому при первом же code 9 ставим паузу и молчим.
const VK_FLOOD_PAUSE_MS = 30 * 60 * 1000; // 30 минут тишины
let vkFloodPausedUntil = 0;

function isVkFloodPaused(): boolean {
  return Date.now() < vkFloodPausedUntil;
}

function markVkFlood(context: string, code: number, msg: string): void {
  vkFloodPausedUntil = Date.now() + VK_FLOOD_PAUSE_MS;
  logError(
    `[VK] Flood control (code ${code}) в ${context}: "${msg}" — пауза ${VK_FLOOD_PAUSE_MS / 60000} мин, запросы к VK приостановлены`
  );
}

function plain(text: string): string {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<b>(.*?)<\/b>/gs, "$1")
    .replace(/<i>(.*?)<\/i>/gs, "$1")
    .replace(/<code>(.*?)<\/code>/gs, "$1")
    .replace(/<[^>]+>/g, "");
}

export function generateActionLink(act: string, id: number): string {
  const { secret } = getConfig();
  const exp = Math.floor(Date.now() / 1000) + LINK_EXPIRY_SECONDS;
  const payload = `${act}:${id}:${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${SITE_URL}/api/vk-action?act=${act}&id=${id}&exp=${exp}&sig=${sig}`;
}

export function verifyActionLink(act: string, id: string, exp: string, sig: string): boolean {
  const { secret } = getConfig();
  if (!secret) {
    logError("[VK] VK_ACTION_SECRET not configured — rejecting action link");
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(exp) < now) return false;
  const payload = `${act}:${id}:${exp}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

// 917 «You don't have access to this chat» / 901 «Can't send messages for users
// without permission» — не лимит и не сбой сети, а конфигурация: ключ от имени
// СООБЩЕСТВА может писать только в те чаты, где сообщество — участник. Раньше
// отправка шла от личного аккаунта (user-ключ), поэтому чужой чат открывался.
function peerAccessHint(code: number): string {
  if (code === 917 || code === 901) {
    return " — сообщество не участник этого чата: добавьте сообщество в нужный чат (ВК: чат → участники → добавить сообщество) или укажите VK_CHAT_PEER_ID того чата, где оно уже есть";
  }
  return "";
}

async function sendVkMessage(text: string): Promise<boolean> {
  const { token, peerId } = getConfig();
  if (!token || !peerId) {
    console.log("[VK] Not configured, skipping notification");
    return false;
  }

  const cleanText = plain(text);

  if (isVkFloodPaused()) {
    console.log("[VK] Skipped (flood pause active)");
    return false;
  }

  try {
    const body = new URLSearchParams({
      peer_id: peerId,
      message: cleanText,
      random_id: String(randomId()),
      access_token: token,
      v: "5.199",
    });

    const response = await fetch(`https://api.vk.ru/method/messages.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      logError("[VK] Non-JSON response:", raw.slice(0, 120));
      return false;
    }

    if (data.error) {
      if (data.error.error_code === 9) markVkFlood("messages.send", 9, data.error.error_msg);
      else logError("[VK] Send error:", data.error.error_code, data.error.error_msg + peerAccessHint(data.error.error_code), `(peer_id=${peerId})`);
      return false;
    }

    console.log("[VK] Notification sent, message_id:", data.response);
    return true;
  } catch (error: any) {
    logError("[VK] Failed to send:", error.message);
    return false;
  }
}

function price(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

function shortName(name: string): string {
  let s = name
    .replace(/^(Носки|Футболка|Худи|Толстовка|Свитшот|Шорты|Куртка|Брюки|Шапка|Панама|Кепка|Сумка|Шоппер|Ремень|Кружка)\s+/i, "$1 ")
    .replace(/BOOOMERANGS\s*/gi, "")
    .replace(/BMGbrand\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > 80) s = s.substring(0, 77) + "...";
  return s;
}

function cleanMeta(value?: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.toLowerCase() === "default") return "";
  return v;
}

interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
}

interface OrderNotification {
  orderId: number | string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address?: string;
  total: number;
  items: OrderItem[];
  paymentMethod?: string;
  isWholesale: boolean;
  promoCode?: string | null;
  transportCompany?: string;
  companyName?: string;
  inn?: string;
  deliveryService?: string;
}

export async function vkNotifyNewOrder(order: OrderNotification): Promise<boolean> {
  try {
  const discountDetails: any = (order.items as any[]).find((i: any) => i && i._discountDetails)?._discountDetails;
  const items = order.items.filter((i: any) => !i._discountDetails);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const isWh = order.isWholesale;

  let header = isWh ? `📦 ОПТ #${order.orderId}` : `🛒 #${order.orderId}`;
  header += `  •  ${order.customerName}\n`;
  header += `${order.customerPhone}  |  ${order.customerEmail}`;

  if (isWh && order.companyName) {
    header += `\n🏢 ${order.companyName}`;
    if (order.inn) header += ` (${order.inn})`;
    if (order.transportCompany) header += `  •  🚚 ${order.transportCompany}`;
  }

  if (!isWh && order.deliveryService) {
    const svcLabel = order.deliveryService === "pickup" ? "Самовывоз" : order.deliveryService === "ozon" ? "Ozon" : "СДЭК";
    header += `\n🟢 ${svcLabel}`;
  }

  if (order.address) header += `\n📍 ${order.address}`;

  const sep = "\n────────────────────\n";

  let footer = "";

  if (discountDetails && Number.isFinite(discountDetails.subtotal)) {
    const wItemDiscount = Number(discountDetails.wholesaleItemDiscountAmount) || 0;
    // When there is a per-item wholesale discount, show the original wholesale price
    // so the manager sees: "Товары: 1000 ₽ → Скидка опт: -100 ₽ → Итого: 900 ₽"
    const displaySubtotal = wItemDiscount > 0
      ? discountDetails.subtotal + wItemDiscount
      : discountDetails.subtotal;
    footer += `🛍 Товары: ${price(displaySubtotal)}\n`;

    const discParts: string[] = [];
    if (wItemDiscount > 0) {
      discParts.push(`🏷 Скидка опт (-${price(wItemDiscount)})`);
    }
    if (Number.isFinite(discountDetails.promoDiscountAmount) && discountDetails.promoDiscountAmount > 0) {
      let part = `🏷 ${discountDetails.promoCode || order.promoCode || ""}`;
      if (Number.isFinite(discountDetails.promoDiscountPercent) && discountDetails.promoDiscountPercent > 0) {
        part += ` -${discountDetails.promoDiscountPercent}%`;
      }
      part += ` (-${price(discountDetails.promoDiscountAmount)})`;
      discParts.push(part);
    }
    if (Number.isFinite(discountDetails.loyaltyDiscountAmount) && discountDetails.loyaltyDiscountAmount > 0) {
      const pct = Number.isFinite(discountDetails.loyaltyPercent) ? `-${discountDetails.loyaltyPercent}% ` : "";
      discParts.push(`⭐ Лояльность ${pct}(-${price(discountDetails.loyaltyDiscountAmount)})`);
    }
    if (Number.isFinite(discountDetails.giftCardAmount) && discountDetails.giftCardAmount > 0) {
      discParts.push(`🎁 Сертификат ${discountDetails.giftCardCode || ""} (-${price(discountDetails.giftCardAmount)})`);
    }
    if (discParts.length > 0) {
      footer += `💸 Скидка: ${discParts.join("  •  ")}\n`;
    }

    if (!isWh) {
      const dc = Number(discountDetails.deliveryCost) || 0;
      footer += `🚚 Доставка: ${dc > 0 ? price(dc) : "бесплатно"}\n`;
    }
  }

  footer += `${totalQty} шт.  •  ${price(order.total)}`;
  if (order.paymentMethod) {
    const m: Record<string, string> = { tbank: "T-Bank", yookassa: "ЮKassa", invoice: "Счёт", yandex: "Яндекс (Кнопка «Купить»)" };
    footer += `  •  ${m[order.paymentMethod] || order.paymentMethod}`;
  }
  if (!discountDetails && order.promoCode) footer += `  •  🏷 ${order.promoCode}`;

  const itemLines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const meta = [cleanMeta(it.size), cleanMeta(it.color)].filter(Boolean).join("/");
    const nm = shortName(it.productName);
    let line = `${i + 1}. ${nm}`;
    if (meta) line += ` (${meta})`;
    line += ` ×${it.quantity} ${price(it.price * it.quantity)}`;
    itemLines.push(line);
  }

  const fullText = header + sep + itemLines.join("\n") + sep + footer;

  if (fullText.length <= VK_MAX_LENGTH) {
    const ok = await sendVkMessage(fullText);
    if (ok) markOrderVkNotified(order.orderId).catch(() => {});
    return ok;
  }

  const messages: string[] = [];
  const totalPages = Math.ceil(itemLines.length / 30);
  let page = 1;
  let current = header + sep;

  for (let i = 0; i < itemLines.length; i++) {
    const line = itemLines[i] + "\n";
    if (current.length + line.length > VK_MAX_LENGTH - 60) {
      current += `\n... часть ${page}/${totalPages}`;
      messages.push(current);
      page++;
      current = `#${order.orderId} (ч. ${page})\n` + sep;
    }
    current += line;
  }
  current += sep + footer;
  messages.push(current);

  for (const msg of messages) {
    const ok = await sendVkMessage(msg);
    if (!ok) return false;
  }
  markOrderVkNotified(order.orderId).catch(() => {});
  return true;
  } catch (err: any) {
    logError("[VK] vkNotifyNewOrder failed:", err?.message);
    return false;
  }
}

/**
 * Помечает заказ как успешно уведомлённый в VK-чат.
 * Флаг хранится в существующей колонке orders.addon_data (JSON, ключ vkNotifiedAt),
 * чтобы страховочный watcher не отправлял один и тот же заказ повторно.
 * Читает свежий addon_data перед записью — не затирает параллельные записи (Ozon и т.п.).
 */
export async function markOrderVkNotified(orderId: number | string): Promise<void> {
  const nid = Number(orderId);
  if (!Number.isFinite(nid) || nid <= 0) return;
  try {
    const order = await storage.getOrder(nid);
    if (!order) return;
    let existing: Record<string, any> = {};
    try {
      existing = JSON.parse(order.addonData || "{}");
    } catch {
      existing = {};
    }
    await storage.updateOrderAddonData(nid, JSON.stringify({ ...existing, vkNotifiedAt: new Date().toISOString() }));
  } catch (err: any) {
    logError(`[VK] Failed to save vkNotifiedAt for order ${orderId}:`, err?.message);
  }
}

interface PreorderNotification {
  orderId: number | string;
  productName: string;
  customerName: string;
  customerEmail: string;
  depositAmount: number;
  totalAmount: number;
  items?: Array<{ name?: string; size?: string; color?: string; quantity: number }>;
  color?: string;
  shippingDate?: string | null;
  paymentMethod?: string;
  deliveryInfo?: string;
}

export function vkNotifyPreorderDeposit(data: PreorderNotification): void {
  let text = `🎯 ПРЕДЗАКАЗ #${data.orderId}\n`;
  if (data.items && data.items.length > 0) {
    const parts = data.items.filter(i => i.quantity > 0).map(i => {
      let part = i.name || data.productName;
      const color = i.color || data.color;
      if (color) part += ` (${color})`;
      const size = i.size && i.size !== 'OneSize' && i.size !== '(OneSize)' ? i.size : null;
      if (size) part += ` ${size}`;
      part += ` × ${i.quantity}`;
      return part;
    });
    text += parts.join(', ') + '\n';
  } else {
    text += `${data.productName}`;
    if (data.color) text += ` (${data.color})`;
    text += '\n';
  }
  text += `👤 ${data.customerName}  |  ${data.customerEmail}`;
  text += `\n💰 Оплачено: ${price(data.depositAmount)}`;
  if (data.paymentMethod) text += `\n💳 ${data.paymentMethod}`;
  if (data.deliveryInfo) text += `\n🚚 ${data.deliveryInfo}`;
  if (data.shippingDate) {
    try {
      const d = new Date(data.shippingDate);
      text += `\n📦 Отправка: ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
    } catch {}
  }

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyPreorderDeposit failed:", err));
}

export function vkNotifyPreorderGoalReached(productName: string, goal: number, productId: number): void {
  const text = `🎉 ЦЕЛЬ ПРЕДЗАКАЗА ДОСТИГНУТА!\n${productName} (ID: ${productId})\nСобрано: ${goal}/${goal} — переход в производство`;
  sendVkMessage(text).catch(err => logError("[VK] vkNotifyPreorderGoalReached failed:", err));
}

export function vkNotifyPreorderStatusChange(productName: string, productId: number, oldStatus: string, newStatus: string): void {
  const s: Record<string, string> = {
    collecting: "Сбор", funded: "Цель", production: "Производство", shipping: "Отправка", shipped: "Отправлено", cancelled: "Отмена",
  };
  const text = `🔄 Статус предзаказа\n${productName} (ID: ${productId})\n${s[oldStatus] || oldStatus} → ${s[newStatus] || newStatus}`;
  sendVkMessage(text).catch(err => logError("[VK] vkNotifyPreorderStatusChange failed:", err));
}

interface OrderCancelledNotification {
  orderId: number | string;
  isPreorder?: boolean;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  total: number;
  wasPaid: boolean;
  items?: Array<{ productName?: string; quantity?: number; size?: string; color?: string }>;
}

/**
 * Уведомление менеджерам в VK-чат о том, что покупатель сам отменил заказ/предзаказ.
 * Возврат денег менеджеры делают вручную — поэтому для оплаченных заказов явно
 * помечаем «⚠️ Оплачен — нужен ручной возврат».
 */
export function vkNotifyOrderCancelled(data: OrderCancelledNotification): void {
  const label = data.isPreorder ? "🚫 ПРЕДЗАКАЗ ОТМЕНЁН" : "❌ ЗАКАЗ ОТМЕНЁН";
  let text = `${label} #${data.orderId}\n`;
  text += `👤 ${data.customerName || "Покупатель"}`;
  if (data.customerPhone) text += `  |  ${data.customerPhone}`;
  if (data.customerEmail) text += `  |  ${data.customerEmail}`;

  const items = (data.items || []).filter((i: any) => i && i.productName);
  if (items.length > 0) {
    text += "\n────────────────────\n";
    items.forEach((it: any, idx: number) => {
      const meta = [cleanMeta(it.size), cleanMeta(it.color)].filter(Boolean).join("/");
      let line = `${idx + 1}. ${shortName(it.productName || "")}`;
      if (meta) line += ` (${meta})`;
      line += ` ×${it.quantity || 1}`;
      text += line + "\n";
    });
    text += "────────────────────\n";
  }

  text += `Сумма: ${price(data.total)}`;
  if (data.wasPaid) {
    text += "\n⚠️ Оплачен — нужен ручной возврат";
  } else {
    text += "\nНе оплачен";
  }

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyOrderCancelled failed:", err));
}

interface WholesaleRegistration {
  userId: number;
  email: string;
  contactPerson: string;
  companyName: string;
  inn: string;
  kpp?: string;
  legalAddress: string;
  storeName: string;
  storeAddress: string;
  contactPhone: string;
}

export function vkNotifyWholesaleRegistration(data: WholesaleRegistration): void {
  let text = `👔 ЗАЯВКА НА ОПТ\n\n`;
  text += `👤 ${data.contactPerson}  |  ${data.contactPhone}\n`;
  text += `✉️ ${data.email}\n`;
  text += `🏢 ${data.companyName}  |  ИНН ${data.inn}`;
  if (data.kpp) text += ` | КПП ${data.kpp}`;
  text += `\n📍 ${data.legalAddress}`;
  text += `\n🛍️ ${data.storeName} — ${data.storeAddress}`;
  text += `\n\n✅ Принять:\n${generateActionLink("wh_approve", data.userId)}`;
  text += `\n\n❌ Отклонить:\n${generateActionLink("wh_reject", data.userId)}`;

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyWholesaleRegistration failed:", err));
}

export function vkNotifyMerchOrder(data: {
  name: string;
  company?: string;
  productType: string;
  quantity: string;
  contact: string;
  message?: string;
}): void {
  const companyLine = data.company ? `\n🏢 Компания: ${data.company}` : "";
  const messageLine = data.message ? `\n💬 Комментарий: ${data.message}` : "";

  const text =
    `🎨 Новая заявка на мерч\n\n` +
    `👤 Имя: ${data.name}${companyLine}\n` +
    `📦 Товар: ${data.productType}\n` +
    `📊 Тираж: ${data.quantity}\n` +
    `📞 Контакт: ${data.contact}` +
    messageLine;

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyMerchOrder failed:", err));
}

export function vkNotifyNewReview(data: {
  authorName: string;
  rating: number;
  comment: string | null;
  productName: string;
  productId: number;
  reviewId: number;
}): void {
  const stars = "★".repeat(data.rating) + "☆".repeat(5 - data.rating);
  const commentLine = data.comment ? `\n💬 ${data.comment}` : "\n💬 Без комментария";

  let text =
    `⭐ Новый отзыв на модерации\n\n` +
    `📦 Товар: ${data.productName}\n` +
    `🌟 Оценка: ${stars} (${data.rating}/5)\n` +
    `👤 Автор: ${data.authorName}` +
    commentLine;

  // Модерация отзывов — только через админку сайта. Без action-ссылок в VK:
  // линк-превью VK выполняет GET по таким ссылкам без участия человека.
  text += `\n\n✅ Модерация отзыва — в админке сайта (раздел «Отзывы»).`;

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyNewReview failed:", err));
}

export function vkNotifyPartnerFeedback(data: {
  partnerName: string;
  partnerSlug: string;
  type: string;
  message: string;
}): void {
  const typeEmoji: Record<string, string> = { bug: "🐛", wish: "💡", other: "💬" };
  const typeLabel: Record<string, string> = { bug: "Ошибка", wish: "Пожелание", other: "Другое" };
  const emoji = typeEmoji[data.type] || "💬";
  const label = typeLabel[data.type] || "Другое";

  const text =
    `${emoji} Обратная связь от партнёра\n\n` +
    `👤 ${data.partnerName} (/r/${data.partnerSlug})\n` +
    `📌 Тип: ${label}\n\n` +
    `📝 ${data.message}`;

  sendVkMessage(text).catch(err => logError("[VK] vkNotifyPartnerFeedback failed:", err));
}

// ============================================
// VK CHAT (live chat notifications + Long Poll replies)
// ============================================

export async function sendVkChatNotification(
  sessionId: string,
  text: string,
  userName?: string,
  imageUrl?: string,
  isWholesale?: boolean
): Promise<number | null> {
  const { token, peerId } = getConfig();
  if (!token || !peerId) return null;

  const prefix = isWholesale ? '🏭 ОПТ' : '💬';
  const header = userName ? `${prefix} ${userName}:` : `${prefix} Сообщение:`;
  const body_text = imageUrl
    ? `${header}\n${text ? text + "\n" : ""}📷 ${imageUrl}`
    : `${header}\n${text}`;
  const msgText = plain(body_text).slice(0, VK_MAX_LENGTH);

  if (isVkFloodPaused()) {
    console.log("[VK Chat] Skipped (flood pause active)");
    return null;
  }

  try {
    const body = new URLSearchParams({
      peer_id: peerId,
      message: msgText,
      random_id: String(randomId()),
      access_token: token,
      v: "5.199",
    });

    const response = await fetch(`https://api.vk.ru/method/messages.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await response.json() as any;
    if (data.error) {
      if (data.error.error_code === 9) markVkFlood("messages.send (chat)", 9, data.error.error_msg);
      else logError("[VK Chat] Send error:", data.error.error_code, data.error.error_msg + peerAccessHint(data.error.error_code), `(peer_id=${peerId})`);
      return null;
    }

    const messageId = data.response as number;
    console.log(`[VK Chat] Sent for session ${sessionId.slice(0, 8)}, vk_message_id=${messageId}`);
    return messageId;
  } catch (err: any) {
    logError("[VK Chat] Failed:", err.message);
    return null;
  }
}

let longPollActive = false;

type VkReplyHandler = (
  vkMessageId: number,
  replyText: string,
  adminName: string,
  incomingMessageId?: number
) => Promise<void>;

export function startVkLongPoll(onReply: VkReplyHandler): void {
  if (longPollActive) return;
  const { token, peerId, isCommunity } = getConfig();
  if (!token || !peerId) {
    console.log("[VK LongPoll] Not configured, skipping");
    return;
  }
  if (isCommunity) {
    // С ключом сообщества работает только Bots Long Poll (groups.getLongPollServer).
    if (!getConfig().groupId) {
      console.log("[VK Bots LongPoll] VK_GROUP_TOKEN задан, но VK_GROUP_ID пуст — поллинг не запущен");
      return;
    }
    longPollActive = true;
    runBotsLongPoll(onReply, getConfig().groupId).catch(err => {
      logError("[VK Bots LongPoll] Fatal error:", err.message);
      longPollActive = false;
    });
    return;
  }
  longPollActive = true;
  runLongPoll(onReply).catch(err => {
    logError("[VK LongPoll] Fatal error:", err.message);
    longPollActive = false;
  });
}

// ── Bots Long Poll (для ключа доступа сообщества) ─────────────────────────────
// Формат событий отличается от user long poll: приходят events вида
// { type: "message_new", object: { message: { peer_id, text, reply_message } } }.
// ⚠️ С ключом сообщества этот путь работает только если в сообществе включён
// Long Poll API и выдан scope manage. Основной канал приёма — Callback API
// (server/vk-callback.ts); здесь оставлен резерв + логика маршрутизации та же.

// VK отдаёт адрес Long Poll сервера УЖЕ с протоколом (документация: «server — адрес
// сервера (начинается с https://)») — и у user-, и у bots-поллинга. Раньше код всегда
// подставлял "https://", получалось "https://https://lp.vk.com/...", хостом становилось
// "https" → undici отдавал "fetch failed" (ENOTFOUND). Теперь префикс добавляется только
// если его нет.
function lpServerUrl(server: string, query: string): string {
  const base = /^https?:\/\//i.test(server) ? server : `https://${server}`;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

async function getBotsLongPollServer(groupId: string): Promise<{ key: string; server: string; ts: string }> {
  const { token } = getConfig();
  const res = await fetch(
    `https://api.vk.ru/method/groups.getLongPollServer?group_id=${groupId}&access_token=${token}&v=5.199`
  );
  const data = await res.json() as any;
  if (data.error) {
    if (data.error.error_code === 9) markVkFlood("groups.getLongPollServer", 9, data.error.error_msg);
    throw new Error(`groups.getLongPollServer: ${data.error.error_msg}`);
  }
  return data.response;
}

async function runBotsLongPoll(
  onReply: VkReplyHandler,
  groupId: string
): Promise<void> {
  const { peerId } = getConfig();
  console.log("[VK Bots LongPoll] Starting...");

  let params: { key: string; server: string; ts: string } | null = null;
  let paramAttempts = 0;
  while (!params) {
    if (isVkFloodPaused()) {
      const wait = Math.max(1000, vkFloodPausedUntil - Date.now());
      await new Promise(r => setTimeout(r, Math.min(wait, VK_FLOOD_PAUSE_MS)));
      continue;
    }
    try {
      params = await getBotsLongPollServer(groupId);
      paramAttempts = 0;
    } catch (err: any) {
      // Код 29 «Rate limit reached» — это лимит КОНКРЕТНОГО МЕТОДА: VK считает лимиты
      // отдельно по каждому методу (проверено: при лимите на groups.getLongPollServer
      // groups.getById и messages.send отвечают нормально). Поэтому глобальную паузу
      // (markVkFlood) тут не ставим — иначе зря замолчат уведомления, которые работают.
      // Но и «retry in 5min» бесконечно — плохо: пока метод в лимите, повторы не дают
      // ему отпустить. Удваиваем паузу: 5 → 10 → 20 → 30 мин (потолок).
      const delayMs = Math.min(5 * 60_000 * Math.pow(2, paramAttempts), 30 * 60_000);
      paramAttempts++;
      logError("[VK Bots LongPoll] Could not get server params:", err.message, `retry in ${Math.round(delayMs / 60000)}min`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  let { key, server, ts } = params;
  while (true) {
    try {
      const res = await fetch(lpServerUrl(server, `act=a_check&key=${key}&ts=${ts}&wait=25`), {
        signal: AbortSignal.timeout(35000),
      });
      const data = await res.json() as any;

      if (data.failed) {
        console.log(`[VK Bots LongPoll] Failed=${data.failed}, refreshing server params`);
        try {
          ({ key, server, ts } = await getBotsLongPollServer(groupId));
        } catch (err: any) {
          logError("[VK Bots LongPoll] refresh error:", err.message);
          await new Promise(r => setTimeout(r, 5000));
        }
        continue;
      }

      ts = String(data.ts);
      for (const update of data.updates || []) {
        if (update?.type !== "message_new") continue;
        const msg = update.object?.message;
        if (!msg) continue;
        if (String(msg.peer_id) !== String(peerId)) continue;

        const replyMsg = msg.reply_message;
        // Ответом менеджер может и не пользоваться: тогда сообщение уходит
        // в самый свежий диалог сайта, где были VK-уведомления (vkMessageId = 0).
        const replyToId = replyMsg?.id ? Number(replyMsg.id) : 0;
        const replyText: string = String(msg.text || "").trim();
        if (!replyText) continue;
        if (Number(msg.from_id) === -Number(groupId)) continue; // наше собственное сообщение

        console.log(`[VK Bots LongPoll] Message id=${msg.id} reply_to=${replyToId}: "${replyText.slice(0, 60)}"`);
        try {
          await onReply(replyToId, replyText, "Менеджер", Number(msg.id) || undefined);
        } catch (err: any) {
          logError("[VK Bots LongPoll] onReply error:", err.message);
        }
      }
    } catch (err: any) {
      logError("[VK Bots LongPoll] Poll error:", err.message, err.cause?.code || err.cause?.message || "");
      await new Promise(r => setTimeout(r, 5000));
      try {
        ({ key, server, ts } = await getBotsLongPollServer(groupId));
      } catch {}
    }
  }
}

async function getLongPollServer(): Promise<{ key: string; server: string; ts: string }> {
  const { token } = getConfig();
  const res = await fetch(
    `https://api.vk.ru/method/messages.getLongPollServer?access_token=${token}&v=5.199&lp_version=3`
  );
  const data = await res.json() as any;
  if (data.error) {
    if (data.error.error_code === 9) markVkFlood("messages.getLongPollServer", 9, data.error.error_msg);
    throw new Error(`messages.getLongPollServer: ${data.error.error_msg}`);
  }
  return data.response;
}

async function runLongPoll(
  onReply: (vkMessageId: number, replyText: string, adminName: string) => Promise<void>
): Promise<void> {
  const { token, peerId } = getConfig();
  console.log("[VK LongPoll] Starting...");

  // Получение параметров сессии может падать (Flood control, сеть). При flood не
  // долбим VK (каждый вызов расходует лимит и продлевает блокировку) — ждём паузу.
  let lpParams: { key: string; server: string; ts: string } | null = null;
  let lpAttempts = 0;
  while (!lpParams) {
    if (isVkFloodPaused()) {
      const wait = Math.max(1000, vkFloodPausedUntil - Date.now());
      await new Promise(r => setTimeout(r, Math.min(wait, VK_FLOOD_PAUSE_MS)));
      continue;
    }
    try {
      lpParams = await getLongPollServer();
      lpAttempts = 0;
    } catch (err: any) {
      // См. комментарий в Bots Long Poll: код 29 — лимит метода, а не общий флуд.
      const delayMs = Math.min(5 * 60_000 * Math.pow(2, lpAttempts), 30 * 60_000);
      lpAttempts++;
      logError("[VK LongPoll] Could not get server params:", err.message, `retry in ${Math.round(delayMs / 60000)}min`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  let { key, server, ts } = lpParams;
  let consecutiveFailed = 0;

  while (true) {
    try {
      const url = lpServerUrl(server, `act=a_check&key=${key}&ts=${ts}&wait=25&mode=2&version=3`);
      const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
      const data = await res.json() as any;

      if (data.failed) {
        if (data.failed === 1) {
          ts = String(data.ts);
          consecutiveFailed = 0;
        } else {
          // Exponential backoff: 0ms → 1s → 2s → 4s (cap) on consecutive failed=2/3
          const delayMs = consecutiveFailed === 0 ? 0 : Math.min(1000 * Math.pow(2, consecutiveFailed - 1), 4000);
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          consecutiveFailed++;
          console.log(`[VK LongPoll] Failed=${data.failed}, refreshing server params (attempt ${consecutiveFailed}, backoff ${delayMs}ms)`);
          try {
            ({ key, server, ts } = await getLongPollServer());
          } catch (err: any) {
            logError("[VK LongPoll] getLongPollServer error:", err.message);
            await new Promise(r => setTimeout(r, 5000));
          }
        }
        continue;
      }

      consecutiveFailed = 0;
      ts = String(data.ts);

      const updates = data.updates || [];
      if (updates.length > 0) {
        console.log(`[VK LongPoll] ${updates.length} update(s): types=[${updates.map((u: any[]) => u[0]).join(',')}]`);
      }

      for (const update of updates) {
        if (update[0] !== 4) continue;
        const msgId: number = update[1];
        const flags: number = update[2];
        const msgPeerId: number = update[3];
        const msgText: string = update[5] || '';

        const isOutgoing = !!(flags & 2);
        console.log(`[VK LongPoll] Msg event: id=${msgId} flags=${flags} peer=${msgPeerId} outgoing=${isOutgoing} text="${msgText.slice(0, 40)}"`);

        if (String(msgPeerId) !== String(peerId)) {
          console.log(`[VK LongPoll] Skip: peer ${msgPeerId} != ${peerId}`);
          continue;
        }

        try {
          const msgRes = await fetch(
            `https://api.vk.ru/method/messages.getById?access_token=${token}&v=5.199&message_ids=${msgId}`
          );
          const msgData = await msgRes.json() as any;
          const msg = msgData?.response?.items?.[0];
          if (!msg) {
            console.log(`[VK LongPoll] messages.getById returned no item for id=${msgId}`);
            continue;
          }

          console.log(`[VK LongPoll] Full msg: id=${msg.id} has_reply=${!!msg.reply_message} reply_id=${msg.reply_message?.id}`);

          const replyMsg = msg.reply_message;
          if (!replyMsg?.id) {
            console.log(`[VK LongPoll] No reply_message, skipping (not a reply)`);
            continue;
          }

          const rawText: string = (msg.text || '').trim();
          const replyText = rawText
            .replace(/^\[Ответ\][\s\S]*?\n\n/m, '')
            .replace(/^\[Ответ\][^\n]*\n?/m, '')
            .trim();
          if (!replyText) continue;

          const adminName = 'Менеджер';
          console.log(`[VK LongPoll] Reply to vk_msg_id=${replyMsg.id}: "${replyText.slice(0, 60)}"`);
          await onReply(replyMsg.id as number, replyText, adminName);
        } catch (err: any) {
          logError("[VK LongPoll] Error processing message:", err.message);
        }
      }
    } catch (err: any) {
      logError("[VK LongPoll] Poll error:", err.message, err.cause?.code || err.cause?.message || "");
      await new Promise(r => setTimeout(r, 5000));
      try {
        ({ key, server, ts } = await getLongPollServer());
      } catch {}
    }
  }
}

// ── Autonomous Agent notifications ─────────────────────────────────────────

export function vkNotifyAddonOrderPaid(order: {
  id: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
}, addonItems: Array<{ productName: string; size?: string; color?: string; quantity: number; price: number; sku?: string }>, addedTotal: number): void {
  const sep = "\n────────────────────\n";
  let text = `🛒 Дозаказ к #${order.id}  •  ${order.customerName}`;
  if (order.customerPhone) text += `\n${order.customerPhone}`;
  if (order.customerEmail) text += `  ${order.customerEmail}`;
  text += sep;
  addonItems.forEach((it, i) => {
    const meta = [it.size, it.color].filter(Boolean).join("/");
    text += `${i + 1}. ${it.productName}`;
    if (it.sku) text += ` [${it.sku}]`;
    if (meta) text += ` (${meta})`;
    text += ` ×${it.quantity} ${(it.price * it.quantity / 100).toLocaleString('ru-RU')}₽\n`;
  });
  text += sep;
  text += `Доплата: ${(addedTotal / 100).toLocaleString('ru-RU')} ₽\n⚠️ Накладная CDEK обновляется`;
  sendVkMessage(text).catch(err => logError("[VK] vkNotifyAddonOrderPaid failed:", err));
}

export function vkNotifyAgentAlert(text: string): void {
  sendVkMessage(text).catch(err => logError("[VK] vkNotifyAgentAlert failed:", err));
}

export function vkNotifyAgentDigest(text: string): void {
  sendVkMessage(text).catch(err => logError("[VK] vkNotifyAgentDigest failed:", err));
}


