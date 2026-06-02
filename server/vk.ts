import crypto from "crypto";

const SITE_URL = process.env.SITE_URL || "https://www.booomerangs.ru";
const VK_MAX_LENGTH = 4000;
const LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getConfig() {
  return {
    token: process.env.VK_USER_TOKEN || "",
    peerId: process.env.VK_CHAT_PEER_ID || "",
    secret: process.env.VK_ACTION_SECRET || "vk-action-secret-fallback",
  };
}

function randomId(): number {
  return Math.floor(Math.random() * 2147483647);
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
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(exp) < now) return false;
  const payload = `${act}:${id}:${exp}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

async function sendVkMessage(text: string): Promise<boolean> {
  const { token, peerId } = getConfig();
  if (!token || !peerId) {
    console.log("[VK] Not configured, skipping notification");
    return false;
  }

  const cleanText = plain(text);

  try {
    const body = new URLSearchParams({
      peer_id: peerId,
      message: cleanText,
      random_id: String(randomId()),
      access_token: token,
      v: "5.199",
    });

    const response = await fetch(`https://api.vk.com/method/messages.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("[VK] Non-JSON response:", raw.slice(0, 120));
      return false;
    }

    if (data.error) {
      console.error("[VK] Send error:", data.error.error_msg);
      return false;
    }

    console.log("[VK] Notification sent, message_id:", data.response);
    return true;
  } catch (error: any) {
    console.error("[VK] Failed to send:", error.message);
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
  ydPointName?: string;
}

export function vkNotifyNewOrder(order: OrderNotification): void {
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
    const svc = order.deliveryService === "yandex" ? "🟡 Яндекс" : "🟢 СДЭК";
    header += `\n${svc}`;
    if (order.deliveryService === "yandex" && order.ydPointName) {
      header += ` • ${order.ydPointName}`;
    }
  }

  if (order.address) header += `\n📍 ${order.address}`;

  const sep = "\n────────────────────\n";

  let footer = `${totalQty} шт.  •  ${price(order.total)}`;
  if (order.paymentMethod) {
    const m: Record<string, string> = { tbank: "T-Bank", yookassa: "ЮKassa", invoice: "Счёт" };
    footer += `  •  ${m[order.paymentMethod] || order.paymentMethod}`;
  }
  if (order.promoCode) footer += `  •  🏷 ${order.promoCode}`;

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
    sendVkMessage(fullText).catch(err => console.error("[VK] vkNotifyNewOrder failed:", err));
    return;
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

  const sendAll = async () => {
    for (const msg of messages) {
      await sendVkMessage(msg);
    }
  };
  sendAll().catch(err => console.error("[VK] vkNotifyNewOrder failed:", err));
}

interface PreorderNotification {
  orderId: number | string;
  productName: string;
  customerName: string;
  customerEmail: string;
  depositAmount: number;
  totalAmount: number;
  items?: Array<{ size?: string; quantity: number }>;
  color?: string;
  shippingDate?: string | null;
}

export function vkNotifyPreorderDeposit(data: PreorderNotification): void {
  let text = `🎯 ПРЕДЗАКАЗ #${data.orderId}\n`;
  text += `${data.productName}`;
  if (data.color) text += ` — ${data.color}`;
  text += `\n`;
  if (data.items && data.items.length > 0) {
    const sizeParts = data.items.filter(i => i.quantity > 0).map(i => i.size ? `${i.size} × ${i.quantity}` : `× ${i.quantity}`);
    if (sizeParts.length > 0) text += `📐 ${sizeParts.join(", ")}\n`;
  }
  text += `👤 ${data.customerName}  |  ${data.customerEmail}`;
  text += `\n💰 Оплачено: ${price(data.depositAmount)}`;
  if (data.shippingDate) {
    try {
      const d = new Date(data.shippingDate);
      text += `\n📦 Отправка: ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
    } catch {}
  }

  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyPreorderDeposit failed:", err));
}

export function vkNotifyPreorderGoalReached(productName: string, goal: number, productId: number): void {
  const text = `🎉 ЦЕЛЬ ПРЕДЗАКАЗА ДОСТИГНУТА!\n${productName} (ID: ${productId})\nСобрано: ${goal}/${goal} — переход в производство`;
  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyPreorderGoalReached failed:", err));
}

export function vkNotifyPreorderStatusChange(productName: string, productId: number, oldStatus: string, newStatus: string): void {
  const s: Record<string, string> = {
    collecting: "Сбор", funded: "Цель", production: "Производство", shipping: "Отправка", shipped: "Отправлено", cancelled: "Отмена",
  };
  const text = `🔄 Статус предзаказа\n${productName} (ID: ${productId})\n${s[oldStatus] || oldStatus} → ${s[newStatus] || newStatus}`;
  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyPreorderStatusChange failed:", err));
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

  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyWholesaleRegistration failed:", err));
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

  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyMerchOrder failed:", err));
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

  text += `\n\n✅ Одобрить:\n${generateActionLink("review_approve", data.reviewId)}`;
  text += `\n\n❌ Отклонить:\n${generateActionLink("review_reject", data.reviewId)}`;

  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyNewReview failed:", err));
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

  sendVkMessage(text).catch(err => console.error("[VK] vkNotifyPartnerFeedback failed:", err));
}
