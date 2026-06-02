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
  const ready = await driver.ready(10000);
  if (!ready) { console.log('Driver not ready'); process.exit(1); }
  console.log('Driver ready');

  // Все партнёры в users
  const r1 = await driver.tableClient.withSession(async (session) => {
    const res = await session.executeQuery(
      `SELECT id, email, role FROM users WHERE role = 'partner' ORDER BY id LIMIT 50`
    );
    return res;
  });
  const rs1 = r1.resultSets?.[0];
  const cols1 = (rs1?.columns || []).map((c: any) => c.name);
  const rows1 = rs1?.rows || [];
  console.log(`\n=== Partner users in users table (${rows1.length}) ===`);
  for (const row of rows1) {
    const items = row.items || [];
    const obj: any = {};
    cols1.forEach((c: string, i: number) => {
      const v = items[i];
      obj[c] = v?.textValue ?? v?.uint64Value ?? v?.boolValue ?? v?.optionalValue?.textValue ?? null;
    });
    console.log(`  id=${obj.id}  email=${obj.email}`);
  }

  // Все pending submissions
  const r2 = await driver.tableClient.withSession(async (session) => {
    const res = await session.executeQuery(
      `SELECT id, email, created_at FROM partner_pending_submissions ORDER BY created_at DESC LIMIT 20`
    );
    return res;
  });
  const rs2 = r2.resultSets?.[0];
  const cols2 = (rs2?.columns || []).map((c: any) => c.name);
  const rows2 = rs2?.rows || [];
  console.log(`\n=== partner_pending_submissions (${rows2.length} recent) ===`);
  for (const row of rows2) {
    const items = row.items || [];
    const obj: any = {};
    cols2.forEach((c: string, i: number) => {
      const v = items[i];
      obj[c] = v?.textValue ?? v?.uint64Value ?? v?.boolValue ?? v?.optionalValue?.textValue ?? null;
    });
    console.log(`  id=${obj.id}  email=${obj.email}  created=${obj.created_at}`);
  }

  await driver.destroy();
  fs.unlinkSync(tmpFile);
}

main().catch(e => { console.error(e); process.exit(1); });
