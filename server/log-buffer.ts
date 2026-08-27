/**
 * Кольцевые буферы диагностики (в памяти, очищаются при рестарте процесса).
 *
 * ТЗ №5: журнал запросов и ошибок для админ-панели AdminBMG.
 * - pushRequest() вызывается из middleware логирования запросов (server/index.ts);
 * - pushError() вызывается перехватом console.error / console.warn (server/index.ts);
 * - getRequestStats() / getRecentErrors() отдаются через /api/admin/diagnostics/*.
 *
 * Буферы живут в памяти процесса — история не переживает рестарт (это by design).
 */

export interface RequestLogEntry {
  ts: number; // epoch ms
  method: string;
  path: string;
  status: number;
  ms: number;
}

export interface ErrorLogEntry {
  ts: number; // epoch ms
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

const MAX_REQUESTS = 1000;
const MAX_ERRORS = 200;

const requestLog: RequestLogEntry[] = [];
const errorLog: ErrorLogEntry[] = [];

function push<T>(arr: T[], entry: T, max: number) {
  arr.push(entry);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export function pushRequest(entry: RequestLogEntry) {
  push(requestLog, entry, MAX_REQUESTS);
}

export function pushError(
  entry: Omit<ErrorLogEntry, "ts" | "level"> & { level?: ErrorLogEntry["level"] },
) {
  push(errorLog, { ts: Date.now(), level: entry.level ?? "error", ...entry }, MAX_ERRORS);
}

/** Последние записи журнала, новые сверху. */
export function getRecentErrors(limit = 100) {
  return errorLog.slice(-limit).reverse();
}

/** Статистика запросов за окно (минуты). */
export function getRequestStats(minutes: number) {
  const since = Date.now() - minutes * 60_000;
  const inWindow = requestLog.filter((e) => e.ts >= since);

  const byStatus: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  for (const e of inWindow) {
    const bucket =
      e.status >= 500 ? "5xx" : e.status >= 400 ? "4xx" : e.status >= 300 ? "3xx" : "2xx";
    byStatus[bucket]++;
  }

  const msArr = inWindow.map((e) => e.ms).sort((a, b) => a - b);
  const avgMs = msArr.length ? Math.round(msArr.reduce((a, b) => a + b, 0) / msArr.length) : 0;
  const p95Ms = msArr.length
    ? msArr[Math.min(msArr.length - 1, Math.floor(msArr.length * 0.95))]
    : 0;

  const slowest = [...inWindow].sort((a, b) => b.ms - a.ms).slice(0, 10);

  const errorsSince = Date.now() - 60 * 60_000;
  const errorsLastHour = errorLog.filter((e) => e.level === "error" && e.ts >= errorsSince).length;

  return { total: inWindow.length, byStatus, avgMs, p95Ms, slowest, errorsLastHour };
}
