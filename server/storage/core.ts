import { driver, waitForDriver, isAuthError, reconnectYdb } from "../db";
import { logError, logWarn } from "../logger";

// CDN URL substitution: replaces storage.yandexcloud.net/{bucket}/ with CDN_URL/
// when CDN_URL env var is set (e.g. https://cdn.booomerangs.ru)
const _cdnBase = process.env.CDN_URL?.replace(/\/$/, '') || '';
const _storageBase = `https://storage.yandexcloud.net/${process.env.YANDEX_STORAGE_BUCKET_NAME || 'bmg'}/`;
export function toCdnUrl(url: string | null | undefined): string {
  if (!url) return url as string;
  if (_cdnBase && url.startsWith(_storageBase)) {
    return _cdnBase + '/' + url.slice(_storageBase.length);
  }
  return url;
}

export interface PickupPoint {
  id: string;
  name: string;
  date: string;
  city: string;
  address: string;
  isActive: boolean;
}
import { 
  type Product, type InsertProduct, 
  type CartItem, type InsertCartItem, 
  type Order, type InsertOrder, 
  type GiftCard, type InsertGiftCard,
  type PromoCode, type InsertPromoCode,
  type LoyaltyTier, type InsertLoyaltyTier,
  type NewsletterSubscription, type InsertNewsletterSubscription,
  type BonusSetting,
  type Review, type InsertReview,
  type Partner, type InsertPartner,
  type PartnerCommission,
  type PartnerPayout,
  type LegalDocument,
  type ConsentSignature, type InsertConsentSignature,
  PARTNER_DEFAULT_COMMISSION_PERCENT,
  PARTNER_GLOBAL_COMMISSION_SETTING_KEY,
  PARTNER_HOLD_DAYS_SETTING_KEY,
  PARTNER_DEFAULT_HOLD_DAYS,
} from "@shared/schema";
import { createHash } from "crypto";
import ydb from "ydb-sdk";

// Simple in-memory cache with TTL
class SimpleCache<T> {
  private cache: Map<string, { data: T; expires: number; staleUntil: number }> = new Map();
  private ttlMs: number;
  private staleTtlMs: number;
  private refreshing: Set<string> = new Set();

  constructor(ttlSeconds: number = 60, staleTtlSeconds?: number) {
    this.ttlMs = ttlSeconds * 1000;
    this.staleTtlMs = (staleTtlSeconds ?? ttlSeconds * 5) * 1000;
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.staleUntil) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  isStale(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return true;
    return Date.now() > item.expires;
  }

  isRefreshing(key: string): boolean {
    return this.refreshing.has(key);
  }

  setRefreshing(key: string, val: boolean): void {
    if (val) this.refreshing.add(key);
    else this.refreshing.delete(key);
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.ttlMs,
      staleUntil: Date.now() + this.staleTtlMs,
    });
  }

  clear(): void {
    this.cache.clear();
    console.log("[Cache] Cleared all cached data");
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

export const productsCache = new SimpleCache<Product[]>(300, 1800);
export const productCache = new SimpleCache<Product>(300, 1800);
export const pageSettingsCache = new SimpleCache<Record<string, any>>(120, 600);

const ratingsCache = new Map<number, { averageRating: number; reviewCount: number }>();

// Warm in-memory cache of approved review texts per product, for synchronous
// access by bot-ssr.ts (which must never call YDB directly). Capped per
// product so one heavily-reviewed product can't bloat the cache.
export interface CachedReview {
  authorName: string;
  rating: number;
  comment: string | null;
  createdAt: string | null;
}
const REVIEWS_CACHE_MAX_PER_PRODUCT = 10;
const reviewsCache = new Map<number, CachedReview[]>();

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ LEGACY-СХЕМА: orders.partner_id хранится в YDB как Utf8?, а НЕ Uint64?
// ─────────────────────────────────────────────────────────────────────────────
// История: при первой миграции партнёрки колонка `orders.partner_id` уже
// существовала в продовой YDB как Utf8? (legacy от ранних экспериментов).
// `ALTER TABLE ... ADD COLUMN partner_id Uint64` отработал молча (idempotent),
// тип НЕ поменял. Менять тип колонки в YDB через ALTER нельзя в принципе.
//
// Поэтому мы пишем/читаем именно эту колонку как строку, а конвертацию
// в number делаем на стороне приложения. Все остальные partner_id в
// БД (partner_products, partner_commissions) — нормальные Uint64, их
// эта проблема не касается.
//
// 🚫 НЕ ЗАМЕНЯТЬ эти helper'ы на TypedValues.uint64 / прямой Number().
//    Без полной миграции колонки (см. replit.md, раздел про legacy)
//    запросы упадут с type mismatch на первом же партнёрском заказе.
// 🚫 НЕ убирать DECLARE $partner_id AS Utf8 в createOrder.
//
// Любое изменение в этих двух функциях требует понимания всей цепочки.
// ─────────────────────────────────────────────────────────────────────────────
export function serializeOrderPartnerId(id: number): any {
  return ydb.TypedValues.utf8(String(id));
}

export function deserializeOrderPartnerId(raw: any): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function warmRatingsCache(storage: IStorage): Promise<void> {
  try {
    const allReviews = await storage.getAllReviews();
    const approved = allReviews.filter(r => r.isApproved && r.rating >= 1 && r.rating <= 5);
    const grouped = new Map<number, number[]>();
    for (const r of approved) {
      const pid = Number(r.productId);
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push(r.rating);
    }
    ratingsCache.clear();
    for (const [pid, ratings] of grouped.entries()) {
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      ratingsCache.set(pid, { averageRating: Math.round(avg * 10) / 10, reviewCount: ratings.length });
    }
    console.log(`[Ratings] Warmed cache: ${ratingsCache.size} products with reviews`);
  } catch (err) {
    logError("[Ratings] Failed to warm ratings cache:", err);
  }
}

export function getCachedRatingByProductId(productId: number): { averageRating: number; reviewCount: number } | null {
  return ratingsCache.get(productId) || null;
}

export async function warmReviewsCache(storage: IStorage): Promise<void> {
  try {
    const allReviews = await storage.getAllReviews();
    const approved = allReviews.filter(r => r.isApproved && r.rating >= 1 && r.rating <= 5);
    const grouped = new Map<number, CachedReview[]>();
    for (const r of approved) {
      const pid = Number(r.productId);
      if (!grouped.has(pid)) grouped.set(pid, []);
      const list = grouped.get(pid)!;
      if (list.length < REVIEWS_CACHE_MAX_PER_PRODUCT) {
        list.push({
          authorName: r.authorName || "Покупатель",
          rating: r.rating,
          comment: r.comment || null,
          createdAt: r.createdAt ? new Date(r.createdAt as any).toISOString() : null,
        });
      }
    }
    reviewsCache.clear();
    for (const [pid, list] of grouped.entries()) reviewsCache.set(pid, list);
    console.log(`[Reviews] Warmed cache: ${reviewsCache.size} products with reviews`);
  } catch (err) {
    logError("[Reviews] Failed to warm reviews cache:", err);
  }
}

export function getCachedReviewsByProductId(productId: number): CachedReview[] {
  return reviewsCache.get(productId) || [];
}

export function getCachedProductsByCategory(categorySlug: string, limit = 80): Array<{
  slug: string; name: string; price: number; stock: number; category: string;
  subcategory: string | null;
  subSubcategory: string | null;
  additionalCategories: Array<{ category: string; subcategory: string; subSubcategory?: string }>;
  preorderEnabled: boolean;
  imageUrl: string;
  thumbnailUrl: string;
  images: string[];
  article: string;
  sku: string;
  id: number;
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products
    .filter((p: any) => {
      if (p.isHidden || p.artistOnly || !p.slug || p.price <= 0) return false;
      // The product belongs to the category either directly or via additionalCategories
      // (e.g. merch artist collabs like "Людмил Огурченко" live under clothing/accessories
      // with additionalCategories pointing at merch). The API's /api/products filter uses
      // exactly the same rule — mirror it so bot SSR sees the same products as the browser.
      if (p.category === categorySlug) return true;
      const addCats: Array<{ category: string; subcategory: string }> = (p as any).additionalCategories || [];
      return addCats.some((ac: any) => ac?.category?.toLowerCase() === categorySlug.toLowerCase());
    })
    .slice(0, limit)
    .map((p: any) => ({
      slug: String(p.slug),
      name: String(p.name || ""),
      price: Number(p.price || 0),
      stock: Number(p.stock ?? 0),
      category: String(p.category || ""),
      // bot-ssr.ts filters by these fields (renderSubcategory/renderSubSubcategory) —
      // without them the SSR list is always empty and bot pages fall back to 404.
      subcategory: (p as any).subcategory != null && String((p as any).subcategory).trim() !== ""
        ? String((p as any).subcategory) : null,
      subSubcategory: (p as any).subSubcategory != null && String((p as any).subSubcategory).trim() !== ""
        ? String((p as any).subSubcategory) : null,
      additionalCategories: Array.isArray((p as any).additionalCategories)
        ? (p as any).additionalCategories.map((ac: any) => ({
            category: String(ac?.category || ""),
            subcategory: String(ac?.subcategory || ""),
            subSubcategory: ac?.subSubcategory != null && String(ac.subSubcategory).trim() !== ""
              ? String(ac.subSubcategory) : undefined,
          }))
        : [],
      preorderEnabled: (p as any).preorderEnabled === true,
      imageUrl: (p as any).imageUrl ? String((p as any).imageUrl) : "",
      thumbnailUrl: (p as any).thumbnailUrl ? String((p as any).thumbnailUrl) : "",
      images: Array.isArray((p as any).images) ? (p as any).images.map((u: any) => String(u)) : [],
      article: (p as any).article != null ? String((p as any).article) : "",
      sku: (p as any).sku != null ? String((p as any).sku) : "",
      id: Number((p as any).id || 0),
    }));
}

export function getCachedAllVisibleProducts(limit = 50): Array<{
  slug: string; name: string; price: number; stock: number; category: string;
  preorderEnabled: boolean;
  imageUrl: string;
  thumbnailUrl: string;
  images: string[];
  article: string;
  sku: string;
  id: number;
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products
    .filter((p: any) => !p.isHidden && !p.artistOnly && p.slug && p.price > 0)
    .slice(0, limit)
    .map((p: any) => ({
      slug: String(p.slug),
      name: String(p.name || ""),
      price: Number(p.price || 0),
      stock: Number(p.stock ?? 0),
      category: String(p.category || ""),
      preorderEnabled: (p as any).preorderEnabled === true,
      imageUrl: (p as any).imageUrl ? String((p as any).imageUrl) : "",
      thumbnailUrl: (p as any).thumbnailUrl ? String((p as any).thumbnailUrl) : "",
      images: Array.isArray((p as any).images) ? (p as any).images.map((u: any) => String(u)) : [],
      article: (p as any).article != null ? String((p as any).article) : "",
      sku: (p as any).sku != null ? String((p as any).sku) : "",
      id: Number((p as any).id || 0),
    }));
}

export function getCachedProductsForRecommendations(limit = 2000): Array<{
  id: number; slug: string; name: string; price: number; stock: number; category: string;
  imageUrl: string;
  thumbnailUrl: string;
  images: string[];
  article: string;
  sku: string;
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products
    .filter((p: any) => !p.isHidden && !p.artistOnly && p.slug && p.price > 0)
    .slice(0, limit)
    .map((p: any) => ({
      id: Number(p.id),
      slug: String(p.slug),
      name: String(p.name || ""),
      price: Number(p.price || 0),
      stock: Number(p.stock ?? 0),
      category: String(p.category || ""),
      imageUrl: (p as any).imageUrl ? String((p as any).imageUrl) : "",
      thumbnailUrl: (p as any).thumbnailUrl ? String((p as any).thumbnailUrl) : "",
      images: Array.isArray((p as any).images) ? (p as any).images.map((u: any) => String(u)) : [],
      article: (p as any).article != null ? String((p as any).article) : "",
      sku: (p as any).sku != null ? String((p as any).sku) : "",
    }));
}

// Richer synchronous product listing for variant matching (bot-ssr.ts) — needs
// sku/imageUrl/isHidden/colors on top of what getCachedProductsForRecommendations
// exposes. Kept in-memory only, never touches YDB.
export function getCachedProductsForVariantMatching(): Array<{
  id: number; slug: string; name: string; sku: string | null; price: number; stock: number;
  imageUrl: string; thumbnailUrl: string; isHidden: boolean; colors: string[];
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products.map((p: any) => ({
    id: Number(p.id),
    slug: String(p.slug || ""),
    name: String(p.name || ""),
    sku: p.sku || p.article || null,
    price: Number(p.price || 0),
    stock: Number(p.stock ?? 0),
    imageUrl: p.imageUrl || p.thumbnailUrl || "",
    thumbnailUrl: p.thumbnailUrl || p.imageUrl || "",
    isHidden: !!p.isHidden,
    colors: Array.isArray(p.colors) ? p.colors : [],
  }));
}

export function getCachedProductsForSeoAudit(): Array<{
  id: number; slug: string; name: string; category: string; isHidden: boolean; artistOnly: boolean; price: number;
  hasSeoTitle: boolean; hasSeoDesc: boolean; hasSeoBody: boolean; hasImage: boolean;
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products.map((p: any) => ({
    id: Number(p.id),
    slug: String(p.slug || ""),
    name: String(p.name || ""),
    category: String(p.category || ""),
    isHidden: !!p.isHidden,
    artistOnly: !!p.artistOnly,
    price: Number(p.price || 0),
    hasSeoTitle: !!(p.seoTitle && String(p.seoTitle).trim()),
    hasSeoDesc: !!(p.seoDescription && String(p.seoDescription).trim()),
    hasSeoBody: !!(p.seoBody && String(p.seoBody).trim()),
    hasImage: !!(p.imageUrl || p.thumbnailUrl || (Array.isArray(p.images) && p.images.length > 0)),
  }));
}

export function isProductsCacheWarm(): boolean {
  const products = productsCache.get("all");
  return !!(products && products.length > 0);
}

export function clearAllCaches() {
  productsCache.clear();
  productCache.clear();
  pageSettingsCache.clear();
}

export function getCachedHeroImageUrl(): string {
  const homeSettings = pageSettingsCache.get("home");
  if (!homeSettings) return "";
  const hero = homeSettings.hero;
  if (!hero) return "";
  if (hero.slides && Array.isArray(hero.slides) && hero.slides.length > 0) {
    const firstSlide = hero.slides[0];
    if (firstSlide?.heroImage) return firstSlide.heroImage;
  }
  return hero.heroImage || "";
}

export function getCachedHeroData(): { img: string; imgMobile: string; imgAlt: string; opacity: number; tagline1: string; tagline2: string; buttonText: string; buttonLink: string } | null {
  const homeSettings = pageSettingsCache.get("home");
  if (!homeSettings) return null;
  const hero = homeSettings.hero;
  if (!hero) return null;
  let img = "";
  let imgMobile = "";
  let imgAlt = "";
  let opacity = 0.6;
  let tagline1 = "";
  let tagline2 = "";
  let buttonText = "";
  let buttonLink = "";
  if (hero.slides && Array.isArray(hero.slides) && hero.slides.length > 0) {
    const first = hero.slides[0];
    img = first?.heroImage || "";
    imgMobile = first?.heroImageMobile || "";
    imgAlt = first?.heroImageAlt || "";
    opacity = parseFloat(first?.heroOpacity) || 0.6;
    tagline1 = first?.tagline1 || hero.tagline1 || "";
    tagline2 = first?.tagline2 || hero.tagline2 || "";
    buttonText = first?.buttonText || hero.buttonText || "";
    buttonLink = first?.buttonLink || hero.buttonLink || "";
  } else {
    img = hero.heroImage || "";
    imgMobile = hero.heroImageMobile || "";
    imgAlt = hero.heroImageAlt || "";
    opacity = parseFloat(hero.heroOpacity) || 0.6;
    tagline1 = hero.tagline1 || "";
    tagline2 = hero.tagline2 || "";
    buttonText = hero.buttonText || "";
    buttonLink = hero.buttonLink || "";
  }
  if (!img) return null;
  return { img, imgMobile, imgAlt, opacity, tagline1, tagline2, buttonText, buttonLink };
}

export function getCachedLcpImageUrls(): string[] {
  const heroImage = getCachedHeroImageUrl();
  const results: string[] = [];
  if (heroImage) results.push(heroImage);
  if (results.length < 2) {
    const products = productsCache.get("all");
    if (products && products.length > 0) {
      const visible = products.filter(p => !p.isHidden);
      const productImages = visible.slice(0, 2).map(p => p.thumbnailUrl || p.imageUrl).filter((u): u is string => !!u);
      for (const img of productImages) {
        if (results.length >= 2) break;
        if (!results.includes(img)) results.push(img);
      }
    }
  }
  return results;
}

export function getCachedArtistHeroImage(slug: string): { img: string; imgMobile: string; imgAlt: string; name: string; role: string; heroOpacity: string } {
  const artistPages = pageSettingsCache.get("artist_pages");
  const artist = artistPages?.[slug];
  if (!artist) return { img: "", imgMobile: "", imgAlt: "", name: "", role: "", heroOpacity: "0.5" };
  return {
    img: artist.heroImage || "",
    imgMobile: artist.heroImageMobile || "",
    imgAlt: artist.heroImageAlt || "",
    name: artist.name || "",
    role: artist.role || "",
    heroOpacity: artist.heroOpacity || "0.5",
  };
}

/**
 * Returns the raw in-memory page settings for the given page name.
 * Used by server/static.ts and server/vite.ts to inject window.__HOME_SETTINGS__
 * so the client React Query cache can be pre-populated before first render.
 * Returns null if the cache hasn't warmed up yet (server just started).
 */
export function getCachedRawPageSettings(pageName: string): Record<string, any> | null {
  return pageSettingsCache.get(pageName) || null;
}

// Returns the slug of a product by its numeric ID, searching the full cache
// (includes hidden products). Used before deletion to record the slug for 410.
export function getCachedProductSlugById(id: number): string | null {
  const products = productsCache.get("all");
  if (!products) return null;
  const product = products.find((p: any) => Number(p.id) === id);
  return product ? ((product as any).slug || null) : null;
}

// Returns the set of slugs that were permanently deleted from the catalog.
// Used by bot-ssr to return HTTP 410 Gone for these URLs.
export function getCachedDeletedSlugs(): Set<string> {
  const data = pageSettingsCache.get("deleted_slugs");
  if (!data) return new Set();
  const slugs: string[] = Array.isArray(data?.list?.slugs) ? data.list.slugs : [];
  return new Set(slugs);
}

export function getCachedProductImageBySlug(slug: string): string {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return "";
  const product = products.find(p => (p as any).slug === slug);
  if (!product) return "";
  return product.thumbnailUrl || product.imageUrl || "";
}

export interface ProductMetaForSsr {
  productId: number; title: string; description: string; image: string; images: string[];
  price: number; sku: string; stock: number; category: string;
  subcategory: string | null; subSubcategory: string | null;
  additionalCategories: Array<{ category: string; subcategory: string; subSubcategory?: string }>;
  sizes: string[]; colors: string[]; preorderEnabled: boolean;
  seoTitle: string | null; seoDescription: string | null; seoBody: string | null; seoJsonLd: string | null; specsHtml: string | null; videoUrl: string | null;
  composition: string | null; careInstructions: string | null;
  measurements: Array<{ size: string; [key: string]: string }> | null;
  featureBadgeIds: string[];
  createdAt: Date | null; updatedAt: Date | null;
}

/** Builds the SSR product meta from a parsed product row (cache or YDB). */
function buildProductMeta(product: any): ProductMetaForSsr {
  const extraImages: string[] = [];
  try {
    const raw = (product as any).images;
    if (Array.isArray(raw)) extraImages.push(...raw.filter((u: any) => typeof u === "string" && u.startsWith("http")));
  } catch {}
  const mainImage = product.imageUrl || product.thumbnailUrl || "";
  const allImages = mainImage ? [mainImage, ...extraImages.filter(u => u !== mainImage)] : extraImages;
  return {
    productId: Number(product.id),
    title: product.name || "",
    description: product.description || "",
    image: mainImage,
    images: allImages,
    price: product.price || 0,
    sku: (product as any).article || (product as any).sku || String(product.id),
    stock: Number((product as any).stock ?? 0),
    category: (product as any).category || "",
    subcategory: (product as any).subcategory != null && String((product as any).subcategory).trim() !== ""
      ? String((product as any).subcategory) : null,
    subSubcategory: (product as any).subSubcategory != null && String((product as any).subSubcategory).trim() !== ""
      ? String((product as any).subSubcategory) : null,
    additionalCategories: Array.isArray((product as any).additionalCategories)
      ? (product as any).additionalCategories : [],
    sizes: Array.isArray((product as any).sizes) ? (product as any).sizes : [],
    colors: Array.isArray((product as any).colors) ? (product as any).colors : [],
    preorderEnabled: !!(product as any).preorderEnabled,
    seoTitle: (product as any).seoTitle || null,
    seoDescription: (product as any).seoDescription || null,
    seoBody: (product as any).seoBody || null,
    seoJsonLd: (product as any).seoJsonLd || null,
    specsHtml: (product as any).specsHtml || null,
    videoUrl: (product as any).videoUrl || null,
    composition: (product as any).composition || null,
    careInstructions: (product as any).careInstructions || null,
    measurements: Array.isArray((product as any).measurements) && (product as any).measurements.length > 0
      ? (product as any).measurements
      : null,
    featureBadgeIds: Array.isArray((product as any).featureBadgeIds) ? (product as any).featureBadgeIds : [],
    createdAt: (product as any).createdAt instanceof Date ? (product as any).createdAt : null,
    updatedAt: (product as any).updatedAt instanceof Date ? (product as any).updatedAt : null,
  };
}

export function getCachedProductMetaBySlug(slug: string): ProductMetaForSsr | null {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return null;
  const product = products.find(p => (p as any).slug === slug);
  if (!product) return null;
  return buildProductMeta(product);
}

/**
 * Fetches a product straight from YDB by slug (bypassing the in-memory cache).
 * Used by bot-SSR as a fallback when the slug is not in the cache (e.g. right
 * after a server restart) so crawlers get the real product card instead of the
 * empty SPA shell. `isPublic` mirrors the same visibility filter the cache path
 * uses: !isHidden && !artistOnly && price > 0.
 */
export async function getProductMetaBySlugFromDb(slug: string): Promise<{ meta: ProductMetaForSsr; isPublic: boolean } | null> {
  const product = await storage.getProductBySlugFromDb(slug);
  if (!product) return null;
  const meta = buildProductMeta(product);
  const isPublic = !product.isHidden && !product.artistOnly && (product.price ?? 0) > 0;
  return { meta, isPublic };
}

// ─── Artist Tracks ────────────────────────────────────────────────────────────
export interface ArtistTrack {
  id: number;
  artistSlug: string;
  title: string;
  subtitle: string;
  audioUrl: string;
  coverUrl: string;
  duration: number;
  trackOrder: number;
  plays: number;
  isActive: boolean;
  createdAt: string;
}

export interface IStorage {
  getProductByExternalId(externalId: string): Promise<Product | undefined>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  getProductBySlugFromDb(slug: string): Promise<Product | undefined>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  getColorVariantsBySku(sku: string, excludeId?: number): Promise<Product[]>; // Get all color variants for same SKU
  getProducts(): Promise<Product[]>;
  getAllProductsForAdmin(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: number): Promise<boolean>;
  deleteAllProducts(): Promise<number>;
  clearCache(): void;
  clearProductCache(productId?: number): void;
  getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]>;
  getCartByUserId(userId: number): Promise<(CartItem & { product: Product })[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  updateCartItemQuantity(id: number, quantity: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<CartItem | null>;
  removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  getOrders(): Promise<Order[]>;
  getOrderAnalytics(): Promise<{ month: string; retailCount: number; wholesaleCount: number; retailRevenue: number; wholesaleRevenue: number }[]>;
  getArtistAnalytics(): Promise<{ artist: string; revenue: number; orders: number; items: number; ordersList: { orderId: number; date: string; customerName: string; items: { name: string; qty: number; price: number }[]; total: number }[] }[]>;
  getMonthlySalesReport(from?: string, to?: string, type?: 'retail' | 'wholesale' | 'all'): Promise<{ month: string; ownerKey: string; ownerLabel: string; revenue: number; qty: number; items: { productName: string; size: string; color: string; qty: number; price: number }[] }[]>;
  getUnsyncedOrdersFor1C(): Promise<Order[]>;
  markOrdersSyncedTo1C(orderIds: number[]): Promise<void>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  updateOrderStatus(id: number, status: string, paymentId?: string): Promise<Order>;
  markOrderPaid(id: number, paymentId: string): Promise<Order>;
  updateOrderPaymentId(id: number, paymentId: string): Promise<void>;
  createOrder(order: InsertOrder & { items: any[], total: number, promoCode?: string, isWholesale?: boolean, transportCompany?: string, userId?: number, partnerId?: number, cdekPointCode?: string, cdekCityCode?: number, cdekTariffCode?: number, cdekDeliveryType?: string, cdekDoorAddress?: { street: string; house: string; flat?: string; entrance?: string; floor?: string }, ozonPvzId?: string, ozonPvzAddress?: string }): Promise<Order>;
  updateOrderCdekData(id: number, cdekData: string): Promise<void>;
  updateOrderBitrixDealId(id: number, dealId: number): Promise<void>;
  getOrderBitrixDealId(id: number): Promise<number | null>;
  incrementPreorderCurrent(productId: number): Promise<number>;
  updatePreorderStatus(productId: number, status: string): Promise<void>;
  getPreorderProducts(): Promise<Product[]>;
  getWholesalePreorderProducts(): Promise<Product[]>;
  createPreorderOrder(order: InsertOrder & { items: any[], total: number, userId?: number, depositAmount: number }): Promise<Order>;
  updateOrderPreorderFields(orderId: number, fields: { depositPaid?: boolean; remainingAmount?: number; preorderPaymentId?: string; isPreorder?: boolean }): Promise<void>;
  getPreorderOrdersByUser(userId: number): Promise<Order[]>;
  getAllRetailPreorderOrders(): Promise<Order[]>;
  saveOrderInvoiceNumber(orderId: number, invoiceNumber: number): Promise<void>;
  deleteOrder(id: number): Promise<boolean>;
  deleteExpiredDraftOrders(maxAgeMinutes: number): Promise<number>;
  updateOrderAddonData(orderId: number, addonData: string): Promise<void>;
  updateOrderItems(orderId: number, items: any[], totalKopeks: number): Promise<void>;
  appendOrderItems(orderId: number, newItems: any[], addedTotal: number): Promise<void>;
  getDraftOrders(): Promise<any[]>;
  // Gift cards
  createGiftCard(card: InsertGiftCard): Promise<GiftCard>;
  getGiftCardByCode(code: string): Promise<GiftCard | undefined>;
  getGiftCardById(id: number): Promise<GiftCard | undefined>;
  updateGiftCard(id: number, updates: Partial<GiftCard>): Promise<GiftCard>;
  getGiftCardsByEmail(email: string): Promise<GiftCard[]>;
  getGiftCards(): Promise<GiftCard[]>;
  deleteGiftCard(id: number): Promise<boolean>;
  redeemGiftCard(code: string, userId: number, amount: number): Promise<GiftCard>;
  migrateGiftCardsTable(): Promise<{ success: boolean; message: string }>;
  // Bonus system
  migrateBonusTables(): Promise<{ success: boolean; message: string }>;
  // Promo codes
  getPromoCodes(): Promise<PromoCode[]>;
  getPromoCodeByCode(code: string): Promise<PromoCode | undefined>;
  createPromoCode(promo: InsertPromoCode): Promise<PromoCode>;
  updatePromoCode(id: number, updates: Partial<PromoCode>): Promise<PromoCode>;
  deletePromoCode(id: number): Promise<boolean>;
  incrementPromoCodeUsage(code: string): Promise<void>;
  isPromoUsedByEmail(email: string, code: string): Promise<boolean>;
  getPartnerPromoCode(partnerId: number): Promise<(PromoCode & { partnerId?: number }) | undefined>;
  setPartnerPromoCode(partnerId: number, code: string, discountPercent: number): Promise<PromoCode & { partnerId?: number }>;
  deletePartnerPromoCode(partnerId: number): Promise<void>;
  // Loyalty tiers
  getLoyaltyTiers(): Promise<LoyaltyTier[]>;
  createLoyaltyTier(tier: InsertLoyaltyTier): Promise<LoyaltyTier>;
  updateLoyaltyTier(id: number, updates: Partial<LoyaltyTier>): Promise<LoyaltyTier>;
  deleteLoyaltyTier(id: number): Promise<boolean>;
  // Newsletter subscriptions
  getNewsletterSubscription(email: string): Promise<NewsletterSubscription | undefined>;
  createNewsletterSubscription(sub: InsertNewsletterSubscription): Promise<NewsletterSubscription>;
  getAllNewsletterSubscriptions(): Promise<NewsletterSubscription[]>;
  deleteNewsletterSubscription(id: number): Promise<boolean>;
  // Preorder subscribers
  addPreorderSubscriber(email: string, name?: string): Promise<void>;
  getPreorderSubscriberByEmail(email: string): Promise<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean } | undefined>;
  getAllPreorderSubscribers(): Promise<Array<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean }>>;
  updatePreorderSubscriberStatus(email: string, isActive: boolean): Promise<void>;
  // User loyalty (admin)
  getUsersWithLoyalty(): Promise<Array<{ id: number; name: string; email: string; totalSpent: number; loyaltyDiscount: number }>>;
  // Bonus settings
  getBonusSetting(key: string): Promise<string | undefined>;
  setBonusSetting(key: string, value: string): Promise<void>;
  getAllBonusSettings(): Promise<Record<string, string>>;
  // Preorder pickup points
  getPickupPoints(): Promise<PickupPoint[]>;
  savePickupPoints(points: PickupPoint[]): Promise<void>;
  // Retail pickup points (regular checkout)
  getRetailPickupPoints(): Promise<PickupPoint[]>;
  saveRetailPickupPoints(points: PickupPoint[]): Promise<void>;
  // User loyalty
  updateUserTotalSpent(userId: number, amount: number): Promise<void>;
  decrementUserTotalSpent(userId: number, amount: number): Promise<void>;
  recalculateUserLoyaltyDiscount(userId: number): Promise<number>;
  accrueOrderLoyalty(orderId: number): Promise<{ accrued: boolean; discount: number }>;
  revokeOrderLoyalty(orderId: number): Promise<{ revoked: boolean; discount: number }>;
  mergeGuestOrdersToUser(userId: number, email: string): Promise<{ linked: number; accrued: number }>;
  recalculateAllUsersLoyalty(): Promise<{ total: number; updated: number }>;
  // Page settings
  getPageSettings(pageName: string): Promise<Record<string, any>>;
  setPageSectionSettings(pageName: string, sectionId: string, settings: any): Promise<void>;
  deletePageSectionSettings(pageName: string, sectionId: string): Promise<void>;
  // Reviews
  getReviewsByProduct(productId: number): Promise<Review[]>;
  getAllReviews(): Promise<Review[]>;
  getReviewById(id: number): Promise<Review | undefined>;
  createReview(review: InsertReview): Promise<Review>;
  updateReview(id: number, updates: Partial<Review>): Promise<Review>;
  deleteReview(id: number): Promise<boolean>;
  migrateReviewsTable(): Promise<{ success: boolean; message: string }>;
  // Stock notifications
  createStockNotification(productId: number, productName: string, size: string, email: string): Promise<boolean>;
  getStockNotificationCount(productId: number, size?: string): Promise<number>;
  getUnnotifiedByProductAndSize(productId: number, size: string): Promise<Array<{ id: string; email: string }>>;
  markStockNotificationsNotified(ids: string[]): Promise<void>;
  getAllStockNotifications(): Promise<Array<{ id: string; productId: string; productName: string; size: string; email: string; createdAt: string; notified: boolean; notifiedAt: string | null }>>;
  // Abandoned cart reminders
  getAbandonedCartUserSessions?(): Promise<string[]>;
  getUserEmailById?(userId: number): Promise<{ name: string; email: string } | null>;
  getCartReminder?(userId: number): Promise<{ sentAt: string; cartHash: string } | null>;
  upsertCartReminder?(userId: number, cartHash: string): Promise<void>;
  clearCartReminders?(): Promise<number>;
  // Price drop subscriptions
  createPriceDropSubscription(productId: number, productName: string, email: string, priceAtSubscription: number): Promise<boolean>;
  checkPriceDropSubscription(productId: number, email: string): Promise<boolean>;
  getSubscribedProductIdsByEmail(email: string): Promise<number[]>;
  getAllPriceDropSubscriptions(): Promise<Array<{ id: string; productId: string; productName: string; email: string; priceAtSubscription: number; createdAt: string; notified: boolean; notifiedAt: string | null }>>;
  getPriceDropSubscribersByProduct(productId: number): Promise<Array<{ id: string; email: string; priceAtSubscription: number }>>; 
  markPriceDropSubscriptionsNotified(ids: string[], newPrice: number): Promise<void>;
  getPriceDropSubscriptionsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; priceAtSubscription: number; createdAt: string }>>;
  deletePriceDropSubscription(productId: number, email: string): Promise<void>;
  getStockNotificationsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; size: string; createdAt: string }>>;
  deleteStockNotification(productId: number, size: string, email: string): Promise<void>;
  // Chat
  saveChatMessage(msg: { messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; tgMessageId?: number; vkMessageId?: number; imageUrl?: string }): Promise<void>;
  getChatMessages(sessionId: string, since?: number): Promise<Array<{ messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; imageUrl?: string }>>;
  getSessionIdByTgMessageId(tgMessageId: number): Promise<string | null>;
  getSessionIdByVkMessageId(vkMessageId: number): Promise<string | null>;
  getChatSessions(): Promise<Array<{ sessionId: string; lastMessage: string; lastTimestamp: number; userName?: string; unread?: number }>>;
  // Wholesale XML feed
  getWholesaleFeedProductIds(userId: number): Promise<number[]>;
  addWholesaleFeedProduct(userId: number, productId: number): Promise<void>;
  removeWholesaleFeedProduct(userId: number, productId: number): Promise<void>;
  getOrCreateWholesaleFeedToken(userId: number): Promise<string>;
  getUserIdByWholesaleFeedToken(token: string): Promise<number | null>;
  // Partners
  createPartner(
    data: InsertPartner,
    signatures?: Array<Omit<InsertConsentSignature, "partnerId">>,
  ): Promise<Partner>;
  getPartnerById(id: number): Promise<Partner | null>;
  getPartnerByUserId(userId: number): Promise<Partner | null>;
  getPartnerBySlug(slug: string): Promise<Partner | null>;
  isPartnerSlugTaken(slug: string): Promise<boolean>;
  listPartners(filter?: { status?: string }): Promise<Partner[]>;
  updatePartnerContacts(id: number, data: { contactName?: string; contactPhone?: string; storeName?: string }): Promise<void>;
  updatePartnerBankDetails(id: number, data: { bankBik: string; bankAccount: string; bankName: string; bankCorrAccount: string }): Promise<void>;
  updatePartnerStatus(id: number, status: "pending" | "approved" | "rejected" | "blocked"): Promise<void>;
  updatePartnerCommissionOverride(id: number, percent: number | null): Promise<void>;
  setPartnerPayoutRequested(id: number, requested: boolean): Promise<void>;
  updatePartnerIsArtist(id: number, isArtist: boolean): Promise<void>;
  updatePartnerArtistRate(id: number, rate: number | null): Promise<void>;
  deletePartner(id: number): Promise<void>;
  getArtistPartners(): Promise<Partner[]>;
  getArtistProductsBySlug(partnerSlug: string): Promise<Product[]>;
  createArtistProduct(partnerSlug: string, data: { name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition?: string }): Promise<Product>;
  updateArtistProduct(productId: number, partnerSlug: string, data: Partial<{ name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition: string; isHidden: boolean }>): Promise<Product>;
  deleteArtistProduct(productId: number, partnerSlug: string): Promise<void>;
  getArtistStatsBySlug(partnerSlug: string, excludeOrderIds?: Set<number>): Promise<{ revenue: number; orders: number; items: number; monthlyRevenue: { month: string; revenue: number }[]; topProducts: { name: string; revenue: number; items: number }[] }>;
  incrementPartnerClicksBySlug(slug: string): Promise<void>;
  // Partner products
  getPartnerProductIds(partnerId: number): Promise<number[]>;
  addPartnerProduct(partnerId: number, productId: number): Promise<void>;
  removePartnerProduct(partnerId: number, productId: number): Promise<void>;
  // Partner commissions
  createPartnerCommission(data: { partnerId: number; orderId: number; orderItemsTotal: number; commissionPercent: number; commissionAmount: number }): Promise<PartnerCommission>;
  getCommissionsByPartner(partnerId: number, filter?: { status?: string }): Promise<PartnerCommission[]>;
  getCommissionById(id: number): Promise<PartnerCommission | null>;
  getCommissionByOrderId(orderId: number): Promise<PartnerCommission | null>;
  getCommissionsByOrderId(orderId: number): Promise<PartnerCommission[]>;
  listAllCommissions(filter?: { status?: string; partnerId?: number }): Promise<PartnerCommission[]>;
  updateCommissionStatus(id: number, status: "pending" | "confirmed" | "cancelled" | "paid"): Promise<void>;
  deleteCommission(id: number): Promise<void>;
  markCommissionsPaid(ids: number[]): Promise<void>;
  setCommissionHoldUntil(id: number, holdUntil: Date | null): Promise<void>;
  /** Возвращает все активные (pending/confirmed) реф-комиссии партнёра за календарный месяц */
  getMonthlyRefCommissions(partnerId: number, year: number, month: number): Promise<PartnerCommission[]>;
  /** Пересчитывает commission_percent и commission_amount для всех активных комиссий за месяц и синхронизирует totalEarned */
  recalcMonthlyCommissions(partnerId: number, year: number, month: number, newPercent: number): Promise<void>;
  getPartnerStats(partnerId: number, excludeIds?: number[]): Promise<{ clicks: number; ordersCount: number; ordersTotal: number; awaitingPaymentAmount: number; holdAmount: number; pendingAmount: number; confirmedAmount: number; paidAmount: number; readyToConfirmAmount: number }>;
  // Partner payouts (history)
  createPartnerPayout(data: { partnerId: number; amount: number; commissionIds: number[]; method: string; recipientName: string; recipientDetails: string; note?: string | null; createdBy?: string | null }): Promise<PartnerPayout>;
  listPartnerPayouts(partnerId?: number): Promise<PartnerPayout[]>;
  getPayoutById(id: number): Promise<PartnerPayout | null>;
  updatePartnerPayoutFields(
    id: number,
    fields: Partial<{
      status: string;
      invoiceUrl: string | null;
      invoiceUploadedAt: Date | null;
      invoiceNumber: string | null;
      paidAt: Date | null;
      paidReference: string | null;
      receiptUrl: string | null;
      receiptUploadedAt: Date | null;
      receiptNumber: string | null;
      actUrl: string | null;
      actUploadedAt: Date | null;
      actNumber: string | null;
      completedAt: Date | null;
      rejectedReason: string | null;
    }>,
  ): Promise<void>;
  // Partner global commission percent (wraps bonus_settings)
  getGlobalPartnerCommissionPercent(): Promise<number>;
  setGlobalPartnerCommissionPercent(percent: number): Promise<void>;
  // Partner hold-period (in days). Stored in bonus_settings.
  getGlobalPartnerHoldDays(): Promise<number>;
  setGlobalPartnerHoldDays(days: number): Promise<void>;
  // === Legal documents (versioned, append-only) ===
  createLegalDocument(data: { slug: string; version: string; title: string; body: string; createdBy?: string | null }): Promise<LegalDocument>;
  getActiveLegalDocument(slug: string): Promise<LegalDocument | null>;
  getLegalDocumentById(id: string): Promise<LegalDocument | null>;
  listLegalDocuments(slug?: string): Promise<LegalDocument[]>;
  // === Consent signatures (audit trail, append-only) ===
  createConsentSignature(data: InsertConsentSignature): Promise<ConsentSignature>;
  listConsentSignaturesByPartnerId(partnerId: number): Promise<ConsentSignature[]>;
  // === УНЭП «email-link first» (30.04.2026) ===
  // Промежуточная таблица: ждёт клика по ссылке в письме, после чего
  // создаются user+partner+consent_signatures одной транзакцией.
  // TTL на стороне YDB (expires_at), Node-крон не нужен.
  createPartnerPendingSubmission(input: {
    token: string;
    payload: any;
    formHashes: any;
    ip: string;
    remoteIp: string | null;
    userAgent: string;
    geoCountry: string | null;
    geoRegion: string | null;
    geoCity: string | null;
    expiresAt: Date;
  }): Promise<boolean>;
  getPartnerPendingSubmission(token: string): Promise<{
    token: string;
    payload: any;
    formHashes: any;
    ip: string;
    remoteIp: string | null;
    userAgent: string;
    geoCountry: string | null;
    geoRegion: string | null;
    geoCity: string | null;
    createdAt: Date;
    expiresAt: Date;
  } | null>;
  deletePartnerPendingSubmission(token: string): Promise<void>;

  // Artist tracks
  getArtistTracks(artistSlug: string, adminMode?: boolean): Promise<ArtistTrack[]>;
  createArtistTrack(data: { artistSlug: string; title: string; subtitle?: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number }): Promise<ArtistTrack>;
  updateArtistTrack(id: number, data: Partial<{ title: string; subtitle: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number; isActive: boolean }>): Promise<void>;
  deleteArtistTrack(id: number): Promise<void>;
  incrementTrackPlays(id: number, count?: number): Promise<void>;
}

// Simple in-memory storage for development mode
export const devProducts: Product[] = [];
export const devCartItems: CartItem[] = [];

/**
 * Normalizes timestamps returned by YDB and legacy data.
 * YDB timestamps may already be ISO strings after extractTypedValue(), while
 * older paths can still return seconds, milliseconds, or microseconds.
 */
function parseStorageDate(value: unknown, fallback: Date | null): Date | null {
  if (value == null || value === "") return fallback;

  let date: Date;
  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === "number" || (typeof value === "string" && /^[+-]?[0-9]+(?:[.][0-9]+)?$/.test(value.trim()))) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;

    const absolute = Math.abs(numeric);
    const milliseconds = absolute >= 1e14
      ? numeric / 1000 // YDB Timestamp: microseconds
      : absolute >= 1e11
        ? numeric // Unix milliseconds
        : numeric * 1000; // Unix seconds
    date = new Date(milliseconds);
  } else {
    date = new Date(String(value).trim());
  }

  return Number.isFinite(date.getTime()) ? date : fallback;
}

/**
 * Статусы, при которых заказ НЕ считается оплаченным для программы лояльности.
 * Начисление total_spent происходит при оплате (status становится "paid"),
 * далее статус движется по цепочке processing → shipped → delivered и т.д.
 * Эти статусы исключаем из зачёта при пересчёте и начислении.
 */
const LOYALTY_NOT_COUNTED_STATUSES = new Set([
  'pending',
  'awaiting_payment',
  'cancelled',
  'refunded',
  'new',
  'created',
]);

export function isLoyaltyCountedStatus(status: string | null | undefined): boolean {
  return !!status && !LOYALTY_NOT_COUNTED_STATUSES.has(status);
}

export function safeParseJson(raw: string | null | undefined): Record<string, any> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export class DatabaseStorage implements IStorage {
  // Price drop subscriptions table readiness flag (used by notifications.ts ensurePriceDropTable)
  public _priceDropTableReady = false;

  public async safeQuery<T>(fn: (session: ydb.Session) => Promise<T>, maxRetries: number = 3): Promise<T | null> {
    if (!driver) return null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await driver.tableClient.withSession(fn);
      } catch (err: any) {
        const errorName = err.constructor?.name || '';
        const isRetryable = errorName === 'BadSession' || 
                           err.message?.includes('Session not found') ||
                           err.message?.includes('RESOURCE_EXHAUSTED') ||
                           err.message?.includes('Transaction locks invalidated') ||
                           err.message?.includes('Aborted');
        
        // Handle authentication errors - reconnect and retry
        if (isAuthError(err)) {
          console.log(`[YDB] Authentication error detected (attempt ${attempt}/${maxRetries})`);
          const reconnected = await reconnectYdb();
          if (reconnected && attempt < maxRetries) {
            console.log(`[YDB] Reconnected, retrying query...`);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
        }
        
        if (isRetryable && attempt < maxRetries) {
          const isRateLimit = err.message?.includes('RESOURCE_EXHAUSTED');
          const delay = isRateLimit ? 1000 * attempt : 200 * attempt;
          console.log(`[YDB] Retrying after ${errorName || 'error'} (attempt ${attempt}/${maxRetries}), wait ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        logError("[YDB Query Error]:", err.message || err);
        if (err.issues) {
          logError("[YDB Issues]:", JSON.stringify(err.issues, null, 2));
        }
        return null;
      }
    }
    return null;
  }

  public extractTypedValue(item: any): any {
    if (!item) return null;
    
    // Check concrete typed values FIRST (protobuf has all getters defined)
    if (item.textValue !== undefined && item.textValue !== null) return item.textValue;
    if (item.doubleValue !== undefined && item.doubleValue !== null) return item.doubleValue;
    if (item.floatValue !== undefined && item.floatValue !== null) return item.floatValue;
    // Handle YDB Timestamp (microseconds since epoch) - check before other uint64
    if (item.uint64Value !== undefined && item.uint64Value !== null) {
      const val = Number(item.uint64Value);
      // If it looks like a timestamp (after year 2000 in microseconds), convert to ISO string
      if (val > 946684800000000) {
        return new Date(val / 1000).toISOString();
      }
      return val;
    }
    if (item.int64Value !== undefined && item.int64Value !== null) return item.int64Value;
    if (item.uint32Value !== undefined && item.uint32Value !== null) {
      const val = Number(item.uint32Value);
      // YDB DATETIME type stores seconds since epoch (uint32). Year 2000 = 946684800 seconds.
      // Regular Int32 fields (discount, amount, etc.) are declared as Int32 and come back as int32Value, not uint32Value.
      // So any uint32Value > 946684800 is a DATETIME → convert to ISO string.
      if (val > 946684800) {
        return new Date(val * 1000).toISOString();
      }
      return val;
    }
    if (item.int32Value !== undefined && item.int32Value !== null) return item.int32Value;
    if (item.boolValue !== undefined && item.boolValue !== null) return item.boolValue;
    if (item.bytesValue !== undefined && item.bytesValue !== null) return item.bytesValue;
    
    // Handle YDB Optional wrapper AFTER checking concrete types
    if (item.optionalValue !== undefined && item.optionalValue !== null) {
      return this.extractTypedValue(item.optionalValue);
    }
    
    // Null flag check
    if (item.nullFlagValue !== undefined) return null;
    
    // Fallback
    if (item.value !== undefined) return item.value;
    
    return null;
  }

  public parseRowWithColumns(row: any, columns: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    if (row.items && Array.isArray(row.items)) {
      for (let i = 0; i < row.items.length && i < columns.length; i++) {
        const colName = columns[i].name;
        result[colName] = this.extractTypedValue(row.items[i]);
      }
    }
    return result;
  }

  public parseResultSet<T>(rs: any): T[] {
    if (!rs?.rows || !rs?.columns) return [];
    return rs.rows.map((row: any) => {
      const data = this.parseRowWithColumns(row, rs.columns);
      // Convert snake_case to camelCase
      const converted: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        converted[camelKey] = v;
      }
      return converted as T;
    });
  }

  public parseProduct(data: Record<string, any>): Product {
    let images: string[] = [];
    if (data.images) {
      if (typeof data.images === 'string') {
        try { images = JSON.parse(data.images); } catch { images = []; }
      } else if (Array.isArray(data.images)) {
        images = data.images;
      }
    }
    
    let sizes: string[] = [];
    if (data.sizes) {
      if (typeof data.sizes === 'string') {
        try { sizes = JSON.parse(data.sizes); } catch { sizes = []; }
      } else if (Array.isArray(data.sizes)) {
        sizes = data.sizes;
      }
    }
    
    let colors: string[] = [];
    if (data.colors) {
      if (typeof data.colors === 'string') {
        try { colors = JSON.parse(data.colors); } catch { colors = []; }
      } else if (Array.isArray(data.colors)) {
        colors = data.colors;
      }
    }
    
    const priceVal = data.price;
    const parsedPrice = typeof priceVal === 'number' ? priceVal : parseFloat(priceVal) || 0;
    
    const wholesalePriceVal = data.wholesale_price;
    const parsedWholesalePrice = wholesalePriceVal != null 
      ? (typeof wholesalePriceVal === 'number' ? wholesalePriceVal : parseFloat(wholesalePriceVal) || null)
      : null;
    
    let sizeStock: Record<string, number> | null = null;
    if (data.size_stock) {
      if (typeof data.size_stock === 'string') {
        try { sizeStock = JSON.parse(data.size_stock); } catch { sizeStock = null; }
      } else if (typeof data.size_stock === 'object') {
        sizeStock = data.size_stock;
      }
    }

    let sizeDiscounts: Record<string, number> | null = null;
    if (data.size_discounts) {
      if (typeof data.size_discounts === 'string') {
        try { sizeDiscounts = JSON.parse(data.size_discounts); } catch { sizeDiscounts = null; }
      } else if (typeof data.size_discounts === 'object') {
        sizeDiscounts = data.size_discounts;
      }
    }

    let sizeCharacteristicIds: Record<string, string> | null = null;
    if (data.size_characteristic_ids) {
      if (typeof data.size_characteristic_ids === 'string') {
        try { sizeCharacteristicIds = JSON.parse(data.size_characteristic_ids); } catch { sizeCharacteristicIds = null; }
      } else if (typeof data.size_characteristic_ids === 'object') {
        sizeCharacteristicIds = data.size_characteristic_ids;
      }
    }
    
    return {
      id: typeof data.id === 'string' ? parseInt(data.id) || 0 : (data.id || 0),
      externalId: data.external_id || null,
      sku: data.sku || null,
      name: data.name || '',
      description: data.description || '',
      price: parsedPrice,
      wholesalePrice: parsedWholesalePrice,
      wholesaleDiscountPercent: data.wholesale_discount_percent ? Number(data.wholesale_discount_percent) : null,
      discountPercent: data.old_price ? Number(data.old_price) : null,
      salePrice: data.sale_price ? Number(data.sale_price) : null,
      imageUrl: toCdnUrl(images.length > 0 ? images[0] : (data.image_url || '')),
      thumbnailUrl: toCdnUrl(data.thumbnail_url || null),
      hoverThumbnailUrl: toCdnUrl(data.hover_thumbnail_url || null),
      images: images.map(toCdnUrl), // Include images array for gallery
      category: data.category || '',
      subcategory: data.subcategory || null,
      subSubcategory: data.sub_subcategory || null,
      color: data.color || null, // Color of this specific variant
      sizes,
      colors,
      isNew: data.is_new === true,
      badgeText: data.badge_text || null,
      onSale: data.on_sale === true,
      isHidden: data.is_hidden === true,
      autoHideOverride: data.auto_hide_override === true,
      inStock: data.in_stock !== false, // Default to true if not set
      stock: data.stock ? Number(data.stock) : 0, // Stock quantity from YDB
      sizeStock: sizeStock, // Stock per size for wholesale users
      sizeDiscounts: sizeDiscounts, // Discounts per size in %
      sizeCharacteristicIds: sizeCharacteristicIds, // 1C characteristic GUIDs per size: {"L": "guid-..."}

      measurements: (() => {
        if (data.measurements) {
          if (typeof data.measurements === 'string') {
            try { return JSON.parse(data.measurements); } catch { return []; }
          } else if (Array.isArray(data.measurements)) {
            return data.measurements;
          }
        }
        return [];
      })(),
      measurementSections: (() => {
        if (data.measurement_sections) {
          if (typeof data.measurement_sections === 'string') {
            try { return JSON.parse(data.measurement_sections); } catch { return []; }
          } else if (Array.isArray(data.measurement_sections)) {
            return data.measurement_sections;
          }
        }
        return [];
      })(),
      lookProducts: (() => {
        if (data.look_products) {
          if (typeof data.look_products === 'string') {
            try { return JSON.parse(data.look_products); } catch { return []; }
          } else if (Array.isArray(data.look_products)) {
            return data.look_products;
          }
        }
        return [];
      })(),
      lookCategory: data.look_category || null,
      lookSubcategory: data.look_subcategory || null,
      seoTitle: data.seo_title || null,
      seoDescription: data.seo_description || null,
      seoBody: data.seo_body || null,
      seoJsonLd: data.seo_json_ld || null,
      imageAlts: (() => {
        if (data.image_alts) {
          if (typeof data.image_alts === 'string') {
            try { return JSON.parse(data.image_alts); } catch { return []; }
          } else if (Array.isArray(data.image_alts)) {
            return data.image_alts;
          }
        }
        return [];
      })(),
      featureBadgeIds: (() => {
        if (data.feature_badge_ids) {
          if (typeof data.feature_badge_ids === 'string') {
            try { return JSON.parse(data.feature_badge_ids); } catch { return []; }
          } else if (Array.isArray(data.feature_badge_ids)) {
            return data.feature_badge_ids;
          }
        }
        return [];
      })(),
      noSize: data.no_size === true,
      preorderEnabled: data.preorder_enabled === true,
      wholesalePreorderEnabled: data.wholesale_preorder_enabled === true,
      wholesalePreorderRrp: data.wholesale_preorder_rrp != null ? Number(data.wholesale_preorder_rrp) : null,
      wholesalePreorderPrice: data.wholesale_preorder_price != null ? Number(data.wholesale_preorder_price) : null,
      wholesalePreorderSizes: (() => {
        if (data.wholesale_preorder_sizes) {
          if (typeof data.wholesale_preorder_sizes === 'string') {
            try { return JSON.parse(data.wholesale_preorder_sizes); } catch { return []; }
          } else if (Array.isArray(data.wholesale_preorder_sizes)) {
            return data.wholesale_preorder_sizes;
          }
        }
        return [];
      })(),
      preorderGoal: data.preorder_goal ? Number(data.preorder_goal) : 0,
      preorderCurrent: data.preorder_current ? Number(data.preorder_current) : 0,
      preorderDeadline: data.preorder_deadline || null,
      preorderProductionDate: data.preorder_production_date || null,
      preorderShippingDate: data.preorder_shipping_date || null,
      preorderStatus: data.preorder_status || null,
      additionalCategories: (() => {
        if (data.additional_categories) {
          if (typeof data.additional_categories === 'string') {
            try { return JSON.parse(data.additional_categories); } catch { return []; }
          } else if (Array.isArray(data.additional_categories)) {
            return data.additional_categories;
          }
        }
        return [];
      })(),
      slug: data.slug || null,
      createdAt: parseStorageDate(data.created_at, new Date())!,
      updatedAt: parseStorageDate(data.updated_at, null),
      composition: data.composition || null,
      careInstructions: data.care_instructions || null,
      specsHtml: data.specs_html || null,
      note: data.note || null,
      delivery: data.delivery || null,
      returnPolicy: data.return_policy || null,
      artistSlug: data.artist_slug ? String(data.artist_slug) : null,
      artistOnly: data.artist_only === true,
      videoUrl: data.video_url ? String(data.video_url) : null,
      preorderGroup: data.preorder_group ? String(data.preorder_group) : null,
    } as unknown as Product;
  }

  clearCache(): void {
    productsCache.clear();
    productCache.clear();
    pageSettingsCache.clear();
  }

  async migrateOrdersTable(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized — migration skipped" };
    }
    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable('orders', new ydb.TableDescription()
          .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column('session_id', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('customer_name', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('customer_email', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('customer_phone', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('address', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('total', ydb.Types.optional(ydb.Types.INT32)))
          .withColumn(new ydb.Column('items', ydb.Types.optional(ydb.Types.JSON)))
          .withColumn(new ydb.Column('status', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('created_at', ydb.Types.optional(ydb.Types.TIMESTAMP)))
          .withPrimaryKey('id')
          .withIndex(new ydb.TableIndex('idx_orders_email').withIndexColumns('customer_email'))
          .withIndex(new ydb.TableIndex('idx_orders_status').withIndexColumns('status'))
        );
      });
      return { success: true, message: "Table orders created successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        return { success: true, message: "Table orders already exists" };
      }
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  public _cartRemindersTableReady = false;

}

export const storage = new DatabaseStorage();
