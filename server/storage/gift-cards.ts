// Gift cards storage (2.4.4a): create/redeem/update gift cards, migrations.
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { driver } from "../db";
import { logError } from "../logger";
import type { GiftCard, InsertGiftCard } from "@shared/schema";
import { DatabaseStorage } from "./core";
import ydb from "ydb-sdk";

declare module "./core" {
  interface DatabaseStorage {
    generateGiftCardCode(): string;
    createGiftCard(card: InsertGiftCard): Promise<GiftCard>;
    getGiftCardByCode(code: string): Promise<GiftCard | undefined>;
    getGiftCardById(id: number): Promise<GiftCard | undefined>;
    updateGiftCard(id: number, updates: Partial<GiftCard>): Promise<GiftCard>;
    getGiftCardsByEmail(email: string): Promise<GiftCard[]>;
    getGiftCards(): Promise<GiftCard[]>;
    deleteGiftCard(id: number): Promise<boolean>;
    redeemGiftCard(code: string, userId: number, amount: number): Promise<GiftCard>;
    parseGiftCardFromData(data: Record<string, any>): GiftCard;
    migrateGiftCardsTable(): Promise<{ success: boolean; message: string }>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.generateGiftCardCode = function (this: DatabaseStorage, ): string {
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
;

DatabaseStorage.prototype.createGiftCard = async function (this: DatabaseStorage, card: InsertGiftCard): Promise<GiftCard> {
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
;

DatabaseStorage.prototype.getGiftCardByCode = async function (this: DatabaseStorage, code: string): Promise<GiftCard | undefined> {
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
;

DatabaseStorage.prototype.getGiftCardById = async function (this: DatabaseStorage, id: number): Promise<GiftCard | undefined> {
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
;

DatabaseStorage.prototype.updateGiftCard = async function (this: DatabaseStorage, id: number, updates: Partial<GiftCard>): Promise<GiftCard> {
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
;

DatabaseStorage.prototype.getGiftCardsByEmail = async function (this: DatabaseStorage, email: string): Promise<GiftCard[]> {
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
;

DatabaseStorage.prototype.getGiftCards = async function (this: DatabaseStorage, ): Promise<GiftCard[]> {
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
;

DatabaseStorage.prototype.deleteGiftCard = async function (this: DatabaseStorage, id: number): Promise<boolean> {
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DELETE FROM gift_cards WHERE id = $id
      `, { '$id': ydb.TypedValues.int64(id) });
    });
    return true;
  }
;

DatabaseStorage.prototype.redeemGiftCard = async function (this: DatabaseStorage, code: string, userId: number, amount: number): Promise<GiftCard> {
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
;

DatabaseStorage.prototype.parseGiftCardFromData = function (this: DatabaseStorage, data: Record<string, any>): GiftCard {
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
;

DatabaseStorage.prototype.migrateGiftCardsTable = async function (this: DatabaseStorage, ): Promise<{ success: boolean; message: string }> {
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
      logError("[Migration Error]:", err.message);
      return { success: false, message: err.message || String(err) };
    }
  }
;
