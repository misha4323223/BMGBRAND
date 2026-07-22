// Read the order directly from YDB, bypassing server cache
import ydb, { getSACredentialsFromJson } from "ydb-sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  const endpoint = process.env.YDB_ENDPOINT!;
  const database = process.env.YDB_DATABASE!;
  let saKeyJson = process.env.YDB_SA_KEY!;
  try {
    const p = JSON.parse(saKeyJson);
    if (p.private_key) { p.private_key = p.private_key.replace(/\\n/g, "\n"); saKeyJson = JSON.stringify(p); }
  } catch {}
  const tmp = path.join(os.tmpdir(), `sa_chk_${Date.now()}.json`);
  fs.writeFileSync(tmp, saKeyJson);
  const driver = new ydb.Driver({ endpoint, database, authService: new ydb.IamAuthService(getSACredentialsFromJson(tmp)) });
  if (!await driver.ready(10000)) throw new Error("not ready");
  fs.unlinkSync(tmp);

  await driver.tableClient.withSession(async (session) => {
    const r = await session.executeQuery(
      "DECLARE $id AS Uint64; SELECT id, items, total FROM orders WHERE id = $id;",
      { $id: ydb.TypedValues.uint64(1784720928694n) }
    );
    const row = r.resultSets?.[0]?.rows?.[0] as any;
    if (!row) { console.log("NOT FOUND"); return; }
    // items is column index 1
    const rawItems = row.items?.[1];
    console.log("total raw:", JSON.stringify(row.items?.[2]));
    console.log("items raw type keys:", rawItems ? Object.keys(rawItems) : "null");
    const itemsVal = rawItems?.bytesValue?.toString("utf8") || rawItems?.textValue || "N/A";
    console.log("items value:", itemsVal.slice(0, 500));
  });
  await driver.destroy();
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); });
