// Общие хелперы web-push подписки. Используются попапом, кнопкой в шапке/подвале и ЛК.

export type EnablePushResult = "subscribed" | "denied" | "unsupported" | "error";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS Safari: push надёжно работает только когда сайт добавлен «На экран "Домой"» (PWA).
export function isIosNeedsHomeScreen(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return false;
  const standalone =
    (navigator as any).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function saveSubscriptionToServer(sub: PushSubscription): Promise<void> {
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

// ВАЖНО: вызывать прямо из обработчика клика. Разрешение запрашивается ПЕРВЫМ,
// чтобы браузер сохранил «жест пользователя» (Safari/Chrome могут иначе заблокировать промпт).
export async function enablePush(): Promise<EnablePushResult> {
  if (!pushSupported()) return "unsupported";

  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await saveSubscriptionToServer(existing);
      return "subscribed";
    }

    const keyRes = await fetch("/api/push/vapid-public-key");
    if (!keyRes.ok) return "error";
    const { publicKey } = await keyRes.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await saveSubscriptionToServer(sub);
    return "subscribed";
  } catch {
    return "error";
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await sub.unsubscribe();
    await fetch("/api/push/unsubscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // тихо — на сервере подписка останется, но при следующей отправке 404/410 её подчистят
  }
}
