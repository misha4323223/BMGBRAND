// Wholesale feed storage (2.4.6b).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";

declare module "./core" {
  interface DatabaseStorage {
    getWholesaleFeedProductIds(userId: number): Promise<number[]>;
    addWholesaleFeedProduct(userId: number, productId: number): Promise<void>;
    removeWholesaleFeedProduct(userId: number, productId: number): Promise<void>;
    getOrCreateWholesaleFeedToken(userId: number): Promise<string>;
    getUserIdByWholesaleFeedToken(token: string): Promise<number | null>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.getWholesaleFeedProductIds = async function (this: DatabaseStorage, userId: number): Promise<number[]> {
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
;

DatabaseStorage.prototype.addWholesaleFeedProduct = async function (this: DatabaseStorage, userId: number, productId: number): Promise<void> {
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
;

DatabaseStorage.prototype.removeWholesaleFeedProduct = async function (this: DatabaseStorage, userId: number, productId: number): Promise<void> {
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
;

DatabaseStorage.prototype.getOrCreateWholesaleFeedToken = async function (this: DatabaseStorage, userId: number): Promise<string> {
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
;

DatabaseStorage.prototype.getUserIdByWholesaleFeedToken = async function (this: DatabaseStorage, token: string): Promise<number | null> {
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
;
