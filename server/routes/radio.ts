import type { Express } from "express";
import { RADIO_LISTENER_WINDOW_MS, RADIO_STATION, sanitizeListenerId } from "@shared/radio";
import { fetchIcyStreamTitle } from "../lib/radio-meta";
import {
  cleanupRadioListeners,
  countRadioListeners,
  touchRadioListener,
} from "../storage/radio-listeners";

/**
 * «Сейчас играет» + счётчик слушателей нашего сайта для радио-полоски в навбаре.
 *
 * ICY-метаданные читает НАШ сервер (а не браузеры посетителей): один опрос
 * на всех, результат кэшируется на 25 секунд — на станцию уходят килобайты,
 * а посетители получают готовый JSON. Если метаданных нет — отдаём null,
 * полоска просто покажет название станции.
 *
 * Слушатели: пока эфир играет, браузер раз в ~25 секунд зовёт этот же эндпоинт
 * с параметром `listener=<анонимный id>`. Мы обновляем last_seen и возвращаем
 * число активных за минуту — это «слушают на сайте сейчас». Никаких цифр станции
 * и никаких персональных данных: только анонимный id и время.
 */

const TITLE_CACHE_TTL_MS = 25_000;
const EMPTY_CACHE_TTL_MS = 10_000;
const LISTENERS_CACHE_TTL_MS = 5_000;
const CLEANUP_EVERY_MS = 5 * 60_000;
const CLEANUP_OLDER_THAN_MS = 10 * 60_000;

let cachedTitle: string | null = null;
let cachedAt = 0;
let inflight: Promise<string | null> | null = null;
let listenersCache: { count: number | null; at: number } | null = null;
let lastCleanupAt = 0;

async function getNowPlayingTitle(): Promise<string | null> {
  const now = Date.now();
  const ttl = cachedTitle ? TITLE_CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
  if (cachedAt > 0 && now - cachedAt < ttl) return cachedTitle;

  if (!inflight) {
    inflight = fetchIcyStreamTitle(RADIO_STATION.streamUrl).finally(() => {
      inflight = null;
    });
  }

  try {
    cachedTitle = await inflight;
  } catch {
    cachedTitle = null;
  }
  cachedAt = Date.now();
  return cachedTitle;
}

async function getListenersCount(): Promise<number | null> {
  const now = Date.now();
  if (listenersCache && now - listenersCache.at < LISTENERS_CACHE_TTL_MS) {
    return listenersCache.count;
  }
  const count = await countRadioListeners(RADIO_LISTENER_WINDOW_MS);
  listenersCache = { count, at: Date.now() };
  return count;
}

/** Чистка замолчавших: не чаще раза в 5 минут, но дожидаемся её (serverless может уснуть). */
async function maybeCleanupStaleListeners(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_EVERY_MS) return;
  lastCleanupAt = now;
  await cleanupRadioListeners(CLEANUP_OLDER_THAN_MS);
}

export function registerRadioRoutes(app: Express) {
  app.get("/api/radio/now-playing", async (req, res) => {
    const listenerId = sanitizeListenerId(req.query.listener);

    if (listenerId) {
      await touchRadioListener(listenerId);
      await maybeCleanupStaleListeners();
    }

    const [title, listeners] = await Promise.all([getNowPlayingTitle(), getListenersCount()]);

    res.set("Cache-Control", "no-store");
    res.json({ title, station: RADIO_STATION.name, listeners });
  });
}
