/**
 * scripts/backup-ydb.ts
 *
 * Бэкап YDB для переезда/страховки: данные + структура таблиц.
 * Скрипт ТОЛЬКО читает базу (SELECT / describeTable) — ничего не меняет.
 *
 * Режимы:
 *   --data            выгрузить строки в data/<table>.ndjson (по одному JSON на строку)
 *   --schema          выгрузить структуру: колонки, типы, PRIMARY KEY, best-effort DDL
 *                     (schema/<table>.json + schema/<table>.ddl.sql)
 *   --tables=a,b,c    ограничить список таблиц (по умолчанию — все из DEFAULT_TABLES)
 *   --out=DIR         каталог бэкапа (по умолчанию ydb-backup/<UTC-время>)
 *   --help            эта справка
 *
 * Если не указан ни --data, ни --schema — выполняются оба режима.
 * Данные читаются потоковым scan-запросом, поэтому ограничения на размер таблицы нет.
 *
 * Требуются переменные окружения (те же, что у сервера):
 *   YDB_ENDPOINT, YDB_DATABASE, YDB_SA_KEY
 *
 * Запуск:
 *   npx tsx scripts/backup-ydb.ts
 *   npx tsx scripts/backup-ydb.ts --schema --tables=page_settings
 *   npx tsx scripts/backup-ydb.ts --data --tables=products,orders --out=./ydb-backup-prod
 *
 * ⚠️  data-файлы содержат персональные данные (заказы, покупатели, партнёры) —
 *     не коммитить и не пересылать в открытом виде. Каталог ydb-backup/ в .gitignore.
 *
 * ⚠️  Для больших объёмов быстрее штатный экспорт YDB CLI: `ydb export s3` (в Object Storage)
 *     или `ydb tools dump` (только схема); `ydb admin database dump` есть не во всех
 *     конфигурациях. Этот скрипт — резервный путь через ydb-sdk и удобный источник JSON.
 *
 * Особенности выгрузки значений:
 *   • Timestamp/Datetime → ISO-строка, Int64/Uint64 за пределами безопасного диапазона → строка;
 *   • String-колонки с невалидным UTF-8 → base64 (в боевой схеме таких нет, все Utf8);
 *   • колонки типа Date → число дней от 1 января 1970 (тип виден в schema/<table>.json).
 */

import ydb, { getSACredentialsFromJson, Ydb } from "ydb-sdk";
import type { Driver, IAuthService } from "ydb-sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";

// ── Таблицы, которые использует приложение ──────────────────────────────────
// Собрано по обращениям в server/storage/* и server/routes*.ts.
// Если в боевой базе есть таблицы сверх этого списка — добавь их через --tables=.
export const DEFAULT_TABLES = [
  "ai_questions",
  "artist_tracks",
  "bonus_settings",
  "cart_items",
  "cart_reminders",
  "chat_messages",
  "consent_signatures",
  "gift_cards",
  "legal_documents",
  "loyalty_tiers",
  "newsletter_subscriptions",
  "order_counters",
  "orders",
  "page_settings",
  "partner_commissions",
  "partner_payouts",
  "partner_pending_submissions",
  "partner_products",
  "partners",
  "preorder_subscribers",
  "price_drop_subscriptions",
  "products",
  "promo_codes",
  "radio_listeners",
  "reviews",
  "stock_notifications",
  "user_favorites",
  "users",
  "wholesale_feed_products",
  "wholesale_feed_tokens",
];

export interface Options {
  data: boolean;
  schema: boolean;
  tables: string[];
  out: string | null;
  help: boolean;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Бэкап YDB (только чтение): данные + структура таблиц.

Использование:
  npx tsx scripts/backup-ydb.ts [--data] [--schema] [--tables=...] [--out=DIR]

Режимы:
  --data            строки таблиц → data/<table>.ndjson
  --schema          колонки, типы, PRIMARY KEY, DDL → schema/<table>.json + .ddl.sql
  --tables=a,b,c    только эти таблицы (по умолчанию — ${DEFAULT_TABLES.length} таблиц приложения)
  --out=DIR         каталог бэкапа (по умолчанию ydb-backup/<UTC-время>)
  --help            эта справка

Без --data и --schema выполняются оба режима.

Env: YDB_ENDPOINT, YDB_DATABASE, YDB_SA_KEY (как у сервера).
Итог: _manifest.json со списком таблиц, числом строк и ошибками.

⚠️  data-файлы содержат ПДн — не коммитить.
`);
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { data: false, schema: false, tables: [], out: null, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (): string => {
      const eq = arg.indexOf("=");
      if (eq >= 0) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) throw new Error(`Аргумент ${arg} требует значения`);
      return next;
    };

    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--data") {
      opts.data = true;
    } else if (arg === "--schema") {
      opts.schema = true;
    } else if (arg === "--tables" || arg.startsWith("--tables=")) {
      const value = takeValue();
      opts.tables = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
      if (!opts.tables.length) throw new Error("--tables= пуст: перечисли таблицы через запятую");
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      opts.out = takeValue();
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  if (!opts.data && !opts.schema) {
    opts.data = true;
    opts.schema = true;
  }
  return opts;
}

// ── Подключение к YDB ───────────────────────────────────────────────────────

/** Разбирает YDB_SA_KEY в объект: поддерживает JSON, JSON-строку и экранирование из .env. */
function parseSaKeyJson(raw: string): Record<string, unknown> {
  let value = raw.trim().replace(/^\uFEFF/, "");
  value = value.replace(/^YDB_SA_KEY\s*=\s*/i, "").trim();
  value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const candidates = new Set<string>([value]);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    candidates.add(value.slice(1, -1).trim());
  }
  candidates.add(value.replace(/\\"/g, '"'));
  candidates.add(value.replace(/\\\\/g, "\\").replace(/\\"/g, '"'));

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).private_key) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // пробуем следующий вариант, секрет не логируем
    }
  }
  throw new Error("YDB_SA_KEY задан, но не похож на JSON сервисного аккаунта (нужен private_key)");
}

async function createDriver(): Promise<Driver> {
  const endpoint = process.env.YDB_ENDPOINT;
  const database = process.env.YDB_DATABASE;
  const saKeyRaw = process.env.YDB_SA_KEY;

  if (!endpoint || !database) {
    throw new Error("Не заданы YDB_ENDPOINT и/или YDB_DATABASE (см. .env)");
  }

  let authService: IAuthService;
  if (saKeyRaw && saKeyRaw.trim()) {
    const tmpFile = path.join(os.tmpdir(), `ydb-backup-sa-${process.pid}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(parseSaKeyJson(saKeyRaw)), { mode: 0o600 });
    try {
      authService = new ydb.IamAuthService(getSACredentialsFromJson(tmpFile));
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // временный файл удалится системой
      }
    }
  } else {
    // В облачном контейнере Яндекса работает MetadataAuthService;
    // локально нужен YDB_SA_KEY.
    authService = new ydb.MetadataAuthService();
  }

  const driver = new ydb.Driver({
    endpoint,
    database,
    authService,
    clientOptions: {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
      "grpc.max_send_message_length": 64 * 1024 * 1024,
    },
  });

  const ready = await driver.ready(15000);
  if (!ready) {
    try {
      await driver.destroy();
    } catch {
      // ignore
    }
    throw new Error("YDB driver не готов (timeout 15 c). Проверь YDB_ENDPOINT / YDB_DATABASE / YDB_SA_KEY");
  }
  return driver;
}

// ── Повторы транзиентных ошибок ─────────────────────────────────────────────

/** Ошибки «таблицы нет / метаданные не загрузились» повторять бессмысленно. */
const PERMANENT_ERROR_MARKERS = [
  "Failed to load metadata",
  "metadata loading",
  "does not exist",
  "Cannot find table",
  "SCHEME_ERROR",
];

const RETRYABLE_ERROR_MARKERS = [
  "Session not found",
  "RESOURCE_EXHAUSTED",
  "Transaction locks invalidated",
  "Aborted",
  "Unavailable",
  "Deadline exceeded",
];

async function withRetry<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (err: any) {
      const message: string = err?.message ?? String(err);
      const permanent = PERMANENT_ERROR_MARKERS.some((f) => message.includes(f));
      const retryable =
        !permanent &&
        (err?.constructor?.name === "BadSession" || RETRYABLE_ERROR_MARKERS.some((f) => message.includes(f)));
      if (retryable && attempt < attempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// ── Чтение значений YDB → обычный JSON ──────────────────────────────────────

function longToJson(value: unknown): number | string {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : String(value);
}

export function extractTypedValue(item: any): any {
  if (item === null || item === undefined) return null;

  // Конкретные типы — до optional-обёртки (как в server/storage/core.ts).
  if (item.textValue !== undefined && item.textValue !== null) return item.textValue;
  if (item.doubleValue !== undefined && item.doubleValue !== null) return item.doubleValue;
  if (item.floatValue !== undefined && item.floatValue !== null) return item.floatValue;
  if (item.uint64Value !== undefined && item.uint64Value !== null) {
    const n = Number(item.uint64Value);
    // YDB Timestamp — микросекунды от эпохи (после 2000 года).
    if (n > 946684800000000) return new Date(n / 1000).toISOString();
    return Number.isSafeInteger(n) ? n : String(item.uint64Value);
  }
  if (item.int64Value !== undefined && item.int64Value !== null) {
    return longToJson(item.int64Value);
  }
  if (item.uint32Value !== undefined && item.uint32Value !== null) {
    const n = Number(item.uint32Value);
    // YDB Datetime — секунды от эпохи (Date — дни, остаётся числом: тип есть в schema/*.json).
    if (n > 946684800) return new Date(n * 1000).toISOString();
    return n;
  }
  if (item.int32Value !== undefined && item.int32Value !== null) return item.int32Value;
  if (item.boolValue !== undefined && item.boolValue !== null) return item.boolValue;
  if (item.bytesValue !== undefined && item.bytesValue !== null) {
    // String/Utf8: если байты — корректный UTF-8, отдаём текст (так удобнее
    // читать и восстанавливать), иначе — base64 без потерь.
    const bytes = Buffer.from(item.bytesValue);
    const text = bytes.toString("utf8");
    return Buffer.from(text, "utf8").equals(bytes) ? text : bytes.toString("base64");
  }

  // Optional-обёртка.
  if (item.optionalValue !== undefined && item.optionalValue !== null) {
    return extractTypedValue(item.optionalValue);
  }

  // Списки (Value.items) и структуры (Value.pairs) — для Json/Struct-подобных колонок.
  if (Array.isArray(item.items) && item.items.length) return item.items.map(extractTypedValue);
  if (Array.isArray(item.pairs) && item.pairs.length) {
    const obj: Record<string, any> = {};
    for (const pair of item.pairs) obj[pair.name] = extractTypedValue(pair.value);
    return obj;
  }
  if (item.nestedValue !== undefined && item.nestedValue !== null) {
    return extractTypedValue(item.nestedValue);
  }

  if (item.nullFlagValue !== undefined) return null;
  if (item.value !== undefined) return item.value;
  return null;
}

export function rowToObject(row: any, columns: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  const items: any[] = row?.items ?? [];
  for (let i = 0; i < items.length && i < columns.length; i++) {
    result[columns[i]] = extractTypedValue(items[i]);
  }
  return result;
}

// ── Типы YDB → YQL (best-effort DDL) ────────────────────────────────────────
//
// Рантайм ydb-sdk отдаёт дескриптор типа как `{ typeId: <числовой enum> }`
// (Optional — `{ optionalType: { item: … } }`, List — `{ listType: { item: … } }`),
// а имена примитивов берём из обратной карты PrimitiveTypeId.

/** В рантайме ydb-sdk отдаёт числовой enum — по нему достаём имя примитива. */
const PRIMITIVE_TYPE_NAMES: Record<number, string> | undefined = (Ydb as any)?.Type?.PrimitiveTypeId;

const PRIMITIVE_TO_YQL: Record<string, string> = {
  BOOL: "Bool",
  INT8: "Int8",
  UINT8: "Uint8",
  INT16: "Int16",
  UINT16: "Uint16",
  INT32: "Int32",
  UINT32: "Uint32",
  INT64: "Int64",
  UINT64: "Uint64",
  FLOAT: "Float",
  DOUBLE: "Double",
  STRING: "String",
  UTF8: "Utf8",
  YSON: "Yson",
  JSON: "Json",
  JSON_DOCUMENT: "JsonDocument",
  UUID: "Uuid",
  DATE: "Date",
  DATETIME: "Datetime",
  TIMESTAMP: "Timestamp",
  INTERVAL: "Interval",
  TZ_DATE: "TzDate",
  TZ_DATETIME: "TzDatetime",
  TZ_TIMESTAMP: "TzTimestamp",
  DYSNUMBER: "DyNumber",
  DECIMAL: "Decimal",
};

export function typeToYql(type: any): string {
  if (!type) return "String";
  if (typeof type.typeId === "number") {
    const name = PRIMITIVE_TYPE_NAMES?.[type.typeId];
    return (name && PRIMITIVE_TO_YQL[name]) || "String";
  }
  if (typeof type.typeId === "string" && type.typeId) {
    return PRIMITIVE_TO_YQL[type.typeId] ?? "String";
  }
  if (type.optionalType?.item) return `${typeToYql(type.optionalType.item)}?`;
  if (type.listType?.item) return `List<${typeToYql(type.listType.item)}>`;
  if (type.dictType?.key && type.dictType?.payload) {
    return `Dict<${typeToYql(type.dictType.key)},${typeToYql(type.dictType.payload)}>`;
  }
  if (type.tupleType?.elements) {
    return `Tuple<${type.tupleType.elements.map(typeToYql).join(",")}>`;
  }
  if (type.structType?.members) {
    return `Struct<${type.structType.members.map((m: any) => `${m.name}:${typeToYql(m.type)}`).join(",")}>`;
  }
  if (type.taggedType?.type) return typeToYql(type.taggedType.type);
  if (type.nullType !== undefined && type.nullType !== null) return "Null";
  if (type.voidType !== undefined && type.voidType !== null) return "Void";
  return "String";
}

function toPlainJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export interface TableColumn {
  name: string;
  typeYql: string;
  rawType: unknown;
}

export interface TableSchema {
  source: "describeTable" | "query-columns";
  columns: TableColumn[];
  primaryKey: string[];
  note?: string;
}

/**
 * Структура таблицы: сначала штатный describeTable, а если он недоступен
 * (бывает на свежих/серверлесс-базах) — колонки и типы из пустого SELECT.
 * В этом случае PRIMARY KEY неизвестен, и в DDL он не попадёт.
 */
async function fetchSchema(driver: Driver, table: string): Promise<TableSchema> {
  try {
    const desc: any = await withRetry(() =>
      driver.tableClient.withSession((session: any) => session.describeTable(table)),
    );
    return {
      source: "describeTable",
      columns: (desc?.columns ?? []).map((c: any) => ({
        name: String(c.name),
        typeYql: typeToYql(c.type),
        rawType: toPlainJson(c.type),
      })),
      primaryKey: (desc?.primaryKey ?? []).map(String),
    };
  } catch (describeErr: any) {
    const resultSet: any = await withRetry(() =>
      driver.tableClient.withSession(async (session: any) => {
        const res = await session.executeQuery(`SELECT * FROM \`${table}\` LIMIT 1`);
        return res?.resultSets?.[0] ?? null;
      }),
    );
    if (!resultSet || !resultSet.columns?.length) throw describeErr;
    return {
      source: "query-columns",
      columns: (resultSet.columns ?? []).map((c: any) => ({
        name: String(c.name),
        typeYql: typeToYql(c.type),
        rawType: toPlainJson(c.type),
      })),
      primaryKey: [],
      note: `describeTable недоступен (${shorten(String(describeErr?.message ?? describeErr), 160)}); схема построена по результату SELECT, PRIMARY KEY неизвестен`,
    };
  }
}

export function buildDdl(schema: TableSchema, table: string): string {
  const lines = schema.columns.map((c) => `  \`${c.name}\` ${c.typeYql}`);
  const pk = schema.primaryKey.length
    ? `,\n  PRIMARY KEY (${schema.primaryKey.map((k) => `\`${k}\``).join(", ")})`
    : "";
  const warning = schema.primaryKey.length
    ? ""
    : "-- ⚠️  PRIMARY KEY неизвестен (describeTable недоступен) — дописать перед применением.\n";
  return (
    `-- Сгенерировано scripts/backup-ydb.ts (best-effort — проверить перед применением)\n` +
    warning +
    `CREATE TABLE \`${table}\` (\n${lines.join(",\n")}${pk}\n);\n`
  );
}

// ── Основной поток ──────────────────────────────────────────────────────────

function shorten(message: string, limit = 300): string {
  return message.length > limit ? `${message.slice(0, limit)}…` : message;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err: any) {
    console.error(`✖ ${err?.message || err}`);
    printUsage();
    return 2;
  }

  if (options.help) {
    printUsage();
    return 0;
  }

  const tables = options.tables.length ? options.tables : DEFAULT_TABLES;
  const outRoot =
    options.out ?? path.join("ydb-backup", new Date().toISOString().replace(/[:.]/g, "-"));
  const schemaDir = path.join(outRoot, "schema");
  const dataDir = path.join(outRoot, "data");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const modes = [options.data && "data", options.schema && "schema"].filter(Boolean).join(" + ");
  console.log(`Бэкап YDB → ${outRoot}`);
  console.log(`Режимы: ${modes}; таблиц: ${tables.length}`);

  let driver: Driver;
  try {
    driver = await createDriver();
  } catch (err: any) {
    console.error(`✖ Не удалось подключиться к YDB: ${err?.message || err}`);
    return 1;
  }
  console.log("✓ Подключение к YDB установлено");

  const manifest: {
    createdAt: string;
    finishedAt?: string;
    outDir: string;
    modes: { data: boolean; schema: boolean };
    tables: Record<string, any>;
    failed: string[];
  } = {
    createdAt: new Date().toISOString(),
    outDir: outRoot,
    modes: { data: options.data, schema: options.schema },
    tables: {},
    failed: [],
  };

  try {
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const entry: Record<string, any> = {};
      manifest.tables[table] = entry;

      if (options.schema) {
        try {
          const schema = await fetchSchema(driver, table);
          entry.schemaSource = schema.source;
          if (schema.note) entry.schemaNote = schema.note;
          const ddl = buildDdl(schema, table);
          fs.writeFileSync(
            path.join(schemaDir, `${table}.json`),
            JSON.stringify(
              {
                table,
                source: schema.source,
                note: schema.note,
                primaryKey: schema.primaryKey,
                columns: schema.columns,
                ddl,
                generatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
          fs.writeFileSync(path.join(schemaDir, `${table}.ddl.sql`), ddl);
          entry.schema = true;
          entry.columns = schema.columns.length;
        } catch (err: any) {
          entry.schemaError = shorten(err?.message || String(err));
          manifest.failed.push(table);
        }
      }

      if (options.data) {
        const file = path.join(dataDir, `${table}.ndjson`);
        try {
          let rowsTotal = 0;
          // Перечитывание с нуля при повторе: файл перезаписывается целиком.
          await withRetry(async () => {
            fs.writeFileSync(file, "");
            rowsTotal = 0;
            let columns: string[] = [];
            await driver.tableClient.withSession((session: any) =>
              session.streamExecuteScanQuery(`SELECT * FROM \`${table}\``, (partial: any) => {
                const resultSet = partial?.resultSet;
                if (!resultSet) return;
                if (!columns.length) {
                  columns = (resultSet.columns ?? []).map((c: any) => String(c.name));
                }
                const rows: any[] = resultSet.rows ?? [];
                if (!rows.length) return;
                fs.appendFileSync(
                  file,
                  rows.map((row: any) => JSON.stringify(rowToObject(row, columns))).join("\n") + "\n",
                );
                rowsTotal += rows.length;
              }),
            );
          });
          entry.rows = rowsTotal;
          entry.dataFile = path.relative(outRoot, file);
        } catch (err: any) {
          entry.dataError = shorten(err?.message || String(err));
          if (!manifest.failed.includes(table)) manifest.failed.push(table);
        }
      }

      const parts: string[] = [];
      if (entry.schema) parts.push(`schema: ${entry.columns} колонок (${entry.schemaSource})`);
      if (entry.rows !== undefined) parts.push(`data: ${entry.rows} строк`);
      if (entry.schemaError) parts.push(`schema error: ${entry.schemaError}`);
      if (entry.dataError) parts.push(`data error: ${entry.dataError}`);
      const ok = !entry.schemaError && !entry.dataError;
      console.log(`${ok ? "✓" : "✖"} [${i + 1}/${tables.length}] ${table}: ${parts.join(", ")}`);
    }
  } finally {
    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outRoot, "_manifest.json"), JSON.stringify(manifest, null, 2));
    try {
      await driver.destroy();
    } catch {
      // ignore
    }
  }

  if (manifest.failed.length) {
    console.error(`\n✖ Бэкап завершён с ошибками (${manifest.failed.length}): ${manifest.failed.join(", ")}`);
    console.error(`  Детали: ${path.join(outRoot, "_manifest.json")}`);
    return 1;
  }

  console.log(`\n✓ Бэкап завершён: ${outRoot}`);
  console.log(`  Манифест: ${path.join(outRoot, "_manifest.json")}`);
  return 0;
}

// main() выполняется только при прямом запуске: модуль импортируется тестами.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error("✖ Непредвиденная ошибка:", err?.message || err);
      process.exitCode = 1;
    });
}
