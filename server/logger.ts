// Структурированный логгер.
//
// Единый формат строк логов: `<ISO-время> [LEVEL] <message> <args...>`
// Сигнатуры функций повторяют console.* — замена механическая и безопасная:
//   console.error(...)  →  logError(...)
//   console.warn(...)   →  logWarn(...)
//   console.log(...)    →  logInfo(...)
//
// Уровни позволяют фильтровать/агрегировать логи (errors vs warnings vs info)
// без изменения поведения: вывод идёт в те же консольные потоки, что и раньше.

type LogLevel = "INFO" | "WARN" | "ERROR";

function write(level: LogLevel, message: unknown, args: unknown[]): void {
  const prefix = `${new Date().toISOString()} [${level}]`;
  const target =
    level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;

  if (typeof message === "string") {
    if (args.length === 0) {
      target(`${prefix} ${message}`);
    } else {
      target(`${prefix} ${message}`, ...args);
    }
  } else {
    // Редкий случай: первый аргумент — не строка (например, голый Error).
    target(prefix, message, ...args);
  }
}

export function logInfo(message: string, ...args: unknown[]): void {
  write("INFO", message, args);
}

export function logWarn(message: string, ...args: unknown[]): void {
  write("WARN", message, args);
}

export function logError(message: string, ...args: unknown[]): void {
  write("ERROR", message, args);
}
