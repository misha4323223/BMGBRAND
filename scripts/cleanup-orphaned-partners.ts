import ydb, { getSACredentialsFromJson } from 'ydb-sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function main() {
  const endpoint = process.env.YDB_ENDPOINT;
  const database = process.env.YDB_DATABASE;
  const saKeyRaw = process.env.YDB_SA_KEY;

  if (!endpoint || !database || !saKeyRaw) {
    console.log('Missing env vars:', { endpoint: !!endpoint, database: !!database, saKey: !!saKeyRaw });
    process.exit(1);
  }

  const tmpFile = path.join(os.tmpdir(), 'ydb-sa-check.json');
  fs.writeFileSync(tmpFile, saKeyRaw);
  const saCredentials = getSACredentialsFromJson(tmpFile);
  const authService = new ydb.IamAuthService(saCredentials);
  const driver = new ydb.Driver({ endpoint, database, authService });

  console.log('Connecting to YDB...');
  await driver.ready(10000);
  console.log('Driver ready\n');

  // 1. Получить все id партнёров из таблицы partners
  const r1 = await driver.tableClient.withSession(async (session) => {
    const res = await session.executeQuery(`SELECT user_id FROM partners`);
    return res;
  });
  const rs1 = r1.resultSets?.[0];
  const partnerUserIds = new Set<string>();
  for (const row of (rs1?.rows || [])) {
    const v = row.items?.[0];
    const val = v?.textValue ?? v?.uint64Value ?? v?.optionalValue?.textValue;
    if (val) partnerUserIds.add(String(val));
  }
  console.log(`Partners table: ${partnerUserIds.size} records`);

  // 2. Получить всех пользователей с role=partner
  const r2 = await driver.tableClient.withSession(async (session) => {
    const res = await session.executeQuery(
      `SELECT id, email, email_verified FROM users WHERE role = 'partner' ORDER BY id`
    );
    return res;
  });
  const rs2 = r2.resultSets?.[0];
  const cols2 = (rs2?.columns || []).map((c: any) => c.name);
  const rows2 = rs2?.rows || [];

  const orphaned: Array<{ id: string; email: string; emailVerified: boolean }> = [];
  const valid: Array<{ id: string; email: string }> = [];

  for (const row of rows2) {
    const items = row.items || [];
    const obj: any = {};
    cols2.forEach((c: string, i: number) => {
      const v = items[i];
      obj[c] = v?.textValue ?? v?.uint64Value ?? v?.boolValue ?? v?.optionalValue?.textValue ?? v?.optionalValue?.boolValue ?? null;
    });
    const id = String(obj.id);
    if (!partnerUserIds.has(id)) {
      orphaned.push({ id, email: obj.email, emailVerified: !!obj.email_verified });
    } else {
      valid.push({ id, email: obj.email });
    }
  }

  console.log(`\nValid users (in both users + partners): ${valid.length}`);
  for (const u of valid) {
    console.log(`  ✅ id=${u.id}  email=${u.email}`);
  }

  console.log(`\nOrphaned users (in users but NOT in partners): ${orphaned.length}`);
  for (const u of orphaned) {
    console.log(`  ⚠️  id=${u.id}  email=${u.email}  verified=${u.emailVerified}`);
  }

  const dryRun = process.argv[2] !== '--delete';
  if (dryRun) {
    console.log('\n⚡ DRY RUN — передайте флаг --delete для реального удаления');
    await driver.destroy();
    fs.unlinkSync(tmpFile);
    return;
  }

  // Удаляем осиротевших
  console.log('\n🗑  Удаляем осиротевших...');
  const { TypedValues, Types } = await import('ydb-sdk');
  for (const u of orphaned) {
    await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $id AS Utf8; DELETE FROM users WHERE id = $id`;
      await session.executeQuery(query, {
        $id: TypedValues.fromNative(Types.UTF8, u.id),
      });
    });
    console.log(`  ✅ Удалён id=${u.id}  email=${u.email}`);
  }

  console.log('\nГотово!');
  await driver.destroy();
  fs.unlinkSync(tmpFile);
}

main().catch(e => { console.error(e); process.exit(1); });
