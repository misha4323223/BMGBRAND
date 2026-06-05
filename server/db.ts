import ydb, { getSACredentialsFromJson } from "ydb-sdk";
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

export async function initYdb() {
  const isCloud = process.env.NODE_ENV === "production" || !!process.env.YDB_SA_KEY;
  
  if (isCloud) {
    console.log(`[YDB] Initializing Driver for: ${endpoint}`);
    console.log(`[YDB] Database: ${database}`);
    console.log(`[YDB] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[YDB] YDB_SA_KEY present: ${!!process.env.YDB_SA_KEY}`);
    
    try {
      let authService: ydb.IAuthService;
      
      // Если есть YDB_SA_KEY - используем его (для Replit и локальной разработки)
      // Иначе используем MetadataAuthService (для Yandex Serverless Containers)
      if (process.env.YDB_SA_KEY) {
        // Создаём временный файл с ключом для SDK
        const tmpFile = path.join(os.tmpdir(), 'ydb-sa-key.json');
        fs.writeFileSync(tmpFile, process.env.YDB_SA_KEY);
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
        console.error(`[YDB] Driver not ready after ${timeout}ms`);
        driver = null;
      }
    } catch (error) {
      console.error("[YDB] Failed to initialize driver:", error);
    }
  } else {
    console.log("[YDB] Running in Local Dev mode. Database connections disabled to prevent crashes.");
  }
}

async function initUsersTable() {
  if (!driver) return;
  
  try {
    await driver.tableClient.withSession(async (session) => {
      const tableDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("email", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("password_hash", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("name", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("email_verified", ydb.Types.optional(ydb.Types.BOOL)))
        .withColumn(new ydb.Column("verification_token", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("reset_token", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("reset_token_expiry", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withPrimaryKey("id");
      
      try {
        await session.createTable("users", tableDescription);
        console.log("[YDB] Users table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          console.log("[YDB] Users table already exists");
        } else {
          console.error("[YDB] Error creating users table:", err.message);
        }
      }

      // Create gift_cards table
      const giftCardsDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.INT64)))
        .withColumn(new ydb.Column("code", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("amount", ydb.Types.optional(ydb.Types.INT32)))
        .withColumn(new ydb.Column("balance", ydb.Types.optional(ydb.Types.INT32)))
        .withColumn(new ydb.Column("purchaser_email", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("purchaser_name", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("recipient_email", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("recipient_name", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("message", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("status", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("payment_id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("payment_method", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("redeemed_by_user_id", ydb.Types.optional(ydb.Types.INT64)))
        .withColumn(new ydb.Column("redeemed_at", ydb.Types.optional(ydb.Types.DATETIME)))
        .withColumn(new ydb.Column("expires_at", ydb.Types.optional(ydb.Types.DATETIME)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.DATETIME)))
        .withPrimaryKey("id");
      
      try {
        await session.createTable("gift_cards", giftCardsDescription);
        console.log("[YDB] Gift cards table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          console.log("[YDB] Gift cards table already exists");
        } else {
          console.error("[YDB] Error creating gift_cards table:", err.message);
        }
      }
      
      // Create user_favorites table (v2 - uses single PK column for reliable composite key)
      const userFavoritesDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.UTF8))
        .withColumn(new ydb.Column("user_id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("product_id", ydb.Types.optional(ydb.Types.UTF8)))
        .withPrimaryKey("id");
      
      try {
        await session.createTable("user_favorites", userFavoritesDescription);
        console.log("[YDB] user_favorites table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          console.log("[YDB] user_favorites table already exists");
        } else {
          console.error("[YDB] Error creating user_favorites table:", err.message);
        }
      }
      
      // Create reviews table
      const reviewsDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("product_id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("user_id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("author_name", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("rating", ydb.Types.optional(ydb.Types.INT32)))
        .withColumn(new ydb.Column("comment", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("is_approved", ydb.Types.optional(ydb.Types.BOOL)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.DATETIME)))
        .withPrimaryKey("id");

      try {
        await session.createTable("reviews", reviewsDescription);
        console.log("[YDB] Reviews table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          console.log("[YDB] Reviews table already exists");
        } else {
          console.error("[YDB] Error creating reviews table:", err.message);
        }
      }

      // Add photos column to reviews table if not exists
      try {
        await session.executeQuery(`ALTER TABLE reviews ADD COLUMN photos Utf8;`);
        console.log("[YDB] Added photos column to reviews table");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('Member not found') || err.message?.includes('column already exists')) {
          // already exists — fine
        } else {
          console.log("[YDB] reviews.photos column migration:", err.message?.substring(0, 120));
        }
      }

      // Migrate data from old favorites table to user_favorites (one-time)
      try {
        const oldData = await session.executeQuery("SELECT user_id, product_id FROM favorites");
        const oldRows = oldData.resultSets?.[0]?.rows || [];
        if (oldRows.length > 0) {
          console.log(`[YDB] Migrating ${oldRows.length} favorites from old table...`);
          for (const row of oldRows) {
            const userId = row.items?.[0]?.textValue || (row.items?.[0] as any)?.optionalValue?.textValue;
            const productId = row.items?.[1]?.textValue || (row.items?.[1] as any)?.optionalValue?.textValue;
            if (userId && productId) {
              const id = `${userId}_${productId}`;
              const { TypedValues, Types } = ydb;
              await session.executeQuery(
                `DECLARE $id AS Utf8; DECLARE $user_id AS Utf8; DECLARE $product_id AS Utf8;
                 UPSERT INTO user_favorites (id, user_id, product_id) VALUES ($id, $user_id, $product_id);`,
                {
                  $id: TypedValues.fromNative(Types.UTF8, id),
                  $user_id: TypedValues.fromNative(Types.UTF8, userId),
                  $product_id: TypedValues.fromNative(Types.UTF8, productId),
                }
              );
            }
          }
          console.log(`[YDB] Migrated ${oldRows.length} favorites successfully`);
        }
      } catch (err: any) {
        // Old table might not exist or be empty, that's fine
        if (!err.message?.includes('not found') && !err.message?.includes('does not exist')) {
          console.log("[YDB] Favorites migration skipped:", err.message?.slice(0, 100));
        }
      }

      // Add payment_id column to orders table if not exists
      try {
        await session.executeQuery(`ALTER TABLE orders ADD COLUMN payment_id Utf8;`);
        console.log("[YDB] Added payment_id column to orders table");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('Member not found')) {
        } else {
          console.log("[YDB] payment_id column migration:", err.message?.substring(0, 100));
        }
      }
      
      // Add cdek_data column to orders table if not exists
      try {
        await session.executeQuery(`ALTER TABLE orders ADD COLUMN cdek_data Utf8;`);
        console.log("[YDB] Added cdek_data column to orders table");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('Member not found')) {
        } else {
          console.log("[YDB] cdek_data column migration:", err.message?.substring(0, 100));
        }
      }

      // Create partner_payouts table (manual payout history for partner program)
      const partnerPayoutsDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("partner_id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("amount", ydb.Types.optional(ydb.Types.INT64)))
        .withColumn(new ydb.Column("commission_count", ydb.Types.optional(ydb.Types.INT32)))
        .withColumn(new ydb.Column("commission_ids", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("method", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("recipient_name", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("recipient_details", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("note", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("created_by", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withPrimaryKey("id");
      try {
        await session.createTable("partner_payouts", partnerPayoutsDescription);
        console.log("[YDB] partner_payouts table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          // already exists — fine
        } else {
          console.error("[YDB] Error creating partner_payouts table:", err.message);
        }
      }
      // NOTE: расширение partner_payouts (status, invoice_*, paid_*, receipt_*,
      // completed_at, rejected_reason) выполняется вручную в YDB Console.
      // SQL см. в replit.md (раздел «Партнёрская программа → Выплаты НПД»).

      // ─────────────────────────────────────────────────────────────────────
      // Self-check: orders.partner_id всё ещё Utf8?
      // На проде эта колонка — legacy Utf8, и весь код в storage.ts
      // (serializeOrderPartnerId / deserializeOrderPartnerId) рассчитан именно
      // на это. Если когда-нибудь тип колонки поменяется (например, кто-то
      // пересоздаст таблицу), нужно будет одновременно поменять и helper'ы —
      // иначе INSERT/SELECT по партнёрским заказам начнут падать.
      // Эта проверка просто громко крикнет в логи, ничего не ломая.
      // ─────────────────────────────────────────────────────────────────────
      // Партнёры: 11 новых колонок KYC/реквизитов и хэшей документов
      // (юр.лицо/ИП + хэши подписанных документов для 63-ФЗ ПЭП).
      // Идемпотентно: если колонка уже есть — игнорируем.
      // ─────────────────────────────────────────────────────────────────────
      const partnerColumnsToAdd = [
        "company_name", "kpp", "ogrn", "legal_address", "signer_position", "signer_basis",
        "offer_hash", "privacy_hash", "adult_hash", "self_employed_hash", "marketing_hash",
        // Anti-spoof IP-фиксация (30.04.2026): настоящий IP TCP-сокета — нельзя подделать.
        // Должен быть в диапазонах Yandex Cloud Gateway. Если нет — запись подозрительная.
        "consent_remote_ip",
        // GeoIP (30.04.2026): страна/регион/город на момент подписания для фиксации юрисдикции.
        "consent_country", "consent_region", "consent_city",
      ];
      for (const col of partnerColumnsToAdd) {
        try {
          await session.executeQuery(`ALTER TABLE partners ADD COLUMN ${col} Utf8;`);
          console.log(`[YDB] Added ${col} column to partners table`);
        } catch (err: any) {
          if (err.message?.includes('already exists') || err.message?.includes('Member not found') || err.message?.includes('column already exists')) {
            // already exists — fine
          } else {
            console.log(`[YDB] partners.${col} column migration:`, err.message?.substring(0, 120));
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Версионируемые юридические документы (оферта/политика/18+/самозанятые/маркетинг)
      // ─────────────────────────────────────────────────────────────────────
      const legalDocumentsDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("slug", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("version", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("title", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("body", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("body_hash", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("is_active", ydb.Types.optional(ydb.Types.BOOL)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withColumn(new ydb.Column("created_by", ydb.Types.optional(ydb.Types.UTF8)))
        .withPrimaryKey("id");
      // Авто-лечение: если таблица уже существует со старой схемой (без body_hash), пересоздаём
      let legalDocsNeedsRecreate = false;
      try {
        const desc = await session.describeTable("legal_documents");
        const colNames = (desc.columns || []).map((c: any) => c.name);
        if (!colNames.includes("body_hash") || !colNames.includes("created_at") || !colNames.includes("created_by")) {
          console.log("[YDB] legal_documents has old schema, will recreate. Existing cols:", colNames.join(","));
          legalDocsNeedsRecreate = true;
        }
      } catch {
        // table doesn't exist — createTable ниже её создаст
      }
      if (legalDocsNeedsRecreate) {
        try {
          await session.dropTable("legal_documents");
          console.log("[YDB] legal_documents dropped (old schema)");
        } catch (e: any) {
          console.log("[YDB] legal_documents drop error:", e?.message?.substring(0, 120));
        }
      }
      try {
        await session.createTable("legal_documents", legalDocumentsDescription);
        console.log("[YDB] legal_documents table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          // already exists — fine
        } else {
          console.error("[YDB] Error creating legal_documents table:", err.message);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Append-only журнал подписей партнёров (для юр. защиты)
      // ─────────────────────────────────────────────────────────────────────
      const consentSignaturesDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("partner_id", ydb.Types.optional(ydb.Types.UINT64)))
        .withColumn(new ydb.Column("document_id", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("document_slug", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("document_version", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("document_hash", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("signed_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withColumn(new ydb.Column("ip", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("user_agent", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("method", ydb.Types.optional(ydb.Types.UTF8)))
        .withPrimaryKey("id");
      // Авто-лечение: если таблица существует со старой схемой, пересоздаём
      let consentNeedsRecreate = false;
      try {
        const desc = await session.describeTable("consent_signatures");
        const colNames = (desc.columns || []).map((c: any) => c.name);
        const required = ["document_id", "document_slug", "document_version", "document_hash", "signed_at", "ip", "user_agent", "method", "partner_id"];
        const missing = required.filter((c) => !colNames.includes(c));
        if (missing.length > 0) {
          console.log("[YDB] consent_signatures has old schema, will recreate. Missing:", missing.join(","), "Existing:", colNames.join(","));
          consentNeedsRecreate = true;
        }
      } catch {
        // нет таблицы — createTable создаст
      }
      if (consentNeedsRecreate) {
        try {
          await session.dropTable("consent_signatures");
          console.log("[YDB] consent_signatures dropped (old schema)");
        } catch (e: any) {
          console.log("[YDB] consent_signatures drop error:", e?.message?.substring(0, 120));
        }
      }
      try {
        await session.createTable("consent_signatures", consentSignaturesDescription);
        console.log("[YDB] consent_signatures table created");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          // already exists — fine
        } else {
          console.error("[YDB] Error creating consent_signatures table:", err.message);
        }
      }

      // Anti-spoof IP-фиксация (30.04.2026): добавляем форензик-колонку remote_ip
      // (настоящий IP TCP-сокета — нельзя подделать через X-Forwarded-For).
      // Идемпотентно: если колонка уже есть (выполнен ALTER в Yandex Console) — игнорируем.
      try {
        await session.executeQuery(`ALTER TABLE consent_signatures ADD COLUMN remote_ip Utf8;`);
        console.log("[YDB] Added remote_ip column to consent_signatures table");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('Member not found') || err.message?.includes('column already exists') || err.message?.includes('Cannot add column')) {
          // already exists — fine
        } else {
          console.log("[YDB] consent_signatures.remote_ip migration:", err.message?.substring(0, 120));
        }
      }
      // GeoIP (30.04.2026): страна/регион/город на момент подписания для фиксации юрисдикции.
      for (const col of ["consent_country", "consent_region", "consent_city"]) {
        try {
          await session.executeQuery(`ALTER TABLE consent_signatures ADD COLUMN ${col} Utf8;`);
          console.log(`[YDB] Added ${col} column to consent_signatures table`);
        } catch (err: any) {
          if (err.message?.includes('already exists') || err.message?.includes('Member not found') || err.message?.includes('column already exists') || err.message?.includes('Cannot add column')) {
            // already exists — fine (пользователь уже выполнил ALTER вручную)
          } else {
            console.log(`[YDB] consent_signatures.${col} migration:`, err.message?.substring(0, 120));
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // УНЭП «email-link first» (30.04.2026): промежуточная таблица для
      // регистраций, ожидающих клика по ссылке в письме.
      // Колонки и PK — как в YQL DDL, который пользователь уже выполнил
      // вручную с TTL = Interval("PT0S") ON expires_at.
      // Этот fallback нужен только если кто-то когда-нибудь развернёт
      // систему на свежей БД — тогда TTL потребуется выставить отдельно
      // через консоль YDB (SDK не позволяет задать TTL декларативно).
      // ─────────────────────────────────────────────────────────────────────
      const partnerPendingDescription = new ydb.TableDescription()
        .withColumn(new ydb.Column("token", ydb.Types.UTF8))
        .withColumn(new ydb.Column("payload", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("form_hashes", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("ip", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("remote_ip", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("user_agent", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("consent_country", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("consent_region", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("consent_city", ydb.Types.optional(ydb.Types.UTF8)))
        .withColumn(new ydb.Column("created_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withColumn(new ydb.Column("expires_at", ydb.Types.optional(ydb.Types.TIMESTAMP)))
        .withPrimaryKey("token");
      try {
        await session.createTable("partner_pending_submissions", partnerPendingDescription);
        console.log("[YDB] partner_pending_submissions table created (TTL must be set manually via console)");
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('path exist')) {
          // already exists — fine
        } else {
          console.error("[YDB] Error creating partner_pending_submissions table:", err.message);
        }
      }

      try {
        const desc = await session.describeTable("orders");
        const partnerIdCol = desc.columns?.find((c: any) => c.name === "partner_id");
        if (partnerIdCol) {
          const typeStr = JSON.stringify(partnerIdCol.type ?? {});
          const looksLikeUtf8 = typeStr.includes('"UTF8"') || typeStr.includes('"Utf8"') || typeStr.toLowerCase().includes("utf8");
          if (!looksLikeUtf8) {
            console.error(
              "[YDB] ⚠ ВНИМАНИЕ: orders.partner_id больше НЕ Utf8! " +
              "Ожидался legacy-тип Utf8?, но обнаружен другой. " +
              "СРОЧНО проверить serializeOrderPartnerId/deserializeOrderPartnerId в server/storage.ts " +
              "и раздел про legacy в replit.md. Тип из YDB: " + typeStr.substring(0, 200)
            );
          } else {
            console.log("[YDB] orders.partner_id schema check OK (Utf8, как и ожидалось)");
          }
        } else {
          console.warn("[YDB] orders.partner_id колонка не найдена при self-check (это нормально на свежей dev-БД)");
        }
      } catch (err: any) {
        console.warn("[YDB] orders.partner_id self-check skipped:", err.message?.substring(0, 120));
      }
    });
  } catch (err) {
    console.error("[YDB] Failed to init tables:", err);
  }
}

export { schema };
