// Chat storage (2.4.6a).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import { logError } from "../logger";

declare module "./core" {
  interface DatabaseStorage {
    saveChatMessage(msg: { messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; tgMessageId?: number; vkMessageId?: number; imageUrl?: string }): Promise<void>;
    getChatMessages(sessionId: string, since?: number): Promise<Array<{ messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; imageUrl?: string }>>;
    getSessionIdByTgMessageId(tgMessageId: number): Promise<string | null>;
    getSessionIdByVkMessageId(vkMessageId: number): Promise<string | null>;
    debugChatTable(): Promise<{ rowCount: number; sampleRows: any[] }>;
    getChatSessions(): Promise<Array<{ sessionId: string; lastMessage: string; lastTimestamp: number; userName?: string; unread?: number }>>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.saveChatMessage = async function (this: DatabaseStorage, msg: { messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; tgMessageId?: number; vkMessageId?: number; imageUrl?: string }): Promise<void> {
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
      logError("[Chat] saveChatMessage: safeQuery returned null (driver not ready or query failed)");
    } else {
      console.log(`[Chat] Saved message ${msg.messageId.slice(0, 8)} for session ${msg.sessionId.slice(0, 8)}`);
    }
  }
;

DatabaseStorage.prototype.getChatMessages = async function (this: DatabaseStorage, sessionId: string, since?: number): Promise<Array<{ messageId: string; sessionId: string; sender: string; text: string; timestamp: number; userId?: string; userName?: string; imageUrl?: string }>> {
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
;

DatabaseStorage.prototype.getSessionIdByTgMessageId = async function (this: DatabaseStorage, tgMessageId: number): Promise<string | null> {
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
;

DatabaseStorage.prototype.getSessionIdByVkMessageId = async function (this: DatabaseStorage, vkMessageId: number): Promise<string | null> {
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
;

DatabaseStorage.prototype.debugChatTable = async function (this: DatabaseStorage, ): Promise<{ rowCount: number; sampleRows: any[] }> {
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
;

DatabaseStorage.prototype.getChatSessions = async function (this: DatabaseStorage, ): Promise<Array<{ sessionId: string; lastMessage: string; lastTimestamp: number; userName?: string; unread?: number }>> {
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
;
