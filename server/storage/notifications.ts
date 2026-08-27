// Notifications storage (2.4.4d): stock back-in-stock + price-drop subscriptions.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import { logError } from "../logger";
import { DatabaseStorage } from "./core";
import ydb from "ydb-sdk";

declare module "./core" {
  interface DatabaseStorage {
    _priceDropTableReady: boolean;
    createStockNotification(productId: number, productName: string, size: string, email: string): Promise<boolean>;
    getStockNotificationCount(productId: number, size?: string): Promise<number>;
    getUnnotifiedByProductAndSize(productId: number, size: string): Promise<Array<{ id: string; email: string }>>;
    markStockNotificationsNotified(ids: string[]): Promise<void>;
    getAllStockNotifications(): Promise<Array<{ id: string; productId: string; productName: string; size: string; email: string; createdAt: string; notified: boolean; notifiedAt: string | null }>>;
    ensurePriceDropTable(): Promise<void>;
    createPriceDropSubscription(productId: number, productName: string, email: string, priceAtSubscription: number): Promise<boolean>;
    getSubscribedProductIdsByEmail(email: string): Promise<number[]>;
    checkPriceDropSubscription(productId: number, email: string): Promise<boolean>;
    getAllPriceDropSubscriptions(): Promise<Array<{ id: string; productId: string; productName: string; email: string; priceAtSubscription: number; createdAt: string; notified: boolean; notifiedAt: string | null }>>;
    getPriceDropSubscribersByProduct(productId: number): Promise<Array<{ id: string; email: string; priceAtSubscription: number }>>;
    markPriceDropSubscriptionsNotified(ids: string[], newPrice: number): Promise<void>;
    getPriceDropSubscriptionsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; priceAtSubscription: number; createdAt: string }>>;
    deletePriceDropSubscription(productId: number, email: string): Promise<void>;
    getStockNotificationsByEmail(email: string): Promise<Array<{ id: string; productId: number; productName: string; size: string; createdAt: string }>>;
    deleteStockNotification(productId: number, size: string, email: string): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.createStockNotification = async function (this: DatabaseStorage, productId: number, productName: string, size: string, email: string): Promise<boolean> {
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
;

DatabaseStorage.prototype.getStockNotificationCount = async function (this: DatabaseStorage, productId: number, size?: string): Promise<number> {
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
;

DatabaseStorage.prototype.getUnnotifiedByProductAndSize = async function (this: DatabaseStorage, productId: number, size: string): Promise<Array<{ id: string; email: string }>> {
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
;

DatabaseStorage.prototype.markStockNotificationsNotified = async function (this: DatabaseStorage, ids: string[]): Promise<void> {
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
;

DatabaseStorage.prototype.getAllStockNotifications = async function (this: DatabaseStorage, ): Promise<Array<{ id: string; productId: string; productName: string; size: string; email: string; createdAt: string; notified: boolean; notifiedAt: string | null }>> {
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
;

DatabaseStorage.prototype.ensurePriceDropTable = async function (this: DatabaseStorage, ): Promise<void> {
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
        logError("[PriceDrop] Failed to ensure table:", err.message);
      }
    }
  }
;

DatabaseStorage.prototype.createPriceDropSubscription = async function (this: DatabaseStorage, productId: number, productName: string, email: string, priceAtSubscription: number): Promise<boolean> {
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
;

DatabaseStorage.prototype.getSubscribedProductIdsByEmail = async function (this: DatabaseStorage, email: string): Promise<number[]> {
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
;

DatabaseStorage.prototype.checkPriceDropSubscription = async function (this: DatabaseStorage, productId: number, email: string): Promise<boolean> {
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
;

DatabaseStorage.prototype.getAllPriceDropSubscriptions = async function (this: DatabaseStorage, ): Promise<Array<{ id: string; productId: string; productName: string; email: string; priceAtSubscription: number; createdAt: string; notified: boolean; notifiedAt: string | null }>> {
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
;

DatabaseStorage.prototype.getPriceDropSubscribersByProduct = async function (this: DatabaseStorage, productId: number): Promise<Array<{ id: string; email: string; priceAtSubscription: number }>> {
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
;

DatabaseStorage.prototype.markPriceDropSubscriptionsNotified = async function (this: DatabaseStorage, ids: string[], newPrice: number): Promise<void> {
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
;

DatabaseStorage.prototype.getPriceDropSubscriptionsByEmail = async function (this: DatabaseStorage, email: string): Promise<Array<{ id: string; productId: number; productName: string; priceAtSubscription: number; createdAt: string }>> {
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
;

DatabaseStorage.prototype.deletePriceDropSubscription = async function (this: DatabaseStorage, productId: number, email: string): Promise<void> {
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
;

DatabaseStorage.prototype.getStockNotificationsByEmail = async function (this: DatabaseStorage, email: string): Promise<Array<{ id: string; productId: number; productName: string; size: string; createdAt: string }>> {
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
;

DatabaseStorage.prototype.deleteStockNotification = async function (this: DatabaseStorage, productId: number, size: string, email: string): Promise<void> {
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
;
