import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage } from "../storage";
import { clearBotSsrCache } from "../bot-ssr";
import { deleteFromYandexStorage } from "../lib/storage-s3";

// Admin maintenance routes extracted from routes.ts:
// - cache flush
// - duplicate products detection
// - bulk product delete (YDB + S3)
export function registerProductMaintenanceRoutes(
  app: Express,
  requireAdminOrApiKey: (req: any, res: any, next: any) => void
) {
  // Flush all in-memory caches (product cache + bot-SSR page cache) — admin only.
  // Call this after SEO or product data changes to force fresh renders on the next request.
  app.post("/api/admin/cache/flush", requireAdminOrApiKey, async (_req, res) => {
    try {
      const botSsrCleared = clearBotSsrCache();
      storage.clearCache();
      logInfo(`[Cache] Admin flush: cleared bot-SSR cache (${botSsrCleared} entries) + product cache`);
      res.json({ success: true, botSsrCleared, message: "All caches flushed. Next requests will re-render from fresh data." });
    } catch (err: any) {
      logError("[Cache] Flush error:", err?.message);
      res.status(500).json({ error: "Flush failed", details: String(err?.message) });
    }
  });

  // Duplicate products detection (admin) — groups of products that look like the same item.
  // Primary signal: normalized name (catches same-name clones). Secondary: slug-prefix
  // pairs (slug with a "-N" counter suffix whose base slug exists) — catches renamed clones.
  app.get("/api/admin/products/duplicates", requireAdminOrApiKey, async (_req, res) => {
    try {
      const { normalizeProductName } = await import("../slugify");
      const all = await storage.getProducts();
      const byName = new Map<string, any[]>();
      const bySlug = new Map<string, any>();
      for (const p of all) {
        if (p.slug) bySlug.set(String(p.slug), p);
        const n = normalizeProductName(p.name);
        if (n.length >= 6) {
          const arr = byName.get(n) || [];
          arr.push(p);
          byName.set(n, arr);
        }
      }
      const groups: any[] = [];
      const seenIds = new Set<number>();
      const toItem = (p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: p.price ?? 0,
        stock: p.stock ?? 0,
        imageCount: Array.isArray(p.images) ? p.images.length : 0,
        isHidden: !!p.isHidden,
        autoHideOverride: !!p.autoHideOverride,
        inStock: !!p.inStock,
        updatedAt: p.updatedAt ?? null,
        externalId: p.externalId ?? null,
        color: p.color ?? null,
        sizes: Array.isArray(p.sizes) ? p.sizes : [],
        danger: false,
      });
      const sortGroup = (arr: any[]) =>
        arr.slice().sort((a: any, b: any) =>
          ((a.isHidden ? 1 : 0) - (b.isHidden ? 1 : 0)) ||
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );
      const pushGroup = (items: any[], key: string, reason: string) => {
        const sorted = sortGroup(items);
        const canonical = sorted.find((x: any) => !x.isHidden) || sorted[0];
        const list = sorted.map(toItem);
        const canonicalPrice = canonical ? canonical.price : null;
        for (const it of list) {
          // Danger: this duplicate carries a different price than the canonical one.
          // Deleting it makes 1C re-attach its externalId to the canonical (name-dedup),
          // which would change the canonical price on the next sync.
          it.danger = canonical && it.id !== canonical.id ? it.price !== canonicalPrice : false;
        }
        const normNames = items.map((x: any) => normalizeProductName(x.name));
        const nameDiffers = normNames.some((n: string) => n !== normNames[0]);
        groups.push({ key, reason, nameDiffers, canonicalId: canonical ? canonical.id : null, items: list });
        for (const it of items) seenIds.add(it.id);
      };
      for (const [key, items] of byName) {
        if (items.length > 1) pushGroup(items, key, "name");
      }
      for (const p of all) {
        if (seenIds.has(p.id)) continue;
        const m = String(p.slug || "").match(/^(.*)-(\d+)$/);
        if (!m) continue;
        const counter = parseInt(m[2], 10);
        if (counter < 2 || counter > 20) continue; // counter suffix, not a size (34-39/40-45)
        const base = bySlug.get(m[1]);
        if (!base) continue;
        // Exclude genuinely different products that merely share a slug base:
        // different color (e.g. чёрная vs белая сумка) or different sizes.
        const colorA = String((base as any).color || "").trim().toLowerCase();
        const colorB = String((p as any).color || "").trim().toLowerCase();
        const sizesMatch = JSON.stringify((base as any).sizes || []) === JSON.stringify((p as any).sizes || []);
        if (colorA && colorB && colorA !== colorB) continue;
        if (!sizesMatch) continue;
        pushGroup([base, p], m[1], "slug");
      }
      // Only report groups that actually contain a non-canonical duplicate
      const realGroups = groups.filter((g: any) => g.items.some((it: any) => it.id !== g.canonicalId));
      res.json({ groups: realGroups, total: realGroups.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed" });
    }
  });

  // Bulk delete products completely (YDB + S3 images) — admin only
  app.post("/api/admin/products/bulk-delete", requireAdminOrApiKey, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "";
      const bucketPrefix = `https://storage.yandexcloud.net/${bucketName}/`;
      let deleted = 0;
      let s3Deleted = 0;
      const errors: string[] = [];

      for (const rawId of ids) {
        const id = Number(rawId);
        if (!id) continue;
        try {
          // Fetch product to get image URLs before deleting
          const product = await storage.getProduct(id);
          if (product) {
            // Collect all image URLs (images array + thumbnailUrl + hoverThumbnailUrl)
            const urlsToDelete: string[] = [];
            const prod = product as any;
            const imagesArr: string[] = Array.isArray(prod.images) ? prod.images : [];
            for (const url of imagesArr) {
              if (typeof url === "string" && url.startsWith(bucketPrefix)) urlsToDelete.push(url);
            }
            if (prod.imageUrl && prod.imageUrl.startsWith(bucketPrefix)) urlsToDelete.push(prod.imageUrl);
            if (prod.thumbnailUrl && prod.thumbnailUrl.startsWith(bucketPrefix)) urlsToDelete.push(prod.thumbnailUrl);
            if (prod.hoverThumbnailUrl && prod.hoverThumbnailUrl.startsWith(bucketPrefix)) urlsToDelete.push(prod.hoverThumbnailUrl);

            // Deduplicate
            const uniqueUrls = [...new Set(urlsToDelete)];
            for (const url of uniqueUrls) {
              const key = url.replace(bucketPrefix, "");
              const ok = await deleteFromYandexStorage(key);
              if (ok) s3Deleted++;
              logInfo(`[BulkDelete] S3 ${ok ? "OK" : "FAIL"}: ${key}`);
            }
          }
          // Capture slug BEFORE deletion for HTTP 410 tracking
          const productSlug = (product as any).slug || null;
          // Delete from YDB
          await storage.deleteProduct(id);
          deleted++;
          // Fire-and-forget: record deleted slug so bots get 410 for this URL
          if (productSlug) storage.addDeletedProductSlug(productSlug).catch(() => {});
        } catch (err: any) {
          logError(`[BulkDelete] Error for product ${id}:`, err.message);
          errors.push(`${id}: ${err.message}`);
        }
      }

      res.json({ ok: true, deleted, s3Deleted, errors });
    } catch (err: any) {
      logError("[BulkDelete] Fatal:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
