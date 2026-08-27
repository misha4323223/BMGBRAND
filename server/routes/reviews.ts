import type { Express } from "express";
import sharp from "sharp";
import { storage } from "../storage";
import { authMiddleware } from "../auth-routes";
import { canEarnReviewPromo } from "../review-promo";
import { uploadToYandexStorage } from "../lib/storage-s3";
import { notifyNewReview } from "../telegram";
import { vkNotifyNewReview } from "../vk";
import { logError } from "../logger";

// Отзывы: публичные чтения + создание/фото (с authMiddleware на уровне роута).
// Вынесено из server/routes.ts без изменения поведения.

export function registerReviewsRoutes(app: Express): void {
  // Reviews - public
  app.get("/api/reviews/:productId", async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });
      const reviews = await storage.getReviewsByProduct(productId);
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Проверка права на промокод «за отзыв» (для подсказки в форме отзыва)
  app.get("/api/reviews/eligibility/:productId", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) return res.json({ eligible: false });
      const productId = parseInt(req.params.productId);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });
      const email = String(user.email || "").toLowerCase().trim();
      const eligible = await canEarnReviewPromo(user.id, email, productId);
      res.json({ eligible });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload photo for review (before submitting review)
  app.post("/api/reviews/upload-photo", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Необходимо войти в аккаунт" });
      const { imageData } = req.body;
      if (!imageData) return res.status(400).json({ error: "imageData is required" });
      const match = imageData.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (!match) return res.status(400).json({ error: "Invalid image format" });
      const mimeType = match[1];
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      const base64Data = imageData.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Файл слишком большой (макс. 10MB)" });
      // Resize to max 1200px wide via sharp
      let processedBuffer = buffer;
      try {
        processedBuffer = await sharp(buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer() as unknown as Buffer<ArrayBuffer>;
      } catch { /* use original if sharp fails */ }
      const filename = `review_images/${Date.now()}_${user.id}.webp`;
      const url = await uploadToYandexStorage(processedBuffer, filename, "image/webp");
      if (!url) return res.status(500).json({ error: "Не удалось загрузить фото" });
      res.json({ url });
    } catch (err: any) {
      logError("[Reviews] Photo upload error:", err.message);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.post("/api/reviews", authMiddleware, async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Для отправки отзыва необходимо войти в аккаунт" });
      }
      const { productId, rating, comment, photos } = req.body;
      if (!productId || !rating) {
        return res.status(400).json({ error: "productId and rating are required" });
      }
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" });
      }
      const photoUrls: string[] = Array.isArray(photos)
        ? photos.filter((u: any) => typeof u === "string" && u.startsWith("http")).slice(0, 5)
        : [];
      const review = await storage.createReview({
        productId: Number(productId),
        authorName: user.name,
        rating: Number(rating),
        comment: comment ? String(comment).trim() : null,
        photos: photoUrls as any,
        userId: user.id,
      });

      try {
        const product = await storage.getProduct(Number(productId));
        notifyNewReview({
          authorName: user.name || "Аноним",
          rating: Number(rating),
          comment: comment ? String(comment).trim() : null,
          productName: product?.name || `Товар #${productId}`,
          productId: Number(productId),
          reviewId: review.id,
        });
        vkNotifyNewReview({
          authorName: user.name || "Аноним",
          rating: Number(rating),
          comment: comment ? String(comment).trim() : null,
          productName: product?.name || `Товар #${productId}`,
          productId: Number(productId),
          reviewId: review.id,
        });
      } catch (tgErr: any) {
        logError("[Reviews] Telegram notify error:", tgErr.message);
      }

      res.json(review);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
