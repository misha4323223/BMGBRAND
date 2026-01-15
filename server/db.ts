import ydb from "ydb-sdk";
import * as schema from "@shared/schema";

const endpoint = process.env.YDB_ENDPOINT || "grpcs://ydb.serverless.yandexcloud.net:2135";
const database = process.env.YDB_DATABASE || "/ru-central1/b1gnp4ml7k5j7cquabad/etnik3p0pg6vjcl2scou";

// В Replit мы не можем подключиться к YDB. 
// Чтобы избежать краша от внутренних циклов SDK, мы создаем драйвер только в облаке.
export let driver: ydb.Driver | null = null;

export async function initYdb() {
  const isCloud = process.env.NODE_ENV === "production" || !!process.env.YDB_SA_KEY;
  
  if (isCloud) {
    console.log(`[YDB] Initializing Driver for: ${endpoint}`);
    driver = new ydb.Driver({
      endpoint,
      database,
    });
    // В облаке драйвер сам подхватит credentials из среды
  } else {
    console.log("[YDB] Running in Local Dev mode. Database connections disabled to prevent crashes.");
  }
}

export { schema };
