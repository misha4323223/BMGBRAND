// Общий помощник для транзиентных ошибок YDB (2026-09-27).
//
// Зачем: гонки при записи (двойной клик «В корзину», две вкладки, несколько
// товаров параллельно) дают ABORTED «Transaction locks invalidated» — это НЕ сбой
// базы, операцию надо просто повторить. До этого фикса записи корзины шли мимо
// ретраев safeQuery: ошибка вылетала наверх, в мессенджеры уходила
// «Необработанная ошибка», а клиент не получал ответа.
//
// Здесь единый предикат «эту ошибку можно повторить» и обёртка с backoff.
import { reconnectYdb, shouldReconnectYdb } from "../db";
import { logWarn } from "../logger";

// Текстовые маркеры транзиентных ошибок YDB.
// Формат SDK: "Aborted (code 400040): [ {message: 'Transaction locks invalidated...', issueCode: 2001} ]"
const RETRYABLE_PATTERNS = [
  "Transaction locks invalidated",
  "locks are not valid",
  "Operation is aborting",
  "Transaction is aborted",
  "400040", // YDB ABORTED
  "400140", // YDB NOT_FOUND ("Transaction not found") — транзакцию отменило на стороне базы
  "Transaction not found",
  "BadSession",
  "Session not found",
  "Session is closed",
  "session is busy",
  "RESOURCE_EXHAUSTED",
  "Overloaded",
];

export function isRetryableYdbError(error: any): boolean {
  if (!error) return false;

  // Транспорт/авторизация — драйвер надо пересоздавать (единый источник правды в db.ts).
  if (shouldReconnectYdb(error)) return true;

  const name = error?.constructor?.name || "";
  if (name === "BadSession") return true;

  const message = String(error?.message || error?.details || error || "");
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const issueText = issues
    .map((issue: any) => `${issue?.message ?? ""} ${issue?.issueCode ?? ""}`)
    .join(" ");

  const haystack = `${message} ${issueText}`;
  return RETRYABLE_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export interface YdbRetryOptions {
  /** Сколько всего попыток, включая первую. По умолчанию 3. */
  attempts?: number;
  /** Базовая пауза перед повтором, мс. По умолчанию 150. */
  baseDelayMs?: number;
  /** Метка для логов, например "cart.addToCart". */
  label?: string;
}

function retryDelayMs(error: any, attempt: number, baseDelayMs: number): number {
  const message = String(error?.message || error || "");
  // Rate limit (RESOURCE_EXHAUSTED) нужно переждать дольше
  if (message.includes("RESOURCE_EXHAUSTED")) return Math.max(1000 * attempt, baseDelayMs);
  return baseDelayMs * attempt + Math.floor(Math.random() * 100);
}

function shortErrorMessage(error: any): string {
  return String(error?.message || error || "unknown").slice(0, 200);
}

/**
 * Повторяет операцию при транзиентных ошибках YDB (гонки, aborted, bad session,
 * транспорт). НЕ проглатывает ошибку: после исчерпания попыток бросает последнюю,
 * чтобы HTTP-слой вернул честный ответ, а не молчал.
 */
export async function withYdbRetry<T>(
  operation: () => Promise<T>,
  options: YdbRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 150);
  const label = options.label || "YDB operation";

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableYdbError(error) || attempt >= attempts) break;

      // Транспортная ошибка — пересоздаём драйвер, как это делает safeQuery
      if (shouldReconnectYdb(error)) {
        try {
          await reconnectYdb();
        } catch {
          /* повторная попытка всё равно будет ниже */
        }
      }

      const delay = retryDelayMs(error, attempt, baseDelayMs);
      logWarn(`[YDB] ${label}: попытка ${attempt}/${attempts} не удалась (${shortErrorMessage(error)}), повтор через ${delay} мс`);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
