/**
 * ЖИВОЙ прогон выгрузки offers.xml на продовой YDB.
 *
 *   npx tsx scripts/check-offers-live.ts
 *
 * Зачем временная копия: `updateProductPricesFromOffers` /
 * `updateProductSizesFromOffers` не экспортированы из server/routes.ts, а сам
 * файл при импорте запускает фоновые таймеры (CDEK-поллинг, черновики,
 * холды, промокоды) и прогрев кэша ПВЗ СДЭК. Поэтому создаётся временная копия
 * `server/routes.__live_harness.ts` с заглушками таймеров и экспортом двух
 * функций; исходники проекта не меняются, копия удаляется в finally.
 *
 * Выгрузка узкая (только 3 временных скрытых товара), поэтому продовые товары
 * не затрагиваются. Товары удаляются в finally.
 */
import fs from "fs";
import path from "path";
import { initYdb } from "../server/db";
import { storage } from "../server/storage";

const ROOT = path.resolve(import.meta.dirname, "..");
const ROUTES_SRC = path.join(ROOT, "server/routes.ts");
const HARNESS = path.join(ROOT, "server/routes.__live_harness.ts");
const HARNESS_IMPORT = "../server/routes.__live_harness.ts";

// Модуль routes.ts при импорте запускает фоновые задачи, которые пишут в
// продовую базу (поллинг CDEK, чистка черновиков, автоподтверждение холдов,
// деактивация промокодов). В harness они отключаются ранним return в самих
// функциях — глушить setTimeout целиком нельзя: на нём же работает
// штатная пауза throttleBulk() внутри самого пайплайна.
const DISABLED_JOBS = [
  "async function pollCdekStatuses() {",
  "async function cleanupExpiredDrafts() {",
  "async function autoConfirmExpiredHolds() {",
  "async function deactivateExpiredPromos() {",
];

const TAG = `LIVE-OFFERS-${Date.now()}`;
const EXT = { a: `ext-A-${TAG}`, b: `ext-B-${TAG}`, c: `ext-C-${TAG}` };

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

async function rawProduct(id: number): Promise<any | null> {
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

function newProduct(ext: string, name: string) {
  return {
    externalId: ext,
    sku: `${ext}-sku`,
    name,
    description: "live offers check, safe to delete",
    price: 1000,
    imageUrl: "/placeholder.svg",
    category: "merch",
    sizes: ["S", "M"],
    colors: [],
    isHidden: true,
    sizeStock: { S: 1, M: 1 },
    stock: 2,
  } as any;
}

function priceData(stock: number) {
  return {
    retailPrice: 2222,
    wholesalePrice: null,
    totalStock: stock,
    hasStockData: true,
    sizeStock: { XL: stock },
    sizeCharacteristicIds: { XL: `guid-${TAG.slice(-6)}` },
  } as any;
}

function buildHarness(): void {
  const src = fs.readFileSync(ROUTES_SRC, "utf8");
  const ycpImport = 'import { registerYcpRoutes, isYcpBuyable } from "./ycp";';
  if (!src.includes(ycpImport)) throw new Error("harness: не найден импорт ./ycp в routes.ts");
  let patched = src.replace(
    ycpImport,
    "// LIVE HARNESS: ycp не импортируем (прогрев кэша ПВЗ СДЭК стартует на импорте)\n" +
      "const registerYcpRoutes: any = () => {};\nconst isYcpBuyable: any = () => false;",
  );
  for (const signature of DISABLED_JOBS) {
    if (!patched.includes(signature)) throw new Error(`harness: не найдена функция ${signature}`);
    patched = patched.replace(signature, `${signature}\n  return; // LIVE HARNESS: фоновые задачи отключены`);
  }
  fs.writeFileSync(
    HARNESS,
    patched + "\nexport { updateProductPricesFromOffers, updateProductSizesFromOffers };\n",
  );
}

const created: number[] = [];

/** Уборка: тестовые товары + временный файл. Вызывается и по сигналу (timeout). */
async function cleanup(reason: string) {
  console.log(`\n[cleanup] ${reason}`);
  while (created.length) {
    const id = created.pop()!;
    try {
      await storage.deleteProduct(id);
      const gone = await rawProduct(id);
      console.log(`      id ${id}: ${gone ? "ВСЁ ЕЩЁ В БАЗЕ" : "удалён"}`);
      if (gone) fail++;
    } catch (e: any) {
      console.log(`      id ${id}: ошибка удаления ${e?.message || e}`);
      fail++;
    }
  }
  fs.rmSync(HARNESS, { force: true });
}

let cleanupStarted = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    cleanup(`получен ${sig}`)
      .catch((e) => console.error("[cleanup] ошибка:", e?.message || e))
      .finally(() => {
        console.log(`\nИтог: ${pass} passed, ${fail} failed (прогон прерван)`);
        process.exit(1);
      });
  });
}

async function main() {
  await initYdb();
  buildHarness();

  try {
    const { updateProductPricesFromOffers, updateProductSizesFromOffers } = (await import(
      HARNESS_IMPORT
    )) as any;

    const a = await storage.createProduct(newProduct(EXT.a, `${TAG}-A`));
    created.push(a.id);
    await storage.updateProduct(a.id, { stockSyncDisabled: true } as any);

    const b = await storage.createProduct(newProduct(EXT.b, `${TAG}-B`));
    created.push(b.id);
    // autoHideOverride: ветка «вернуть на витрину» шлёт алерт владельцу в TG/VK
    await storage.updateProduct(b.id, { autoHideOverride: true } as any);

    const c = await storage.createProduct(newProduct(EXT.c, `${TAG}-C`));
    created.push(c.id);
    await storage.updateProduct(c.id, {
      preorderEnabled: true,
      preorderStatus: "collecting",
      autoHideOverride: true,
    } as any);

    console.log(`\n[live] тестовые товары: A=${a.id} (флаг), B=${b.id} (контроль), C=${c.id} (предзаказ)\n`);
    const before = { a: await rawProduct(a.id), b: await rawProduct(b.id), c: await rawProduct(c.id) };

    storage.clearProductCache(); // функции читают список товаров заново из YDB

    const prices = new Map<string, any>([
      [EXT.a, priceData(5)],
      [EXT.b, priceData(5)],
      [EXT.c, priceData(5)],
    ]);
    const sizes = new Map<string, Set<string>>([
      [EXT.a, new Set(["XL"])],
      [EXT.b, new Set(["XL"])],
      [EXT.c, new Set(["XL"])],
    ]);

    const pricesUpdated = await updateProductPricesFromOffers(prices);
    const sizesUpdated = await updateProductSizesFromOffers(sizes, prices);

    const after = { a: await rawProduct(a.id), b: await rawProduct(b.id), c: await rawProduct(c.id) };
    console.log(`\n[live] товаров обработано: prices=${pricesUpdated}, sizes=${sizesUpdated}`);
    console.log(`[live] A: ${JSON.stringify({ price: after.a.price, stock: after.a.stock, sizeStock: after.a.sizeStock, sizes: after.a.sizes, flag: after.a.stockSyncDisabled })}`);
    console.log(`[live] B: ${JSON.stringify({ price: after.b.price, stock: after.b.stock, sizeStock: after.b.sizeStock, sizes: after.b.sizes, flag: after.b.stockSyncDisabled })}`);
    console.log(`[live] C: ${JSON.stringify({ price: after.c.price, stock: after.c.stock, sizeStock: after.c.sizeStock, sizes: after.c.sizes, preorder: after.c.preorderEnabled })}\n`);

    check("пайплайн нашёл все три товара (prices=3)", pricesUpdated === 3, pricesUpdated);
    // sizes вернёт 1: A и C пропущены по флагу, записаны только размеры контроля
    check("размеры записаны только контролю (sizes=1)", sizesUpdated === 1, sizesUpdated);

    // --- A: явный флаг «остатки вручную» ---
    check("A: цена из 1С применилась (пайплайн реально шёл)", after.a.price === 2222, after.a.price);
    check("A: stock не перезаписан", after.a.stock === before.a.stock, { before: before.a.stock, after: after.a.stock });
    check("A: sizeStock не перезаписан", JSON.stringify(after.a.sizeStock) === JSON.stringify(before.a.sizeStock), after.a.sizeStock);
    check("A: размеры не дополнены из 1С", JSON.stringify(after.a.sizes) === JSON.stringify(before.a.sizes), after.a.sizes);
    check("A: GUID характеристик всё же обновились", after.a.sizeCharacteristicIds?.XL === `guid-${TAG.slice(-6)}`, after.a.sizeCharacteristicIds);

    // --- B: контроль без флага ---
    check("B: цена из 1С применилась", after.b.price === 2222, after.b.price);
    check("B: stock обновлён (S:1 + M:1 + XL:5)", after.b.stock === 7, after.b.stock);
    check("B: sizeStock обновлён", JSON.stringify(after.b.sizeStock) === JSON.stringify({ S: 1, M: 1, XL: 5 }), after.b.sizeStock);
    check("B: размеры дополнены из 1С", JSON.stringify([...after.b.sizes].sort()) === JSON.stringify(["M", "S", "XL"]), after.b.sizes);
    check("B: товар не всплыл на витрину", after.b.isHidden === true, after.b.isHidden);

    // --- C: предзаказ без колонки ---
    check("C: колонка флага пустая", after.c.stockSyncDisabled === false, after.c.stockSyncDisabled);
    check("C: защита сработала через предзаказ", after.c.preorderEnabled === true, after.c.preorderEnabled);
    check("C: цена применилась, остатки нет", after.c.price === 2222 && after.c.stock === before.c.stock, { price: after.c.price, stock: after.c.stock });
    check("C: sizeStock и sizes не тронуты", JSON.stringify(after.c.sizeStock) === JSON.stringify(before.c.sizeStock) && JSON.stringify(after.c.sizes) === JSON.stringify(before.c.sizes), { sizeStock: after.c.sizeStock, sizes: after.c.sizes });
  } finally {
    cleanupStarted = true;
    await cleanup("удаляю тестовые товары и временный файл");
    console.log(`\nИтог: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  fs.rmSync(HARNESS, { force: true });
  process.exit(1);
});
