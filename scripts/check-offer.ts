import { storage } from "../server/storage";

async function run() {
  const doc = await storage.getActiveLegalDocument("offer");
  console.log("id:", doc?.id);
  console.log("version:", doc?.version);
  console.log("title:", doc?.title);
  console.log("sha256:", doc?.sha256);
  const lines = (doc?.body || "").split("\n");
  const idx = lines.findIndex((l) => l.includes("Акцепт оферты"));
  console.log("--- пункт 4 ---");
  console.log(lines.slice(idx, idx + 5).join("\n"));
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
