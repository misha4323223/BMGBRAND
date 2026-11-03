/**
 * Справочник ПВЗ Ozon Delivery API.
 *
 * list отдаёт только ID и shipment_method_ids (92k+ пунктов, 900+ страниц),
 * info — детали пачками до 100. Поэтому храним справочник в отдельной
 * YDB-таблице, а не в bonus_settings: одна запись там не переживёт 180 МБ.
 *
 * Синхронизация incremental: details старше 7 дней обновляются повторно,
 * пропавшие пункты помечаются is_active=false только после полного прохода.
 */

import ydb from "ydb-sdk";
import { logWarn } from "../logger";
import { waitForDriver } from "../db";
import { storage } from "../storage";
import type { OzonPointDetails, OzonPointRef } from "./points";

export const OZON_POINTS_TABLE = "ozon_delivery_points";
export const OZON_POINTS_SYNC_KEY = "ozon_delivery_points_sync";

export interface OzonPointsSyncState {
  runId: string;
  /** Курсор следующей страницы list. null — список дочитан. */
  cursor?: string | null;
  /** Финальная страница уже получена, остаётся cleanup/финализация. */
  listDone?: boolean;
  pages: number;
  refsSeen: number;
  detailsFetched: number;
  detailsFailed: number;
  totalRefs?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
  hasMore: boolean;
  inactiveMarked?: number;
}

export interface OzonPointCheck {
  checkedAt: number;
  detailsOk: boolean;
}

export interface OzonQuotePoint {
  id: string;
  name: string;
  address: string;
  city: string;
  lat?: number;
  lng?: number;
  workingHours?: string;
  shipmentMethodIds: string[];
  detailsOk: boolean;
  isActive: boolean;
}

export interface OzonPointsStore {
  ensureTable(): Promise<void>;
  getSyncState(): Promise<OzonPointsSyncState | null>;
  saveSyncState(state: OzonPointsSyncState): Promise<void>;
  upsertRefs(refs: OzonPointRef[], runId: string, now: number): Promise<void>;
  getPointChecks(ids: string[]): Promise<Map<string, OzonPointCheck>>;
  getPoint(id: string): Promise<OzonQuotePoint | null>;
  listByCity(cityNormalized: string, limit?: number): Promise<OzonQuotePoint[]>;
  upsertDetails(points: OzonPointDetails[], runId: string, now: number): Promise<void>;
  markMissingInactive(runId: string, now: number): Promise<number>;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function cellValue(cell: any): any {
  return storage.extractTypedValue(cell);
}

function asNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: any): string {
  return value == null ? "" : String(value);
}

function rowToPoint(row: any, fallbackId = ""): OzonQuotePoint {
  const items = row?.items ?? [];
  const latRaw = cellValue(items[4]);
  const lngRaw = cellValue(items[5]);
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  return {
    id: asString(cellValue(items[0])) || fallbackId,
    name: asString(cellValue(items[1])),
    address: asString(cellValue(items[2])),
    city: asString(cellValue(items[3])),
    lat: latRaw == null || !Number.isFinite(lat) ? undefined : lat,
    lng: lngRaw == null || !Number.isFinite(lng) ? undefined : lng,
    workingHours: asString(cellValue(items[6])) || undefined,
    shipmentMethodIds: parseMethodIds(cellValue(items[7])),
    detailsOk: Boolean(cellValue(items[8])),
    isActive: cellValue(items[9]) !== false,
  };
}

function parseMethodIds(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        String(
          item && typeof item === "object"
            ? item.shipment_method_id ?? item.id ?? ""
            : item ?? "",
        ).trim(),
      )
      .filter((item) => /^\d{1,20}$/.test(item));
  }
  if (!value) return [];
  try {
    return parseMethodIds(JSON.parse(String(value)));
  } catch {
    const single = String(value).trim();
    return /^\d{1,20}$/.test(single) ? [single] : [];
  }
}

export class YdbOzonPointsStore implements OzonPointsStore {
  private tablePromise: Promise<void> | null = null;

  async ensureTable(): Promise<void> {
    if (!this.tablePromise) {
      this.tablePromise = this.createTable().catch((err) => {
        this.tablePromise = null;
        throw err;
      });
    }
    await this.tablePromise;
  }

  private async createTable(): Promise<void> {
    const driver = await waitForDriver();
    if (!driver) throw new Error("YDB недоступен: справочник ПВЗ не создан");

    try {
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.createTable(
          OZON_POINTS_TABLE,
          new ydb.TableDescription()
            .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column("name", ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column("address", ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(new ydb.Column("city", ydb.Types.optional(ydb.Types.UTF8)))
            .withColumn(
              new ydb.Column(
                "city_normalized",
                ydb.Types.optional(ydb.Types.UTF8),
              ),
            )
            .withColumn(new ydb.Column("lat", ydb.Types.optional(ydb.Types.DOUBLE)))
            .withColumn(new ydb.Column("lng", ydb.Types.optional(ydb.Types.DOUBLE)))
            .withColumn(
              new ydb.Column(
                "working_hours",
                ydb.Types.optional(ydb.Types.UTF8),
              ),
            )
            .withColumn(
              new ydb.Column(
                "shipment_method_ids",
                ydb.Types.optional(ydb.Types.UTF8),
              ),
            )
            .withColumn(
              new ydb.Column("raw_json", ydb.Types.optional(ydb.Types.UTF8)),
            )
            .withColumn(
              new ydb.Column("details_ok", ydb.Types.optional(ydb.Types.BOOL)),
            )
            .withColumn(
              new ydb.Column("is_active", ydb.Types.optional(ydb.Types.BOOL)),
            )
            .withColumn(
              new ydb.Column(
                "last_seen_run",
                ydb.Types.optional(ydb.Types.UTF8),
              ),
            )
            .withColumn(
              new ydb.Column("checked_at", ydb.Types.optional(ydb.Types.UINT64)),
            )
            .withColumn(
              new ydb.Column("updated_at", ydb.Types.optional(ydb.Types.UINT64)),
            )
            .withPrimaryKey("id")
            .withIndex(
              new ydb.TableIndex("idx_ozon_delivery_points_city").withIndexColumns(
                "city_normalized",
              ),
            ),
        );
      });
    } catch (err: any) {
      const message = String(err?.message || err);
      const alreadyExists =
        /already exists/i.test(message) ||
        /duplicate/i.test(message) ||
        /path exists/i.test(message);
      if (!alreadyExists) throw err;
    }
  }

  async getSyncState(): Promise<OzonPointsSyncState | null> {
    const raw = await storage.getBonusSetting(OZON_POINTS_SYNC_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.runId) return null;
      const cursor =
        typeof parsed.cursor === "string" && parsed.cursor.trim()
          ? parsed.cursor.trim()
          : parsed.cursor === null
            ? null
            : undefined;
      return {
        runId: String(parsed.runId),
        cursor,
        listDone: parsed.listDone === true,
        pages: Number(parsed.pages) || 0,
        refsSeen: Number(parsed.refsSeen) || 0,
        detailsFetched: Number(parsed.detailsFetched) || 0,
        detailsFailed: Number(parsed.detailsFailed) || 0,
        totalRefs: Number.isFinite(Number(parsed.totalRefs))
          ? Number(parsed.totalRefs)
          : undefined,
        startedAt: String(parsed.startedAt || ""),
        updatedAt: String(parsed.updatedAt || ""),
        completedAt: parsed.completedAt ? String(parsed.completedAt) : undefined,
        lastError: parsed.lastError ? String(parsed.lastError) : undefined,
        hasMore: parsed.hasMore !== false,
        inactiveMarked: Number.isFinite(Number(parsed.inactiveMarked))
          ? Number(parsed.inactiveMarked)
          : undefined,
      };
    } catch {
      logWarn("[OzonDeliveryAPI] Состояние синхронизации ПВЗ повреждено");
      return null;
    }
  }

  async saveSyncState(state: OzonPointsSyncState): Promise<void> {
    await storage.setBonusSetting(OZON_POINTS_SYNC_KEY, JSON.stringify(state));
  }

  async upsertRefs(
    refs: OzonPointRef[],
    runId: string,
    now: number,
  ): Promise<void> {
    if (refs.length === 0) return;
    const driver = await waitForDriver();
    if (!driver) throw new Error("YDB недоступен: справочник ПВЗ не создан");

    for (const chunk of chunks(refs, 50)) {
      const declarations = [
        "DECLARE $run AS Utf8;",
        "DECLARE $updatedAt AS Uint64;",
      ];
      const params: Record<string, any> = {
        $run: ydb.TypedValues.utf8(runId),
        $updatedAt: ydb.TypedValues.uint64(now),
      };
      const rows: string[] = [];

      chunk.forEach((ref, index) => {
        declarations.push(`DECLARE $id${index} AS Utf8;`);
        declarations.push(`DECLARE $methods${index} AS Utf8;`);
        params[`$id${index}`] = ydb.TypedValues.utf8(ref.id);
        params[`$methods${index}`] = ydb.TypedValues.utf8(
          JSON.stringify(ref.shipmentMethodIds),
        );
        rows.push(
          `($id${index}, $methods${index}, $run, TRUE, $updatedAt)`,
        );
      });

      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.executeQuery(
          `${declarations.join("\n")}
           UPSERT INTO ${OZON_POINTS_TABLE}
             (id, shipment_method_ids, last_seen_run, is_active, updated_at)
           VALUES ${rows.join(",\n")}`,
          params,
        );
      });
    }
  }

  async getPointChecks(ids: string[]): Promise<Map<string, OzonPointCheck>> {
    const result = new Map<string, OzonPointCheck>();
    if (ids.length === 0) return result;

    const driver = await waitForDriver();
    if (!driver) return result;

    // ID уже провалидированы парсером как цифровые строки, поэтому
    // подставлять их в IN-список безопасно.
    for (const chunk of chunks(ids, 100)) {
      const inList = chunk.map((id) => `"${id}"`).join(", ");
      const rows = await driver.tableClient.withSession(async (session: ydb.Session) => {
        const { resultSets } = await session.executeQuery(
          `SELECT id, checked_at, details_ok
           FROM ${OZON_POINTS_TABLE}
           WHERE id IN (${inList})`,
        );
        return resultSets[0]?.rows ?? [];
      });

      for (const row of rows) {
        const id = String(cellValue(row.items?.[0]) ?? "");
        if (!id) continue;
        result.set(id, {
          checkedAt: asNumber(cellValue(row.items?.[1])),
          detailsOk: Boolean(cellValue(row.items?.[2])),
        });
      }
    }

    return result;
  }

  async getPoint(id: string): Promise<OzonQuotePoint | null> {
    if (!/^\d{1,20}$/.test(id)) return null;

    const driver = await waitForDriver();
    if (!driver) throw new Error("YDB недоступен: справочник ПВЗ не создан");

    const rows = await driver.tableClient.withSession(async (session: ydb.Session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $id AS Utf8;
         SELECT id, name, address, city, lat, lng, working_hours,
                shipment_method_ids, details_ok, is_active
         FROM ${OZON_POINTS_TABLE}
         WHERE id = $id`,
        { $id: ydb.TypedValues.utf8(id) },
      );
      return resultSets[0]?.rows ?? [];
    });

    const row = rows[0];
    return row ? rowToPoint(row, id) : null;
  }

  async listByCity(
    cityNormalized: string,
    limit = 500,
  ): Promise<OzonQuotePoint[]> {
    const city = cityNormalized.trim();
    if (!city) return [];

    const driver = await waitForDriver();
    if (!driver) throw new Error("YDB недоступен: справочник ПВЗ не создан");

    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 500));
    const rows = await driver.tableClient.withSession(async (session: ydb.Session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $city AS Utf8;
         SELECT p.id, p.name, p.address, p.city, p.lat, p.lng,
                p.working_hours, p.shipment_method_ids, p.details_ok,
                p.is_active
         FROM ${OZON_POINTS_TABLE} VIEW idx_ozon_delivery_points_city AS p
         WHERE p.city_normalized = $city AND p.is_active = TRUE
         LIMIT ${safeLimit}`,
        { $city: ydb.TypedValues.utf8(city) },
      );
      return resultSets[0]?.rows ?? [];
    });

    return rows.map((row: any) => rowToPoint(row));
  }

  async upsertDetails(
    points: OzonPointDetails[],
    runId: string,
    now: number,
  ): Promise<void> {
    if (points.length === 0) return;
    const driver = await waitForDriver();
    if (!driver) throw new Error("YDB недоступен: справочник ПВЗ не создан");

    for (const chunk of chunks(points, 50)) {
      const declarations = [
        "DECLARE $run AS Utf8;",
        "DECLARE $now AS Uint64;",
      ];
      const params: Record<string, any> = {
        $run: ydb.TypedValues.utf8(runId),
        $now: ydb.TypedValues.uint64(now),
      };
      const rows: string[] = [];

      chunk.forEach((point, index) => {
        const names = [
          "id",
          "name",
          "address",
          "city",
          "city_normalized",
          "working_hours",
          "shipment_method_ids",
          "raw_json",
          "lat",
          "lng",
          "details_ok",
          "is_active",
          "last_seen_run",
          "checked_at",
          "updated_at",
        ];
        const values: string[] = [];
        for (const name of names) {
          const key = `${name}${index}`;
          if (name === "lat" || name === "lng") {
            const value = name === "lat" ? point.lat : point.lng;
            if (value == null || !Number.isFinite(value)) {
              values.push("NULL");
            } else {
              declarations.push(`DECLARE $${key} AS Double?;`);
              params[`$${key}`] = ydb.TypedValues.optional(
                ydb.TypedValues.fromNative(ydb.Types.DOUBLE, value),
              );
              values.push(`$${key}`);
            }
            continue;
          }
          if (name === "details_ok" || name === "is_active") {
            values.push("TRUE");
            continue;
          }
          if (name === "checked_at" || name === "updated_at") {
            values.push("$now");
            continue;
          }
          if (name === "last_seen_run") {
            values.push("$run");
            continue;
          }
          const stringValues: Record<string, string> = {
            id: point.id,
            name: point.name,
            address: point.address,
            city: point.city,
            city_normalized: point.cityNormalized,
            working_hours: point.workingHours || "",
            shipment_method_ids: JSON.stringify(point.shipmentMethodIds),
            raw_json: point.raw,
          };
          declarations.push(`DECLARE $${key} AS Utf8;`);
          params[`$${key}`] = ydb.TypedValues.utf8(stringValues[name] ?? "");
          values.push(`$${key}`);
        }
        rows.push(`(${values.join(", ")})`);
      });

      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.executeQuery(
          `${declarations.join("\n")}
           UPSERT INTO ${OZON_POINTS_TABLE}
             (id, name, address, city, city_normalized, working_hours,
              shipment_method_ids, raw_json, lat, lng, details_ok, is_active,
              last_seen_run, checked_at, updated_at)
           VALUES ${rows.join(",\n")}`,
          params,
        );
      });
    }
  }

  async markMissingInactive(runId: string, now: number): Promise<number> {
    const driver = await waitForDriver();
    if (!driver) return 0;

    const rows = await driver.tableClient.withSession(async (session: ydb.Session) => {
      const { resultSets } = await session.executeQuery(
        `SELECT id, last_seen_run, is_active FROM ${OZON_POINTS_TABLE}`,
      );
      return resultSets[0]?.rows ?? [];
    });

    const missing: string[] = [];
    for (const row of rows) {
      const id = String(cellValue(row.items?.[0]) ?? "");
      const seenRun = String(cellValue(row.items?.[1]) ?? "");
      const isActive = cellValue(row.items?.[2]) !== false;
      if (id && isActive && seenRun !== runId) missing.push(id);
    }
    if (missing.length === 0) return 0;

    for (const chunk of chunks(missing, 100)) {
      const declarations = ["DECLARE $now AS Uint64;"];
      const params: Record<string, any> = {
        $now: ydb.TypedValues.uint64(now),
      };
      const values: string[] = [];
      chunk.forEach((id, index) => {
        declarations.push(`DECLARE $id${index} AS Utf8;`);
        params[`$id${index}`] = ydb.TypedValues.utf8(id);
        values.push(`($id${index}, FALSE, $now)`);
      });
      await driver.tableClient.withSession(async (session: ydb.Session) => {
        await session.executeQuery(
          `${declarations.join("\n")}
           UPSERT INTO ${OZON_POINTS_TABLE}
             (id, is_active, updated_at)
           VALUES ${values.join(",\n")}`,
          params,
        );
      });
    }

    return missing.length;
  }
}

export function createOzonPointsStore(): OzonPointsStore {
  return new YdbOzonPointsStore();
}
