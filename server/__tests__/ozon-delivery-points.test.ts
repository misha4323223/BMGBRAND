import { describe, it, expect } from "vitest";
import {
  OzonDeliveryPointsService,
  normalizeOzonCity,
  parseOzonPointInfo,
  parseOzonPointList,
  type OzonPointDetails,
  type OzonPointRef,
} from "../ozon-delivery-api/points";
import type {
  OzonPointCheck,
  OzonPointsStore,
  OzonPointsSyncState,
  OzonQuotePoint,
} from "../ozon-delivery-api/points-store";

const NOW = 1_700_000_000_000;

function pointRef(id: string): OzonPointRef {
  return { id, shipmentMethodIds: ["9000000000000001"] };
}

function pointDetails(id: string): OzonPointDetails {
  return {
    id,
    name: `ПВЗ ${id}`,
    address: `г. Москва, ул. Тестовая, ${id}`,
    city: "Москва",
    cityNormalized: "москва",
    lat: 55.75,
    lng: 37.62,
    workingHours: "10:00–22:00",
    shipmentMethodIds: ["9000000000000001"],
    raw: "{}",
    detailsOk: true,
  };
}

class MemoryPointsStore implements OzonPointsStore {
  state: OzonPointsSyncState | null = null;
  refs = new Map<string, { ref: OzonPointRef; runId: string }>();
  details = new Map<string, OzonPointDetails>();
  checks = new Map<string, OzonPointCheck>();
  ensureCalls = 0;

  async ensureTable(): Promise<void> {
    this.ensureCalls++;
  }

  async getSyncState(): Promise<OzonPointsSyncState | null> {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : null;
  }

  async saveSyncState(state: OzonPointsSyncState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state));
  }

  async upsertRefs(
    refs: OzonPointRef[],
    runId: string,
    _now: number,
  ): Promise<void> {
    for (const ref of refs) this.refs.set(ref.id, { ref, runId });
  }

  async getPointChecks(ids: string[]): Promise<Map<string, OzonPointCheck>> {
    const result = new Map<string, OzonPointCheck>();
    for (const id of ids) {
      const check = this.checks.get(id);
      if (check) result.set(id, check);
    }
    return result;
  }

  async getPoint(id: string): Promise<OzonQuotePoint | null> {
    const entry = this.refs.get(id);
    const details = this.details.get(id);
    if (!entry && !details) return null;
    return {
      id,
      name: details?.name || "",
      address: details?.address || "",
      city: details?.city || "",
      lat: details?.lat,
      lng: details?.lng,
      workingHours: details?.workingHours,
      shipmentMethodIds:
        details?.shipmentMethodIds ?? entry?.ref.shipmentMethodIds ?? [],
      detailsOk: details?.detailsOk ?? false,
      isActive: true,
    };
  }

  async listByCity(
    cityNormalized: string,
    limit = 500,
  ): Promise<OzonQuotePoint[]> {
    return Array.from(this.details.values())
      .filter((point) => point.cityNormalized === cityNormalized)
      .slice(0, limit)
      .map((point) => ({
        id: point.id,
        name: point.name,
        address: point.address,
        city: point.city,
        lat: point.lat,
        lng: point.lng,
        workingHours: point.workingHours,
        shipmentMethodIds: point.shipmentMethodIds,
        detailsOk: point.detailsOk,
        isActive: true,
      }));
  }

  async upsertDetails(
    points: OzonPointDetails[],
    runId: string,
    now: number,
  ): Promise<void> {
    for (const point of points) {
      this.details.set(point.id, point);
      this.checks.set(point.id, { checkedAt: now, detailsOk: true });
      this.refs.set(point.id, {
        ref: {
          id: point.id,
          shipmentMethodIds: point.shipmentMethodIds,
        },
        runId,
      });
    }
  }

  async markMissingInactive(runId: string, _now: number): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.refs) {
      if (entry.runId !== runId) {
        this.refs.delete(id);
        count++;
      }
    }
    return count;
  }
}

type Handler = (path: string, body: any) => Promise<any>;

function makeService(handler: Handler) {
  const calls: Array<{ path: string; body: any }> = [];
  const client = {
    async request(path: string, body: any) {
      calls.push({ path, body });
      return handler(path, body);
    },
  };
  const store = new MemoryPointsStore();
  const service = new OzonDeliveryPointsService({
    client: client as any,
    store,
    now: () => NOW,
  });
  return { service, store, calls };
}

function listResponse(ids: string[], nextCursor: string | null) {
  return {
    ok: true,
    status: 200,
    data: {
      delivery_points: ids.map((id) => ({
        delivery_point_id: id,
        shipment_method_ids: 9000000000000001,
      })),
      next_cursor: nextCursor,
    },
  };
}

function infoResponse(ids: string[]) {
  return {
    ok: true,
    status: 200,
    data: {
      delivery_points: ids.map((id) => ({
        delivery_point_id: id,
        name: `ПВЗ ${id}`,
        full_address: `г. Москва, ул. Тестовая, ${id}`,
        coordinates: { latitude: 55.75, longitude: 37.62 },
        schedule: [
          {
            date: "2026-11-01",
            periods: [{ from_local: "10:00:00", to_local: "22:00:00" }],
          },
        ],
      })),
    },
  };
}

describe("parseOzonPointList", () => {
  it("читает официальные delivery_points, метод и next_cursor", () => {
    const page = parseOzonPointList({
      delivery_points: [
        { delivery_point_id: "123", shipment_method_ids: 1 },
        { delivery_point_id: "123", shipment_method_ids: [2] },
      ],
      next_cursor: "cursor-2",
    });

    expect(page.refs).toEqual([{ id: "123", shipmentMethodIds: ["1", "2"] }]);
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.hasNext).toBe(true);
  });

  it("поддерживает массив методов и null next_cursor", () => {
    const page = parseOzonPointList({
      delivery_points: [
        {
          delivery_point_id: 456,
          shipment_method_ids: [1, { shipment_method_id: "2" }],
        },
      ],
      next_cursor: null,
    });

    expect(page.refs).toEqual([
      { id: "456", shipmentMethodIds: ["1", "2"] },
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.hasNext).toBe(false);
  });

  it("терпит вложенный result", () => {
    const page = parseOzonPointList({
      result: {
        delivery_points: [{ delivery_point_id: "789", shipment_method_ids: 5 }],
        next_cursor: "next",
      },
    });

    expect(page.refs).toEqual([{ id: "789", shipmentMethodIds: ["5"] }]);
    expect(page.nextCursor).toBe("next");
  });
});

describe("parseOzonPointInfo", () => {
  it("читает официальные delivery_points, координаты и from_local/to_local", () => {
    const points = parseOzonPointInfo({
      delivery_points: [
        {
          delivery_point_id: "123",
          name: "Пункт",
          full_address: "Россия, г. Москва, ул. Тестовая, 1",
          coordinates: { latitude: "55.75", longitude: "37.62" },
          schedule: [
            {
              date: "2026-11-01",
              periods: [{ from_local: "10:00:00", to_local: "22:00:00" }],
            },
          ],
        },
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      id: "123",
      name: "Пункт",
      address: "Россия, г. Москва, ул. Тестовая, 1",
      city: "Москва",
      cityNormalized: "москва",
      lat: 55.75,
      lng: 37.62,
      workingHours: "10:00–22:00",
      detailsOk: true,
    });
    expect(points[0].raw).toContain("Пункт");
  });

  it("вытаскивает город из full_address, если address_details нет", () => {
    const [point] = parseOzonPointInfo({
      delivery_points: [
        {
          delivery_point_id: "789",
          full_address: "Россия, Московская область, г. Химки, ул. Мира, 2",
        },
      ],
    });

    expect(point.city).toBe("Химки");
    expect(normalizeOzonCity(point.city)).toBe("химки");
    expect(point.detailsOk).toBe(true);
  });
});

describe("normalizeOzonCity", () => {
  it("убирает город/г. и приводит к нижнему регистру", () => {
    expect(normalizeOzonCity("город Москва")).toBe("москва");
    expect(normalizeOzonCity("г. Санкт-Петербург")).toBe("санкт-петербург");
    expect(normalizeOzonCity("Королёв")).toBe("королев");
  });
});

describe("OzonDeliveryPointsService.listPointsByCity", () => {
  it("нормализует город и отдаёт только пункты этого города", async () => {
    const { service, store } = makeService(async () => listResponse([], null));
    store.details.set("1", pointDetails("1"));
    store.details.set("2", {
      ...pointDetails("2"),
      city: "Химки",
      cityNormalized: "химки",
    });

    const points = await service.listPointsByCity("г. Москва", 10);

    expect(points.map((point) => point.id)).toEqual(["1"]);
    expect(points[0]).toMatchObject({
      city: "Москва",
      workingHours: "10:00–22:00",
    });
  });
});

describe("OzonDeliveryPointsService.syncBatch", () => {
  it("проходит две страницы по курсору, сохраняет детали и завершает проход", async () => {
    const ids1 = Array.from({ length: 100 }, (_, i) => String(1000 + i));
    const ids2 = ["2001", "2002"];
    const { service, store, calls } = makeService(async (path, body) => {
      if (path.endsWith("/list")) {
        return body.pagination.cursor
          ? listResponse(ids2, null)
          : listResponse(ids1, "cursor-2");
      }
      return infoResponse(body.delivery_point_ids || []);
    });

    const result = await service.syncBatch({ maxPages: 5 });

    expect(result.success).toBe(true);
    expect(result.done).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(result.state.completedAt).toBeTruthy();
    expect(result.state.refsSeen).toBe(102);
    expect(result.state.detailsFetched).toBe(102);
    expect(result.state.pages).toBe(2);
    expect(result.state.cursor).toBeNull();
    expect(result.state.listDone).toBe(true);
    expect(store.details.size).toBe(102);
    expect(store.ensureCalls).toBe(1);
    const listCalls = calls.filter((call) => call.path.endsWith("/list"));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].body.pagination).toEqual({ limit: 100 });
    expect(listCalls[1].body.pagination).toEqual({
      limit: 100,
      cursor: "cursor-2",
    });
  });

  it("останавливается на maxPages и продолжает с сохранённого cursor", async () => {
    const ids1 = Array.from({ length: 100 }, (_, i) => String(3000 + i));
    const ids2 = ["4001"];
    const { service, store, calls } = makeService(async (path, body) => {
      if (path.endsWith("/list")) {
        return body.pagination.cursor
          ? listResponse(ids2, null)
          : listResponse(ids1, "cursor-2");
      }
      return infoResponse(body.delivery_point_ids || []);
    });

    const first = await service.syncBatch({ maxPages: 1 });
    expect(first.success).toBe(true);
    expect(first.hasMore).toBe(true);
    expect(first.state.cursor).toBe("cursor-2");
    expect(first.state.listDone).toBe(false);
    expect(first.state.completedAt).toBeUndefined();
    expect(store.state?.hasMore).toBe(true);

    const second = await service.syncBatch({ maxPages: 5 });
    expect(second.success).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(second.state.completedAt).toBeTruthy();
    expect(second.state.refsSeen).toBe(101);
    const listCalls = calls.filter((call) => call.path.endsWith("/list"));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1].body.pagination.cursor).toBe("cursor-2");
  });

  it("не запрашивает info для свежих деталей", async () => {
    const refs = [pointRef("5001"), pointRef("5002")];
    const { service, store, calls } = makeService(async (path) => {
      if (path.endsWith("/list")) {
        return listResponse(refs.map((ref) => ref.id), null);
      }
      throw new Error("info must not be called");
    });
    for (const ref of refs) {
      store.checks.set(ref.id, { checkedAt: NOW - 1000, detailsOk: true });
    }

    const result = await service.syncBatch({ maxPages: 2 });

    expect(result.success).toBe(true);
    expect(result.state.detailsFetched).toBe(0);
    expect(calls.filter((call) => call.path.endsWith("/info"))).toHaveLength(0);
  });

  it("останавливается на ошибке info и не сдвигает cursor", async () => {
    const { service, calls } = makeService(async (path) => {
      if (path.endsWith("/list")) {
        return listResponse(["6101", "6102"], "cursor-2");
      }
      return {
        ok: false,
        status: 500,
        error: { code: "server_error", message: "info unavailable" },
      };
    });

    const result = await service.syncBatch({ maxPages: 2 });

    expect(result.success).toBe(false);
    expect(result.hasMore).toBe(true);
    expect(result.state.cursor).toBeUndefined();
    expect(result.state.listDone).toBe(false);
    expect(result.state.detailsFailed).toBe(0);
    expect(result.error).toContain("info unavailable");
    expect(calls.filter((call) => call.path.endsWith("/info"))).toHaveLength(1);
  });

  it("сохраняет ошибку list и не запускает info", async () => {
    const { service, calls } = makeService(async (path) => {
      if (path.endsWith("/list")) {
        return {
          ok: false,
          status: 500,
          error: { code: "server_error", message: "Ozon unavailable" },
        };
      }
      throw new Error("info must not be called");
    });

    const result = await service.syncBatch({ maxPages: 2 });

    expect(result.success).toBe(false);
    expect(result.hasMore).toBe(true);
    expect(result.done).toBe(false);
    expect(result.error).toContain("Ozon unavailable");
    expect(result.state.lastError).toContain("Ozon unavailable");
    expect(calls.filter((call) => call.path.endsWith("/info"))).toHaveLength(0);
  });

  it("не завершает проход по пустому первому ответу", async () => {
    const { service } = makeService(async (path) => {
      if (path.endsWith("/list")) return listResponse([], null);
      throw new Error("info must not be called");
    });

    const result = await service.syncBatch({ maxPages: 1 });

    expect(result.success).toBe(false);
    expect(result.done).toBe(false);
    expect(result.hasMore).toBe(true);
    expect(result.error).toContain("пустой справочник");
  });

  it("помечает пропавшие пункты неактивными после полного прохода", async () => {
    const store = new MemoryPointsStore();
    store.refs.set("old", { ref: pointRef("old"), runId: "old-run" });
    const client = {
      async request(path: string, body: any) {
        if (path.endsWith("/list")) return listResponse(["7001"], null);
        return infoResponse(body.delivery_point_ids || []);
      },
    };
    const service = new OzonDeliveryPointsService({
      client: client as any,
      store,
      now: () => NOW,
    });

    const result = await service.syncBatch({ maxPages: 1 });

    expect(result.success).toBe(true);
    expect(result.state.inactiveMarked).toBe(1);
    expect(store.refs.has("old")).toBe(false);
  });

  it("после сбоя cleanup продолжает с фазы финализации, не перечитывая list", async () => {
    const store = new MemoryPointsStore();
    const originalMark = store.markMissingInactive.bind(store);
    let failCleanup = true;
    store.markMissingInactive = async (runId: string, now: number) => {
      if (failCleanup) {
        failCleanup = false;
        throw new Error("cleanup unavailable");
      }
      return originalMark(runId, now);
    };
    const client = {
      async request(path: string, body: any) {
        if (path.endsWith("/list")) return listResponse(["7001"], null);
        return infoResponse(body.delivery_point_ids || []);
      },
    };
    const service = new OzonDeliveryPointsService({
      client: client as any,
      store,
      now: () => NOW,
    });

    const first = await service.syncBatch({ maxPages: 1 });
    expect(first.success).toBe(false);
    expect(first.state.listDone).toBe(true);
    expect(first.error).toContain("cleanup");

    const second = await service.syncBatch({ maxPages: 1 });
    expect(second.success).toBe(true);
    expect(second.state.completedAt).toBeTruthy();
  });
});
