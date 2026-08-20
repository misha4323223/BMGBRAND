import { storage } from './storage';
import { sendEmail } from './email';
import { groqCompleteStream } from './groq-utils';

// Ручная рассылка «оставьте отзыв» покупателям, получившим заказ.
// Автозапуск сознательно НЕ делаем (по команде владельца) — только кнопка в админке.
const SITE_URL = 'https://booomerangs.ru';
const SEND_DELAY_MS = 400;      // пауза между письмами
const MAX_SEND_PER_RUN = 100;   // страховка на один запуск (чтобы случайно не упереться в таймаут)
const MAX_REVIEW_MESSAGE_LENGTH = 5000;

export const DEFAULT_REVIEW_REQUEST_SUBJECT = 'Понравилась покупка? Оставьте отзыв ⭐';
export const DEFAULT_REVIEW_REQUEST_BODY =
  'Привет, {name}! Надеемся, ваш заказ уже радует. Поделитесь впечатлением — это займёт минуту и поможет другим покупателям.';

export interface ReviewRequestMessage {
  subject?: string;
  body?: string;
}

export interface ReviewRequestItem {
  productId: number;
  name: string;
  url: string;
}

export interface ReviewRequestCandidate {
  orderId: number;
  customerName: string;
  customerEmail: string;
  status: string;
  createdAt: string | null;
  items: ReviewRequestItem[];
}

function normalizeReviewRequestMessage(message?: ReviewRequestMessage): { subject: string; body: string } {
  const subject = typeof message?.subject === 'string'
    ? message.subject.trim().slice(0, 200)
    : '';
  const body = typeof message?.body === 'string'
    ? message.body.trim().slice(0, MAX_REVIEW_MESSAGE_LENGTH)
    : '';

  return {
    subject: subject || DEFAULT_REVIEW_REQUEST_SUBJECT,
    body: body || DEFAULT_REVIEW_REQUEST_BODY,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function renderReviewMessage(body: string, firstName: string): string {
  const personalized = body.split("{name}").join(firstName);
  return personalized
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style=\"font-size:14px;color:#555;line-height:1.6;margin:0 0 16px;\">${escapeHtml(paragraph).replaceAll(String.fromCharCode(10), '<br />')}</p>`)
    .join('');
}

function parseAddon(raw: string | null | undefined): Record<string, any> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function markReviewRequestSent(orderId: number): Promise<void> {
  try {
    const order = await storage.getOrder(orderId);
    if (!order) return;
    // Читаем свежий addon_data перед записью — не затираем параллельные флаги (VK, Ozon и т.п.)
    const existing = parseAddon(order.addonData);
    await storage.updateOrderAddonData(
      orderId,
      JSON.stringify({ ...existing, reviewRequestSentAt: new Date().toISOString() }),
    );
  } catch (err: any) {
    console.error(`[ReviewRequest] Failed to mark order ${orderId}:`, err?.message);
  }
}

async function buildItems(order: any): Promise<ReviewRequestItem[]> {
  const items = Array.isArray(order.items) ? order.items : [];
  const out: ReviewRequestItem[] = [];

  for (const it of items) {
    if (it && it._discountDetails) continue;
    const pid = Number(it?.productId ?? it?.id);
    if (!Number.isFinite(pid) || pid <= 0) continue;

    let name = String(it?.productName || it?.name || '').trim();
    let slug = '';
    try {
      const p = await storage.getProduct(pid);
      if (p) {
        if (!name) name = p.name;
        slug = String((p as any).slug || '');
      }
    } catch {}

    if (!name) name = `Товар #${pid}`;
    out.push({
      productId: pid,
      name,
      url: slug ? `${SITE_URL}/${slug}#reviews` : `${SITE_URL}/products#reviews`,
    });

    if (out.length >= 5) break; // не перегружаем письмо
  }

  return out;
}

export async function getReviewRequestCandidates(): Promise<ReviewRequestCandidate[]> {
  const statuses = ['delivered', 'ready_for_pickup'];
  const out: ReviewRequestCandidate[] = [];

  for (const status of statuses) {
    let rows: any[] = [];
    try {
      rows = await storage.getOrdersByStatus(status);
    } catch {
      continue;
    }

    for (const row of rows) {
      // getOrdersByStatus возвращает не все колонки (в т.ч. без addon_data),
      // поэтому читаем полный заказ для дедупликации по reviewRequestSentAt.
      const order = await storage.getOrder(row.id);
      if (!order) continue;

      const addon = parseAddon(order.addonData);
      if (addon.reviewRequestSentAt) continue; // уже спрашивали — не дублируем
      if (!order.customerEmail) continue;

      const items = await buildItems(order);
      if (items.length === 0) continue;

      out.push({
        orderId: order.id,
        customerName: order.customerName || '',
        customerEmail: order.customerEmail,
        status,
        createdAt: order.createdAt ? String(order.createdAt) : null,
        items,
      });
    }
  }

  return out;
}

export async function sendReviewRequestsNow(
  orderIds?: number[],
  message?: ReviewRequestMessage,
): Promise<{ total: number; sent: number; failed: number; skipped: number }> {
  const reviewMessage = normalizeReviewRequestMessage(message);
  let candidates = await getReviewRequestCandidates();

  if (orderIds && orderIds.length > 0) {
    const set = new Set(orderIds.map((id) => Number(id)));
    candidates = candidates.filter((c) => set.has(c.orderId));
  }

  if (candidates.length === 0) {
    return { total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  let processed = 0;

  for (const c of candidates) {
    if (processed >= MAX_SEND_PER_RUN) break;
    processed++;

    try {
      const html = getReviewRequestEmailHtml({
        customerName: c.customerName,
        items: c.items,
        message: reviewMessage,
      });
      const ok = await sendEmail({
        to: c.customerEmail,
        subject: reviewMessage.subject,
        html,
      });
      if (ok) {
        sent++;
        await markReviewRequestSent(c.orderId);
        console.log(`[ReviewRequest] Sent to ${c.customerEmail} for order ${c.orderId}`);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
  }

  console.log(
    `[ReviewRequest] Done. total=${candidates.length} sent=${sent} failed=${failed} skipped=${candidates.length - processed}`,
  );
  return {
    total: candidates.length,
    sent,
    failed,
    skipped: candidates.length - processed,
  };
}

export async function sendReviewRequestPreview(
  email: string,
  message?: ReviewRequestMessage,
): Promise<{ success: boolean; sentTo: string; itemsCount: number }> {
  const reviewMessage = normalizeReviewRequestMessage(message);
  const candidates = await getReviewRequestCandidates();
  let items = candidates[0]?.items || [];
  if (items.length === 0) {
    items = [{ productId: 0, name: 'Пример товара', url: `${SITE_URL}/products#reviews` }];
  }

  const html = getReviewRequestEmailHtml({ customerName: '', items, message: reviewMessage });
  const ok = await sendEmail({
    to: email,
    subject: `[ПРЕВЬЮ] ${reviewMessage.subject}`,
    html,
  });
  return { success: ok, sentTo: email, itemsCount: items.length };
}

export async function generateReviewRequestDraft(): Promise<string> {
  const proxyUrl = process.env.GROQ_PROXY_URL;
  const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, '') : 'https://api.groq.com';
  const keys = [process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY].filter(
    (value): value is string => Boolean(value),
  );
  if (keys.length === 0 && !proxyUrl) {
    throw new Error('AI service not configured');
  }

  const attempts = keys.length > 0 ? keys : [''];
  const prompt = `Напиши короткий текст для письма покупателю российского бренда одежды BOOOMERANGS с просьбой оставить отзыв о доставленном заказе.

Требования:
- русский язык, тёплый живой тон без канцелярита и навязчивых продаж;
- 2 коротких абзаца, без темы письма, без HTML и Markdown;
- упомяни, что отзыв займёт около минуты и поможет другим покупателям;
- используй плейсхолдер {name} для имени покупателя;
- не обещай скидки, подарки или бонусы, если их нет в задании;
- не добавляй подпись бренда — она уже есть в шаблоне письма.`;

  let lastError: Error | null = null;
  for (const apiKey of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const text = await groqCompleteStream({
        baseUrl: groqBase,
        apiKey: apiKey || undefined,
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: 'Ты пишешь аккуратные тексты для email-рассылок интернет-магазина.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.75,
        maxTokens: 350,
        signal: controller.signal,
      });
      if (!text) throw new Error('Groq вернул пустой ответ');
      return text.slice(0, MAX_REVIEW_MESSAGE_LENGTH);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err?.name === 'AbortError') {
        throw new Error('Groq не ответил за 60 секунд — попробуйте ещё раз');
      }
      if (err?.status === 429) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('AI request failed');
}

export function getReviewRequestEmailHtml(params: {
  customerName: string;
  items: ReviewRequestItem[];
  message?: ReviewRequestMessage;
}): string {
  const reviewMessage = normalizeReviewRequestMessage(params.message);
  const firstName = params.customerName?.split(' ')[0] || 'Покупатель';

  const itemsHtml = params.items
    .map(
      (item) => `
      <tr>
        <td style="padding:0 0 14px;">
          <a href="${item.url}" style="display:block;padding:14px 18px;background:#fafafa;border:1px solid #eee;border-radius:10px;text-decoration:none;">
            <div style="font-size:15px;font-weight:700;color:#1C1C1C;margin-bottom:6px;line-height:1.3;">${item.name}</div>
            <div style="font-size:13px;font-weight:700;color:#E53935;letter-spacing:0.5px;text-transform:uppercase;">⭐ Оставить отзыв</div>
          </a>
        </td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#1C1C1C;padding:24px 32px;">
              <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-transform:uppercase;">
                BOO<span style="color:#E53935;">O</span>MERANGS
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <div style="font-size:22px;font-weight:800;color:#1C1C1C;margin-bottom:18px;line-height:1.25;">
                Как вам покупка?
              </div>
              ${renderReviewMessage(reviewMessage.body, firstName)}
              <table width="100%" cellpadding="0" cellspacing="0">
                ${itemsHtml}
              </table>
              <p style="font-size:12px;color:#999;margin:8px 0 28px;line-height:1.5;">
                Отзыв появится после короткой проверки. Если вы уже оставили отзыв — просто проигнорируйте это письмо.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.6;">
              &copy; ${new Date().getFullYear()} BOOOMERANGS. Все права защищены.<br />
              <a href="${SITE_URL}" style="color:#999;text-decoration:none;">booomerangs.ru</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
