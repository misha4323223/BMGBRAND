// Partner payouts + global settings storage (2.4.5e).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import type { PartnerPayout } from "@shared/schema";
import { PARTNER_GLOBAL_COMMISSION_SETTING_KEY, PARTNER_DEFAULT_COMMISSION_PERCENT, PARTNER_HOLD_DAYS_SETTING_KEY, PARTNER_DEFAULT_HOLD_DAYS } from "@shared/schema";

declare module "./core" {
  interface DatabaseStorage {
    createPartnerPayout(data: { partnerId: number; amount: number; commissionIds: number[]; method: string; recipientName: string; recipientDetails: string; note?: string | null; createdBy?: string | null; }): Promise<PartnerPayout>;
    getPayoutById(id: number): Promise<PartnerPayout | null>;
    updatePartnerPayoutFields( id: number, fields: Partial<{ status: string; invoiceUrl: string | null; invoiceUploadedAt: Date | null; invoiceNumber: string | null; paidAt: Date | null; paidReference: string | null; receiptUrl: string | null; receiptUploadedAt: Date | null; receiptNumber: string | null; actUrl: string | null; actUploadedAt: Date | null; actNumber: string | null; completedAt: Date | null; rejectedReason: string | null; }>, ): Promise<void>;
    listPartnerPayouts(partnerId?: number): Promise<PartnerPayout[]>;
    getGlobalPartnerCommissionPercent(): Promise<number>;
    setGlobalPartnerCommissionPercent(percent: number): Promise<void>;
    getGlobalPartnerHoldDays(): Promise<number>;
    setGlobalPartnerHoldDays(days: number): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.createPartnerPayout = async function (this: DatabaseStorage, data: {
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
;

DatabaseStorage.prototype.getPayoutById = async function (this: DatabaseStorage, id: number): Promise<PartnerPayout | null> {
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
;

DatabaseStorage.prototype.updatePartnerPayoutFields = async function (this: DatabaseStorage, 
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
;

DatabaseStorage.prototype.listPartnerPayouts = async function (this: DatabaseStorage, partnerId?: number): Promise<PartnerPayout[]> {
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
;

DatabaseStorage.prototype.getGlobalPartnerCommissionPercent = async function (this: DatabaseStorage, ): Promise<number> {
    const raw = await this.getBonusSetting(PARTNER_GLOBAL_COMMISSION_SETTING_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : PARTNER_DEFAULT_COMMISSION_PERCENT;
  }
;

DatabaseStorage.prototype.setGlobalPartnerCommissionPercent = async function (this: DatabaseStorage, percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error("Commission percent must be between 0 and 100");
    }
    await this.setBonusSetting(PARTNER_GLOBAL_COMMISSION_SETTING_KEY, String(Math.round(percent)));
  }
;

DatabaseStorage.prototype.getGlobalPartnerHoldDays = async function (this: DatabaseStorage, ): Promise<number> {
    const raw = await this.getBonusSetting(PARTNER_HOLD_DAYS_SETTING_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : PARTNER_DEFAULT_HOLD_DAYS;
  }
;

DatabaseStorage.prototype.setGlobalPartnerHoldDays = async function (this: DatabaseStorage, days: number): Promise<void> {
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      throw new Error("Hold days must be between 0 and 365");
    }
    await this.setBonusSetting(PARTNER_HOLD_DAYS_SETTING_KEY, String(Math.round(days)));
  }
;
