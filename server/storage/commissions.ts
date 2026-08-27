// Partner commissions storage (2.4.5d).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import type { PartnerCommission } from "@shared/schema";

declare module "./core" {
  interface DatabaseStorage {
    createPartnerCommission(data: { partnerId: number; orderId: number; orderItemsTotal: number; commissionPercent: number; commissionAmount: number; commissionType?: string }): Promise<PartnerCommission>;
    setCommissionHoldUntil(id: number, holdUntil: Date | null): Promise<void>;
    getCommissionsByPartner(partnerId: number, filter?: { status?: string }): Promise<PartnerCommission[]>;
    getCommissionById(id: number): Promise<PartnerCommission | null>;
    getCommissionByOrderId(orderId: number): Promise<PartnerCommission | null>;
    getCommissionsByOrderId(orderId: number): Promise<PartnerCommission[]>;
    getMonthlyRefCommissions(partnerId: number, year: number, month: number): Promise<PartnerCommission[]>;
    recalcMonthlyCommissions(partnerId: number, year: number, month: number, newPercent: number): Promise<void>;
    listAllCommissions(filter?: { status?: string; partnerId?: number }): Promise<PartnerCommission[]>;
    updateCommissionStatus(id: number, status: "pending" | "confirmed" | "cancelled" | "paid"): Promise<void>;
    deleteCommission(id: number): Promise<void>;
    markCommissionsPaid(ids: number[]): Promise<void>;
    getPartnerStats(partnerId: number, excludeIds?: number[]): Promise<{ clicks: number; ordersCount: number; ordersTotal: number; awaitingPaymentAmount: number; holdAmount: number; pendingAmount: number; confirmedAmount: number; paidAmount: number; readyToConfirmAmount: number; }>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.createPartnerCommission = async function (this: DatabaseStorage, data: { partnerId: number; orderId: number; orderItemsTotal: number; commissionPercent: number; commissionAmount: number; commissionType?: string }): Promise<PartnerCommission> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date();
    const cType = data.commissionType || 'referral';
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $partner_id AS Uint64;
        DECLARE $order_id AS Uint64;
        DECLARE $items_total AS Int64;
        DECLARE $percent AS Int32;
        DECLARE $amount AS Int64;
        DECLARE $status AS Utf8;
        DECLARE $created_at AS Timestamp;
        DECLARE $commission_type AS Utf8;
        UPSERT INTO partner_commissions
          (id, partner_id, order_id, order_items_total, commission_percent, commission_amount, status, created_at, commission_type)
        VALUES
          ($id, $partner_id, $order_id, $items_total, $percent, $amount, $status, $created_at, $commission_type);
      `, {
        $id: TypedValues.uint64(id),
        $partner_id: TypedValues.uint64(data.partnerId),
        $order_id: TypedValues.uint64(data.orderId),
        $items_total: TypedValues.int64(data.orderItemsTotal),
        $percent: TypedValues.int32(data.commissionPercent),
        $amount: TypedValues.int64(data.commissionAmount),
        $status: TypedValues.utf8("pending"),
        $created_at: TypedValues.fromNative(Types.TIMESTAMP, now),
        $commission_type: TypedValues.utf8(cType),
      });
    });
    return {
      id,
      partnerId: data.partnerId,
      orderId: data.orderId,
      orderItemsTotal: data.orderItemsTotal,
      commissionPercent: data.commissionPercent,
      commissionAmount: data.commissionAmount,
      status: "pending",
      confirmedAt: null,
      paidAt: null,
      holdUntil: null,
      createdAt: now,
      commissionType: cType,
    } as PartnerCommission;
  }
;

DatabaseStorage.prototype.setCommissionHoldUntil = async function (this: DatabaseStorage, id: number, holdUntil: Date | null): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $hold_until AS Timestamp?;
        UPDATE partner_commissions SET hold_until = $hold_until WHERE id = $id;
      `, {
        $id: TypedValues.uint64(id),
        $hold_until: holdUntil
          ? TypedValues.optional(TypedValues.fromNative(Types.TIMESTAMP, holdUntil))
          : TypedValues.optionalNull(Types.TIMESTAMP),
      });
    });
  }
;

DatabaseStorage.prototype.getCommissionsByPartner = async function (this: DatabaseStorage, partnerId: number, filter?: { status?: string }): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      let declare = "DECLARE $partner_id AS Uint64;";
      let where = "WHERE partner_id = $partner_id";
      const params: Record<string, any> = { $partner_id: TypedValues.uint64(partnerId) };
      if (filter?.status) {
        declare += " DECLARE $status AS Utf8;";
        where += " AND status = $status";
        params.$status = TypedValues.utf8(filter.status);
      }
      const { resultSets } = await session.executeQuery(
        `${declare} SELECT * FROM partner_commissions ${where} ORDER BY created_at DESC LIMIT 1000;`,
        params,
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.getCommissionById = async function (this: DatabaseStorage, id: number): Promise<PartnerCommission | null> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT * FROM partner_commissions WHERE id = $id LIMIT 1;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.mapCommissionRow(this.parseRowWithColumns(rs.rows[0], rs.columns));
    });
    return result || null;
  }
;

DatabaseStorage.prototype.getCommissionByOrderId = async function (this: DatabaseStorage, orderId: number): Promise<PartnerCommission | null> {
    const all = await this.getCommissionsByOrderId(orderId);
    return all.length > 0 ? all[0] : null;
  }
;

DatabaseStorage.prototype.getCommissionsByOrderId = async function (this: DatabaseStorage, orderId: number): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $order_id AS Uint64;
        SELECT * FROM partner_commissions WHERE order_id = $order_id;
      `, { $order_id: TypedValues.uint64(orderId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.getMonthlyRefCommissions = async function (this: DatabaseStorage, partnerId: number, year: number, month: number): Promise<PartnerCommission[]> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const result = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        DECLARE $start AS Timestamp;
        DECLARE $end AS Timestamp;
        SELECT * FROM partner_commissions
        WHERE partner_id = $partner_id
          AND created_at >= $start
          AND created_at < $end
          AND (status = 'pending' OR status = 'confirmed');
      `, {
        $partner_id: TypedValues.uint64(partnerId),
        $start: TypedValues.fromNative(Types.TIMESTAMP, start),
        $end: TypedValues.fromNative(Types.TIMESTAMP, end),
      });
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.recalcMonthlyCommissions = async function (this: DatabaseStorage, partnerId: number, year: number, month: number, newPercent: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    const commissions = await this.getMonthlyRefCommissions(partnerId, year, month);
    if (commissions.length === 0) return;

    // Обновляем каждую комиссию по новому проценту
    for (const c of commissions) {
      const newAmount = Math.round(c.orderItemsTotal * newPercent / 100);
      // Пропускаем если ничего не изменилось (оптимизация)
      if (c.commissionPercent === newPercent && c.commissionAmount === newAmount) continue;
      await this.safeQuery(async (session) => {
        await session.executeQuery(`
          DECLARE $id AS Uint64;
          DECLARE $percent AS Int32;
          DECLARE $amount AS Int64;
          UPDATE partner_commissions
          SET commission_percent = $percent, commission_amount = $amount
          WHERE id = $id;
        `, {
          $id: TypedValues.uint64(c.id),
          $percent: TypedValues.int32(newPercent),
          $amount: TypedValues.int64(newAmount),
        });
      });
    }

    // Пересчитываем totalEarned партнёра = сумма всех confirmed+paid комиссий
    const totalResult = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $partner_id AS Uint64;
        SELECT SUM(commission_amount) AS total
        FROM partner_commissions
        WHERE partner_id = $partner_id
          AND (status = 'confirmed' OR status = 'paid');
      `, { $partner_id: TypedValues.uint64(partnerId) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return 0;
      const row = this.parseRowWithColumns(rs.rows[0], rs.columns);
      return Number(row.total) || 0;
    });

    const newTotal = Math.max(0, totalResult || 0);
    await this.safeQuery(async (session) => {
      await session.executeQuery(`
        DECLARE $id AS Uint64;
        DECLARE $total AS Int64;
        UPDATE partners SET total_earned = $total WHERE id = $id;
      `, {
        $id: TypedValues.uint64(partnerId),
        $total: TypedValues.int64(newTotal),
      });
    });
  }
;

DatabaseStorage.prototype.listAllCommissions = async function (this: DatabaseStorage, filter?: { status?: string; partnerId?: number }): Promise<PartnerCommission[]> {
    const { TypedValues } = await import("ydb-sdk");
    const result = await this.safeQuery(async (session) => {
      const declares: string[] = [];
      const conds: string[] = [];
      const params: Record<string, any> = {};
      if (filter?.status) {
        declares.push("DECLARE $status AS Utf8;");
        conds.push("status = $status");
        params.$status = TypedValues.utf8(filter.status);
      }
      if (filter?.partnerId) {
        declares.push("DECLARE $partner_id AS Uint64;");
        conds.push("partner_id = $partner_id");
        params.$partner_id = TypedValues.uint64(filter.partnerId);
      }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { resultSets } = await session.executeQuery(
        `${declares.join(" ")} SELECT * FROM partner_commissions ${where} ORDER BY created_at DESC LIMIT 2000;`,
        params,
      );
      const rs = resultSets[0];
      if (!rs.rows || !rs.columns) return [];
      return rs.rows.map((row: any) => this.mapCommissionRow(this.parseRowWithColumns(row, rs.columns!)));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.updateCommissionStatus = async function (this: DatabaseStorage, id: number, status: "pending" | "confirmed" | "cancelled" | "paid"): Promise<void> {
    const { TypedValues, Types } = await import("ydb-sdk");
    const now = new Date();

    // Fetch current row first — needed to decrement totalEarned on confirmed→cancelled
    const current = await this.safeQuery(async (session) => {
      const { resultSets } = await session.executeQuery(`
        DECLARE $id AS Uint64;
        SELECT partner_id, commission_amount, status FROM partner_commissions WHERE id = $id;
      `, { $id: TypedValues.uint64(id) });
      const rs = resultSets[0];
      if (!rs.rows?.length || !rs.columns) return null;
      return this.parseRowWithColumns(rs.rows[0], rs.columns);
    });
    if (!current) return;
    const prevStatus = String(current.status);
    if (prevStatus === status) return;

    await this.safeQuery(async (session) => {
      const sets: string[] = ["status = $status"];
      const declares: string[] = ["DECLARE $id AS Uint64;", "DECLARE $status AS Utf8;"];
      const params: Record<string, any> = {
        $id: TypedValues.uint64(id),
        $status: TypedValues.utf8(status),
      };
      if (status === "confirmed") {
        declares.push("DECLARE $confirmed_at AS Timestamp;");
        sets.push("confirmed_at = $confirmed_at");
        params.$confirmed_at = TypedValues.fromNative(Types.TIMESTAMP, now);
      } else if (status === "paid") {
        declares.push("DECLARE $paid_at AS Timestamp;");
        sets.push("paid_at = $paid_at");
        params.$paid_at = TypedValues.fromNative(Types.TIMESTAMP, now);
      }
      await session.executeQuery(
        `${declares.join(" ")} UPDATE partner_commissions SET ${sets.join(", ")} WHERE id = $id;`,
        params,
      );
    });
    // Adjust partner.totalEarned based on transition
    const partnerId = Number(current.partner_id);
    const amount = Number(current.commission_amount);
    let delta = 0;
    if (status === "confirmed" && prevStatus !== "confirmed" && prevStatus !== "paid") {
      delta = amount;
    } else if (status === "cancelled" && (prevStatus === "confirmed" || prevStatus === "paid")) {
      delta = -amount;
    }
    if (delta !== 0) {
      const partner = await this.getPartnerById(partnerId);
      if (partner) {
        const newTotal = Math.max(0, partner.totalEarned + delta);
        await this.safeQuery(async (session) => {
          await session.executeQuery(`
            DECLARE $id AS Uint64;
            DECLARE $total AS Int64;
            UPDATE partners SET total_earned = $total WHERE id = $id;
          `, {
            $id: TypedValues.uint64(partnerId),
            $total: TypedValues.int64(newTotal),
          });
        });
      }
    }
  }
;

DatabaseStorage.prototype.deleteCommission = async function (this: DatabaseStorage, id: number): Promise<void> {
    const { TypedValues } = await import("ydb-sdk");
    await this.safeQuery(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM partner_commissions WHERE id = $id;`,
        { $id: TypedValues.uint64(id) }
      );
    });
  }
;

DatabaseStorage.prototype.markCommissionsPaid = async function (this: DatabaseStorage, ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.updateCommissionStatus(id, "paid");
    }
  }
;

DatabaseStorage.prototype.getPartnerStats = async function (this: DatabaseStorage, partnerId: number, excludeIds?: number[]): Promise<{
    clicks: number; ordersCount: number; ordersTotal: number;
    awaitingPaymentAmount: number; holdAmount: number;
    pendingAmount: number; // legacy: awaitingPayment + hold (kept for backwards-compat)
    confirmedAmount: number; paidAmount: number;
    readyToConfirmAmount: number; // pending && hold_until <= now (admin-confirmable)
  }> {
    const partner = await this.getPartnerById(partnerId);
    const allCommissions = await this.getCommissionsByPartner(partnerId);
    const excludeSet = excludeIds ? new Set(excludeIds) : new Set<number>();
    const commissions = excludeSet.size > 0 ? allCommissions.filter(c => !excludeSet.has(c.id)) : allCommissions;
    const now = Date.now();
    const stats = {
      clicks: partner?.clicksCount ?? 0,
      ordersCount: commissions.length,
      ordersTotal: 0,
      awaitingPaymentAmount: 0,
      holdAmount: 0,
      pendingAmount: 0,
      confirmedAmount: 0,
      paidAmount: 0,
      readyToConfirmAmount: 0,
    };
    for (const c of commissions) {
      stats.ordersTotal += c.orderItemsTotal;
      if (c.status === "pending") {
        stats.pendingAmount += c.commissionAmount;
        if (!c.holdUntil) {
          stats.awaitingPaymentAmount += c.commissionAmount;
        } else {
          const holdMs = c.holdUntil instanceof Date ? c.holdUntil.getTime() : new Date(c.holdUntil).getTime();
          if (holdMs > now) {
            stats.holdAmount += c.commissionAmount;
          } else {
            // Hold expired — commission moves to its own bucket; admin can confirm.
            // Disjoint from holdAmount so UI cards don't double-count.
            stats.readyToConfirmAmount += c.commissionAmount;
          }
        }
      } else if (c.status === "confirmed") {
        stats.confirmedAmount += c.commissionAmount;
      } else if (c.status === "paid") {
        stats.paidAmount += c.commissionAmount;
      }
    }
    return stats;
  }
;
