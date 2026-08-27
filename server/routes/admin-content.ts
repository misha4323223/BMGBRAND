import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { uploadToYandexStorage } from "../lib/storage-s3";
import { onReviewApproved } from "../review-promo";

// Admin content routes extracted from routes.ts:
// - gift cards CRUD
// - reviews admin (approve/delete) + migrate
// - stock notifications
// - email editor image upload
export function registerAdminContentRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Get all gift cards (admin)
  app.get("/api/admin/gift-cards", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const cards = await storage.getGiftCards();
      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update gift card (admin)
  app.patch("/api/admin/gift-cards/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const card = await storage.updateGiftCard(Number(req.params.id), req.body);
      res.json(card);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete gift card (admin)
  app.delete("/api/admin/gift-cards/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await storage.deleteGiftCard(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Reviews
  app.get("/api/admin/reviews", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const reviews = await storage.getAllReviews();
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/reviews/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const id = parseInt(req.params.id);
      const review = await storage.updateReview(id, req.body);
      // Отзыв одобрен → автоматически выдаём покупателю промокод «за отзыв»
      if (req.body?.isApproved === true) {
        onReviewApproved(id).catch((e: any) => logError('[ReviewPromo] hook error (admin):', e?.message));
      }
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/reviews/:id", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const id = parseInt(req.params.id);
      await storage.deleteReview(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/migrate-reviews", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await storage.migrateReviewsTable();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Newsletter subscription stats
  app.get("/api/admin/stock-notifications", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const notifications = await storage.getAllStockNotifications();
      res.json(notifications);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload image for email editor
  app.post("/api/admin/upload-email-image", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file data" });
      }
      const mimeType = (req.headers["content-type"] || "image/jpeg").split(";")[0].trim();
      const ext = mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : mimeType === "image/webp" ? "webp" : "jpg";
      const filename = `email_images/email_img_${Date.now()}.${ext}`;
      const url = await uploadToYandexStorage(buffer, filename, mimeType);
      if (!url) {
        return res.status(500).json({ error: "Failed to upload image" });
      }
      logInfo(`[Admin] Uploaded email image: ${url}`);
      res.json({ url });
    } catch (error) {
      logError("[Admin] Error uploading email image:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });
}
