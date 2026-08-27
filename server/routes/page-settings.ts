import type { Express } from "express";
import { storage } from "../storage";

// Page settings routes extracted from routes.ts verbatim (public get + admin post/delete).
export function registerPageSettingsRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
  autoAddSubcategory: (categorySlug: string, subcategoryName: string, storageRef: any) => Promise<void>
) {
  app.get("/api/page-settings/:pageName", async (req, res) => {
    try {
      const settings = await storage.getPageSettings(req.params.pageName);
      res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/page-settings/:pageName/:sectionId", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { pageName, sectionId } = req.params;
      const incoming = req.body;
      const existing = await storage.getPageSettings(pageName);
      const merged = { ...(existing[sectionId] || {}), ...incoming };
      await storage.setPageSectionSettings(pageName, sectionId, merged);

      // Auto-sync: when an artist/festival page is saved, add it as a subcategory in "merch"
      if (pageName === "artist_pages") {
        const displayName: string = (merged.name && String(merged.name).trim()) || sectionId;
        autoAddSubcategory("merch", displayName, storage).catch(() => {});
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/page-settings/:pageName/:sectionId", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { pageName, sectionId } = req.params;
      await storage.deletePageSectionSettings(pageName, sectionId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
