import { storage } from './storage';
import { sendEmail, getPostPurchaseEmailHtml } from './email';
import { getRecommendations } from './recommendations';

interface PPEmailQueueItem {
  orderId: number;
  customerEmail: string;
  customerName: string;
  orderItemIds: number[];
  firstProductId: number;
  sendAt: number;
  sent: boolean;
}

const QUEUE_KEY = 'ppemail_queue';
const CHECK_INTERVAL_MS = 3 * 60 * 1000;
const DELAY_MS = 60 * 60 * 1000;
const PROMO_DISCOUNT = 10;
const PROMO_VALIDITY_HOURS = 24;

async function readQueue(): Promise<PPEmailQueueItem[]> {
  try {
    const raw = await storage.getBonusSetting(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PPEmailQueueItem[];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PPEmailQueueItem[]): Promise<void> {
  try {
    await storage.setBonusSetting(QUEUE_KEY, JSON.stringify(queue));
  } catch (err: any) {
    console.error('[PPEmail] Failed to write queue:', err?.message);
  }
}

export async function schedulePostPurchaseEmail(
  orderId: number,
  customerEmail: string,
  customerName: string,
  orderItems: any[]
): Promise<void> {
  try {
    if (!customerEmail) return;

    const productIds = (Array.isArray(orderItems) ? orderItems : [])
      .map((it: any) => Number(it.productId ?? it.id))
      .filter((id: number) => !isNaN(id) && id > 0);

    const queue = await readQueue();

    if (queue.some(item => item.orderId === orderId)) {
      console.log(`[PPEmail] Order ${orderId} already in queue, skipping`);
      return;
    }

    queue.push({
      orderId,
      customerEmail,
      customerName: customerName || '',
      orderItemIds: productIds,
      firstProductId: productIds[0] || 0,
      sendAt: Date.now() + DELAY_MS,
      sent: false,
    });

    await writeQueue(queue);
    console.log(`[PPEmail] Scheduled for order ${orderId}, will send at ${new Date(Date.now() + DELAY_MS).toISOString()}`);
  } catch (err: any) {
    console.error(`[PPEmail] Failed to schedule for order ${orderId}:`, err?.message);
  }
}

async function generatePromoCode(orderId: number): Promise<{ code: string; discountPercent: number } | null> {
  try {
    const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    const code = `THANKS-${suffix}`;
    const expiresAt = new Date(Date.now() + PROMO_VALIDITY_HOURS * 60 * 60 * 1000);

    await storage.createPromoCode({
      code,
      discountPercent: PROMO_DISCOUNT,
      maxUses: 1,
      expiresAt,
      isActive: true,
    });

    console.log(`[PPEmail] Promo code created: ${code} for order ${orderId}`);
    return { code, discountPercent: PROMO_DISCOUNT };
  } catch (err: any) {
    console.error(`[PPEmail] Failed to create promo code for order ${orderId}:`, err?.message);
    return null;
  }
}

async function generateAiText(customerName: string, productNames: string[]): Promise<string> {
  try {
    const apiKey = process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY;
    const proxyUrl = process.env.GROQ_PROXY_URL;
    if (!apiKey && !proxyUrl) return '';

    const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, '') : 'https://api.groq.com';
    const firstName = (customerName || '').split(' ')[0] || '';
    const bought = productNames.length > 0 ? productNames.join(', ') : 'товары BOOOMERANGS';

    const prompt = `Ты — копирайтер бренда BOOOMERANGS (российский уличный стиль, streetwear).
Напиши 1-2 коротких предложения для email-письма после покупки. Максимум 60 слов.
Покупатель купил: ${bought}.
${firstName ? `Обращайся по имени: ${firstName}.` : ''}
Тон: живой, дружелюбный, без официоза. Упомяни что мы подобрали что-то интересное.
Только текст, без кавычек, без смайлов.`;

    const resp = await fetch(`${groqBase}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-32b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 120,
      }),
    });

    if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`);
    const data = (await resp.json()) as any;
    let text: string = (data.choices?.[0]?.message?.content || '').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return text;
  } catch (err: any) {
    console.error('[PPEmail] Groq error:', err?.message);
    return '';
  }
}

async function processQueue(): Promise<void> {
  const queue = await readQueue();
  const now = Date.now();
  const due = queue.filter(item => !item.sent && item.sendAt <= now);

  if (due.length === 0) return;
  console.log(`[PPEmail] Processing ${due.length} due item(s)`);

  const updatedQueue = queue.map(item => ({ ...item }));

  for (const item of due) {
    const idx = updatedQueue.findIndex(q => q.orderId === item.orderId);

    try {
      let recs: any[] = [];
      if (item.firstProductId > 0) {
        recs = await getRecommendations(item.firstProductId, storage, 3, item.orderItemIds);
      }
      if (recs.length < 2) {
        const allProducts = await storage.getProducts();
        const excludeSet = new Set(item.orderItemIds);
        const extras = allProducts
          .filter((p: any) =>
            !excludeSet.has(p.id) &&
            !p.isHidden &&
            p.price > 0 &&
            typeof p.imageUrl === 'string' &&
            p.imageUrl.startsWith('http')
          )
          .slice(0, 3 - recs.length);
        recs = [...recs, ...extras];
      }

      const promo = await generatePromoCode(item.orderId);
      if (!promo) {
        console.warn(`[PPEmail] Could not create promo for order ${item.orderId}, will retry next cycle`);
        continue;
      }

      const productNames = recs.slice(0, 2).map((p: any) => p.name).filter(Boolean);
      const aiText = await generateAiText(item.customerName, productNames);

      const html = getPostPurchaseEmailHtml({
        customerName: item.customerName,
        aiText,
        recommendations: recs.slice(0, 3),
        promoCode: promo.code,
        discountPercent: promo.discountPercent,
        validityHours: PROMO_VALIDITY_HOURS,
      });

      const sent = await sendEmail({
        to: item.customerEmail,
        subject: `Подарок за покупку — скидка ${promo.discountPercent}% на следующий заказ`,
        html,
      });

      if (sent) {
        if (idx !== -1) updatedQueue[idx].sent = true;
        console.log(`[PPEmail] Sent to ${item.customerEmail} for order ${item.orderId}`);
      } else {
        console.warn(`[PPEmail] sendEmail returned false for order ${item.orderId}`);
      }
    } catch (err: any) {
      console.error(`[PPEmail] Error processing order ${item.orderId}:`, err?.message);
    }
  }

  const cutoff = now - 48 * 60 * 60 * 1000;
  const cleaned = updatedQueue.filter(item => !item.sent && item.sendAt > cutoff);
  await writeQueue(cleaned);
}

export async function initPostPurchaseEmailJob(): Promise<void> {
  console.log('[PPEmail] Job initialized, interval: 3 min');

  setTimeout(async () => {
    await processQueue().catch(err => console.error('[PPEmail] Initial check failed:', err?.message));
  }, 15_000);

  setInterval(async () => {
    await processQueue().catch(err => console.error('[PPEmail] Check failed:', err?.message));
  }, CHECK_INTERVAL_MS);
}
