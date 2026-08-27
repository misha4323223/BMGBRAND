// Orders storage (2.4.2a): order reads + analytics (getOrders, preorders, 1C unsynced).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import type { Order } from "@shared/schema";
import { DatabaseStorage, productsCache, deserializeOrderPartnerId, serializeOrderPartnerId } from "./core";
import ydb from "ydb-sdk";
import { logWarn } from "../logger";
import type { InsertOrder, Product } from "@shared/schema";
import { logError } from "../logger";

declare module "./core" {
  interface DatabaseStorage {
    getOrders(): Promise<Order[]>;
    getAllRetailPreorderOrders(): Promise<Order[]>;
    getOrderAnalytics(): Promise<{ month: string; retailCount: number; wholesaleCount: number; retailRevenue: number; wholesaleRevenue: number }[]>;
    getArtistAnalytics(): Promise<{ artist: string; revenue: number; orders: number; items: number; ordersList: { orderId: number; date: string; customerName: string; items: { name: string; qty: number; price: number }[]; total: number }[] }[]>;
    getMonthlySalesReport(from?: string, to?: string, type?: 'retail' | 'wholesale' | 'all'): Promise<{ month: string; ownerKey: string; ownerLabel: string; revenue: number; qty: number; items: { productName: string; size: string; color: string; qty: number; price: number }[]; }[]>;
    getAllWholesaleOrdersIncludingDrafts(): Promise<Order[]>;
    getUnsyncedOrdersFor1C(): Promise<Order[]>;
    markOrdersSyncedTo1C(orderIds: number[]): Promise<void>;
    getOrdersByStatus(status: string): Promise<Order[]>;
    getOrdersByEmail(email: string): Promise<Order[]>;
    getOrdersByUserId(userId: number): Promise<Order[]>;
    getOrder(id: number): Promise<Order | undefined>;
    updateOrderStatus(id: number, status: string): Promise<Order>;
    markOrderPaid(id: number, paymentId: string): Promise<Order>;
    updateOrderPaymentId(id: number, paymentId: string): Promise<void>;
    updateOrderCdekData(id: number, cdekData: string): Promise<void>;
    updateOrderBitrixDealId(id: number, dealId: number): Promise<void>;
    getOrderBitrixDealId(id: number): Promise<number | null>;
    incrementPreorderCurrent(productId: number): Promise<number>;
    updatePreorderStatus(productId: number, status: string): Promise<void>;
    getPreorderProducts(): Promise<Product[]>;
    getWholesalePreorderProducts(): Promise<Product[]>;
    createPreorderOrder(order: InsertOrder & { items: any[], total: number, userId?: number, depositAmount: number }): Promise<Order>;
    updateOrderPreorderFields(orderId: number, fields: { depositPaid?: boolean; remainingAmount?: number; preorderPaymentId?: string; isPreorder?: boolean }): Promise<void>;
    updateOrderAddonData(orderId: number, addonData: string): Promise<void>;
    updateOrderItems(orderId: number, items: any[], totalKopeks: number): Promise<void>;
    appendOrderItems(orderId: number, newItems: any[], addedTotal: number): Promise<void>;
    getPreorderOrdersByUser(userId: number): Promise<Order[]>;
    updateOrderUserId(orderId: number, userId: number): Promise<boolean>;
    getWholesaleOrdersWithoutUserId(): Promise<any[]>;
    saveOrderInvoiceNumber(orderId: number, invoiceNumber: number): Promise<void>;
    deleteOrder(id: number): Promise<boolean>;
    getDraftOrders(): Promise<any[]>;
    deleteExpiredDraftOrders(maxAgeMinutes: number): Promise<number>;
    createOrder(order: InsertOrder & { items: any[], total: number, promoCode?: string, isWholesale?: boolean, transportCompany?: string, userId?: number, partnerId?: number, cdekPointCode?: string, cdekCityCode?: number, cdekTariffCode?: number, cdekDeliveryType?: string, cdekDoorAddress?: { street: string; house: string; flat?: string; entrance?: string; floor?: string }, ozonPvzId?: string, ozonPvzAddress?: string }): Promise<Order>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.getOrders = async function (this: DatabaseStorage, ): Promise<Order[]> {
    if (!driver) {
      console.log('[Storage] getOrders: YDB driver not initialized');
      return [];
    }
    
    console.log('[Storage] getOrders: Fetching orders from YDB...');
    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, session_id, customer_name, customer_email, customer_phone, address, total, items, status, created_at, is_wholesale, transport_company, is_preorder, deposit_paid, remaining_amount, user_id, cdek_data, partner_id, promo_code
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
        deliveryService: (() => { try { return JSON.parse(this.extractTypedValue(row.items[16]) || '{}').deliveryService || undefined; } catch { return undefined; } })(),
        // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
        partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[17])),
        promoCode: this.extractTypedValue(row.items[18]) || undefined,
      };
    }) as any;
  }
;

DatabaseStorage.prototype.getAllRetailPreorderOrders = async function (this: DatabaseStorage, ): Promise<Order[]> {
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
;

DatabaseStorage.prototype.getOrderAnalytics = async function (this: DatabaseStorage, ): Promise<{ month: string; retailCount: number; wholesaleCount: number; retailRevenue: number; wholesaleRevenue: number }[]> {
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
;

DatabaseStorage.prototype.getArtistAnalytics = async function (this: DatabaseStorage, ): Promise<{ artist: string; revenue: number; orders: number; items: number; ordersList: { orderId: number; date: string; customerName: string; items: { name: string; qty: number; price: number }[]; total: number }[] }[]> {
    if (!driver) return [];

    // Keyword fallback list — includes Дикая Мята (was missing before)
    const ARTISTS = [
      { label: "Молодость Внутри", slug: "molodost-vnutri", keywords: ["молодость внутри"] },
      { label: "Гуд Таймс", slug: "gudtajms", keywords: ["гудтаймс", "гуд таймс", "goodtimes", "good times", "зож", "принц"] },
      { label: "Дикая Мята", slug: "dikaya-myata", keywords: ["дикая мята", "wild mint", "vashana", "стикерпак"] },
      { label: "Мультфильмы", slug: "multfilmy", keywords: ["мультфильм", "мультfильм"] },
      { label: "Драгни", slug: "dragni", keywords: ["драгни", "dragni"] },
    ];

    // Canonical slug aliases: non-standard values → canonical slug.
    // Covers duplicate partner records and historical data with wrong slugs.
    const SLUG_ALIASES: Record<string, string> = {
      "goodtimes":      "gudtajms",        // дублирующая партнёр-запись в БД
      "гудтаймс":       "gudtajms",        // кириллица как slug
      "ГУДТАЙМС":       "gudtajms",        // имя подкатегории использовалось как slug
      "molodostvnutri": "molodost-vnutri", // партнёр-запись без дефиса
    };
    const normalizeSlug = (s: string): string => SLUG_ALIASES[s] ?? s;

    // Slug-based lookup: product name (lower) → canonical artistSlug, from in-memory products cache
    const cachedProducts = productsCache.get("all") || [];
    const productNameToSlug = new Map<string, string>();
    for (const p of cachedProducts) {
      if (p.artistSlug) {
        productNameToSlug.set((p.name || '').toLowerCase(), normalizeSlug(p.artistSlug));
      }
    }

    // Load artist partners for slug → display label
    const artistPartners = await this.getArtistPartners();
    const slugToLabel = new Map<string, string>();
    for (const p of artistPartners) {
      slugToLabel.set(p.partnerSlug, p.storeName || p.contactName || p.partnerSlug);
    }
    // Propagate labels from alias slugs to their canonical counterparts
    // so canonical keys always resolve to a proper display name
    for (const [alias, canonical] of Object.entries(SLUG_ALIASES)) {
      if (!slugToLabel.has(canonical) && slugToLabel.has(alias)) {
        slugToLabel.set(canonical, slugToLabel.get(alias)!);
      }
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
        // Key by slug to avoid duplicates when slugToLabel returns different strings for same artist
        const artistSlug = productNameToSlug.get(nameLower);
        if (artistSlug) {
          initArtist(artistSlug);
          artistMap.get(artistSlug)!.items += qty;
          artistMap.get(artistSlug)!.revenue += itemRevenue;
          if (!artistOrderItems.has(artistSlug)) artistOrderItems.set(artistSlug, []);
          artistOrderItems.get(artistSlug)!.push({ name: displayName, qty, price: item.price || 0 });
          continue;
        }

        // 2. Keyword fallback (products not yet tagged with artist_slug)
        // Key by slug so slug-lookup and keyword-lookup always merge into the same bucket
        let matched = false;
        for (const artist of ARTISTS) {
          if (artist.keywords.some(k => nameLower.includes(k))) {
            initArtist(artist.slug);
            const entry = artistMap.get(artist.slug)!;
            entry.items += qty;
            entry.revenue += itemRevenue;
            if (!artistOrderItems.has(artist.slug)) artistOrderItems.set(artist.slug, []);
            artistOrderItems.get(artist.slug)!.push({ name: displayName, qty, price: item.price || 0 });
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

      for (const [artistKey, artistItems] of artistOrderItems.entries()) {
        const entry = artistMap.get(artistKey)!;
        const total = artistItems.reduce((s, i) => s + i.price * i.qty, 0);
        entry.orders += 1;
        entry.ordersList.push({ orderId, date, customerName, items: artistItems, total });
      }
    }

    // Convert slug keys → display labels at the very end (single point of label resolution)
    return Array.from(artistMap.entries())
      .map(([key, data]) => ({
        artist: key === "BOOOMERANGS" ? "BOOOMERANGS" : (slugToLabel.get(key) || key),
        ...data,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }
;

DatabaseStorage.prototype.getMonthlySalesReport = async function (this: DatabaseStorage, from?: string, to?: string, type: 'retail' | 'wholesale' | 'all' = 'all'): Promise<{
    month: string;
    ownerKey: string;
    ownerLabel: string;
    revenue: number;
    qty: number;
    items: { productName: string; size: string; color: string; qty: number; price: number }[];
  }[]> {
    if (!driver) return [];

    // ── Artist/slug reference tables (same as getArtistAnalytics) ──────────
    const ARTISTS = [
      { label: "Молодость Внутри", slug: "molodost-vnutri", keywords: ["молодость внутри"] },
      { label: "Гуд Таймс",        slug: "gudtajms",        keywords: ["гудтаймс", "гуд таймс", "goodtimes", "good times", "зож", "принц"] },
      { label: "Дикая Мята",       slug: "dikaya-myata",    keywords: ["дикая мята", "wild mint", "vashana", "стикерпак"] },
      { label: "Мультфильмы",      slug: "multfilmy",       keywords: ["мультфильм", "мультfильм"] },
      { label: "Драгни",           slug: "dragni",          keywords: ["драгни", "dragni"] },
    ];
    const SLUG_ALIASES: Record<string, string> = {
      "goodtimes":      "gudtajms",
      "гудтаймс":       "gudtajms",
      "ГУДТАЙМС":       "gudtajms",
      "molodostvnutri": "molodost-vnutri",
    };
    const normalizeSlug = (s: string): string => SLUG_ALIASES[s] ?? s;

    // Build product lookups from in-memory cache
    const cachedProducts = productsCache.get("all") || [];
    const productIdToSlug   = new Map<number, string>();
    const productNameToSlug = new Map<string, string>();
    for (const p of cachedProducts) {
      if (p.artistSlug) {
        if (p.id) productIdToSlug.set(Number(p.id), normalizeSlug(p.artistSlug));
        productNameToSlug.set((p.name || '').toLowerCase(), normalizeSlug(p.artistSlug));
      }
    }

    // Slug → display label from partner DB + static fallback
    const artistPartners = await this.getArtistPartners();
    const slugToLabel = new Map<string, string>();
    for (const p of artistPartners) {
      slugToLabel.set(p.partnerSlug, p.storeName || p.contactName || p.partnerSlug);
    }
    for (const [alias, canonical] of Object.entries(SLUG_ALIASES)) {
      if (!slugToLabel.has(canonical) && slugToLabel.has(alias)) {
        slugToLabel.set(canonical, slugToLabel.get(alias)!);
      }
    }
    for (const a of ARTISTS) {
      if (!slugToLabel.has(a.slug)) slugToLabel.set(a.slug, a.label);
    }

    // ── Fetch paid orders (filtered by type) ──────────────────────────────
    const whereClause = type === 'retail'
      ? `is_wholesale = false AND status IN ('paid', 'processing', 'shipped', 'delivered')`
      : type === 'wholesale'
      ? `is_wholesale = true  AND status NOT IN ('cancelled', 'awaiting_payment')`
      : `(is_wholesale = false AND status IN ('paid', 'processing', 'shipped', 'delivered'))
          OR (is_wholesale = true AND status NOT IN ('cancelled', 'awaiting_payment'))`;

    const result = await this.safeQuery(async (session) => {
      const query = `
        SELECT id, created_at, items, is_wholesale
        FROM orders
        WHERE (${whereClause})
        ORDER BY created_at ASC
        LIMIT 5000;
      `;
      const queryResult = await session.executeQuery(query);
      return queryResult.resultSets[0]?.rows || [];
    });
    if (!result) return [];

    // ── Accumulate into month+owner buckets ───────────────────────────────
    type RowData = {
      month: string;
      ownerKey: string;
      ownerLabel: string;
      revenue: number;
      qty: number;
      items: { productName: string; size: string; color: string; qty: number; price: number }[];
    };
    const rowMap = new Map<string, RowData>();

    const getOrCreate = (month: string, ownerKey: string): RowData => {
      const key = `${month}|||${ownerKey}`;
      if (!rowMap.has(key)) {
        const ownerLabel = ownerKey === "BOOOMERANGS"
          ? "BOOOMERANGS"
          : (slugToLabel.get(ownerKey) || ownerKey);
        rowMap.set(key, { month, ownerKey, ownerLabel, revenue: 0, qty: 0, items: [] });
      }
      return rowMap.get(key)!;
    };

    for (const row of result) {
      const cols = row.items || [];
      // cols: 0=id, 1=created_at, 2=items, 3=is_wholesale
      const createdAt = this.extractTypedValue(cols[1]);
      const rawItems  = this.extractTypedValue(cols[2]);

      if (!createdAt) continue;
      const date = new Date(createdAt);
      if (isNaN(date.getTime())) continue;
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (from && month < from) continue;
      if (to   && month > to)   continue;

      let orderItems: any[] = [];
      try { orderItems = JSON.parse(rawItems || '[]'); } catch { continue; }

      for (const item of orderItems) {
        if (item._discountDetails) continue;

        const pid         = Number(item.productId) || 0;
        const nameLower   = (item.productName || item.name || '').toLowerCase();
        const displayName = (item.productName || item.name || '—').trim();
        const qty         = Number(item.quantity) || 1;
        const price       = Number(item.price) || 0;
        const size        = ((item.size  || '').trim()) || '—';
        const color       = ((item.color || '').trim()) || '—';

        // Owner resolution: productId lookup → name lookup → keyword → BOOOMERANGS
        let ownerKey: string;
        const slugById   = pid ? productIdToSlug.get(pid) : undefined;
        const slugByName = productNameToSlug.get(nameLower);
        if (slugById) {
          ownerKey = slugById;
        } else if (slugByName) {
          ownerKey = slugByName;
        } else {
          const matched = ARTISTS.find(a => a.keywords.some(k => nameLower.includes(k)));
          ownerKey = matched ? matched.slug : "BOOOMERANGS";
        }

        const entry = getOrCreate(month, ownerKey);
        entry.revenue += price * qty;
        entry.qty     += qty;
        entry.items.push({ productName: displayName, size, color, qty, price });
      }
    }

    return Array.from(rowMap.values())
      .sort((a, b) => a.month.localeCompare(b.month) || a.ownerLabel.localeCompare(b.ownerLabel, 'ru'));
  }
;

DatabaseStorage.prototype.getAllWholesaleOrdersIncludingDrafts = async function (this: DatabaseStorage, ): Promise<Order[]> {
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
;

DatabaseStorage.prototype.getUnsyncedOrdersFor1C = async function (this: DatabaseStorage, ): Promise<Order[]> {
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
;

DatabaseStorage.prototype.markOrdersSyncedTo1C = async function (this: DatabaseStorage, orderIds: number[]): Promise<void> {
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
;

DatabaseStorage.prototype.getOrdersByStatus = async function (this: DatabaseStorage, status: string): Promise<Order[]> {
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
;

DatabaseStorage.prototype.getOrdersByEmail = async function (this: DatabaseStorage, email: string): Promise<Order[]> {
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
        deliveryService: (() => { try { return JSON.parse(this.extractTypedValue(row.items[12]) || '{}').deliveryService || undefined; } catch { return undefined; } })(),
        paymentId: this.extractTypedValue(row.items[13]) || undefined,
        invoiceNumber: this.extractTypedValue(row.items[14]) ? Number(this.extractTypedValue(row.items[14])) : undefined,
        // См. deserializeOrderPartnerId (вверху файла) — legacy Utf8 колонка.
        partnerId: deserializeOrderPartnerId(this.extractTypedValue(row.items[15])),
      };
    }) as any;
  }
;

DatabaseStorage.prototype.getOrdersByUserId = async function (this: DatabaseStorage, userId: number): Promise<Order[]> {
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
      deliveryService: (() => { try { return JSON.parse(this.extractTypedValue(row.items[13]) || '{}').deliveryService || undefined; } catch { return undefined; } })(),
      isPreorder: this.extractTypedValue(row.items[14]) === true,
      depositPaid: this.extractTypedValue(row.items[15]) === true,
      remainingAmount: Number(this.extractTypedValue(row.items[16])) || 0,
      preorderPaymentId: this.extractTypedValue(row.items[17]) || undefined,
      invoiceNumber: this.extractTypedValue(row.items[18]) ? Number(this.extractTypedValue(row.items[18])) : undefined,
    })) as any;
  }
;

DatabaseStorage.prototype.getOrder = async function (this: DatabaseStorage, id: number): Promise<Order | undefined> {
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
      deliveryService: (() => { try { return JSON.parse(this.extractTypedValue(row.items[12]) || '{}').deliveryService || undefined; } catch { return undefined; } })(),
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
;

DatabaseStorage.prototype.updateOrderStatus = async function (this: DatabaseStorage, id: number, status: string): Promise<Order> {
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
;

DatabaseStorage.prototype.markOrderPaid = async function (this: DatabaseStorage, id: number, paymentId: string): Promise<Order> {
    if (!driver) {
      throw new Error(`[Storage] Cannot mark order ${id} as paid: YDB driver is not initialized`);
    }

    const current = await this.getOrder(id);
    if (!current) {
      throw new Error(`[Storage] Cannot mark order ${id} as paid: order not found`);
    }

    // Webhooks can be delivered more than once. Do not rewrite an already
    // completed order; the caller uses this state to skip duplicate side effects.
    if (current.status === "paid") {
      if (!current.paymentId) {
        await this.updateOrderPaymentId(id, paymentId);
      }
      return (await this.getOrder(id)) || current;
    }

    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = `
        DECLARE $id AS Uint64;
        DECLARE $status AS Utf8;
        DECLARE $paymentId AS Utf8;
        UPDATE orders
        SET status = $status, payment_id = $paymentId
        WHERE id = $id;
      `;
      return await session.executeQuery(query, {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8("paid"),
        $paymentId: TypedValues.utf8(paymentId),
      });
    });

    if (!result) {
      throw new Error(`[Storage] YDB did not confirm marking order ${id} as paid`);
    }

    // safeQuery intentionally returns null on exhausted retries. Read-after-write
    // makes a lost write visible to the webhook instead of acknowledging it as paid.
    const updated = await this.getOrder(id);
    if (!updated || updated.status !== "paid" || String(updated.paymentId || "") !== String(paymentId)) {
      throw new Error(`[Storage] Read-after-write verification failed for paid order ${id}`);
    }
    return updated;
  }
;

DatabaseStorage.prototype.updateOrderPaymentId = async function (this: DatabaseStorage, id: number, paymentId: string): Promise<void> {
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
;

DatabaseStorage.prototype.updateOrderCdekData = async function (this: DatabaseStorage, id: number, cdekData: string): Promise<void> {
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
;

DatabaseStorage.prototype.updateOrderBitrixDealId = async function (this: DatabaseStorage, id: number, dealId: number): Promise<void> {
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
        logWarn("[Storage] bitrix_deal_id column not found in orders, skipping");
      } else {
        throw e;
      }
    }
  }
;

DatabaseStorage.prototype.getOrderBitrixDealId = async function (this: DatabaseStorage, id: number): Promise<number | null> {
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
      logWarn(`[Storage] Error getting bitrix deal ID for order ${id}:`, e.message);
      return null;
    }
  }
;

DatabaseStorage.prototype.incrementPreorderCurrent = async function (this: DatabaseStorage, productId: number): Promise<number> {
    const product = await this.getProduct(productId);
    if (!product) throw new Error('Product not found');
    const newCurrent = ((product as any).preorderCurrent || 0) + 1;
    await this.updateProduct(productId, { preorderCurrent: newCurrent } as any);
    return newCurrent;
  }
;

DatabaseStorage.prototype.updatePreorderStatus = async function (this: DatabaseStorage, productId: number, status: string): Promise<void> {
    await this.updateProduct(productId, { preorderStatus: status } as any);
  }
;

DatabaseStorage.prototype.getPreorderProducts = async function (this: DatabaseStorage, ): Promise<Product[]> {
    const allProducts = await this.getProducts();
    return allProducts.filter((p: any) => p.preorderEnabled === true && !p.isHidden);
  }
;

DatabaseStorage.prototype.getWholesalePreorderProducts = async function (this: DatabaseStorage, ): Promise<Product[]> {
    const allProducts = await this.getProducts();
    return allProducts.filter((p: any) => p.wholesalePreorderEnabled === true && !p.isHidden);
  }
;

DatabaseStorage.prototype.createPreorderOrder = async function (this: DatabaseStorage, order: InsertOrder & { items: any[], total: number, userId?: number, depositAmount: number }): Promise<Order> {
    const createdOrder = await this.createOrder(order as any);
    await this.updateOrderPreorderFields(createdOrder.id, {
      isPreorder: true,
      depositPaid: false,
      remainingAmount: order.total - order.depositAmount,
    });
    return createdOrder;
  }
;

DatabaseStorage.prototype.updateOrderPreorderFields = async function (this: DatabaseStorage, orderId: number, fields: { depositPaid?: boolean; remainingAmount?: number; preorderPaymentId?: string; isPreorder?: boolean }): Promise<void> {
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
;

DatabaseStorage.prototype.updateOrderAddonData = async function (this: DatabaseStorage, orderId: number, addonData: string): Promise<void> {
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
;

DatabaseStorage.prototype.updateOrderItems = async function (this: DatabaseStorage, orderId: number, items: any[], totalKopeks: number): Promise<void> {
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
;

DatabaseStorage.prototype.appendOrderItems = async function (this: DatabaseStorage, orderId: number, newItems: any[], addedTotal: number): Promise<void> {
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
;

DatabaseStorage.prototype.getPreorderOrdersByUser = async function (this: DatabaseStorage, userId: number): Promise<Order[]> {
    const allOrders = await this.getOrders();
    return allOrders.filter((o: any) => o.userId === userId && o.isPreorder === true);
  }
;

DatabaseStorage.prototype.updateOrderUserId = async function (this: DatabaseStorage, orderId: number, userId: number): Promise<boolean> {
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
      logError(`[Storage] updateOrderUserId error for order ${orderId}:`, err.message);
      return false;
    }
  }
;

DatabaseStorage.prototype.getWholesaleOrdersWithoutUserId = async function (this: DatabaseStorage, ): Promise<any[]> {
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
;

DatabaseStorage.prototype.saveOrderInvoiceNumber = async function (this: DatabaseStorage, orderId: number, invoiceNumber: number): Promise<void> {
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
;

DatabaseStorage.prototype.deleteOrder = async function (this: DatabaseStorage, id: number): Promise<boolean> {
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
      logError('[Storage] deleteOrder error:', err.message);
      return false;
    }
  }
;

DatabaseStorage.prototype.getDraftOrders = async function (this: DatabaseStorage, ): Promise<any[]> {
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
;

DatabaseStorage.prototype.deleteExpiredDraftOrders = async function (this: DatabaseStorage, maxAgeMinutes: number): Promise<number> {
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
          logWarn(`[Cleanup] Invalid date for draft order ${id}, skipping`);
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
      logError('[Cleanup] Error deleting expired drafts:', err.message);
      return 0;
    }
  }
;

DatabaseStorage.prototype.createOrder = async function (this: DatabaseStorage, order: InsertOrder & { items: any[], total: number, promoCode?: string, isWholesale?: boolean, transportCompany?: string, userId?: number, partnerId?: number, cdekPointCode?: string, cdekCityCode?: number, cdekTariffCode?: number, cdekDeliveryType?: string, cdekDoorAddress?: { street: string; house: string; flat?: string; entrance?: string; floor?: string }, ozonPvzId?: string, ozonPvzAddress?: string }): Promise<Order> {
    if (!driver) {
      logError('[Storage] YDB driver not initialized for createOrder');
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
          deliveryService: order.deliveryService || "cdek",
          pointCode: order.cdekPointCode || null,
          cityCode: order.cdekCityCode || null,
          tariffCode: order.cdekTariffCode || null,
          deliveryType: order.cdekDeliveryType || "pickup",
          doorAddress: order.cdekDoorAddress || null,
          orderUuid: null,
          ozonPvzId: order.ozonPvzId || null,
          ozonPvzAddress: order.ozonPvzAddress || null,
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
            logWarn("[Storage] Some columns missing in orders table, falling back to basic insert");
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
      logError('[Storage] Error creating order:', error);
      throw error;
    }
  }
;
