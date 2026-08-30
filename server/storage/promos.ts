// Promo codes + bonus system migrations (2.4.4b): migrateBonusTables, promo CRUD, partner promos.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import { logError } from "../logger";
import type { PromoCode, InsertPromoCode } from "@shared/schema";
import { DatabaseStorage } from "./core";
import ydb from "ydb-sdk";

declare module "./core" {
  interface DatabaseStorage {
    migrateBonusTables(): Promise<{ success: boolean; message: string }>;
    getPromoCodes(): Promise<PromoCode[]>;
    getPromoCodeByCode(code: string): Promise<PromoCode | undefined>;
    createPromoCode(promo: InsertPromoCode): Promise<PromoCode>;
    updatePromoCode(id: number, updates: Partial<PromoCode>): Promise<PromoCode>;
    deletePromoCode(id: number): Promise<boolean>;
    deletePromoCodes(ids: number[]): Promise<number>;
    deactivateExpiredPromoCodes(): Promise<number>;
    incrementPromoCodeUsage(code: string): Promise<void>;
    isPromoUsedByEmail(email: string, code: string): Promise<boolean>;
    getPartnerPromoCode(partnerId: number): Promise<(PromoCode & { partnerId?: number }) | undefined>;
    setPartnerPromoCode(partnerId: number, code: string, discountPercent: number): Promise<PromoCode & { partnerId?: number }>;
    deletePartnerPromoCode(partnerId: number): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.migrateBonusTables = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
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
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.getPromoCodes = async function (this: DatabaseStorage, ): Promise<PromoCode[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM promo_codes ORDER BY created_at DESC`);
      return this.parseResultSet<PromoCode>(resultSets[0]);
    });
    return result || [];
  }
;

DatabaseStorage.prototype.getPromoCodeByCode = async function (this: DatabaseStorage, code: string): Promise<PromoCode | undefined> {
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
;

DatabaseStorage.prototype.createPromoCode = async function (this: DatabaseStorage, promo: InsertPromoCode): Promise<PromoCode> {
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
        DECLARE $app_only AS Bool;
        DECLARE $applicable_categories AS Optional<Utf8>;
        DECLARE $starts_at AS Optional<Datetime>;
        DECLARE $expires_at AS Optional<Datetime>;
        DECLARE $created_at AS Datetime;
        UPSERT INTO promo_codes (id, code, discount_percent, discount_amount, min_order_amount, max_uses, used_count, can_combine_with_loyalty, is_active, allow_for_wholesale, app_only, applicable_categories, starts_at, expires_at, created_at)
        VALUES ($id, $code, $discount_percent, $discount_amount, $min_order_amount, $max_uses, 0, $can_combine, $is_active, $allow_for_wholesale, $app_only, $applicable_categories, $starts_at, $expires_at, $created_at)
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
        '$app_only': ydb.TypedValues.bool(promo.appOnly === true),
        '$applicable_categories': applicableCategories ? ydb.TypedValues.optional(ydb.TypedValues.utf8(applicableCategories)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8),
        '$starts_at': startsAt ? ydb.TypedValues.optional(ydb.TypedValues.datetime(startsAt)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME),
        '$expires_at': expiresAt ? ydb.TypedValues.optional(ydb.TypedValues.datetime(expiresAt)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME),
        '$created_at': ydb.TypedValues.datetime(now),
      });
    });
    return { id, ...promo, code: promo.code.toUpperCase(), usedCount: 0, createdAt: now } as PromoCode;
  }
;

DatabaseStorage.prototype.updatePromoCode = async function (this: DatabaseStorage, id: number, updates: Partial<PromoCode>): Promise<PromoCode> {
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
    if (updates.appOnly !== undefined) { setParts.push('app_only = $ao'); params['$ao'] = ydb.TypedValues.bool(updates.appOnly!); }
    if ('applicableCategories' in updates) {
      const ac = updates.applicableCategories;
      const acStr = ac ? (typeof ac === 'string' ? ac : JSON.stringify(ac)) : null;
      setParts.push('applicable_categories = $ac');
      params['$ac'] = acStr ? ydb.TypedValues.optional(ydb.TypedValues.utf8(acStr)) : ydb.TypedValues.optionalNull(ydb.Types.UTF8);
    }
    if ('startsAt' in updates) {
      const sa = updates.startsAt;
      setParts.push('starts_at = $sa');
      params['$sa'] = sa ? ydb.TypedValues.optional(ydb.TypedValues.datetime(sa)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME);
    }
    if ('expiresAt' in updates) {
      const ea = updates.expiresAt;
      setParts.push('expires_at = $ea');
      params['$ea'] = ea ? ydb.TypedValues.optional(ydb.TypedValues.datetime(ea)) : ydb.TypedValues.optionalNull(ydb.Types.DATETIME);
    }
    
    if (setParts.length > 0) {
      const declares = Object.entries(params).map(([k, v]) => {
        const type = k === '$id' ? 'Uint64' : k === '$code' ? 'Utf8' : k === '$ccl' || k === '$ia' || k === '$afw' || k === '$ao' ? 'Bool' : k === '$ac' ? 'Optional<Utf8>' : k === '$sa' || k === '$ea' ? 'Optional<Datetime>' : 'Int32';
        return `DECLARE ${k} AS ${type};`;
      }).join('\n');
      
      await this.safeQuery(async (session) => {
        await session.executeQuery(`${declares}\nUPDATE promo_codes SET ${setParts.join(', ')} WHERE id = $id`, params);
      });
    }
    const updated = await this.getPromoCodes();
    return updated.find(p => p.id === id) as PromoCode;
  }
;

DatabaseStorage.prototype.deletePromoCode = async function (this: DatabaseStorage, id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM promo_codes WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }
;

DatabaseStorage.prototype.deletePromoCodes = async function (this: DatabaseStorage, ids: number[]): Promise<number> {
    const uniqueIds = ids ? [...new Set(ids.map(Number).filter(Boolean))] : [];
    if (uniqueIds.length === 0) return 0;
    await this.safeQuery(async (session) => {
      const params: Record<string, any> = {};
      const declares: string[] = [];
      uniqueIds.forEach((id, i) => {
        const k = `$id${i}`;
        params[k] = ydb.TypedValues.uint64(id);
        declares.push(`DECLARE ${k} AS Uint64;`);
      });
      await session.executeQuery(`${declares.join('\n')}\nDELETE FROM promo_codes WHERE id IN (${Object.keys(params).join(', ')})`, params);
    });
    return uniqueIds.length;
  }
;

DatabaseStorage.prototype.deactivateExpiredPromoCodes = async function (this: DatabaseStorage): Promise<number> {
    const expired = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $now AS Datetime;
         SELECT id FROM promo_codes
         WHERE expires_at IS NOT NULL AND expires_at < $now AND is_active = true`,
        { '$now': ydb.TypedValues.datetime(new Date()) }
      );
      return this.parseResultSet<{ id: number }>(resultSets[0]);
    });
    const ids = (expired || []).map(r => Number(r.id));
    if (ids.length === 0) return 0;
    await this.safeQuery(async (session) => {
      const params: Record<string, any> = {};
      const declares: string[] = [];
      ids.forEach((id, i) => {
        const k = `$id${i}`;
        params[k] = ydb.TypedValues.uint64(id);
        declares.push(`DECLARE ${k} AS Uint64;`);
      });
      await session.executeQuery(`${declares.join('\n')}\nUPDATE promo_codes SET is_active = false WHERE id IN (${Object.keys(params).join(', ')})`, params);
    });
    return ids.length;
  }
;

DatabaseStorage.prototype.incrementPromoCodeUsage = async function (this: DatabaseStorage, code: string): Promise<void> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $code AS Utf8;
        UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $code
      `, { '$code': ydb.TypedValues.utf8(code.toUpperCase()) });
    });
  }
;

DatabaseStorage.prototype.isPromoUsedByEmail = async function (this: DatabaseStorage, email: string, code: string): Promise<boolean> {
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
;

DatabaseStorage.prototype.getPartnerPromoCode = async function (this: DatabaseStorage, partnerId: number): Promise<(PromoCode & { partnerId?: number }) | undefined> {
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
;

DatabaseStorage.prototype.setPartnerPromoCode = async function (this: DatabaseStorage, partnerId: number, code: string, discountPercent: number): Promise<PromoCode & { partnerId?: number }> {
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
;

DatabaseStorage.prototype.deletePartnerPromoCode = async function (this: DatabaseStorage, partnerId: number): Promise<void> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $partner_id AS Uint64;
         DELETE FROM promo_codes WHERE partner_id = $partner_id`,
        { '$partner_id': ydb.TypedValues.uint64(partnerId) },
      );
    });
  }
;
