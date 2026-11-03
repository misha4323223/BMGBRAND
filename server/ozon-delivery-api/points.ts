/**
 * Ozon Delivery API — справочник пунктов выдачи.
 *
 * /v1/delivery-point/list отдаёт только ID и shipment_method_ids и листается
 * курсором (next_cursor). Адреса, координаты и график приходят из
 * /v1/delivery-point/info пачками до 100. Парсеры намеренно терпимы к
 * вложенности, но поля и пагинация — по официальной схеме Ozon Delivery API.
 */

import { logInfo } from "../logger";
import type { OzonDeliveryApiClient } from "./client";
import {
  createOzonPointsStore,
  type OzonPointsStore,
  type OzonPointsSyncState,
  type OzonQuotePoint,
} from "./points-store";

export const OZON_DELIVERY_POINT_LIST_PATH = "/v1/delivery-point/list";
export const OZON_DELIVERY_POINT_INFO_PATH = "/v1/delivery-point/info";

const PAGE_SIZE = 100;
const INFO_BATCH_SIZE = 100;
const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OzonPointRef {
  id: string;
  shipmentMethodIds: string[];
}

export interface OzonPointDetails {
  id: string;
  name: string;
  address: string;
  city: string;
  cityNormalized: string;
  lat?: number;
  lng?: number;
  workingHours?: string;
  shipmentMethodIds: string[];
  raw: string;
  detailsOk: boolean;
}

export interface OzonPointListPage {
  refs: OzonPointRef[];
  nextCursor: string | null;
  total?: number;
  hasNext?: boolean;
}

export interface OzonPointsSyncResult {
  success: boolean;
  state: OzonPointsSyncState;
  hasMore: boolean;
  done: boolean;
  error?: string;
}

function asArray(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const candidate = data?.[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = asArray(candidate, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function asString(value: any): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values: any[]): string {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function normalizePointId(value: any): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^\d{1,20}$/.test(id) ? id : null;
}

function toApiInt64(id: string): string | number {
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : id;
}

function normalizeMethodIds(value: any): string[] {
  if (value == null) return [];
  const rawItems = Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const item of rawItems) {
    const raw =
      item && typeof item === "object"
        ? item.shipment_method_id ?? item.method_id ?? item.id
        : item;
    const id = normalizePointId(raw);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function pointBody(item: any): any {
  return item?.delivery_point ?? item?.point ?? item;
}

export function normalizeOzonCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^(г\.?|город)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cityFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const explicit = parts.find((part) => /^(г\.?|город)\s+/i.test(part));
  if (explicit) return explicit.replace(/^(г\.?|город)\s+/i, "").trim();

  const fallback = parts.find(
    (part) =>
      /^[А-ЯЁа-яё][А-ЯЁа-яё\s-]+$/.test(part) &&
      !/область|край|республика|район|россия/i.test(part),
  );
  return fallback ?? "";
}

function numeric(value: any): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function formatTime(value: any): string | null {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  }
  if (!value || typeof value !== "object") return null;
  const hours = Number(value.hours ?? value.hour);
  const minutes = Number(value.minutes ?? value.minute ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatWorkingHours(schedule: any): string | undefined {
  if (typeof schedule === "string" && schedule.trim()) return schedule.trim();
  if (!Array.isArray(schedule)) {
    if (Array.isArray(schedule?.periods)) return formatWorkingHours([schedule]);
    return undefined;
  }

  // Ozon отдаёт график датами на несколько недель вперёд.
  // Берём первый день, у которого есть рабочие периоды.
  for (const day of schedule) {
    const periods = Array.isArray(day?.periods) ? day.periods : [];
    const formatted = periods
      .map((period: any) => {
        const from = formatTime(
          period?.min ?? period?.from ?? period?.from_local,
        );
        const to = formatTime(
          period?.max ?? period?.to ?? period?.to_local,
        );
        return from && to ? `${from}–${to}` : null;
      })
      .filter((value: string | null): value is string => !!value);
    if (formatted.length > 0) return formatted.join(", ");
  }
  return undefined;
}

export function parseOzonPointList(data: any): OzonPointListPage {
  const raw = asArray(data, ["points", "items", "delivery_points", "result"]);
  const byId = new Map<string, OzonPointRef>();

  for (const item of raw) {
    const point = pointBody(item);
    const id = normalizePointId(
      point?.delivery_point_id ??
        point?.point_id ??
        point?.map_point_id ??
        point?.id ??
        item,
    );
    if (!id) continue;

    const methods = normalizeMethodIds(
      point?.shipment_method_ids ??
        point?.shipment_methods ??
        point?.shipmentMethodIds ??
        point?.delivery_methods,
    );

    // API может вернуть один пункт несколько раз — по одному методу
    // доставки в строке. Не теряем остальные методы.
    const existing = byId.get(id);
    if (existing) {
      for (const methodId of methods) {
        if (!existing.shipmentMethodIds.includes(methodId)) {
          existing.shipmentMethodIds.push(methodId);
        }
      }
    } else {
      byId.set(id, { id, shipmentMethodIds: methods });
    }
  }

  const refs = Array.from(byId.values());

  const root =
    data?.result && typeof data.result === "object" && !Array.isArray(data.result)
      ? data.result
      : data;
  const paginationRaw = root?.pagination ?? root?.page;
  const pagination =
    paginationRaw && typeof paginationRaw === "object"
      ? paginationRaw
      : {};
  const totalRaw =
    pagination.total ??
    pagination.total_count ??
    root?.total_count ??
    root?.total;
  const total = numeric(totalRaw);

  const hasCursorField =
    !!root &&
    typeof root === "object" &&
    ("next_cursor" in root || "nextCursor" in root ||
      "next_cursor" in pagination || "nextCursor" in pagination);
  const cursorRaw =
    root?.next_cursor ??
    pagination.next_cursor ??
    root?.nextCursor ??
    pagination.nextCursor;
  const nextCursor =
    typeof cursorRaw === "string" && cursorRaw.trim()
      ? cursorRaw.trim()
      : null;
  const hasNextRaw =
    pagination.has_next ?? pagination.hasMore ?? root?.has_next;
  const hasNext =
    typeof hasNextRaw === "boolean"
      ? hasNextRaw
      : hasCursorField
        ? nextCursor !== null
        : undefined;

  return { refs, nextCursor, total, hasNext };
}

export function parseOzonPointInfo(data: any): OzonPointDetails[] {
  const raw = asArray(data, [
    "points",
    "items",
    "delivery_points",
    "result",
  ]);
  const result: OzonPointDetails[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const point = pointBody(item);
    const id = normalizePointId(
      point?.delivery_point_id ??
        point?.point_id ??
        point?.map_point_id ??
        point?.id,
    );
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const addressDetails =
      point?.address_details ?? point?.address?.details ?? {};
    const address = firstString(
      point?.full_address,
      point?.address_string,
      point?.address?.full_address,
      typeof point?.address === "string" ? point.address : "",
    );
    const city = firstString(
      addressDetails.city,
      point?.address?.city,
      point?.city,
      point?.city_name,
      point?.locality,
      cityFromAddress(address),
    );
    const coordinates =
      point?.coordinates ?? point?.coordinate ?? point?.geo ?? {};
    const lat = numeric(coordinates.lat ?? coordinates.latitude ?? point?.lat);
    const lng = numeric(
      coordinates.long ??
        coordinates.lon ??
        coordinates.lng ??
        coordinates.longitude ??
        point?.lng,
    );
    const name = firstString(
      point?.name,
      point?.title,
      point?.delivery_point_name,
    );
    const workingHours = formatWorkingHours(
      point?.work_schedule ??
        point?.schedule ??
        point?.working_hours ??
        point?.work_time,
    );

    const detailsOk = !!address;
    let rawJson = "{}";
    try {
      rawJson = JSON.stringify(item);
    } catch {
      /* не роняем синхронизацию из-за несериализуемого поля */
    }

    result.push({
      id,
      name: name || `Ozon ПВЗ ${id}`,
      address,
      city,
      cityNormalized: normalizeOzonCity(city),
      lat,
      lng,
      workingHours,
      shipmentMethodIds: normalizeMethodIds(
        point?.shipment_method_ids ??
          point?.shipment_methods ??
          point?.delivery_methods,
      ),
      raw: rawJson.slice(0, 20_000),
      detailsOk,
    });
  }

  return result;
}

function createState(now: number): OzonPointsSyncState {
  const iso = new Date(now).toISOString();
  return {
    runId: `${now}-${Math.random().toString(36).slice(2, 10)}`,
    pages: 0,
    refsSeen: 0,
    detailsFetched: 0,
    detailsFailed: 0,
    startedAt: iso,
    updatedAt: iso,
    hasMore: true,
    listDone: false,
  };
}

export interface OzonDeliveryPointsServiceOptions {
  client: OzonDeliveryApiClient;
  store?: OzonPointsStore;
  now?: () => number;
}

export class OzonDeliveryPointsService {
  private readonly client: OzonDeliveryApiClient;
  private readonly store: OzonPointsStore;
  private readonly now: () => number;

  constructor(options: OzonDeliveryPointsServiceOptions) {
    this.client = options.client;
    this.store = options.store ?? createOzonPointsStore();
    this.now = options.now ?? Date.now;
  }

  async getStatus(): Promise<{ state: OzonPointsSyncState | null }> {
    return { state: await this.store.getSyncState() };
  }

  /**
   * Обрабатывает ограниченное число страниц и сохраняет прогресс в YDB.
   * Повторный вызов продолжает с сохранённого next_cursor, поэтому полный
   * проход не упирается в 600-секундный лимит serverless-контейнера.
   */
  async syncBatch(
    options: { maxPages?: number; restart?: boolean } = {},
  ): Promise<OzonPointsSyncResult> {
    await this.store.ensureTable();

    const maxPages = Math.max(
      1,
      Math.min(50, Math.floor(options.maxPages ?? 20)),
    );
    const now = this.now();
    let state = options.restart ? null : await this.store.getSyncState();
    if (!state || state.completedAt || !state.hasMore) {
      state = createState(now);
    }

    let done = state.listDone === true;

    for (
      let pageIndex = 0;
      !done && pageIndex < maxPages;
      pageIndex++
    ) {
      const pagination: Record<string, unknown> = { limit: PAGE_SIZE };
      if (state.cursor) pagination.cursor = state.cursor;
      const response = await this.client.request(
        OZON_DELIVERY_POINT_LIST_PATH,
        { pagination },
      );

      if (!response.ok) {
        state.lastError = `list: ${response.error?.message || `HTTP ${response.status}`}`;
        state.updatedAt = new Date(this.now()).toISOString();
        state.hasMore = true;
        await this.store.saveSyncState(state);
        return {
          success: false,
          state,
          hasMore: true,
          done: false,
          error: state.lastError,
        };
      }

      const page = parseOzonPointList(response.data);
      if (page.total != null) state.totalRefs = page.total;
      if (page.refs.length === 0) {
        // Пустой первый ответ не должен помечать весь старый справочник
        // неактивным: это может быть сбой формата, а не реальное исчезновение.
        if (state.refsSeen === 0) {
          state.lastError = "list: Ozon вернул пустой справочник";
          state.updatedAt = new Date(this.now()).toISOString();
          state.hasMore = true;
          await this.store.saveSyncState(state);
          return {
            success: false,
            state,
            hasMore: true,
            done: false,
            error: state.lastError,
          };
        }
        state.listDone = true;
        state.cursor = null;
        done = true;
        break;
      }

      await this.store.upsertRefs(page.refs, state.runId, now);

      const checks = await this.store.getPointChecks(
        page.refs.map((ref) => ref.id),
      );
      const cutoff = now - DETAILS_TTL_MS;
      const needDetails = page.refs.filter((ref) => {
        const check = checks.get(ref.id);
        return !check || !check.detailsOk || check.checkedAt < cutoff;
      });

      if (needDetails.length > 0) {
        const methods = new Map(
          page.refs.map((ref) => [ref.id, ref.shipmentMethodIds]),
        );
        const info = await this.fetchPointInfo(needDetails);
        if (info.ok) {
          const points = info.points.map((point) => {
            const fromList = methods.get(point.id);
            return {
              ...point,
              shipmentMethodIds:
                fromList && fromList.length > 0
                  ? fromList
                  : point.shipmentMethodIds,
            };
          });
          const valid = points.filter((point) => point.detailsOk);
          if (valid.length > 0) {
            await this.store.upsertDetails(valid, state.runId, now);
          }
          state.detailsFetched += valid.length;
          state.detailsFailed += Math.max(0, needDetails.length - valid.length);
          if (valid.length < needDetails.length) {
            state.lastError = `info: получено ${valid.length} из ${needDetails.length} ПВЗ`;
          } else {
            state.lastError = undefined;
          }
        } else {
          // Не долбим Ozon 900 раз одним и тем же неверным запросом.
          // Состояние сохраняет текущий cursor, после исправления продолжим.
          // detailsFailed здесь не увеличиваем: страница будет повторена,
          // иначе после успешного ретрая остался бы ложный «готов с ошибками».
          state.lastError = `info: ${info.error}`;
          state.updatedAt = new Date(this.now()).toISOString();
          state.hasMore = true;
          await this.store.saveSyncState(state);
          return {
            success: false,
            state,
            hasMore: true,
            done: false,
            error: state.lastError,
          };
        }
      } else {
        state.lastError = undefined;
      }

      state.refsSeen += page.refs.length;
      state.pages++;
      state.updatedAt = new Date(this.now()).toISOString();
      state.hasMore = true;

      if (page.nextCursor == null) {
        // next_cursor — единственный надёжный признак конца списка.
        // Длину страницы для этого не используем: API вправе вернуть
        // меньше limit и всё равно дать следующий курсор.
        state.listDone = true;
        state.cursor = null;
        done = true;
      } else {
        state.cursor = page.nextCursor;
        state.listDone = false;
      }

      await this.store.saveSyncState(state);
      if (done) break;
    }

    if (done) {
      try {
        state.inactiveMarked =
          state.refsSeen > 0
            ? await this.store.markMissingInactive(state.runId, this.now())
            : 0;
        state.completedAt = new Date(this.now()).toISOString();
        state.hasMore = false;
        state.updatedAt = state.completedAt;
        await this.store.saveSyncState(state);
      } catch (err: any) {
        state.lastError = `cleanup: ${err?.message || err}`;
        state.hasMore = true;
        state.updatedAt = new Date(this.now()).toISOString();
        await this.store.saveSyncState(state);
        return {
          success: false,
          state,
          hasMore: true,
          done: false,
          error: state.lastError,
        };
      }
    } else {
      state.hasMore = true;
      state.updatedAt = new Date(this.now()).toISOString();
      await this.store.saveSyncState(state);
    }

    if (done) {
      logInfo(
        `[OzonDeliveryAPI] Справочник ПВЗ синхронизирован: ${state.refsSeen} пунктов, деталей ${state.detailsFetched}, ошибок ${state.detailsFailed}`,
      );
    }

    return {
      success: true,
      state,
      hasMore: !done,
      done,
    };
  }

  async getPointForQuote(id: string): Promise<OzonQuotePoint | null> {
    if (!/^\d{1,20}$/.test(String(id))) return null;
    return this.store.getPoint(String(id));
  }

  async listPointsByCity(
    city: string,
    limit = 500,
  ): Promise<OzonQuotePoint[]> {
    const normalized = normalizeOzonCity(String(city ?? ""));
    if (!normalized) return [];
    return this.store.listByCity(normalized, limit);
  }

  private async fetchPointInfo(refs: OzonPointRef[]): Promise<{
    ok: boolean;
    points: OzonPointDetails[];
    error?: string;
  }> {
    const ids = refs.map((ref) => ref.id);
    const batch = ids.slice(0, INFO_BATCH_SIZE);

    const response = await this.client.request(
      OZON_DELIVERY_POINT_INFO_PATH,
      { delivery_point_ids: batch.map(toApiInt64) },
    );
    if (!response.ok) {
      return {
        ok: false,
        points: [],
        error: response.error?.message || `HTTP ${response.status}`,
      };
    }

    // Одна страница list — максимум 100 пунктов, поэтому один info-батч.
    const points = parseOzonPointInfo(response.data);
    if (points.length > 0) return { ok: true, points };
    return {
      ok: false,
      points: [],
      error: "Ozon вернул пустой ответ info",
    };
  }
}
