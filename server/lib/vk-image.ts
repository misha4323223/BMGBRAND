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
