// Cart reminders storage (2.4.6c).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import { driver } from "../db";
import { logError } from "../logger";
import ydb from "ydb-sdk";

declare module "./core" {
  interface DatabaseStorage {
    ensureCartRemindersTable(): Promise<void>;
    getAbandonedCartUserSessions(): Promise<string[]>;
    getCartSessionDates(): Promise<Record<string, number>>;
    getUserEmailById(userId: number): Promise<{ name: string; email: string } | null>;
    getCartReminder(userId: number): Promise<{ sentAt: string; cartHash: string } | null>;
    upsertCartReminder(userId: number, cartHash: string): Promise<void>;
    clearCartReminders(): Promise<number>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.ensureCartRemindersTable = async function (this: DatabaseStorage, ): Promise<void> {
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
        logError('[CartReminders] Failed to ensure table:', err.message);
      }
    }
  }
;

DatabaseStorage.prototype.getAbandonedCartUserSessions = async function (this: DatabaseStorage, ): Promise<string[]> {
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
;

DatabaseStorage.prototype.getCartSessionDates = async function (this: DatabaseStorage, ): Promise<Record<string, number>> {
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
;

DatabaseStorage.prototype.getUserEmailById = async function (this: DatabaseStorage, userId: number): Promise<{ name: string; email: string } | null> {
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
;

DatabaseStorage.prototype.getCartReminder = async function (this: DatabaseStorage, userId: number): Promise<{ sentAt: string; cartHash: string } | null> {
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
;

DatabaseStorage.prototype.upsertCartReminder = async function (this: DatabaseStorage, userId: number, cartHash: string): Promise<void> {
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
;

DatabaseStorage.prototype.clearCartReminders = async function (this: DatabaseStorage, ): Promise<number> {
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
;
