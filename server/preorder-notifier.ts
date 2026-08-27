import { storage } from './storage';
import { logError } from "./logger";
import { sendEmail, getPreorderNewsletterHtml } from './email';

const QUEUE_KEY = 'preorder_notify_queue';
const DEBOUNCE_MS = 5 * 60 * 60 * 1000;        // 5 часов тишины → отправка
const MAX_WAIT_MS = 12 * 60 * 60 * 1000;        // не ждать больше 12 часов
const CHECK_INTERVAL_MS = 60 * 60 * 1000;       // проверка каждый час
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;       // первый запуск через 2 мин после старта
const EMAIL_SEND_DELAY_MS = 400;                 // пауза между письмами

interface QueueState {
  productIds: number[];
  firstAddedAt: string;
  lastAddedAt: string;
}

async function readQueue(): Promise<QueueState | null> {
  try {
    const raw = await storage.getBonusSetting(QUEUE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QueueState;
  } catch {
    return null;
  }
}

async function writeQueue(state: QueueState | null): Promise<void> {
  try {
    await storage.setBonusSetting(QUEUE_KEY, state ? JSON.stringify(state) : JSON.stringify({ productIds: [], firstAddedAt: '', lastAddedAt: '' }));
  } catch (err: any) {
    logError('[PreorderNotifier] Failed to write queue:', err?.message);
  }
}

export async function enqueuePreorderProduct(productId: number): Promise<void> {
  try {
    const existing = await readQueue();
    const now = new Date().toISOString();
    if (!existing || existing.productIds.length === 0) {
      await writeQueue({ productIds: [productId], firstAddedAt: now, lastAddedAt: now });
    } else {
      if (!existing.productIds.includes(productId)) {
        existing.productIds.push(productId);
      }
      existing.lastAddedAt = now;
      await writeQueue(existing);
    }
    console.log(`[PreorderNotifier] Enqueued product ${productId}, queue size: ${(existing?.productIds.length || 0) + 1}`);
  } catch (err: any) {
    logError('[PreorderNotifier] enqueuePreorderProduct error:', err?.message);
  }
}

async function clearQueue(): Promise<void> {
  await writeQueue({ productIds: [], firstAddedAt: '', lastAddedAt: '' });
}

export async function runPreorderNotifierCheck(): Promise<void> {
  try {
    const enabled = await storage.getBonusSetting('newsletter_preorder_enabled');
    if (enabled === 'false') {
      console.log('[PreorderNotifier] Disabled via admin settings, skipping');
      return;
    }
    const queue = await readQueue();
    if (!queue || queue.productIds.length === 0) return;

    const now = Date.now();
    const lastAdded = new Date(queue.lastAddedAt).getTime();
    const firstAdded = new Date(queue.firstAddedAt).getTime();

    const silentEnough = now - lastAdded >= DEBOUNCE_MS;
    const waitedTooLong = now - firstAdded >= MAX_WAIT_MS;

    if (!silentEnough && !waitedTooLong) {
      const minsLeft = Math.ceil((DEBOUNCE_MS - (now - lastAdded)) / 60000);
      console.log(`[PreorderNotifier] Queue has ${queue.productIds.length} products, waiting ${minsLeft} more min (debounce)`);
      return;
    }

    console.log(`[PreorderNotifier] Sending digest for ${queue.productIds.length} products (silent: ${silentEnough}, maxWait: ${waitedTooLong})`);

    const productIds = queue.productIds;
    await clearQueue();

    const products: any[] = [];
    for (const id of productIds) {
      try {
        const p = await storage.getProduct(id);
        if (p && !(p as any).isHidden && (p as any).preorderEnabled) products.push(p);
      } catch {}
    }

    if (products.length === 0) {
      console.log('[PreorderNotifier] All products hidden/disabled or not found, skipping send');
      return;
    }

    const allSubscribers = await storage.getAllPreorderSubscribers();
    const subscribers = allSubscribers.filter(s => s.isActive);
    if (subscribers.length === 0) {
      console.log('[PreorderNotifier] No active subscribers, skipping send');
      return;
    }

    const htmlFn = getPreorderNewsletterHtml(products, productIds.length);
    const subject = products.length === 1
      ? `Открыт предзаказ: ${products[0].name} — BOOOMERANGS`
      : `Открылось ${productIds.length} новых предзаказов — BOOOMERANGS`;

    let sent = 0;
    let failed = 0;
    for (const sub of subscribers) {
      const email = (sub as any).email;
      if (!email) continue;
      try {
        const ok = await sendEmail({ to: email, subject, html: htmlFn(email) });
        if (ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
      await new Promise(r => setTimeout(r, EMAIL_SEND_DELAY_MS));
    }

    console.log(`[PreorderNotifier] Done. Sent: ${sent}, failed: ${failed}, products in digest: ${products.length} (of ${productIds.length} total)`);
  } catch (err: any) {
    logError('[PreorderNotifier] Job crashed:', err?.message);
  }
}

export async function triggerPreorderNotifierNow(): Promise<{ sent: number; failed: number; products: number; total: number }> {
  const queue = await readQueue();
  if (!queue || queue.productIds.length === 0) {
    return { sent: 0, failed: 0, products: 0, total: 0 };
  }

  const productIds = queue.productIds;
  await clearQueue();

  const products: any[] = [];
  for (const id of productIds) {
    try {
      const p = await storage.getProduct(id);
      if (p && !(p as any).isHidden && (p as any).preorderEnabled) products.push(p);
    } catch {}
  }

  if (products.length === 0) return { sent: 0, failed: 0, products: 0, total: productIds.length };

  const allSubscribers = await storage.getAllPreorderSubscribers();
  const subscribers = allSubscribers.filter(s => s.isActive);
  if (subscribers.length === 0) return { sent: 0, failed: 0, products: products.length, total: productIds.length };

  const htmlFn = getPreorderNewsletterHtml(products, productIds.length);
  const subject = products.length === 1
    ? `Открыт предзаказ: ${products[0].name} — BOOOMERANGS`
    : `Открылось ${productIds.length} новых предзаказов — BOOOMERANGS`;

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const email = (sub as any).email;
    if (!email) continue;
    try {
      const ok = await sendEmail({ to: email, subject, html: htmlFn(email) });
      if (ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, EMAIL_SEND_DELAY_MS));
  }

  return { sent, failed, products: products.length, total: productIds.length };
}

export async function removeFromPreorderQueue(productId: number): Promise<void> {
  try {
    const existing = await readQueue();
    if (!existing || existing.productIds.length === 0) return;
    existing.productIds = existing.productIds.filter(id => id !== productId);
    await writeQueue(existing);
    console.log(`[PreorderNotifier] Removed product ${productId}, queue size: ${existing.productIds.length}`);
  } catch (err: any) {
    logError('[PreorderNotifier] removeFromPreorderQueue error:', err?.message);
  }
}

export async function addToPreorderQueueManual(productId: number): Promise<void> {
  return enqueuePreorderProduct(productId);
}

interface ProductPreview {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  slug: string;
}

export async function getPreorderQueueStatus(): Promise<{ count: number; firstAddedAt: string | null; lastAddedAt: string | null; minutesUntilSend: number | null; productIds: number[]; products: ProductPreview[] }> {
  const queue = await readQueue();
  if (!queue || queue.productIds.length === 0) {
    return { count: 0, firstAddedAt: null, lastAddedAt: null, minutesUntilSend: null, productIds: [], products: [] };
  }
  const now = Date.now();
  const lastAdded = new Date(queue.lastAddedAt).getTime();
  const remaining = Math.max(0, DEBOUNCE_MS - (now - lastAdded));

  const products: ProductPreview[] = [];
  for (const id of queue.productIds) {
    try {
      const p = await storage.getProduct(id);
      if (p) {
        products.push({
          id: p.id,
          name: p.name,
          price: p.price ?? 0,
          imageUrl: (p as any).thumbnailUrl || p.imageUrl || '',
          slug: p.slug ?? '',
        });
      }
    } catch {}
  }

  return {
    count: queue.productIds.length,
    firstAddedAt: queue.firstAddedAt,
    lastAddedAt: queue.lastAddedAt,
    minutesUntilSend: Math.ceil(remaining / 60000),
    productIds: queue.productIds,
    products,
  };
}

export function startPreorderNotifierJob(): void {
  // Авторассылка отключена — только ручной запуск через кнопку "Отправить сейчас" в админке
  console.log('[PreorderNotifier] Auto-send DISABLED: manual send only (admin panel → Рассылки → Предзаказы)');
}
