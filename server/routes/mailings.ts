import type { Express } from "express";
import { logError } from "../logger";
import { storage } from "../storage";
import {
  getNewProductsQueueStatus,
  triggerNewProductsNotifierNow,
  removeFromNewProductsQueue,
  addToNewProductsQueueManual,
} from "../new-products-notifier";
import { getPreorderQueueStatus, triggerPreorderNotifierNow, removeFromPreorderQueue, addToPreorderQueueManual } from "../preorder-notifier";
import { sendEmail, getNewProductsNewsletterHtml } from "../email";
import {
  generateReviewRequestDraft,
  getReviewRequestCandidates,
  sendReviewRequestsNow,
  sendReviewRequestPreview,
} from "../review-request-email";

// Mailings + review-request admin routes extracted from routes.ts:
// - newsletter stats / queue status / trigger-now / queue-item (new-products + preorder)
// - mailings-settings (enabled/disabled)
// - newsletter preview + broadcast
// - review-request candidates / send / preview / generate
export function registerMailingsRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  app.get("/api/admin/newsletter-stats", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const subscriptions = await storage.getAllNewsletterSubscriptions();
      res.json({ 
        subscriptions: subscriptions || [], 
        count: subscriptions?.length || 0 
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: New-products queue status
  app.get("/api/admin/newsletter-queue-status", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const status = await getNewProductsQueueStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Force-send new-products newsletter now (ignore debounce timer)
  app.post("/api/admin/newsletter-trigger-now", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await triggerNewProductsNotifierNow();
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Preorder queue status
  app.get("/api/admin/preorder-queue-status", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const status = await getPreorderQueueStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Force-send preorder newsletter now
  app.post("/api/admin/preorder-trigger-now", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await triggerPreorderNotifierNow();
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Remove a product from new-products queue
  app.delete("/api/admin/newsletter-queue-item", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { productId } = req.body;
      if (!productId || typeof productId !== "number") return res.status(400).json({ error: "productId required" });
      await removeFromNewProductsQueue(productId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Add a product to new-products queue manually
  app.post("/api/admin/newsletter-queue-item", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { productId } = req.body;
      if (!productId || typeof productId !== "number") return res.status(400).json({ error: "productId required" });
      await addToNewProductsQueueManual(productId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Remove a product from preorder queue
  app.delete("/api/admin/preorder-queue-item", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { productId } = req.body;
      if (!productId || typeof productId !== "number") return res.status(400).json({ error: "productId required" });
      await removeFromPreorderQueue(productId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Add a product to preorder queue manually
  app.post("/api/admin/preorder-queue-item", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { productId } = req.body;
      if (!productId || typeof productId !== "number") return res.status(400).json({ error: "productId required" });
      await addToPreorderQueueManual(productId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get mailings enabled/disabled settings
  app.get("/api/admin/mailings-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const [npRaw, preRaw] = await Promise.all([
        storage.getBonusSetting('newsletter_new_products_enabled'),
        storage.getBonusSetting('newsletter_preorder_enabled'),
      ]);
      res.json({
        newProductsEnabled: npRaw !== 'false',
        preorderEnabled: preRaw !== 'false',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Save mailings enabled/disabled settings
  app.patch("/api/admin/mailings-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { newProductsEnabled, preorderEnabled } = req.body;
      const ops: Promise<void>[] = [];
      if (typeof newProductsEnabled === 'boolean') {
        ops.push(storage.setBonusSetting('newsletter_new_products_enabled', String(newProductsEnabled)));
      }
      if (typeof preorderEnabled === 'boolean') {
        ops.push(storage.setBonusSetting('newsletter_preorder_enabled', String(preorderEnabled)));
      }
      await Promise.all(ops);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Send test new-products newsletter to a single email (preview only)
  app.post("/api/admin/newsletter-preview", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      // берём 5 последних видимых товаров из кэша
      const allProducts = await storage.getProducts();
      const visible = allProducts.filter((p: any) => !p.isHidden && p.imageUrl);
      const sample = visible.slice(0, 5);
      if (sample.length === 0) return res.status(400).json({ error: "No products found" });
      const html = getNewProductsNewsletterHtml(sample, sample.length);
      const ok = await sendEmail({ to: email, subject: '[ПРЕВЬЮ] Смотри, что появилось 🆕', html: html(email) });
      res.json({ success: ok, sentTo: email, productsCount: sample.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Review-request email — candidates (read-only)
  app.get("/api/admin/review-requests/candidates", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const candidates = await getReviewRequestCandidates();
      res.json({ candidates, count: candidates.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Send review-request emails now (manual; optionally only selected orders)
  app.post("/api/admin/review-requests/send", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds : undefined;
      const message = {
        subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
        body: typeof req.body?.body === "string" ? req.body.body : undefined,
      };
      const result = await sendReviewRequestsNow(orderIds, message);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Send review-request email preview to a single address
  app.post("/api/admin/review-requests/preview", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      const message = {
        subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
        body: typeof req.body?.body === "string" ? req.body.body : undefined,
      };
      const result = await sendReviewRequestPreview(email, message);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Generate a review-request draft without sending any email
  app.post("/api/admin/review-requests/generate", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    try {
      const text = await generateReviewRequestDraft();
      res.json({ text });
    } catch (err: any) {
      const message = err?.message || "AI generation failed";
      const status = message === "AI service not configured" ? 503 : 502;
      res.status(status).json({ error: message });
    }
  });

  // Admin: Send broadcast email to newsletter subscribers
  app.post("/api/admin/newsletter-broadcast", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { subject, html, emails } = req.body;
      if (!subject || !html || !emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "subject, html и emails обязательны" });
      }

      const { sendEmail } = await import('../email');
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const email of emails) {
        try {
          const success = await sendEmail({ to: email, subject, html });
          if (success) {
            sent++;
          } else {
            failed++;
            errors.push(email);
          }
        } catch (e: any) {
          failed++;
          errors.push(email);
        }
      }

      res.json({ sent, failed, total: emails.length, errors });
    } catch (err: any) {
      logError("[Newsletter Broadcast] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
