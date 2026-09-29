/**
 * Картинки для VK-фида.
 *
 * Каталог хранит фото в WebP, а VK-импортер принимает только JPG/PNG/GIF.
 * Этот модуль либо отдаёт «дружелюбный» формат как есть (jpg/png), либо
 * конвертирует WebP в JPEG (sharp) и сохраняет результат в Object Storage
 * рядом с оригиналом (`site/foo.webp` -> `site/foo_vk.jpg`), чтобы повторные
 * обращения не тратили CPU. Оригиналы не изменяются и не удаляются.
 */

import sharp from "sharp";
import { logError, logInfo } from "../logger";
import {
  checkFileExistsInYandexStorage,
  downloadBinaryFromYandexStorage,
  publicUrlFromStorageKey,
  putObjectToYandexStorage,
} from "./storage-s3";

/** Ширина JPEG для VK: 1600px достаточно для карточек, файл при этом меньше WebP-оригинала. */
const VK_JPEG_MAX_WIDTH = 1600;
const VK_JPEG_QUALITY = 85;

const STORAGE_HOST_RE = /^https:\/\/storage\.yandexcloud\.net\/[^/]+\/(.+)$/;
const IMAGE_EXT_RE = /\.(webp|jpe?g|png)$/i;

/** S3-ключ из публичного URL нашего бакета. null — если URL не наш или небезопасный. */
export function storageKeyFromUrl(url: string): string | null {
  const raw = String(url || "").split("?")[0];
  const match = raw.match(STORAGE_HOST_RE);
  if (!match) return null;
  let key = match[1];
  try {
    key = decodeURIComponent(key);
  } catch {
    /* оставляем как есть */
  }
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) return null;
  return key;
}

/** Форматы, которые VK принимает как есть. */
export function isVkFriendlyImage(url: string): boolean {
  return /\.(jpe?g|png)$/i.test(String(url || "").split("?")[0]);
}

/** Ключ JPEG-версии: `site/foo.webp` -> `site/foo_vk.jpg`. */
export function vkJpegKeyFor(sourceKey: string): string {
  return sourceKey.replace(IMAGE_EXT_RE, "") + "_vk.jpg";
}

/**
 * URL картинки для VK-фида:
 * webp из нашего бакета -> прокси-JPEG `/vk-img/<путь>.jpg`,
 * jpg/png (и любые чужие URL) -> без изменений.
 */
export function vkPictureUrl(baseUrl: string, imageUrl: string): string {
  const url = String(imageUrl || "");
  if (isVkFriendlyImage(url)) return url;
  const key = storageKeyFromUrl(url);
  if (!key || !/\.webp$/i.test(key)) return url;
  return `${baseUrl}/vk-img/${key.replace(/\.webp$/i, ".jpg")}`;
}

/**
 * Путь `/vk-img/site/foo.jpg` -> возможные ключи исходника в бакете.
 * Основной вариант — WebP (в нём лежит каталог), остальные — на случай
 * jpg/png-оригиналов. Пустая строка / выход за каталог -> [].
 */
export function vkImagePathToSourceCandidates(requestPath: string): string[] {
  let clean = String(requestPath || "").replace(/^\/+/, "");
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* оставляем как есть */
  }
  if (!clean || clean.includes("..") || clean.includes("\\")) return [];
  const match = clean.match(/^(.*)\.(jpe?g|png)$/i);
  if (!match) return [];
  const base = match[1];
  return [`${base}.webp`, `${base}.jpg`, `${base}.jpeg`, `${base}.png`];
}

// JPEG-версии, уже подтверждённые в бакете (кэш в памяти инстанса).
const vkConvertedKeys = new Set<string>();

async function convertToVkJpeg(source: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(source)
      .rotate()
      .resize({ width: VK_JPEG_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: VK_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err: any) {
    logError(`[VK IMG] sharp failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * ── Доступность картинок для VK-фида ──────────────────────────────────────────
 * Правило ВК: «товары без изображений при импорте будут пропущены». А бывает
 * так, что файла в бакете уже нет (фото перезаливали/удаляли, а ссылка в БД
 * осталась) — такая ссылка в <picture> бессмысленна. Здесь фильтруем: битые
 * ссылки убираем, товар, где не осталось ни одной живой картинки, не отдаём.
 */
export type VkImageExists = (key: string) => Promise<boolean>;

/**
 * Кандидаты ключей в бакете для проверки:
 * - наш бакет → сам ключ;
 * - наш прокси `/vk-img/…` → ключи исходника (webp/jpg/jpeg/png);
 * - чужой хост → `null`: проверять нечем и отменять чужую ссылку по догадке нельзя.
 */
export function vkImageSourceKeys(url: string): string[] | null {
  const u = String(url || "");
  const key = storageKeyFromUrl(u);
  if (key) return [key];
  const m = u.match(/\/vk-img\/(.+)$/);
  if (m) {
    const path = m[1].split("?")[0];
    try {
      return vkImagePathToSourceCandidates(decodeURIComponent(path));
    } catch {
      return vkImagePathToSourceCandidates(path);
    }
  }
  return null;
}

// Кэш «этот файл точно есть» — каждый ключ проверяем не чаще раза в сутки.
const vkImageOkAt = new Map<string, number>();
const VK_IMAGE_OK_TTL_MS = 24 * 60 * 60 * 1000;

async function s3ExistsOnce(key: string): Promise<boolean> {
  try {
    return await checkFileExistsInYandexStorage(key);
  } catch {
    return false;
  }
}

/** Защита от ложного «не найдено»: временный сбой S3 не должен ронять фото. */
async function s3ExistsSafe(key: string): Promise<boolean> {
  if (await s3ExistsOnce(key)) return true;
  return s3ExistsOnce(key);
}

async function vkImageExistsCached(key: string): Promise<boolean> {
  const at = vkImageOkAt.get(key);
  if (at && Date.now() - at < VK_IMAGE_OK_TTL_MS) return true;
  const ok = await s3ExistsSafe(key);
  // Неудачу не кэшируем — битые ключи проверяются заново при каждом генерировании фида.
  if (ok) vkImageOkAt.set(key, Date.now());
  else vkImageOkAt.delete(key);
  return ok;
}

/** Параллельное применение проверки к списку URL (2300+ ссылок, поэтому пул). */
async function filterWithPool(
  urls: string[],
  exists: VkImageExists,
  concurrency: number,
): Promise<string[]> {
  const results = new Array<string>(urls.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, urls.length)) },
    async () => {
      while (cursor < urls.length) {
        const idx = cursor++;
        const url = urls[idx];
        const keys = vkImageSourceKeys(url);
        // Чужой хост оставляем как есть; URL, не похожий на картинку, отбрасываем.
        if (keys === null) {
          results[idx] = url;
          continue;
        }
        for (const key of keys) {
          if (await exists(key)) {
            results[idx] = url;
            break;
          }
        }
      }
    },
  );
  await Promise.all(workers);
  return results.filter(Boolean);
}

/**
 * Оставляет только картинки, по которым файл реально лежит в хранилище.
 * `exists` переопределяется в тестах; по умолчанию — HEAD по бакету с кэшем.
 *
 * Страховка: если живых осталось меньше половины — похоже не на битые файлы,
 * а на сбой хранилища, и мы возвращаем всё как было (лишний раз не теряем фото).
 */
export async function filterExistingVkImages(
  urls: string[],
  exists: VkImageExists = vkImageExistsCached,
  // Пакет большой (2300+ ссылок), а каждый HEAD к S3 идёт ~100–200 мс:
  // без широкого пула первый запрос фида занимает бы секунд 25.
  concurrency = 64,
): Promise<string[]> {
  if (urls.length === 0) return [];
  const alive = await filterWithPool(urls, exists, concurrency);
  // Граница 8+ нужна, чтобы на маленьких списках не путать битую ссылку с аварией.
  if (urls.length >= 8 && alive.length * 2 < urls.length) {
    logError(
      `[VK IMG] Проверка фото похожа на сбой хранилища (живо ${alive.length} из ${urls.length}) — оставляем все ссылки`,
    );
    return [...urls];
  }
  return alive;
}

/**
 * Возвращает JPEG-версию картинки, при необходимости создавая её:
 * готовый `_vk.jpg` из бакета -> конвертация WebP (sharp) -> сохранение в бакет.
 */
export async function getOrCreateVkJpeg(
  requestPath: string,
): Promise<{ buffer: Buffer; key: string } | null> {
  const candidates = vkImagePathToSourceCandidates(requestPath);
  if (candidates.length === 0) return null;

  const jpegKey = vkJpegKeyFor(candidates[0]);

  // 1) JPEG уже готов (создан ранее этим или другим инстансом).
  if (vkConvertedKeys.has(jpegKey) || (await checkFileExistsInYandexStorage(jpegKey))) {
    const cached = await downloadBinaryFromYandexStorage(jpegKey);
    if (cached) {
      vkConvertedKeys.add(jpegKey);
      return { buffer: cached, key: jpegKey };
    }
  }

  // 2) Ищем исходник и конвертируем.
  for (const sourceKey of candidates) {
    if (!(await checkFileExistsInYandexStorage(sourceKey))) continue;
    const source = await downloadBinaryFromYandexStorage(sourceKey);
    if (!source) return null;
    const jpeg = await convertToVkJpeg(source);
    if (!jpeg) return null;
    const savedUrl = await putObjectToYandexStorage(jpeg, jpegKey, "image/jpeg");
    if (savedUrl) vkConvertedKeys.add(jpegKey);
    logInfo(
      `[VK IMG] ${sourceKey} -> ${jpegKey} (${Math.round(jpeg.length / 1024)} KB${savedUrl ? "" : ", not persisted"})`,
    );
    return { buffer: jpeg, key: jpegKey };
  }

  return null;
}

// ── Прямые ссылки в хранилище для VK-фида ────────────────────────────────────
// Наш прокси `/vk-img/` на проде отдаёт HEAD с Content-Length: 0 и не
// поддерживает Range (вместо 206 — 200 со всем файлом), на этом спотыкается
// загрузчик картинок ВК («Произошла проблема с загрузкой изображения»).
// Прямые URL хранилища отдают заголовки корректно, поэтому в фид идут они.

/** Кандидаты ключей-исходников для URL картинки (принцип тот же, что в vkImageSourceKeys). */
function vkSourceCandidatesForUrl(url: string): string[] {
  const key = storageKeyFromUrl(url);
  if (key) return [key];
  const m = url.match(/\/vk-img\/(.+)$/);
  if (m) {
    const path = m[1].split("?")[0];
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      /* оставляем как есть */
    }
    const candidates = vkImagePathToSourceCandidates(decoded);
    if (candidates.length > 0) return candidates;
    // Прокси-ссылка уже на .webp — исходником является сам файл.
    if (/\.webp$/i.test(decoded) && !decoded.includes("..") && !decoded.includes("\\")) {
      return [decoded];
    }
    return [];
  }
  return [];
}

/**
 * Прямая ссылка на картинку в хранилище для фида:
 * - WebP (наш бакет или через прокси) → JPEG-версия `_vk.jpg`;
 * - jpg/png в бакете → сам файл;
 * - чужой хост / неизвестный URL → null (вызывающий оставляет оригинал).
 */
export function vkDirectStorageUrl(imageUrl: string): string | null {
  const url = String(imageUrl || "");
  const key = storageKeyFromUrl(url);
  if (key) {
    const target = /\.webp$/i.test(key) ? vkJpegKeyFor(key) : key;
    return publicUrlFromStorageKey(target);
  }
  const candidates = vkSourceCandidatesForUrl(url);
  if (candidates.length === 0) return null;
  // Для прокси `/vk-img/base.jpg` все кандидаты исходника сводятся к одному JPEG-ключу.
  return publicUrlFromStorageKey(vkJpegKeyFor(candidates[0]));
}

/** Гарантия наличия JPEG-версии в бакете: готова → true, иначе пробуем создать. */
async function ensureVkJpegExists(candidates: string[]): Promise<boolean> {
  const jpegKey = vkJpegKeyFor(candidates[0]);
  if (vkConvertedKeys.has(jpegKey)) return true;
  if (await checkFileExistsInYandexStorage(jpegKey)) {
    vkConvertedKeys.add(jpegKey);
    return true;
  }
  for (const sourceKey of candidates) {
    if (!(await checkFileExistsInYandexStorage(sourceKey))) continue;
    const source = await downloadBinaryFromYandexStorage(sourceKey);
    if (!source) return false;
    const jpeg = await convertToVkJpeg(source);
    if (!jpeg) return false;
    const savedUrl = await putObjectToYandexStorage(jpeg, jpegKey, "image/jpeg");
    if (!savedUrl) return false;
    vkConvertedKeys.add(jpegKey);
    logInfo(`[VK IMG] feed: ${sourceKey} -> ${jpegKey} (${Math.round(jpeg.length / 1024)} KB)`);
    return true;
  }
  return false;
}

/**
 * URL картинок для VK-фида: прямые ссылки в хранилище (см. vkDirectStorageUrl)
 * с гарантией, что JPEG-версия уже существует. Если создать её не удалось,
 * для этой картинки в карте ничего не будет — вызывающий возьмёт свой
 * запасной вариант (прокси), товар без фото не пропадёт.
 */
export async function buildVkFeedPictureUrls(
  urls: string[],
  concurrency = 16,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = urls.map((u) => ({ u, direct: vkDirectStorageUrl(u) }));
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, targets.length)) },
    async () => {
      while (cursor < targets.length) {
        const { u, direct } = targets[cursor++];
        if (!direct) continue; // чужой хост — оригинал без изменений
        const key = storageKeyFromUrl(u);
        const isWebp = (key ? /\.webp$/i.test(key) : false) || /\/vk-img\//.test(u);
        if (!isWebp) {
          // jpg/png уже лежат в бакете, их живость подтвердил фильтр.
          out.set(u, direct);
          continue;
        }
        const candidates = vkSourceCandidatesForUrl(u);
        if (candidates.length > 0 && (await ensureVkJpegExists(candidates))) {
          out.set(u, direct);
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}
