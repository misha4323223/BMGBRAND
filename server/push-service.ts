import { storage } from './storage';
import webpush from 'web-push';

const CLIENT_PUSH_KEY = 'push_subscriptions';
const ADMIN_PUSH_KEY = 'admin_push_subscriptions';

// ─── In-memory locks ──────────────────────────────────────────────────────────
// Защита от race condition при одновременных подписках/отписках.
// Тот же паттерн что в partner-routes.ts (payoutUploadLocks, payoutRequestLocks)
// и admin-partner-routes.ts (payoutCreateLocks).
// ВНИМАНИЕ: in-memory — работает только в single-instance Yandex Cloud Container.
const _pushSubsLocks = new Map<'client' | 'admin', number>();
const PUSH_LOCK_TTL_MS = 10_000; // 10 сек достаточно для read→modify→write

export function acquirePushLock(type: 'client' | 'admin'): boolean {
  const now = Date.now();
  const existing = _pushSubsLocks.get(type);
  if (existing && now - existing < PUSH_LOCK_TTL_MS) return false;
  _pushSubsLocks.set(type, now);
  return true;
}

export function releasePushLock(type: 'client' | 'admin'): void {
  _pushSubsLocks.delete(type);
}

let _vapidReady = false;

function getWebPush(): typeof webpush | null {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  if (!_vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:info@booomerangs.ru',
      pub,
      priv,
    );
    _vapidReady = true;
  }
  return webpush;
}

export async function getPushSubs(): Promise<any[]> {
  try {
    const raw = await storage.getBonusSetting(CLIENT_PUSH_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function savePushSubs(subs: any[]): Promise<void> {
  await storage.setBonusSetting(CLIENT_PUSH_KEY, JSON.stringify(subs));
}

export async function getAdminPushSubs(): Promise<any[]> {
  try {
    const raw = await storage.getBonusSetting(ADMIN_PUSH_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveAdminPushSubs(subs: any[]): Promise<void> {
  await storage.setBonusSetting(ADMIN_PUSH_KEY, JSON.stringify(subs));
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
  image?: string;
}

async function sendToList(
  subs: any[],
  saveFn: (subs: any[]) => Promise<void>,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const wp = getWebPush();
  if (!wp || subs.length === 0) return { sent: 0, failed: 0 };

  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || 'https://booomerangs.ru',
    icon: payload.icon || '/icon-192.png',
    badge: '/notification-badge.png',
    tag: payload.tag || 'booom-push',
    image: payload.image,
  });

  let sent = 0;
  let failed = 0;
  const toRemove: string[] = [];

  for (const sub of subs) {
    try {
      await wp.sendNotification(sub, payloadStr);
      sent++;
    } catch (err: any) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        toRemove.push(sub.endpoint);
      }
    }
    await new Promise(r => setTimeout(r, 20));
  }

  if (toRemove.length > 0) {
    const cleaned = subs.filter((s: any) => !toRemove.includes(s.endpoint));
    await saveFn(cleaned);
  }

  return { sent, failed };
}

// ─── История рассылок (последние 20) ──────────────────────────────────────────
export interface PushHistoryEntry {
  title: string;
  body: string;
  url?: string;
  image?: string;
  tag?: string;
  sentAt: string;   // ISO
  sent: number;
  failed: number;
  total: number;
}

const _pushHistory: PushHistoryEntry[] = [];
const MAX_HISTORY = 20;

export function getPushHistory(): PushHistoryEntry[] {
  return [..._pushHistory].reverse(); // новые первыми
}

function addToHistory(payload: PushPayload, result: { sent: number; failed: number }, total: number): void {
  _pushHistory.push({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    image: payload.image,
    tag: payload.tag,
    sentAt: new Date().toISOString(),
    sent: result.sent,
    failed: result.failed,
    total,
  });
  if (_pushHistory.length > MAX_HISTORY) _pushHistory.shift();
}

export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  try {
    const subs = await getPushSubs();
    const result = await sendToList(subs, savePushSubs, payload);
    if (result.sent > 0 || result.failed > 0) {
      console.log(`[WebPush] Client push "${payload.title}": sent=${result.sent}, failed=${result.failed}`);
    }
    addToHistory(payload, result, subs.length);
    return result;
  } catch (err: any) {
    console.error('[WebPush] sendPushToAll error:', err?.message);
    return { sent: 0, failed: 0 };
  }
}

// ─── Отправка пуша конкретному пользователю по userId ─────────────────────────
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const allSubs = await getPushSubs();
    const userSubs = allSubs.filter((s: any) => s.userId === userId);
    if (userSubs.length === 0) return;

    const wp = getWebPush();
    if (!wp) return;

    const payloadStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || 'https://booomerangs.ru',
      icon: payload.icon || '/icon-192.png',
      badge: '/notification-badge.png',
      tag: payload.tag || 'order-status',
    });

    const toRemove: string[] = [];
    for (const sub of userSubs) {
      try {
        await wp.sendNotification(sub, payloadStr);
        console.log(`[WebPush] Order push sent to user ${userId}`);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) toRemove.push(sub.endpoint);
      }
    }
    if (toRemove.length > 0) {
      await savePushSubs(allSubs.filter((s: any) => !toRemove.includes(s.endpoint)));
    }
  } catch (err: any) {
    console.error('[WebPush] sendPushToUser error:', err?.message);
  }
}

// Текст пуша по статусу заказа (null — не отправлять для данного статуса)
export function orderStatusPushPayload(
  orderId: number,
  status: string,
): { title: string; body: string; url: string; tag: string } | null {
  const url = `/account`;
  const tag = `order-${orderId}`;
  switch (status) {
    case 'paid':
      return { title: 'Заказ оплачен ✓', body: `Заказ #${orderId} оплачен и передан в обработку.`, url, tag };
    case 'processing':
      return { title: 'Заказ в обработке', body: `Заказ #${orderId} принят и комплектуется.`, url, tag };
    case 'shipped':
      return { title: 'Заказ отправлен 📦', body: `Заказ #${orderId} передан в службу доставки.`, url, tag };
    case 'delivered':
      return { title: 'Заказ доставлен ✓', body: `Заказ #${orderId} доставлен. Спасибо за покупку!`, url, tag };
    case 'ready_for_pickup':
      return { title: 'Готов к выдаче! 📍', body: `Заказ #${orderId} ждёт в пункте выдачи.`, url, tag };
    case 'cancelled':
      return { title: 'Заказ отменён', body: `Заказ #${orderId} был отменён.`, url, tag };
    default:
      return null;
  }
}

export async function sendPushToAdmins(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  try {
    const subs = await getAdminPushSubs();
    const result = await sendToList(subs, saveAdminPushSubs, payload);
    if (result.sent > 0 || result.failed > 0) {
      console.log(`[WebPush] Admin push "${payload.title}": sent=${result.sent}, failed=${result.failed}`);
    }
    return result;
  } catch (err: any) {
    console.error('[WebPush] sendPushToAdmins error:', err?.message);
    return { sent: 0, failed: 0 };
  }
}
