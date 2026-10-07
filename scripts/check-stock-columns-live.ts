/**
 * Живая проверка записи INT64-полей при создании товара (после фикса BigInt → number).
 *   npx tsx scripts/check-stock-columns-live.ts
 * Создаёт скрытые тестовые товары и удаляет их в finally.
 */
import { initYdb } from "../server/db";
import { storage } from "../server/storage";

const TAG = `LIVE-STOCK-${Date.now()}`;
let pass = 0;
let fail = 0;
const created: number[] = [];

function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  ${extra === undefined ? "" : JSON.stringify(extra)}`);
  }
}

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object") return Number(v.low ?? 0) + Number(v.high ?? 0) * 4294967296;
  return Number(v);
}

async function raw(id: number) {
  return (storage as any).safeQuery(async (session: any) => {
    const { TypedValues, Types } = await import("ydb-sdk");
    const { resultSets } = await session.executeQuery(
      "DECLARE $id AS Utf8; SELECT id, name, stock, wholesale_price, size_stock FROM products WHERE id = $id;",
      { $id: TypedValues.fromNative(Types.UTF8, String(id)) },
    );
    const rs = resultSets[0];
    if (!rs?.rows?.[0] || !rs.columns) return null;
    return (storage as any).parseRowWithColumns(rs.rows[0], rs.columns);
  });
}

function baseProduct(ext: string, name: string, extra: Record<string, unknown>) {
  return {
    externalId: ext,
    name,
    description: "live stock column check, safe to delete",
    price: 100,
    imageUrl: "/placeholder.svg",
    category: "merch",
    sizes: ["S", "M"],
    colors: [],
    isHidden: true,
    ...extra,
  } as any;
}

async function main() {
  await initYdb();

  try {
    // 1) stock и wholesalePrice заданы явно, без sizeStock
    const p1 = await storage.createProduct(
      baseProduct(`ext-${TAG}-1`, `${TAG}-1`, { stock: 42, wholesalePrice: 300 }),
    );
    created.push(p1.id);
    const r1 = await raw(p1.id);
    check("stock из createProduct доехал (42)", num(r1?.stock) === 42, r1?.stock);
    check("wholesale_price из createProduct доехал (300)", num(r1?.wholesale_price) === 300, r1?.wholesale_price);

    // 2) stock выводится из sizeStock (единая точка пересчёта)
    const p2 = await storage.createProduct(
      baseProduct(`ext-${TAG}-2`, `${TAG}-2`, { sizeStock: { S: 1, M: 1 } }),
    );
    created.push(p2.id);
    const r2 = await raw(p2.id);
    check("stock посчитан из sizeStock (1+1=2)", num(r2?.stock) === 2, r2?.stock);

    // 3) обновление поверх создания по-прежнему работает
    await storage.updateProduct(p1.id, { stock: 9 } as any);
    const r3 = await raw(p1.id);
    check("updateProduct(stock: 9) применился", num(r3?.stock) === 9, r3?.stock);
  } finally {
    for (const id of created) {
      await storage.deleteProduct(id);
      const gone = await raw(id);
      check(`товар ${id} удалён`, gone === null);
    }
    console.log(`\nИтог: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
