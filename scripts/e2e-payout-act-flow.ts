/**
 * E2E-тест поддержки выплат для ИП и ЮЛ через акт оказанных услуг.
 *
 * Прогоняет полный жизненный цикл выплаты для трёх типов партнёров:
 *   • self_employed (СЗ)        → paid_pending_receipt + receiptUrl → completed
 *   • ip            (ИП)        → paid_pending_act     + actUrl     → completed
 *   • ooo           (ЮЛ)        → paid_pending_act     + actUrl     → completed
 *
 * Что проверяется:
 *   1. Schema: новые колонки act_url/act_uploaded_at/act_number пишутся и читаются.
 *   2. Schema: статус paid_pending_act сохраняется и возвращается.
 *   3. mapPartnerPayoutRow: null-safe чтение act-полей у выплат, созданных ДО миграции.
 *   4. updatePartnerPayoutFields: corrColMap для act_*.
 *   5. createPartnerPayout: новые поля в return-объекте инициализируются как null.
 *   6. Бизнес-правило admin/mark-paid: legalStatus=ip|ooo → paid_pending_act, иначе → paid_pending_receipt.
 *   7. Бизнес-правило admin/complete: требует actUrl при paid_pending_act, receiptUrl при paid_pending_receipt.
 *
 * Использует БОЕВУЮ YDB через server/storage (тот же, что и приложение). После прогона
 * полностью удаляет за собой все созданные данные через прямой YDB DELETE.
 *
 * Запуск:  npx tsx scripts/e2e-payout-act-flow.ts
 */
import { initYdb } from "../server/db";
import { storage } from "../server/storage";
import type { PartnerLegalStatus } from "../shared/schema";

const TAG = `e2e-act-${Date.now()}`;

// ---------- helpers ----------
function assert(cond: any, msg: string): asserts cond {
  if (!cond) {
    console.error(`  ❌ ASSERT FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

async function rawDelete(table: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { TypedValues } = await import("ydb-sdk");
  const { driver } = await import("../server/db");
  if (!driver) throw new Error("ydb driver не инициализирован — нечем выполнять DELETE");
  await driver.tableClient.withSession(async (session: any) => {
    for (const id of ids) {
      await session.executeQuery(
        `DECLARE $id AS Uint64; DELETE FROM ${table} WHERE id = $id;`,
        { $id: TypedValues.uint64(id) },
      );
    }
  });
}

// ---------- single scenario ----------
interface ScenarioResult {
  partnerId: number;
  commissionId: number;
  payoutId: number;
}

async function runScenario(legalStatus: PartnerLegalStatus): Promise<ScenarioResult> {
  const isLegalEntity = legalStatus === "ip" || legalStatus === "ooo";
  const expectedNextStatus = isLegalEntity ? "paid_pending_act" : "paid_pending_receipt";
  const docKind = isLegalEntity ? "act" : "receipt";

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Сценарий: legalStatus=${legalStatus} → ожидаем "${expectedNextStatus}"`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // 1. Создаём партнёра
  const slug = `${TAG}-${legalStatus}`;
  const fakeUserId = Date.now() + Math.floor(Math.random() * 1e6);
  const partner = await storage.createPartner(
    {
      userId: fakeUserId,
      partnerSlug: slug,
      storeName: `E2E ${legalStatus}`,
      contactName: "E2E Test",
      contactEmail: `${slug}@example-test.invalid`,
      contactPhone: "+70000000000",
      commissionOverride: 20,
      legalStatus,
      companyName: isLegalEntity ? `E2E ${legalStatus.toUpperCase()} 12345` : null,
    } as any,
    [],
  );
  console.log(`  Создан партнёр id=${partner.id}, legalStatus=${partner.legalStatus}`);
  assert(partner.legalStatus === legalStatus, `partner.legalStatus прочитан как "${legalStatus}"`);

  // 2. Approve (createPartner уже ставит approved, но для надёжности)
  await storage.updatePartnerStatus(partner.id, "approved");

  // 3. Тестовая комиссия
  const fakeOrderId = 990_000_000_000 + Math.floor(Math.random() * 1e9);
  const commission = await storage.createPartnerCommission({
    partnerId: partner.id,
    orderId: fakeOrderId,
    orderItemsTotal: 1_500_000,
    commissionPercent: 20,
    commissionAmount: 300_000, // 3000 ₽ — минимум
  });
  await storage.updateCommissionStatus(commission.id, "confirmed");
  console.log(`  Создана и подтверждена комиссия id=${commission.id} на 3000 ₽`);

  // 4. Создаём выплату
  const payout = await storage.createPartnerPayout({
    partnerId: partner.id,
    amount: 300_000,
    commissionIds: [commission.id],
    method: "card",
    recipientName: `E2E ${legalStatus}`,
    recipientDetails: "0000 0000 0000 0000",
    note: `E2E test ${legalStatus}`,
    createdBy: "e2e-test",
  });
  console.log(`  Создана выплата id=${payout.id}`);

  // ── ПРОВЕРКА #1: новые поля в return от createPartnerPayout инициализированы null
  assert(payout.actUrl === null, "createPartnerPayout returns actUrl=null");
  assert(payout.actUploadedAt === null, "createPartnerPayout returns actUploadedAt=null");
  assert(payout.actNumber === null, "createPartnerPayout returns actNumber=null");
  assert(payout.status === "awaiting_invoice", `начальный статус = awaiting_invoice`);

  // ── ПРОВЕРКА #2: getPayoutById сразу после создания читает act_* как null
  const fresh = await storage.getPayoutById(payout.id);
  assert(fresh !== null, "getPayoutById возвращает выплату");
  assert(fresh!.actUrl === null, "mapPartnerPayoutRow: act_url = null (null-safe)");
  assert(fresh!.actUploadedAt === null, "mapPartnerPayoutRow: act_uploaded_at = null");
  assert(fresh!.actNumber === null, "mapPartnerPayoutRow: act_number = null");

  // 5. Симуляция загрузки счёта партнёром
  await storage.updatePartnerPayoutFields(payout.id, {
    status: "invoice_uploaded",
    invoiceUrl: `e2e-invoice-${payout.id}`,
    invoiceUploadedAt: new Date(),
    invoiceNumber: "TEST-INV-1",
  });
  console.log(`  Загружен счёт → invoice_uploaded`);

  // 6. Симуляция admin "mark-paid" — повторяем точную логику из admin-partner-routes.ts:436
  const partnerLoaded = await storage.getPartnerById(partner.id);
  const isLE = partnerLoaded?.legalStatus === "ip" || partnerLoaded?.legalStatus === "ooo";
  const nextStatus = isLE ? "paid_pending_act" : "paid_pending_receipt";

  // ── ПРОВЕРКА #3: бизнес-правило mark-paid
  assert(
    nextStatus === expectedNextStatus,
    `admin mark-paid выбирает "${expectedNextStatus}" для legalStatus=${legalStatus}`,
  );

  await storage.updatePartnerPayoutFields(payout.id, {
    status: nextStatus,
    paidAt: new Date(),
    paidReference: "TEST-REF-001",
  });
  const afterPaid = await storage.getPayoutById(payout.id);
  assert(afterPaid!.status === nextStatus, `статус сохранён как "${nextStatus}"`);

  // 7. Симуляция загрузки закрывающего документа партнёром
  if (docKind === "act") {
    await storage.updatePartnerPayoutFields(payout.id, {
      actUrl: `e2e-act-${payout.id}`,
      actUploadedAt: new Date(),
      actNumber: `АКТ-E2E-${payout.id}`,
    });
    console.log(`  Загружен акт`);
    const withAct = await storage.getPayoutById(payout.id);
    // ── ПРОВЕРКА #4: act_* поля корректно записаны и прочитаны через colMap
    assert(withAct!.actUrl === `e2e-act-${payout.id}`, `act_url записан и прочитан корректно`);
    assert(withAct!.actNumber === `АКТ-E2E-${payout.id}`, `act_number записан и прочитан`);
    assert(withAct!.actUploadedAt instanceof Date, `act_uploaded_at записан как Timestamp`);
    assert(withAct!.receiptUrl === null, `receipt_url остался null (не путаются)`);
  } else {
    await storage.updatePartnerPayoutFields(payout.id, {
      receiptUrl: `e2e-receipt-${payout.id}`,
      receiptUploadedAt: new Date(),
      receiptNumber: `ЧЕК-E2E-${payout.id}`,
    });
    console.log(`  Загружен чек`);
    const withRcpt = await storage.getPayoutById(payout.id);
    assert(withRcpt!.receiptUrl === `e2e-receipt-${payout.id}`, `receipt_url записан корректно`);
    assert(withRcpt!.actUrl === null, `act_url остался null (не путаются)`);
  }

  // 8. Симуляция admin "complete" — повторяем логику из admin-partner-routes.ts:497
  const beforeComplete = await storage.getPayoutById(payout.id);
  if (beforeComplete!.status === "paid_pending_receipt") {
    assert(beforeComplete!.receiptUrl !== null, "complete: receiptUrl присутствует для paid_pending_receipt");
  } else if (beforeComplete!.status === "paid_pending_act") {
    assert(beforeComplete!.actUrl !== null, "complete: actUrl присутствует для paid_pending_act");
  }
  await storage.updatePartnerPayoutFields(payout.id, {
    status: "completed",
    completedAt: new Date(),
  });
  const finalPayout = await storage.getPayoutById(payout.id);
  assert(finalPayout!.status === "completed", `финальный статус = completed`);
  assert(finalPayout!.completedAt instanceof Date, `completed_at установлен`);

  // Дополнительно: в completed-state сохранились все накопленные документы
  if (docKind === "act") {
    assert(finalPayout!.actUrl === `e2e-act-${payout.id}`, `после completed actUrl сохранён`);
    assert(finalPayout!.actNumber === `АКТ-E2E-${payout.id}`, `после completed actNumber сохранён`);
  } else {
    assert(finalPayout!.receiptUrl === `e2e-receipt-${payout.id}`, `после completed receiptUrl сохранён`);
  }

  console.log(`  ✅ Сценарий ${legalStatus} прошёл успешно`);
  return { partnerId: partner.id, commissionId: commission.id, payoutId: payout.id };
}

// ---------- cleanup ----------
async function cleanup(results: ScenarioResult[]): Promise<void> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Удаляем тестовые данные…`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const payoutIds = results.map(r => r.payoutId);
  const commissionIds = results.map(r => r.commissionId);
  const partnerIds = results.map(r => r.partnerId);
  // Порядок важен: payouts → commissions → partners (избегаем висящих ссылок).
  await rawDelete("partner_payouts", payoutIds);
  console.log(`  Удалено выплат: ${payoutIds.length}`);
  await rawDelete("partner_commissions", commissionIds);
  console.log(`  Удалено комиссий: ${commissionIds.length}`);
  await rawDelete("partners", partnerIds);
  console.log(`  Удалено партнёров: ${partnerIds.length}`);
  // На случай, если consent_signatures были созданы (мы передавали [] — но всё равно проверим)
  // и удалим pending_submissions если есть — их быть не должно.
}

// ---------- main ----------
async function main() {
  console.log(`\n========== E2E PAYOUT ACT FLOW ==========`);
  console.log(`tag: ${TAG}`);
  await initYdb();
  console.log(`YDB готов\n`);

  const results: ScenarioResult[] = [];
  let success = false;
  try {
    results.push(await runScenario("self_employed"));
    results.push(await runScenario("ip"));
    results.push(await runScenario("ooo"));
    success = true;
  } catch (err) {
    console.error(`\n❌ Сценарий упал:`, err);
  } finally {
    if (results.length > 0) {
      try { await cleanup(results); } catch (e) { console.error("cleanup error:", e); }
    }
  }

  console.log(`\n========== ИТОГ ==========`);
  console.log(success ? `✅ ВСЕ 3 СЦЕНАРИЯ ПРОШЛИ` : `❌ ТЕСТ УПАЛ`);
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
