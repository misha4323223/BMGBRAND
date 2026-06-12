import { storage } from './storage';
import { sendEmail, getNewProductsNewsletterHtml } from './email';

const QUEUE_KEY = 'newsletter_new_product_queue';
const DEBOUNCE_MS = 5 * 60 * 60 * 1000;        // 5 часов тишины → отправка
const MAX_WAIT_MS = 12 * 60 * 60 * 1000;        // не ждать больше 12 часов
const CHECK_INTERVAL_MS = 10 * 60 * 1000;       // проверка каждые 10 минут
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;       // первый запуск через 2 мин после старта
const MAX_PRODUCTS_IN_EMAIL = 5;
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
    console.error('[NewProductsNotifier] Failed to write queue:', err?.message);
  }
}

export async function enqueueNewProduct(productId: number): Promise<void> {
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
    console.log(`[NewProductsNotifier] Enqueued product ${productId}, queue size: ${(existing?.productIds.length || 0) + 1}`);
  } catch (err: any) {
    console.error('[NewProductsNotifier] enqueueNewProduct error:', err?.message);
  }
}

async function clearQueue(): Promise<void> {
  await writeQueue({ productIds: [], firstAddedAt: '', lastAddedAt: '' });
}

export async function runNewProductsNotifierCheck(): Promise<void> {
  try {
    const enabled = await storage.getBonusSetting('newsletter_new_products_enabled');
    if (enabled === 'false') {
      console.log('[NewProductsNotifier] Disabled via admin settings, skipping');
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
      console.log(`[NewProductsNotifier] Queue has ${queue.productIds.length} products, waiting ${minsLeft} more min (debounce)`);
      return;
    }

    console.log(`[NewProductsNotifier] Sending digest for ${queue.productIds.length} products (silent: ${silentEnough}, maxWait: ${waitedTooLong})`);

    const productIds = queue.productIds;
    await clearQueue();

    const products: any[] = [];
    for (const id of productIds) {
      try {
        const p = await storage.getProduct(id);
        if (p && !(p as any).isHidden) products.push(p);
      } catch {}
    }

    if (products.length === 0) {
      console.log('[NewProductsNotifier] All products hidden or not found, skipping send');
      return;
    }

    const subscribers = await storage.getAllNewsletterSubscriptions();
    if (subscribers.length === 0) {
      console.log('[NewProductsNotifier] No subscribers, skipping send');
      return;
    }

    const html = getNewProductsNewsletterHtml(products, productIds.length);
    const subject = 'Смотри, что появилось 🆕';

    let sent = 0;
    let failed = 0;
    for (const sub of subscribers) {
      const email = (sub as any).email;
      if (!email) continue;
      try {
        const ok = await sendEmail({ to: email, subject, html: html(email) });
        if (ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
      await new Promise(r => setTimeout(r, EMAIL_SEND_DELAY_MS));
    }

    console.log(`[NewProductsNotifier] Done. Sent: ${sent}, failed: ${failed}, products in digest: ${products.length} (of ${productIds.length} total)`);
  } catch (err: any) {
    console.error('[NewProductsNotifier] Job crashed:', err?.message);
  }
}

export async function triggerNewProductsNotifierNow(): Promise<{ sent: number; failed: number; products: number; total: number }> {
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
      if (p && !(p as any).isHidden) products.push(p);
    } catch {}
  }

  if (products.length === 0) return { sent: 0, failed: 0, products: 0, total: productIds.length };

  const subscribers = await storage.getAllNewsletterSubscriptions();
  if (subscribers.length === 0) return { sent: 0, failed: 0, products: products.length, total: productIds.length };

  const html = getNewProductsNewsletterHtml(products, productIds.length);
  const subject = 'Смотри, что появилось 🆕';

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const email = (sub as any).email;
    if (!email) continue;
    try {
      const ok = await sendEmail({ to: email, subject, html: html(email) });
      if (ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, EMAIL_SEND_DELAY_MS));
  }

  return { sent, failed, products: products.length, total: productIds.length };
}

export async function getNewProductsQueueStatus(): Promise<{ count: number; firstAddedAt: string | null; lastAddedAt: string | null; minutesUntilSend: number | null; productIds: number[] }> {
  const queue = await readQueue();
  if (!queue || queue.productIds.length === 0) {
    return { count: 0, firstAddedAt: null, lastAddedAt: null, minutesUntilSend: null, productIds: [] };
  }
  const now = Date.now();
  const lastAdded = new Date(queue.lastAddedAt).getTime();
  const remaining = Math.max(0, DEBOUNCE_MS - (now - lastAdded));
  return {
    count: queue.productIds.length,
    firstAddedAt: queue.firstAddedAt,
    lastAddedAt: queue.lastAddedAt,
    minutesUntilSend: Math.ceil(remaining / 60000),
    productIds: queue.productIds,
  };
}

export function startNewProductsNotifierJob(): void {
  setTimeout(() => {
    runNewProductsNotifierCheck();
    setInterval(runNewProductsNotifierCheck, CHECK_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
  console.log('[NewProductsNotifier] Job scheduled: first run in 2 min, then every 10 min');
}
