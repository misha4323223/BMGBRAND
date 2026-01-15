import ydb from "ydb-sdk";
const { Driver, getCredentialsFromEnv } = ydb;
import * as schema from "@shared/schema";

const endpoint = process.env.YDB_ENDPOINT || "grpcs://ydb.serverless.yandexcloud.net:2135";
const database = process.env.YDB_DATABASE || "/ru-central1/b1gnp4ml7k5j7cquabad/etnik3p0pg6vjcl2scou";

if (!endpoint || !database) {
  throw new Error("YDB_ENDPOINT and YDB_DATABASE must be set for native YDB connection");
}

export const driver = new Driver({
  endpoint,
  database,
  authService: getCredentialsFromEnv(),
});

export async function initYdb() {
  if (!await driver.ready(10000)) {
    throw new Error("YDB driver failed to initialize");
  }
  console.log("YDB Driver ready");
}

// For now we will use raw YDB queries in storage.ts to avoid Drizzle incompatibility with native YDB
export { schema };
