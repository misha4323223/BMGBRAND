import { logError } from "./logger";
type ProductId = number;

// ── Co-purchase index ──────────────────────────────────────────────────────
// Global in-memory map: productA → Map<productB, co-occurrence count>
// Built once at startup from paid orders; incrementally updated on each new paid order.
const coPurchaseMap = new Map<ProductId, Map<ProductId, number>>();

/** Размер co-purchase индекса для диагностики (ТЗ №5). */
export function getCoPurchaseIndexSize(): number {
  return coPurchaseMap.size;
}

// ── Per-product recommendation cache ──────────────────────────────────────
// Stores final recommendation list per product with a 2-hour TTL.
// Invalidated whenever a paid order updates the co-purchase counters for a product.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

interface CachedRecs {
  products: any[];
  at: number;
}
const recommendationCache = new Map<ProductId, CachedRecs>();

// ── Internal helpers ───────────────────────────────────────────────────────

function incrementPair(a: ProductId, b: ProductId): void {
  if (!coPurchaseMap.has(a)) coPurchaseMap.set(a, new Map());
  const inner = coPurchaseMap.get(a)!;
  inner.set(b, (inner.get(b) || 0) + 1);
}

function parseItems(raw: any): any[] {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw : [];
}

function extractProductIds(items: any[]): ProductId[] {
  return items
    .map((item: any) => Number(item.productId ?? item.id))
    .filter((id) => !isNaN(id) && id > 0);
}

function isVisible(p: any): boolean {
  // Reject hidden products — isHidden may be boolean, string "true", or number 1
  if (p.isHidden === true || p.isHidden === 'true' || p.isHidden === 1) return false;
  // Must have a real price
  if (!p.price || Number(p.price) <= 0) return false;
  // Must have a real remote image (local paths = not published on site)
  if (!p.imageUrl || !String(p.imageUrl).startsWith('http')) return false;
  // Must have stock
  if (p.sizeStock && typeof p.sizeStock === 'object') {
    return Object.values(p.sizeStock as Record<string, number>).some((n) => Number(n) > 0);
  }
  return (Number(p.stock) ?? 0) > 0;
}

function toProductShape(p: any): any {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    wholesalePrice: p.wholesalePrice,
    imageUrl: p.imageUrl,
    thumbnailUrl: p.thumbnailUrl,
    hoverThumbnailUrl: p.hoverThumbnailUrl,
    category: p.category,
    subcategory: p.subcategory,
    sizes: p.sizes,
    colors: p.colors,
    color: p.color,
    isNew: p.isNew,
    badgeText: typeof p.badgeText === 'string' ? p.badgeText : null,
    stock: p.stock,
    sizeStock: p.sizeStock,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the co-purchase index from the last ~1000 non-draft orders.
 * Called once after server startup, right after products cache is warmed.
 */
export async function buildCoPurchaseIndex(storage: any): Promise<void> {
  try {
    const orders = await storage.getOrders();
    const paidOrders = orders.filter((o: any) => o.status === 'paid');

    let pairCount = 0;
    for (const order of paidOrders) {
      const items = parseItems(order.items);
      const ids = extractProductIds(items);

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          incrementPair(ids[i], ids[j]);
          incrementPair(ids[j], ids[i]);
          pairCount++;
        }
      }
    }

    console.log(
      `[Recommendations] Co-purchase index built: ${coPurchaseMap.size} products, ` +
      `${pairCount} pairs from ${paidOrders.length} paid orders`
    );
  } catch (err: any) {
    logError('[Recommendations] Failed to build co-purchase index:', err?.message);
  }
}

/**
 * Incrementally update the co-purchase index when a new order is paid.
 * Also invalidates the recommendation cache for all affected products.
 * Safe to call fire-and-forget — never throws.
 */
export function updateCoPurchaseIndex(rawItems: any): void {
  try {
    const items = parseItems(rawItems);
    const ids = extractProductIds(items);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        incrementPair(ids[i], ids[j]);
        incrementPair(ids[j], ids[i]);
      }
    }

    for (const id of ids) {
      recommendationCache.delete(id);
    }
  } catch {
    // silent — must not affect webhook response
  }
}

/**
 * Get recommended products for a given product.
 * Lazy cache (2h TTL) → co-purchase layer → same-category fallback.
 *
 * @param productId  anchor product
 * @param storage    storage instance (uses in-memory product cache internally)
 * @param count      max results to return (default 6)
 * @param excludeIds product IDs to exclude (e.g. already in cart)
 */
export async function getRecommendations(
  productId: ProductId,
  storage: any,
  count: number = 6,
  excludeIds: ProductId[] = []
): Promise<any[]> {
  // Check cache — cached list does NOT pre-apply excludeIds so it's reusable
  const cached = recommendationCache.get(productId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    const excludeSet = new Set(excludeIds);
    return cached.products.filter((p) => !excludeSet.has(p.id)).slice(0, count);
  }

  const allProducts: any[] = await storage.getProducts();
  const productMap = new Map<ProductId, any>(allProducts.map((p: any) => [p.id, p]));

  const seenIds = new Set<ProductId>([productId]);
  const result: any[] = [];

  // ── Layer 1: co-purchase ────────────────────────────────────────────────
  const coMap = coPurchaseMap.get(productId);
  if (coMap && coMap.size > 0) {
    const sorted = Array.from(coMap.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count * 3);

    for (const [id] of sorted) {
      if (seenIds.has(id)) continue;
      const p = productMap.get(id);
      if (p && isVisible(p)) {
        result.push(toProductShape(p));
        seenIds.add(id);
        if (result.length >= count) break;
      }
    }
  }

  // ── Layer 2: same-category fallback (randomised) ───────────────────────
  if (result.length < count) {
    const anchor = productMap.get(productId);
    if (anchor) {
      const needed = count - result.length;
      const pool = allProducts.filter((p: any) =>
        !seenIds.has(p.id) &&
        isVisible(p) &&
        p.category === anchor.category
      );
      // Fisher-Yates shuffle so every page load shows a different set
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (const p of pool.slice(0, needed)) {
        result.push(toProductShape(p));
        seenIds.add(p.id);
      }
    }
  }

  // Cache only when co-purchase layer contributed at least one result.
  // Pure-fallback results are not cached so randomisation stays fresh.
  const hasCoPurchase = (coPurchaseMap.get(productId)?.size ?? 0) > 0;
  if (hasCoPurchase) {
    recommendationCache.set(productId, { products: result, at: Date.now() });
  }

  const excludeSet = new Set(excludeIds);
  return result.filter((p) => !excludeSet.has(p.id)).slice(0, count);
}

/**
 * Synchronous variant used for server-rendered SEO fallbacks (noscript blocks).
 * Reuses the same in-memory co-purchase index and recommendation cache as
 * getRecommendations(), but reads product candidates from an already-fetched
 * array instead of calling storage — safe to call from a non-async render path.
 */
export function getRecommendationsSync(
  productId: ProductId,
  count: number,
  candidates: Array<{ id: number; slug: string; name: string; price: number; stock: number; category: string }>
): Array<{ id: number; slug: string; name: string; price: number }> {
  const cached = recommendationCache.get(productId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.products
      .slice(0, count)
      .map((p) => ({ id: p.id, slug: p.slug, name: p.name, price: p.price }));
  }

  const candidateMap = new Map(candidates.map((p) => [p.id, p]));
  const seenIds = new Set<ProductId>([productId]);
  const result: typeof candidates = [];

  // ── Layer 1: co-purchase ────────────────────────────────────────────────
  const coMap = coPurchaseMap.get(productId);
  if (coMap && coMap.size > 0) {
    const sorted = Array.from(coMap.entries()).sort(([, a], [, b]) => b - a);
    for (const [id] of sorted) {
      if (seenIds.has(id)) continue;
      const p = candidateMap.get(id);
      if (p && p.stock > 0) {
        result.push(p);
        seenIds.add(id);
        if (result.length >= count) break;
      }
    }
  }

  // ── Layer 2: same-category fallback ────────────────────────────────────
  if (result.length < count) {
    const anchor = candidateMap.get(productId);
    if (anchor) {
      const needed = count - result.length;
      const pool = candidates.filter(
        (p) => !seenIds.has(p.id) && p.stock > 0 && p.category === anchor.category
      );
      for (const p of pool.slice(0, needed)) {
        result.push(p);
        seenIds.add(p.id);
      }
    }
  }

  return result.slice(0, count).map((p) => ({ id: p.id, slug: p.slug, name: p.name, price: p.price }));
}
