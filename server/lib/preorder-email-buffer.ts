/**
 * Preorder status email buffer.
 *
 * Collects status-change notifications per customer email address and
 * flushes them as a single email after FLUSH_DELAY_MS (10 min).
 * This prevents a customer from receiving N separate emails when the admin
 * manually changes the status of N products one by one.
 *
 * Rules:
 *  - Timer starts on the FIRST entry for an email; it is NOT reset on
 *    subsequent entries. The flush always happens within 10 min of the
 *    first notification.
 *  - Dedup within one product is the caller's responsibility (pass each
 *    customer email only once per product).
 *  - 1 entry  → existing single-product template (unchanged look).
 *  - 2+ entries → new combined template listing all products.
 */

import { sendEmail, getPreorderStatusEmailHtml, getPreorderStatusBatchEmailHtml } from "../email";

const FLUSH_DELAY_MS = 10 * 60 * 1000; // 10 minutes

export interface PreorderEmailEntry {
  customerName: string;
  productName: string;
  productId: number;
  status: string;
  cdekTrack?: string;
  pointAddress?: string;
}

interface PendingBatch {
  entries: PreorderEmailEntry[];
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingBatch>();

/**
 * Queue a preorder status email for `email`.
 * If a batch for this email is already pending, the entry is appended
 * to the existing batch (timer is NOT reset).
 */
export function queuePreorderStatusEmail(
  email: string,
  entry: PreorderEmailEntry
): void {
  const existing = pending.get(email);
  if (existing) {
    existing.entries.push(entry);
    console.log(
      `[PreorderEmailBuffer] Appended to pending batch for ${email}: "${entry.productName}" (${entry.status}), batch size=${existing.entries.length}`
    );
  } else {
    const timer = setTimeout(() => flushBatch(email), FLUSH_DELAY_MS);
    pending.set(email, { entries: [entry], timer });
    console.log(
      `[PreorderEmailBuffer] New batch for ${email}: "${entry.productName}" (${entry.status}), flush in 10 min`
    );
  }
}

async function flushBatch(email: string): Promise<void> {
  const batch = pending.get(email);
  if (!batch) return;
  pending.delete(email);

  const { entries } = batch;
  if (entries.length === 0) return;

  const siteUrl = process.env.SITE_URL || "https://booomerangs.ru";

  try {
    if (entries.length === 1) {
      const e = entries[0];
      const subjectMap: Record<string, string> = {
        production: `Ваш предзаказ в производстве — ${e.productName}`,
        shipping:   `Ваш предзаказ готовится к отправке — ${e.productName}`,
        shipped:    `Ваш предзаказ отправлен — ${e.productName}`,
        cancelled:  `Предзаказ отменён — ${e.productName}`,
      };
      const html = getPreorderStatusEmailHtml({
        customerName: e.customerName,
        productName:  e.productName,
        newStatus:    e.status,
        trackNumber:  e.cdekTrack,
        pointAddress: e.pointAddress,
        productUrl:   `${siteUrl}/products/${e.productId}`,
      });
      const ok = await sendEmail({
        to: email,
        subject: subjectMap[e.status] || `Обновление предзаказа — ${e.productName}`,
        html,
      });
      console.log(`[PreorderEmailBuffer] Sent single to ${email}: ${ok ? "OK" : "FAIL"}`);
    } else {
      // Multiple products — one combined email
      const customerName = entries[0].customerName;
      const html = getPreorderStatusBatchEmailHtml({
        customerName,
        entries: entries.map(e => ({
          productName:  e.productName,
          productId:    e.productId,
          status:       e.status,
          cdekTrack:    e.cdekTrack,
          pointAddress: e.pointAddress,
          productUrl:   `${siteUrl}/products/${e.productId}`,
        })),
      });
      const statusVerb = entries.every(e => e.status === entries[0].status)
        ? entries[0].status
        : "обновлён";
      const subjectMap: Record<string, string> = {
        production: `Ваши предзаказы в производстве (${entries.length} товара)`,
        shipping:   `Ваши предзаказы готовятся к отправке (${entries.length} товара)`,
        shipped:    `Ваши предзаказы отправлены (${entries.length} товара)`,
        cancelled:  `Ваши предзаказы отменены (${entries.length} товара)`,
      };
      const subject = subjectMap[statusVerb] || `Обновление ваших предзаказов (${entries.length} товара)`;
      const ok = await sendEmail({ to: email, subject, html });
      console.log(
        `[PreorderEmailBuffer] Sent batch (${entries.length} products) to ${email}: ${ok ? "OK" : "FAIL"}`
      );
    }
  } catch (err: any) {
    console.error(`[PreorderEmailBuffer] Failed to flush batch for ${email}:`, err.message);
  }
}
