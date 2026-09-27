// Слушатели радио-полоски: анонимный id + время последнего сигнала.
//
// Считаем ТОЛЬКО наших посетителей (не цифры станции): пока эфир играет,
// браузер раз в ~25 секунд шлёт «я слушаю», сервер пишет last_seen.
// «Слушают сейчас» = строки, у которых last_seen свежее окна RADIO_LISTENER_WINDOW_MS.
//
// Таблица: radio_listeners (listener_id Utf8 PRIMARY KEY, last_seen Uint64=epoch ms).
// Хранится только анонимный id гостя — ни IP, ни устройства, ни имени.
import { waitForDriver } from "../db";
import { logWarn } from "../logger";
import { withYdbRetry } from "../lib/ydb-retry";

const TABLE = "radio_listeners";
/** Повтор попытки создать таблицу не чаще раза в минуту (если YDB был недоступен). */
const ENSURE_RETRY_MS = 60_000;

let tableReady = false;
let ensureAttemptedAt = 0;

export async function ensureRadioListenersTable(): Promise<boolean> {
  if (tableReady) return true;
  const now = Date.now();
  if (ensureAttemptedAt && now - ensureAttemptedAt < ENSURE_RETRY_MS) return false;
  ensureAttemptedAt = now;

  try {
    const activeDriver = await waitForDriver();
    if (!activeDriver) return false;

    const { TableDescription, Column, Types } = await import("ydb-sdk");
    const description = new TableDescription()
      .withColumn(new Column("listener_id", Types.UTF8))
      .withColumn(new Column("last_seen", Types.UINT64))
      .withPrimaryKey("listener_id");

    await activeDriver.tableClient.withSession(async (session) => {
      // createTable идемпотентен на практике: существующая таблица не мешает.
      await session.createTable(TABLE, description);
    });

    tableReady = true;
    return true;
  } catch (err: any) {
    logWarn("[Radio] ensure radio_listeners failed:", (err?.message || String(err)).slice(0, 200));
    return false;
  }
}

/** Отмечает, что слушатель с этим id всё ещё слушает. */
export async function touchRadioListener(listenerId: string): Promise<boolean> {
  if (!(await ensureRadioListenersTable())) return false;

  try {
    await withYdbRetry(async () => {
      const activeDriver = await waitForDriver();
      if (!activeDriver) throw new Error("[Radio] YDB driver unavailable");
      const { TypedValues, Types } = await import("ydb-sdk");

      await activeDriver.tableClient.withSession(async (session) => {
        await session.executeQuery(
          `DECLARE $listener_id AS Utf8;
           DECLARE $last_seen AS Uint64;
           UPSERT INTO radio_listeners (listener_id, last_seen)
           VALUES ($listener_id, $last_seen);`,
          {
            $listener_id: TypedValues.fromNative(Types.UTF8, listenerId),
            $last_seen: TypedValues.fromNative(Types.UINT64, Date.now()),
          },
        );
      });
    }, { label: "radio.touchListener", attempts: 3, baseDelayMs: 100 });
    return true;
  } catch (err: any) {
    logWarn("[Radio] touch listener failed:", (err?.message || String(err)).slice(0, 200));
    return false;
  }
}

/** Сколько слушателей активны в окне `windowMs` (null — если посчитать не удалось). */
export async function countRadioListeners(windowMs: number): Promise<number | null> {
  if (!(await ensureRadioListenersTable())) return null;

  try {
    return await withYdbRetry(async () => {
      const activeDriver = await waitForDriver();
      if (!activeDriver) throw new Error("[Radio] YDB driver unavailable");
      const { TypedValues, Types } = await import("ydb-sdk");

      return await activeDriver.tableClient.withSession(async (session) => {
        const result = await session.executeQuery(
          `DECLARE $cutoff AS Uint64;
           SELECT COUNT(*) AS cnt FROM radio_listeners WHERE last_seen > $cutoff;`,
          { $cutoff: TypedValues.fromNative(Types.UINT64, Date.now() - windowMs) },
        );
        const value = result.resultSets?.[0]?.rows?.[0]?.items?.[0]?.uint64Value;
        return value === undefined || value === null ? 0 : Number(value);
      });
    }, { label: "radio.countListeners", attempts: 3, baseDelayMs: 100 });
  } catch (err: any) {
    logWarn("[Radio] count listeners failed:", (err?.message || String(err)).slice(0, 200));
    return null;
  }
}

/** Убирает давно замолчавших — таблица не растёт бесконечно. */
export async function cleanupRadioListeners(olderThanMs: number): Promise<void> {
  if (!(await ensureRadioListenersTable())) return;

  try {
    await withYdbRetry(async () => {
      const activeDriver = await waitForDriver();
      if (!activeDriver) throw new Error("[Radio] YDB driver unavailable");
      const { TypedValues, Types } = await import("ydb-sdk");

      await activeDriver.tableClient.withSession(async (session) => {
        await session.executeQuery(
          `DECLARE $cutoff AS Uint64;
           DELETE FROM radio_listeners WHERE last_seen < $cutoff;`,
          { $cutoff: TypedValues.fromNative(Types.UINT64, Date.now() - olderThanMs) },
        );
      });
    }, { label: "radio.cleanupListeners", attempts: 2, baseDelayMs: 100 });
  } catch (err: any) {
    logWarn("[Radio] cleanup listeners failed:", (err?.message || String(err)).slice(0, 200));
  }
}
