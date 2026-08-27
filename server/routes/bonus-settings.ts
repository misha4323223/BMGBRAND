import type { Express } from "express";
import { storage } from "../storage";
import { insertBonusSettingSchema } from "@shared/schema";

// Bonus settings admin routes extracted from routes.ts:
// - GET /api/bonus-settings (all bonus settings)
// - POST /api/bonus-settings (upsert single setting, invalidates subscription promos cache)
export function registerBonusSettingsRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
  invalidateSubscriptionPromosCache: () => void
) {
  // Get bonus settings (admin)
  app.get("/api/bonus-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const settings = await storage.getAllBonusSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update bonus setting (admin)
  app.post("/api/bonus-settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const parsed = insertBonusSettingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation error", details: parsed.error.errors });
      }
      await storage.setBonusSetting(parsed.data.key, parsed.data.value);
      invalidateSubscriptionPromosCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
