// Settings storage: bonus_settings, page_settings, loyalty, newsletter/preorder subscribers.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import ydb from "ydb-sdk";
import { driver } from "../db";
import { logError, logWarn } from "../logger";
import type {
  LoyaltyTier, InsertLoyaltyTier,
  NewsletterSubscription, InsertNewsletterSubscription,
} from "@shared/schema";
import { DatabaseStorage, pageSettingsCache, isLoyaltyCountedStatus, safeParseJson } from "./core";
import type { PickupPoint } from "./core";

declare module "./core" {
  interface DatabaseStorage {
    getLoyaltyTiers(): Promise<LoyaltyTier[]> ;
    createLoyaltyTier(tier: InsertLoyaltyTier): Promise<LoyaltyTier> ;
    updateLoyaltyTier(id: number, updates: Partial<LoyaltyTier>): Promise<LoyaltyTier> ;
    deleteLoyaltyTier(id: number): Promise<boolean> ;
    getNewsletterSubscription(email: string): Promise<NewsletterSubscription | undefined> ;
    createNewsletterSubscription(sub: InsertNewsletterSubscription): Promise<NewsletterSubscription> ;
    getAllNewsletterSubscriptions(): Promise<NewsletterSubscription[]> ;
    deleteNewsletterSubscription(id: number): Promise<boolean> ;
    addPreorderSubscriber(email: string, name?: string): Promise<void> ;
    getPreorderSubscriberByEmail(email: string): Promise<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean } | undefined> ;
    getAllPreorderSubscribers(): Promise<Array<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean }>> ;
    updatePreorderSubscriberStatus(email: string, isActive: boolean): Promise<void> ;
    getUsersWithLoyalty(): Promise<Array<{ id: number; name: string; email: string; totalSpent: number; loyaltyDiscount: number }>> ;
    getBonusSetting(key: string): Promise<string | undefined> ;
    setBonusSetting(key: string, value: string): Promise<void> ;
    getAllBonusSettings(): Promise<Record<string, string>> ;
    getPickupPoints(): Promise<PickupPoint[]> ;
    savePickupPoints(points: PickupPoint[]): Promise<void> ;
    getRetailPickupPoints(): Promise<PickupPoint[]> ;
    saveRetailPickupPoints(points: PickupPoint[]): Promise<void> ;
    updateUserTotalSpent(userId: number, amount: number): Promise<void> ;
    recalculateUserLoyaltyDiscount(userId: number): Promise<number> ;
    getUserTotalSpent(userId: number): Promise<number> ;
    setUserTotalSpent(userId: number, amount: number): Promise<void> ;
    decrementUserTotalSpent(userId: number, amount: number): Promise<void> ;
    accrueOrderLoyalty(orderId: number): Promise<{ accrued: boolean; discount: number }> ;
    revokeOrderLoyalty(orderId: number): Promise<{ revoked: boolean; discount: number }> ;
    getGuestOrdersByEmail(email: string): Promise<number[]> ;
    mergeGuestOrdersToUser(userId: number, email: string): Promise<{ linked: number; accrued: number }> ;
    recalculateAllUsersLoyalty(): Promise<{ total: number; updated: number }> ;
    getPageSettings(pageName: string): Promise<Record<string, any>> ;
    fetchPageSettingsFromYdb(pageName: string): Promise<Record<string, any> | null> ;
    setPageSectionSettings(pageName: string, sectionId: string, settings: any): Promise<void> ;
    deletePageSectionSettings(pageName: string, sectionId: string): Promise<void> ;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.getLoyaltyTiers = async function (this: DatabaseStorage): Promise<LoyaltyTier[]>  {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM loyalty_tiers ORDER BY min_spent ASC`);
      return this.parseResultSet<LoyaltyTier>(resultSets[0]);
    });
    return result || [];
  }
;

DatabaseStorage.prototype.createLoyaltyTier = async function (this: DatabaseStorage, tier: InsertLoyaltyTier): Promise<LoyaltyTier>  {
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
;

DatabaseStorage.prototype.updateLoyaltyTier = async function (this: DatabaseStorage, id: number, updates: Partial<LoyaltyTier>): Promise<LoyaltyTier>  {
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
;

DatabaseStorage.prototype.deleteLoyaltyTier = async function (this: DatabaseStorage, id: number): Promise<boolean>  {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM loyalty_tiers WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }

  // Newsletter subscriptions;

DatabaseStorage.prototype.getNewsletterSubscription = async function (this: DatabaseStorage, email: string): Promise<NewsletterSubscription | undefined>  {
    if (!driver) return undefined;
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import("ydb-sdk");
      const query = "DECLARE $email AS Utf8; SELECT * FROM newsletter_subscriptions WHERE email = $email";
      const { resultSets } = await session.executeQuery(query, { $email: TypedValues.utf8(email) });
      return this.parseResultSet<NewsletterSubscription>(resultSets[0])[0];
    });
    return result ?? undefined;
  }
;

DatabaseStorage.prototype.createNewsletterSubscription = async function (this: DatabaseStorage, sub: InsertNewsletterSubscription): Promise<NewsletterSubscription>  {
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
;

DatabaseStorage.prototype.getAllNewsletterSubscriptions = async function (this: DatabaseStorage): Promise<NewsletterSubscription[]>  {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const query = "SELECT * FROM newsletter_subscriptions ORDER BY subscribed_at DESC LIMIT 5000";
      const { resultSets } = await session.executeQuery(query, {});
      return this.parseResultSet<NewsletterSubscription>(resultSets[0]);
    });
    return result || [];
  }
;

DatabaseStorage.prototype.deleteNewsletterSubscription = async function (this: DatabaseStorage, id: number): Promise<boolean>  {
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
;

DatabaseStorage.prototype.addPreorderSubscriber = async function (this: DatabaseStorage, email: string, name?: string): Promise<void>  {
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
;

DatabaseStorage.prototype.getPreorderSubscriberByEmail = async function (this: DatabaseStorage, email: string): Promise<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean } | undefined>  {
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
;

DatabaseStorage.prototype.getAllPreorderSubscribers = async function (this: DatabaseStorage): Promise<Array<{ id: string; email: string; name?: string; subscribedAt: string; isActive: boolean }>>  {
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
;

DatabaseStorage.prototype.updatePreorderSubscriberStatus = async function (this: DatabaseStorage, email: string, isActive: boolean): Promise<void>  {
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
;

DatabaseStorage.prototype.getUsersWithLoyalty = async function (this: DatabaseStorage): Promise<Array<{ id: number; name: string; email: string; totalSpent: number; loyaltyDiscount: number }>>  {
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

  // Bonus settings;

DatabaseStorage.prototype.getBonusSetting = async function (this: DatabaseStorage, key: string): Promise<string | undefined>  {
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
;

DatabaseStorage.prototype.setBonusSetting = async function (this: DatabaseStorage, key: string, value: string): Promise<void>  {
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
;

DatabaseStorage.prototype.getAllBonusSettings = async function (this: DatabaseStorage): Promise<Record<string, string>>  {
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
;

DatabaseStorage.prototype.getPickupPoints = async function (this: DatabaseStorage): Promise<PickupPoint[]>  {
    const raw = await this.getBonusSetting("preorder_pickup_points");
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PickupPoint[];
    } catch {
      return [];
    }
  }
;

DatabaseStorage.prototype.savePickupPoints = async function (this: DatabaseStorage, points: PickupPoint[]): Promise<void>  {
    await this.setBonusSetting("preorder_pickup_points", JSON.stringify(points));
  }
;

DatabaseStorage.prototype.getRetailPickupPoints = async function (this: DatabaseStorage): Promise<PickupPoint[]>  {
    const raw = await this.getBonusSetting("retail_pickup_points");
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PickupPoint[];
    } catch {
      return [];
    }
  }
;

DatabaseStorage.prototype.saveRetailPickupPoints = async function (this: DatabaseStorage, points: PickupPoint[]): Promise<void>  {
    await this.setBonusSetting("retail_pickup_points", JSON.stringify(points));
  }

  // User loyalty;

DatabaseStorage.prototype.updateUserTotalSpent = async function (this: DatabaseStorage, userId: number, amount: number): Promise<void>  {
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
;

DatabaseStorage.prototype.recalculateUserLoyaltyDiscount = async function (this: DatabaseStorage, userId: number): Promise<number>  {
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
;

DatabaseStorage.prototype.getUserTotalSpent = async function (this: DatabaseStorage, userId: number): Promise<number>  {
    if (!driver) return 0;
    const { TypedValues, Types } = await import("ydb-sdk");
    const userData = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $id AS Utf8; SELECT total_spent FROM users WHERE id = $id LIMIT 1`,
        { '$id': TypedValues.fromNative(Types.UTF8, String(userId)) }
      );
      return this.parseResultSet<{ totalSpent: number }>(resultSets[0])[0];
    });
    return Number(userData?.totalSpent) || 0;
  }
;

DatabaseStorage.prototype.setUserTotalSpent = async function (this: DatabaseStorage, userId: number, amount: number): Promise<void>  {
    if (!driver) return;
    const value = Math.max(0, Math.round(amount));
    await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      await session.executeQuery(
        `DECLARE $id AS Utf8; DECLARE $amount AS Int32; UPDATE users SET total_spent = $amount WHERE id = $id`,
        {
          '$id': TypedValues.fromNative(Types.UTF8, String(userId)),
          '$amount': TypedValues.int32(value),
        }
      );
    });
  }
;

DatabaseStorage.prototype.decrementUserTotalSpent = async function (this: DatabaseStorage, userId: number, amount: number): Promise<void>  {
    const current = await this.getUserTotalSpent(userId);
    await this.setUserTotalSpent(userId, current - amount);
  }

  // Начисляет total_spent за оплаченный заказ ровно один раз (флаг loyaltyAccruedAt).;

DatabaseStorage.prototype.accrueOrderLoyalty = async function (this: DatabaseStorage, orderId: number): Promise<{ accrued: boolean; discount: number }>  {
    const order = await this.getOrder(orderId);
    if (!order || !order.userId || order.isWholesale) return { accrued: false, discount: 0 };
    if (!isLoyaltyCountedStatus(order.status)) return { accrued: false, discount: 0 };

    const addon = safeParseJson(order.addonData);
    if (addon.loyaltyAccruedAt) return { accrued: false, discount: 0 };

    await this.updateUserTotalSpent(order.userId, order.total);
    const discount = await this.recalculateUserLoyaltyDiscount(order.userId);
    await this.updateOrderAddonData(
      orderId,
      JSON.stringify({ ...addon, loyaltyAccruedAt: new Date().toISOString() }),
    );
    console.log(`[Loyalty] Accrued order ${orderId} for user ${order.userId}: +${order.total / 100} RUB, discount ${discount}%`);
    return { accrued: true, discount };
  }

  // Списывает total_spent при возврате/отмене ровно один раз (флаг loyaltyRevokedAt).;

DatabaseStorage.prototype.revokeOrderLoyalty = async function (this: DatabaseStorage, orderId: number): Promise<{ revoked: boolean; discount: number }>  {
    const order = await this.getOrder(orderId);
    if (!order || !order.userId || order.isWholesale) return { revoked: false, discount: 0 };

    const addon = safeParseJson(order.addonData);
    if (addon.loyaltyRevokedAt) return { revoked: false, discount: 0 };

    await this.decrementUserTotalSpent(order.userId, order.total);
    const discount = await this.recalculateUserLoyaltyDiscount(order.userId);
    await this.updateOrderAddonData(
      orderId,
      JSON.stringify({ ...addon, loyaltyRevokedAt: new Date().toISOString() }),
    );
    console.log(`[Loyalty] Revoked order ${orderId} for user ${order.userId}: -${order.total / 100} RUB, discount ${discount}%`);
    return { revoked: true, discount };
  }
;

DatabaseStorage.prototype.getGuestOrdersByEmail = async function (this: DatabaseStorage, email: string): Promise<number[]>  {
    if (!driver) return [];
    const result = await this.safeQuery(async (session) => {
      const { TypedValues, Types } = await import("ydb-sdk");
      const { resultSets } = await session.executeQuery(
        `DECLARE $email AS Utf8;
         SELECT id FROM orders
         WHERE customer_email = $email AND user_id IS NULL
         ORDER BY created_at ASC`,
        { '$email': TypedValues.fromNative(Types.UTF8, email) }
      );
      return resultSets[0]?.rows || [];
    });
    if (!result) return [];
    return result.map((row: any) => Number(this.extractTypedValue(row.items[0]))).filter((n: number) => Number.isFinite(n) && n > 0);
  }

  // Привязывает гостевые заказы к аккаунту и начисляет за них лояльность (если оплачены).;

DatabaseStorage.prototype.mergeGuestOrdersToUser = async function (this: DatabaseStorage, userId: number, email: string): Promise<{ linked: number; accrued: number }>  {
    const normalized = (email || '').toLowerCase().trim();
    if (!normalized) return { linked: 0, accrued: 0 };

    const ids = await this.getGuestOrdersByEmail(normalized);
    let linked = 0;
    let accrued = 0;
    for (const orderId of ids) {
      const ok = await this.updateOrderUserId(orderId, userId);
      if (!ok) continue;
      linked++;
      const res = await this.accrueOrderLoyalty(orderId);
      if (res.accrued) accrued++;
    }
    if (linked > 0) {
      console.log(`[Loyalty] Merged ${linked} guest orders for user ${userId} (${normalized}), accrued ${accrued}`);
    }
    return { linked, accrued };
  }

  // Полный пересчёт total_spent и loyalty_discount для всех retail-пользователей по истории заказов.
  // Считает заказы и по user_id, и по email (гостевые), как админка «Клиенты» — иначе
  // сумма в профиле (342k) расходится с накопленной в колонке total_spent.;

DatabaseStorage.prototype.recalculateAllUsersLoyalty = async function (this: DatabaseStorage): Promise<{ total: number; updated: number }>  {
    if (!driver) return { total: 0, updated: 0 };

    // Retail (включая admin, но без wholesale): email -> userId
    const userRows = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT id, email FROM users WHERE role != 'wholesale' OR role IS NULL`
      );
      return resultSets[0]?.rows || [];
    });
    const emailToUserId = new Map<string, number>();
    if (userRows) {
      for (const row of userRows as any[]) {
        const userId = Number(this.extractTypedValue(row.items[0]));
        const email = String(this.extractTypedValue(row.items[1]) || '').toLowerCase().trim();
        if (Number.isFinite(userId) && userId > 0 && email) {
          emailToUserId.set(email, userId);
        }
      }
    }

    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT user_id, customer_email, total, status, is_wholesale FROM orders`
      );
      return resultSets[0]?.rows || [];
    });
    if (!result) return { total: 0, updated: 0 };

    const totalsByUser = new Map<number, number>();
    for (const row of result as any[]) {
      const rawUserId = Number(this.extractTypedValue(row.items[0]));
      const email = String(this.extractTypedValue(row.items[1]) || '').toLowerCase().trim();
      const total = Number(this.extractTypedValue(row.items[2])) || 0;
      const status = String(this.extractTypedValue(row.items[3]) || '');
      const isWholesale = this.extractTypedValue(row.items[4]) === true;
      if (isWholesale) continue;
      if (!isLoyaltyCountedStatus(status)) continue;

      let userId = rawUserId;
      if (!Number.isFinite(userId) || userId <= 0) {
        userId = emailToUserId.get(email) || 0;
      }
      if (!Number.isFinite(userId) || userId <= 0) continue;

      totalsByUser.set(userId, (totalsByUser.get(userId) || 0) + total);
    }

    let updated = 0;
    for (const [userId, totalSpent] of totalsByUser) {
      await this.setUserTotalSpent(userId, totalSpent);
      await this.recalculateUserLoyaltyDiscount(userId);
      updated++;
    }
    console.log(`[Loyalty] Bulk recalc done: ${updated} users updated`);
    return { total: totalsByUser.size, updated };
  }

  // Page settings;

DatabaseStorage.prototype.getPageSettings = async function (this: DatabaseStorage, pageName: string): Promise<Record<string, any>>  {
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
            logWarn(`[Cache] pageSettings(${pageName}) YDB error on stale refresh — keeping old cache`);
          }
          pageSettingsCache.setRefreshing(pageName, false);
        }).catch(err => {
          pageSettingsCache.setRefreshing(pageName, false);
          logError(`[Cache] pageSettings(${pageName}) refresh failed:`, err);
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
    logWarn(`[Cache] pageSettings(${pageName}) YDB error on MISS — returning {} without caching`);
    return {};
  }
;

DatabaseStorage.prototype.fetchPageSettingsFromYdb = async function (this: DatabaseStorage, pageName: string): Promise<Record<string, any> | null>  {
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
;

DatabaseStorage.prototype.setPageSectionSettings = async function (this: DatabaseStorage, pageName: string, sectionId: string, settings: any): Promise<void>  {
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
;

DatabaseStorage.prototype.deletePageSectionSettings = async function (this: DatabaseStorage, pageName: string, sectionId: string): Promise<void>  {
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
;
