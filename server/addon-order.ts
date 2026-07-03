import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { paymentService } from "./payments";
import { notifyAddonOrderPaid } from "./telegram";
import { vkNotifyAddonOrderPaid } from "./vk";
import { sendEmail, getAddonOrderEmailHtml } from "./email";
import { authMiddleware } from "./auth-routes";

export interface AddonItem {
  productId: number;
  productName: string;
  size?: string;
  color?: string;
  quantity: number;
  price: number;
  sku?: string;
  imageUrl?: string;
}

export interface AddonData {
  status: "awaiting_payment" | "paid" | "expired" | "failed";
  paymentId?: string;
  paymentMethod?: string;
  items: AddonItem[];
  addedTotal: number;
  initiatedAt: string;
  paidAt?: string;
}

export function parseAddonData(raw: string | null | undefined): AddonData | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as AddonData; } catch { return null; }
}

const ADDON_WINDOW_HOURS = 12;
const ADDON_PAYMENT_TTL_MINUTES = 30;

const addonInitiateLocks = new Set<number>();

export async function processAddonOrderPaid(
  orderId: number,
  paymentId: string,
  paymentMethod: string,
  logPrefix: string
): Promise<void> {
  const order = await storage.getOrder(orderId);
  if (!order) {
    console.error(`${logPrefix} processAddonOrderPaid: order ${orderId} not found`);
    return;
  }

  const addonData = parseAddonData((order as any).addonData);
  if (!addonData) {
    console.error(`${logPrefix} processAddonOrderPaid: no addonData on order ${orderId}`);
    return;
  }
  if (addonData.status === "paid") {
    console.log(`${logPrefix} processAddonOrderPaid: order ${orderId} addon already paid, skipping`);
    return;
  }

  addonData.status = "paid";
  addonData.paymentId = paymentId;
  addonData.paymentMethod = paymentMethod;
  addonData.paidAt = new Date().toISOString();
  await storage.updateOrderAddonData(orderId, JSON.stringify(addonData));
  console.log(`${logPrefix} Addon order ${orderId} marked as paid, addedTotal=${addonData.addedTotal}`);

  try {
    await storage.appendOrderItems(orderId, addonData.items, addonData.addedTotal);
    console.log(`${logPrefix} Appended ${addonData.items.length} items to order ${orderId}`);
  } catch (err: any) {
    console.error(`${logPrefix} appendOrderItems failed for order ${orderId}:`, err.message);
  }

  try {
    notifyAddonOrderPaid(
      {
        id: orderId,
        customerName: order.customerName || "Покупатель",
        customerPhone: (order as any).customerPhone || "",
        customerEmail: order.customerEmail || "",
      },
      addonData.items,
      addonData.addedTotal
    );
  } catch (err: any) {
    console.error(`${logPrefix} Telegram notify failed:`, err.message);
  }

  try {
    vkNotifyAddonOrderPaid(
      {
        id: orderId,
        customerName: order.customerName || "Покупатель",
        customerPhone: (order as any).customerPhone || "",
        customerEmail: order.customerEmail || "",
      },
      addonData.items,
      addonData.addedTotal
    );
  } catch (err: any) {
    console.error(`${logPrefix} VK notify failed:`, err.message);
  }

  try {
    if (order.customerEmail) {
      const html = getAddonOrderEmailHtml({
        id: orderId,
        customerName: order.customerName || "Покупатель",
        addedTotal: addonData.addedTotal,
        addonItems: addonData.items,
      });
      await sendEmail({
        to: order.customerEmail,
        subject: `Дозаказ к заказу #${orderId} оформлен — BOOOMERANGS`,
        html,
      });
      console.log(`${logPrefix} Addon email sent to ${order.customerEmail}`);
    }
  } catch (err: any) {
    console.error(`${logPrefix} Email notify failed:`, err.message);
  }
}

export function registerAddonOrderRoutes(app: Express): void {
  app.get("/api/orders/:id/addon-eligible", authMiddleware, async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ eligible: false, reason: "invalid_id" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ eligible: false, reason: "not_found" });

      const userId = (req as any).user?.id;
      const sessionId = req.sessionID;
      const isOwner =
        (userId && order.userId === userId) ||
        (userId && order.sessionId === `user_${userId}`) ||
        (order.sessionId === sessionId);
      if (!isOwner) return res.status(403).json({ eligible: false, reason: "forbidden" });

      if (!["paid", "confirmed", "processing"].includes(order.status)) {
        return res.json({ eligible: false, reason: "status" });
      }

      const ageMs = Date.now() - new Date((order as any).createdAt || 0).getTime();
      if (ageMs > ADDON_WINDOW_HOURS * 60 * 60 * 1000) {
        return res.json({ eligible: false, reason: "too_old" });
      }

      const existingAddon = parseAddonData((order as any).addonData);
      if (existingAddon?.status === "paid") {
        return res.json({ eligible: false, reason: "already_added" });
      }
      if (existingAddon?.status === "awaiting_payment") {
        const initiatedMs = new Date(existingAddon.initiatedAt).getTime();
        if (Date.now() - initiatedMs <= ADDON_PAYMENT_TTL_MINUTES * 60 * 1000) {
          return res.json({ eligible: true, addonPending: true, pendingPaymentMethod: existingAddon.paymentMethod });
        }
      }

      return res.json({ eligible: true, addonPending: false });
    } catch (err: any) {
      console.error("[AddonOrder] eligible error:", err.message);
      return res.status(500).json({ eligible: false, reason: "server_error" });
    }
  });

  const initiateSchema = z.object({
    items: z.array(z.object({
      productId: z.number(),
      size: z.string().optional(),
      color: z.string().optional(),
      quantity: z.number().int().min(1).max(20),
    })).min(1).max(15),
    paymentMethod: z.enum(["yookassa", "tbank"]).optional(),
  });

  app.post("/api/orders/:id/addon/initiate", authMiddleware, async (req: Request, res: Response) => {
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: "invalid_id" });

    if (addonInitiateLocks.has(orderId)) return res.status(409).json({ error: "already_processing" });
    addonInitiateLocks.add(orderId);

    try {
      const bodyParsed = initiateSchema.safeParse(req.body);
      if (!bodyParsed.success) return res.status(400).json({ error: "validation", details: bodyParsed.error.flatten() });
      const { items: requestItems, paymentMethod: reqMethod } = bodyParsed.data;

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "not_found" });

      const userId = (req as any).user?.id;
      const sessionId = req.sessionID;
      const isOwner =
        (userId && order.userId === userId) ||
        (userId && order.sessionId === `user_${userId}`) ||
        (order.sessionId === sessionId);
      if (!isOwner) return res.status(403).json({ error: "forbidden" });

      if (!["paid", "confirmed", "processing"].includes(order.status)) return res.status(400).json({ error: "invalid_order_status" });

      const ageMs = Date.now() - new Date((order as any).createdAt || 0).getTime();
      if (ageMs > ADDON_WINDOW_HOURS * 60 * 60 * 1000) return res.status(400).json({ error: "window_expired" });

      const existingAddon = parseAddonData((order as any).addonData);
      if (existingAddon?.status === "paid") return res.status(400).json({ error: "already_added" });
      if (existingAddon?.status === "awaiting_payment") {
        const initiatedMs = new Date(existingAddon.initiatedAt).getTime();
        if (Date.now() - initiatedMs <= ADDON_PAYMENT_TTL_MINUTES * 60 * 1000) {
          return res.status(409).json({ error: "payment_already_pending" });
        }
      }

      const addonItems: AddonItem[] = [];
      for (const reqItem of requestItems) {
        const product = await storage.getProduct(reqItem.productId);
        if (!product) return res.status(400).json({ error: "product_not_found", productId: reqItem.productId });
        addonItems.push({
          productId: product.id,
          productName: product.name,
          size: reqItem.size,
          color: reqItem.color,
          quantity: reqItem.quantity,
          price: product.price,
          sku: (product as any).sku || undefined,
          imageUrl: ((product as any).images?.[0]) || (product as any).imageUrl || undefined,
        });
      }

      const addedTotal = addonItems.reduce((s, it) => s + it.price * it.quantity, 0);

      const useMethod: "yookassa" | "tbank" | null =
        reqMethod === "yookassa" && paymentService.isYooKassaEnabled() ? "yookassa" :
        reqMethod === "tbank" && paymentService.isTBankEnabled() ? "tbank" :
        paymentService.isTBankEnabled() ? "tbank" :
        paymentService.isYooKassaEnabled() ? "yookassa" :
        null;

      if (!useMethod) return res.status(400).json({ error: "no_payment_method_available" });

      const baseUrl = process.env.APP_DOMAIN || `https://${req.get("host")}`;

      const addonData: AddonData = {
        status: "awaiting_payment",
        paymentMethod: useMethod,
        items: addonItems,
        addedTotal,
        initiatedAt: new Date().toISOString(),
      };
      await storage.updateOrderAddonData(orderId, JSON.stringify(addonData));

      const receiptItems = addonItems.map(it => ({
        name: it.productName,
        quantity: it.quantity,
        price: it.price,
      }));

      const paymentResult = await paymentService.createPayment({
        amount: addedTotal,
        description: `Дозаказ к заказу #${orderId}`,
        orderId: `ADDON-${orderId}`,
        returnUrl: `${baseUrl}/profile`,
        paymentMethod: useMethod,
        receiptEmail: order.customerEmail,
        receiptItems,
      });

      if (!paymentResult.success) {
        console.error(`[AddonOrder] Payment failed for order #${orderId}:`, paymentResult.error);
        return res.status(500).json({ error: "payment_failed", details: paymentResult.error });
      }

      addonData.paymentId = paymentResult.paymentId;
      await storage.updateOrderAddonData(orderId, JSON.stringify(addonData));

      return res.json({
        confirmationToken: paymentResult.confirmationToken,
        paymentUrl: paymentResult.confirmationUrl,
        paymentMethod: useMethod,
        orderId,
        addedTotal,
      });
    } catch (err: any) {
      console.error("[AddonOrder] initiate error:", err.message);
      return res.status(500).json({ error: "server_error" });
    } finally {
      addonInitiateLocks.delete(orderId);
    }
  });

  app.get("/api/orders/:id/addon-status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ error: "invalid_id" });

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "not_found" });

      const userId = (req as any).user?.id;
      const sessionId = req.sessionID;
      const isOwner =
        (userId && order.userId === userId) ||
        (userId && order.sessionId === `user_${userId}`) ||
        (order.sessionId === sessionId);
      if (!isOwner) return res.status(403).json({ error: "forbidden" });

      const addonData = parseAddonData((order as any).addonData);
      if (!addonData) return res.json({ status: "none" });

      if (addonData.status === "awaiting_payment") {
        const initiatedMs = new Date(addonData.initiatedAt).getTime();
        if (Date.now() - initiatedMs > ADDON_PAYMENT_TTL_MINUTES * 60 * 1000) {
          return res.json({ status: "expired" });
        }
      }

      return res.json({
        status: addonData.status,
        addedItems: addonData.status === "paid" ? addonData.items : undefined,
        addedTotal: addonData.status === "paid" ? addonData.addedTotal : undefined,
        paidAt: addonData.paidAt,
      });
    } catch (err: any) {
      console.error("[AddonOrder] status error:", err.message);
      return res.status(500).json({ error: "server_error" });
    }
  });
}
