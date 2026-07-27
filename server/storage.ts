import { driver, waitForDriver, isAuthError, reconnectYdb } from "./db";

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

const productsCache = new SimpleCache<Product[]>(300, 1800);
const productCache = new SimpleCache<Product>(300, 1800);
const pageSettingsCache = new SimpleCache<Record<string, any>>(120, 600);

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
function serializeOrderPartnerId(id: number): any {
  return ydb.TypedValues.utf8(String(id));
}

function deserializeOrderPartnerId(raw: any): number | null {
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
    console.error("[Ratings] Failed to warm ratings cache:", err);
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
    console.error("[Reviews] Failed to warm reviews cache:", err);
  }
}

export function getCachedReviewsByProductId(productId: number): CachedReview[] {
  return reviewsCache.get(productId) || [];
}

export function getCachedProductsByCategory(categorySlug: string, limit = 80): Array<{
  slug: string; name: string; price: number; stock: number; category: string;
}> {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return [];
  return products
    .filter((p: any) => !p.isHidden && !p.artistOnly && p.slug && p.category === categorySlug && p.price > 0)
    .slice(0, limit)
    .map((p: any) => ({
      slug: String(p.slug),
      name: String(p.name || ""),
      price: Number(p.price || 0),
      stock: Number(p.stock ?? 0),
      category: String(p.category || ""),
    }));
}

export function getCachedAllVisibleProducts(limit = 50): Array<{
  slug: string; name: string; price: number; stock: number; category: string;
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
    }));
}

export function getCachedProductsForRecommendations(limit = 2000): Array<{
  id: number; slug: string; name: string; price: number; stock: number; category: string;
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

export function getCachedProductMetaBySlug(slug: string): {
  productId: number; title: string; description: string; image: string; images: string[];
  price: number; sku: string; stock: number; category: string;
  sizes: string[]; colors: string[]; preorderEnabled: boolean;
  seoTitle: string | null; seoDescription: string | null; seoBody: string | null; specsHtml: string | null; videoUrl: string | null;
  composition: string | null; careInstructions: string | null;
  measurements: Array<{ size: string; [key: string]: string }> | null;
  featureBadgeIds: string[];
} | null {
  const products = productsCache.get("all");
  if (!products || products.length === 0) return null;
  const product = products.find(p => (p as any).slug === slug);
  if (!product) return null;
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
    sizes: Array.isArray((product as any).sizes) ? (product as any).sizes : [],
    colors: Array.isArray((product as any).colors) ? (product as any).colors : [],
    preorderEnabled: !!(product as any).preorderEnabled,
    seoTitle: (product as any).seoTitle || null,
    seoDescription: (product as any).seoDescription || null,
    seoBody: (product as any).seoBody || null,
    specsHtml: (product as any).specsHtml || null,
    videoUrl: (product as any).videoUrl || null,
    composition: (product as any).composition || null,
    careInstructions: (product as any).careInstructions || null,
    measurements: Array.isArray((product as any).measurements) && (product as any).measurements.length > 0
      ? (product as any).measurements
      : null,
    featureBadgeIds: Array.isArray((product as any).featureBadgeIds) ? (product as any).featureBadgeIds : [],
  };
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
  getUnsyncedOrdersFor1C(): Promise<Order[]>;
  markOrdersSyncedTo1C(orderIds: number[]): Promise<void>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  updateOrderStatus(id: number, status: string, paymentId?: string): Promise<Order>;
  updateOrderPaymentId(id: number, paymentId: string): Promise<void>;
  createOrder(order: InsertOrder & { items: any[], total: number, partnerId?: number }): Promise<Order>;
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
  // User loyalty
  updateUserTotalSpent(userId: number, amount: number): Promise<void>;
  recalculateUserLoyaltyDiscount(userId: number): Promise<number>;
  // Page settings
  getPageSettings(pageName: string): Promise<Record<string, any>>;
  setPageSectionSettings(pageName: string, sectionId: string, settings: any): Promise<void>;
  deletePageSectionSettings(pageName: string, sectionId: string): Promise<void>;
  // Reviews
  getReviewsByProduct(productId: number): Promise<Review[]>;
  getAllReviews(): Promise<Review[]>;
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
const devProducts: Product[] = [];
const devCartItems: CartItem[] = [];

export class DatabaseStorage implements IStorage {
  private async safeQuery<T>(fn: (session: ydb.Session) => Promise<T>, maxRetries: number = 3): Promise<T | null> {
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
        
        console.error("[YDB Query Error]:", err.message || err);
        if (err.issues) {
          console.error("[YDB Issues]:", JSON.stringify(err.issues, null, 2));
        }
        return null;
      }
    }
    return null;
  }

  private extractTypedValue(item: any): any {
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

  private parseRowWithColumns(row: any, columns: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    if (row.items && Array.isArray(row.items)) {
      for (let i = 0; i < row.items.length && i < columns.length; i++) {
        const colName = columns[i].name;
        result[colName] = this.extractTypedValue(row.items[i]);
      }
    }
    return result;
  }

  private parseResultSet<T>(rs: any): T[] {
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

  private parseProduct(data: Record<string, any>): Product {
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
      createdAt: data.created_at ? new Date(Number(data.created_at) / 1000) : new Date(),
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

  clearProductCache(productId?: number): void {
    if (productId) {
      productCache.delete(String(productId));
    }
    productsCache.clear();
  }

  private async fetchProductsFromYdb(): Promise<Product[]> {
    const allProducts: Product[] = [];
    let lastId = '';
    const PAGE_SIZE = 1000;

    while (true) {
      const chunk = await this.safeQuery(async (session) => {
        let query: string;
        let params: Record<string, any>;

        const { TypedValues, Types } = await import("ydb-sdk");

        if (!lastId) {
          query = `SELECT * FROM products ORDER BY id LIMIT ${PAGE_SIZE}`;
          params = {};
        } else {
          query = `DECLARE $last_id AS Utf8; SELECT * FROM products WHERE id > $last_id ORDER BY id LIMIT ${PAGE_SIZE}`;
          params = { $last_id: TypedValues.fromNative(Types.UTF8, lastId) };
        }

        const { resultSets } = await session.executeQuery(query, params);
        const rs = resultSets[0];
        if (!rs.rows || !rs.columns) return [];
        return rs.rows.map((row: any) => {
          const data = this.parseRowWithColumns(row, rs.columns || []);
          return this.parseProduct(data);
        });
      });

      if (!chunk || chunk.length === 0) break;
      allProducts.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
      lastId = String(chunk[chunk.length - 1].id);
    }

    return allProducts;
  }

  async getProducts(): Promise<Product[]> {
    if (!driver) {
      return devProducts;
    }
    const cached = productsCache.get("all");
    if (cached) {
      if (productsCache.isStale("all") && !productsCache.isRefreshing("all")) {
        productsCache.setRefreshing("all", true);
        console.log("[Cache] STALE - getProducts, refreshing in background");
        this.fetchProductsFromYdb().then(products => {
          if (products.length > 0) {
            productsCache.set("all", products);
          }
          productsCache.setRefreshing("all", false);
          console.log("[Cache] Background refresh complete, got", products.length, "products");
        }).catch(err => {
          productsCache.setRefreshing("all", false);
          console.error("[Cache] Background refresh failed:", err);
        });
      } else {
        console.log("[Cache] HIT - getProducts");
      }
      return cached.filter((p: any) => !p.artistOnly);
    }
    
    console.log("[Cache] MISS - getProducts, fetching from YDB");
    const products = await this.fetchProductsFromYdb();
    if (products.length > 0) {
      productsCache.set("all", products);
    }
    return products.filter((p: any) => !p.artistOnly);
  }

  async getAllProductsForAdmin(): Promise<Product[]> {
    if (!driver) return devProducts;
    const cached = productsCache.get("all");
    if (cached) return cached;
    const products = await this.fetchProductsFromYdb();
    if (products.length > 0) productsCache.set("all", products);
    return products;
  }

  async getProduct(id: number): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => p.id === id);
    }
    // Check cache first
    const cacheKey = `product_${id}`;
    const cached = productCache.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT - getProduct(${id})`);
      return cached;
    }
    
    const allCached = productsCache.get("all");
    if (allCached) {
      const found = allCached.find(p => p.id === id);
      if (found) {
        productCache.set(cacheKey, found);
        console.log(`[Cache] HIT - getProduct(${id}) from productsCache`);
        return found;
      }
    }

    console.log(`[Cache] MISS - getProduct(${id}), fetching from YDB`);
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $id: TypedValues.fromNative(Types.UTF8, String(id)) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    
    if (result) {
      productCache.set(cacheKey, result);
    }
    return result || undefined;
  }

  async getProductByExternalId(externalId: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => p.externalId === externalId);
    }
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $externalId AS Utf8; SELECT * FROM products WHERE external_id = $externalId";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $externalId: TypedValues.fromNative(Types.UTF8, externalId) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    return result || undefined;
  }

  getRawProductsCache(): Product[] {
    return productsCache.get("all") || [];
  }

  async getProductBySlug(slug: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => (p as any).slug === slug);
    }
    // Search raw cache first (includes artistOnly products)
    const raw = productsCache.get("all");
    if (raw) {
      const found = raw.find((p: any) => p.slug === slug);
      if (found) return found;
    }
    // Fallback: fetch all and search (also includes artistOnly)
    const all = await this.fetchProductsFromYdb();
    return all.find((p: any) => p.slug === slug);
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    if (!driver) {
      return devProducts.find(p => p.sku === sku);
    }
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      const rs = resultSets[0];
      const row = rs.rows?.[0];
      if (!row || !rs.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseProduct(data);
    });
    return result || undefined;
  }

  async getColorVariantsBySku(sku: string, excludeId?: number): Promise<Product[]> {
    if (!sku) return [];
    
    if (!driver) {
      return devProducts.filter(p => p.sku === sku && (!excludeId || p.id !== excludeId));
    }
    
    const result = await this.safeQuery(async (session) => {
      const query = "DECLARE $sku AS Utf8; SELECT * FROM products WHERE sku = $sku";
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(query, { $sku: TypedValues.fromNative(Types.UTF8, sku) });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      
      const products: Product[] = [];
      for (const row of rs.rows) {
        const data = this.parseRowWithColumns(row, rs.columns);
        const product = this.parseProduct(data);
        if (product && (!excludeId || product.id !== excludeId)) {
          products.push(product);
        }
      }
      return products;
    });
    
    return result || [];
  }

  async createProduct(p: InsertProduct): Promise<Product> {
    const newId = String(Date.now() + Math.floor(Math.random() * 1000));

    // Always ensure a slug exists — generate from name if not provided
    if (!(p as any).slug && p.name) {
      const { generateSlug } = await import("./slugify");
      (p as any).slug = generateSlug(p.name);
    }

    // Use images array if provided, otherwise fallback to imageUrl
    const imagesArray: string[] = Array.isArray(p.images) && p.images.length > 0 
      ? (p.images as string[])
      : (p.imageUrl ? [p.imageUrl] : []);
    
    const product: any = {
      id: parseInt(newId) || 0,
      externalId: p.externalId || null,
      sku: p.sku || null,
      name: p.name || '',
      description: p.description || '',
      price: p.price || 0,
      wholesalePrice: (p as any).wholesalePrice || null,
      imageUrl: p.imageUrl || '',
      thumbnailUrl: p.thumbnailUrl || null,
      hoverThumbnailUrl: (p as any).hoverThumbnailUrl || null,
      images: imagesArray,
      category: p.category || '',
      subcategory: p.subcategory || null,
      color: (p as any).color || null,
      sizes: Array.isArray(p.sizes) ? (p.sizes as string[]) : [],
      colors: Array.isArray(p.colors) ? (p.colors as string[]) : [],
      isNew: p.isNew || false,
      discountPercent: (p as any).discountPercent || null,
      onSale: p.onSale || false,
      seoTitle: (p as any).seoTitle || null,
      seoDescription: (p as any).seoDescription || null,
      seoBody: (p as any).seoBody || null,
      imageAlts: Array.isArray((p as any).imageAlts) ? (p as any).imageAlts : [],
      featureBadgeIds: Array.isArray((p as any).featureBadgeIds) ? (p as any).featureBadgeIds : [],
      additionalCategories: Array.isArray((p as any).additionalCategories) ? (p as any).additionalCategories : [],
      createdAt: new Date(),
    };

    if (!driver) {
      devProducts.push(product);
      console.log(`[DevStorage] Created product: ${product.name}`);
      return product;
    }

    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      // Match actual YDB table schema with correct types: price=Double, images/sizes/colors=Json
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $external_id AS Utf8;
        DECLARE $sku AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $description AS Utf8;
        DECLARE $price AS Double;
        DECLARE $old_price AS Double;
        DECLARE $images AS Json;
        DECLARE $category AS Utf8;
        DECLARE $subcategory AS Utf8;
        DECLARE $sub_subcategory AS Utf8;
        DECLARE $sizes AS Json;
        DECLARE $colors AS Json;
        DECLARE $color AS Utf8;
        DECLARE $is_new AS Bool;
        DECLARE $in_stock AS Bool;
        DECLARE $is_hidden AS Bool;
        DECLARE $badge_text AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $wholesale_price AS Int64;
        DECLARE $stock AS Int64;
        DECLARE $size_stock AS Json;
        DECLARE $composition AS Utf8;
        DECLARE $care_instructions AS Utf8;
        DECLARE $delivery AS Utf8;
        DECLARE $return_policy AS Utf8;
        DECLARE $seo_title AS Utf8;
        DECLARE $seo_description AS Utf8;
        DECLARE $seo_body AS Utf8;
        DECLARE $specs_html AS Utf8;
        DECLARE $image_alts AS Json;
        DECLARE $feature_badge_ids AS Json;
        DECLARE $additional_categories AS Json;
        DECLARE $artist_slug AS Utf8;
        DECLARE $artist_only AS Bool;
        DECLARE $size_characteristic_ids AS Json;
        
        UPSERT INTO products (
          id, external_id, sku, name, description, price, old_price, images,
          category, subcategory, sub_subcategory, sizes, colors, color,
          is_new, in_stock, is_hidden, badge_text, slug,
          wholesale_price, stock, size_stock,
          composition, care_instructions, delivery, return_policy,
          seo_title, seo_description, seo_body, specs_html, image_alts, feature_badge_ids, additional_categories,
          artist_slug, artist_only, size_characteristic_ids
        )
        VALUES (
          $id, $external_id, $sku, $name, $description, $price, $old_price, $images,
          $category, $subcategory, $sub_subcategory, $sizes, $colors, $color,
          $is_new, $in_stock, $is_hidden, $badge_text, $slug,
          $wholesale_price, $stock, $size_stock,
          $composition, $care_instructions, $delivery, $return_policy,
          $seo_title, $seo_description, $seo_body, $specs_html, $image_alts, $feature_badge_ids, $additional_categories,
          $artist_slug, $artist_only, $size_characteristic_ids
        );
      `;
      
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, newId),
        $external_id: TypedValues.fromNative(Types.UTF8, p.externalId || ''),
        $sku: TypedValues.fromNative(Types.UTF8, p.sku || ''),
        $name: TypedValues.fromNative(Types.UTF8, p.name || ''),
        $description: TypedValues.fromNative(Types.UTF8, p.description || ''),
        $price: TypedValues.fromNative(Types.DOUBLE, p.price || 0),
        $old_price: TypedValues.fromNative(Types.DOUBLE, (p as any).discountPercent || 0),
        $images: TypedValues.fromNative(Types.JSON, JSON.stringify(imagesArray)),
        $category: TypedValues.fromNative(Types.UTF8, p.category || ''),
        $subcategory: TypedValues.fromNative(Types.UTF8, p.subcategory || ''),
        $sub_subcategory: TypedValues.fromNative(Types.UTF8, (p as any).subSubcategory || ''),
        $sizes: TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes || [])),
        $colors: TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors || [])),
        $color: TypedValues.fromNative(Types.UTF8, (p as any).color || ''),
        $is_new: TypedValues.fromNative(Types.BOOL, p.isNew ?? true),
        $in_stock: TypedValues.fromNative(Types.BOOL, true),
        $is_hidden: TypedValues.fromNative(Types.BOOL, (p as any).isHidden ?? false),
        $badge_text: TypedValues.fromNative(Types.UTF8, (p as any).badgeText || ''),
        $slug: TypedValues.fromNative(Types.UTF8, (p as any).slug || ''),
        $wholesale_price: TypedValues.fromNative(Types.INT64, BigInt((p as any).wholesalePrice || 0)),
        $stock: TypedValues.fromNative(Types.INT64, BigInt((p as any).stock || 0)),
        $size_stock: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeStock || {})),
        $composition: TypedValues.fromNative(Types.UTF8, (p as any).composition || ''),
        $care_instructions: TypedValues.fromNative(Types.UTF8, (p as any).careInstructions || ''),
        $delivery: TypedValues.fromNative(Types.UTF8, (p as any).delivery || ''),
        $return_policy: TypedValues.fromNative(Types.UTF8, (p as any).returnPolicy || ''),
        $seo_title: TypedValues.fromNative(Types.UTF8, (p as any).seoTitle || ''),
        $seo_description: TypedValues.fromNative(Types.UTF8, (p as any).seoDescription || ''),
        $seo_body: TypedValues.fromNative(Types.UTF8, (p as any).seoBody || ''),
        $specs_html: TypedValues.fromNative(Types.UTF8, (p as any).specsHtml || ''),
        $image_alts: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).imageAlts || [])),
        $feature_badge_ids: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).featureBadgeIds || [])),
        $additional_categories: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).additionalCategories || [])),
        $artist_slug: TypedValues.fromNative(Types.UTF8, (p as any).artistSlug || ''),
        $artist_only: TypedValues.fromNative(Types.BOOL, (p as any).artistOnly ?? false),
        $size_characteristic_ids: TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeCharacteristicIds || {})),
      });
      
      console.log(`[YDB] Created product: ${p.name} with id ${newId}`);
      return true;
    });

    // Add new product directly to the cache so it appears immediately
    // (avoids YDB scan returning only the first 1000 rows and missing the new one)
    const existingCached = productsCache.get("all");
    if (existingCached) {
      productsCache.set("all", [...existingCached, product]);
    }
    productCache.set(`product_${product.id}`, product);
    
    return product;
  }

  async updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product> {
    if (!driver) {
      const index = devProducts.findIndex(item => item.id === id);
      if (index !== -1) {
        devProducts[index] = { ...devProducts[index], ...p } as Product;
        console.log(`[DevStorage] Updated product id ${id}`);
        return devProducts[index];
      }
      return { id } as Product;
    }

    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const setClauses: string[] = [];
      const params: Record<string, any> = {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
      };
      
      let declareStatements = 'DECLARE $id AS Utf8;\n';
      
      if (p.name !== undefined) {
        declareStatements += 'DECLARE $name AS Utf8;\n';
        setClauses.push('name = $name');
        params.$name = TypedValues.fromNative(Types.UTF8, p.name);
      }
      if (p.description !== undefined) {
        declareStatements += 'DECLARE $description AS Utf8;\n';
        setClauses.push('description = $description');
        params.$description = TypedValues.fromNative(Types.UTF8, p.description);
      }
      if (p.price !== undefined) {
        declareStatements += 'DECLARE $price AS Double;\n';
        setClauses.push('price = $price');
        params.$price = TypedValues.fromNative(Types.DOUBLE, p.price);
      }
      if ((p as any).discountPercent !== undefined) {
        declareStatements += 'DECLARE $old_price AS Double;\n';
        setClauses.push('old_price = $old_price');
        params.$old_price = TypedValues.fromNative(Types.DOUBLE, (p as any).discountPercent || 0);
      }
      if ((p as any).salePrice !== undefined) {
        declareStatements += 'DECLARE $sale_price AS Int64;\n';
        setClauses.push('sale_price = $sale_price');
        params.$sale_price = TypedValues.fromNative(Types.INT64, (p as any).salePrice || 0);
      }
      // Handle images array - prefer explicit images over imageUrl
      if ((p as any).images !== undefined && Array.isArray((p as any).images)) {
        declareStatements += 'DECLARE $images AS Json;\n';
        setClauses.push('images = $images');
        params.$images = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).images));
      } else if (p.imageUrl !== undefined) {
        declareStatements += 'DECLARE $images AS Json;\n';
        setClauses.push('images = $images');
        params.$images = TypedValues.fromNative(Types.JSON, JSON.stringify([p.imageUrl]));
      }
      if (p.category !== undefined) {
        declareStatements += 'DECLARE $category AS Utf8;\n';
        setClauses.push('category = $category');
        params.$category = TypedValues.fromNative(Types.UTF8, p.category);
      }
      if (p.subcategory !== undefined) {
        declareStatements += 'DECLARE $subcategory AS Utf8;\n';
        setClauses.push('subcategory = $subcategory');
        params.$subcategory = TypedValues.fromNative(Types.UTF8, p.subcategory || '');
      }
      if ((p as any).subSubcategory !== undefined) {
        declareStatements += 'DECLARE $sub_subcategory AS Utf8;\n';
        setClauses.push('sub_subcategory = $sub_subcategory');
        params.$sub_subcategory = TypedValues.fromNative(Types.UTF8, (p as any).subSubcategory || '');
      }
      if ((p as any).additionalCategories !== undefined) {
        declareStatements += 'DECLARE $additional_categories AS Json;\n';
        setClauses.push('additional_categories = $additional_categories');
        params.$additional_categories = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).additionalCategories || []));
      }
      if (p.sizes !== undefined) {
        declareStatements += 'DECLARE $sizes AS Json;\n';
        setClauses.push('sizes = $sizes');
        params.$sizes = TypedValues.fromNative(Types.JSON, JSON.stringify(p.sizes));
      }
      if (p.colors !== undefined) {
        declareStatements += 'DECLARE $colors AS Json;\n';
        setClauses.push('colors = $colors');
        params.$colors = TypedValues.fromNative(Types.JSON, JSON.stringify(p.colors));
      }
      if (p.externalId !== undefined) {
        declareStatements += 'DECLARE $external_id AS Utf8;\n';
        setClauses.push('external_id = $external_id');
        params.$external_id = TypedValues.fromNative(Types.UTF8, p.externalId);
      }
      if (p.sku !== undefined) {
        declareStatements += 'DECLARE $sku AS Utf8;\n';
        setClauses.push('sku = $sku');
        params.$sku = TypedValues.fromNative(Types.UTF8, p.sku);
      }
      if (p.isNew !== undefined) {
        declareStatements += 'DECLARE $is_new AS Bool;\n';
        setClauses.push('is_new = $is_new');
        params.$is_new = TypedValues.fromNative(Types.BOOL, p.isNew);
      }
      if ((p as any).badgeText !== undefined) {
        declareStatements += 'DECLARE $badge_text AS Utf8;\n';
        setClauses.push('badge_text = $badge_text');
        params.$badge_text = TypedValues.fromNative(Types.UTF8, (p as any).badgeText || '');
      }
      if ((p as any).color !== undefined) {
        declareStatements += 'DECLARE $color AS Utf8;\n';
        setClauses.push('color = $color');
        params.$color = TypedValues.fromNative(Types.UTF8, (p as any).color || '');
      }
      if ((p as any).thumbnailUrl !== undefined) {
        declareStatements += 'DECLARE $thumbnail_url AS Utf8;\n';
        setClauses.push('thumbnail_url = $thumbnail_url');
        params.$thumbnail_url = TypedValues.fromNative(Types.UTF8, (p as any).thumbnailUrl || '');
      }
      if ((p as any).hoverThumbnailUrl !== undefined) {
        declareStatements += 'DECLARE $hover_thumbnail_url AS Utf8;\n';
        setClauses.push('hover_thumbnail_url = $hover_thumbnail_url');
        params.$hover_thumbnail_url = TypedValues.fromNative(Types.UTF8, (p as any).hoverThumbnailUrl || '');
      }
      if ((p as any).wholesalePrice !== undefined) {
        declareStatements += 'DECLARE $wholesale_price AS Int64;\n';
        setClauses.push('wholesale_price = $wholesale_price');
        params.$wholesale_price = TypedValues.fromNative(Types.INT64, (p as any).wholesalePrice || 0);
      }
      if ((p as any).onSale !== undefined) {
        declareStatements += 'DECLARE $on_sale AS Bool;\n';
        setClauses.push('on_sale = $on_sale');
        params.$on_sale = TypedValues.fromNative(Types.BOOL, (p as any).onSale);
      }
      if ((p as any).isHidden !== undefined) {
        declareStatements += 'DECLARE $is_hidden AS Bool;\n';
        setClauses.push('is_hidden = $is_hidden');
        params.$is_hidden = TypedValues.fromNative(Types.BOOL, (p as any).isHidden);
      }
      
      if ((p as any).inStock !== undefined) {
        declareStatements += 'DECLARE $in_stock AS Bool;\n';
        setClauses.push('in_stock = $in_stock');
        params.$in_stock = TypedValues.fromNative(Types.BOOL, (p as any).inStock);
      }
      
      if ((p as any).stock !== undefined) {
        declareStatements += 'DECLARE $stock AS Int64;\n';
        setClauses.push('stock = $stock');
        params.$stock = TypedValues.fromNative(Types.INT64, (p as any).stock);
      }
      
      if ((p as any).sizeStock !== undefined) {
        declareStatements += 'DECLARE $size_stock AS Json;\n';
        setClauses.push('size_stock = $size_stock');
        params.$size_stock = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeStock));
      }

      if ((p as any).sizeCharacteristicIds !== undefined) {
        declareStatements += 'DECLARE $size_characteristic_ids AS Json;\n';
        setClauses.push('size_characteristic_ids = $size_characteristic_ids');
        params.$size_characteristic_ids = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeCharacteristicIds));
      }
      
      if ((p as any).sizeDiscounts !== undefined) {
        declareStatements += 'DECLARE $size_discounts AS Json;\n';
        setClauses.push('size_discounts = $size_discounts');
        params.$size_discounts = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).sizeDiscounts));
      }
      
      if ((p as any).measurements !== undefined) {
        declareStatements += 'DECLARE $measurements AS Json;\n';
        setClauses.push('measurements = $measurements');
        params.$measurements = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).measurements));
      }

      if ((p as any).measurementSections !== undefined) {
        declareStatements += 'DECLARE $measurement_sections AS Json;\n';
        setClauses.push('measurement_sections = $measurement_sections');
        params.$measurement_sections = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).measurementSections));
      }
      
      if ((p as any).composition !== undefined) {
        declareStatements += 'DECLARE $composition AS Utf8;\n';
        setClauses.push('composition = $composition');
        params.$composition = TypedValues.fromNative(Types.UTF8, (p as any).composition || '');
      }
      
      if ((p as any).careInstructions !== undefined) {
        declareStatements += 'DECLARE $care_instructions AS Utf8;\n';
        setClauses.push('care_instructions = $care_instructions');
        params.$care_instructions = TypedValues.fromNative(Types.UTF8, (p as any).careInstructions || '');
      }

      if ((p as any).specsHtml !== undefined) {
        declareStatements += 'DECLARE $specs_html AS Utf8;\n';
        setClauses.push('specs_html = $specs_html');
        params.$specs_html = TypedValues.fromNative(Types.UTF8, (p as any).specsHtml || '');
      }

      if ((p as any).note !== undefined) {
        declareStatements += 'DECLARE $note AS Utf8;\n';
        setClauses.push('note = $note');
        params.$note = TypedValues.fromNative(Types.UTF8, (p as any).note || '');
      }
      
      if ((p as any).delivery !== undefined) {
        declareStatements += 'DECLARE $delivery AS Utf8;\n';
        setClauses.push('delivery = $delivery');
        params.$delivery = TypedValues.fromNative(Types.UTF8, (p as any).delivery || '');
      }
      
      if ((p as any).returnPolicy !== undefined) {
        declareStatements += 'DECLARE $return_policy AS Utf8;\n';
        setClauses.push('return_policy = $return_policy');
        params.$return_policy = TypedValues.fromNative(Types.UTF8, (p as any).returnPolicy || '');
      }
      
      if ((p as any).autoHideOverride !== undefined) {
        declareStatements += 'DECLARE $auto_hide_override AS Bool;\n';
        setClauses.push('auto_hide_override = $auto_hide_override');
        params.$auto_hide_override = TypedValues.fromNative(Types.BOOL, (p as any).autoHideOverride);
      }

      if ((p as any).noSize !== undefined) {
        declareStatements += 'DECLARE $no_size AS Bool;\n';
        setClauses.push('no_size = $no_size');
        params.$no_size = TypedValues.fromNative(Types.BOOL, (p as any).noSize);
      }
      
      if ((p as any).lookProducts !== undefined) {
        declareStatements += 'DECLARE $look_products AS Json;\n';
        setClauses.push('look_products = $look_products');
        params.$look_products = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).lookProducts || []));
      }
      
      if ((p as any).lookCategory !== undefined) {
        declareStatements += 'DECLARE $look_category AS Utf8;\n';
        setClauses.push('look_category = $look_category');
        params.$look_category = TypedValues.fromNative(Types.UTF8, (p as any).lookCategory || '');
      }
      
      if ((p as any).lookSubcategory !== undefined) {
        declareStatements += 'DECLARE $look_subcategory AS Utf8;\n';
        setClauses.push('look_subcategory = $look_subcategory');
        params.$look_subcategory = TypedValues.fromNative(Types.UTF8, (p as any).lookSubcategory || '');
      }
      
      if (p.seoTitle !== undefined) {
        declareStatements += 'DECLARE $seo_title AS Utf8;\n';
        setClauses.push('seo_title = $seo_title');
        params.$seo_title = TypedValues.fromNative(Types.UTF8, p.seoTitle || '');
      }
      
      if (p.seoDescription !== undefined) {
        declareStatements += 'DECLARE $seo_description AS Utf8;\n';
        setClauses.push('seo_description = $seo_description');
        params.$seo_description = TypedValues.fromNative(Types.UTF8, p.seoDescription || '');
      }
      
      if ((p as any).seoBody !== undefined) {
        declareStatements += 'DECLARE $seo_body AS Utf8;\n';
        setClauses.push('seo_body = $seo_body');
        params.$seo_body = TypedValues.fromNative(Types.UTF8, (p as any).seoBody || '');
      }
      
      if (p.imageAlts !== undefined) {
        declareStatements += 'DECLARE $image_alts AS Json;\n';
        setClauses.push('image_alts = $image_alts');
        params.$image_alts = TypedValues.fromNative(Types.JSON, JSON.stringify(p.imageAlts || []));
      }
      
      if ((p as any).featureBadgeIds !== undefined) {
        declareStatements += 'DECLARE $feature_badge_ids AS Json;\n';
        setClauses.push('feature_badge_ids = $feature_badge_ids');
        params.$feature_badge_ids = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).featureBadgeIds || []));
      }
      
      if ((p as any).preorderEnabled !== undefined) {
        declareStatements += 'DECLARE $preorder_enabled AS Bool;\n';
        setClauses.push('preorder_enabled = $preorder_enabled');
        params.$preorder_enabled = TypedValues.fromNative(Types.BOOL, (p as any).preorderEnabled);
      }
      if ((p as any).wholesalePreorderEnabled !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_enabled AS Bool;\n';
        setClauses.push('wholesale_preorder_enabled = $wholesale_preorder_enabled');
        params.$wholesale_preorder_enabled = TypedValues.fromNative(Types.BOOL, !!(p as any).wholesalePreorderEnabled);
      }
      if ((p as any).wholesalePreorderSizes !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_sizes AS Json;\n';
        setClauses.push('wholesale_preorder_sizes = $wholesale_preorder_sizes');
        params.$wholesale_preorder_sizes = TypedValues.fromNative(Types.JSON, JSON.stringify((p as any).wholesalePreorderSizes || []));
      }
      if ((p as any).wholesalePreorderRrp !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_rrp AS Int64;\n';
        setClauses.push('wholesale_preorder_rrp = $wholesale_preorder_rrp');
        params.$wholesale_preorder_rrp = TypedValues.fromNative(Types.INT64, (p as any).wholesalePreorderRrp || 0);
      }
      if ((p as any).wholesalePreorderPrice !== undefined) {
        declareStatements += 'DECLARE $wholesale_preorder_price AS Int64;\n';
        setClauses.push('wholesale_preorder_price = $wholesale_preorder_price');
        params.$wholesale_preorder_price = TypedValues.fromNative(Types.INT64, (p as any).wholesalePreorderPrice || 0);
      }
      if ((p as any).preorderGoal !== undefined) {
        declareStatements += 'DECLARE $preorder_goal AS Uint32;\n';
        setClauses.push('preorder_goal = $preorder_goal');
        params.$preorder_goal = TypedValues.fromNative(Types.UINT32, (p as any).preorderGoal || 0);
      }
      if ((p as any).preorderCurrent !== undefined) {
        declareStatements += 'DECLARE $preorder_current AS Uint32;\n';
        setClauses.push('preorder_current = $preorder_current');
        params.$preorder_current = TypedValues.fromNative(Types.UINT32, (p as any).preorderCurrent || 0);
      }
      if ((p as any).preorderDeadline !== undefined) {
        declareStatements += 'DECLARE $preorder_deadline AS Utf8;\n';
        setClauses.push('preorder_deadline = $preorder_deadline');
        params.$preorder_deadline = TypedValues.fromNative(Types.UTF8, (p as any).preorderDeadline || '');
      }
      if ((p as any).preorderProductionDate !== undefined) {
        declareStatements += 'DECLARE $preorder_production_date AS Utf8;\n';
        setClauses.push('preorder_production_date = $preorder_production_date');
        params.$preorder_production_date = TypedValues.fromNative(Types.UTF8, (p as any).preorderProductionDate || '');
      }
      if ((p as any).preorderShippingDate !== undefined) {
        declareStatements += 'DECLARE $preorder_shipping_date AS Utf8;\n';
        setClauses.push('preorder_shipping_date = $preorder_shipping_date');
        params.$preorder_shipping_date = TypedValues.fromNative(Types.UTF8, (p as any).preorderShippingDate || '');
      }
      if ((p as any).preorderStatus !== undefined) {
        declareStatements += 'DECLARE $preorder_status AS Utf8;\n';
        setClauses.push('preorder_status = $preorder_status');
        params.$preorder_status = TypedValues.fromNative(Types.UTF8, (p as any).preorderStatus || '');
      }
      if ((p as any).slug !== undefined) {
        declareStatements += 'DECLARE $slug AS Utf8;\n';
        setClauses.push('slug = $slug');
        params.$slug = TypedValues.fromNative(Types.UTF8, (p as any).slug || '');
      }

      if ((p as any).artistSlug !== undefined) {
        declareStatements += 'DECLARE $artist_slug AS Utf8;\n';
        setClauses.push('artist_slug = $artist_slug');
        const artistSlugValue = (p as any).artistSlug || '';
        params.$artist_slug = TypedValues.fromNative(Types.UTF8, artistSlugValue);
        console.log(`[YDB] updateProduct id=${id}: setting artist_slug="${artistSlugValue}"`);
      }

      if ((p as any).videoUrl !== undefined) {
        declareStatements += 'DECLARE $video_url AS Utf8;\n';
        setClauses.push('video_url = $video_url');
        params.$video_url = TypedValues.fromNative(Types.UTF8, (p as any).videoUrl || '');
      }

      if ((p as any).preorderGroup !== undefined) {
        declareStatements += 'DECLARE $preorder_group AS Utf8;\n';
        setClauses.push('preorder_group = $preorder_group');
        params.$preorder_group = TypedValues.fromNative(Types.UTF8, (p as any).preorderGroup || '');
      }

      if (setClauses.length === 0) return null;
      
      const query = `
        ${declareStatements}
        UPDATE products SET ${setClauses.join(', ')} WHERE id = $id;
      `;
      
      await session.executeQuery(query, params);
      console.log(`[YDB] Updated product id ${id}`);
      return true;
    });
    
    // Update cache: replace just this product in productsCache instead of clearing everything
    // This prevents race conditions where a background refresh overwrites fresh data
    if (!(p as any).skipCacheClear) {
      const cachedList = productsCache.get("all");
      if (cachedList) {
        // Fetch the fresh product from YDB and update it in the list
        const freshProduct = await this.safeQuery(async (session) => {
          const { TypedValues, Types } = await import("ydb-sdk");
          const query = "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id";
          const { resultSets } = await session.executeQuery(query, {
            $id: TypedValues.fromNative(Types.UTF8, String(id)),
          });
          const rs = resultSets[0];
          if (!rs.rows?.[0] || !rs.columns) return null;
          const data = this.parseRowWithColumns(rs.rows[0], rs.columns);
          return this.parseProduct(data);
        });
        if (freshProduct) {
          console.log(`[YDB] updateProduct id=${id} read-after-write: artist_slug="${(freshProduct as any).artistSlug}" isHidden=${(freshProduct as any).isHidden}`);
          const updated = cachedList.map(item => item.id === id ? freshProduct : item);
          productsCache.set("all", updated);
          productCache.set(`product_${id}`, freshProduct);
        } else {
          this.clearCache();
        }
      } else {
        productCache.delete(`product_${id}`);
      }
    }
    
    return { ...p, id } as Product;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const ydbDriver = await waitForDriver();
    
    if (!ydbDriver) {
      const index = devProducts.findIndex(item => item.id === id);
      if (index !== -1) {
        devProducts.splice(index, 1);
        console.log(`[DevStorage] Deleted product id ${id}`);
        return true;
      }
      return false;
    }

    const result = await ydbDriver.tableClient.withSession(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      
      const query = `
        DECLARE $id AS Utf8;
        DELETE FROM products WHERE id = $id;
      `;
      
      const params = {
        $id: TypedValues.fromNative(Types.UTF8, String(id)),
      };
      
      await session.executeQuery(query, params);
      console.log(`[YDB] Deleted product id ${id}`);
      return true;
    }).catch((err: any) => {
      console.error("[YDB] Delete error:", err.message);
      return false;
    });
    
    // Clear cache after deletion
    this.clearCache();
    
    return result === true;
  }

  // Records a permanently deleted product slug so bots get HTTP 410 Gone.
  // Fire-and-forget from delete endpoints — failure is non-critical.
  async addDeletedProductSlug(slug: string): Promise<void> {
    if (!slug) return;
    try {
      const current = await this.getPageSettings("deleted_slugs");
      const existing: string[] = Array.isArray(current?.list?.slugs) ? current.list.slugs : [];
      if (existing.includes(slug)) return; // already recorded
      await this.setPageSectionSettings("deleted_slugs", "list", { slugs: [...existing, slug] });
      console.log(`[SEO] Recorded deleted product slug for 410: ${slug}`);
    } catch (err: any) {
      console.error(`[SEO] Failed to record deleted slug ${slug}:`, err.message);
    }
  }

  async deleteAllProducts(): Promise<number> {
    const ydbDriver = await waitForDriver();
    
    if (!ydbDriver) {
      const count = devProducts.length;
      devProducts.length = 0;
      console.log(`[DevStorage] Deleted all ${count} products`);
      return count;
    }

    // First get count of products
    const products = await this.getProducts();
    const count = products.length;
    
    const result = await ydbDriver.tableClient.withSession(async (session) => {
      const query = `DELETE FROM products;`;
      await session.executeQuery(query);
      console.log(`[YDB] Deleted all products (${count} items)`);
      return count;
    }).catch((err: any) => {
      console.error("[YDB] Delete all error:", err.message);
      return 0;
    });
    
    // Clear cache after deletion
    this.clearCache();
    
    return result || 0;
  }

  // YDB cart storage
  async getCartItems(sessionId: string): Promise<(CartItem & { product: Product })[]> {
    if (!driver) {
      console.log(`[Cart] Local Dev: Fetching items for session ${sessionId}`);
      const items = devCartItems.filter(item => item.sessionId === sessionId);
      const result: (CartItem & { product: Product })[] = [];
      
      for (const item of items) {
        const product = await this.getProduct(item.productId);
        if (product) {
          result.push({ ...item, product });
        }
      }
      return result;
    }
    
    // Use safeQuery so a YDB transport blip doesn't escape as an unhandled
    // rejection (this method is called on every page load — header cart icon).
    // Step 1: pull raw rows inside the YDB session, fast and minimal.
    type RawCartRow = {
      sessionId: string;
      productId: number;
      size: string | null;
      color: string | null;
      quantity: number;
    };

    const rawRows = await this.safeQuery<RawCartRow[]>(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $session_id AS Utf8;
        SELECT session_id, product_id, size, color, quantity, created_at
        FROM cart_items
        WHERE session_id = $session_id;
      `;

      const params = {
        $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
      };

      const res = await session.executeQuery(query, params);
      const rows = res.resultSets[0]?.rows || [];

      return rows.map(row => {
        const items = row.items || [];
        const productId = items[1]?.uint64Value || items[1]?.int64Value || 0;
        return {
          sessionId: items[0]?.textValue || "",
          productId: Number(productId),
          size: items[2]?.textValue || null,
          color: items[3]?.textValue || null,
          quantity: items[4]?.int32Value || items[4]?.uint32Value || 1,
        };
      });
    });

    if (!rawRows) {
      // YDB unavailable — return empty cart instead of throwing/hanging.
      console.warn(`[Cart] YDB unavailable for session ${sessionId}, returning empty cart`);
      return [];
    }

    // Step 2: hydrate products OUTSIDE the YDB session (uses its own cache).
    const result: (CartItem & { product: Product })[] = [];
    for (const row of rawRows) {
      const product = await this.getProduct(row.productId);
      if (product) {
        result.push({
          id: 0, // YDB cart uses composite key, no single id
          sessionId: row.sessionId,
          productId: row.productId,
          size: row.size,
          color: row.color,
          quantity: row.quantity,
          userId: null,
          product,
        });
      }
    }

    const deduped = new Map<string, (CartItem & { product: Product })>();
    for (const item of result) {
      const key = `${item.productId}-${item.size}-${item.color}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }
    const dedupedResult = Array.from(deduped.values());
    console.log(`[Cart] Found ${dedupedResult.length} items for session ${sessionId} (${result.length} raw rows)`);
    return dedupedResult;
  }

  async getCartByUserId(userId: number): Promise<(CartItem & { product: Product })[]> {
    const sessionId = `user_${userId}`;
    return this.getCartItems(sessionId);
  }

  async addToCart(item: InsertCartItem): Promise<CartItem> {
    if (!driver) {
      const cartItemId = Date.now();
      const newItem: CartItem = {
        id: cartItemId,
        sessionId: item.sessionId ?? null,
        productId: item.productId,
        quantity: item.quantity || 1,
        size: item.size || "One Size",
        color: item.color || "Default",
        userId: null,
      };
      
      // Check for existing item with same composite key to update quantity
      const existingIndex = devCartItems.findIndex(i => 
        i.sessionId === item.sessionId && 
        i.productId === item.productId && 
        i.size === newItem.size && 
        i.color === newItem.color
      );
      
      if (existingIndex !== -1) {
        devCartItems[existingIndex].quantity += newItem.quantity;
        console.log(`[Cart] Local Dev: Updated quantity for product ${item.productId}`);
        return devCartItems[existingIndex];
      }
      
      devCartItems.push(newItem);
      console.log(`[Cart] Local Dev: Added item ${cartItemId} for product ${item.productId}`);
      return newItem;
    }
    
    const cartItemId = Date.now();
    const qty = Number(item.quantity) || 1;
    const productIdNum = Number(item.productId);
    const sizeStr = String(item.size || "One Size");
    const colorStr = String(item.color || "Default");
    const sessionStr = String(item.sessionId);
    
    try {
      let finalQuantity = qty;
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        
        const selectQuery = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          
          SELECT id, quantity FROM cart_items
          WHERE session_id = $session_id
            AND product_id = $product_id
            AND size = $size
            AND color = $color
          LIMIT 1;
        `;
        
        const selectParams = {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionStr),
          $product_id: TypedValues.fromNative(Types.UINT64, productIdNum),
          $size: TypedValues.fromNative(Types.UTF8, sizeStr),
          $color: TypedValues.fromNative(Types.UTF8, colorStr),
        };
        
        const result = await session.executeQuery(selectQuery, selectParams);
        const rows = result.resultSets?.[0]?.rows || [];
        
        if (rows.length > 0) {
          const existingQty = Number(rows[0]?.items?.[1]?.int32Value || rows[0]?.items?.[1]?.uint64Value || 0);
          finalQuantity = existingQty + qty;
          console.log(`[Cart] Found existing item, updating quantity: ${existingQty} + ${qty} = ${finalQuantity}`);
          
          const updateQuery = `
            DECLARE $session_id AS Utf8;
            DECLARE $product_id AS Uint64;
            DECLARE $size AS Utf8;
            DECLARE $color AS Utf8;
            DECLARE $quantity AS Int32;
            
            UPDATE cart_items SET quantity = $quantity
            WHERE session_id = $session_id
              AND product_id = $product_id
              AND size = $size
              AND color = $color;
          `;
          await session.executeQuery(updateQuery, {
            ...selectParams,
            $quantity: TypedValues.fromNative(Types.INT32, finalQuantity),
          });
        } else {
          console.log(`[Cart] Inserting new item: id=${cartItemId}, session=${sessionStr}, product=${productIdNum}, qty=${qty}`);
          const insertQuery = `
            DECLARE $id AS Uint64;
            DECLARE $session_id AS Utf8;
            DECLARE $product_id AS Uint64;
            DECLARE $size AS Utf8;
            DECLARE $color AS Utf8;
            DECLARE $quantity AS Int32;
            
            UPSERT INTO cart_items (id, session_id, product_id, size, color, quantity, created_at)
            VALUES ($id, $session_id, $product_id, $size, $color, $quantity, CurrentUtcTimestamp());
          `;
          await session.executeQuery(insertQuery, {
            $id: TypedValues.fromNative(Types.UINT64, cartItemId),
            ...selectParams,
            $quantity: TypedValues.fromNative(Types.INT32, qty),
          });
        }
      });
      console.log(`[Cart] Added/updated item in YDB: session=${sessionStr}, product=${productIdNum}, finalQty=${finalQuantity}`);
    } catch (err: any) {
      console.error(`[Cart] Error adding to cart:`, err.message || err);
      if (err.issues) {
        console.error(`[Cart] YDB Issues:`, JSON.stringify(err.issues, null, 2));
      }
      throw err;
    }
    
    return { ...item, id: cartItemId } as CartItem;
  }

  async updateCartItemQuantity(id: number, quantity: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<CartItem | null> {
    if (!driver) {
      const item = devCartItems.find(i =>
        i.sessionId === sessionId &&
        i.productId === productId &&
        i.size === (size || "One Size") &&
        i.color === (color || "Default")
      );
      if (!item) return null;
      item.quantity = quantity;
      return item;
    }

    if (!sessionId || !productId) {
      console.log("[Cart] Missing sessionId or productId for quantity update");
      return null;
    }

    try {
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        const query = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          DECLARE $quantity AS Int32;

          UPDATE cart_items SET quantity = $quantity
          WHERE session_id = $session_id
            AND product_id = $product_id
            AND size = $size
            AND color = $color;
        `;
        await session.executeQuery(query, {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
          $product_id: TypedValues.fromNative(Types.UINT64, Number(productId)),
          $size: TypedValues.fromNative(Types.UTF8, size || "One Size"),
          $color: TypedValues.fromNative(Types.UTF8, color || "Default"),
          $quantity: TypedValues.fromNative(Types.INT32, quantity),
        });
      });
      console.log(`[Cart] Updated quantity in YDB: session=${sessionId}, product=${productId}, size=${size}, qty=${quantity}`);
      return { id, quantity, sessionId: sessionId || '', productId: productId || 0, size: size || 'One Size', color: color || 'Default' } as CartItem;
    } catch (err: any) {
      console.error(`[Cart] Error updating quantity:`, err.message || err);
      throw err;
    }
  }

  async removeFromCart(id: number, sessionId?: string, productId?: number, size?: string, color?: string): Promise<void> {
    if (!driver) {
      const index = devCartItems.findIndex(i => 
        i.sessionId === sessionId && 
        i.productId === productId && 
        i.size === (size || "One Size") && 
        i.color === (color || "Default")
      );
      if (index !== -1) {
        devCartItems.splice(index, 1);
        console.log(`[Cart] Local Dev: Removed item for product ${productId}`);
      }
      return;
    }
    
    // For YDB we need the composite key (sessionId, productId, size, color)
    if (!sessionId || !productId) {
      console.log("[Cart] Missing sessionId or productId for removal");
      return;
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const { TypedValues, Types } = await import("ydb-sdk");
        const query = `
          DECLARE $session_id AS Utf8;
          DECLARE $product_id AS Uint64;
          DECLARE $size AS Utf8;
          DECLARE $color AS Utf8;
          
          DELETE FROM cart_items
          WHERE session_id = $session_id 
            AND product_id = $product_id
            AND size = $size
            AND color = $color;
        `;
        
        const params = {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
          $product_id: TypedValues.fromNative(Types.UINT64, Number(productId)),
          $size: TypedValues.fromNative(Types.UTF8, size || "One Size"),
          $color: TypedValues.fromNative(Types.UTF8, color || "Default"),
        };
        
        await session.executeQuery(query, params);
        console.log(`[Cart] Removed item from YDB: session=${sessionId}, product=${productId}`);
      });
    } catch (err: any) {
      console.error(`[Cart] Error removing from cart:`, err.message || err);
    }
  }

  async clearCart(sessionId: string): Promise<void> {
    if (!driver) {
      let i = devCartItems.length;
      while (i--) {
        if (devCartItems[i].sessionId === sessionId) {
          devCartItems.splice(i, 1);
        }
      }
      console.log(`[Cart] Local Dev: Cleared cart for session ${sessionId}`);
      return;
    }
    
    // Wrapped in safeQuery to prevent unhandled rejections on YDB outage.
    const ok = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $session_id AS Utf8;
        DELETE FROM cart_items WHERE session_id = $session_id;
      `;

      const params = {
        $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
      };

      await session.executeQuery(query, params);
      console.log(`[Cart] Cleared cart in YDB for session ${sessionId}`);
      return true;
    });

    if (!ok) {
      console.warn(`[Cart] clearCart skipped (YDB unavailable) for session ${sessionId}`);
    }
  }

  async getOrders(): Promise<Order[]> {
    if (!driver) {
      console.log('[Storage] getOrders: YDB driver not initialized');
      return [];
    }
    
    console.log('[Storage] getOrders: Fetching orders from YDB...');
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, is_preorder, deposit_paid, remaining_amount, user_id, cdek_data, partner_id
        FROM orders
        WHERE status != 'awaiting_payment'
        ORDER BY created_at DESC
        LIMIT 1000;
      `;
      const queryResult = await session.executeQuery(query);
      console.log(`[Storage] getOrders: Query returned ${queryResult.resultSets[0]?.rows?.length || 0} rows`);
      return queryResult.resultSets[0]?.rows || [];
    });
    
    if (!result) {
      console.log('[Storage] getOrders: safeQuery returned null');
      return [];
    }
    
    return result.map((row: any) => {
      return {
        id: Number(this.extractTypedValue(row.items[0])),
        sessionId: this.extractTypedValue(row.items[1]),
        customerName: this.extractTypedValue(row.items[2]),
        customerEmail: this.extractTypedValue(row.items[3]),
        customerPhone: this.extractTypedValue(row.items[4]),
        address: this.extractTypedValue(row.items[5]),
        total: Number(this.extractTypedValue(row.items[6])),
        items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
        status: this.extractTypedValue(row.items[8]),
        createdAt: this.extractTypedValue(row.items[9]),
        isWholesale: this.extractTypedValue(row.items[10]) === true,
        transportCompany: this.extractTypedValue(row.items[11]) || undefined,
        isPreorder: this.extractTypedValue(row.items[12]) === true,
        depositPaid: this.extractTypedValue(row.items[13]) === true,
        remainingAmount: Number(this.extractTypedValue(row.items[14])) || 0,
        userId: Number(this.extractTypedValue(row.items[15])) || undefined,
        cdekData: this.extractTypedValue(row.items[16]) || undefined,
        // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
        partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[17])),
      };
    }) as any;
  }
  
  async getAllRetailPreorderOrders(): Promise<Order[]> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, is_preorder, deposit_paid, remaining_amount, user_id, cdek_data, partner_id
        FROM orders
        WHERE is_preorder = true AND (is_wholesale = false OR is_wholesale IS NULL) AND status != 'awaiting_payment' AND status != 'cancelled'
        ORDER BY created_at DESC;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items[0])),
      sessionId: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      customerEmail: this.extractTypedValue(row.items[3]),
      customerPhone: this.extractTypedValue(row.items[4]),
      address: this.extractTypedValue(row.items[5]),
      total: Number(this.extractTypedValue(row.items[6])),
      items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
      status: this.extractTypedValue(row.items[8]),
      createdAt: this.extractTypedValue(row.items[9]),
      isWholesale: this.extractTypedValue(row.items[10]) === true,
      transportCompany: this.extractTypedValue(row.items[11]) || undefined,
      isPreorder: this.extractTypedValue(row.items[12]) === true,
      depositPaid: this.extractTypedValue(row.items[13]) === true,
      remainingAmount: Number(this.extractTypedValue(row.items[14])) || 0,
      userId: Number(this.extractTypedValue(row.items[15])) || undefined,
      cdekData: this.extractTypedValue(row.items[16]) || undefined,
      partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[17])),
    })) as any;
  }

  async getOrderAnalytics(): Promise<{ month: string; retailCount: number; wholesaleCount: number; retailRevenue: number; wholesaleRevenue: number }[]> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT total, is_wholesale, created_at
        FROM orders
        WHERE (
          (is_wholesale = true  AND status NOT IN ('cancelled', 'awaiting_payment'))
          OR
          (is_wholesale = false AND status IN ('paid', 'processing', 'shipped', 'delivered'))
        )
        ORDER BY created_at DESC
        LIMIT 3000;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];

    const monthMap = new Map<string, { retailCount: number; wholesaleCount: number; retailRevenue: number; wholesaleRevenue: number }>();

    for (const row of result) {
      const total = Number(this.extractTypedValue(row.items![0])) || 0;
      const isWholesale = this.extractTypedValue(row.items![1]) === true;
      const createdAt = this.extractTypedValue(row.items![2]);
      if (!createdAt) continue;

      const date = new Date(createdAt);
      if (isNaN(date.getTime())) continue;
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthMap.has(month)) {
        monthMap.set(month, { retailCount: 0, wholesaleCount: 0, retailRevenue: 0, wholesaleRevenue: 0 });
      }
      const entry = monthMap.get(month)!;
      if (isWholesale) {
        entry.wholesaleCount++;
        entry.wholesaleRevenue += total;
      } else {
        entry.retailCount++;
        entry.retailRevenue += total;
      }
    }

    return Array.from(monthMap.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  async getArtistAnalytics(): Promise<{ artist: string; revenue: number; orders: number; items: number; ordersList: { orderId: number; date: string; customerName: string; items: { name: string; qty: number; price: number }[]; total: number }[] }[]> {
    if (!driver) return [];

    // Keyword fallback list — includes Дикая Мята (was missing before)
    const ARTISTS = [
      { label: "Молодость Внутри", slug: "molodost-vnutri", keywords: ["молодость внутри"] },
      { label: "Гуд Таймс", slug: "gudtajms", keywords: ["гудтаймс", "гуд таймс", "goodtimes", "good times", "зож", "принц"] },
      { label: "Дикая Мята", slug: "dikaya-myata", keywords: ["дикая мята", "wild mint", "vashana", "стикерпак"] },
      { label: "Мультфильмы", slug: "multfilmy", keywords: ["мультфильм", "мультfильм"] },
      { label: "Драгни", slug: "dragni", keywords: ["драгни", "dragni"] },
    ];

    // Slug-based lookup: product name (lower) → artistSlug, from in-memory products cache (non-blocking)
    const cachedProducts = productsCache.get("all") || [];
    const productNameToSlug = new Map<string, string>();
    for (const p of cachedProducts) {
      if (p.artistSlug) {
        productNameToSlug.set((p.name || '').toLowerCase(), p.artistSlug);
      }
    }

    // Load artist partners for slug → display label
    const artistPartners = await this.getArtistPartners();
    const slugToLabel = new Map<string, string>();
    for (const p of artistPartners) {
      slugToLabel.set(p.partnerSlug, p.storeName || p.contactName || p.partnerSlug);
    }
    // Seed static labels as fallback if partner not yet in DB
    for (const a of ARTISTS) {
      if (!slugToLabel.has(a.slug)) slugToLabel.set(a.slug, a.label);
    }

    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, customer_name, created_at, items
        FROM orders
        WHERE is_wholesale = false
          AND status IN ('paid', 'processing', 'shipped', 'delivered')
        ORDER BY created_at DESC
        LIMIT 3000;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];

    type ArtistEntry = {
      revenue: number;
      orders: number;
      items: number;
      ordersList: { orderId: number; date: string; customerName: string; items: { name: string; qty: number; price: number }[]; total: number }[];
    };

    const artistMap = new Map<string, ArtistEntry>();
    const initArtist = (key: string) => {
      if (!artistMap.has(key)) artistMap.set(key, { revenue: 0, orders: 0, items: 0, ordersList: [] });
    };

    for (const row of result) {
      const cols = row.items || [];
      const orderId = Number(this.extractTypedValue(cols[0])) || 0;
      const customerName = String(this.extractTypedValue(cols[1]) || '');
      const createdAt = this.extractTypedValue(cols[2]);
      const rawItems = this.extractTypedValue(cols[3]);

      let orderItems: any[] = [];
      try { orderItems = JSON.parse(rawItems || '[]'); } catch { continue; }

      const date = createdAt ? new Date(createdAt).toLocaleDateString('ru-RU') : '';

      // Group items by artist for this order
      const artistOrderItems = new Map<string, { name: string; qty: number; price: number }[]>();

      for (const item of orderItems) {
        if (item._discountDetails) continue;
        const nameLower = (item.productName || item.name || '').toLowerCase();
        const displayName = item.productName || item.name || '';
        const qty = item.quantity || 1;
        const itemRevenue = (item.price || 0) * qty;

        // 1. Slug-based lookup (takes priority — uses tagged artist_slug from products)
        const artistSlug = productNameToSlug.get(nameLower);
        if (artistSlug) {
          const label = slugToLabel.get(artistSlug) || artistSlug;
          initArtist(label);
          artistMap.get(label)!.items += qty;
          artistMap.get(label)!.revenue += itemRevenue;
          if (!artistOrderItems.has(label)) artistOrderItems.set(label, []);
          artistOrderItems.get(label)!.push({ name: displayName, qty, price: item.price || 0 });
          continue;
        }

        // 2. Keyword fallback (products not yet tagged with artist_slug)
        let matched = false;
        for (const artist of ARTISTS) {
          if (artist.keywords.some(k => nameLower.includes(k))) {
            initArtist(artist.label);
            const entry = artistMap.get(artist.label)!;
            entry.items += qty;
            entry.revenue += itemRevenue;
            if (!artistOrderItems.has(artist.label)) artistOrderItems.set(artist.label, []);
            artistOrderItems.get(artist.label)!.push({ name: displayName, qty, price: item.price || 0 });
            matched = true;
            break;
          }
        }
        if (!matched) {
          initArtist("BOOOMERANGS");
          const entry = artistMap.get("BOOOMERANGS")!;
          entry.items += qty;
          entry.revenue += itemRevenue;
          if (!artistOrderItems.has("BOOOMERANGS")) artistOrderItems.set("BOOOMERANGS", []);
          artistOrderItems.get("BOOOMERANGS")!.push({ name: displayName, qty, price: item.price || 0 });
        }
      }

      for (const [artistLabel, artistItems] of artistOrderItems.entries()) {
        const entry = artistMap.get(artistLabel)!;
        const total = artistItems.reduce((s, i) => s + i.price * i.qty, 0);
        entry.orders += 1;
        entry.ordersList.push({ orderId, date, customerName, items: artistItems, total });
      }
    }

    return Array.from(artistMap.entries())
      .map(([artist, data]) => ({ artist, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getAllWholesaleOrdersIncludingDrafts(): Promise<Order[]> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, is_preorder, deposit_paid, remaining_amount, user_id, cdek_data
        FROM orders
        WHERE is_wholesale = true
        ORDER BY created_at DESC
        LIMIT 500;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items[0])),
      sessionId: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      customerEmail: this.extractTypedValue(row.items[3]),
      customerPhone: this.extractTypedValue(row.items[4]),
      address: this.extractTypedValue(row.items[5]),
      total: Number(this.extractTypedValue(row.items[6])),
      items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
      status: this.extractTypedValue(row.items[8]),
      createdAt: this.extractTypedValue(row.items[9]),
      isWholesale: this.extractTypedValue(row.items[10]) === true,
      transportCompany: this.extractTypedValue(row.items[11]) || undefined,
      isPreorder: this.extractTypedValue(row.items[12]) === true,
      depositPaid: this.extractTypedValue(row.items[13]) === true,
      remainingAmount: Number(this.extractTypedValue(row.items[14])) || 0,
      userId: Number(this.extractTypedValue(row.items[15])) || undefined,
      cdekData: this.extractTypedValue(row.items[16]) || undefined,
    })) as any;
  }

  async getUnsyncedOrdersFor1C(): Promise<Order[]> {
    if (!driver) {
      console.log('[Storage] getUnsyncedOrdersFor1C: YDB driver not initialized');
      return [];
    }
    
    console.log('[Storage] getUnsyncedOrdersFor1C: Fetching unsynced orders from YDB...');
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, is_preorder, deposit_paid, remaining_amount, user_id, cdek_data
        FROM orders
        WHERE status != 'awaiting_payment' AND (synced_to_1c IS NULL OR synced_to_1c = false)
        ORDER BY created_at DESC
        LIMIT 1000;
      `;
      const queryResult = await session.executeQuery(query);
      console.log(`[Storage] getUnsyncedOrdersFor1C: Query returned ${queryResult.resultSets[0]?.rows?.length || 0} rows`);
      return queryResult.resultSets[0]?.rows || [];
    });
    
    if (!result) return [];
    
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items[0])),
      sessionId: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      customerEmail: this.extractTypedValue(row.items[3]),
      customerPhone: this.extractTypedValue(row.items[4]),
      address: this.extractTypedValue(row.items[5]),
      total: Number(this.extractTypedValue(row.items[6])),
      items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
      status: this.extractTypedValue(row.items[8]),
      createdAt: this.extractTypedValue(row.items[9]),
      isWholesale: this.extractTypedValue(row.items[10]) === true,
      transportCompany: this.extractTypedValue(row.items[11]) || undefined,
      isPreorder: this.extractTypedValue(row.items[12]) === true,
      depositPaid: this.extractTypedValue(row.items[13]) === true,
      remainingAmount: Number(this.extractTypedValue(row.items[14])) || 0,
      userId: Number(this.extractTypedValue(row.items[15])) || undefined,
      cdekData: this.extractTypedValue(row.items[16]) || undefined,
    })) as any;
  }

  async markOrdersSyncedTo1C(orderIds: number[]): Promise<void> {
    if (!driver || orderIds.length === 0) return;
    
    console.log(`[Storage] markOrdersSyncedTo1C: Marking ${orderIds.length} orders as synced`);
    for (const orderId of orderIds) {
      await this.safeQuery(async (session) => {
        const ydb = await import('ydb-sdk');
        const query = `
          DECLARE $id AS Uint64;
          DECLARE $synced AS Bool;
          UPDATE orders SET synced_to_1c = $synced WHERE id = $id;
        `;
        const params = {
          '$id': ydb.TypedValues.uint64(orderId),
          '$synced': ydb.TypedValues.bool(true),
        };
        await session.executeQuery(query, params);
      });
    }
    console.log(`[Storage] markOrdersSyncedTo1C: Done`);
  }

  async getOrdersByStatus(status: string): Promise<Order[]> {
    if (!driver) return [];
    
    const result = await this.safeQuery(async (session) => {
      const ydb = await import('ydb-sdk');
      const query = `
        DECLARE $status AS Utf8;
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, partner_id
        FROM orders
        WHERE status = $status
        ORDER BY created_at DESC
        LIMIT 500;
      `;
      const params = {
        '$status': ydb.TypedValues.utf8(status),
      };
      const queryResult = await session.executeQuery(query, params);
      return queryResult.resultSets[0]?.rows || [];
    });
    
    if (!result) return [];
    
    return result.map((row: any) => {
      return {
        id: Number(this.extractTypedValue(row.items[0])),
        sessionId: this.extractTypedValue(row.items[1]),
        customerName: this.extractTypedValue(row.items[2]),
        customerEmail: this.extractTypedValue(row.items[3]),
        customerPhone: this.extractTypedValue(row.items[4]),
        address: this.extractTypedValue(row.items[5]),
        total: Number(this.extractTypedValue(row.items[6])),
        items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
        status: this.extractTypedValue(row.items[8]),
        createdAt: this.extractTypedValue(row.items[9]),
        // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
        partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[10])),
      };
    }) as any;
  }
  async getOrdersByEmail(email: string): Promise<Order[]> {
    if (!driver) return [];
    
    const result = await this.safeQuery(async (session) => {
      const ydb = await import('ydb-sdk');
      const query = `
        DECLARE $email AS Utf8;
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, cdek_data, payment_id, invoice_number, partner_id
        FROM orders
        WHERE customer_email = $email AND status != 'awaiting_payment'
        ORDER BY created_at DESC;
      `;
      const params = {
        '$email': ydb.TypedValues.utf8(email),
      };
      const result = await session.executeQuery(query, params);
      return result.resultSets[0]?.rows || [];
    });
    
    if (!result) return [];
    
    return result.map((row: any) => {
      return {
        id: Number(this.extractTypedValue(row.items[0])),
        sessionId: this.extractTypedValue(row.items[1]),
        customerName: this.extractTypedValue(row.items[2]),
        customerEmail: this.extractTypedValue(row.items[3]),
        customerPhone: this.extractTypedValue(row.items[4]),
        address: this.extractTypedValue(row.items[5]),
        total: Number(this.extractTypedValue(row.items[6])),
        items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
        status: this.extractTypedValue(row.items[8]),
        createdAt: this.extractTypedValue(row.items[9]),
        isWholesale: this.extractTypedValue(row.items[10]) === true,
        transportCompany: this.extractTypedValue(row.items[11]) || undefined,
        cdekData: this.extractTypedValue(row.items[12]) || undefined,
        paymentId: this.extractTypedValue(row.items[13]) || undefined,
        invoiceNumber: this.extractTypedValue(row.items[14]) ? Number(this.extractTypedValue(row.items[14])) : undefined,
        // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
        partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[15])),
      };
    }) as any;
  }

  async getOrdersByUserId(userId: number): Promise<Order[]> {
    if (!driver) return [];
    
    const result = await this.safeQuery(async (session) => {
      const ydb = await import('ydb-sdk');
      const query = `
        DECLARE $user_id AS Uint64;
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, payment_id, cdek_data, is_preorder, deposit_paid, remaining_amount, preorder_payment_id, invoice_number
        FROM orders
        WHERE user_id = $user_id AND status != 'awaiting_payment'
        ORDER BY created_at DESC;
      `;
      const params = {
        '$user_id': ydb.TypedValues.uint64(userId),
      };
      const result = await session.executeQuery(query, params);
      return result.resultSets[0]?.rows || [];
    });
    
    if (!result) return [];
    
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items[0])),
      sessionId: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      customerEmail: this.extractTypedValue(row.items[3]),
      customerPhone: this.extractTypedValue(row.items[4]),
      address: this.extractTypedValue(row.items[5]),
      total: Number(this.extractTypedValue(row.items[6])),
      items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
      status: this.extractTypedValue(row.items[8]),
      createdAt: this.extractTypedValue(row.items[9]),
      isWholesale: this.extractTypedValue(row.items[10]) === true,
      transportCompany: this.extractTypedValue(row.items[11]) || undefined,
      paymentId: this.extractTypedValue(row.items[12]) || undefined,
      cdekData: this.extractTypedValue(row.items[13]) || undefined,
      isPreorder: this.extractTypedValue(row.items[14]) === true,
      depositPaid: this.extractTypedValue(row.items[15]) === true,
      remainingAmount: Number(this.extractTypedValue(row.items[16])) || 0,
      preorderPaymentId: this.extractTypedValue(row.items[17]) || undefined,
      invoiceNumber: this.extractTypedValue(row.items[18]) ? Number(this.extractTypedValue(row.items[18])) : undefined,
    })) as any;
  }

  async getOrder(id: number): Promise<Order | undefined> {
    if (!driver) return undefined;
    
    let result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, payment_id, created_at, is_wholesale, cdek_data, user_id, is_preorder, deposit_paid, remaining_amount, preorder_payment_id, invoice_number, partner_id, addon_data
        FROM orders WHERE id = $id LIMIT 1;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
      });
    });
    
    let hasCdekData = true;
    let hasUserId = true;
    let hasPreorderFields = true;
    let hasPartnerId = true;
    if (!result?.resultSets?.[0]?.rows?.[0]) {
      result = await this.safeQuery(async (session) => {
        const { TypedValues } = await import("ydb-sdk");
        const query = `
          DECLARE $id AS Uint64;
          SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, payment_id, created_at, is_wholesale
          FROM orders WHERE id = $id LIMIT 1;
        `;
        return await session.executeQuery(query, {
          $id: TypedValues.uint64(id),
        });
      });
      hasCdekData = false;
      hasUserId = false;
      hasPreorderFields = false;
      hasPartnerId = false;
      if (!result?.resultSets?.[0]?.rows?.[0]) return undefined;
    }
    
    const row = result.resultSets[0].rows[0];
    if (!row.items) return undefined;
    const userIdRaw = hasUserId ? this.extractTypedValue(row.items[13]) : undefined;
    const userId = userIdRaw ? Number(userIdRaw) : null;
    // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
    const partnerId = hasPartnerId ? deserializeOrderPartnerId(this.extractTypedValue(row.items[19])) : null;
    return {
      id: Number(this.extractTypedValue(row.items[0])),
      sessionId: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      customerEmail: this.extractTypedValue(row.items[3]),
      customerPhone: this.extractTypedValue(row.items[4]),
      address: this.extractTypedValue(row.items[5]),
      total: Number(this.extractTypedValue(row.items[6])),
      items: JSON.parse(this.extractTypedValue(row.items[7]) || '[]'),
      status: this.extractTypedValue(row.items[8]),
      paymentId: this.extractTypedValue(row.items[9]) || undefined,
      createdAt: this.extractTypedValue(row.items[10]),
      isWholesale: this.extractTypedValue(row.items[11]) === true,
      cdekData: hasCdekData ? (this.extractTypedValue(row.items[12]) || undefined) : undefined,
      userId,
      isPreorder: hasPreorderFields ? this.extractTypedValue(row.items[14]) === true : false,
      depositPaid: hasPreorderFields ? this.extractTypedValue(row.items[15]) === true : false,
      remainingAmount: hasPreorderFields ? Number(this.extractTypedValue(row.items[16])) || 0 : 0,
      preorderPaymentId: hasPreorderFields ? (this.extractTypedValue(row.items[17]) || undefined) : undefined,
      invoiceNumber: hasPreorderFields && this.extractTypedValue(row.items[18]) ? Number(this.extractTypedValue(row.items[18])) : null,
      partnerId,
      addonData: this.extractTypedValue(row.items[20]) || null,
    } as any;
  }
  
  async updateOrderStatus(id: number, status: string): Promise<Order> {
    if (!driver) return { id, status } as any;
    
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $status AS Utf8;
        UPDATE orders SET status = $status WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8(status),
      });
    });
    return { id, status } as any;
  }
  
  async updateOrderPaymentId(id: number, paymentId: string): Promise<void> {
    if (!driver) return;
    
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $paymentId AS Utf8;
        UPDATE orders SET payment_id = $paymentId WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $paymentId: TypedValues.utf8(paymentId),
      });
    });
  }
  
  async updateOrderCdekData(id: number, cdekData: string): Promise<void> {
    if (!driver) return;
    
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $cdek_data AS Utf8;
        UPDATE orders SET cdek_data = $cdek_data WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $cdek_data: TypedValues.utf8(cdekData),
      });
    });
  }

  async updateOrderBitrixDealId(id: number, dealId: number): Promise<void> {
    if (!driver) return;
    
    try {
      await this.safeQuery(async (session) => {
        const { TypedValues } = await import("ydb-sdk");
        const query = `
          DECLARE $id AS Uint64;
          DECLARE $bitrix_deal_id AS Utf8;
          UPDATE orders SET bitrix_deal_id = $bitrix_deal_id WHERE id = $id;
        `;
        return await session.executeQuery(query, {
          $id: TypedValues.uint64(id),
          $bitrix_deal_id: TypedValues.utf8(String(dealId)),
        });
      });
    } catch (e: any) {
      if (e.message?.includes("No such column") || e.message?.includes("Member not found")) {
        console.warn("[Storage] bitrix_deal_id column not found in orders, skipping");
      } else {
        throw e;
      }
    }
  }

  async getOrderBitrixDealId(id: number): Promise<number | null> {
    if (!driver) return null;

    try {
      const result = await this.safeQuery(async (session) => {
        const { TypedValues } = await import("ydb-sdk");
        const query = `
          DECLARE $id AS Uint64;
          SELECT bitrix_deal_id FROM orders WHERE id = $id;
        `;
        return await session.executeQuery(query, {
          $id: TypedValues.uint64(id),
        });
      });

      if (!result || !result.resultSets || !result.resultSets[0]) {
        return null;
      }

      const rows = this.parseResultSet<any>(result.resultSets[0]);
      if (rows.length > 0 && rows[0].bitrixDealId) {
        return Number(rows[0].bitrixDealId);
      }
      return null;
    } catch (e: any) {
      if (e.message?.includes("No such column") || e.message?.includes("Member not found") || e.message?.includes("Cannot read properties of null")) {
        return null;
      }
      console.warn(`[Storage] Error getting bitrix deal ID for order ${id}:`, e.message);
      return null;
    }
  }

  async incrementPreorderCurrent(productId: number): Promise<number> {
    const product = await this.getProduct(productId);
    if (!product) throw new Error('Product not found');
    const newCurrent = ((product as any).preorderCurrent || 0) + 1;
    await this.updateProduct(productId, { preorderCurrent: newCurrent } as any);
    return newCurrent;
  }

  async updatePreorderStatus(productId: number, status: string): Promise<void> {
    await this.updateProduct(productId, { preorderStatus: status } as any);
  }

  async getPreorderProducts(): Promise<Product[]> {
    const allProducts = await this.getProducts();
    return allProducts.filter((p: any) => p.preorderEnabled === true && !p.isHidden);
  }

  async getWholesalePreorderProducts(): Promise<Product[]> {
    const allProducts = await this.getProducts();
    return allProducts.filter((p: any) => p.wholesalePreorderEnabled === true && !p.isHidden);
  }

  async createPreorderOrder(order: InsertOrder & { items: any[], total: number, userId?: number, depositAmount: number }): Promise<Order> {
    const createdOrder = await this.createOrder(order as any);
    await this.updateOrderPreorderFields(createdOrder.id, {
      isPreorder: true,
      depositPaid: false,
      remainingAmount: order.total - order.depositAmount,
    });
    return createdOrder;
  }

  async updateOrderPreorderFields(orderId: number, fields: { depositPaid?: boolean; remainingAmount?: number; preorderPaymentId?: string; isPreorder?: boolean }): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const setClauses: string[] = [];
      const params: Record<string, any> = {
        $id: TypedValues.uint64(orderId),
      };
      let declareStatements = 'DECLARE $id AS Uint64;\n';

      if (fields.isPreorder !== undefined) {
        declareStatements += 'DECLARE $is_preorder AS Bool;\n';
        setClauses.push('is_preorder = $is_preorder');
        params.$is_preorder = TypedValues.bool(fields.isPreorder);
      }
      if (fields.depositPaid !== undefined) {
        declareStatements += 'DECLARE $deposit_paid AS Bool;\n';
        setClauses.push('deposit_paid = $deposit_paid');
        params.$deposit_paid = TypedValues.bool(fields.depositPaid);
      }
      if (fields.remainingAmount !== undefined) {
        declareStatements += 'DECLARE $remaining_amount AS Int32;\n';
        setClauses.push('remaining_amount = $remaining_amount');
        params.$remaining_amount = TypedValues.int32(fields.remainingAmount);
      }
      if (fields.preorderPaymentId !== undefined) {
        declareStatements += 'DECLARE $preorder_payment_id AS Utf8;\n';
        setClauses.push('preorder_payment_id = $preorder_payment_id');
        params.$preorder_payment_id = TypedValues.utf8(fields.preorderPaymentId);
      }

      if (setClauses.length === 0) return;

      const query = `
        ${declareStatements}
        UPDATE orders SET ${setClauses.join(', ')} WHERE id = $id;
      `;
      await session.executeQuery(query, params);
      console.log(`[YDB] Updated preorder fields for order ${orderId}`);
    });
  }

  async updateOrderAddonData(orderId: number, addonData: string): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $addon_data AS Utf8;
        UPDATE orders SET addon_data = $addon_data WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(orderId),
        $addon_data: TypedValues.utf8(addonData),
      });
    });
  }

  async updateOrderItems(orderId: number, items: any[], totalKopeks: number): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $items AS Json;
        DECLARE $total AS Int32;
        UPDATE orders SET items = $items, total = $total WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(orderId),
        $items: TypedValues.json(JSON.stringify(items)),
        $total: TypedValues.int32(totalKopeks),
      });
    });
  }

  async appendOrderItems(orderId: number, newItems: any[], addedTotal: number): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const selectQuery = `
        DECLARE $id AS Uint64;
        SELECT items, total FROM orders WHERE id = $id;
      `;
      const result = await session.executeQuery(selectQuery, { $id: TypedValues.uint64(orderId) });
      const rows = result.resultSets?.[0]?.rows || [];
      let existingItems: any[] = [];
      let currentTotal = 0;
      if (rows.length > 0) {
        const row = rows[0] as any;
        try { existingItems = JSON.parse(this.extractTypedValue(row.items[0]) || '[]'); } catch {}
        currentTotal = Number(this.extractTypedValue(row.items[1]) ?? 0);
      }
      const mergedItems = [...existingItems, ...newItems];
      const newTotal = currentTotal + addedTotal;
      const updateQuery = `
        DECLARE $id AS Uint64;
        DECLARE $items AS Json;
        DECLARE $total AS Int32;
        UPDATE orders SET items = $items, total = $total WHERE id = $id;
      `;
      return await session.executeQuery(updateQuery, {
        $id: TypedValues.uint64(orderId),
        $items: TypedValues.json(JSON.stringify(mergedItems)),
        $total: TypedValues.int32(newTotal),
      });
    });
  }

  async getPreorderOrdersByUser(userId: number): Promise<Order[]> {
    const allOrders = await this.getOrders();
    return allOrders.filter((o: any) => o.userId === userId && o.isPreorder === true);
  }

  async updateOrderUserId(orderId: number, userId: number): Promise<boolean> {
    if (!driver) return false;
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        const query = `
          DECLARE $id AS Uint64;
          DECLARE $user_id AS Uint64;
          UPDATE orders SET user_id = $user_id WHERE id = $id;
        `;
        await session.executeQuery(query, {
          '$id': ydb.TypedValues.uint64(orderId),
          '$user_id': ydb.TypedValues.uint64(userId),
        });
      });
      console.log(`[Storage] Updated order ${orderId} user_id to ${userId}`);
      return true;
    } catch (err: any) {
      console.error(`[Storage] updateOrderUserId error for order ${orderId}:`, err.message);
      return false;
    }
  }

  async getWholesaleOrdersWithoutUserId(): Promise<any[]> {
    if (!driver) return [];
    
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, customer_email, customer_name, is_wholesale, user_id
        FROM orders
        WHERE is_wholesale = true AND user_id IS NULL
        LIMIT 500;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    
    if (!result) return [];
    
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items[0])),
      customerEmail: this.extractTypedValue(row.items[1]),
      customerName: this.extractTypedValue(row.items[2]),
      isWholesale: this.extractTypedValue(row.items[3]) === true,
      userId: this.extractTypedValue(row.items[4]),
    }));
  }

  async saveOrderInvoiceNumber(orderId: number, invoiceNumber: number): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $invoice_number AS Int32;
        UPDATE orders SET invoice_number = $invoice_number WHERE id = $id;
      `;
      await session.executeQuery(query, {
        $id: TypedValues.uint64(orderId),
        $invoice_number: TypedValues.int32(invoiceNumber),
      });
    });
  }

  async deleteOrder(id: number): Promise<boolean> {
    if (!driver) return false;
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        const query = `
          DECLARE $id AS Uint64;
          DELETE FROM orders WHERE id = $id;
        `;
        await session.executeQuery(query, {
          '$id': ydb.TypedValues.uint64(id),
        });
      });
      console.log(`[Storage] Deleted order ${id}`);
      return true;
    } catch (err: any) {
      console.error('[Storage] deleteOrder error:', err.message);
      return false;
    }
  }

  async getDraftOrders(): Promise<any[]> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, payment_id
        FROM orders
        WHERE status = 'awaiting_payment' OR status = 'expired'
        ORDER BY created_at DESC
        LIMIT 500;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];
    return result.map((row: any) => ({
      id: Number(this.extractTypedValue(row.items![0])),
      sessionId: this.extractTypedValue(row.items![1]),
      customerName: this.extractTypedValue(row.items![2]),
      customerEmail: this.extractTypedValue(row.items![3]),
      customerPhone: this.extractTypedValue(row.items![4]),
      address: this.extractTypedValue(row.items![5]),
      total: Number(this.extractTypedValue(row.items![6])) || 0,
      items: (() => { try { const v = this.extractTypedValue(row.items![7]); return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; } })(),
      status: this.extractTypedValue(row.items![8]),
      createdAt: (() => { const v = this.extractTypedValue(row.items![9]); if (!v) return null; const n = Number(v); return !isNaN(n) && n > 1e12 ? new Date(n / 1000).toISOString() : new Date(v).toISOString(); })(),
      paymentId: this.extractTypedValue(row.items![10]),
    }));
  }

  async deleteExpiredDraftOrders(maxAgeMinutes: number): Promise<number> {
    if (!driver) return 0;
    
    try {
      const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
      const allOrders = await this.safeQuery(async (session) => {
        const query = `
          SELECT id, status, created_at
          FROM orders
          WHERE status = 'awaiting_payment'
          LIMIT 500;
        `;
        const result = await session.executeQuery(query);
        return result.resultSets[0]?.rows || [];
      });

      if (!allOrders || allOrders.length === 0) return 0;

      let deletedCount = 0;
      for (const row of allOrders) {
        const id = Number(this.extractTypedValue(row.items![0]));
        const createdAt = this.extractTypedValue(row.items![2]);
        let orderDate: Date;
        if (createdAt) {
          const numVal = Number(createdAt);
          if (!isNaN(numVal) && numVal > 1e12) {
            orderDate = new Date(numVal / 1000);
          } else {
            orderDate = new Date(createdAt);
          }
        } else {
          orderDate = new Date(id);
        }
        if (isNaN(orderDate.getTime())) {
          console.warn(`[Cleanup] Invalid date for draft order ${id}, skipping`);
          continue;
        }
        
        if (orderDate < cutoff) {
          await this.updateOrderStatus(id, 'expired');
          deletedCount++;
          console.log(`[Cleanup] Marked draft order ${id} as expired`);
        }
      }

      const pendingCards = await this.getGiftCards();
      for (const card of pendingCards) {
        if (card.status === 'pending') {
          const cardDate = card.createdAt ? new Date(card.createdAt) : new Date(card.id);
          if (cardDate < cutoff) {
            await this.deleteGiftCard(card.id);
            deletedCount++;
            console.log(`[Cleanup] Deleted expired draft gift card ${card.id}`);
          }
        }
      }

      return deletedCount;
    } catch (err: any) {
      console.error('[Cleanup] Error deleting expired drafts:', err.message);
      return 0;
    }
  }
  
  async createOrder(order: InsertOrder & { items: any[], total: number, promoCode?: string, isWholesale?: boolean, transportCompany?: string, userId?: number, partnerId?: number, cdekPointCode?: string, cdekCityCode?: number, cdekTariffCode?: number, cdekDeliveryType?: string, cdekDoorAddress?: { street: string; house: string; flat?: string; entrance?: string; floor?: string } }): Promise<Order> {
    if (!driver) {
      console.error('[Storage] YDB driver not initialized for createOrder');
      throw new Error('Database not available');
    }
    
    const orderId = Date.now();
    const createdAt = new Date();
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        const query = `
          DECLARE $id AS Uint64;
          DECLARE $session_id AS Utf8;
          DECLARE $customer_name AS Utf8;
          DECLARE $customer_email AS Utf8;
          DECLARE $customer_phone AS Utf8;
          DECLARE $address AS Utf8;
          DECLARE $total AS Int32;
          DECLARE $items AS Json;
          DECLARE $status AS Utf8;
          DECLARE $promo_code AS Utf8;
          DECLARE $is_wholesale AS Bool;
          DECLARE $transport_company AS Utf8;
          DECLARE $cdek_data AS Utf8;
          DECLARE $created_at AS Timestamp;
          ${order.userId ? 'DECLARE $user_id AS Uint64;' : ''}
          ${order.partnerId ? 'DECLARE $partner_id AS Utf8;' : ''}
          
          UPSERT INTO orders (id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, promo_code, is_wholesale, transport_company, cdek_data, user_id, partner_id, created_at)
          VALUES ($id, $session_id, $customer_name, $customer_email, $customer_phone, $address, $total, $items, $status, $promo_code, $is_wholesale, $transport_company, $cdek_data, ${order.userId ? 'Just($user_id)' : 'NULL'}, ${order.partnerId ? 'Just($partner_id)' : 'NULL'}, $created_at);
        `;
        
        const cdekData = JSON.stringify({
          deliveryService: "cdek",
          pointCode: order.cdekPointCode || null,
          cityCode: order.cdekCityCode || null,
          tariffCode: order.cdekTariffCode || null,
          deliveryType: order.cdekDeliveryType || "pickup",
          doorAddress: order.cdekDoorAddress || null,
          orderUuid: null,
        });
        
        const params: Record<string, any> = {
          '$id': ydb.TypedValues.uint64(orderId),
          '$session_id': ydb.TypedValues.utf8(order.sessionId || ''),
          '$customer_name': ydb.TypedValues.utf8(order.customerName),
          '$customer_email': ydb.TypedValues.utf8(order.customerEmail),
          '$customer_phone': ydb.TypedValues.utf8(order.customerPhone),
          '$address': ydb.TypedValues.utf8(order.address),
          '$total': ydb.TypedValues.int32(order.total),
          '$items': ydb.TypedValues.json(JSON.stringify(order.items)),
          '$status': ydb.TypedValues.utf8('awaiting_payment'),
          '$promo_code': ydb.TypedValues.utf8(order.promoCode || ''),
          '$is_wholesale': ydb.TypedValues.bool(order.isWholesale || false),
          '$transport_company': ydb.TypedValues.utf8(order.transportCompany || ''),
          '$cdek_data': ydb.TypedValues.utf8(cdekData),
          '$created_at': ydb.TypedValues.timestamp(createdAt),
        };
        if (order.userId) {
          params['$user_id'] = ydb.TypedValues.uint64(order.userId);
        }
        if (order.partnerId) {
          // См. serializeOrderPartnerId (вверху файла) — там расписан весь legacy-кейс.
          params['$partner_id'] = serializeOrderPartnerId(order.partnerId);
        }
        
        console.log(`[Storage] Executing UPSERT for draft order ${orderId}...`);
        
        try {
          await session.executeQuery(query, params);
        } catch (e: any) {
          if (e.message?.includes("No such column") || e.message?.includes("Member not found")) {
            console.warn("[Storage] Some columns missing in orders table, falling back to basic insert");
            const queryBasic = `
              DECLARE $id AS Uint64;
              DECLARE $session_id AS Utf8;
              DECLARE $customer_name AS Utf8;
              DECLARE $customer_email AS Utf8;
              DECLARE $customer_phone AS Utf8;
              DECLARE $address AS Utf8;
              DECLARE $total AS Int32;
              DECLARE $items AS Json;
              DECLARE $status AS Utf8;
              DECLARE $is_wholesale AS Bool;
              DECLARE $transport_company AS Utf8;
              DECLARE $created_at AS Timestamp;
              ${order.userId ? 'DECLARE $user_id AS Uint64;' : ''}
              
              UPSERT INTO orders (id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, is_wholesale, transport_company, user_id, created_at)
              VALUES ($id, $session_id, $customer_name, $customer_email, $customer_phone, $address, $total, $items, $status, $is_wholesale, $transport_company, ${order.userId ? 'Just($user_id)' : 'NULL'}, $created_at);
            `;

            const paramsBasic: Record<string, any> = {
              '$id': ydb.TypedValues.uint64(orderId),
              '$session_id': ydb.TypedValues.utf8(order.sessionId || ''),
              '$customer_name': ydb.TypedValues.utf8(order.customerName),
              '$customer_email': ydb.TypedValues.utf8(order.customerEmail),
              '$customer_phone': ydb.TypedValues.utf8(order.customerPhone),
              '$address': ydb.TypedValues.utf8(order.address),
              '$total': ydb.TypedValues.int32(order.total),
              '$items': ydb.TypedValues.json(JSON.stringify(order.items)),
              '$status': ydb.TypedValues.utf8('awaiting_payment'),
              '$is_wholesale': ydb.TypedValues.bool(order.isWholesale || false),
              '$transport_company': ydb.TypedValues.utf8(order.transportCompany || ''),
              '$created_at': ydb.TypedValues.timestamp(createdAt),
            };
            if (order.userId) {
              paramsBasic['$user_id'] = ydb.TypedValues.uint64(order.userId);
            }
            await session.executeQuery(queryBasic, paramsBasic);
          } else {
            throw e;
          }
        }
        console.log(`[Storage] UPSERT completed for order ${orderId}`);
      });
      
      // If promo code used, increment its usage
      if (order.promoCode) {
        await this.incrementPromoCodeUsage(order.promoCode);
      }

      console.log(`[Storage] Order created: ${orderId} for ${order.customerEmail}`);
      
      return {
        id: orderId,
        sessionId: order.sessionId || '',
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        address: order.address,
        total: order.total,
        items: order.items,
        status: 'pending',
        promoCode: order.promoCode,
        createdAt: createdAt.toISOString(),
      } as unknown as Order;
    } catch (error) {
      console.error('[Storage] Error creating order:', error);
      throw error;
    }
  }

  async addThumbnailColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    const columnsToAdd = ['thumbnail_url', 'hover_thumbnail_url'];
    const results: string[] = [];
    
    try {
      const ydb = await import('ydb-sdk');
      const colType = ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } });
      
      for (const colName of columnsToAdd) {
        try {
          await driver.tableClient.withSession(async (session) => {
            await session.alterTable('products', {
              addColumns: [{ name: colName, type: colType }]
            } as any);
          });
          results.push(`${colName}: added`);
        } catch (e: any) {
          if (e.message?.includes("already exists") || e.message?.includes("Duplicate column") || e.message?.includes("Cannot alter type")) {
            results.push(`${colName}: already exists`);
          } else {
            results.push(`${colName}: error - ${e.message}`);
          }
        }
      }
      
      return { success: true, message: results.join('; ') };
    } catch (err: any) {
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addWholesalePriceColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'wholesale_price', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.INT64 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column wholesale_price added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addOnSaleColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'on_sale', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column on_sale added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addOldPriceColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'old_price', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.DOUBLE } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column old_price added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column") || err.message?.includes("Cannot alter type")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addIsHiddenColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'is_hidden', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column is_hidden added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addAutoHideOverrideColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'auto_hide_override', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.BOOL } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column auto_hide_override added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addStockColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'stock', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.INT64 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column stock added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async addSlugColumn(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized" };
    }
    
    try {
      await driver.tableClient.withSession(async (session) => {
        const ydb = await import('ydb-sdk');
        await session.alterTable('products', {
          addColumns: [
            { name: 'slug', type: ydb.Ydb.Type.create({ optionalType: { item: { typeId: ydb.Ydb.Type.PrimitiveTypeId.UTF8 } } }) }
          ]
        } as any);
      });
      return { success: true, message: "Column slug added successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("Duplicate column")) {
        return { success: true, message: "Column already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  // ============ Gift Cards Methods ============

  private generateGiftCardCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 to avoid confusion
    const generatePart = () => {
      let result = '';
      for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };
    return `BOOO-${generatePart()}-${generatePart()}-${generatePart()}`;
  }

  async createGiftCard(card: InsertGiftCard): Promise<GiftCard> {
    const id = Date.now();
    const code = this.generateGiftCardCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year validity

    const giftCard: GiftCard = {
      id,
      code,
      amount: card.amount,
      balance: card.balance,
      purchaserEmail: card.purchaserEmail,
      purchaserName: card.purchaserName || null,
      recipientEmail: card.recipientEmail || null,
      recipientName: card.recipientName || null,
      message: card.message || null,
      status: "pending",
      cardColor: (card as any).cardColor || 'black',
      paymentId: card.paymentId || null,
      paymentMethod: card.paymentMethod || null,
      redeemedByUserId: null,
      redeemedAt: null,
      expiresAt,
      createdAt: new Date(),
    };

    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        UPSERT INTO gift_cards (id, code, amount, balance, purchaser_email, purchaser_name, recipient_email, recipient_name, message, status, card_color, payment_id, payment_method, expires_at, created_at)
        VALUES ($id, $code, $amount, $balance, $purchaserEmail, $purchaserName, $recipientEmail, $recipientName, $message, $status, $cardColor, $paymentId, $paymentMethod, $expiresAt, $createdAt)
      `, {
        '$id': ydb.TypedValues.int64(id),
        '$code': ydb.TypedValues.utf8(code),
        '$amount': ydb.TypedValues.int32(card.amount),
        '$balance': ydb.TypedValues.int32(card.balance),
        '$purchaserEmail': ydb.TypedValues.utf8(card.purchaserEmail),
        '$purchaserName': ydb.TypedValues.utf8(card.purchaserName || ''),
        '$recipientEmail': ydb.TypedValues.utf8(card.recipientEmail || ''),
        '$recipientName': ydb.TypedValues.utf8(card.recipientName || ''),
        '$message': ydb.TypedValues.utf8(card.message || ''),
        '$status': ydb.TypedValues.utf8('pending'),
        '$cardColor': ydb.TypedValues.utf8((card as any).cardColor || 'black'),
        '$paymentId': ydb.TypedValues.utf8(card.paymentId || ''),
        '$paymentMethod': ydb.TypedValues.utf8(card.paymentMethod || ''),
        '$expiresAt': ydb.TypedValues.timestamp(expiresAt),
        '$createdAt': ydb.TypedValues.timestamp(new Date()),
      });
    });

    console.log(`[GiftCard] Created gift card ${code} for ${card.amount / 100} RUB`);
    return giftCard;
  }

  async getGiftCardByCode(code: string): Promise<GiftCard | undefined> {
    const result = await this.safeQuery(async (session) => {
      const res = await session.executeQuery(`
        SELECT * FROM gift_cards WHERE code = $code
      `, { '$code': ydb.TypedValues.utf8(code) });
      const rs = res.resultSets[0];
      const row = rs?.rows?.[0];
      if (!row || !rs?.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseGiftCardFromData(data);
    });

    return result || undefined;
  }

  async getGiftCardById(id: number): Promise<GiftCard | undefined> {
    const result = await this.safeQuery(async (session) => {
      const res = await session.executeQuery(`
        SELECT * FROM gift_cards WHERE id = $id
      `, { '$id': ydb.TypedValues.int64(id) });
      const rs = res.resultSets[0];
      const row = rs?.rows?.[0];
      if (!row || !rs?.columns) return undefined;
      const data = this.parseRowWithColumns(row, rs.columns);
      return this.parseGiftCardFromData(data);
    });

    return result || undefined;
  }

  async updateGiftCard(id: number, updates: Partial<GiftCard>): Promise<GiftCard> {
    const existing = await this.getGiftCardById(id);
    if (!existing) throw new Error("Gift card not found");

    const updated = { ...existing, ...updates };

    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        UPSERT INTO gift_cards (id, code, amount, balance, purchaser_email, purchaser_name, recipient_email, recipient_name, message, status, card_color, payment_id, payment_method, redeemed_by_user_id, redeemed_at, expires_at, created_at)
        VALUES ($id, $code, $amount, $balance, $purchaserEmail, $purchaserName, $recipientEmail, $recipientName, $message, $status, $cardColor, $paymentId, $paymentMethod, $redeemedByUserId, $redeemedAt, $expiresAt, $createdAt)
      `, {
        '$id': ydb.TypedValues.int64(id),
        '$code': ydb.TypedValues.utf8(updated.code),
        '$amount': ydb.TypedValues.int32(updated.amount),
        '$balance': ydb.TypedValues.int32(updated.balance),
        '$purchaserEmail': ydb.TypedValues.utf8(updated.purchaserEmail),
        '$purchaserName': ydb.TypedValues.utf8(updated.purchaserName || ''),
        '$recipientEmail': ydb.TypedValues.utf8(updated.recipientEmail || ''),
        '$recipientName': ydb.TypedValues.utf8(updated.recipientName || ''),
        '$message': ydb.TypedValues.utf8(updated.message || ''),
        '$status': ydb.TypedValues.utf8(updated.status),
        '$cardColor': ydb.TypedValues.utf8(updated.cardColor || 'black'),
        '$paymentId': ydb.TypedValues.utf8(updated.paymentId || ''),
        '$paymentMethod': ydb.TypedValues.utf8(updated.paymentMethod || ''),
        '$redeemedByUserId': updated.redeemedByUserId ? ydb.TypedValues.int64(updated.redeemedByUserId) : ydb.TypedValues.optionalNull(ydb.Types.INT64),
        '$redeemedAt': updated.redeemedAt ? ydb.TypedValues.timestamp(updated.redeemedAt) : ydb.TypedValues.optionalNull(ydb.Types.TIMESTAMP),
        '$expiresAt': ydb.TypedValues.timestamp(updated.expiresAt),
        '$createdAt': ydb.TypedValues.timestamp(updated.createdAt || new Date()),
      });
    });

    return updated;
  }

  async getGiftCardsByEmail(email: string): Promise<GiftCard[]> {
    const result = await this.safeQuery(async (session) => {
      const res = await session.executeQuery(`
        SELECT * FROM gift_cards 
        WHERE purchaser_email = $email OR recipient_email = $email
        ORDER BY created_at DESC
      `, { '$email': ydb.TypedValues.utf8(email) });
      const rs = res.resultSets[0];
      if (!rs?.rows || !rs?.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns ?? []);
        return this.parseGiftCardFromData(data);
      });
    });

    return result || [];
  }

  async getGiftCards(): Promise<GiftCard[]> {
    const result = await this.safeQuery(async (session) => {
      const res = await session.executeQuery(`
        SELECT * FROM gift_cards ORDER BY created_at DESC
      `);
      const rs = res.resultSets[0];
      if (!rs?.rows || !rs?.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns ?? []);
        return this.parseGiftCardFromData(data);
      });
    });

    return result || [];
  }

  async deleteGiftCard(id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DELETE FROM gift_cards WHERE id = $id
      `, { '$id': ydb.TypedValues.int64(id) });
    });
    return true;
  }

  async redeemGiftCard(code: string, userId: number, amount: number): Promise<GiftCard> {
    const card = await this.getGiftCardByCode(code);
    if (!card) throw new Error("Подарочная карта не найдена");
    if (card.status === "used") throw new Error("Карта уже использована");
    if (card.status === "expired" || new Date() > card.expiresAt) throw new Error("Срок действия карты истёк");
    if (card.status !== "active") throw new Error("Карта ещё не активирована");
    if (card.balance < amount) throw new Error("Недостаточно средств на карте");

    const newBalance = card.balance - amount;
    const newStatus = newBalance === 0 ? "used" : "active";

    return await this.updateGiftCard(card.id, {
      balance: newBalance,
      status: newStatus,
      redeemedByUserId: userId,
      redeemedAt: new Date(),
    });
  }

  private parseGiftCardFromData(data: Record<string, any>): GiftCard {
    return {
      id: Number(data.id || 0),
      code: data.code || '',
      amount: Number(data.amount || 0),
      balance: Number(data.balance || 0),
      purchaserEmail: data.purchaser_email || '',
      purchaserName: data.purchaser_name || null,
      recipientEmail: data.recipient_email || null,
      recipientName: data.recipient_name || null,
      message: data.message || null,
      status: data.status || 'pending',
      cardColor: data.card_color || 'black',
      paymentId: data.payment_id || null,
      paymentMethod: data.payment_method || null,
      redeemedByUserId: data.redeemed_by_user_id ? Number(data.redeemed_by_user_id) : null,
      redeemedAt: data.redeemed_at ? new Date(data.redeemed_at) : null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : new Date(),
      createdAt: data.created_at ? new Date(data.created_at) : null,
    };
  }

  async migrateGiftCardsTable(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized — migration skipped" };
    }
    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable('gift_cards', new ydb.TableDescription()
          .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column('code', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('amount', ydb.Types.optional(ydb.Types.INT32)))
          .withColumn(new ydb.Column('balance', ydb.Types.optional(ydb.Types.INT32)))
          .withColumn(new ydb.Column('purchaser_email', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('purchaser_name', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('recipient_email', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('recipient_name', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('message', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('status', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('payment_id', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('payment_method', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('redeemed_by_user_id', ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column('redeemed_at', ydb.Types.optional(ydb.Types.TIMESTAMP)))
          .withColumn(new ydb.Column('expires_at', ydb.Types.optional(ydb.Types.TIMESTAMP)))
          .withColumn(new ydb.Column('created_at', ydb.Types.optional(ydb.Types.TIMESTAMP)))
          .withPrimaryKey('id')
          .withIndex(new ydb.TableIndex('idx_gift_cards_code').withIndexColumns('code'))
        );
      });
      return { success: true, message: "Table gift_cards created successfully" };
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        return { success: true, message: "Table already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
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
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  // ============ BONUS SYSTEM METHODS ============

  async migrateBonusTables(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized — migration skipped" };
    }
    const results: string[] = [];
    try {
      // 1. Promo codes table
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.createTable('promo_codes', new ydb.TableDescription()
            .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
            .withColumn(new ydb.Column('code', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('discount_percent', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('discount_amount', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('min_order_amount', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('max_uses', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('used_count', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('can_combine_with_loyalty', ydb.Types.optional(ydb.Types.BOOL)))
            .withColumn(new ydb.Column('is_active', ydb.Types.optional(ydb.Types.BOOL)))
            .withColumn(new ydb.Column('applicable_categories', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('starts_at', ydb.Types.optional(ydb.Types.DATETIME)))
            .withColumn(new ydb.Column('expires_at', ydb.Types.optional(ydb.Types.DATETIME)))
            .withColumn(new ydb.Column('created_at', ydb.Types.optional(ydb.Types.DATETIME)))
            .withPrimaryKey('id')
            .withIndex(new ydb.TableIndex('idx_promo_code').withIndexColumns('code'))
          );
        });
        results.push("promo_codes: created");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") ? "promo_codes: exists" : `promo_codes: ${err.message}`);
      }

      // 2. Loyalty tiers table
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.createTable('loyalty_tiers', new ydb.TableDescription()
            .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
            .withColumn(new ydb.Column('min_spent', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('discount_percent', ydb.Types.optional(ydb.Types.INT32)))
            .withColumn(new ydb.Column('name', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('sort_order', ydb.Types.optional(ydb.Types.INT32)))
            .withPrimaryKey('id')
          );
        });
        results.push("loyalty_tiers: created");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") ? "loyalty_tiers: exists" : `loyalty_tiers: ${err.message}`);
      }

      // 3. Newsletter subscriptions table
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.createTable('newsletter_subscriptions', new ydb.TableDescription()
            .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
            .withColumn(new ydb.Column('email', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('promo_code_given', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('subscribed_at', ydb.Types.optional(ydb.Types.DATETIME)))
            .withPrimaryKey('id')
            .withIndex(new ydb.TableIndex('idx_newsletter_email').withIndexColumns('email'))
          );
        });
        results.push("newsletter_subscriptions: created");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") ? "newsletter_subscriptions: exists" : `newsletter_subscriptions: ${err.message}`);
      }

      // 4. Bonus settings table
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.createTable('bonus_settings', new ydb.TableDescription()
            .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
            .withColumn(new ydb.Column('key', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('value', ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column('updated_at', ydb.Types.optional(ydb.Types.DATETIME)))
            .withPrimaryKey('id')
            .withIndex(new ydb.TableIndex('idx_bonus_settings_key').withIndexColumns('key'))
          );
        });
        results.push("bonus_settings: created");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") ? "bonus_settings: exists" : `bonus_settings: ${err.message}`);
      }

      // 5. Add loyalty columns to users table (separate queries for YDB compatibility)
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE users ADD COLUMN total_spent Int32`);
        });
        results.push("users.total_spent: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found") 
          ? "users.total_spent: exists" 
          : `users.total_spent: ${err.message}`);
      }
      
      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE users ADD COLUMN loyalty_discount Int32`);
        });
        results.push("users.loyalty_discount: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found") 
          ? "users.loyalty_discount: exists" 
          : `users.loyalty_discount: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE gift_cards ADD COLUMN card_color Utf8`);
        });
        results.push("gift_cards.card_color: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "gift_cards.card_color: exists"
          : `gift_cards.card_color: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN wholesale_preorder_enabled Bool`);
        });
        results.push("products.wholesale_preorder_enabled: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.wholesale_preorder_enabled: exists"
          : `products.wholesale_preorder_enabled: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN wholesale_preorder_sizes Json`);
        });
        results.push("products.wholesale_preorder_sizes: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.wholesale_preorder_sizes: exists"
          : `products.wholesale_preorder_sizes: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN wholesale_preorder_rrp Int64`);
        });
        results.push("products.wholesale_preorder_rrp: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.wholesale_preorder_rrp: exists"
          : `products.wholesale_preorder_rrp: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN wholesale_preorder_price Int64`);
        });
        results.push("products.wholesale_preorder_price: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.wholesale_preorder_price: exists"
          : `products.wholesale_preorder_price: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN note Utf8`);
        });
        results.push("products.note: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.note: exists"
          : `products.note: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN artist_slug Utf8`);
        });
        results.push("products.artist_slug: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.artist_slug: exists"
          : `products.artist_slug: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN video_url Utf8`);
        });
        results.push("products.video_url: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.video_url: exists"
          : `products.video_url: ${err.message}`);
      }

      try {
        await driver.tableClient.withSession(async (session: ydb.Session) => {
          await session.executeQuery(`ALTER TABLE products ADD COLUMN feature_badge_ids Json`);
        });
        results.push("products.feature_badge_ids: added");
      } catch (err: any) {
        results.push(err.message?.includes("already exists") || err.message?.includes("Member not found")
          ? "products.feature_badge_ids: exists"
          : `products.feature_badge_ids: ${err.message}`);
      }

      return { success: true, message: results.join("; ") };
    } catch (err: any) {
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  // Promo codes
  async getPromoCodes(): Promise<PromoCode[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM promo_codes ORDER BY created_at DESC`);
      return this.parseResultSet<PromoCode>(resultSets[0]);
    });
    return result || [];
  }

  async getPromoCodeByCode(code: string): Promise<PromoCode | undefined> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $code AS Utf8; SELECT * FROM promo_codes WHERE code = $code LIMIT 1`,
        { '$code': ydb.TypedValues.utf8(code.toUpperCase()) }
      );
      const rows = this.parseResultSet<PromoCode>(resultSets[0]);
      return rows[0];
    });
    return result || undefined;
  }

  async createPromoCode(promo: InsertPromoCode): Promise<PromoCode> {
    const id = Date.now();
    const now = new Date();
    await this.safeQuery(async (session) => {
      const discountPercent = promo.discountPercent !== null && promo.discountPercent !== undefined ? Number(promo.discountPercent) : null;
      const discountAmount = promo.discountAmount !== null && promo.discountAmount !== undefined ? Number(promo.discountAmount) : null;
      const minOrderAmount = promo.minOrderAmount !== null && promo.minOrderAmount !== undefined ? Number(promo.minOrderAmount) : 0;
      const maxUses = promo.maxUses !== null && promo.maxUses !== undefined ? Number(promo.maxUses) : null;

      const startsAt = promo.startsAt ? (promo.startsAt instanceof Date ? promo.startsAt : new Date(promo.startsAt)) : null;
      const expiresAt = promo.expiresAt ? (promo.expiresAt instanceof Date ? promo.expiresAt : new Date(promo.expiresAt)) : null;

      const applicableCategories = promo.applicableCategories
        ? (typeof promo.applicableCategories === 'string' ? promo.applicableCategories : JSON.stringify(promo.applicableCategories))
        : null;

      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $code AS Utf8;
        DECLARE $discount_percent AS Int32;
        DECLARE $discount_amount AS Int32;
        DECLARE $min_order_amount AS Int32;
        DECLARE $max_uses AS Int32;
        DECLARE $can_combine AS Bool;
        DECLARE $is_active AS Bool;
        DECLARE $allow_for_wholesale AS Bool;
        DECLARE $applicable_categories AS Optional<Utf8>;
        DECLARE $starts_at AS Optional<Datetime>;
        DECLARE $expires_at AS Optional<Datetime>;
        DECLARE $created_at AS Datetime;
        UPSERT INTO promo_codes (id, code, discount_percent, discount_amount, min_order_amount, max_uses, used_count, can_combine_with_loyalty, is_active, allow_for_wholesale, applicable_categories, starts_at, expires_at, created_at)
        VALUES ($id, $code, $discount_percent, $discount_amount, $min_order_amount, $max_uses, 0, $can_combine, $is_active, $allow_for_wholesale, $applicable_categories, $starts_at, $expires_at, $created_at)
      `, {
        '$id': ydb.TypedValues.uint64(id),
        '$code': ydb.TypedValues.utf8(promo.code.toUpperCase()),
        '$discount_percent': ydb.TypedValues.int32(discountPercent ?? 0),
        '$discount_amount': ydb.TypedValues.int32(discountAmount ?? 0),
        '$min_order_amount': ydb.TypedValues.int32(minOrderAmount),
        '$max_uses': ydb.TypedValues.int32(maxUses ?? 0),
        '$can_combine': ydb.TypedValues.bool(promo.canCombineWithLoyalty !== false),
        '$is_active': ydb.TypedValues.bool(promo.isActive !== false),
        '$allow_for_wholesale': ydb.TypedValues.bool(promo.allowForWholesale === true),
        '$applicable_categories': applicableCategories ? ydb.TypedValues.optional(ydb.TypedValues.utf8(applicableCategories)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8),
        '$starts_at': startsAt ? ydb.TypedValues.optional(ydb.TypedValues.datetime(startsAt)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME),
        '$expires_at': expiresAt ? ydb.TypedValues.optional(ydb.TypedValues.datetime(expiresAt)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME),
        '$created_at': ydb.TypedValues.datetime(now),
      });
    });
    return { id, ...promo, code: promo.code.toUpperCase(), usedCount: 0, createdAt: now } as PromoCode;
  }

  async updatePromoCode(id: number, updates: Partial<PromoCode>): Promise<PromoCode> {
    const setParts: string[] = [];
    const params: Record<string, any> = { '$id': ydb.TypedValues.uint64(id) };
    
    if (updates.code !== undefined) { setParts.push('code = $code'); params['$code'] = ydb.TypedValues.utf8(updates.code.toUpperCase()); }
    if (updates.discountPercent !== undefined) { setParts.push('discount_percent = $dp'); params['$dp'] = ydb.TypedValues.int32(updates.discountPercent!); }
    if (updates.discountAmount !== undefined) { setParts.push('discount_amount = $da'); params['$da'] = ydb.TypedValues.int32(updates.discountAmount!); }
    if (updates.minOrderAmount !== undefined) { setParts.push('min_order_amount = $moa'); params['$moa'] = ydb.TypedValues.int32(updates.minOrderAmount!); }
    if (updates.maxUses !== undefined) { setParts.push('max_uses = $mu'); params['$mu'] = ydb.TypedValues.int32(updates.maxUses!); }
    if (updates.canCombineWithLoyalty !== undefined) { setParts.push('can_combine_with_loyalty = $ccl'); params['$ccl'] = ydb.TypedValues.bool(updates.canCombineWithLoyalty!); }
    if (updates.isActive !== undefined) { setParts.push('is_active = $ia'); params['$ia'] = ydb.TypedValues.bool(updates.isActive!); }
    if (updates.allowForWholesale !== undefined) { setParts.push('allow_for_wholesale = $afw'); params['$afw'] = ydb.TypedValues.bool(updates.allowForWholesale!); }
    if ('applicableCategories' in updates) {
      const ac = updates.applicableCategories;
      const acStr = ac ? (typeof ac === 'string' ? ac : JSON.stringify(ac)) : null;
      setParts.push('applicable_categories = $ac');
      params['$ac'] = acStr ? ydb.TypedValues.optional(ydb.TypedValues.utf8(acStr)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8);
    }
    
    if (setParts.length > 0) {
      const declares = Object.entries(params).map(([k, v]) => {
        const type = k === '$id' ? 'Uint64' : k === '$code' ? 'Utf8' : k === '$ccl' || k === '$ia' || k === '$afw' ? 'Bool' : k === '$ac' ? 'Optional<Utf8>' : 'Int32';
        return `DECLARE ${k} AS ${type};`;
      }).join('\n');
      
      await this.safeQuery(async (session) => {
        await session.executeQuery(`${declares}\nUPDATE promo_codes SET ${setParts.join(', ')} WHERE id = $id`, params);
      });
    }
    const updated = await this.getPromoCodes();
    return updated.find(p => p.id === id) as PromoCode;
  }

  async deletePromoCode(id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM promo_codes WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }

  async incrementPromoCodeUsage(code: string): Promise<void> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $code AS Utf8;
        UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $code
      `, { '$code': ydb.TypedValues.utf8(code.toUpperCase()) });
    });
  }

  async isPromoUsedByEmail(email: string, code: string): Promise<boolean> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(`
        DECLARE $email AS Utf8;
        DECLARE $code AS Utf8;
        SELECT id FROM orders
        WHERE customer_email = $email AND promo_code = $code AND status != 'cancelled'
        LIMIT 1
      `, {
        '$email': TypedValues.fromNative(Types.UTF8, email.toLowerCase().trim()),
        '$code': TypedValues.fromNative(Types.UTF8, code.toUpperCase().trim()),
      });
      return (resultSets[0]?.rows?.length ?? 0) > 0;
    });
    return result ?? false;
  }

  async getPartnerPromoCode(partnerId: number): Promise<(PromoCode & { partnerId?: number }) | undefined> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $partner_id AS Uint64;
         SELECT * FROM promo_codes WHERE partner_id = $partner_id LIMIT 1`,
        { '$partner_id': ydb.TypedValues.uint64(partnerId) },
      );
      const rows = this.parseResultSet<PromoCode & { partnerId?: number }>(resultSets[0]);
      return rows[0];
    });
    return result || undefined;
  }

  async setPartnerPromoCode(partnerId: number, code: string, discountPercent: number): Promise<PromoCode & { partnerId?: number }> {
    const upperCode = code.toUpperCase().trim();

    // Check if code is taken by a different entity (non-partner promo or another partner)
    const byCode = await this.getPromoCodeByCode(upperCode);
    if (byCode) {
      const existingPartnerId = Number((byCode as any).partnerId) || null;
      if (!existingPartnerId || existingPartnerId !== partnerId) {
        throw new Error(`Промокод ${upperCode} уже занят`);
      }
      // Same partner, just update the discount
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Uint64;
          DECLARE $dp AS Int32;
          UPDATE promo_codes SET discount_percent = $dp, is_active = true WHERE id = $id
        `, {
          '$id': ydb.TypedValues.uint64(byCode.id),
          '$dp': ydb.TypedValues.int32(discountPercent),
        });
      });
      return { ...byCode, discountPercent, isActive: true, partnerId } as any;
    }

    // Delete any previous promo code this partner had (one partner = one promo code)
    await this.deletePartnerPromoCode(partnerId);

    const id = Date.now();
    const now = new Date();
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $code AS Utf8;
        DECLARE $discount_percent AS Int32;
        DECLARE $partner_id AS Uint64;
        DECLARE $created_at AS Datetime;
        UPSERT INTO promo_codes (id, code, discount_percent, discount_amount, min_order_amount, used_count, can_combine_with_loyalty, is_active, partner_id, created_at)
        VALUES ($id, $code, $discount_percent, 0, 0, 0, false, true, $partner_id, $created_at)
      `, {
        '$id': ydb.TypedValues.uint64(id),
        '$code': ydb.TypedValues.utf8(upperCode),
        '$discount_percent': ydb.TypedValues.int32(discountPercent),
        '$partner_id': ydb.TypedValues.uint64(partnerId),
        '$created_at': ydb.TypedValues.datetime(now),
      });
    });

    return {
      id,
      code: upperCode,
      discountPercent,
      discountAmount: null,
      minOrderAmount: 0,
      maxUses: null,
      usedCount: 0,
      canCombineWithLoyalty: false,
      isActive: true,
      applicableCategories: null,
      startsAt: null,
      expiresAt: null,
      createdAt: now.toISOString(),
      partnerId,
    } as any;
  }

  async deletePartnerPromoCode(partnerId: number): Promise<void> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $partner_id AS Uint64;
         DELETE FROM promo_codes WHERE partner_id = $partner_id`,
        { '$partner_id': ydb.TypedValues.uint64(partnerId) },
      );
    });
  }

  // Loyalty tiers
  async getLoyaltyTiers(): Promise<LoyaltyTier[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM loyalty_tiers ORDER BY min_spent ASC`);
      return this.parseResultSet<LoyaltyTier>(resultSets[0]);
    });
    return result || [];
  }

  async createLoyaltyTier(tier: InsertLoyaltyTier): Promise<LoyaltyTier> {
    const id = Date.now();
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $min_spent AS Int32;
        DECLARE $discount_percent AS Int32;
        DECLARE $name AS Utf8;
        DECLARE $sort_order AS Int32;
        UPSERT INTO loyalty_tiers (id, min_spent, discount_percent, name, sort_order)
        VALUES ($id, $min_spent, $discount_percent, $name, $sort_order)
      `, {
        '$id': ydb.TypedValues.uint64(id),
        '$min_spent': ydb.TypedValues.int32(tier.minSpent),
        '$discount_percent': ydb.TypedValues.int32(tier.discountPercent),
        '$name': ydb.TypedValues.utf8(tier.name || ""),
        '$sort_order': ydb.TypedValues.int32(tier.sortOrder || 0),
      });
    });
    return { id, ...tier } as LoyaltyTier;
  }

  async updateLoyaltyTier(id: number, updates: Partial<LoyaltyTier>): Promise<LoyaltyTier> {
    const setParts: string[] = [];
    const params: Record<string, any> = { '$id': ydb.TypedValues.uint64(id) };
    
    if (updates.minSpent !== undefined) { setParts.push('min_spent = $ms'); params['$ms'] = ydb.TypedValues.int32(updates.minSpent); }
    if (updates.discountPercent !== undefined) { setParts.push('discount_percent = $dp'); params['$dp'] = ydb.TypedValues.int32(updates.discountPercent); }
    if (updates.name !== undefined) { setParts.push('name = $name'); params['$name'] = ydb.TypedValues.utf8(updates.name!); }
    if (updates.sortOrder !== undefined) { setParts.push('sort_order = $so'); params['$so'] = ydb.TypedValues.int32(updates.sortOrder!); }
    
    if (setParts.length > 0) {
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Uint64;
          ${updates.minSpent !== undefined ? 'DECLARE $ms AS Int32;' : ''}
          ${updates.discountPercent !== undefined ? 'DECLARE $dp AS Int32;' : ''}
          ${updates.name !== undefined ? 'DECLARE $name AS Utf8;' : ''}
          ${updates.sortOrder !== undefined ? 'DECLARE $so AS Int32;' : ''}
          UPDATE loyalty_tiers SET ${setParts.join(', ')} WHERE id = $id
        `, params);
      });
    }
    const tiers = await this.getLoyaltyTiers();
    return tiers.find(t => t.id === id) as LoyaltyTier;
  }

  async deleteLoyaltyTier(id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM loyalty_tiers WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }

  // Newsletter subscriptions
  async getNewsletterSubscription(email: string): Promise<NewsletterSubscription | undefined> {
    if (!driver) return undefined;
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = "DECLARE $email AS Utf8; SELECT * FROM newsletter_subscriptions WHERE email = $email";
      const { resultSets } = await session.executeQuery(query, { $email: TypedValues.utf8(email) });
      return this.parseResultSet<NewsletterSubscription>(resultSets[0])[0];
    });
    return result ?? undefined;
  }

  async createNewsletterSubscription(sub: InsertNewsletterSubscription): Promise<NewsletterSubscription> {
    const id = Date.now();
    const now = new Date();
    if (!driver) throw new Error("Database not available");
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $email AS Utf8;
        DECLARE $promoCodeGiven AS Utf8;
        DECLARE $subscribedAt AS Timestamp;
        UPSERT INTO newsletter_subscriptions (id, email, promo_code_given, subscribed_at)
        VALUES ($id, $email, $promoCodeGiven, $subscribedAt);
      `;
      await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $email: TypedValues.utf8(sub.email),
        $promoCodeGiven: TypedValues.utf8(sub.promoCodeGiven || ""),
        $subscribedAt: TypedValues.timestamp(now),
      });
    });
    return { id, ...sub, subscribedAt: now } as NewsletterSubscription;
  }

  async getAllNewsletterSubscriptions(): Promise<NewsletterSubscription[]> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = "SELECT * FROM newsletter_subscriptions ORDER BY subscribed_at DESC LIMIT 1000";
      const { resultSets } = await session.executeQuery(query, {});
      return this.parseResultSet<NewsletterSubscription>(resultSets[0]);
    });
    return result || [];
  }

  async deleteNewsletterSubscription(id: number): Promise<boolean> {
    if (!driver) return false;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = "DECLARE $id AS Uint64; DELETE FROM newsletter_subscriptions WHERE id = $id";
      await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
      });
    });
    return true;
  }

  async addPreorderSubscriber(email: string, name?: string): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const id = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const query = `
        DECLARE $id AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $name AS Utf8;
        DECLARE $subscribed_at AS Utf8;
        DECLARE $is_active AS Bool;
        UPSERT INTO preorder_subscribers (id, email, name, subscribed_at, is_active)
        VALUES ($id, $email, $name, $subscribed_at, $is_active);
      `;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, id),
        $email: TypedValues.fromNative(Types.UTF8, email),
        $name: TypedValues.fromNative(Types.UTF8, name || ''),
        $subscribed_at: TypedValues.fromNative(Types.UTF8, now),
        $is_active: TypedValues.fromNative(Types.BOOL, true),
      });
    });
  }

  async getPreorderSubscriberByEmail(email: string): Promise<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean } | undefined> {
    if (!driver) return undefined;
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = "DECLARE $email AS Utf8; SELECT id, email, name, subscribed_at, is_active FROM preorder_subscribers WHERE email = $email LIMIT 1";
      const { resultSets } = await session.executeQuery(query, {
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
      const rows = resultSets[0]?.rows || [];
      if (!rows.length) return undefined;
      const row = rows[0];
      return {
        id: String(this.extractTypedValue(row.items![0]) || ''),
        email: String(this.extractTypedValue(row.items![1]) || ''),
        name: String(this.extractTypedValue(row.items![2]) || '') || undefined,
        subscribedAt: String(this.extractTypedValue(row.items![3]) || ''),
        isActive: Boolean(this.extractTypedValue(row.items![4])),
      };
    });
    return result || undefined;
  }

  async getAllPreorderSubscribers(): Promise<Array<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean }>> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = "SELECT id, email, name, subscribed_at, is_active FROM preorder_subscribers ORDER BY subscribed_at DESC";
      const { resultSets } = await session.executeQuery(query, {});
      const rows = resultSets[0]?.rows || [];
      return rows.map((row: any) => ({
        id: String(this.extractTypedValue(row.items[0]) || ''),
        email: String(this.extractTypedValue(row.items[1]) || ''),
        name: String(this.extractTypedValue(row.items[2]) || '') || undefined,
        subscribedAt: String(this.extractTypedValue(row.items[3]) || ''),
        isActive: Boolean(this.extractTypedValue(row.items[4])),
      }));
    });
    return result || [];
  }

  async updatePreorderSubscriberStatus(email: string, isActive: boolean): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $email AS Utf8;
        DECLARE $is_active AS Bool;
        UPDATE preorder_subscribers SET is_active = $is_active WHERE email = $email;
      `;
      await session.executeQuery(query, {
        $email: TypedValues.fromNative(Types.UTF8, email),
        $is_active: TypedValues.fromNative(Types.BOOL, isActive),
      });
    });
  }

  async getUsersWithLoyalty(): Promise<Array<{ id: number; name: string; email: string; totalSpent: number; loyaltyDiscount: number }>> {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = "SELECT id, name, email, total_spent, loyalty_discount FROM users WHERE role != 'wholesale' OR role IS NULL ORDER BY total_spent DESC LIMIT 100";
      const { resultSets } = await session.executeQuery(query, {});
      const rows = resultSets[0]?.rows || [];
      return rows.map((row: any) => ({
        id: Number(this.extractTypedValue(row.items[0])),
        name: String(this.extractTypedValue(row.items[1]) || ''),
        email: String(this.extractTypedValue(row.items[2]) || ''),
        totalSpent: Number(this.extractTypedValue(row.items[3]) || 0),
        loyaltyDiscount: Number(this.extractTypedValue(row.items[4]) || 0),
      }));
    });
    return result || [];
  }

  // Bonus settings
  async getBonusSetting(key: string): Promise<string | undefined> {
    if (!driver) return undefined;
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = "DECLARE $key AS Utf8; SELECT value FROM bonus_settings WHERE key = $key ORDER BY updated_at DESC LIMIT 1";
      const { resultSets } = await session.executeQuery(query, { $key: TypedValues.utf8(key) });
      const rs = resultSets[0];
      if (!rs.rows?.length) return undefined;
      return this.extractTypedValue(rs.rows[0].items![0]);
    });
    return result || undefined;
  }

  async setBonusSetting(key: string, value: string): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $key AS Utf8;
        DECLARE $value AS Utf8;
        DECLARE $updatedAt AS Datetime;
        UPSERT INTO bonus_settings (id, key, value, updated_at)
        VALUES ($id, $key, $value, $updatedAt);
      `;
      let hash = 5381;
      for (const char of key) {
        hash = ((hash << 5) + hash + char.charCodeAt(0)) & 0x7FFFFFFF;
      }
      const id = hash || 1;
      await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $key: TypedValues.utf8(key),
        $value: TypedValues.utf8(value),
        $updatedAt: TypedValues.datetime(new Date()),
      });
    });
  }

  async getAllBonusSettings(): Promise<Record<string, string>> {
    if (!driver) return {};
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT key, value FROM bonus_settings");
      return this.parseResultSet<any>(resultSets[0]);
    });
    const settings: Record<string, string> = {};
    (result || []).forEach(r => {
      settings[r.key] = r.value;
    });
    return settings;
  }

  async getPickupPoints(): Promise<PickupPoint[]> {
    const raw = await this.getBonusSetting("preorder_pickup_points");
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PickupPoint[];
    } catch {
      return [];
    }
  }

  async savePickupPoints(points: PickupPoint[]): Promise<void> {
    await this.setBonusSetting("preorder_pickup_points", JSON.stringify(points));
  }

  // User loyalty
  async updateUserTotalSpent(userId: number, amount: number): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = "DECLARE $id AS Utf8; DECLARE $amount AS Int32; UPDATE users SET total_spent = COALESCE(total_spent, 0) + $amount WHERE id = $id";
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $amount: TypedValues.int32(amount),
      });
    });
  }

  async recalculateUserLoyaltyDiscount(userId: number): Promise<number> {
    const { TypedValues, Types } = await import("ydb-sdk");
    // Get user's total spent
    const userData = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $id AS Utf8; SELECT total_spent FROM users WHERE id = $id LIMIT 1`,
        { '$id': TypedValues.fromNative(Types.UTF8, String(userId)) }
      );
      return this.parseResultSet<{ totalSpent: number }>(resultSets[0])[0];
    });
    const totalSpent = userData?.totalSpent || 0;
    console.log(`[Loyalty] User ${userId} totalSpent: ${totalSpent} (${totalSpent / 100} RUB)`);

    const tiers = await this.getLoyaltyTiers();
    console.log(`[Loyalty] Available tiers:`, tiers.map(t => `${t.name}: minSpent=${t.minSpent}, discount=${t.discountPercent}%`));
    let discount = 0;
    let matchedTier = '';
    for (const tier of tiers.sort((a, b) => b.minSpent - a.minSpent)) {
      if (totalSpent >= tier.minSpent) {
        discount = tier.discountPercent;
        matchedTier = tier.name ?? '';
        break;
      }
    }
    console.log(`[Loyalty] User ${userId} matched tier: "${matchedTier}", discount: ${discount}%`);

    // Update user's loyalty discount
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $discount AS Int32;
        UPDATE users SET loyalty_discount = $discount WHERE id = $id
      `, {
        '$id': TypedValues.fromNative(Types.UTF8, String(userId)),
        '$discount': ydb.TypedValues.int32(discount),
      });
    });

    return discount;
  }

  // Page settings
  async getPageSettings(pageName: string): Promise<Record<string, any>> {
    if (!driver) return {};
    const cached = pageSettingsCache.get(pageName);
    if (cached) {
      if (pageSettingsCache.isStale(pageName) && !pageSettingsCache.isRefreshing(pageName)) {
        pageSettingsCache.setRefreshing(pageName, true);
        console.log(`[Cache] STALE - pageSettings(${pageName}), refreshing in background`);
        this.fetchPageSettingsFromYdb(pageName).then(settings => {
          if (settings !== null) {
            pageSettingsCache.set(pageName, settings);
          } else {
            console.warn(`[Cache] pageSettings(${pageName}) YDB error on stale refresh — keeping old cache`);
          }
          pageSettingsCache.setRefreshing(pageName, false);
        }).catch(err => {
          pageSettingsCache.setRefreshing(pageName, false);
          console.error(`[Cache] pageSettings(${pageName}) refresh failed:`, err);
        });
      } else {
        console.log(`[Cache] HIT - pageSettings(${pageName})`);
      }
      return cached;
    }
    console.log(`[Cache] MISS - pageSettings(${pageName}), fetching from YDB`);
    const settings = await this.fetchPageSettingsFromYdb(pageName);
    if (settings !== null) {
      pageSettingsCache.set(pageName, settings);
      return settings;
    }
    // YDB error — не кешируем, чтобы следующий запрос повторил попытку
    console.warn(`[Cache] pageSettings(${pageName}) YDB error on MISS — returning {} without caching`);
    return {};
  }

  private async fetchPageSettingsFromYdb(pageName: string): Promise<Record<string, any> | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $page_name AS Utf8;
        SELECT section_id, settings FROM page_settings WHERE page_name = $page_name
      `;
      const { resultSets } = await session.executeQuery(query, {
        '$page_name': TypedValues.utf8(pageName),
      });
      const rows = resultSets[0]?.rows || [];
      const settings: Record<string, any> = {};
      for (const row of rows) {
        const sectionId = String(this.extractTypedValue(row.items![0]) || '');
        const settingsJson = this.extractTypedValue(row.items![1]);
        try {
          settings[sectionId] = typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson;
        } catch {
          settings[sectionId] = {};
        }
      }
      return settings;
    });
    // null = YDB error (BadSession, network, etc.), {} = success but no rows
    return result;
  }

  async setPageSectionSettings(pageName: string, sectionId: string, settings: any): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      // Check if exists
      const checkQuery = `
        DECLARE $page_name AS Utf8;
        DECLARE $section_id AS Utf8;
        SELECT id FROM page_settings WHERE page_name = $page_name AND section_id = $section_id LIMIT 1
      `;
      const { resultSets } = await session.executeQuery(checkQuery, {
        '$page_name': TypedValues.utf8(pageName),
        '$section_id': TypedValues.utf8(sectionId),
      });
      
      const existingId = resultSets[0]?.rows?.[0]?.items?.[0];
      const settingsJson = JSON.stringify(settings);
      const now = new Date();
      
      if (existingId) {
        const id = Number(this.extractTypedValue(existingId));
        const updateQuery = `
          DECLARE $id AS Uint64;
          DECLARE $settings AS Json;
          DECLARE $updated_at AS Timestamp;
          UPDATE page_settings SET settings = $settings, updated_at = $updated_at WHERE id = $id
        `;
        await session.executeQuery(updateQuery, {
          '$id': TypedValues.uint64(id),
          '$settings': TypedValues.json(settingsJson),
          '$updated_at': TypedValues.timestamp(now),
        });
      } else {
        const newId = Date.now();
        const insertQuery = `
          DECLARE $id AS Uint64;
          DECLARE $page_name AS Utf8;
          DECLARE $section_id AS Utf8;
          DECLARE $settings AS Json;
          DECLARE $updated_at AS Timestamp;
          UPSERT INTO page_settings (id, page_name, section_id, settings, updated_at)
          VALUES ($id, $page_name, $section_id, $settings, $updated_at)
        `;
        await session.executeQuery(insertQuery, {
          '$id': TypedValues.uint64(newId),
          '$page_name': TypedValues.utf8(pageName),
          '$section_id': TypedValues.utf8(sectionId),
          '$settings': TypedValues.json(settingsJson),
          '$updated_at': TypedValues.timestamp(now),
        });
      }
    });
    pageSettingsCache.delete(pageName);
    console.log(`[Cache] INVALIDATED - pageSettings(${pageName})`);
  }

  async deletePageSectionSettings(pageName: string, sectionId: string): Promise<void> {
    if (!driver) return;
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $page_name AS Utf8;
        DECLARE $section_id AS Utf8;
        DELETE FROM page_settings WHERE page_name = $page_name AND section_id = $section_id
      `;
      await session.executeQuery(query, {
        '$page_name': TypedValues.utf8(pageName),
        '$section_id': TypedValues.utf8(sectionId),
      });
    });
    pageSettingsCache.delete(pageName);
    console.log(`[Cache] INVALIDATED - pageSettings(${pageName}) after delete section ${sectionId}`);
  }

  // ============ REVIEWS METHODS ============

  async migrateReviewsTable(): Promise<{ success: boolean; message: string }> {
    if (!driver) {
      return { success: false, message: "YDB driver not initialized — migration skipped" };
    }
    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable('reviews', new ydb.TableDescription()
          .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column('product_id', ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column('user_id', ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column('author_name', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('rating', ydb.Types.optional(ydb.Types.INT32)))
          .withColumn(new ydb.Column('comment', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('is_approved', ydb.Types.optional(ydb.Types.BOOL)))
          .withColumn(new ydb.Column('created_at', ydb.Types.optional(ydb.Types.DATETIME)))
          .withPrimaryKey('id')
        );
      });
      return { success: true, message: "Reviews table created" };
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        return { success: true, message: "Reviews table already exists" };
      }
      console.error("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }

  async getReviewsByProduct(productId: number): Promise<Review[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $productId AS Uint64; SELECT * FROM reviews WHERE product_id = $productId AND is_approved = true ORDER BY created_at DESC`,
        { '$productId': ydb.TypedValues.uint64(productId) }
      );
      const rows = this.parseResultSet<Review>(resultSets[0]);
      return (rows || []).map(r => ({
        ...r,
        photos: r.photos ? (typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos) : [],
      }));
    });
    return result || [];
  }

  async getAllReviews(): Promise<Review[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM reviews ORDER BY created_at DESC`);
      return this.parseResultSet<Review>(resultSets[0]);
    });
    return result || [];
  }

  async createReview(review: InsertReview): Promise<Review> {
    const id = Date.now();
    const now = new Date();
    const photosJson = review.photos && (review.photos as unknown as any[]).length > 0
      ? JSON.stringify(review.photos)
      : null;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $product_id AS Uint64;
        DECLARE $user_id AS Optional<Uint64>;
        DECLARE $author_name AS Utf8;
        DECLARE $rating AS Int32;
        DECLARE $comment AS Optional<Utf8>;
        DECLARE $photos AS Optional<Utf8>;
        DECLARE $is_approved AS Bool;
        DECLARE $created_at AS Datetime;
        UPSERT INTO reviews (id, product_id, user_id, author_name, rating, comment, photos, is_approved, created_at)
        VALUES ($id, $product_id, $user_id, $author_name, $rating, $comment, $photos, $is_approved, $created_at)
      `, {
        '$id': ydb.TypedValues.uint64(id),
        '$product_id': ydb.TypedValues.uint64(review.productId),
        '$user_id': review.userId ? ydb.TypedValues.optional(ydb.TypedValues.uint64(review.userId)) : ydb.TypedValues.optionalNull(ydb.Types.UINT64),
        '$author_name': ydb.TypedValues.utf8(review.authorName),
        '$rating': ydb.TypedValues.int32(review.rating),
        '$comment': review.comment ? ydb.TypedValues.optional(ydb.TypedValues.utf8(review.comment)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8),
        '$photos': photosJson ? ydb.TypedValues.optional(ydb.TypedValues.utf8(photosJson)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8),
        '$is_approved': ydb.TypedValues.bool(false),
        '$created_at': ydb.TypedValues.datetime(now),
      });
    });
    return { id, ...review, photos: review.photos || [], isApproved: false, createdAt: now } as Review;
  }

  async updateReview(id: number, updates: Partial<Review>): Promise<Review> {
    const setParts: string[] = [];
    const params: Record<string, any> = { '$id': ydb.TypedValues.uint64(id) };

    if (updates.isApproved !== undefined) { setParts.push('is_approved = $is_approved'); params['$is_approved'] = ydb.TypedValues.bool(updates.isApproved!); }
    if (updates.comment !== undefined) { setParts.push('comment = $comment'); params['$comment'] = ydb.TypedValues.utf8(updates.comment || ''); }
    if (updates.rating !== undefined) { setParts.push('rating = $rating'); params['$rating'] = ydb.TypedValues.int32(updates.rating); }

    if (setParts.length > 0) {
      const declares = Object.entries(params).map(([k, v]) => {
        const type = k === '$id' ? 'Uint64' : k === '$is_approved' ? 'Bool' : k === '$rating' ? 'Int32' : 'Utf8';
        return `DECLARE ${k} AS ${type};`;
      }).join('\n');

      await this.safeQuery(async (session) => {
        await session.executeQuery(`${declares}\nUPDATE reviews SET ${setParts.join(', ')} WHERE id = $id`, params);
      });
    }
    const all = await this.getAllReviews();
    return all.find(r => r.id === id) as Review;
  }

  async deleteReview(id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM reviews WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }

  async createStockNotification(productId: number, productName: string, size: string, email: string): Promise<boolean> {
    const id = `sn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $product_id AS Int64;
        DECLARE $product_name AS Utf8;
        DECLARE $size AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $notified AS Bool;
        UPSERT INTO stock_notifications (id, product_id, product_name, size, email, created_at, notified)
        VALUES ($id, $product_id, $product_name, $size, $email, $created_at, $notified);
      `, {
        $id: TypedValues.fromNative(Types.UTF8, id),
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $product_name: TypedValues.fromNative(Types.UTF8, productName),
        $size: TypedValues.fromNative(Types.UTF8, size),
        $email: TypedValues.fromNative(Types.UTF8, email),
        $created_at: TypedValues.fromNative(Types.UTF8, new Date().toISOString()),
        $notified: TypedValues.fromNative(Types.BOOL, false),
      });
    });
    return true;
  }

  async getStockNotificationCount(productId: number, size?: string): Promise<number> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      let query = `
        DECLARE $product_id AS Int64;
        SELECT COUNT(*) AS cnt FROM stock_notifications
        WHERE product_id = $product_id AND notified = false
      `;
      const params: Record<string, any> = {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
      };
      if (size) {
        query = `
          DECLARE $product_id AS Int64;
          DECLARE $size AS Utf8;
          SELECT COUNT(*) AS cnt FROM stock_notifications
          WHERE product_id = $product_id AND size = $size AND notified = false
        `;
        params.$size = TypedValues.fromNative(Types.UTF8, size);
      }
      const { resultSets } = await session.executeQuery(query, params);
      const rs = resultSets[0];
      if (!rs.rows || rs.rows.length === 0) return 0;
      const row = rs.rows[0] as any;
      const val = row.items?.[0]?.uint64Value ?? row.items?.[0]?.int64Value ?? 0;
      return Number(val);
    });
    return result || 0;
  }

  async getUnnotifiedByProductAndSize(productId: number, size: string): Promise<Array<{ id: string; email: string }>> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $product_id AS Int64;
        DECLARE $size AS Utf8;
        SELECT id, email FROM stock_notifications
        WHERE product_id = $product_id AND size = $size AND notified = false
      `, {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $size: TypedValues.fromNative(Types.UTF8, size),
      });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return { id: String(data.id || ''), email: String(data.email || '') };
      });
    });
    return result || [];
  }

  async markStockNotificationsNotified(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date().toISOString();
    for (const id of ids) {
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Utf8;
          DECLARE $notified AS Bool;
          DECLARE $notified_at AS Utf8;
          UPDATE stock_notifications SET notified = $notified, notified_at = $notified_at WHERE id = $id;
        `, {
          $id: TypedValues.fromNative(Types.UTF8, id),
          $notified: TypedValues.fromNative(Types.BOOL, true),
          $notified_at: TypedValues.fromNative(Types.UTF8, now),
        });
      });
    }
  }

  async getAllStockNotifications(): Promise<Array<{ id: string; productId: string; productName: string; size: string; email: string; createdAt: string; notified: boolean; notifiedAt: string | null }>> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM stock_notifications ORDER BY created_at DESC");
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return {
          id: String(data.id || ''),
          productId: String(data.product_id || ''),
          productName: String(data.product_name || ''),
          size: String(data.size || ''),
          email: String(data.email || ''),
          createdAt: String(data.created_at || ''),
          notified: data.notified === true,
          notifiedAt: data.notified_at ? String(data.notified_at) : null,
        };
      });
    });
    return result || [];
  }

  // Price drop subscriptions
  private _priceDropTableReady = false;

  private async ensurePriceDropTable(): Promise<void> {
    if (this._priceDropTableReady || !driver) return;
    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable('price_drop_subscriptions', new ydb.TableDescription()
          .withColumn(new ydb.Column('id', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('product_id', ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column('product_name', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('email', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('price_at_subscription', ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column('created_at', ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column('notified', ydb.Types.optional(ydb.Types.BOOL)))
          .withColumn(new ydb.Column('notified_at', ydb.Types.optional(ydb.Types.UTF8)))
          .withPrimaryKey('id')
        );
      });
      this._priceDropTableReady = true;
      console.log("[YDB] price_drop_subscriptions table created");
    } catch (err: any) {
      if (err.message?.includes('already exists') || err.issues?.some((i: any) => i.message?.includes('already exists'))) {
        this._priceDropTableReady = true;
      } else {
        console.error("[PriceDrop] Failed to ensure table:", err.message);
      }
    }
  }

  async createPriceDropSubscription(productId: number, productName: string, email: string, priceAtSubscription: number): Promise<boolean> {
    await this.ensurePriceDropTable();
    const id = `pd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $product_id AS Int64;
        DECLARE $product_name AS Utf8;
        DECLARE $email AS Utf8;
        DECLARE $price AS Int64;
        DECLARE $created_at AS Utf8;
        DECLARE $notified AS Bool;
        UPSERT INTO price_drop_subscriptions (id, product_id, product_name, email, price_at_subscription, created_at, notified)
        VALUES ($id, $product_id, $product_name, $email, $price, $created_at, $notified);
      `, {
        $id: TypedValues.fromNative(Types.UTF8, id),
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $product_name: TypedValues.fromNative(Types.UTF8, productName),
        $email: TypedValues.fromNative(Types.UTF8, email),
        $price: TypedValues.fromNative(Types.INT64, priceAtSubscription),
        $created_at: TypedValues.fromNative(Types.UTF8, new Date().toISOString()),
        $notified: TypedValues.fromNative(Types.BOOL, false),
      });
    });
    return true;
  }

  async getSubscribedProductIdsByEmail(email: string): Promise<number[]> {
    await this.ensurePriceDropTable();
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $email AS Utf8;
        SELECT product_id FROM price_drop_subscriptions
        WHERE email = $email AND notified = false;
      `, {
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
      const rs = resultSets[0];
      if (!rs?.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return Number(data.product_id || 0);
      }).filter((id: number) => id > 0);
    });
    return result || [];
  }

  async checkPriceDropSubscription(productId: number, email: string): Promise<boolean> {
    await this.ensurePriceDropTable();
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $product_id AS Int64;
        DECLARE $email AS Utf8;
        SELECT id FROM price_drop_subscriptions
        WHERE product_id = $product_id AND email = $email AND notified = false LIMIT 1;
      `, {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
      const rs = resultSets[0];
      return rs?.rows && rs.rows.length > 0;
    });
    return result === true;
  }

  async getAllPriceDropSubscriptions(): Promise<Array<{ id: string; productId: string; productName: string; email: string; priceAtSubscription: number; createdAt: string; notified: boolean; notifiedAt: string | null }>> {
    await this.ensurePriceDropTable();
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        "SELECT * FROM price_drop_subscriptions ORDER BY created_at DESC"
      );
      const rs = resultSets[0];
      if (!rs?.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return {
          id: String(data.id || ''),
          productId: String(data.product_id || ''),
          productName: String(data.product_name || ''),
          email: String(data.email || ''),
          priceAtSubscription: Number(data.price_at_subscription || 0),
          createdAt: String(data.created_at || ''),
          notified: data.notified === true,
          notifiedAt: data.notified_at ? String(data.notified_at) : null,
        };
      });
    });
    return result || [];
  }

  async getPriceDropSubscribersByProduct(productId: number): Promise<Array<{ id: string; email: string; priceAtSubscription: number }>> {
    await this.ensurePriceDropTable();
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $product_id AS Int64;
        SELECT id, email, price_at_subscription FROM price_drop_subscriptions
        WHERE product_id = $product_id AND notified = false;
      `, {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
      });
      const rs = resultSets[0];
      if (!rs?.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return {
          id: String(data.id || ''),
          email: String(data.email || ''),
          priceAtSubscription: Number(data.price_at_subscription || 0),
        };
      });
    });
    return result || [];
  }

  async markPriceDropSubscriptionsNotified(ids: string[], newPrice: number): Promise<void> {
    if (ids.length === 0) return;
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date().toISOString();
    for (const id of ids) {
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Utf8;
          DECLARE $notified_at AS Utf8;
          DECLARE $new_price AS Int64;
          UPDATE price_drop_subscriptions
          SET notified = false, notified_at = $notified_at, price_at_subscription = $new_price
          WHERE id = $id;
        `, {
          $id: TypedValues.fromNative(Types.UTF8, id),
          $notified_at: TypedValues.fromNative(Types.UTF8, now),
          $new_price: TypedValues.fromNative(Types.INT64, newPrice),
        });
      });
    }
  }

  async getPriceDropSubscriptionsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; priceAtSubscription: number; createdAt: string }>> {
    await this.ensurePriceDropTable();
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $email AS Utf8;
        SELECT id, product_id, product_name, price_at_subscription, created_at
        FROM price_drop_subscriptions
        WHERE email = $email AND notified = false
        ORDER BY created_at DESC;
      `, {
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
      const rs = resultSets[0];
      if (!rs?.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return {
          id: String(data.id || ''),
          productId: Number(data.product_id || 0),
          productName: String(data.product_name || ''),
          priceAtSubscription: Number(data.price_at_subscription || 0),
          createdAt: String(data.created_at || ''),
        };
      });
    });
    return result || [];
  }

  async deletePriceDropSubscription(productId: number, email: string): Promise<void> {
    await this.ensurePriceDropTable();
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $product_id AS Int64;
        DECLARE $email AS Utf8;
        DELETE FROM price_drop_subscriptions
        WHERE product_id = $product_id AND email = $email;
      `, {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
    });
  }

  async getStockNotificationsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; size: string; createdAt: string }>> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $email AS Utf8;
        SELECT id, product_id, product_name, size, created_at
        FROM stock_notifications
        WHERE email = $email AND notified = false
        ORDER BY created_at DESC;
      `, {
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
      const rs = resultSets[0];
      if (!rs?.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        return {
          id: String(data.id || ''),
          productId: Number(data.product_id || 0),
          productName: String(data.product_name || ''),
          size: String(data.size || ''),
          createdAt: String(data.created_at || ''),
        };
      });
    });
    return result || [];
  }

  async deleteStockNotification(productId: number, size: string, email: string): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $product_id AS Int64;
        DECLARE $size AS Utf8;
        DECLARE $email AS Utf8;
        DELETE FROM stock_notifications
        WHERE product_id = $product_id AND size = $size AND email = $email;
      `, {
        $product_id: TypedValues.fromNative(Types.INT64, productId),
        $size: TypedValues.fromNative(Types.UTF8, size),
        $email: TypedValues.fromNative(Types.UTF8, email),
      });
    });
  }

  async saveChatMessage(msg: { messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; tgMessageId?: number; vkMessageId?: number; imageUrl?: string }): Promise<void> {
    const ydb = await import("ydb-sdk");
    const { TypedValues, Types } = ydb;
    const result = await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $message_id AS Utf8;
        DECLARE $session_id AS Utf8;
        DECLARE $sender AS Utf8;
        DECLARE $text AS Utf8;
        DECLARE $timestamp AS Int64;
        DECLARE $user_id AS Optional<Utf8>;
        DECLARE $user_name AS Optional<Utf8>;
        DECLARE $tg_message_id AS Optional<Int64>;
        DECLARE $vk_message_id AS Optional<Int64>;
        DECLARE $image_url AS Optional<Utf8>;
        UPSERT INTO chat_messages (message_id, session_id, sender, text, timestamp, user_id, user_name, tg_message_id, vk_message_id, image_url)
        VALUES ($message_id, $session_id, $sender, $text, $timestamp, $user_id, $user_name, $tg_message_id, $vk_message_id, $image_url);
      `, {
        $message_id: TypedValues.utf8(msg.messageId),
        $session_id: TypedValues.utf8(msg.sessionId),
        $sender: TypedValues.utf8(msg.sender),
        $text: TypedValues.utf8(msg.text),
        $timestamp: TypedValues.int64(msg.timestamp),
        $user_id: msg.userId ? TypedValues.optional(TypedValues.utf8(msg.userId)) : TypedValues.optionalNull(Types.UTF8),
        $user_name: msg.userName ? TypedValues.optional(TypedValues.utf8(msg.userName)) : TypedValues.optionalNull(Types.UTF8),
        $tg_message_id: msg.tgMessageId ? TypedValues.optional(TypedValues.int64(msg.tgMessageId)) : TypedValues.optionalNull(Types.INT64),
        $vk_message_id: msg.vkMessageId ? TypedValues.optional(TypedValues.int64(msg.vkMessageId)) : TypedValues.optionalNull(Types.INT64),
        $image_url: msg.imageUrl ? TypedValues.optional(TypedValues.utf8(msg.imageUrl)) : TypedValues.optionalNull(Types.UTF8),
      });
      return true;
    });
    if (!result) {
      console.error("[Chat] saveChatMessage: safeQuery returned null (driver not ready or query failed)");
    } else {
      console.log(`[Chat] Saved message ${msg.messageId.slice(0, 8)} for session ${msg.sessionId.slice(0, 8)}`);
    }
  }

  async getChatMessages(sessionId: string, since?: number): Promise<Array<{ messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; imageUrl?: string }>> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      if (since) {
        const qr = await session.executeQuery(`
          DECLARE $session_id AS Utf8;
          DECLARE $since AS Int64;
          SELECT message_id, session_id, sender, text, timestamp, user_id, user_name, image_url
          FROM chat_messages
          WHERE session_id = $session_id AND timestamp > $since;
        `, {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
          $since: TypedValues.fromNative(Types.INT64, since),
        });
        return qr.resultSets[0]?.rows || [];
      } else {
        const qr = await session.executeQuery(`
          DECLARE $session_id AS Utf8;
          SELECT message_id, session_id, sender, text, timestamp, user_id, user_name, image_url
          FROM chat_messages
          WHERE session_id = $session_id;
        `, {
          $session_id: TypedValues.fromNative(Types.UTF8, sessionId),
        });
        return qr.resultSets[0]?.rows || [];
      }
    });
    if (!result) return [];
    return result
      .map((row: any) => ({
        messageId: String(this.extractTypedValue(row.items[0]) ?? ''),
        sessionId: String(this.extractTypedValue(row.items[1]) ?? ''),
        sender: String(this.extractTypedValue(row.items[2]) ?? ''),
        text: String(this.extractTypedValue(row.items[3]) ?? ''),
        timestamp: Number(this.extractTypedValue(row.items[4]) ?? 0),
        userId: String(this.extractTypedValue(row.items[5]) ?? '') || undefined,
        userName: String(this.extractTypedValue(row.items[6]) ?? '') || undefined,
        imageUrl: String(this.extractTypedValue(row.items[7]) ?? '') || undefined,
      }))
      .filter(m => m.text || m.imageUrl)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getSessionIdByTgMessageId(tgMessageId: number): Promise<string | null> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const qr = await session.executeQuery(`
        DECLARE $tg_message_id AS Optional<Int64>;
        SELECT session_id FROM chat_messages
        WHERE tg_message_id = $tg_message_id
        LIMIT 1;
      `, {
        $tg_message_id: TypedValues.optional(TypedValues.int64(tgMessageId)),
      });
      return qr.resultSets[0]?.rows || [];
    });
    if (!result || result.length === 0) return null;
    return String(this.extractTypedValue(result[0].items![0]) ?? '') || null;
  }

  async getSessionIdByVkMessageId(vkMessageId: number): Promise<string | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const qr = await session.executeQuery(`
        DECLARE $vk_message_id AS Optional<Int64>;
        SELECT session_id FROM chat_messages
        WHERE vk_message_id = $vk_message_id
        LIMIT 1;
      `, {
        $vk_message_id: TypedValues.optional(TypedValues.int64(vkMessageId)),
      });
      return qr.resultSets[0]?.rows || [];
    });
    if (!result || result.length === 0) return null;
    return String(this.extractTypedValue(result[0].items![0]) ?? '') || null;
  }

  async debugChatTable(): Promise<{ rowCount: number; sampleRows: any[] }> {
    const result = await this.safeQuery(async (session) => {
      const qr = await session.executeQuery(`SELECT message_id, session_id, sender, text, timestamp FROM chat_messages LIMIT 10;`);
      return qr.resultSets[0]?.rows || [];
    });
    if (!result) return { rowCount: 0, sampleRows: [] };
    const rows = result.map((row: any) => ({
      messageId: String(this.extractTypedValue(row.items[0]) ?? ''),
      sessionId: String(this.extractTypedValue(row.items[1]) ?? ''),
      sender: String(this.extractTypedValue(row.items[2]) ?? ''),
      text: String(this.extractTypedValue(row.items[3]) ?? ''),
      timestamp: Number(this.extractTypedValue(row.items[4]) ?? 0),
    }));
    return { rowCount: rows.length, sampleRows: rows };
  }

  async getChatSessions(): Promise<Array<{ sessionId: string; lastMessage: string; lastTimestamp: number; userName?: string; unread?: number }>> {
    const result = await this.safeQuery(async (session) => {
      const qr = await session.executeQuery(`
        SELECT session_id, text, timestamp, user_name, sender
        FROM chat_messages;
      `);
      return qr.resultSets[0]?.rows || [];
    });
    if (!result) return [];
    const sessMap: Record<string, { sessionId: string; lastMessage: string; lastTimestamp: number; userName?: string; unread: number }> = {};
    for (const row of result) {
      const sid = String(this.extractTypedValue(row.items![0]) ?? '');
      const text = String(this.extractTypedValue(row.items![1]) ?? '');
      const ts = Number(this.extractTypedValue(row.items![2]) ?? 0);
      const userName = String(this.extractTypedValue(row.items![3]) ?? '') || undefined;
      const sender = String(this.extractTypedValue(row.items![4]) ?? '');
      if (!sid) continue;
      if (!sessMap[sid]) {
        sessMap[sid] = { sessionId: sid, lastMessage: text, lastTimestamp: ts, userName, unread: 0 };
      } else if (ts > sessMap[sid].lastTimestamp) {
        sessMap[sid].lastMessage = text;
        sessMap[sid].lastTimestamp = ts;
        if (!sessMap[sid].userName && userName) sessMap[sid].userName = userName;
      }
      if (sender === 'client') sessMap[sid].unread++;
    }
    return Object.values(sessMap).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }

  // ==================== Wholesale XML Feed ====================

  async getWholesaleFeedProductIds(userId: number): Promise<number[]> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $user_id AS Utf8;
        SELECT product_id FROM wholesale_feed_products WHERE user_id = $user_id;
      `, {
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns || []);
        const pid = data.product_id;
        const n = typeof pid === "string" ? parseInt(pid, 10) : Number(pid);
        return Number.isFinite(n) ? n : 0;
      }).filter((n: number) => n > 0);
    });
    return result || [];
  }

  async addWholesaleFeedProduct(userId: number, productId: number): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${userId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $user_id AS Utf8;
        DECLARE $product_id AS Utf8;
        DECLARE $created_at AS Timestamp;
        UPSERT INTO wholesale_feed_products (id, user_id, product_id, created_at)
        VALUES ($id, $user_id, $product_id, $created_at);
      `, {
        $id: TypedValues.fromNative(Types.UTF8, id),
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $product_id: TypedValues.fromNative(Types.UTF8, String(productId)),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
    });
  }

  async removeWholesaleFeedProduct(userId: number, productId: number): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${userId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DELETE FROM wholesale_feed_products WHERE id = $id;
      `, {
        $id: TypedValues.fromNative(Types.UTF8, id),
      });
    });
  }

  async getOrCreateWholesaleFeedToken(userId: number): Promise<string> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const existing = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $user_id AS Utf8;
        SELECT token FROM wholesale_feed_tokens WHERE user_id = $user_id;
      `, {
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
      });
      const rs = resultSets[0];
      if (!rs.rows || rs.rows.length === 0 || !rs.columns) return null;
      const data = this.parseRowWithColumns(rs.rows[0], rs.columns || []);
      return data.token ? String(data.token) : null;
    });
    if (existing) return existing;

    const token = `wf_${userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $user_id AS Utf8;
        DECLARE $token AS Utf8;
        DECLARE $created_at AS Timestamp;
        UPSERT INTO wholesale_feed_tokens (user_id, token, created_at)
        VALUES ($user_id, $token, $created_at);
      `, {
        $user_id: TypedValues.fromNative(Types.UTF8, String(userId)),
        $token: TypedValues.fromNative(Types.UTF8, token),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
    });
    return token;
  }

  async getUserIdByWholesaleFeedToken(token: string): Promise<number | null> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $token AS Utf8;
        SELECT user_id FROM wholesale_feed_tokens WHERE token = $token;
      `, {
        $token: TypedValues.fromNative(Types.UTF8, token),
      });
      const rs = resultSets[0];
      if (!rs.rows || rs.rows.length === 0 || !rs.columns) return null;
      const data = this.parseRowWithColumns(rs.rows[0], rs.columns || []);
      const uid = data.user_id;
      const n = typeof uid === "string" ? parseInt(uid, 10) : Number(uid);
      return Number.isFinite(n) ? n : null;
    });
    return result;
  }

  // ====================== Partners ======================

  private mapPartnerRow(data: Record<string, any>): Partner {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      // YDB Date может возвращаться как кол-во дней с эпохи (число) — переводим в мс.
      if (typeof v === "number" && v > 0 && v < 100000) {
        return new Date(v * 86400000);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const s = (v: any) => (v === null || v === undefined ? null : String(v));
    return {
      id: toNum(data.id),
      userId: toNum(data.user_id),
      partnerSlug: String(data.partner_slug || ""),
      storeName: String(data.store_name || ""),
      contactName: String(data.contact_name || ""),
      contactEmail: String(data.contact_email || ""),
      contactPhone: data.contact_phone ? String(data.contact_phone) : null,
      status: String(data.status || "pending"),
      commissionOverride: data.commission_override === null || data.commission_override === undefined ? null : toNum(data.commission_override),
      clicksCount: toNum(data.clicks_count),
      totalEarned: toNum(data.total_earned),
      payoutRequested: Boolean(data.payout_requested),
      createdAt: toDate(data.created_at),
      approvedAt: toDate(data.approved_at),
      // Реквизиты выплат
      payoutMethod: s(data.payout_method),
      payoutDetails: s(data.payout_details),
      payoutFullName: s(data.payout_full_name),
      payoutInn: s(data.payout_inn),
      payoutLegalStatus: s(data.payout_legal_status),
      // KYC
      legalStatus: s(data.legal_status),
      lastName: s(data.last_name),
      firstName: s(data.first_name),
      middleName: s(data.middle_name),
      inn: s(data.inn),
      birthDate: toDate(data.birth_date),
      citizenship: s(data.citizenship),
      platformDescription: s(data.platform_description),
      // Банк
      bankAccount: s(data.bank_account),
      bankBik: s(data.bank_bik),
      bankName: s(data.bank_name),
      bankCorrAccount: s(data.bank_corr_account),
      // Согласия
      offerAcceptedAt: toDate(data.offer_accepted_at),
      offerVersion: s(data.offer_version),
      privacyAcceptedAt: toDate(data.privacy_accepted_at),
      privacyVersion: s(data.privacy_version),
      selfEmployedAcceptedAt: toDate(data.self_employed_accepted_at),
      selfEmployedVersion: s(data.self_employed_version),
      adultAcceptedAt: toDate(data.adult_accepted_at),
      adultVersion: s(data.adult_version),
      marketingAcceptedAt: toDate(data.marketing_accepted_at),
      marketingVersion: s(data.marketing_version),
      consentIp: s(data.consent_ip),
      consentRemoteIp: s(data.consent_remote_ip),
      consentCountry: s(data.consent_country),
      consentRegion: s(data.consent_region),
      consentCity: s(data.consent_city),
      consentUserAgent: s(data.consent_user_agent),
      consentSignedAt: toDate(data.consent_signed_at),
      // Реквизиты ИП/ЮЛ
      companyName: s(data.company_name),
      kpp: s(data.kpp),
      ogrn: s(data.ogrn),
      legalAddress: s(data.legal_address),
      signerPosition: s(data.signer_position),
      signerBasis: s(data.signer_basis),
      // Хэши документов
      offerHash: s(data.offer_hash),
      privacyHash: s(data.privacy_hash),
      adultHash: s(data.adult_hash),
      selfEmployedHash: s(data.self_employed_hash),
      marketingHash: s(data.marketing_hash),
      isArtist: Boolean(data.is_artist) || false,
      artistRate: data.artist_rate !== null && data.artist_rate !== undefined ? Number(data.artist_rate) : null,
    } as Partner;
  }

  private mapCommissionRow(data: Record<string, any>): PartnerCommission {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    return {
      id: toNum(data.id),
      partnerId: toNum(data.partner_id),
      orderId: toNum(data.order_id),
      orderItemsTotal: toNum(data.order_items_total),
      commissionPercent: toNum(data.commission_percent),
      commissionAmount: toNum(data.commission_amount),
      status: String(data.status || "pending"),
      confirmedAt: toDate(data.confirmed_at),
      paidAt: toDate(data.paid_at),
      holdUntil: toDate(data.hold_until),
      createdAt: toDate(data.created_at),
      commissionType: data.commission_type ? String(data.commission_type) : null,
    } as PartnerCommission;
  }

  private mapPartnerPayoutRow(data: Record<string, any>): PartnerPayout {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const toStrOrNull = (v: any): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v);
      return s.length === 0 ? null : s;
    };
    // Старые записи могут не иметь status — считаем их "awaiting_invoice"
    // (новый дефолт по схеме). Это безопасно: переходы по статусам всё равно
    // проверяются в endpoints, и у старых записей нет invoice_url.
    const status = toStrOrNull(data.status) || "awaiting_invoice";
    return {
      id: toNum(data.id),
      partnerId: toNum(data.partner_id),
      amount: toNum(data.amount),
      commissionCount: toNum(data.commission_count),
      commissionIds: data.commission_ids ? String(data.commission_ids) : "[]",
      method: String(data.method || ""),
      recipientName: String(data.recipient_name || ""),
      recipientDetails: String(data.recipient_details || ""),
      note: data.note ? String(data.note) : null,
      createdBy: data.created_by ? String(data.created_by) : null,
      createdAt: toDate(data.created_at),
      status,
      invoiceUrl: toStrOrNull(data.invoice_url),
      invoiceUploadedAt: toDate(data.invoice_uploaded_at),
      invoiceNumber: toStrOrNull(data.invoice_number),
      paidAt: toDate(data.paid_at),
      paidReference: toStrOrNull(data.paid_reference),
      receiptUrl: toStrOrNull(data.receipt_url),
      receiptUploadedAt: toDate(data.receipt_uploaded_at),
      receiptNumber: toStrOrNull(data.receipt_number),
      // Поля акта (ИП/ЮЛ) — null-safe для старых записей без этих колонок
      actUrl: toStrOrNull(data.act_url),
      actUploadedAt: toDate(data.act_uploaded_at),
      actNumber: toStrOrNull(data.act_number),
      completedAt: toDate(data.completed_at),
      rejectedReason: toStrOrNull(data.rejected_reason),
    } as PartnerPayout;
  }

  async createPartner(
    data: InsertPartner,
    signatures?: Array<Omit<InsertConsentSignature, "partnerId">>,
  ): Promise<Partner> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date();

    const optStr = (v: any) => (v === null || v === undefined || v === "" ? TypedValues.optionalNull(Types.UTF8) : TypedValues.optional(TypedValues.utf8(String(v))));
    const optDate = (v: any) => {
      if (v === null || v === undefined || v === "") return TypedValues.optionalNull(Types.TIMESTAMP);
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return TypedValues.optionalNull(Types.TIMESTAMP);
      return TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, d));
    };
    // YDB Date — это «дата без времени», колонка birth_date в проде имеет тип Date.
    const optDateOnly = (v: any) => {
      if (v === null || v === undefined || v === "") return TypedValues.optionalNull(Types.DATE);
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return TypedValues.optionalNull(Types.DATE);
      // Нормализуем до UTC-полуночи дня — так YDB корректно расценит как Date.
      const dateOnly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return TypedValues.optional(TypedValues.fromNative(Types.DATE, dateOnly));
    };

    // ─────────────────────────────────────────────────────────────────────
    // Атомарная транзакция: партнёр + строки журнала consent_signatures
    // в одном executeQuery. YDB неявно выполняет все UPSERT в одной
    // serializableReadWrite-транзакции с автокоммитом — либо применятся
    // все, либо ни один. Это закрывает дыру, когда партнёр был создан,
    // а журнал подписей оставался пуст из-за silently-caught ошибки.
    // ─────────────────────────────────────────────────────────────────────
    const sigs = signatures ?? [];
    const sigDeclares: string[] = [];
    const sigUpserts: string[] = [];
    const sigParams: Record<string, any> = {};
    sigs.forEach((sig, i) => {
      const sigId = `${Date.now()}_${i}_${Math.floor(Math.random() * 1e6)}`;
      const signedAtVal = sig.signedAt instanceof Date ? sig.signedAt : new Date(sig.signedAt as any);
      const p = (k: string) => `$sig_${i}_${k}`;
      sigDeclares.push(
        `DECLARE ${p("id")} AS Utf8;`,
        `DECLARE ${p("partner_id")} AS Uint64;`,
        `DECLARE ${p("document_id")} AS Utf8;`,
        `DECLARE ${p("document_slug")} AS Utf8;`,
        `DECLARE ${p("document_version")} AS Utf8;`,
        `DECLARE ${p("document_hash")} AS Utf8;`,
        `DECLARE ${p("signed_at")} AS Timestamp;`,
        `DECLARE ${p("ip")} AS Utf8;`,
        // Anti-spoof (30.04.2026): nullable, чтобы не сломать при отсутствии socket-адреса
        `DECLARE ${p("remote_ip")} AS Utf8?;`,
        // GeoIP (30.04.2026): страна/регион/город для фиксации юрисдикции
        `DECLARE ${p("consent_country")} AS Utf8?;`,
        `DECLARE ${p("consent_region")} AS Utf8?;`,
        `DECLARE ${p("consent_city")} AS Utf8?;`,
        `DECLARE ${p("user_agent")} AS Utf8;`,
        `DECLARE ${p("method")} AS Utf8;`,
      );
      sigUpserts.push(
        `UPSERT INTO consent_signatures
          (id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method)
         VALUES
          (${p("id")}, ${p("partner_id")}, ${p("document_id")}, ${p("document_slug")}, ${p("document_version")}, ${p("document_hash")}, ${p("signed_at")}, ${p("ip")}, ${p("remote_ip")}, ${p("consent_country")}, ${p("consent_region")}, ${p("consent_city")}, ${p("user_agent")}, ${p("method")});`,
      );
      sigParams[p("id")] = TypedValues.utf8(sigId);
      sigParams[p("partner_id")] = TypedValues.uint64(id);
      sigParams[p("document_id")] = TypedValues.utf8(sig.documentId);
      sigParams[p("document_slug")] = TypedValues.utf8(sig.documentSlug);
      sigParams[p("document_version")] = TypedValues.utf8(sig.documentVersion);
      sigParams[p("document_hash")] = TypedValues.utf8(sig.documentHash);
      sigParams[p("signed_at")] = TypedValues.fromNative(Types.TIMESTAMP, signedAtVal);
      sigParams[p("ip")] = TypedValues.utf8(sig.ip);
      sigParams[p("remote_ip")] = (sig as any).remoteIp
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).remoteIp)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_country")] = (sig as any).geoCountry
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoCountry)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_region")] = (sig as any).geoRegion
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoRegion)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("consent_city")] = (sig as any).geoCity
        ? TypedValues.optional(TypedValues.utf8(String((sig as any).geoCity)))
        : TypedValues.optionalNull(Types.UTF8);
      sigParams[p("user_agent")] = TypedValues.utf8(sig.userAgent);
      sigParams[p("method")] = TypedValues.utf8(sig.method || "checkbox");
    });

    const txResult = await this.safeQuery(async (session) => {
      await session.executeQuery(`
        ${sigDeclares.join("\n        ")}
        DECLARE $id AS Uint64;
        DECLARE $user_id AS Uint64;
        DECLARE $partner_slug AS Utf8;
        DECLARE $store_name AS Utf8;
        DECLARE $contact_name AS Utf8;
        DECLARE $contact_email AS Utf8;
        DECLARE $contact_phone AS Utf8?;
        DECLARE $status AS Utf8;
        DECLARE $commission_override AS Int32?;
        DECLARE $clicks_count AS Int32;
        DECLARE $total_earned AS Int64;
        DECLARE $payout_requested AS Bool;
        DECLARE $created_at AS Timestamp;
        DECLARE $legal_status AS Utf8?;
        DECLARE $last_name AS Utf8?;
        DECLARE $first_name AS Utf8?;
        DECLARE $middle_name AS Utf8?;
        DECLARE $inn AS Utf8?;
        DECLARE $birth_date AS Date?;
        DECLARE $citizenship AS Utf8?;
        DECLARE $platform_description AS Utf8?;
        DECLARE $bank_account AS Utf8?;
        DECLARE $bank_bik AS Utf8?;
        DECLARE $bank_name AS Utf8?;
        DECLARE $bank_corr_account AS Utf8?;
        DECLARE $offer_accepted_at AS Timestamp?;
        DECLARE $offer_version AS Utf8?;
        DECLARE $privacy_accepted_at AS Timestamp?;
        DECLARE $privacy_version AS Utf8?;
        DECLARE $self_employed_accepted_at AS Timestamp?;
        DECLARE $self_employed_version AS Utf8?;
        DECLARE $adult_accepted_at AS Timestamp?;
        DECLARE $adult_version AS Utf8?;
        DECLARE $marketing_accepted_at AS Timestamp?;
        DECLARE $marketing_version AS Utf8?;
        DECLARE $consent_ip AS Utf8?;
        DECLARE $consent_remote_ip AS Utf8?;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $consent_user_agent AS Utf8?;
        DECLARE $consent_signed_at AS Timestamp?;
        DECLARE $company_name AS Utf8?;
        DECLARE $kpp AS Utf8?;
        DECLARE $ogrn AS Utf8?;
        DECLARE $legal_address AS Utf8?;
        DECLARE $signer_position AS Utf8?;
        DECLARE $signer_basis AS Utf8?;
        DECLARE $offer_hash AS Utf8?;
        DECLARE $privacy_hash AS Utf8?;
        DECLARE $adult_hash AS Utf8?;
        DECLARE $self_employed_hash AS Utf8?;
        DECLARE $marketing_hash AS Utf8?;
        DECLARE $is_artist AS Bool?;
        UPSERT INTO partners
          (id, user_id, partner_slug, store_name, contact_name, contact_email, contact_phone,
           status, commission_override, clicks_count, total_earned, payout_requested, created_at,
           legal_status, last_name, first_name, middle_name, inn, birth_date, citizenship, platform_description,
           bank_account, bank_bik, bank_name, bank_corr_account,
           offer_accepted_at, offer_version, privacy_accepted_at, privacy_version,
           self_employed_accepted_at, self_employed_version, adult_accepted_at, adult_version,
           marketing_accepted_at, marketing_version,
           consent_ip, consent_remote_ip, consent_country, consent_region, consent_city, consent_user_agent, consent_signed_at,
           company_name, kpp, ogrn, legal_address, signer_position, signer_basis,
           offer_hash, privacy_hash, adult_hash, self_employed_hash, marketing_hash,
           is_artist)
        VALUES
          ($id, $user_id, $partner_slug, $store_name, $contact_name, $contact_email, $contact_phone,
           $status, $commission_override, $clicks_count, $total_earned, $payout_requested, $created_at,
           $legal_status, $last_name, $first_name, $middle_name, $inn, $birth_date, $citizenship, $platform_description,
           $bank_account, $bank_bik, $bank_name, $bank_corr_account,
           $offer_accepted_at, $offer_version, $privacy_accepted_at, $privacy_version,
           $self_employed_accepted_at, $self_employed_version, $adult_accepted_at, $adult_version,
           $marketing_accepted_at, $marketing_version,
           $consent_ip, $consent_remote_ip, $consent_country, $consent_region, $consent_city, $consent_user_agent, $consent_signed_at,
           $company_name, $kpp, $ogrn, $legal_address, $signer_position, $signer_basis,
           $offer_hash, $privacy_hash, $adult_hash, $self_employed_hash, $marketing_hash,
           $is_artist);
        ${sigUpserts.join("\n        ")}
      `, {
        ...sigParams,
        $id: TypedValues.uint64(id),
        $user_id: TypedValues.uint64(data.userId),
        $partner_slug: TypedValues.utf8(data.partnerSlug),
        $store_name: TypedValues.utf8(data.storeName),
        $contact_name: TypedValues.utf8(data.contactName),
        $contact_email: TypedValues.utf8(data.contactEmail),
        $contact_phone: data.contactPhone ? TypedValues.optional(TypedValues.utf8(data.contactPhone)) : TypedValues.optionalNull(Types.UTF8),
        $status: TypedValues.utf8("pending"),
        $commission_override: data.commissionOverride !== null && data.commissionOverride !== undefined
          ? TypedValues.optional(TypedValues.int32(data.commissionOverride))
          : TypedValues.optionalNull(Types.INT32),
        $clicks_count: TypedValues.int32(0),
        $total_earned: TypedValues.int64(0),
        $payout_requested: TypedValues.bool(false),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $legal_status: optStr((data as any).legalStatus),
        $last_name: optStr((data as any).lastName),
        $first_name: optStr((data as any).firstName),
        $middle_name: optStr((data as any).middleName),
        $inn: optStr((data as any).inn),
        $birth_date: optDateOnly((data as any).birthDate),
        $citizenship: optStr((data as any).citizenship),
        $platform_description: optStr((data as any).platformDescription),
        $bank_account: optStr((data as any).bankAccount),
        $bank_bik: optStr((data as any).bankBik),
        $bank_name: optStr((data as any).bankName),
        $bank_corr_account: optStr((data as any).bankCorrAccount),
        $offer_accepted_at: optDate((data as any).offerAcceptedAt),
        $offer_version: optStr((data as any).offerVersion),
        $privacy_accepted_at: optDate((data as any).privacyAcceptedAt),
        $privacy_version: optStr((data as any).privacyVersion),
        $self_employed_accepted_at: optDate((data as any).selfEmployedAcceptedAt),
        $self_employed_version: optStr((data as any).selfEmployedVersion),
        $adult_accepted_at: optDate((data as any).adultAcceptedAt),
        $adult_version: optStr((data as any).adultVersion),
        $marketing_accepted_at: optDate((data as any).marketingAcceptedAt),
        $marketing_version: optStr((data as any).marketingVersion),
        $consent_ip: optStr((data as any).consentIp),
        $consent_remote_ip: optStr((data as any).consentRemoteIp),
        $consent_country: optStr((data as any).consentCountry),
        $consent_region: optStr((data as any).consentRegion),
        $consent_city: optStr((data as any).consentCity),
        $consent_user_agent: optStr((data as any).consentUserAgent),
        $consent_signed_at: optDate((data as any).consentSignedAt),
        $company_name: optStr((data as any).companyName),
        $kpp: optStr((data as any).kpp),
        $ogrn: optStr((data as any).ogrn),
        $legal_address: optStr((data as any).legalAddress),
        $signer_position: optStr((data as any).signerPosition),
        $signer_basis: optStr((data as any).signerBasis),
        $offer_hash: optStr((data as any).offerHash),
        $privacy_hash: optStr((data as any).privacyHash),
        $adult_hash: optStr((data as any).adultHash),
        $self_employed_hash: optStr((data as any).selfEmployedHash),
        $marketing_hash: optStr((data as any).marketingHash),
        $is_artist: TypedValues.optional(TypedValues.fromNative(Types.BOOL, Boolean((data as any).isArtist))),
      });
      return true;
    });
    // safeQuery возвращает null, если транзакция не выполнилась после всех retry
    // или если драйвер недоступен. Раньше код в этом случае шёл дальше и возвращал
    // «фейкового» партнёра — теперь явная ошибка, чтобы вызывающий маршрут отдал 500
    // и не было «полупартнёров» в системе.
    if (txResult !== true) {
      throw new Error("createPartner: транзакция не выполнена (БД недоступна)");
    }
    // Возвращаем созданного партнёра (читаем из БД, чтобы получить все актуальные поля)
    const created = await this.getPartnerById(id);
    return created || ({
      id,
      userId: data.userId,
      partnerSlug: data.partnerSlug,
      storeName: data.storeName,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone ?? null,
      status: "pending",
      commissionOverride: data.commissionOverride ?? null,
      clicksCount: 0,
      totalEarned: 0,
      payoutRequested: false,
      createdAt: now,
      approvedAt: null,
    } as Partner);
  }

  async getPartnerById(id: number): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT * FROM partners WHERE id = $id;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }

  async getPartnerByUserId(userId: number): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $user_id AS Uint64;
        SELECT * FROM partners WHERE user_id = $user_id LIMIT 1;
      `, { $user_id: TypedValues.uint64(userId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }

  async getPartnerBySlug(slug: string): Promise<Partner | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $slug AS Utf8;
        SELECT * FROM partners WHERE partner_slug = $slug LIMIT 1;
      `, { $slug: TypedValues.utf8(slug) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }

  async isPartnerSlugTaken(slug: string): Promise<boolean> {
    const existing = await this.getPartnerBySlug(slug);
    return !!existing;
  }

  async listPartners(filter?: { status?: string }): Promise<Partner[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      // ORDER BY id DESC: id is Date.now()-monotonic Uint64 (always present),
      // safer than ORDER BY created_at (Optional Timestamp can fail in YDB sort).
      let query: string;
      const params: Record<string, any> = {};
      if (filter?.status) {
        query = `
          DECLARE $status AS Utf8;
          SELECT * FROM partners WHERE status = $status ORDER BY id DESC LIMIT 1000;
        `;
        params.$status = TypedValues.utf8(filter.status);
      } else {
        query = `SELECT * FROM partners ORDER BY id DESC LIMIT 1000;`;
      }
      const { resultSets } = await session.executeQuery(query, params);
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapPartnerRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async updatePartnerContacts(id: number, data: { contactName?: string; contactPhone?: string; storeName?: string }): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const sets: string[] = [];
    const declares: string[] = ["DECLARE $id AS Uint64;"];
    const params: Record<string, any> = { $id: TypedValues.uint64(id) };
    if (typeof data.contactName === "string") {
      declares.push("DECLARE $contact_name AS Utf8;");
      sets.push("contact_name = $contact_name");
      params.$contact_name = TypedValues.utf8(data.contactName);
    }
    if (typeof data.contactPhone === "string") {
      declares.push("DECLARE $contact_phone AS Utf8;");
      sets.push("contact_phone = $contact_phone");
      params.$contact_phone = TypedValues.utf8(data.contactPhone);
    }
    if (typeof data.storeName === "string") {
      declares.push("DECLARE $store_name AS Utf8;");
      sets.push("store_name = $store_name");
      params.$store_name = TypedValues.utf8(data.storeName);
    }
    if (sets.length === 0) return;
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `${declares.join(" ")} UPDATE partners SET ${sets.join(", ")} WHERE id = $id;`,
        params,
      );
    });
  }

  async updatePartnerStatus(id: number, status: "pending" | "approved" | "rejected" | "blocked"): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      const setApproved = status === "approved";
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $status AS Utf8;
        DECLARE $approved_at AS Timestamp?;
        UPDATE partners SET status = $status, approved_at = $approved_at WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8(status),
        $approved_at: setApproved
          ? TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, new Date()))
          : TypedValues.optionalNull(Types.TIMESTAMP),
      });
    });
  }

  async deletePartner(id: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const params = { $id: TypedValues.uint64(id) };
    const declare = `DECLARE $id AS Uint64;`;
    // 1. Обнуляем partner_id в заказах (историю не удаляем)
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} UPDATE orders SET partner_id = NULL WHERE partner_id = $id;`, params);
    });
    // 2. Удаляем комиссии
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_commissions WHERE partner_id = $id;`, params);
    });
    // 3. Удаляем выплаты
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_payouts WHERE partner_id = $id;`, params);
    });
    // 4. Удаляем связанные товары
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partner_products WHERE partner_id = $id;`, params);
    });
    // 5. Удаляем подписи документов
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM consent_signatures WHERE partner_id = $id;`, params);
    });
    // 6. Удаляем промокоды
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM promo_codes WHERE partner_id = $id;`, params);
    });
    // 7. Удаляем саму запись партнёра
    await this.safeQuery(async (session) => {
      await session.executeQuery(`${declare} DELETE FROM partners WHERE id = $id;`, params);
    });
  }

  async updatePartnerCommissionOverride(id: number, percent: number | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $override AS Int32?;
        UPDATE partners SET commission_override = $override WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $override: percent === null
          ? TypedValues.optionalNull(Types.INT32)
          : TypedValues.optional(TypedValues.int32(percent)),
      });
    });
  }

  async setPartnerPayoutRequested(id: number, requested: boolean): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $requested AS Bool;
        UPDATE partners SET payout_requested = $requested WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $requested: TypedValues.bool(requested),
      });
    });
  }

  async updatePartnerBankDetails(id: number, data: { bankBik: string; bankAccount: string; bankName: string; bankCorrAccount: string }): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const optStr = (v: string | null | undefined) =>
      v != null ? TypedValues.optional(TypedValues.utf8(v)) : TypedValues.optional(TypedValues.fromNative(Types.UTF8, ''));
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $bank_bik AS Utf8?;
        DECLARE $bank_account AS Utf8?;
        DECLARE $bank_name AS Utf8?;
        DECLARE $bank_corr_account AS Utf8?;
        UPDATE partners SET
          bank_bik = $bank_bik,
          bank_account = $bank_account,
          bank_name = $bank_name,
          bank_corr_account = $bank_corr_account
        WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $bank_bik: optStr(data.bankBik),
        $bank_account: optStr(data.bankAccount),
        $bank_name: optStr(data.bankName),
        $bank_corr_account: optStr(data.bankCorrAccount),
      });
    });
  }

  async updatePartnerIsArtist(id: number, isArtist: boolean): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $is_artist AS Bool?;
        UPDATE partners SET is_artist = $is_artist WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $is_artist: TypedValues.optional(TypedValues.fromNative(Types.BOOL, isArtist)),
      });
    });
  }

  async updatePartnerArtistRate(id: number, rate: number | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $artist_rate AS Double?;
        UPDATE partners SET artist_rate = $artist_rate WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $artist_rate: rate === null
          ? TypedValues.optional(TypedValues.fromNative(Types.DOUBLE, 0))
          : TypedValues.optional(TypedValues.fromNative(Types.DOUBLE, rate)),
      });
    });
  }

  async getArtistPartners(): Promise<Partner[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT * FROM partners WHERE is_artist = true ORDER BY id DESC LIMIT 500;`,
        {},
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapPartnerRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async incrementPartnerClicksBySlug(slug: string): Promise<void> {
    const partner = await this.getPartnerBySlug(slug);
    if (!partner) return;
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $clicks AS Int32;
        UPDATE partners SET clicks_count = $clicks WHERE id = $id;
      `, {
        $id: TypedValues.uint64(partner.id),
        $clicks: TypedValues.int32(partner.clicksCount + 1),
      });
    });
  }

  // -------- Partner products --------

  async getPartnerProductIds(partnerId: number): Promise<number[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT product_id FROM partner_products WHERE partner_id = $partner_id;
      `, { $partner_id: TypedValues.uint64(partnerId) });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns!);
        const pid = data.product_id;
        const n = typeof pid === "string" ? parseInt(pid, 10) : Number(pid);
        return Number.isFinite(n) ? n : 0;
      }).filter((n: number) => n > 0);
    });
    return result || [];
  }

  async addPartnerProduct(partnerId: number, productId: number): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${partnerId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $partner_id AS Uint64;
        DECLARE $product_id AS Uint64;
        DECLARE $created_at AS Timestamp;
        UPSERT INTO partner_products (id, partner_id, product_id, created_at)
        VALUES ($id, $partner_id, $product_id, $created_at);
      `, {
        $id: TypedValues.utf8(id),
        $partner_id: TypedValues.uint64(partnerId),
        $product_id: TypedValues.uint64(productId),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, new Date()),
      });
    });
  }

  async removePartnerProduct(partnerId: number, productId: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const id = `${partnerId}_${productId}`;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DELETE FROM partner_products WHERE id = $id;
      `, { $id: TypedValues.utf8(id) });
    });
  }

  // -------- Artist (partner) product & stats queries --------

  async getArtistProductsBySlug(partnerSlug: string): Promise<Product[]> {
    if (!driver) {
      const all = productsCache.get("all") || [];
      return all.filter((p: any) => p.artistSlug === partnerSlug && !p.isHidden);
    }
    // Direct YDB query — reliable regardless of cache state
    const parsed = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $artist_slug AS Utf8;
        SELECT * FROM products
        WHERE artist_slug = $artist_slug
          AND (is_hidden = false OR is_hidden IS NULL)
        ORDER BY id;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $artist_slug: TypedValues.fromNative(Types.UTF8, partnerSlug),
      });
      const rs = resultSets[0];
      if (!rs?.rows?.length || !rs.columns) return [];
      return rs.rows.map((row: any) => {
        const data = this.parseRowWithColumns(row, rs.columns!);
        return this.parseProduct(data);
      });
    });
    return (parsed || []).filter(Boolean);
  }

  async createArtistProduct(partnerSlug: string, data: { name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition?: string }): Promise<Product> {
    const sizeStock: Record<string, number> = data.sizeStock || {};
    const totalStock = Object.values(sizeStock).reduce((s, v) => s + (Number(v) || 0), 0);
    return this.createProduct({
      name: data.name,
      description: data.description,
      price: data.price,
      images: data.images,
      imageUrl: data.images[0] || '',
      thumbnailUrl: data.images[0] ? data.images[0].replace('.webp', '_thumb.webp') : null,
      sizes: data.sizes,
      sizeStock,
      stock: totalStock,
      category: data.category || 'merch',
      isNew: true,
      onSale: false,
      isHidden: false,
      artistSlug: partnerSlug,
      artistOnly: true,
      composition: data.composition || '',
    } as any);
  }

  async updateArtistProduct(productId: number, partnerSlug: string, data: Partial<{ name: string; description: string; price: number; images: string[]; sizes: string[]; sizeStock: Record<string, number>; category: string; composition: string; isHidden: boolean }>): Promise<Product> {
    // Verify ownership
    const existing = await this.getProduct(productId);
    if (!existing || (existing as any).artistSlug !== partnerSlug) {
      throw new Error('Товар не найден или нет доступа');
    }
    const update: any = { ...data };
    if (data.sizeStock) {
      update.stock = Object.values(data.sizeStock).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    if (data.images && data.images.length > 0) {
      update.imageUrl = data.images[0];
      update.thumbnailUrl = data.images[0].replace('.webp', '_thumb.webp');
    }
    return this.updateProduct(productId, update);
  }

  async deleteArtistProduct(productId: number, partnerSlug: string): Promise<void> {
    const existing = await this.getProduct(productId);
    if (!existing || (existing as any).artistSlug !== partnerSlug) {
      throw new Error('Товар не найден или нет доступа');
    }
    await this.updateProduct(productId, { isHidden: true } as any);
  }

  async getArtistStatsBySlug(partnerSlug: string, excludeOrderIds?: Set<number>): Promise<{
    revenue: number;
    orders: number;
    items: number;
    monthlyRevenue: { month: string; revenue: number }[];
    topProducts: { name: string; revenue: number; items: number }[];
  }> {
    const empty = { revenue: 0, orders: 0, items: 0, monthlyRevenue: [], topProducts: [] };
    if (!driver) return empty;

    // Build set of lowercase product names — direct YDB query (независимо от кэша)
    const artistProductNames = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const query = `
        DECLARE $artist_slug AS Utf8;
        SELECT name FROM products
        WHERE artist_slug = $artist_slug
          AND (is_hidden = false OR is_hidden IS NULL);
      `;
      const { resultSets } = await session.executeQuery(query, {
        $artist_slug: TypedValues.fromNative(Types.UTF8, partnerSlug),
      });
      const rs = resultSets[0];
      const names = new Set<string>();
      for (const row of rs?.rows || []) {
        const name = this.extractTypedValue((row.items || [])[0]);
        if (name) names.add(String(name).toLowerCase());
      }
      return names;
    }) ?? (() => {
      // Fallback на кэш если YDB-запрос упал
      const all = productsCache.get("all") || [];
      return new Set<string>(
        all.filter((p: any) => p.artistSlug === partnerSlug).map((p: any) => (p.name || '').toLowerCase())
      );
    })();
    if (artistProductNames.size === 0) return empty;

    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, created_at, items
        FROM orders
        WHERE is_wholesale = false
          AND status IN ('paid', 'processing', 'shipped', 'delivered')
        ORDER BY created_at DESC
        LIMIT 3000;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return empty;

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalItems = 0;
    const monthlyMap = new Map<string, number>();
    const productMap = new Map<string, { revenue: number; items: number }>();

    for (const row of result) {
      const cols = row.items || [];
      const orderId = Number(this.extractTypedValue(cols[0]));
      if (excludeOrderIds && excludeOrderIds.size > 0 && excludeOrderIds.has(orderId)) continue;
      const createdAt = this.extractTypedValue(cols[1]);
      const rawItems = this.extractTypedValue(cols[2]);

      let orderItems: any[] = [];
      try { orderItems = JSON.parse(rawItems || '[]'); } catch { continue; }

      let orderHasArtistItems = false;
      let orderArtistRevenue = 0;
      const month = createdAt ? new Date(createdAt).toISOString().slice(0, 7) : null;

      for (const item of orderItems) {
        if (item._discountDetails) continue;
        const nameLower = (item.productName || item.name || '').toLowerCase();
        if (!artistProductNames.has(nameLower)) continue;

        const qty = item.quantity || 1;
        const itemRevenue = (item.price || 0) * qty;
        const displayName = item.productName || item.name || '';

        orderHasArtistItems = true;
        orderArtistRevenue += itemRevenue;
        totalRevenue += itemRevenue;
        totalItems += qty;

        const pm = productMap.get(displayName) || { revenue: 0, items: 0 };
        pm.revenue += itemRevenue;
        pm.items += qty;
        productMap.set(displayName, pm);
      }

      if (orderHasArtistItems) {
        totalOrders += 1;
        if (month) monthlyMap.set(month, (monthlyMap.get(month) || 0) + orderArtistRevenue);
      }
    }

    const monthlyRevenue = Array.from(monthlyMap.entries())
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const topProducts = Array.from(productMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { revenue: totalRevenue, orders: totalOrders, items: totalItems, monthlyRevenue, topProducts };
  }

  // -------- Partner commissions --------

  async createPartnerCommission(data: { partnerId: number; orderId: number; orderItemsTotal: number; commissionPercent: number; commissionAmount: number; commissionType?: string }): Promise<PartnerCommission> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date();
    const cType = data.commissionType || 'referral';
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $partner_id AS Uint64;
        DECLARE $order_id AS Uint64;
        DECLARE $items_total AS Int64;
        DECLARE $percent AS Int32;
        DECLARE $amount AS Int64;
        DECLARE $status AS Utf8;
        DECLARE $created_at AS Timestamp;
        DECLARE $commission_type AS Utf8;
        UPSERT INTO partner_commissions
          (id, partner_id, order_id, order_items_total, commission_percent, commission_amount, status, created_at, commission_type)
        VALUES
          ($id, $partner_id, $order_id, $items_total, $percent, $amount, $status, $created_at, $commission_type);
      `, {
        $id: TypedValues.uint64(id),
        $partner_id: TypedValues.uint64(data.partnerId),
        $order_id: TypedValues.uint64(data.orderId),
        $items_total: TypedValues.int64(data.orderItemsTotal),
        $percent: TypedValues.int32(data.commissionPercent),
        $amount: TypedValues.int64(data.commissionAmount),
        $status: TypedValues.utf8("pending"),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $commission_type: TypedValues.utf8(cType),
      });
    });
    return {
      id,
      partnerId: data.partnerId,
      orderId: data.orderId,
      orderItemsTotal: data.orderItemsTotal,
      commissionPercent: data.commissionPercent,
      commissionAmount: data.commissionAmount,
      status: "pending",
      confirmedAt: null,
      paidAt: null,
      holdUntil: null,
      createdAt: now,
      commissionType: cType,
    } as PartnerCommission;
  }

  async setCommissionHoldUntil(id: number, holdUntil: Date | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $hold_until AS Timestamp?;
        UPDATE partner_commissions SET hold_until = $hold_until WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $hold_until: holdUntil
          ? TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, holdUntil))
          : TypedValues.optionalNull(Types.TIMESTAMP),
      });
    });
  }

  async getCommissionsByPartner(partnerId: number, filter?: { status?: string }): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      let declare = "DECLARE $partner_id AS Uint64;";
      let where = "WHERE partner_id = $partner_id";
      const params: Record<string, any> = { $partner_id: TypedValues.uint64(partnerId) };
      if (filter?.status) {
        declare += " DECLARE $status AS Utf8;";
        where += " AND status = $status";
        params.$status = TypedValues.utf8(filter.status);
      }
      const { resultSets } = await session.executeQuery(
        `${declare} SELECT * FROM partner_commissions ${where} ORDER BY created_at DESC LIMIT 1000;`,
        params,
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async getCommissionById(id: number): Promise<PartnerCommission | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT * FROM partner_commissions WHERE id = $id LIMIT 1;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapCommissionRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }

  async getCommissionByOrderId(orderId: number): Promise<PartnerCommission | null> {
    const all = await this.getCommissionsByOrderId(orderId);
    return all.length > 0 ? all[0] : null;
  }

  async getCommissionsByOrderId(orderId: number): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $order_id AS Uint64;
        SELECT * FROM partner_commissions WHERE order_id = $order_id;
      `, { $order_id: TypedValues.uint64(orderId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async getMonthlyRefCommissions(partnerId: number, year: number, month: number): Promise<PartnerCommission[]> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        DECLARE $start AS Timestamp;
        DECLARE $end AS Timestamp;
        SELECT * FROM partner_commissions
        WHERE partner_id = $partner_id
          AND created_at >= $start
          AND created_at < $end
          AND (status = 'pending' OR status = 'confirmed');
      `, {
        $partner_id: TypedValues.uint64(partnerId),
        $start: TypedValues.fromNative(Types.TIMESTAMP, start),
        $end: TypedValues.fromNative(Types.TIMESTAMP, end),
      });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async recalcMonthlyCommissions(partnerId: number, year: number, month: number, newPercent: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const commissions = await this.getMonthlyRefCommissions(partnerId, year, month);
    if (commissions.length === 0) return;

    // Обновляем каждую комиссию по новому проценту
    for (const c of commissions) {
      const newAmount = Math.round(c.orderItemsTotal * newPercent / 100);
      // Пропускаем если ничего не изменилось (оптимизация)
      if (c.commissionPercent === newPercent && c.commissionAmount === newAmount) continue;
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Uint64;
          DECLARE $percent AS Int32;
          DECLARE $amount AS Int64;
          UPDATE partner_commissions
          SET commission_percent = $percent, commission_amount = $amount
          WHERE id = $id;
        `, {
          $id: TypedValues.uint64(c.id),
          $percent: TypedValues.int32(newPercent),
          $amount: TypedValues.int64(newAmount),
        });
      });
    }

    // Пересчитываем totalEarned партнёра = сумма всех confirmed+paid комиссий
    const totalResult = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT SUM(commission_amount) AS total
        FROM partner_commissions
        WHERE partner_id = $partner_id
          AND (status = 'confirmed' OR status = 'paid');
      `, { $partner_id: TypedValues.uint64(partnerId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return 0;
      const row = this.parseRowWithColumns(rs.rows[0], rs.columns);
      return Number(row.total) || 0;
    });

    const newTotal = Math.max(0, totalResult || 0);
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $total AS Int64;
        UPDATE partners SET total_earned = $total WHERE id = $id;
      `, {
        $id: TypedValues.uint64(partnerId),
        $total: TypedValues.int64(newTotal),
      });
    });
  }

  async listAllCommissions(filter?: { status?: string; partnerId?: number }): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const declares: string[] = [];
      const conds: string[] = [];
      const params: Record<string, any> = {};
      if (filter?.status) {
        declares.push("DECLARE $status AS Utf8;");
        conds.push("status = $status");
        params.$status = TypedValues.utf8(filter.status);
      }
      if (filter?.partnerId) {
        declares.push("DECLARE $partner_id AS Uint64;");
        conds.push("partner_id = $partner_id");
        params.$partner_id = TypedValues.uint64(filter.partnerId);
      }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { resultSets } = await session.executeQuery(
        `${declares.join(" ")} SELECT * FROM partner_commissions ${where} ORDER BY created_at DESC LIMIT 2000;`,
        params,
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  async updateCommissionStatus(id: number, status: "pending" | "confirmed" | "cancelled" | "paid"): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date();

    // Fetch current row first — needed to decrement totalEarned on confirmed→cancelled
    const current = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT partner_id, commission_amount, status FROM partner_commissions WHERE id = $id;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.parseRowWithColumns(rs.rows[0], rs.columns);
    });
    if (!current) return;
    const prevStatus = String(current.status);
    if (prevStatus === status) return;

    await this.safeQuery(async (session) => {
      const sets: string[] = ["status = $status"];
      const declares: string[] = ["DECLARE $id AS Uint64;", "DECLARE $status AS Utf8;"];
      const params: Record<string, any> = {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8(status),
      };
      if (status === "confirmed") {
        declares.push("DECLARE $confirmed_at AS Timestamp;");
        sets.push("confirmed_at = $confirmed_at");
        params.$confirmed_at = TypedValues.fromNative(Types.TIMESTAMP, now);
      } else if (status === "paid") {
        declares.push("DECLARE $paid_at AS Timestamp;");
        sets.push("paid_at = $paid_at");
        params.$paid_at = TypedValues.fromNative(Types.TIMESTAMP, now);
      }
      await session.executeQuery(
        `${declares.join(" ")} UPDATE partner_commissions SET ${sets.join(", ")} WHERE id = $id;`,
        params,
      );
    });
    // Adjust partner.totalEarned based on transition
    const partnerId = Number(current.partner_id);
    const amount = Number(current.commission_amount);
    let delta = 0;
    if (status === "confirmed" && prevStatus !== "confirmed" && prevStatus !== "paid") {
      delta = amount;
    } else if (status === "cancelled" && (prevStatus === "confirmed" || prevStatus === "paid")) {
      delta = -amount;
    }
    if (delta !== 0) {
      const partner = await this.getPartnerById(partnerId);
      if (partner) {
        const newTotal = Math.max(0, partner.totalEarned + delta);
        await this.safeQuery(async (session) => {
          await session.executeQuery(`
            DECLARE $id AS Uint64;
            DECLARE $total AS Int64;
            UPDATE partners SET total_earned = $total WHERE id = $id;
          `, {
            $id: TypedValues.uint64(partnerId),
            $total: TypedValues.int64(newTotal),
          });
        });
      }
    }
  }

  async deleteCommission(id: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM partner_commissions WHERE id = $id;`,
        { $id: TypedValues.uint64(id) }
      );
    });
  }

  async markCommissionsPaid(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.updateCommissionStatus(id, "paid");
    }
  }

  async getPartnerStats(partnerId: number, excludeIds?: number[]): Promise<{
    clicks: number; ordersCount: number; ordersTotal: number;
    awaitingPaymentAmount: number; holdAmount: number;
    pendingAmount: number; // legacy: awaitingPayment + hold (kept for backwards-compat)
    confirmedAmount: number; paidAmount: number;
    readyToConfirmAmount: number; // pending && hold_until <= now (admin-confirmable)
  }> {
    const partner = await this.getPartnerById(partnerId);
    const allCommissions = await this.getCommissionsByPartner(partnerId);
    const excludeSet = excludeIds ? new Set(excludeIds) : new Set<number>();
    const commissions = excludeSet.size > 0 ? allCommissions.filter(c => !excludeSet.has(c.id)) : allCommissions;
    const now = Date.now();
    const stats = {
      clicks: partner?.clicksCount ?? 0,
      ordersCount: commissions.length,
      ordersTotal: 0,
      awaitingPaymentAmount: 0,
      holdAmount: 0,
      pendingAmount: 0,
      confirmedAmount: 0,
      paidAmount: 0,
      readyToConfirmAmount: 0,
    };
    for (const c of commissions) {
      stats.ordersTotal += c.orderItemsTotal;
      if (c.status === "pending") {
        stats.pendingAmount += c.commissionAmount;
        if (!c.holdUntil) {
          stats.awaitingPaymentAmount += c.commissionAmount;
        } else {
          const holdMs = c.holdUntil instanceof Date ? c.holdUntil.getTime() : new Date(c.holdUntil).getTime();
          if (holdMs > now) {
            stats.holdAmount += c.commissionAmount;
          } else {
            // Hold expired — commission moves to its own bucket; admin can confirm.
            // Disjoint from holdAmount so UI cards don't double-count.
            stats.readyToConfirmAmount += c.commissionAmount;
          }
        }
      } else if (c.status === "confirmed") {
        stats.confirmedAmount += c.commissionAmount;
      } else if (c.status === "paid") {
        stats.paidAmount += c.commissionAmount;
      }
    }
    return stats;
  }

  // -------- Partner payouts (history) --------

  async createPartnerPayout(data: {
    partnerId: number; amount: number; commissionIds: number[];
    method: string; recipientName: string; recipientDetails: string;
    note?: string | null; createdBy?: string | null;
  }): Promise<PartnerPayout> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date();
    const commissionIdsJson = JSON.stringify(data.commissionIds);
    const initialStatus = "awaiting_invoice"; // партнёр должен прикрепить счёт
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $partner_id AS Uint64;
        DECLARE $amount AS Int64;
        DECLARE $commission_count AS Int32;
        DECLARE $commission_ids AS Utf8;
        DECLARE $method AS Utf8;
        DECLARE $recipient_name AS Utf8;
        DECLARE $recipient_details AS Utf8;
        DECLARE $note AS Utf8?;
        DECLARE $created_by AS Utf8?;
        DECLARE $created_at AS Timestamp;
        DECLARE $status AS Utf8;
        UPSERT INTO partner_payouts
          (id, partner_id, amount, commission_count, commission_ids,
           method, recipient_name, recipient_details, note, created_by, created_at, status)
        VALUES
          ($id, $partner_id, $amount, $commission_count, $commission_ids,
           $method, $recipient_name, $recipient_details, $note, $created_by, $created_at, $status);
      `, {
        $id: TypedValues.uint64(id),
        $partner_id: TypedValues.uint64(data.partnerId),
        $amount: TypedValues.int64(data.amount),
        $commission_count: TypedValues.int32(data.commissionIds.length),
        $commission_ids: TypedValues.utf8(commissionIdsJson),
        $method: TypedValues.utf8(data.method),
        $recipient_name: TypedValues.utf8(data.recipientName),
        $recipient_details: TypedValues.utf8(data.recipientDetails),
        $note: data.note ? TypedValues.optional(TypedValues.utf8(data.note)) : TypedValues.optionalNull(Types.UTF8),
        $created_by: data.createdBy ? TypedValues.optional(TypedValues.utf8(data.createdBy)) : TypedValues.optionalNull(Types.UTF8),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $status: TypedValues.utf8(initialStatus),
      });
    });
    return {
      id,
      partnerId: data.partnerId,
      amount: data.amount,
      commissionCount: data.commissionIds.length,
      commissionIds: commissionIdsJson,
      method: data.method,
      recipientName: data.recipientName,
      recipientDetails: data.recipientDetails,
      note: data.note ?? null,
      createdBy: data.createdBy ?? null,
      createdAt: now,
      status: initialStatus,
      invoiceUrl: null,
      invoiceUploadedAt: null,
      invoiceNumber: null,
      paidAt: null,
      paidReference: null,
      receiptUrl: null,
      receiptUploadedAt: null,
      receiptNumber: null,
      actUrl: null,
      actUploadedAt: null,
      actNumber: null,
      completedAt: null,
      rejectedReason: null,
    } as PartnerPayout;
  }

  async getPayoutById(id: number): Promise<PartnerPayout | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT * FROM partner_payouts WHERE id = $id LIMIT 1;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapPartnerPayoutRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }

  async updatePartnerPayoutFields(
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
  ): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const sets: string[] = [];
    const declares: string[] = ["DECLARE $id AS Uint64;"];
    const params: Record<string, any> = { $id: TypedValues.uint64(id) };

    const optStr = (v: string | null | undefined) =>
      v ? TypedValues.optional(TypedValues.utf8(String(v))) : TypedValues.optionalNull(Types.UTF8);
    const optDate = (v: Date | null | undefined) =>
      v ? TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, v)) : TypedValues.optionalNull(Types.TIMESTAMP);

    // Mapping camelCase → snake_case + тип
    const colMap: Array<{ key: keyof typeof fields; col: string; kind: "str" | "date" | "strReq" }> = [
      { key: "status", col: "status", kind: "strReq" },
      { key: "invoiceUrl", col: "invoice_url", kind: "str" },
      { key: "invoiceUploadedAt", col: "invoice_uploaded_at", kind: "date" },
      { key: "invoiceNumber", col: "invoice_number", kind: "str" },
      { key: "paidAt", col: "paid_at", kind: "date" },
      { key: "paidReference", col: "paid_reference", kind: "str" },
      { key: "receiptUrl", col: "receipt_url", kind: "str" },
      { key: "receiptUploadedAt", col: "receipt_uploaded_at", kind: "date" },
      { key: "receiptNumber", col: "receipt_number", kind: "str" },
      { key: "actUrl", col: "act_url", kind: "str" },
      { key: "actUploadedAt", col: "act_uploaded_at", kind: "date" },
      { key: "actNumber", col: "act_number", kind: "str" },
      { key: "completedAt", col: "completed_at", kind: "date" },
      { key: "rejectedReason", col: "rejected_reason", kind: "str" },
    ];

    for (const m of colMap) {
      if (!(m.key in fields)) continue;
      const v = (fields as any)[m.key];
      const ph = `$${m.col}`;
      sets.push(`${m.col} = ${ph}`);
      if (m.kind === "strReq") {
        declares.push(`DECLARE ${ph} AS Utf8;`);
        params[ph] = TypedValues.utf8(String(v));
      } else if (m.kind === "str") {
        declares.push(`DECLARE ${ph} AS Utf8?;`);
        params[ph] = optStr(v as string | null);
      } else {
        declares.push(`DECLARE ${ph} AS Timestamp?;`);
        params[ph] = optDate(v as Date | null);
      }
    }

    if (sets.length === 0) return;
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `${declares.join(" ")} UPDATE partner_payouts SET ${sets.join(", ")} WHERE id = $id;`,
        params,
      );
    });
  }

  async listPartnerPayouts(partnerId?: number): Promise<PartnerPayout[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      let query: string;
      const params: Record<string, any> = {};
      if (partnerId !== undefined && partnerId !== null) {
        query = `
          DECLARE $partner_id AS Uint64;
          SELECT * FROM partner_payouts WHERE partner_id = $partner_id ORDER BY id DESC LIMIT 1000;
        `;
        params.$partner_id = TypedValues.uint64(partnerId);
      } else {
        query = `SELECT * FROM partner_payouts ORDER BY id DESC LIMIT 2000;`;
      }
      const { resultSets } = await session.executeQuery(query, params);
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapPartnerPayoutRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }

  // -------- Global commission percent (wraps bonus_settings) --------

  async getGlobalPartnerCommissionPercent(): Promise<number> {
    const raw = await this.getBonusSetting(PARTNER_GLOBAL_COMMISSION_SETTING_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : PARTNER_DEFAULT_COMMISSION_PERCENT;
  }

  async setGlobalPartnerCommissionPercent(percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error("Commission percent must be between 0 and 100");
    }
    await this.setBonusSetting(PARTNER_GLOBAL_COMMISSION_SETTING_KEY, String(Math.round(percent)));
  }

  // -------- Global partner hold-period (in days) --------

  async getGlobalPartnerHoldDays(): Promise<number> {
    const raw = await this.getBonusSetting(PARTNER_HOLD_DAYS_SETTING_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : PARTNER_DEFAULT_HOLD_DAYS;
  }

  async setGlobalPartnerHoldDays(days: number): Promise<void> {
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      throw new Error("Hold days must be between 0 and 365");
    }
    await this.setBonusSetting(PARTNER_HOLD_DAYS_SETTING_KEY, String(Math.round(days)));
  }

  // ========================================================================
  // Юридические документы (версионируемые, append-only)
  // ========================================================================

  private mapLegalDocumentRow(data: Record<string, any>): LegalDocument {
    const toDate = (v: any): Date | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    // parseResultSet уже конвертирует snake_case → camelCase
    return {
      id: String(data.id),
      slug: String(data.slug),
      version: String(data.version),
      title: String(data.title),
      body: String(data.body),
      bodyHash: String(data.bodyHash ?? data.body_hash ?? ""),
      isActive: Boolean(data.isActive ?? data.is_active),
      createdAt: toDate(data.createdAt ?? data.created_at) || new Date(),
      createdBy: (data.createdBy ?? data.created_by) ? String(data.createdBy ?? data.created_by) : null,
    } as LegalDocument;
  }

  async createLegalDocument(input: { slug: string; version: string; title: string; body: string; createdBy?: string | null }): Promise<LegalDocument> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const now = new Date();
    const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");

    // Сначала помечаем все предыдущие версии этого slug как неактивные
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $slug AS Utf8;
        UPDATE legal_documents SET is_active = false WHERE slug = $slug;
      `, {
        $slug: TypedValues.utf8(input.slug),
      });
    });

    // Затем вставляем новую активную версию
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $version AS Utf8;
        DECLARE $title AS Utf8;
        DECLARE $body AS Utf8;
        DECLARE $body_hash AS Utf8;
        DECLARE $is_active AS Bool;
        DECLARE $created_at AS Timestamp;
        DECLARE $created_by AS Utf8?;
        UPSERT INTO legal_documents
          (id, slug, version, title, body, body_hash, is_active, created_at, created_by)
        VALUES
          ($id, $slug, $version, $title, $body, $body_hash, $is_active, $created_at, $created_by);
      `, {
        $id: TypedValues.utf8(id),
        $slug: TypedValues.utf8(input.slug),
        $version: TypedValues.utf8(input.version),
        $title: TypedValues.utf8(input.title),
        $body: TypedValues.utf8(input.body),
        $body_hash: TypedValues.utf8(bodyHash),
        $is_active: TypedValues.bool(true),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $created_by: input.createdBy
          ? TypedValues.optional(TypedValues.utf8(input.createdBy))
          : TypedValues.optionalNull(Types.UTF8),
      });
    });

    return {
      id,
      slug: input.slug,
      version: input.version,
      title: input.title,
      body: input.body,
      bodyHash,
      isActive: true,
      createdAt: now,
      createdBy: input.createdBy ?? null,
    } as LegalDocument;
  }

  async getActiveLegalDocument(slug: string): Promise<LegalDocument | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $slug AS Utf8;
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        WHERE slug = $slug AND is_active = true
        ORDER BY created_at DESC
        LIMIT 1;
      `, { $slug: TypedValues.utf8(slug) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.length > 0 ? this.mapLegalDocumentRow(rows[0] as Record<string, any>) : null;
  }

  async getLegalDocumentById(id: string): Promise<LegalDocument | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $id AS Utf8;
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        WHERE id = $id
        LIMIT 1;
      `, { $id: TypedValues.utf8(id) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.length > 0 ? this.mapLegalDocumentRow(rows[0] as Record<string, any>) : null;
  }

  async listLegalDocuments(slug?: string): Promise<LegalDocument[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      if (slug) {
        return session.executeQuery(`
          DECLARE $slug AS Utf8;
          SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
          FROM legal_documents
          WHERE slug = $slug
          ORDER BY created_at DESC;
        `, { $slug: TypedValues.utf8(slug) });
      }
      return session.executeQuery(`
        SELECT id, slug, version, title, body, body_hash, is_active, created_at, created_by
        FROM legal_documents
        ORDER BY slug ASC, created_at DESC;
      `);
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.map((r) => this.mapLegalDocumentRow(r as Record<string, any>));
  }

  // ========================================================================
  // Журнал согласий (append-only)
  // ========================================================================

  private mapConsentSignatureRow(data: Record<string, any>): ConsentSignature {
    const toNum = (v: any): number => {
      if (v === null || v === undefined) return 0;
      if (typeof v === "bigint") return Number(v);
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };
    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date() : d;
    };
    // parseResultSet уже конвертирует snake_case → camelCase
    const remoteIpRaw = data.remoteIp ?? data.remote_ip;
    const s = (v: any): string | null => (v === null || v === undefined) ? null : String(v);
    return {
      id: String(data.id),
      partnerId: toNum(data.partnerId ?? data.partner_id),
      documentId: String(data.documentId ?? data.document_id),
      documentSlug: String(data.documentSlug ?? data.document_slug),
      documentVersion: String(data.documentVersion ?? data.document_version),
      documentHash: String(data.documentHash ?? data.document_hash),
      signedAt: toDate(data.signedAt ?? data.signed_at),
      ip: String(data.ip || ""),
      // Anti-spoof (30.04.2026): nullable — для legacy-строк до релиза будет null.
      remoteIp: remoteIpRaw === null || remoteIpRaw === undefined ? null : String(remoteIpRaw),
      // GeoIP (30.04.2026): nullable — для legacy-строк будет null.
      consentCountry: s(data.consentCountry ?? data.consent_country),
      consentRegion: s(data.consentRegion ?? data.consent_region),
      consentCity: s(data.consentCity ?? data.consent_city),
      userAgent: String(data.userAgent ?? data.user_agent ?? ""),
      method: String(data.method || "checkbox"),
    } as ConsentSignature;
  }

  async createConsentSignature(input: InsertConsentSignature): Promise<ConsentSignature> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const signedAt = input.signedAt instanceof Date ? input.signedAt : new Date(input.signedAt as any);
    const remoteIp = (input as any).remoteIp;
    const geoCountry = (input as any).geoCountry ?? null;
    const geoRegion = (input as any).geoRegion ?? null;
    const geoCity = (input as any).geoCity ?? null;
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Utf8;
        DECLARE $partner_id AS Uint64;
        DECLARE $document_id AS Utf8;
        DECLARE $document_slug AS Utf8;
        DECLARE $document_version AS Utf8;
        DECLARE $document_hash AS Utf8;
        DECLARE $signed_at AS Timestamp;
        DECLARE $ip AS Utf8;
        DECLARE $remote_ip AS Utf8?;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $user_agent AS Utf8;
        DECLARE $method AS Utf8;
        UPSERT INTO consent_signatures
          (id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method)
        VALUES
          ($id, $partner_id, $document_id, $document_slug, $document_version, $document_hash, $signed_at, $ip, $remote_ip, $consent_country, $consent_region, $consent_city, $user_agent, $method);
      `, {
        $id: TypedValues.utf8(id),
        $partner_id: TypedValues.uint64(input.partnerId),
        $document_id: TypedValues.utf8(input.documentId),
        $document_slug: TypedValues.utf8(input.documentSlug),
        $document_version: TypedValues.utf8(input.documentVersion),
        $document_hash: TypedValues.utf8(input.documentHash),
        $signed_at: TypedValues.fromNative(Types.TIMESTAMP, signedAt),
        $ip: TypedValues.utf8(input.ip),
        $remote_ip: remoteIp
          ? TypedValues.optional(TypedValues.utf8(String(remoteIp)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_country: geoCountry
          ? TypedValues.optional(TypedValues.utf8(String(geoCountry)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_region: geoRegion
          ? TypedValues.optional(TypedValues.utf8(String(geoRegion)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_city: geoCity
          ? TypedValues.optional(TypedValues.utf8(String(geoCity)))
          : TypedValues.optionalNull(Types.UTF8),
        $user_agent: TypedValues.utf8(input.userAgent),
        $method: TypedValues.utf8(input.method || "checkbox"),
      });
    });
    return {
      id,
      partnerId: input.partnerId,
      documentId: input.documentId,
      documentSlug: input.documentSlug,
      documentVersion: input.documentVersion,
      documentHash: input.documentHash,
      signedAt,
      ip: input.ip,
      remoteIp: remoteIp ?? null,
      consentCountry: geoCountry,
      consentRegion: geoRegion,
      consentCity: geoCity,
      userAgent: input.userAgent,
      method: input.method || "checkbox",
    } as ConsentSignature;
  }

  async listConsentSignaturesByPartnerId(partnerId: number): Promise<ConsentSignature[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      return session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT id, partner_id, document_id, document_slug, document_version, document_hash, signed_at, ip, remote_ip, consent_country, consent_region, consent_city, user_agent, method
        FROM consent_signatures
        WHERE partner_id = $partner_id
        ORDER BY signed_at DESC;
      `, { $partner_id: TypedValues.uint64(partnerId) });
    });
    const rows = result?.resultSets?.[0] ? this.parseResultSet(result.resultSets[0]) : [];
    return rows.map((r) => this.mapConsentSignatureRow(r as Record<string, any>));
  }

  // ─────────────────────────────────────────────────────────────────────
  // УНЭП «email-link first» (30.04.2026)
  // partner_pending_submissions: TTL на стороне YDB (expires_at, PT0S),
  // поэтому Node-крон не нужен — даже когда контейнер скейлится в 0.
  // ─────────────────────────────────────────────────────────────────────
  async createPartnerPendingSubmission(input: {
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
  }): Promise<boolean> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date();
    const result = await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $token AS Utf8;
        DECLARE $payload AS Utf8;
        DECLARE $form_hashes AS Utf8;
        DECLARE $ip AS Utf8;
        DECLARE $remote_ip AS Utf8?;
        DECLARE $user_agent AS Utf8;
        DECLARE $consent_country AS Utf8?;
        DECLARE $consent_region AS Utf8?;
        DECLARE $consent_city AS Utf8?;
        DECLARE $created_at AS Timestamp;
        DECLARE $expires_at AS Timestamp;
        UPSERT INTO partner_pending_submissions
          (token, payload, form_hashes, ip, remote_ip, user_agent, consent_country, consent_region, consent_city, created_at, expires_at)
        VALUES
          ($token, $payload, $form_hashes, $ip, $remote_ip, $user_agent, $consent_country, $consent_region, $consent_city, $created_at, $expires_at);
      `, {
        $token: TypedValues.utf8(input.token),
        $payload: TypedValues.utf8(JSON.stringify(input.payload)),
        $form_hashes: TypedValues.utf8(JSON.stringify(input.formHashes)),
        $ip: TypedValues.utf8(input.ip || ""),
        $remote_ip: input.remoteIp
          ? TypedValues.optional(TypedValues.utf8(String(input.remoteIp)))
          : TypedValues.optionalNull(Types.UTF8),
        $user_agent: TypedValues.utf8(input.userAgent || ""),
        $consent_country: input.geoCountry
          ? TypedValues.optional(TypedValues.utf8(String(input.geoCountry)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_region: input.geoRegion
          ? TypedValues.optional(TypedValues.utf8(String(input.geoRegion)))
          : TypedValues.optionalNull(Types.UTF8),
        $consent_city: input.geoCity
          ? TypedValues.optional(TypedValues.utf8(String(input.geoCity)))
          : TypedValues.optionalNull(Types.UTF8),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $expires_at: TypedValues.fromNative(Types.TIMESTAMP, input.expiresAt),
      });
      return true;
    });
    return result === true;
  }

  async getPartnerPendingSubmission(token: string): Promise<{
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
  } | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $token AS Utf8;
        SELECT token, payload, form_hashes, ip, remote_ip, user_agent,
               consent_country, consent_region, consent_city, created_at, expires_at
        FROM partner_pending_submissions
        WHERE token = $token
        LIMIT 1;
      `, { $token: TypedValues.utf8(token) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.parseRowWithColumns(rs.rows[0], rs.columns);
    });
    if (!result) return null;
    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      if (typeof v === "number") {
        // YDB Timestamp в SDK обычно возвращается как мс или мкс с эпохи
        return new Date(v > 1e14 ? Math.floor(v / 1000) : v);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date(0) : d;
    };
    let payload: any = null;
    let formHashes: any = null;
    try { payload = JSON.parse(String(result.payload || "{}")); } catch { payload = null; }
    try { formHashes = JSON.parse(String(result.form_hashes || "{}")); } catch { formHashes = null; }
    return {
      token: String(result.token),
      payload,
      formHashes,
      ip: String(result.ip || ""),
      remoteIp: result.remote_ip ? String(result.remote_ip) : null,
      userAgent: String(result.user_agent || ""),
      geoCountry: result.consent_country ? String(result.consent_country) : null,
      geoRegion: result.consent_region ? String(result.consent_region) : null,
      geoCity: result.consent_city ? String(result.consent_city) : null,
      createdAt: toDate(result.created_at),
      expiresAt: toDate(result.expires_at),
    };
  }

  async deletePartnerPendingSubmission(token: string): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $token AS Utf8;
        DELETE FROM partner_pending_submissions WHERE token = $token;
      `, { $token: TypedValues.utf8(token) });
    });
  }

  private _cartRemindersTableReady = false;

  private async ensureCartRemindersTable(): Promise<void> {
    if (this._cartRemindersTableReady || !driver) return;
    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable('cart_reminders', new ydb.TableDescription()
          .withColumn(new ydb.Column('user_id', ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column('sent_at', ydb.Types.optional(ydb.Types.DATETIME)))
          .withColumn(new ydb.Column('cart_hash', ydb.Types.optional(ydb.Types.UTF8)))
          .withPrimaryKey('user_id')
        );
      });
      this._cartRemindersTableReady = true;
      console.log('[YDB] cart_reminders table created');
    } catch (err: any) {
      if (err.message?.includes('already exists') || err.issues?.some((i: any) => i.message?.includes('already exists'))) {
        this._cartRemindersTableReady = true;
      } else {
        console.error('[CartReminders] Failed to ensure table:', err.message);
      }
    }
  }

  async getAbandonedCartUserSessions(): Promise<string[]> {
    await this.ensureCartRemindersTable();
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT DISTINCT session_id FROM cart_items WHERE String::StartsWith(session_id, 'user_')`
      );
      const rows = this.parseResultSet<{ sessionId: string }>(resultSets[0]);
      return rows.map(r => r.sessionId).filter(Boolean);
    });
    return result || [];
  }

  async getCartSessionDates(): Promise<Record<string, number>> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT session_id, MIN(created_at) AS oldest FROM cart_items WHERE String::StartsWith(session_id, 'user_') GROUP BY session_id`
      );
      const rows = this.parseResultSet<{ sessionId: string; oldest: any }>(resultSets[0]);
      const map: Record<string, number> = {};
      for (const r of rows) {
        if (!r.sessionId) continue;
        const ts = r.oldest;
        if (ts == null) continue;
        const num = typeof ts === 'number' ? ts * 1000 : new Date(String(ts)).getTime();
        if (!isNaN(num)) map[r.sessionId] = num;
      }
      return map;
    });
    return result || {};
  }

  async getUserEmailById(userId: number): Promise<{ name: string; email: string } | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const { resultSets } = await session.executeQuery(
        `DECLARE $id AS Utf8; SELECT id, name, email FROM users WHERE id = $id LIMIT 1`,
        { '$id': TypedValues.utf8(String(userId)) }
      );
      const rows = this.parseResultSet<{ id: number; name: string; email: string }>(resultSets[0]);
      return rows[0] || null;
    });
    return result || null;
  }

  async getCartReminder(userId: number): Promise<{ sentAt: string; cartHash: string } | null> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const { resultSets } = await session.executeQuery(
        `DECLARE $user_id AS Uint64; SELECT user_id, sent_at, cart_hash FROM cart_reminders WHERE user_id = $user_id LIMIT 1`,
        { '$user_id': TypedValues.uint64(userId) }
      );
      const rows = this.parseResultSet<{ userId: number; sentAt: string; cartHash: string }>(resultSets[0]);
      return rows[0] ? { sentAt: rows[0].sentAt, cartHash: rows[0].cartHash } : null;
    });
    return result || null;
  }

  async upsertCartReminder(userId: number, cartHash: string): Promise<void> {
    const now = new Date();
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(`
        DECLARE $user_id AS Uint64;
        DECLARE $sent_at AS Datetime;
        DECLARE $cart_hash AS Utf8;
        UPSERT INTO cart_reminders (user_id, sent_at, cart_hash) VALUES ($user_id, $sent_at, $cart_hash)
      `, {
        '$user_id': TypedValues.uint64(userId),
        '$sent_at': TypedValues.datetime(now),
        '$cart_hash': TypedValues.utf8(cartHash),
      });
    });
  }

  async clearCartReminders(): Promise<number> {
    await this.ensureCartRemindersTable();
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT COUNT(*) AS cnt FROM cart_reminders`
      );
      const rows = this.parseResultSet<{ cnt: number }>(resultSets[0]);
      const count = Number(rows[0]?.cnt ?? 0);
      await session.executeQuery(`DELETE FROM cart_reminders`);
      return count;
    });
    return result ?? 0;
  }

  // ─── Artist Tracks ──────────────────────────────────────────────────────────

  async getArtistTracks(artistSlug: string, adminMode = false): Promise<ArtistTrack[]> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const whereActive = adminMode ? '' : 'AND is_active = true';
      const { resultSets } = await session.executeQuery(
        `DECLARE $artist_slug AS Utf8;
         SELECT id, artist_slug, title, subtitle, audio_url, cover_url, duration, track_order, plays, is_active, created_at
         FROM artist_tracks
         WHERE artist_slug = $artist_slug ${whereActive}
         ORDER BY track_order ASC, id ASC`,
        { '$artist_slug': TypedValues.utf8(artistSlug) }
      );
      const rows = this.parseResultSet<any>(resultSets[0]);
      return rows.map((r: any) => ({
        id: Number(r.id ?? 0),
        artistSlug: String(r.artistSlug ?? ''),
        title: String(r.title ?? ''),
        subtitle: String(r.subtitle ?? ''),
        audioUrl: String(r.audioUrl ?? ''),
        coverUrl: String(r.coverUrl ?? ''),
        duration: Number(r.duration ?? 0),
        trackOrder: Number(r.trackOrder ?? 0),
        plays: Number(r.plays ?? 0),
        isActive: Boolean(r.isActive ?? true),
        createdAt: r.createdAt ? new Date(typeof r.createdAt === 'number' ? r.createdAt * 1000 : r.createdAt).toISOString() : new Date().toISOString(),
      }));
    });
    return result || [];
  }

  async createArtistTrack(data: { artistSlug: string; title: string; subtitle?: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number }): Promise<ArtistTrack> {
    const id = Date.now();
    const now = new Date();
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;
         DECLARE $artist_slug AS Utf8;
         DECLARE $title AS Utf8;
         DECLARE $subtitle AS Utf8;
         DECLARE $audio_url AS Utf8;
         DECLARE $cover_url AS Utf8;
         DECLARE $duration AS Int32;
         DECLARE $track_order AS Int32;
         DECLARE $plays AS Int64;
         DECLARE $is_active AS Bool;
         DECLARE $created_at AS Timestamp;
         UPSERT INTO artist_tracks (id, artist_slug, title, subtitle, audio_url, cover_url, duration, track_order, plays, is_active, created_at)
         VALUES ($id, $artist_slug, $title, $subtitle, $audio_url, $cover_url, $duration, $track_order, $plays, $is_active, $created_at)`,
        {
          '$id': TypedValues.uint64(id),
          '$artist_slug': TypedValues.utf8(data.artistSlug),
          '$title': TypedValues.utf8(data.title),
          '$subtitle': TypedValues.utf8(data.subtitle || ''),
          '$audio_url': TypedValues.utf8(data.audioUrl),
          '$cover_url': TypedValues.utf8(data.coverUrl),
          '$duration': TypedValues.int32(data.duration),
          '$track_order': TypedValues.int32(data.trackOrder),
          '$plays': TypedValues.int64(0),
          '$is_active': TypedValues.bool(true),
          '$created_at': TypedValues.timestamp(now),
        }
      );
    });
    return {
      id,
      artistSlug: data.artistSlug,
      title: data.title,
      subtitle: data.subtitle || '',
      audioUrl: data.audioUrl,
      coverUrl: data.coverUrl,
      duration: data.duration,
      trackOrder: data.trackOrder,
      plays: 0,
      isActive: true,
      createdAt: now.toISOString(),
    };
  }

  async updateArtistTrack(id: number, data: Partial<{ title: string; subtitle: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number; isActive: boolean }>): Promise<void> {
    type FieldDef = [string, string, any];
    const fields: FieldDef[] = [];
    if (data.title !== undefined) fields.push(['title', 'Utf8', data.title]);
    if (data.subtitle !== undefined) fields.push(['subtitle', 'Utf8', data.subtitle]);
    if (data.audioUrl !== undefined) fields.push(['audio_url', 'Utf8', data.audioUrl]);
    if (data.coverUrl !== undefined) fields.push(['cover_url', 'Utf8', data.coverUrl]);
    if (data.duration !== undefined) fields.push(['duration', 'Int32', data.duration]);
    if (data.trackOrder !== undefined) fields.push(['track_order', 'Int32', data.trackOrder]);
    if (data.isActive !== undefined) fields.push(['is_active', 'Bool', data.isActive]);
    if (fields.length === 0) return;

    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const declares = ['DECLARE $id AS Uint64;'];
      const setClause: string[] = [];
      const params: Record<string, any> = { '$id': TypedValues.uint64(id) };

      for (const [col, yqlType, value] of fields) {
        const param = `$${col}`;
        declares.push(`DECLARE ${param} AS ${yqlType};`);
        setClause.push(`${col} = ${param}`);
        if (yqlType === 'Utf8') params[param] = TypedValues.utf8(String(value));
        else if (yqlType === 'Int32') params[param] = TypedValues.int32(Number(value));
        else if (yqlType === 'Bool') params[param] = TypedValues.bool(Boolean(value));
      }

      const query = `${declares.join('\n')}\nUPDATE artist_tracks SET ${setClause.join(', ')} WHERE id = $id`;
      await session.executeQuery(query, params);
    });
  }

  async deleteArtistTrack(id: number): Promise<void> {
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;\nDELETE FROM artist_tracks WHERE id = $id`,
        { '$id': TypedValues.uint64(id) }
      );
    });
  }

  async incrementTrackPlays(id: number, count = 1): Promise<void> {
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;\nDECLARE $count AS Int64;\nUPDATE artist_tracks SET plays = plays + $count WHERE id = $id`,
        {
          '$id': TypedValues.uint64(id),
          '$count': TypedValues.int64(count),
        }
      );
    });
  }
}

export const storage = new DatabaseStorage();
