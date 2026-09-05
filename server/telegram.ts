import { transportCompanyName } from '../shared/transport-companies';
import { logError, logWarn } from "./logger";

const TG_MAX_LENGTH = 4000;

function getConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    wholesaleToken: process.env.TELEGRAM_WHOLESALE_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    wholesaleChatId: process.env.TELEGRAM_WHOLESALE_CHAT_ID || "",
  };
}

function getWholesaleToken(): string {
  const { wholesaleToken, token } = getConfig();
  return wholesaleToken || token;
}

async function sendMessageToChat(chatId: string, text: string, botToken?: string): Promise<boolean> {
  const token = botToken || getConfig().token;
  if (!token || !chatId) {
    console.log("[Telegram] Not configured or chat_id missing, skipping notification");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logError(`[Telegram] Send error to ${chatId}:`, response.status, err);
      return false;
    }

    console.log(`[Telegram] Notification sent to ${chatId}`);
    return true;
  } catch (error: any) {
    logError("[Telegram] Failed to send:", error.message);
    return false;
  }
}

async function sendMessageWithInlineKeyboard(
  chatId: string,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
  botToken: string
): Promise<number | null> {
  if (!botToken || !chatId) {
    console.log("[Telegram] Not configured, skipping notification with buttons");
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logError(`[Telegram] Send with buttons error:`, response.status, err);
      return null;
    }

    const data: any = await response.json();
    console.log(`[Telegram] Notification with buttons sent to ${chatId}`);
    return data?.result?.message_id ?? null;
  } catch (error: any) {
    logError("[Telegram] Failed to send with buttons:", error.message);
    return null;
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text: string, botToken?: string): Promise<void> {
  const token = botToken || getWholesaleToken();
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch (error: any) {
    logError("[Telegram] answerCallbackQuery failed:", error.message);
  }
}

export async function editMessageText(chatId: string, messageId: number, text: string, botToken?: string): Promise<void> {
  const token = botToken || getWholesaleToken();
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  } catch (error: any) {
    logError("[Telegram] editMessageText failed:", error.message);
  }
}

export async function registerWholesaleWebhook(webhookUrl: string): Promise<void> {
  const token = getWholesaleToken();
  if (!token) {
    console.log("[Telegram] Wholesale bot token not set, skipping webhook registration");
    return;
  }

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const infoData: any = await infoRes.json();
    if (infoData?.result?.url === webhookUrl) {
      console.log("[Telegram] Wholesale webhook already registered:", webhookUrl);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["callback_query", "message"],
      }),
    });

    const data: any = await response.json();
    if (data.ok) {
      console.log("[Telegram] Wholesale webhook registered:", webhookUrl);
    } else {
      logError("[Telegram] Failed to register wholesale webhook:", data);
    }
  } catch (error: any) {
    logError("[Telegram] registerWholesaleWebhook failed:", error.message);
  }
}

async function sendLongMessage(sender: (text: string) => Promise<boolean>, parts: string[]): Promise<void> {
  for (const part of parts) {
    await sender(part);
  }
}

async function sendRetailMessage(text: string): Promise<boolean> {
  const { chatId } = getConfig();
  return sendMessageToChat(chatId, text);
}

async function sendWholesaleMessage(text: string): Promise<boolean> {
  const { wholesaleChatId, wholesaleToken, token } = getConfig();
  return sendMessageToChat(wholesaleChatId, text, wholesaleToken || token);
}

function esc(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function price(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + "\u00A0\u20BD";
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

export function notifyNewOrder(order: OrderNotification): void {
  const discountDetails: any = (order.items as any[]).find((i: any) => i && i._discountDetails)?._discountDetails;
  const items = order.items.filter((i: any) => !i._discountDetails);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const isWh = order.isWholesale;
  const sender = isWh ? sendWholesaleMessage : sendRetailMessage;

  let header = isWh ? "\u{1F4E6} <b>OPT #" : "\u{1F6D2} <b>#";
  header += `${order.orderId}</b>  \u{2022}  ${esc(order.customerName)}`;
  header += `\n${esc(order.customerPhone)}  |  ${esc(order.customerEmail)}`;

  if (isWh && order.companyName) {
    header += `\n\u{1F3E2} ${esc(order.companyName)}`;
    if (order.inn) header += ` (${esc(order.inn)})`;
    if (order.transportCompany) header += `  \u{2022}  \u{1F69A} ${esc(transportCompanyName(order.transportCompany))}`;
  }

  if (!isWh && order.deliveryService) {
    const svcLabel = order.deliveryService === "pickup" ? "Самовывоз" : order.deliveryService === "ozon" ? "Ozon" : "СДЭК";
    header += `\n\u{1F7E2} ${svcLabel}`;
  }

  if (order.address) {
    header += `\n\u{1F4CD} ${esc(order.address)}`;
  }

  header += "\n";

  let footer = "";

  if (discountDetails && Number.isFinite(discountDetails.subtotal)) {
    const wItemDiscount = Number(discountDetails.wholesaleItemDiscountAmount) || 0;
    // When there is a per-item wholesale discount, show the original wholesale price
    // so the manager sees: "Товары: 1000 ₽ → Скидка опт: -100 ₽ → Итого: 900 ₽"
    const displaySubtotal = wItemDiscount > 0
      ? discountDetails.subtotal + wItemDiscount
      : discountDetails.subtotal;
    footer += `\n\u{1F6CD} Товары: ${price(displaySubtotal)}`;

    const discParts: string[] = [];
    if (wItemDiscount > 0) {
      discParts.push(`\u{1F3F7} Скидка опт (-${price(wItemDiscount)})`);
    }
    if (Number.isFinite(discountDetails.promoDiscountAmount) && discountDetails.promoDiscountAmount > 0) {
      let part = `\u{1F3F7} ${esc(discountDetails.promoCode || order.promoCode || "")}`;
      if (Number.isFinite(discountDetails.promoDiscountPercent) && discountDetails.promoDiscountPercent > 0) {
        part += ` -${discountDetails.promoDiscountPercent}%`;
      }
      part += ` (-${price(discountDetails.promoDiscountAmount)})`;
      discParts.push(part);
    }
    if (Number.isFinite(discountDetails.loyaltyDiscountAmount) && discountDetails.loyaltyDiscountAmount > 0) {
      const pct = Number.isFinite(discountDetails.loyaltyPercent) ? `-${discountDetails.loyaltyPercent}% ` : "";
      discParts.push(`\u2B50 Лояльность ${pct}(-${price(discountDetails.loyaltyDiscountAmount)})`);
    }
    if (Number.isFinite(discountDetails.giftCardAmount) && discountDetails.giftCardAmount > 0) {
      discParts.push(`\u{1F381} Сертификат ${esc(discountDetails.giftCardCode || "")} (-${price(discountDetails.giftCardAmount)})`);
    }
    if (discParts.length > 0) {
      footer += `\n\u{1F4B8} Скидка: ${discParts.join("  \u{2022}  ")}`;
    }

    if (!isWh) {
      const dc = Number(discountDetails.deliveryCost) || 0;
      footer += `\n\u{1F69A} Доставка: ${dc > 0 ? price(dc) : "бесплатно"}`;
    }
  }

  footer += `\n<b>${totalQty} шт.  \u{2022}  ${price(order.total)}</b>`;

  if (order.paymentMethod) {
    const m: Record<string, string> = { tbank: "T-Bank", yookassa: "\u042EKassa", invoice: "\u0421\u0447\u0451\u0442", yandex: "Яндекс (Кнопка «Купить»)" };
    footer += `  \u{2022}  ${m[order.paymentMethod] || order.paymentMethod}`;
  }
  if (!discountDetails && order.promoCode) {
    footer += `  \u{2022}  \u{1F3F7} ${esc(order.promoCode)}`;
  }

  const itemLines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const meta = [cleanMeta(it.size), cleanMeta(it.color)].filter(Boolean).join("/");
    const nm = shortName(it.productName);
    let line = `${i + 1}. ${esc(nm)}`;
    if (meta) line += ` <i>${esc(meta)}</i>`;
    line += ` \u00D7${it.quantity} ${price(it.price * it.quantity)}`;
    itemLines.push(line);
  }

  const separator = "\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n";

  const fullText = header + separator + itemLines.join("\n") + separator + footer;

  if (fullText.length <= TG_MAX_LENGTH) {
    sender(fullText).catch(err => logError("[Telegram] notifyNewOrder failed:", err));
    return;
  }

  const messages: string[] = [];
  let current = header + separator;
  const totalPages = Math.ceil(itemLines.length / 30);
  let page = 1;

  for (let i = 0; i < itemLines.length; i++) {
    const line = itemLines[i] + "\n";
    if (current.length + line.length > TG_MAX_LENGTH - 60) {
      current += `\n<i>... \u0447\u0430\u0441\u0442\u044C ${page}/${totalPages}</i>`;
      messages.push(current);
      page++;
      current = `<b>#${order.orderId}</b> (\u0447. ${page})\n` + separator;
    }
    current += line;
  }
  current += separator + footer;
  messages.push(current);

  sendLongMessage(sender, messages).catch(err => logError("[Telegram] notifyNewOrder failed:", err));
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

export function notifyPreorderDeposit(data: PreorderNotification): void {
  let text = `🎯 <b>ПРЕДЗАКАЗ #${data.orderId}</b>\n`;
  if (data.items && data.items.length > 0) {
    const parts = data.items.filter(i => i.quantity > 0).map(i => {
      let part = esc(i.name || data.productName);
      const color = i.color || data.color;
      if (color) part += ` (${esc(color)})`;
      const size = i.size && i.size !== 'OneSize' && i.size !== '(OneSize)' ? i.size : null;
      if (size) part += ` ${esc(size)}`;
      part += ` × ${i.quantity}`;
      return part;
    });
    text += parts.join(', ') + '\n';
  } else {
    text += `${esc(data.productName)}`;
    if (data.color) text += ` (${esc(data.color)})`;
    text += '\n';
  }
  text += `👤 ${esc(data.customerName)}  |  ${esc(data.customerEmail)}`;
  text += `\n💰 Оплачено: <b>${price(data.depositAmount)}</b>`;
  if (data.paymentMethod) text += `\n💳 ${esc(data.paymentMethod)}`;
  if (data.deliveryInfo) text += `\n🚚 ${esc(data.deliveryInfo)}`;
  if (data.shippingDate) {
    try {
      const d = new Date(data.shippingDate);
      text += `\n📦 Отправка: <b>${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</b>`;
    } catch {}
  }

  sendRetailMessage(text).catch(err => logError("[Telegram] notifyPreorderDeposit failed:", err));
}

export function notifyPreorderGoalReached(productName: string, goal: number, productId: number): void {
  let text = `\u{1F389} <b>\u0426\u0415\u041B\u042C \u041F\u0420\u0415\u0414\u0417\u0410\u041A\u0410\u0417\u0410 \u0414\u041E\u0421\u0422\u0418\u0413\u041D\u0423\u0422\u0410!</b>\n`;
  text += `${esc(productName)} (ID: ${productId})\n`;
  text += `\u0421\u043E\u0431\u0440\u0430\u043D\u043E: ${goal}/${goal} \u2014 \u043F\u0435\u0440\u0435\u0445\u043E\u0434 \u0432 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u043E`;

  sendRetailMessage(text).catch(err => logError("[Telegram] notifyPreorderGoalReached failed:", err));
}

export function notifyPreorderStatusChange(productName: string, productId: number, oldStatus: string, newStatus: string): void {
  const s: Record<string, string> = {
    collecting: "Сбор", funded: "Цель", production: "Производство", shipping: "Отправка", shipped: "Отправлено", cancelled: "Отмена",
  };
  let text = `\u{1F504} <b>\u0421\u0442\u0430\u0442\u0443\u0441 \u043F\u0440\u0435\u0434\u0437\u0430\u043A\u0430\u0437\u0430</b>\n`;
  text += `${esc(productName)} (ID: ${productId})\n`;
  text += `${s[oldStatus] || oldStatus} \u2192 <b>${s[newStatus] || newStatus}</b>`;

  sendRetailMessage(text).catch(err => logError("[Telegram] notifyPreorderStatusChange failed:", err));
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

export async function sendChatNotification(sessionId: string, text: string, userName?: string, isWholesale?: boolean, imageUrl?: string): Promise<number | null> {
  const config = getConfig();
  const token = isWholesale ? (config.wholesaleToken || config.token) : config.token;
  const chatId = isWholesale ? config.wholesaleChatId : config.chatId;
  const botType = isWholesale ? 'wholesale' : 'retail';

  if (!token || !chatId) {
    logWarn(`[Telegram] sendChatNotification: ${botType} bot not configured (token=${!!token}, chatId=${!!chatId})`);
    return null;
  }

  const displayName = userName ? esc(userName) : 'Гость';
  const prefix = isWholesale ? '🏭 <b>ОПТ — Чат — ' : '💬 <b>Чат — ';
  const footer = '\n\n<i>↩️ Ответьте на это сообщение, чтобы написать клиенту</i>';

  console.log(`[Telegram] Sending chat notification (${botType}) for session ${sessionId.slice(0, 8)}, user: ${displayName}`);

  try {
    if (imageUrl) {
      const commentText = text && text !== '📷 Фото' ? `\n\n${esc(text)}` : '';
      const caption = `${prefix}${displayName}</b>\n<code>${sessionId.slice(0, 8)}</code>${commentText}${footer}`;
      const url = `https://api.telegram.org/bot${token}/sendPhoto`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption, parse_mode: "HTML" }),
      });
      const data: any = await response.json();
      if (data.ok) {
        console.log(`[Telegram] sendPhoto OK, tgMessageId=${data.result.message_id}`);
        return data?.result?.message_id ?? null;
      }
      logWarn(`[Telegram] sendPhoto failed (${botType}): ${data.error_code} — ${data.description}, falling back to sendMessage`);
    }

    const msgText = `${prefix}${displayName}</b>\n<code>${sessionId.slice(0, 8)}</code>\n\n${esc(text)}${footer}`;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msgText, parse_mode: "HTML", disable_web_page_preview: !imageUrl }),
    });
    const data: any = await response.json();
    if (!data.ok) {
      logError(`[Telegram] sendMessage failed (${botType}): ${data.error_code} — ${data.description}`);
      return null;
    }
    console.log(`[Telegram] sendMessage OK (${botType}), tgMessageId=${data.result.message_id}`);
    return data?.result?.message_id ?? null;
  } catch (err: any) {
    logError(`[Telegram] sendChatNotification exception (${botType}):`, err.message);
    return null;
  }
}

export async function registerChatWebhook(webhookUrl: string): Promise<void> {
  const { token } = getConfig();
  if (!token) {
    console.log("[Telegram] Retail bot token not set, skipping chat webhook registration");
    return;
  }
  try {
    const currentWebhook = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const currentData: any = await currentWebhook.json();
    if (currentData?.result?.url === webhookUrl) {
      console.log("[Telegram] Chat webhook already registered:", webhookUrl);
      return;
    }
    const url = `https://api.telegram.org/bot${token}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"], drop_pending_updates: false }),
    });
    const data: any = await response.json();
    if (data.ok) {
      console.log("[Telegram] Chat webhook registered:", webhookUrl);
    } else {
      logError("[Telegram] Failed to register chat webhook:", data);
    }
  } catch (error: any) {
    logError("[Telegram] registerChatWebhook failed:", error.message);
  }
}

export function notifyWholesaleRegistration(data: WholesaleRegistration): void {
  const { wholesaleChatId } = getConfig();
  const token = getWholesaleToken();

  let text = `\u{1F454} <b>ЗАЯВКА НА ОПТ</b>\n\n`;
  text += `\u{1F464} ${esc(data.contactPerson)}  |  ${esc(data.contactPhone)}\n`;
  text += `\u{2709}\uFE0F ${esc(data.email)}\n`;
  text += `\u{1F3E2} ${esc(data.companyName)}  |  ИНН ${esc(data.inn)}`;
  if (data.kpp) text += ` | КПП ${esc(data.kpp)}`;
  text += `\n\u{1F4CD} ${esc(data.legalAddress)}`;
  text += `\n\u{1F6CD}\uFE0F ${esc(data.storeName)} \u2014 ${esc(data.storeAddress)}`;

  const buttons = [[
    { text: "✅ Принять клиента", callback_data: `wh_approve:${data.userId}` },
    { text: "❌ Отклонить", callback_data: `wh_reject:${data.userId}` },
  ]];

  sendMessageWithInlineKeyboard(wholesaleChatId, text, buttons, token)
    .catch(err => logError("[Telegram] notifyWholesaleRegistration failed:", err));
}

export function notifyPartnerRegistration(data: {
  contactName: string;
  email: string;
  partnerSlug: string;
  contactPhone?: string | null;
  legalStatus?: string | null;
  storeName?: string | null;
  platformDescription?: string | null;
  geoCity?: string | null;
  geoRegion?: string | null;
  geoCountry?: string | null;
}): void {
  const { wholesaleChatId } = getConfig();
  const token = getWholesaleToken();
  if (!wholesaleChatId || !token) return;

  const legalLabels: Record<string, string> = {
    self_employed: 'Самозанятый',
    ip: 'ИП',
    ooo: 'ООО',
  };
  const legal = data.legalStatus ? (legalLabels[data.legalStatus] || data.legalStatus) : 'не указан';

  let geoLine = '';
  if (data.geoCity || data.geoRegion) {
    const parts = [data.geoCity, data.geoRegion, data.geoCountry].filter(Boolean);
    geoLine = `\n📍 ${esc(parts.join(', '))}`;
  }

  let text = `🤝 <b>НОВАЯ ЗАЯВКА ПАРТНЁРА</b>\n\n`;
  text += `👤 ${esc(data.contactName)}\n`;
  text += `✉️ ${esc(data.email)}\n`;
  if (data.contactPhone) text += `📞 ${esc(data.contactPhone)}\n`;
  text += `🔗 Слаг: <code>${esc(data.partnerSlug)}</code>\n`;
  if (data.storeName) text += `🏪 ${esc(data.storeName)}\n`;
  if (data.platformDescription) text += `📱 Площадки: ${esc(data.platformDescription)}\n`;
  text += `📋 Правовой статус: ${esc(legal)}`;
  text += geoLine;
  text += `\n\n<i>Партнёр ещё не подтвердил email — заявка на модерации</i>`;

  sendMessageToChat(wholesaleChatId, text, token)
    .catch(err => logError("[Telegram] notifyPartnerRegistration failed:", err));
}

export function notifyPayoutInvoiceUploaded(data: {
  partnerName: string;
  contactEmail: string;
  payoutId: number;
  amount: number;
  invoiceNumber?: string | null;
}): void {
  const { wholesaleChatId } = getConfig();
  const token = getWholesaleToken();
  if (!wholesaleChatId || !token) return;

  const amountRub = (data.amount / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  let text = `💰 <b>Партнёрская выплата — счёт загружен</b>\n\n`;
  text += `👤 ${esc(data.partnerName)}\n`;
  text += `✉️ ${esc(data.contactEmail)}\n`;
  text += `💵 Сумма: <b>${amountRub} ₽</b>\n`;
  if (data.invoiceNumber) text += `📄 Счёт №${esc(data.invoiceNumber)}\n`;
  text += `\n<i>Выплата #${data.payoutId} — требуется оплата</i>`;

  sendMessageToChat(wholesaleChatId, text, token)
    .catch(err => logError("[Telegram] notifyPayoutInvoiceUploaded failed:", err));
}

export function notifyMerchOrder(data: {
  name: string;
  company?: string;
  productType: string;
  quantity: string;
  contact: string;
  message?: string;
}): void {
  const { chatId, token } = getConfig();
  if (!chatId || !token) return;

  const companyLine = data.company ? `\n🏢 Компания: ${data.company}` : "";
  const messageLine = data.message ? `\n💬 Комментарий: ${data.message}` : "";

  const text =
    `🎨 <b>Новая заявка на мерч</b>\n\n` +
    `👤 Имя: <b>${data.name}</b>${companyLine}\n` +
    `📦 Товар: ${data.productType}\n` +
    `📊 Тираж: ${data.quantity}\n` +
    `📞 Контакт: ${data.contact}` +
    messageLine;

  sendMessageToChat(chatId, text, token)
    .catch(err => logError("[Telegram] notifyMerchOrder failed:", err));
}

export function notifyNewReview(data: {
  authorName: string;
  rating: number;
  comment: string | null;
  productName: string;
  productId: number;
  reviewId: number;
}): void {
  const { chatId, token } = getConfig();
  if (!chatId || !token) return;

  const stars = "★".repeat(data.rating) + "☆".repeat(5 - data.rating);
  const commentLine = data.comment
    ? `\n💬 <i>${data.comment}</i>`
    : "\n💬 <i>Без комментария</i>";

  const text =
    `⭐ <b>Новый отзыв на модерации</b>\n\n` +
    `📦 Товар: <b>${data.productName}</b>\n` +
    `🌟 Оценка: ${stars} (${data.rating}/5)\n` +
    `👤 Автор: ${data.authorName}` +
    commentLine;

  // Модерация отзывов — только через админку сайта (кнопки в Telegram убраны).
  const moderationNote = `\n\n✅ Модерация отзыва — в админке сайта (раздел «Отзывы»).`;
  sendMessageWithInlineKeyboard(chatId, text + moderationNote, [], token)
    .catch(err => logError("[Telegram] notifyNewReview failed:", err));
}

export function notifyPartnerFeedback(data: {
  partnerName: string;
  partnerSlug: string;
  type: string;
  message: string;
}): void {
  const { chatId, token } = getConfig();
  if (!chatId || !token) return;

  const typeEmoji: Record<string, string> = {
    bug: "🐛",
    wish: "💡",
    other: "💬",
  };
  const emoji = typeEmoji[data.type] || "💬";
  const typeLabel: Record<string, string> = { bug: "Ошибка", wish: "Пожелание", other: "Другое" };
  const label = typeLabel[data.type] || "Другое";

  const text =
    `${emoji} <b>Обратная связь от партнёра</b>\n\n` +
    `👤 ${data.partnerName} (<code>/r/${data.partnerSlug}</code>)\n` +
    `📌 Тип: ${label}\n\n` +
    `📝 ${data.message}`;

  sendMessageToChat(chatId, text, token)
    .catch(err => logError("[Telegram] notifyPartnerFeedback failed:", err));
}

// ── Autonomous Agent notifications ─────────────────────────────────────────

export async function notifyAgentQueueItem(item: {
  id: string;
  title: string;
  description: string;
  type: string;
  params?: any;
}): Promise<void> {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return;

  const typeEmoji: Record<string, string> = {
    discount: "💸",
    description: "📝",
    hide_product: "👁",
    seo: "🔍",
    blog_draft: "✍️",
    review_reply: "💬",
    promo_code: "🎟",
    cart_promo: "📧",
    favorites_promo: "❤️",
    price_drop_analysis: "🔔",
  };
  const emoji = typeEmoji[item.type] || "🤖";

  const desc = item.description.length > 400
    ? item.description.slice(0, 400) + "…"
    : item.description;

  let text =
    `${emoji} <b>BOOOM AI предлагает:</b>\n\n` +
    `<b>${item.title}</b>\n\n` +
    `${desc}`;

  if (item.type === "cart_promo" && item.params) {
    const d = item.params.discount ?? 12;
    const h = item.params.validityHours ?? 48;
    const subj = item.params.emailSubject || `Персональная скидка ${d}%`;
    text +=
      `\n\n💰 <b>Скидка:</b> ${d}%` +
      `\n⏱ <b>Срок действия:</b> ${h} ч.` +
      `\n📧 <b>Тема письма:</b> <i>${subj}</i>` +
      `\n🔖 <b>Формат промокода:</b> CART-XXXXX (уникальный для каждого)` +
      `\n\n✏️ <i>Редактировать письмо: Админка → ИИ → Очередь</i>`;
  }

  if (item.type === "favorites_promo" && item.params) {
    const d = item.params.discount ?? 10;
    const h = item.params.validityHours ?? 72;
    const subj = item.params.emailSubject || `Персональная скидка ${d}%`;
    const users = item.params.users ?? [];
    text +=
      `\n\n💰 <b>Скидка:</b> ${d}%` +
      `\n⏱ <b>Срок действия:</b> ${h} ч.` +
      `\n📧 <b>Тема письма:</b> <i>${subj}</i>` +
      `\n🔖 <b>Формат промокода:</b> FAV-XXXXX (уникальный для каждого)` +
      `\n👥 <b>Клиентов:</b> ${users.length}` +
      `\n\n✏️ <i>Редактировать письмо: Админка → ИИ → Очередь</i>`;
  }

  if (item.type === "price_drop_analysis" && item.params) {
    const prods = item.params.products ?? [];
    const totalSubs = prods.reduce((s: number, p: any) => s + (p.subscriberCount ?? 0), 0);
    text +=
      `\n\n📊 <b>Товаров:</b> ${prods.length} · <b>Подписчиков:</b> ${totalSubs}` +
      `\n\n✏️ <i>Управление: Админка → ИИ → Очередь</i>`;
  }

  const buttons = [[
    { text: "✅ Подтвердить", callback_data: `agent_approve:${item.id}` },
    { text: "❌ Отклонить",   callback_data: `agent_reject:${item.id}` },
  ]];

  await sendMessageWithInlineKeyboard(chatId, text, buttons, token);
}

export function notifyAddonOrderPaid(order: {
  id: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}, addonItems: Array<{ productName: string; size?: string; color?: string; quantity: number; price: number; sku?: string }>, addedTotal: number): void {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return;

  const sep = "\n──────────────────────\n";
  let text = `🛒 <b>Дозаказ к #${order.id}</b>\n`;
  text += `${esc(order.customerName)}`;
  if (order.customerPhone) text += `  •  ${esc(order.customerPhone)}`;
  if (order.customerEmail) text += `\n${esc(order.customerEmail)}`;
  text += sep;
  addonItems.forEach((it, i) => {
    const meta = [it.size, it.color].filter(Boolean).join("/");
    text += `${i + 1}. ${esc(it.productName)}`;
    if (it.sku) text += ` <code>${esc(it.sku)}</code>`;
    if (meta) text += ` <i>${esc(meta)}</i>`;
    text += ` ×${it.quantity} ${price(it.price * it.quantity)}\n`;
  });
  text += sep;
  text += `<b>Доплата: ${price(addedTotal)}</b>\n`;
  text += `📦 Если накладная CDEK уже создана — она пересоздаётся автоматически с новым составом`;

  // Telegram HTML limit — trim middle items if needed, always keep header + total
  if (text.length > 4000) {
    const header = `🛒 <b>Дозаказ к #${order.id}</b>\n${esc(order.customerName)}${order.customerPhone ? `  •  ${esc(order.customerPhone)}` : ""}${order.customerEmail ? `\n${esc(order.customerEmail)}` : ""}${sep}`;
    const footer = `${sep}<b>Доплата: ${price(addedTotal)}</b> (${addonItems.length} позиций)\n📦 Накладная CDEK пересоздаётся`;
    text = header + `…сообщение обрезано, ${addonItems.length} позиций…` + footer;
  }

  sendRetailMessage(text).catch(err => logError("[Telegram] notifyAddonOrderPaid failed:", err));
}

export async function sendAgentAlert(text: string): Promise<void> {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return;
  await sendMessageToChat(chatId, text, token);
}

export async function sendAgentDigest(text: string): Promise<void> {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return;
  await sendMessageToChat(chatId, text, token);
}
