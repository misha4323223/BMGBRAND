/**
 * Preorder Status Scheduler
 *
 * Runs every hour and automatically transitions preorder product statuses
 * based on the dates configured in the admin panel:
 *
 *   collecting → production  when now >= preorderDeadline OR preorderProductionDate
 *   production → shipping    when now >= preorderShippingDate
 *
 * On the "shipping" transition it also:
 *   - Updates all paid orders to "processing"
 *   - Creates CDEK waybills for each order
 *   - Sends status-change emails to customers (one per unique email)
 *   - Notifies via Telegram and VK
 */

import { storage } from "./storage";
import { queuePreorderStatusEmail } from "./lib/preorder-email-buffer";
import { notifyPreorderStatusChange } from "./telegram";
import { vkNotifyPreorderStatusChange } from "./vk";
import { createCdekWaybillForOrder } from "./lib/cdek-waybill";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every hour
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000; // 3 min after server start (let YDB warm up)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateField(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // Accept ISO strings ("2026-07-27T00:00:00.000Z") and plain dates ("2026-07-27")
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

async function sendStatusEmails(
  productOrders: any[],
  productName: string,
  productId: number,
  status: string
): Promise<void> {
  const seenEmails = new Set<string>();
  for (const o of productOrders) {
    const email = o.customerEmail;
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);

    let cdekInfo: any = null;
    if (o.cdekData) {
      try { cdekInfo = JSON.parse(typeof o.cdekData === "string" ? o.cdekData : JSON.stringify(o.cdekData)); } catch {}
    }

    queuePreorderStatusEmail(email, {
      customerName: o.customerName || "Покупатель",
      productName,
      productId,
      status,
      cdekTrack:    cdekInfo?.cdekNumber || cdekInfo?.trackNumber || undefined,
      pointAddress: cdekInfo?.pointAddress || undefined,
    });
  }

  if (seenEmails.size > 0) {
    console.log(`[PreorderScheduler] Queued status emails for ${seenEmails.size} unique customers (${productOrders.length} orders) status=${status}`);
  }
}

// ─── Core check ───────────────────────────────────────────────────────────────

export async function runPreorderStatusCheck(): Promise<void> {
  try {
    const now = new Date();

    // getPreorderProducts returns only preorderEnabled && !isHidden products
    const products = await storage.getPreorderProducts();
    if (products.length === 0) return;

    for (const product of products) {
      const p = product as any;
      const currentStatus: string = p.preorderStatus || "collecting";

      // Skip terminal statuses — nothing to do
      if (currentStatus === "shipped" || currentStatus === "cancelled") continue;

      // ── collecting → production ──────────────────────────────────────────
      if (currentStatus === "collecting") {
        const deadline = parseDateField(p.preorderDeadline);
        const productionDate = parseDateField(p.preorderProductionDate);

        // Trigger if deadline passed OR production date passed (whichever comes first)
        const shouldSwitch =
          (deadline && now >= deadline) ||
          (productionDate && now >= productionDate);

        if (!shouldSwitch) continue;

        console.log(`[PreorderScheduler] Product #${p.id} "${p.name}": collecting → production (deadline=${p.preorderDeadline}, productionDate=${p.preorderProductionDate})`);
        await storage.updatePreorderStatus(p.id, "production");

        notifyPreorderStatusChange(p.name, p.id, "collecting", "production");
        vkNotifyPreorderStatusChange(p.name, p.id, "collecting", "production");

        // Notify customers
        const allOrders = await storage.getOrders();
        const productOrders = allOrders.filter((o: any) => {
          if (!o.isPreorder) return false;
          if (!["paid", "processing", "shipped", "delivered"].includes(o.status)) return false;
          const items = Array.isArray(o.items) ? o.items : (() => { try { return JSON.parse(String(o.items || "[]")); } catch { return []; } })();
          return items.some((i: any) => i.productId === p.id);
        });

        await sendStatusEmails(productOrders, p.name, p.id, "production");
        continue; // don't fall through to shipping check in the same tick
      }

      // ── production → shipping ────────────────────────────────────────────
      if (currentStatus === "production") {
        const shippingDate = parseDateField(p.preorderShippingDate);
        if (!shippingDate || now < shippingDate) continue;

        console.log(`[PreorderScheduler] Product #${p.id} "${p.name}": production → shipping (shippingDate=${p.preorderShippingDate})`);
        await storage.updatePreorderStatus(p.id, "shipping");

        notifyPreorderStatusChange(p.name, p.id, "production", "shipping");
        vkNotifyPreorderStatusChange(p.name, p.id, "production", "shipping");

        const allOrders = await storage.getOrders();
        const productOrders = allOrders.filter((o: any) => {
          if (!o.isPreorder) return false;
          if (!["paid", "processing", "shipped", "delivered"].includes(o.status)) return false;
          const items = Array.isArray(o.items) ? o.items : (() => { try { return JSON.parse(String(o.items || "[]")); } catch { return []; } })();
          return items.some((i: any) => i.productId === p.id);
        });

        // Update order statuses paid → processing
        for (const o of productOrders) {
          if (o.status === "paid") {
            await storage.updateOrderStatus(o.id, "processing");
            console.log(`[PreorderScheduler] Order #${o.id} status updated: paid → processing`);
          }
        }

        // Send customer emails
        await sendStatusEmails(productOrders, p.name, p.id, "shipping");

        // Create CDEK waybills (fire-and-forget — errors logged, don't block)
        console.log(`[PreorderScheduler] Creating CDEK waybills for ${productOrders.length} orders of product #${p.id}`);
        for (const o of productOrders) {
          createCdekWaybillForOrder(o.id)
            .then(r => console.log(`[PreorderScheduler] Waybill #${o.id}: ${r.success ? "OK uuid=" + r.uuid : "FAIL " + r.error}`))
            .catch(err => console.error(`[PreorderScheduler] Waybill error #${o.id}:`, err.message));
        }
      }
    }
  } catch (err: any) {
    console.error("[PreorderScheduler] Unexpected error in runPreorderStatusCheck:", err.message);
  }
}

// ─── Job entry point ──────────────────────────────────────────────────────────

export function startPreorderStatusScheduler(): void {
  setTimeout(() => {
    runPreorderStatusCheck();
    setInterval(runPreorderStatusCheck, CHECK_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);

  console.log("[PreorderScheduler] Started: first run in 3 min, then every 1 hour");
}
