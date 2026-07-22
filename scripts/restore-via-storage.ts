// Uses the server's own storage module (correct YDB connection & types)
import { storage } from "../server/storage";

const ORDER_ID = 1784720928694;

const allItems = [
  // Original preorder items (from Telegram notification, total 16110₽)
  { productId: 1775045793782, productName: 'Носки "Молодость внутри" Белый (40/45)', size: "40-45", quantity: 1, price: 50000 },
  { productId: 1774444228997, productName: 'Поясная сумка "Молодость внутри" черный', size: "OneSize", quantity: 1, price: 200000 },
  { productId: 1783338997316, productName: "ZIP-Худи Молодость внутри (Черный) Глаза", size: "XL", quantity: 1, price: 500000 },
  { productId: 1783338998064, productName: "Свитшот Молодость внутри  Сердце 2.0  (Черный)", size: "M", quantity: 1, price: 430500 },
  { productId: 1783339007851, productName: "Свитшот Молодость внутри  Глаза  (Черный)", size: "L", quantity: 1, price: 430500 },
  // Addon items (from Telegram notification, total 300₽)
  { productId: 1779364999202, productName: 'Силиконовый браслет "Молодость внутри" белый', size: "OneSize", quantity: 1, price: 15000, sku: "BO-002" },
  { productId: 1779364779992, productName: 'Силиконовый браслет "Молодость внутри" чёрный', size: "OneSize", quantity: 1, price: 15000, sku: "MANUAL-1779364779883" },
];
// 16110₽ + 300₽ = 16410₽
const newTotal = 1641000;

async function main() {
  // Wait for YDB driver
  await new Promise(r => setTimeout(r, 3000));

  const order = await storage.getOrder(ORDER_ID);
  if (!order) { console.error("❌ Order not found via storage.getOrder"); process.exit(1); }
  console.log("✅ Order found:", order.customerName);
  console.log("   Current items:", (order.items as any[]).length, "| total:", (order as any).total);

  await (storage as any).safeQuery(async (session: any) => {
    const { TypedValues } = await import("ydb-sdk");
    const query = `
      DECLARE $id AS Uint64;
      DECLARE $items AS Json;
      DECLARE $total AS Int32;
      UPDATE orders SET items = $items, total = $total WHERE id = $id;
    `;
    await session.executeQuery(query, {
      $id: TypedValues.uint64(ORDER_ID),
      $items: TypedValues.json(JSON.stringify(allItems)),
      $total: TypedValues.int32(newTotal),
    });
  });
  console.log("✅ Update sent");

  // Verify
  await new Promise(r => setTimeout(r, 1000));
  const updated = await storage.getOrder(ORDER_ID);
  console.log("   After update items:", (updated?.items as any[])?.length, "| total:", (updated as any)?.total);
  (updated?.items as any[])?.forEach((i: any, n: number) =>
    console.log(`   ${n+1}. ${i.productName} (${i.size}) ×${i.quantity}`)
  );
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
