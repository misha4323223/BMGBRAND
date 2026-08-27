import type { Express } from "express";
import { logError } from "../logger";
import { storage } from "../storage";

// Preorder subscribers + related admin routes extracted from routes.ts:
// - preorder subscribe / my-status / count / unsubscribe / admin list
// - newsletter subscription delete (admin)
// - artist-only products list (admin)
export function registerPreorderSubscribersRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Preorder subscribers
  app.post("/api/preorder-subscribers/subscribe", async (req, res) => {
    try {
      const { email, name } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      const existing = await storage.getPreorderSubscriberByEmail(String(email).toLowerCase().trim());
      if (existing) {
        if (!existing.isActive) {
          await storage.updatePreorderSubscriberStatus(String(email).toLowerCase().trim(), true);
        }
        return res.json({ success: true, alreadySubscribed: true });
      }
      await storage.addPreorderSubscriber(String(email).toLowerCase().trim(), name || undefined);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/preorder-subscribers/my-status", async (req, res) => {
    try {
      const email = String(req.query.email || '').toLowerCase().trim();
      if (!email) return res.json({ subscribed: false, isActive: false });
      const sub = await storage.getPreorderSubscriberByEmail(email);
      res.json({ subscribed: !!sub, isActive: sub ? sub.isActive : false });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/preorder-subscribers/count", async (req, res) => {
    try {
      const all = await storage.getAllPreorderSubscribers();
      const count = all.filter(s => s.isActive).length;
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/preorder-subscribers/unsubscribe", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email is required" });
      await storage.updatePreorderSubscriberStatus(String(email).toLowerCase().trim(), false);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/preorder-subscribers", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const all = await storage.getAllPreorderSubscribers();
      res.json({ subscribers: all, count: all.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin API - Delete newsletter subscription
  app.delete("/api/admin/newsletter-subscriptions/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid subscription ID" });
      }

      const success = await storage.deleteNewsletterSubscription(id);
      if (success) {
        res.json({ success: true, message: `Subscription ${id} deleted` });
      } else {
        res.status(404).json({ success: false, message: "Subscription not found" });
      }
    } catch (err) {
      logError("[Admin] Delete subscription error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  });

  // Admin API - List artist-only products
  app.get("/api/admin/artist-only-products", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const raw = (storage as any).getRawProductsCache?.() as any[] | undefined;
      let all: any[];
      if (raw && raw.length > 0) {
        all = raw;
      } else {
        const { fetchProductsFromYdb } = storage as any;
        all = fetchProductsFromYdb ? await fetchProductsFromYdb.call(storage) : await storage.getProducts();
      }
      const artistOnly = all.filter((p: any) => p.artistOnly === true);
      res.json({ products: artistOnly });
    } catch (err) {
      logError("[Admin] artist-only-products error:", err);
      res.status(500).json({ message: "Failed" });
    }
  });
}
