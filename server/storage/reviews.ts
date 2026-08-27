// Reviews storage (2.4.4c): review CRUD + reviews table migration.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import { logError } from "../logger";
import type { Review, InsertReview } from "@shared/schema";
import { DatabaseStorage } from "./core";
import ydb from "ydb-sdk";

declare module "./core" {
  interface DatabaseStorage {
    migrateReviewsTable(): Promise<{ success: boolean; message: string }>;
    getReviewsByProduct(productId: number): Promise<Review[]>;
    getReviewById(id: number): Promise<Review | undefined>;
    getAllReviews(): Promise<Review[]>;
    createReview(review: InsertReview): Promise<Review>;
    updateReview(id: number, updates: Partial<Review>): Promise<Review>;
    deleteReview(id: number): Promise<boolean>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.migrateReviewsTable = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
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
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;

DatabaseStorage.prototype.getReviewsByProduct = async function (this: DatabaseStorage, productId: number): Promise<Review[]> {
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
;

DatabaseStorage.prototype.getReviewById = async function (this: DatabaseStorage, id: number): Promise<Review | undefined> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $id AS Uint64; SELECT * FROM reviews WHERE id = $id LIMIT 1`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
      const rows = this.parseResultSet<Review>(resultSets[0]);
      const row = rows[0];
      if (!row) return undefined;
      return {
        ...row,
        photos: row.photos ? (typeof row.photos === 'string' ? JSON.parse(row.photos) : row.photos) : [],
      };
    });
    return result || undefined;
  }
;

DatabaseStorage.prototype.getAllReviews = async function (this: DatabaseStorage, ): Promise<Review[]> {
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`SELECT * FROM reviews ORDER BY created_at DESC`);
      return this.parseResultSet<Review>(resultSets[0]);
    });
    return result || [];
  }
;

DatabaseStorage.prototype.createReview = async function (this: DatabaseStorage, review: InsertReview): Promise<Review> {
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
;

DatabaseStorage.prototype.updateReview = async function (this: DatabaseStorage, id: number, updates: Partial<Review>): Promise<Review> {
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
;

DatabaseStorage.prototype.deleteReview = async function (this: DatabaseStorage, id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM reviews WHERE id = $id`,
        { '$id': ydb.TypedValues.uint64(id) }
      );
    });
    return true;
  }
;
