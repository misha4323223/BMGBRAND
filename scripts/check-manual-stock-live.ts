/**
 * Живая проверка «ручных остатков» (stock_sync_disabled) на продовой YDB.
 *
 * Временный скрипт: создаёт 3 СКРЫТЫХ тестовых товара, гоняет реальные
 * sync-эндпоинты 1С по HTTP на запущенном стенде и удаляет всё в finally.
 *
 * Чтение после каждой правки — СЫРЫМ запросом в YDB (кэш процесса не мешает),
 * т.к. правки делает другой процесс (сервер стенда).
 *
 *   npx tsx scripts/check-manual-stock-live.ts
 */
import { initYdb } from "../server/db";
import { storage } from "../server/storage";

const BASE = process.env.PREVIEW_URL || "http://localhost:5000";
const KEY = process.env.SYNC_API_KEY || "";
const TAG = `LIVE-${Date.now()}`;

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  ${extra === undefined ? "" : JSON.stringify(extra)}`);
  }
}

type Item = {
  externalId: string;
  sku?: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  category: string;
  sizes: string[];
  colors: string[];
  isNew?: boolean;
};

function item(externalId: string, name: string, sizes: string[]): Item {
  return {
    externalId,
    sku: `${externalId}-sku`,
    name,
    description: "live check, safe to delete",
    price: 1000,
    imageUrl: "/placeholder.svg",
    category: "merch",
    sizes,
    colors: [],
  };
}

async function syncPost(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Правду о строке берём сырым SELECT'ом — кэш процесса к делу не относится. */
async function dbRead(id: number): Promise<any | null> {
  return (storage as any).safeQuery(async (session: any) => {
    const { TypedValues, Types } = await import("ydb-sdk");
    const { resultSets } = await session.executeQuery(
      "DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id;",
      { $id: TypedValues.fromNative(Types.UTF8, String(id)) },
    );
    const rs = resultSets[0];
    if (!rs?.rows?.[0] || !rs.columns) return null;
    const data = (storage as any).parseRowWithColumns(rs.rows[0], rs.columns);
    return (storage as any).parseProduct(data);
  });
}

const created: number[] = [];
let cleanupStarted = false;

/** Уборка тестовых товаров; вызывается и по сигналу (timeout прерывает прогон). */
async function cleanup() {
  if (created.length === 0) return;
  console.log("\n[cleanup] удаляю тестовые товары");
  while (created.length) {
    const id = created.pop()!;
    try {
      await storage.deleteProduct(id);
      const gone = await dbRead(id);
      console.log(`      id ${id}: ${gone ? "ВСЁ ЕЩЁ В БАЗЕ" : "удалён"}`);
      if (gone) fail++;
    } catch (e: any) {
      console.log(`      id ${id}: ошибка удаления ${e?.message || e}`);
      fail++;
    }
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    cleanup()
      .catch((e) => console.error("[cleanup] ошибка:", e?.message || e))
      .finally(() => {
        console.log(`\nИтог: ${pass} passed, ${fail} failed (прогон прерван)`);
        process.exit(1);
      });
  });
}

async function main() {
  await initYdb();

  if (!KEY) throw new Error("SYNC_API_KEY не задан в окружении");
  console.log(`BASE=${BASE}\nTAG=${TAG}\n`);

  const extA = `ext-A-${TAG}`;
  const extB = `ext-B-${TAG}`;
  const extC = `ext-C-${TAG}`;

  try {
    // ---------- 0. чтение флага у реальных товаров ----------
    console.log("[0] чтение колонки у продовых товаров");
    const all: any[] = await storage.getAllProductsForAdmin();
    const flagged = all.filter((p) => p.stockSyncDisabled === true);
    const preorder = all.filter((p) => p.preorderEnabled === true);
    console.log(`      товаров: ${all.length}, stock_sync_disabled=true: ${flagged.length}, предзаказов: ${preorder.length}`);
    const sample = all.find((p) => p.id != null);
    check("флаг читается как boolean у реального товара", typeof sample?.stockSyncDisabled === "boolean", sample?.stockSyncDisabled);

    // ---------- A. товар с явным флагом ----------
    console.log("\n[A] товар «остатки вручную» (stockSyncDisabled: true)");
    const a = await storage.createProduct({ ...item(extA, `${TAG}-A`, ["S", "M"]), sizeStock: { S: 1, M: 2 }, stock: 3, isHidden: true } as any);
    created.push(a.id);
    await storage.updateProduct(a.id, { stockSyncDisabled: true } as any);
    const a1 = await dbRead(a.id);
    check("A1 флаг записан в YDB и прочитан", a1?.stockSyncDisabled === true, { flag: a1?.stockSyncDisabled, preorder: a1?.preorderEnabled });

    const ra = await syncPost("/api/sync/products", [item(extA, `${TAG}-A-sync`, ["XXXL"])]);
    console.log(`      sync/products → ${ra.status} ${JSON.stringify(ra.json)}`);
    check("A2 POST /api/sync/products → 200", ra.status === 200);
    check("A2b 1С нашла товар по externalId (updated, не created)", ra.json?.results?.[0]?.status === "updated", ra.json?.results);
    const a2 = await dbRead(a.id);
    check("A3 размеры из 1С НЕ применены", JSON.stringify(a2?.sizes) === JSON.stringify(["S", "M"]), a2?.sizes);
    check("A4 остальные поля из 1С обновились (name)", a2?.name === `${TAG}-A-sync`, a2?.name);

    const ri = await syncPost("/api/sync/inventory", [{ externalId: extA, sizes: ["XXL"] }]);
    console.log(`      sync/inventory → ${ri.status} ${JSON.stringify(ri.json)}`);
    check("A5 POST /api/sync/inventory → 200", ri.status === 200);
    const a3 = await dbRead(a.id);
    check("A6 /inventory не тронул размеры", JSON.stringify(a3?.sizes) === JSON.stringify(["S", "M"]), a3?.sizes);

    // ---------- B. контроль: товар без флага ----------
    console.log("\n[B] контроль: обычный товар (флаг не выставлен)");
    const b = await storage.createProduct({ ...item(extB, `${TAG}-B`, ["S", "M"]), sizeStock: { S: 1, M: 2 }, stock: 3, isHidden: true } as any);
    created.push(b.id);
    const b0 = await dbRead(b.id);
    check("B0 у контрольного товара флаг пустой", b0?.stockSyncDisabled === false, b0?.stockSyncDisabled);
    const rb = await syncPost("/api/sync/products", [item(extB, `${TAG}-B-sync`, ["XXXL"])]);
    console.log(`      sync/products → ${rb.status} ${JSON.stringify(rb.json)}`);
    check("B1 POST /api/sync/products → 200", rb.status === 200);
    const b2 = await dbRead(b.id);
    check("B2 размеры из 1С применены", JSON.stringify(b2?.sizes) === JSON.stringify(["XXXL"]), b2?.sizes);

    const rbi = await syncPost("/api/sync/inventory", [{ externalId: extB, sizes: ["YS"] }]);
    console.log(`      sync/inventory → ${rbi.status} ${JSON.stringify(rbi.json)}`);
    check("B3 POST /api/sync/inventory → 200", rbi.status === 200);
    const b3 = await dbRead(b.id);
    check("B4 /inventory применён", JSON.stringify(b3?.sizes) === JSON.stringify(["YS"]), b3?.sizes);

    // ---------- C. предзаказ без явного флага ----------
    console.log("\n[C] предзаказ: флаг колонки пустой, защищает preorderEnabled");
    const c = await storage.createProduct({ ...item(extC, `${TAG}-C`, ["S", "M"]), sizeStock: { S: 1, M: 2 }, stock: 3, isHidden: true } as any);
    created.push(c.id);
    await storage.updateProduct(c.id, { preorderEnabled: true, preorderStatus: "collecting" } as any);
    storage.clearProductCache(c.id);
    const cApp = await storage.getProduct(c.id); // путь приложения: parseProduct из YDB
    check("C1 колонка пустая, предзаказ включён (чтение приложением)", cApp?.stockSyncDisabled === false && cApp?.preorderEnabled === true, { flag: cApp?.stockSyncDisabled, preorder: cApp?.preorderEnabled });

    const rc = await syncPost("/api/sync/products", [item(extC, `${TAG}-C-sync`, ["XXXL"])]);
    console.log(`      sync/products → ${rc.status} ${JSON.stringify(rc.json)}`);
    check("C2 POST /api/sync/products → 200", rc.status === 200);
    const c2 = await dbRead(c.id);
    check("C3 предзаказ защитил размеры", JSON.stringify(c2?.sizes) === JSON.stringify(["S", "M"]), c2?.sizes);
    check("C4 остальные поля предзаказного товара обновились", c2?.name === `${TAG}-C-sync`, c2?.name);
  } finally {
    cleanupStarted = true;
    await cleanup();
    console.log(`\nИтог: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
