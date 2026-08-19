import { storage } from './storage';
import { sendEmail, getNewProductsNewsletterHtml } from './email';

const QUEUE_KEY = 'newsletter_new_product_queue';
const JOB_KEY = 'newsletter_new_product_send_job';

const DEBOUNCE_MS = 5 * 60 * 60 * 1000;        // 5 часов тишины → отправка (авто-режим, сейчас выключен)
const MAX_WAIT_MS = 12 * 60 * 60 * 1000;        // не ждать больше 12 часов
const CHECK_INTERVAL_MS = 10 * 60 * 1000;       // (зарезервировано) проверка каждые 10 минут
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;       // первый запуск фонового конвейера через 2 мин после старта
const EMAIL_SEND_DELAY_MS = 400;                 // пауза между письмами внутри пачки
const JOB_TICK_MS = 60 * 1000;                   // фон: следующая пачка через 1 минуту
const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;      // «зависшее» задание старше суток — завершаем
// Размер пачки писем за один «заход». 70 — безопасно для Postbox (Яндекс):
// одна пачка занимает ~1–2 минуты, что далеко от таймаута контейнера (10 мин).
const BATCH_SIZE = Math.max(1, parseInt(process.env.NEWSLETTER_BATCH_SIZE || '70', 10) || 70);

interface QueueState {
  productIds: number[];
  firstAddedAt: string;
  lastAddedAt: string;
}

interface SendJob {
  productIds: number[];
  totalProducts: number;
  emails: string[];
  offset: number;
  failed: string[];
  retryDone: boolean;
  startedAt: string;
  updatedAt: string;
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

async function readJob(): Promise<SendJob | null> {
  try {
    const raw = await storage.getBonusSetting(JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SendJob;
    if (!parsed || !Array.isArray(parsed.emails)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeJob(job: SendJob | null): Promise<void> {
  try {
    await storage.setBonusSetting(JOB_KEY, job ? JSON.stringify(job) : '');
  } catch (err: any) {
    console.error('[NewProductsNotifier] Failed to write job:', err?.message);
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

// Защита от гонки: пока одна пачка отправляется (например, внутри HTTP-запроса),
// фоновый таймер не должен стартовать ту же пачку повторно.
let batchRunning = false;

async function sendBatch(job: SendJob): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (batchRunning) return { sent: 0, failed: 0, skipped: true };
  batchRunning = true;
  try {
    const slice = job.emails.slice(job.offset, job.offset + BATCH_SIZE);
    if (slice.length === 0) return { sent: 0, failed: 0, skipped: false };

    const products: any[] = [];
    for (const id of job.productIds) {
      try {
        const p = await storage.getProduct(id);
        if (p && !(p as any).isHidden) products.push(p);
      } catch {}
    }
    if (products.length === 0) {
      console.log('[NewProductsNotifier] No visible products for this batch, marking emails as failed');
      job.failed.push(...slice);
      job.offset += slice.length;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
      return { sent: 0, failed: slice.length, skipped: false };
    }

    const html = getNewProductsNewsletterHtml(products, job.totalProducts);
    const subject = 'Смотри, что появилось 🆕';

    let sent = 0;
    let failed = 0;
    for (const email of slice) {
      try {
        const ok = await sendEmail({ to: email, subject, html: html(email) });
        if (ok) sent++;
        else {
          failed++;
          job.failed.push(email);
        }
      } catch {
        failed++;
        job.failed.push(email);
      }
      await new Promise(r => setTimeout(r, EMAIL_SEND_DELAY_MS));
    }
    job.offset += slice.length;
    job.updatedAt = new Date().toISOString();
    await writeJob(job);
    console.log(`[NewProductsNotifier] Batch done: ${slice.length} emails (sent: ${sent}, failed: ${failed}), offset ${job.offset}/${job.emails.length}`);
    return { sent, failed, skipped: false };
  } finally {
    batchRunning = false;
  }
}

// Завершение задания: очередь чистится ТОЛЬКО здесь (в конце), поэтому при
// падении/таймауте контейнера ни товары, ни прогресс не теряются.
async function finalizeJob(job: SendJob): Promise<void> {
  try {
    const queue = await readQueue();
    if (queue && queue.productIds.length > 0) {
      const sentSet = new Set(job.productIds);
      const remaining = queue.productIds.filter(id => !sentSet.has(id));
      await writeQueue({ productIds: remaining, firstAddedAt: queue.firstAddedAt, lastAddedAt: queue.lastAddedAt });
    } else {
      await writeQueue(null);
    }
  } catch (err: any) {
    console.error('[NewProductsNotifier] Failed to clean queue on finish:', err?.message);
  }
  await writeJob(null);
  console.log(`[NewProductsNotifier] Job finished. Remaining failed emails: ${job.failed.length}`);
}

export async function continueSendJob(): Promise<{
  status: 'no_job' | 'in_progress' | 'done';
  sent: number;
  failed: number;
  offset: number;
  total: number;
}> {
  const job = await readJob();
  if (!job) return { status: 'no_job', sent: 0, failed: 0, offset: 0, total: 0 };

  // Страховка: контейнер мог «спать» дольше суток — не даём заданию висеть вечно.
  const updatedAt = new Date(job.updatedAt).getTime();
  if (!Number.isNaN(updatedAt) && Date.now() - updatedAt > JOB_MAX_AGE_MS) {
    console.warn('[NewProductsNotifier] Job stalled >24h, finishing with remaining emails unsent');
    await finalizeJob(job);
    return { status: 'done', sent: 0, failed: 0, offset: job.emails.length, total: job.emails.length };
  }

  if (job.offset >= job.emails.length) {
    // Основная волна закончена: пробуем ещё раз упавшие адреса (тоже пачками)
    if (!job.retryDone && job.failed.length > 0) {
      job.retryDone = true;
      job.emails = job.failed.slice();
      job.failed = [];
      job.offset = 0;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
      const r = await sendBatch(job);
      return { status: 'in_progress', sent: r.sent, failed: r.failed, offset: job.offset, total: job.emails.length };
    }
    await finalizeJob(job);
    return { status: 'done', sent: 0, failed: 0, offset: job.offset, total: job.emails.length };
  }

  const r = await sendBatch(job);
  return { status: 'in_progress', sent: r.sent, failed: r.failed, offset: job.offset, total: job.emails.length };
}

export async function triggerNewProductsNotifierNow(): Promise<{
  started: boolean;
  alreadyRunning: boolean;
  sent: number;
  failed: number;
  products: number;
  total: number;
  totalEmails: number;
  progress: number;
}> {
  // Защита от двойного запуска: пока задание активно, повторный клик игнорируем
  const existing = await readJob();
  if (existing) {
    const totalEmails = existing.emails.length || 0;
    const progress = totalEmails ? Math.min(100, Math.round((existing.offset / totalEmails) * 100)) : 0;
    console.log(`[NewProductsNotifier] Send already in progress (${existing.offset}/${totalEmails}), ignoring duplicate trigger`);
    return { started: false, alreadyRunning: true, sent: 0, failed: 0, products: existing.totalProducts, total: existing.totalProducts, totalEmails, progress };
  }

  const queue = await readQueue();
  if (!queue || queue.productIds.length === 0) {
    return { started: false, alreadyRunning: false, sent: 0, failed: 0, products: 0, total: 0, totalEmails: 0, progress: 0 };
  }

  const productIds = queue.productIds;
  const products: any[] = [];
  for (const id of productIds) {
    try {
      const p = await storage.getProduct(id);
      if (p && !(p as any).isHidden) products.push(p);
    } catch {}
  }

  if (products.length === 0) {
    await clearQueue();
    return { started: false, alreadyRunning: false, sent: 0, failed: 0, products: 0, total: productIds.length, totalEmails: 0, progress: 0 };
  }

  const subscribers = await storage.getAllNewsletterSubscriptions();
  const emails = (subscribers || [])
    .map((s: any) => s?.email)
    .filter((e: any) => typeof e === 'string' && e.trim().length > 0);
  if (emails.length === 0) {
    await clearQueue();
    return { started: false, alreadyRunning: false, sent: 0, failed: 0, products: products.length, total: productIds.length, totalEmails: 0, progress: 0 };
  }

  const job: SendJob = {
    productIds,
    totalProducts: productIds.length,
    emails,
    offset: 0,
    failed: [],
    retryDone: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJob(job);
  console.log(`[NewProductsNotifier] Job started: ${emails.length} emails × ${products.length} products (batch=${BATCH_SIZE})`);

  // Первая пачка уходит сразу, чтобы рассылка не ждала фонового таймера
  const r = await sendBatch(job);
  return {
    started: true,
    alreadyRunning: false,
    sent: r.sent,
    failed: r.failed,
    products: products.length,
    total: productIds.length,
    totalEmails: emails.length,
    progress: Math.min(100, Math.round((job.offset / emails.length) * 100)),
  };
}

export async function removeFromNewProductsQueue(productId: number): Promise<void> {
  try {
    const existing = await readQueue();
    if (!existing || existing.productIds.length === 0) return;
    existing.productIds = existing.productIds.filter(id => id !== productId);
    await writeQueue(existing);
    console.log(`[NewProductsNotifier] Removed product ${productId}, queue size: ${existing.productIds.length}`);
  } catch (err: any) {
    console.error('[NewProductsNotifier] removeFromNewProductsQueue error:', err?.message);
  }
}

export async function addToNewProductsQueueManual(productId: number): Promise<void> {
  return enqueueNewProduct(productId);
}

interface ProductPreview {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  slug: string;
}

export async function getNewProductsQueueStatus(): Promise<{ count: number; firstAddedAt: string | null; lastAddedAt: string | null; minutesUntilSend: number | null; productIds: number[]; products: ProductPreview[] }> {
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

    // Авто-режим запускает ту же пачечную рассылку (не блокирует процесс ожиданием всех писем)
    const result = await triggerNewProductsNotifierNow();
    console.log(`[NewProductsNotifier] Digest started via job: ${JSON.stringify({ started: result.started, alreadyRunning: result.alreadyRunning, totalEmails: result.totalEmails, products: result.products })}`);
  } catch (err: any) {
    console.error('[NewProductsNotifier] Job crashed:', err?.message);
  }
}

let batchWorkerStarted = false;

export function startNewProductsNotifierJob(): void {
  if (batchWorkerStarted) return;
  batchWorkerStarted = true;

  // Авто-дайджест (по дебаунсу) по-прежнему отключён: запуск только через кнопку
  // «Отправить сейчас» в админке. Но фоновый конвейер пачек обязан работать —
  // он доводит начатую рассылку до конца пачками по BATCH_SIZE (иначе контейнер
  // не успел бы разослать все письма за один запрос).
  setTimeout(() => {
    continueSendJob().catch((err: any) => console.error('[NewProductsNotifier] Batch worker first run failed:', err?.message));
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    continueSendJob().catch((err: any) => console.error('[NewProductsNotifier] Batch worker run failed:', err?.message));
  }, JOB_TICK_MS);

  console.log(`[NewProductsNotifier] Batch worker started (${BATCH_SIZE} emails per tick, tick every ${JOB_TICK_MS / 1000}s). Auto-digest DISABLED: manual send only.`);
}
