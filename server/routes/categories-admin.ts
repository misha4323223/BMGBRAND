import type { Express } from "express";
import { storage } from "../storage";
import { CATEGORIES, normalizeCategories, transliterateToSlug } from "@shared/schema";
import type { SubcategoryConfig, SubSubcategoryConfig } from "@shared/schema";

// Admin categories config routes extracted from routes.ts verbatim.
export function registerCategoriesAdminRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin: Save categories config
  app.post("/api/admin/categories", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { categories } = req.body;
      if (!categories || typeof categories !== 'object') {
        return res.status(400).json({ error: "Invalid categories data" });
      }
      const slugRegex = /^[a-z0-9_-]+$/;
      const slugsSeen = new Set<string>();
      for (const [slug, cat] of Object.entries(categories)) {
        const c = cat as any;
        if (!slug || !slugRegex.test(slug)) {
          return res.status(400).json({ error: `Invalid slug: "${slug}". Use lowercase Latin letters, numbers, hyphens, and underscores.` });
        }
        if (slugsSeen.has(slug)) {
          return res.status(400).json({ error: `Duplicate slug: "${slug}"` });
        }
        slugsSeen.add(slug);
        if (!c.name || typeof c.name !== 'string' || c.name.trim().length === 0) {
          return res.status(400).json({ error: `Category "${slug}" must have a non-empty name` });
        }
        if (!Array.isArray(c.subcategories)) {
          return res.status(400).json({ error: `Category "${slug}" subcategories must be an array` });
        }
        const normalizedSubs: SubcategoryConfig[] = [];
        const subSlugsSeen = new Set<string>();
        for (const s of c.subcategories) {
          let subName: string;
          let subSlug: string;
          if (typeof s === 'string') {
            subName = s.trim();
            subSlug = transliterateToSlug(subName);
          } else if (s && typeof s === 'object' && s.name) {
            subName = s.name.trim();
            subSlug = (s.slug && slugRegex.test(s.slug)) ? s.slug : transliterateToSlug(subName);
          } else {
            continue;
          }
          if (!subName) continue;
          if (subSlugsSeen.has(subSlug)) {
            let counter = 2;
            while (subSlugsSeen.has(`${subSlug}-${counter}`)) counter++;
            subSlug = `${subSlug}-${counter}`;
          }
          subSlugsSeen.add(subSlug);
          // Normalize sub-subcategories
          const normalizedSubSubs: SubSubcategoryConfig[] = [];
          if (Array.isArray((s as any).subSubcategories)) {
            const ssSlugsSeen = new Set<string>();
            for (const ss of (s as any).subSubcategories) {
              let ssName: string;
              let ssSlug: string;
              if (typeof ss === 'string') {
                ssName = ss.trim();
                ssSlug = transliterateToSlug(ssName);
              } else if (ss && typeof ss === 'object' && ss.name) {
                ssName = ss.name.trim();
                ssSlug = (ss.slug && slugRegex.test(ss.slug)) ? ss.slug : transliterateToSlug(ssName);
              } else continue;
              if (!ssName) continue;
              if (ssSlugsSeen.has(ssSlug)) {
                let counter = 2;
                while (ssSlugsSeen.has(`${ssSlug}-${counter}`)) counter++;
                ssSlug = `${ssSlug}-${counter}`;
              }
              ssSlugsSeen.add(ssSlug);
              normalizedSubSubs.push({ name: ssName, slug: ssSlug });
            }
          }
          normalizedSubs.push({ name: subName, slug: subSlug, ...(normalizedSubSubs.length > 0 ? { subSubcategories: normalizedSubSubs } : {}) });
        }
        (categories as any)[slug] = { name: c.name.trim(), slug, subcategories: normalizedSubs };
      }
      if (Object.keys(categories).length === 0) {
        return res.status(400).json({ error: "At least one category is required" });
      }
      await storage.setPageSectionSettings("site_config", "categories_data", categories);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get categories config (returns current dynamic or hardcoded + product counts)
  app.get("/api/admin/categories", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      let cats: any = CATEGORIES;
      let source = "default";
      const dynamicConfig = await storage.getPageSettings("site_config");
      if (dynamicConfig?.categories_data) {
        const parsed = typeof dynamicConfig.categories_data === 'string'
          ? JSON.parse(dynamicConfig.categories_data)
          : dynamicConfig.categories_data;
        if (parsed && Object.keys(parsed).length > 0) {
          cats = normalizeCategories(parsed);
          source = "dynamic";
        }
      }
      const products = await storage.getProducts();
      const productCounts: Record<string, number> = {};
      for (const p of products) {
        if (p.category) {
          productCounts[p.category] = (productCounts[p.category] || 0) + 1;
        }
      }
      res.json({ categories: cats, source, productCounts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
