import ydb, { getSACredentialsFromJson } from "ydb-sdk";
import { logError, logWarn } from "./logger";
import * as schema from "@shared/schema";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const endpoint = process.env.YDB_ENDPOINT || "grpcs://ydb.serverless.yandexcloud.net:2135";
const database = process.env.YDB_DATABASE || "/ru-central1/b1gnp4ml7k5j7cquabad/etnik3p0pg6vjcl2scou";

// В Replit мы не можем подключиться к YDB. 
// Чтобы избежать краша от внутренних циклов SDK, мы создаем драйвер только в облаке.
export let driver: ydb.Driver | null = null;
let driverReady: Promise<boolean> | null = null;
let reconnecting = false;
let lastAuthError = 0;
// Флаг: CREATE TABLE вызываем только один раз за жизнь процесса.
// Предотвращает повторный вызов при reconnectYdb() и снижает
// количество DDL-операций при массовом cold start.
let tablesInitialized = false;

export async function waitForDriver(): Promise<ydb.Driver | null> {
  // Race-safe wait: if reconnectYdb() runs between us reading `driverReady`
  // and the await resolving, the global `driverReady` will be replaced by a
  // new promise. The OLD promise will resolve to false (destroyed driver),
  // and we would return a stale `driver` ref. Loop a few times so that any
  // in-flight reconnect can finish and we end up waiting on the LATEST
  // driverReady before returning.
  for (let attempt = 0; attempt < 3; attempt++) {
    const captured = driverReady;
    if (captured) {
      try {
        await captured;
      } catch {
        // Old driver's ready() rejected — reconnect path will install a new
        // driverReady; loop will pick it up.
      }
    }
    if (driverReady === captured) break;
  }
  return driver;
}

// Reconnect YDB driver on authentication or transport error
export async function reconnectYdb(): Promise<boolean> {
  const now = Date.now();
  // Prevent rapid reconnection attempts (minimum 5 seconds between attempts)
  if (reconnecting || (now - lastAuthError) < 5000) {
    console.log("[YDB] Skipping reconnect - already in progress or too soon");
    return false;
  }

  reconnecting = true;
  lastAuthError = now;

  try {
    console.log("[YDB] Reconnecting (auth/transport failure detected)...");

    // Invalidate driverReady BEFORE destroying so concurrent waitForDriver()
    // callers don't resolve against the dead driver.
    driverReady = null;

    // Destroy old driver
    if (driver) {
      try {
        await driver.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      driver = null;
    }

    // Reinitialize (initYdb will set driver and driverReady again)
    await initYdb();

    console.log("[YDB] Reconnection complete, driver ready:", !!driver);
    return !!driver;
  } finally {
    reconnecting = false;
  }
}

// Check whether an error indicates the YDB driver should be reconnected.
// Covers BOTH authentication failures (UNAUTHENTICATED) AND transport-level
// failures (TCP timeout, gRPC UNAVAILABLE, DNS failure) — the latter were the
// root cause of the 25.04.2026 incident: a TransportUnavailable was treated as
// a non-recoverable error, so the driver kept retrying against a dead grpc
// channel for ~150 seconds while user requests stalled.
export function shouldReconnectYdb(error: any): boolean {
  if (!error) return false;
  const msg = String(error?.message || error?.details || error || "");
  const code = String(error?.code || "");

  // Authentication errors (gRPC code 16)
  if (msg.includes("UNAUTHENTICATED") || msg.includes("Unauthenticated")) return true;
  if (msg.includes("code 16") || code === "16") return true;

  // Transport-level failures — driver's grpc channel is dead, must recreate
  if (msg.includes("TransportUnavailable")) return true;
  if (msg.includes("UNAVAILABLE")) return true;
  if (msg.includes("DEADLINE_EXCEEDED")) return true;
  if (msg.includes("ETIMEDOUT")) return true;
  if (msg.includes("ECONNREFUSED")) return true;
  if (msg.includes("ECONNRESET")) return true;
  if (msg.includes("ENETUNREACH")) return true;
  if (msg.includes("EAI_AGAIN")) return true; // DNS temporary failure
  if (msg.includes("No connection established")) return true;
  if (msg.includes("code 401010") || code === "401010") return true; // YDB transport
  if (/\bcode 14\b/.test(msg) || code === "14") return true; // gRPC UNAVAILABLE
  if (/\bcode 4\b/.test(msg) || code === "4") return true;   // gRPC DEADLINE_EXCEEDED

  return false;
}

// Backward-compatible alias. Historically `isAuthError` only covered auth;
// it now covers transport too. Kept as an alias so existing callers and any
// external imports keep working.
export const isAuthError = shouldReconnectYdb;

function extractJsonObject(text: string, start: number): string | null {
  const open = text.indexOf('{', start);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char.charCodeAt(0) === 92) escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }

  return null;
}

function rawYdbAssignmentsFromFiles(): string[] {
  const values: string[] = [];

  for (const filename of ['.env.local', '.env']) {
    try {
      const content = fs.readFileSync(path.resolve(filename), 'utf8');
      const assignment = /(?:^|\r?\n)\s*YDB_SA_KEY\s*=\s*/m.exec(content);
      if (!assignment) continue;

      const valueStart = assignment.index + assignment[0].length;
      const jsonValue = extractJsonObject(content, valueStart);
      if (jsonValue) {
        values.push(jsonValue);
      } else {
        // Keep a single-line fallback for a non-JSON value without logging it.
        const lineValue = content.slice(valueStart).split(/\r?\n/, 1)[0].trim();
        if (lineValue) values.push(lineValue);
      }
    } catch {
      // Preview may receive the secret directly through its environment.
    }
  }

  return values;
}

function normalizeYdbServiceAccountKeyWithFileFallback(raw: string): string {
  try {
    return normalizeYdbServiceAccountKey(raw);
  } catch {
    const fileCandidates = rawYdbAssignmentsFromFiles();
    for (const candidate of fileCandidates) {
      for (const variant of [candidate, candidate.replace(/\\"/g, '"')]) {
        try {
          return normalizeYdbServiceAccountKey(variant);
        } catch {
          // Try the next representation without logging the secret.
        }
      }
    }

    throw new Error('YDB_SA_KEY is present but is not valid service-account JSON with private_key');
  }
}

function escapeNewlinesInsideJsonStrings(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        result += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        result += char;
        inString = false;
        continue;
      }
      if (char === '\r') {
        if (value[index + 1] === '\n') index++;
        result += '\\n';
        continue;
      }
      if (char === '\n') {
        result += '\\n';
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }

    result += char;
  }

  return result;
}

function normalizeYdbServiceAccountKey(raw: string): string {
  let value = raw.trim().replace(/^\uFEFF/, '');

  // Разрешаем вставку вида `YDB_SA_KEY=...` из .env-файла.
  value = value.replace(/^YDB_SA_KEY\s*=\s*/i, '').trim();

  // Убираем Markdown-обёртку, если JSON скопировали из блока ```json.
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Пробуем несколько безопасных представлений: чистый JSON, JSON в кавычках
  // и вариант с экранированными кавычками из API Keys/.env.
  const candidates = new Set<string>();
  const addCandidate = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    candidates.add(trimmed);
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      candidates.add(trimmed.slice(1, -1).trim());
    }
  };

  addCandidate(value);
  addCandidate(value.replace(/\\"/g, '"'));
  addCandidate(value.replace(/\\\\/g, '\\').replace(/\\"/g, '"'));

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(escapeNewlinesInsideJsonStrings(candidate));
      // Поддерживаем значение, сохранённое как JSON-строка внутри JSON.
      if (typeof parsed === 'string') {
        parsed = JSON.parse(escapeNewlinesInsideJsonStrings(parsed));
      }

      if (!parsed || typeof parsed !== 'object') continue;
      const account = parsed as { private_key?: unknown };
      if (typeof account.private_key !== 'string') continue;

      // SDK нужен обычный перенос строки внутри PEM-ключа. Вход может
      // содержать как \\n, так и двойное экранирование \\\\n.
      account.private_key = account.private_key
        .split('\\\\n').join('\n')
        .split('\\n').join('\n');
      return JSON.stringify(account);
    } catch {
      // Переходим к следующему представлению без вывода секрета в лог.
    }
  }

  throw new Error('YDB_SA_KEY must be valid service-account JSON with private_key');
}

export async function initYdb() {
  const rawSaKey = process.env.YDB_SA_KEY?.trim();
  const isCloud = process.env.NODE_ENV === "production" || !!rawSaKey;
  
  if (isCloud) {
    console.log(`[YDB] Initializing Driver for: ${endpoint}`);
    console.log(`[YDB] Database: ${database}`);
    console.log(`[YDB] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[YDB] YDB_SA_KEY present: ${!!rawSaKey}`);
    
    try {
      let authService: ydb.IAuthService;
      
      // Если есть YDB_SA_KEY - используем его (для Replit и локальной разработки)
      // Иначе используем MetadataAuthService (для Yandex Serverless Containers)
      if (rawSaKey) {
        const tmpFile = path.join(os.tmpdir(), 'ydb-sa-key.json');
        const saKeyJson = normalizeYdbServiceAccountKeyWithFileFallback(rawSaKey);
        fs.writeFileSync(tmpFile, saKeyJson);
        const saCredentials = getSACredentialsFromJson(tmpFile);
        authService = new ydb.IamAuthService(saCredentials);
        console.log("[YDB] Created IamAuthService from SA key");
      } else {
        authService = new ydb.MetadataAuthService();
        console.log("[YDB] Created MetadataAuthService (Yandex Cloud)");
      }
      
      const clientOptions = {
        "grpc.max_receive_message_length": 64 * 1024 * 1024, // 64MB
        "grpc.max_send_message_length": 64 * 1024 * 1024,
      };

      driver = new ydb.Driver({
        endpoint,
        database,
        authService,
        clientOptions,
      });
      
      console.log("[YDB] Driver created, waiting for ready...");
      
      // Ждём готовности драйвера (таймаут 10 секунд)
      const timeout = 10000;
      driverReady = driver.ready(timeout);
      const ready = await driverReady;
      
      if (ready) {
        console.log("[YDB] Driver is ready!");
        await initUsersTable();
      } else {
        logError(`[YDB] Driver not ready after ${timeout}ms`);
        driver = null;
      }
    } catch (error) {
      logError("[YDB] Failed to initialize driver:", error);
    }
  } else {
    console.log("[YDB] Running in Local Dev mode. Database connections disabled to prevent crashes.");
  }
}

async function initUsersTable() {
  if (!driver) return;
  // Запускаем только один раз за жизнь процесса (защита от reconnectYdb).
  if (tablesInitialized) return;
  tablesInitialized = true;

  try {
    await driver.tableClient.withSession(async (session) => {
      // ─── artist_tracks: создана вручную в YDB Console ───────────────────
      try {
        await session.describeTable("artist_tracks");
        console.log("[YDB] artist_tracks table OK");
      } catch {
        logWarn("[YDB] artist_tracks table not found — run CREATE TABLE from docs");
      }

      // ─── orders.partner_id: должен оставаться Utf8 ──────────────────────
      // Весь код в storage.ts (serializeOrderPartnerId / deserializeOrderPartnerId)
      // рассчитан на legacy-тип Utf8. Если тип сменится — INSERT/SELECT сломаются.
      try {
        const desc = await session.describeTable("orders");
        const partnerIdCol = desc.columns?.find((c: any) => c.name === "partner_id");
        if (partnerIdCol) {
          const typeStr = JSON.stringify(partnerIdCol.type ?? {});
          const looksLikeUtf8 = typeStr.includes('"UTF8"') || typeStr.includes('"Utf8"') || typeStr.toLowerCase().includes("utf8");
          if (!looksLikeUtf8) {
            logError(
              "[YDB] ⚠ ВНИМАНИЕ: orders.partner_id больше НЕ Utf8! " +
              "Ожидался legacy-тип Utf8?, но обнаружен другой. " +
              "СРОЧНО проверить serializeOrderPartnerId/deserializeOrderPartnerId в server/storage.ts. " +
              "Тип из YDB: " + typeStr.substring(0, 200)
            );
          } else {
            console.log("[YDB] orders.partner_id schema check OK (Utf8, как и ожидалось)");
          }
        }
      } catch (err: any) {
        logWarn("[YDB] orders.partner_id self-check skipped:", err.message?.substring(0, 120));
      }
    });
  } catch (err) {
    logError("[YDB] Failed to run schema checks:", err);
  }
}

export { schema };
