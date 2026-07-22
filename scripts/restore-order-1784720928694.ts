/**
 * One-time restore script for order 1784720928694 (Брюховецкий).
 * Original items were overwritten by the appendOrderItems bug.
 * Data source: Telegram notifications.
 */
import ydb, { getSACredentialsFromJson } from "ydb-sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ORDER_ID = 1784720928694n;

// Original preorder items (from Telegram notification, total 16110₽)
// Distributed proportionally: носки 500₽, сумка 2000₽, zip-худи 5000₽, свитшот сердце 4305₽, свитшот глаза 4305₽
const originalItems = [
  {
    productId: 1775045793782,
    productName: 'Носки "Молодость внутри" Белый (40/45)',
    size: "40-45",
    quantity: 1,
    price: 50000,
  },
  {
    productId: 1774444228997,
    productName: 'Поясная сумка "Молодость внутри" черный',
    size: "OneSize",
    quantity: 1,
    price: 200000,
  },
  {
    productId: 1783338997316,
    productName: "ZIP-Худи Молодость внутри (Черный) Глаза",
    size: "XL",
    quantity: 1,
    price: 500000,
  },
  {
    productId: 1783338998064,
    productName: "Свитшот Молодость внутри  Сердце 2.0  (Черный)",
    size: "M",
    quantity: 1,
    price: 430500,
  },
  {
    productId: 1783339007851,
    productName: "Свитшот Молодость внутри  Глаза  (Черный)",
    size: "L",
    quantity: 1,
    price: 430500,
  },
];

// Addon items (from Telegram notification, total 300₽)
const addonItems = [
  {
    productId: 1779364999202,
    productName: 'Силиконовый браслет "Молодость внутри" белый',
    size: "OneSize",
    quantity: 1,
    price: 15000,
    sku: "BO-002",
  },
  {
    productId: 1779364779992,
    productName: 'Силиконовый браслет "Молодость внутри" чёрный',
    size: "OneSize",
    quantity: 1,
    price: 15000,
    sku: "MANUAL-1779364779883",
  },
];

const allItems = [...originalItems, ...addonItems];
// 16110₽ original + 300₽ addon = 16410₽ → kopecks: 1641000
const newTotal = 1611000 + 30000;

async function main() {
  const endpoint = process.env.YDB_ENDPOINT!;
  const database = process.env.YDB_DATABASE!;
  const saKeyRaw = process.env.YDB_SA_KEY!;

  // Write SA key to temp file (same pattern as db.ts)
  let saKeyJson = saKeyRaw;
  try {
    const parsed = JSON.parse(saKeyRaw);
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      saKeyJson = JSON.stringify(parsed);
    }
  } catch {}
  const tmpFile = path.join(os.tmpdir(), `sa_key_restore_${Date.now()}.json`);
  fs.writeFileSync(tmpFile, saKeyJson);

  const saCredentials = getSACredentialsFromJson(tmpFile);
  const authService = new ydb.IamAuthService(saCredentials);
  const driver = new ydb.Driver({ endpoint, database, authService });

  const ready = await driver.ready(10000);
  fs.unlinkSync(tmpFile);
  if (!ready) throw new Error("YDB driver not ready");
  console.log("YDB connected");

  await driver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $id AS Uint64;
      DECLARE $items AS Json;
      DECLARE $total AS Int32;
      UPDATE orders SET items = $items, total = $total WHERE id = $id;
    `;
    await session.executeQuery(query, {
      $id: ydb.TypedValues.uint64(ORDER_ID),
      $items: ydb.TypedValues.json(JSON.stringify(allItems)),
      $total: ydb.TypedValues.int32(newTotal),
    });
    console.log(`✅ Order ${ORDER_ID} restored:`);
    console.log(`   Items: ${allItems.length} (${originalItems.length} original + ${addonItems.length} addon)`);
    console.log(`   Total: ${newTotal / 100}₽`);
    allItems.forEach((i, idx) =>
      console.log(`   ${idx + 1}. ${i.productName} (${(i as any).size}) ×${i.quantity} — ${i.price / 100}₽`)
    );
  });

  await driver.destroy();
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
