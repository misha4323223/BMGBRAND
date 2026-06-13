import { storage } from './storage';

const CLIENT_PUSH_KEY = 'push_subscriptions';
const ADMIN_PUSH_KEY = 'admin_push_subscriptions';

let _webPushReady = false;
let _wp: any = null;

function getWebPush(): any | null {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  if (!_wp) {
    _wp = require('web-push');
  }
  if (!_webPushReady) {
    _wp.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:info@booomerangs.ru',
      pub,
      priv,
    );
    _webPushReady = true;
  }
  return _wp;
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
    icon: payload.icon || '/favicon.ico',
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

export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  try {
    const subs = await getPushSubs();
    const result = await sendToList(subs, savePushSubs, payload);
    if (result.sent > 0 || result.failed > 0) {
      console.log(`[WebPush] Client push "${payload.title}": sent=${result.sent}, failed=${result.failed}`);
    }
    return result;
  } catch (err: any) {
    console.error('[WebPush] sendPushToAll error:', err?.message);
    return { sent: 0, failed: 0 };
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
