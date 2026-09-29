/**
 * Зеркало VK-фида в Object Storage.
 *
 * Зачем: ВК забирает фид по ссылке сам и на нашем домене отвечает
 * «Не удалось загрузить файл». Причина — особенность платформы Yandex
 * Serverless Container: на HEAD-запрос ЛЮБОЙ URL отвечает `Content-Length: 0`
 * (локально Express отдаёт правильную длину, т.е. правится не в коде), плюс
 * контейнер холодно стартует и отвечает медленнее статики. Object Storage
 * отдаёт обычный статический файл с корректными заголовками и без прогрева.
 *
 * Поэтому фид дополнительно публикуется объектом `feeds/vk-feed.yml`
 * (расширение `.yml` — справка ВК требует ссылку вида `https://site.ru/file.yml`),
 * и именно эту ссылку отдаём ВК.
 *
 * Обновление: при каждой генерации фида (не чаще MIN_REPUBLISH_MS) и раз в час
 * из собственного `/vk-feed.yml` — иначе, если ВК читает только зеркало,
 * объект в бакете остался бы версией с момента деплоя.
 */

import { putObjectToYandexStorage } from "./lib/storage-s3";
import { logError, logInfo } from "./logger";

/** Ключ объекта в бакете (и расширение .yml — требование ВК к ссылке). */
export const VK_FEED_MIRROR_KEY = "feeds/vk-feed.yml";

/** Не публикуем зеркало чаще, чем раз в 10 минут (иначе каждая выдача фида = запись в S3). */
const MIN_REPUBLISH_MS = 10 * 60 * 1000;
/** Фоновая проверка: раз в час обновляем зеркало из собственного фида. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** Первый прогон после старта — с задержкой, чтобы сервер успел подняться. */
const FIRST_RUN_DELAY_MS = 30 * 1000;

let lastPublishedAt = 0;
let started = false;

/** Публичная ссылка на зеркало — это и есть адрес фида для ВК. */
export function vkFeedMirrorUrl(): string | null {
  const bucket = process.env.YANDEX_STORAGE_BUCKET_NAME;
  if (!bucket) return null;
  return `https://storage.yandexcloud.net/${bucket}/${VK_FEED_MIRROR_KEY}`;
}

/**
 * Зеркалим только настоящий YML-фид. Если генератор отдал HTML/страницу ошибки,
 * в бакет писать нельзя — ВК получил бы «файл не подходит» и после нас.
 */
export function isVkFeedXml(body: string): boolean {
  const head = String(body || "").slice(0, 200);
  return head.startsWith("<?xml") && head.includes("<yml_catalog");
}

/**
 * Публикует фид в бакет. `force` игнорирует десятиминутный троттлинг
 * (используется фоновым обновлением раз в час).
 * @returns публичный URL или null, если публикация не состоялась.
 */
export async function publishVkFeedToStorage(xml: string, force = false): Promise<string | null> {
  if (!isVkFeedXml(xml)) {
    logError("[VK feed] Отказ публиковать зеркало: это не YML-фид (пусто/HTML)");
    return null;
  }
  if (!force && Date.now() - lastPublishedAt < MIN_REPUBLISH_MS) return null;

  const url = await putObjectToYandexStorage(
    Buffer.from(xml, "utf8"),
    VK_FEED_MIRROR_KEY,
    "application/xml; charset=utf-8",
    // Короткий кэш: файл обновляется, годовой immutable-кэш здесь вреден.
    "public, max-age=600",
  );

  if (!url) {
    logError("[VK feed] Не удалось опубликовать зеркало фида в Object Storage");
    return null;
  }

  lastPublishedAt = Date.now();
  logInfo(`[VK feed] Зеркало фида обновлено: ${url} (${Buffer.byteLength(xml)} байт)`);
  return url;
}

/** Берём свой же фид (со стороны, через публичный URL) и обновляем зеркало. */
async function refreshMirrorFromSelf(): Promise<void> {
  const siteUrl = (process.env.SITE_URL || "https://booomerangs.ru").replace(/\/$/, "");
  try {
    const res = await fetch(`${siteUrl}/vk-feed.yml`, { headers: { "user-agent": "booomerangs-vk-feed-mirror" } });
    if (!res.ok) {
      logError(`[VK feed] Зеркало не обновлено: /vk-feed.yml ответил ${res.status}`);
      return;
    }
    const xml = await res.text();
    const url = await publishVkFeedToStorage(xml, true);
    if (url) console.log(`[VK feed] Ссылка для ВК: ${url}`);
  } catch (err: any) {
    logError("[VK feed] Фоновое обновление зеркала не удалось:", err?.message || err);
  }
}

/** Запускается один раз при старте сервера (см. server/index.ts). */
export function startVkFeedMirror(): void {
  if (started) return;
  started = true;
  console.log(`[VK feed] Зеркало фида включено (обновление раз в час): ${vkFeedMirrorUrl() || "нет бакета"}`);

  setTimeout(() => {
    refreshMirrorFromSelf().catch((err: any) =>
      logError("[VK feed] Первое обновление зеркала не удалось:", err?.message),
    );
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    refreshMirrorFromSelf().catch((err: any) =>
      logError("[VK feed] Обновление зеркала не удалось:", err?.message),
    );
  }, REFRESH_INTERVAL_MS);
}
