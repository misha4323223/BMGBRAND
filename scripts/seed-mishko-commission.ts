/**
 * Одноразовый скрипт: создаёт тестовую confirmed-комиссию у партнёра
 * Mishko (id=1777313249486) на сумму 3000 ₽, чтобы можно было прогнать
 * E2E-сценарий выплаты самозанятому. Безопасный: ничего не правит у других
 * партнёров, только создаёт ОДНУ комиссию и переводит её в confirmed.
 *
 * Запуск:  npx tsx scripts/seed-mishko-commission.ts
 *
 * После прогона E2E эту комиссию можно увидеть и при необходимости отменить
 * через админку: «Отменить» в списке partner-commissions.
 */
import { initYdb } from "../server/db";
import { storage } from "../server/storage";

const PARTNER_ID = 1777313249486;
const COMMISSION_KOPEKS = 300_000; // 3000 ₽ — ровно минимум для запроса выплаты
const ITEMS_TOTAL = 1_500_000; // 15000 ₽ — фиктивная сумма заказа (для отчётности)
const COMMISSION_PERCENT = 20;
// Фиктивный orderId, чтобы исключить коллизию с настоящими заказами.
// Используем большое число с пометкой времени.
const FAKE_ORDER_ID = 999_000_000_000 + Math.floor(Date.now() / 1000) % 1_000_000;

async function main() {
  console.log(`[seed-mishko] Запуск. partnerId=${PARTNER_ID}`);
  await initYdb();

  const partner = await storage.getPartnerById(PARTNER_ID);
  if (!partner) {
    console.error(`[seed-mishko] ОШИБКА: партнёр ${PARTNER_ID} не найден`);
    process.exit(1);
  }
  console.log(`[seed-mishko] партнёр: ${partner.contactName} <${partner.contactEmail}> slug=${partner.partnerSlug} status=${partner.status}`);

  const statsBefore = await storage.getPartnerStats(PARTNER_ID);
  console.log(`[seed-mishko] stats ДО:`, statsBefore);

  console.log(`[seed-mishko] создаю комиссию orderId=${FAKE_ORDER_ID}, amount=${COMMISSION_KOPEKS} коп. (${COMMISSION_KOPEKS / 100} ₽)...`);
  const created = await storage.createPartnerCommission({
    partnerId: PARTNER_ID,
    orderId: FAKE_ORDER_ID,
    orderItemsTotal: ITEMS_TOTAL,
    commissionPercent: COMMISSION_PERCENT,
    commissionAmount: COMMISSION_KOPEKS,
  });
  console.log(`[seed-mishko] создана комиссия id=${created.id} status=${created.status}`);

  console.log(`[seed-mishko] перевожу в 'confirmed' (это инкрементит totalEarned)...`);
  await storage.updateCommissionStatus(created.id, "confirmed");

  const statsAfter = await storage.getPartnerStats(PARTNER_ID);
  console.log(`[seed-mishko] stats ПОСЛЕ:`, statsAfter);

  const partnerAfter = await storage.getPartnerById(PARTNER_ID);
  console.log(`[seed-mishko] partner.totalEarned=${partnerAfter?.totalEarned}`);

  console.log(`[seed-mishko] Готово. Mishko может зайти в /partner и нажать «Запросить выплату».`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-mishko] FATAL:", err);
  process.exit(1);
});
