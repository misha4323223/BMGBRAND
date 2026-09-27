// Радио-полоска «Дикая Мята» под навбаром.
// Файл шарится между клиентом (компонент полоски) и сервером (/api/radio/now-playing),
// поэтому здесь только чистые данные и функции — никаких React/DOM зависимостей.

export interface RadioStation {
  id: string;
  /** Название как в ICY-заголовке станции (`icy-name`). */
  name: string;
  /** Строка-подпись из `icy-description`. */
  tagline: string;
  /**
   * Официальный поток станции (Icecast, mp3).
   * Аудио идёт напрямую со стороны станции в браузер слушателя — наш сервер в потоке не участвует.
   */
  streamUrl: string;
  /** Наш кэширующий эндпоинт «сейчас играет» (+ приём сигналов «я слушаю»). */
  nowPlayingUrl: string;
}

export const RADIO_STATION: RadioStation = {
  id: "dikaya-myata",
  name: "Дикая Мята",
  tagline: "Радио легендарного фестиваля",
  streamUrl: "https://dikayamyata.hostingradio.ru/dikayamyata128.mp3",
  nowPlayingUrl: "/api/radio/now-playing",
};

/**
 * Где полоску НЕ показываем: админка, партнёрка, опт и оформление заказа
 * (решение владельца, 2026-09-27). Сравнение — по границе сегмента пути,
 * чтобы `/partners` или `/checkoutsky` случайно не попадали под правило.
 */
export const RADIO_HIDDEN_PATH_PREFIXES = [
  "/admin",
  "/partner",
  "/wholesale",
  "/checkout",
  "/predrop/checkout",
] as const;

export function shouldShowRadioStrip(pathname: string): boolean {
  if (!pathname) return true;
  return !RADIO_HIDDEN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// ─── Счётчик «сколько слушают на сайте прямо сейчас» ──────────────────────────

/** Слушатель считается активным, если его сигнал был не позже этого окна. */
export const RADIO_LISTENER_WINDOW_MS = 60_000;

/** Показываем счётчик только от этого числа слушателей (решение владельца: от 3). */
export const RADIO_LISTENERS_MIN_DISPLAY = 3;

/**
 * Число для показа или null, если показывать не нужно.
 * Единица и двойка выглядят пусто — их скрываем, человек и так знает, что слушает он.
 */
export function getVisibleListenersCount(count: number | null | undefined): number | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  const value = Math.floor(count);
  if (value < RADIO_LISTENERS_MIN_DISPLAY) return null;
  return value;
}

export function listenersVerb(count: number): "слушает" | "слушают" {
  const value = Math.abs(Math.floor(count));
  const isSingular = value % 10 === 1 && value % 100 !== 11;
  return isSingular ? "слушает" : "слушают";
}

export function formatListenersCount(count: number): string {
  const value = Math.max(0, Math.floor(count));
  return `${value} ${listenersVerb(value)}`;
}

/**
 * Принимает только анонимный id гостя (nanoid / `user_123`) — буквы, цифры,
 * `_` и `-`, длина 6…64. Всё остальное игнорируем: в базу попадает только оно.
 */
export function sanitizeListenerId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 6 || trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}
