/**
 * Страховочный watcher для VK-уведомлений об оплаченных заказах.
 *
 * Зачем: уведомления в VK-чат отправляются из вебхуков оплаты (ЮKassa/T-Bank),
 * но если вебхук не дошёл или VK API ответил ошибкой — заказ молча теряется.
 * Этот watcher раз в несколько минут сканирует оплаченные заказы и досылает
 * в VK те, у которых нет отметки `vkNotifiedAt` в orders.addon_data.
 *
 * Дедупликация: `vkNotifyNewOrder` сам ставит отметку после успешной отправки
 * (см. server/vk.ts → markOrderVkNotified), поэтому повторно отправляется
 * только то, что реально не ушло. Telegram не трогаем — только VK.
 *
 * Интервал: раз в час (первый проход — через 15 секунд после старта сервера).
 */
import { storage } from "./storage";
import { logError, logWarn } from "./logger";
import { vkNotifyNewOrder } from "./vk";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;  // проверка каждый час
const FIRST_RUN_DELAY_MS = 15 * 1000;      // первый проход — чуть позже старта сервера
const MAX_SENDS_PER_RUN = 20;              // лимит за один проход (защита от флуда при накоплении)
// Заказы, созданные раньше этого порога относительно первого запуска watcher'а,
// пропускаем: они уже были обработаны старым кодом без отметок, и их повторная
// отправка создала бы дубли в VK-чате.
const PRE_DEPLOY_GRACE_MS = 5 * 60 * 1000;

let watcherRunning = false;
let watcherStarted = false;
let startedAt = 0;

// Копия логики enrichItemsWithProductColor из server/routes.ts — чтобы сообщения
// watcher'а выглядели так же, как у вебхуков (подставляет реальный цвет товара).
async function enrichColor(items: any[]): Promise<any[]> {
  if (!Array.isArray(items)) return items;
  return Promise.all(items.map(async (it: any) => {
    if (!it || it._discountDetails) return it;
    const current = String(it.color || "").trim();
    if (current && current.toLowerCase() !== "default") return it;
    const pid = Number(it.productId);
    if (!pid) return it;
    try {
      const product = await storage.getProduct(pid);
      const productColor = product?.color?.trim();
      if (productColor && productColor.toLowerCase() !== "default") {
        return { ...it, color: productColor };
      }
    } catch (err: any) {
      logWarn(`[VK Watcher] enrich color: failed to load product ${pid}:`, err?.message);
    }
    return it;
  }));
}

async function sendPendingVkNotifications(): Promise<void> {
  if (watcherRunning) return;
  watcherRunning = true;
  try {
    const { VK_USER_TOKEN, VK_CHAT_PEER_ID } = process.env;
    if (!VK_USER_TOKEN || !VK_CHAT_PEER_ID) {
      console.log("[VK Watcher] VK not configured, skipping");
      return;
    }

    const cutoff = startedAt - PRE_DEPLOY_GRACE_MS;
    const paidOrders = await storage.getOrdersByStatus("paid");
    let sent = 0;

    for (const row of paidOrders) {
      if (sent >= MAX_SENDS_PER_RUN) break;

      // Проверяем возраст заказа по created_at (окно от первого запуска watcher'а).
      const createdAt = row.createdAt ? new Date(row.createdAt as any).getTime() : 0;
      if (!createdAt || createdAt < cutoff) continue;

      const order = await storage.getOrder(row.id);
      if (!order) continue;
      // Предзаказы уведомляются отдельным форматом (deposit) — не трогаем.
      if (order.isPreorder) continue;

      let addon: Record<string, any> = {};
      try {
        addon = JSON.parse(order.addonData || "{}");
      } catch {
        addon = {};
      }
      if (addon.vkNotifiedAt) continue;

      const items = await enrichColor(Array.isArray(order.items) ? order.items : []);
      const ok = await vkNotifyNewOrder({
        orderId: order.id,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        address: order.address || "",
        total: order.total,
        items,
        isWholesale: order.isWholesale || false,
        promoCode: order.promoCode || undefined,
        deliveryService: order.deliveryService || undefined,
      });
      if (ok) {
        sent++;
        console.log(`[VK Watcher] Order #${order.id} notified to VK`);
      }
    }

    if (sent > 0) {
      console.log(`[VK Watcher] Done, ${sent} order(s) notified`);
    }
  } catch (err: any) {
    logError("[VK Watcher] Error:", err?.message);
  } finally {
    watcherRunning = false;
  }
}

export function startOrderNotifyWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  startedAt = Date.now();
  console.log("[VK Watcher] Started (check every 60 min)");

  setTimeout(() => {
    sendPendingVkNotifications().catch((err: any) =>
      logError("[VK Watcher] First run failed:", err?.message)
    );
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    sendPendingVkNotifications().catch((err: any) =>
      logError("[VK Watcher] Run failed:", err?.message)
    );
  }, CHECK_INTERVAL_MS);
}
