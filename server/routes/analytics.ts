import type { Express } from "express";
import { logError } from "../logger";
import { storage } from "../storage";

// Admin analytics routes extracted from routes.ts:
// - order analytics
// - artist analytics
// - test artist stats by slug
export function registerAnalyticsRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Order analytics (admin)
  app.get("/api/admin/analytics/orders", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const data = await storage.getOrderAnalytics();
      res.json(data);
    } catch (err: any) {
      logError("[Admin] Analytics error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/analytics/artists", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const data = await storage.getArtistAnalytics();
      res.json(data);
    } catch (err: any) {
      logError("[Admin] Artist analytics error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary: get artist stats by slug (for testing)
  app.get("/api/admin/test-artist-stats/:slug", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const stats = await storage.getArtistStatsBySlug(req.params.slug);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
