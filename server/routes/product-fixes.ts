import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { extractColorFromName } from "../categoryMapper";
import { canonicalizeSizeKey } from "../lib/product-utils";

// Admin product-fix routes extracted from routes.ts:
// - fix-colors: normalize product colors from names
// - fix-sizestock: normalize sizeStock keys (legacy "One Size" etc.)
export function registerProductFixesRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin API - Fix colors for all products
  app.post("/api/admin/fix-colors", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();

    if (!expectedKey) {
      return res.status(503).json({ message: "Admin API not configured" });
    }

    if (apiKey !== expectedKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const allProducts = await storage.getProducts();
      let colorsFixed = 0;
      const fixed: string[] = [];

      // Known invalid colors that should be replaced
      const invalidColors = ['боковой карман', 'default', 'null', 'резинка', 'тактик', 'tube'];

      for (const product of allProducts) {
        const extractedColor = extractColorFromName(product.name);
        const currentColorLower = (product.color || '').toLowerCase();

        // Update if: no color, Default/null, or current color is in invalid list
        const needsUpdate = extractedColor && (
          !product.color ||
          product.color === 'Default' ||
          product.color === 'null' ||
          invalidColors.includes(currentColorLower) ||
          (extractedColor !== product.color && currentColorLower.includes('карман'))
        );

        if (needsUpdate) {
          await storage.updateProduct(product.id, { color: extractedColor });
          fixed.push(`${product.name}: "${product.color}" => "${extractedColor}"`);
          colorsFixed++;
        }
      }

      storage.clearCache();
      logInfo(`[Admin] Fixed colors for ${colorsFixed} products`);
      res.json({ success: true, count: colorsFixed, fixed: fixed.slice(0, 50) });
    } catch (err) {
      logError("[Admin] Fix colors error:", err);
      res.status(500).json({ success: false, message: "Fix colors failed" });
    }
  });

  // Admin API - Normalize sizeStock keys (clean up legacy "One Size", "(OneSize)" etc.)
  app.post("/api/admin/fix-sizestock", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (!expectedKey) return res.status(503).json({ message: "Admin API not configured" });
    if (apiKey !== expectedKey) return res.status(401).json({ message: "Unauthorized" });

    try {
      const allProducts = await storage.getProducts();
      let fixed = 0;
      const details: string[] = [];

      for (const product of allProducts) {
        const sizeStock = (product as any).sizeStock as Record<string, number> | null;
        if (!sizeStock || Object.keys(sizeStock).length === 0) continue;

        // Group keys by normalized form, keep max stock per group
        const normalized: Record<string, number> = {};
        for (const [key, val] of Object.entries(sizeStock)) {
          const canonical = canonicalizeSizeKey(key);
          normalized[canonical] = Math.max(normalized[canonical] ?? 0, Number(val));
        }

        const oldKeys = Object.keys(sizeStock).sort().join(',');
        const newKeys = Object.keys(normalized).sort().join(',');
        if (oldKeys !== newKeys) {
          await storage.updateProduct(product.id, { sizeStock: normalized } as any);
          details.push(`${product.name} (${product.id}): {${oldKeys}} → {${newKeys}}`);
          fixed++;
        }
      }

      storage.clearCache();
      logInfo(`[Admin] Fixed sizeStock keys for ${fixed} products`);
      res.json({ success: true, count: fixed, details: details.slice(0, 100) });
    } catch (err) {
      logError("[Admin] Fix sizeStock error:", err);
      res.status(500).json({ success: false, message: String(err) });
    }
  });
}
