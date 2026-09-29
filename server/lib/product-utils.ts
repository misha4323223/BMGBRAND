// Чистые хелперы размеров/стоков и санитизации HTML/JSON-LD.
// Вынесены из server/routes.ts дословно, без изменения поведения, чтобы
// покрывать их юнит-тестами и сократить монолит.

// Standard size order for sorting (from smallest to largest)
export const SIZE_ORDER: Record<string, number> = {
  '3XS': 1, 'XXS': 2, 'XS': 3, 'S': 4, 'M': 5, 'L': 6, 'XL': 7, 'XXL': 8, 'XXXL': 9, '3XL': 9, '4XL': 10
};

// Sort sizes in logical order
// Sanitize the SEO body HTML block entered in the admin product editor:
// - strips <title> entirely (invalid outside <head>, would just be dead weight in the page body)
// - downgrades <h1> to <h2> so it never duplicates the product page's own <h1> (the product name)
// Everything else (<p>, <strong>, <ul>, <li>, etc.) passes through untouched.
export function sanitizeHtmlBlock(html: string): string {
  if (!html) return '';
  return html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<h1(\s[^>]*)?>/gi, '<h2$1>')
    .replace(/<\/h1>/gi, '</h2>')
    .trim();
}

/**
 * Escapes raw control characters (U+0000–U+001F) that appear inside JSON
 * string literals — the most common cause of "Bad control character" errors
 * when users paste multi-line HTML into a JSON-LD textarea.
 * Uses a simple state machine so only chars INSIDE strings are touched;
 * whitespace between JSON tokens is left alone.
 */
export function sanitizeJsonLd(raw: string): string {
  if (!raw) return '';
  try {
    JSON.parse(raw);
    return raw; // already valid — nothing to do
  } catch {
    // Walk char-by-char, escape control chars only inside string literals
    let result = '';
    let inString = false;
    let escaped = false;
    const ESC: Record<string, string> = {
      '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
    };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (escaped) { result += c; escaped = false; continue; }
      if (c === '\\' && inString) { result += c; escaped = true; continue; }
      if (c === '"') { inString = !inString; result += c; continue; }
      if (inString && c.charCodeAt(0) < 0x20) {
        result += ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
      result += c;
    }
    return result;
  }
}

export function sortSizes(sizes: string[]): string[] {
  return sizes.sort((a, b) => {
    const orderA = SIZE_ORDER[a.toUpperCase()] ?? 100;
    const orderB = SIZE_ORDER[b.toUpperCase()] ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
}

// Normalize size key for comparison (remove spaces and parentheses, lowercase)
// Standard clothing sizes — used to distinguish legitimate sold-out sizes from garbage 1C artifacts
export const STANDARD_CLOTHING_SIZES = new Set([
  "XXS","XS","S","M","L","XL","XXL","XXXL","3XL","2XL","4XL","5XL","XXXXL",
  "44","46","48","50","52","54","56","58","60","62",
]);

export function normalizeSizeKey(s: string): string {
  return s.replace(/[\s()]/g, '').toLowerCase();
}

// Canonicalize size key for storage — converts all "one size" variants to "OneSize"
export function canonicalizeSizeKey(s: string): string {
  if (!s) return s;
  const norm = normalizeSizeKey(s);
  if (norm === 'onesize' || norm === 'one') return 'OneSize';
  return s;
}

// Sizes that must NEVER be written to a product. XXS is not sold on the
// storefront and the admin UI doesn't offer it — if it appears, it's a stale
// 1C/backfill artifact, so it's stripped here as a single choke point.
export const FORBIDDEN_SIZES: ReadonlySet<string> = new Set(['XXS']);

// Sanitize a raw size list before persisting:
//  - dedupes keeping first occurrence order
//  - canonicalizes every one-size variant to a single "OneSize"
//  - strips forbidden sizes (XXS)
export function sanitizeSizes(raw: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = String(item ?? '').trim();
      if (!s) continue;
      const canon = canonicalizeSizeKey(s);
      const norm = normalizeSizeKey(canon);
      if (FORBIDDEN_SIZES.has(norm.toUpperCase())) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      result.push(canon);
    }
  }
  return result;
}

// Sanitize a size->stock map before persisting. Applies the same rules as
// sanitizeSizes to the keys (strip forbidden XXS, canonicalize one-size to
// "OneSize"), merges stock when two keys normalize to the same size, and
// drops zero-stock forbidden/legacy keys.
export function sanitizeSizeStock(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const s = String(k ?? '').trim();
      if (!s) continue;
      const canon = canonicalizeSizeKey(s);
      const norm = normalizeSizeKey(canon);
      if (FORBIDDEN_SIZES.has(norm.toUpperCase())) continue;
      const num = Number(v);
      const qty = Number.isFinite(num) ? num : 0;
      out[canon] = (out[canon] ?? 0) + qty;
    }
  }
  return out;
}

// Resolve available stock for a given size string from sizeStock map.
// Handles legacy key variants like "One Size", "(OneSize)", "OneSize" by normalizing.
// Returns the maximum stock found among all keys that normalize to the same form.
// Returns undefined if no matching key found (caller should fallback to product.stock).
export function resolveSizeStock(sizeStock: Record<string, number>, size: string): number | undefined {
  if (sizeStock[size] !== undefined) {
    // Exact match found — but still check if a normalized match has higher stock
    const norm = normalizeSizeKey(size);
    const matches = Object.entries(sizeStock).filter(([k]) => normalizeSizeKey(k) === norm);
    if (matches.length > 1) {
      return Math.max(...matches.map(([, v]) => v));
    }
    return sizeStock[size];
  }
  const norm = normalizeSizeKey(size);
  const matches = Object.entries(sizeStock).filter(([k]) => normalizeSizeKey(k) === norm);
  if (matches.length === 0) return undefined;
  return Math.max(...matches.map(([, v]) => v));
}

/**
 * GUID характеристики, выданный самой 1С (а не придуманный сайтом).
 *
 * 1С в этом проекте выдаёт идентификаторы первого поколения: `…-11eb-…`,
 * `…-11f1-…`, с MAC-узлом в конце (последние 12 hex-цифр). Сайт же, пока
 * придумывал характеристики сам (до 29.09.2026), писал `crypto.randomUUID()` —
 * это UUID версии 4. Отправлять в 1С неизвестный ей GUID нельзя: она не может
 * привязать характеристику и подставляет в это поле название товара.
 *
 * true только для корректного GUID версии 1; всё остальное (v4 от сайта,
 * мусор, пусто) — false.
 */
export function isOneCCharacteristicGuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return false;
  return s[14] === '1';
}

/**
 * Найти GUID характеристики (из 1С) для конкретного размера заказа.
 *
 * Размер приходит от покупателя в «сыром» виде (`(40-45)`, `one size`, `М`
 * кириллицей), а ключи `sizeCharacteristicIds` хранятся канонизированными
 * (`40-45`, `OneSize`). Прямой поиск по ключу такие пары теряет, поэтому
 * сначала пробуем точное совпадение (быстрый путь), затем — совпадение по
 * `normalizeSizeKey` (как в `resolveSizeStock`).
 *
 * Если у одного размера есть несколько ключей и среди них есть GUID из 1С
 * (например `(OneSize)` придуман сайтом, а `OneSize` пришёл из 1С) — вернём
 * 1С-овский: сайтовый 1С всё равно не знает.
 *
 * Возвращает GUID или undefined. Никогда не выдумывает значение: если пары нет,
 * значит характеристики у этого размера нет (в 1С уйдёт товар без характеристики).
 */
export function resolveSizeCharacteristicId(
  ids: unknown,
  size: unknown,
): string | undefined {
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) return undefined;
  const map = ids as Record<string, unknown>;
  const key = typeof size === 'string' ? size.trim() : '';
  if (!key) return undefined;

  const direct = map[key];
  const directGuid = typeof direct === 'string' && direct.trim() ? direct.trim() : undefined;
  if (directGuid && isOneCCharacteristicGuid(directGuid)) return directGuid;

  const norm = normalizeSizeKey(key);
  if (!norm) return directGuid;
  let fallback: string | undefined;
  for (const [k, v] of Object.entries(map)) {
    if (normalizeSizeKey(k) !== norm) continue;
    if (typeof v !== 'string' || !v.trim()) continue;
    const guid = v.trim();
    if (isOneCCharacteristicGuid(guid)) return guid;
    if (!fallback) fallback = guid;
  }
  return fallback ?? directGuid;
}

/**
 * Характеристики размеров для выгрузки в 1С.
 * Сайт НЕ выдумывает GUID характеристики: он хранит только те, что пришли из 1С
 * (импорт предложений: `offer Ид = "продуктGuid#характеристикаGuid"`). Если GUID
 * неизвестен 1С, она не может привязать характеристику и подставляет в это поле
 * название товара — поэтому выдуманные GUID недопустимы.
 *
 * Возвращает только те пары «размер → GUID», которые уже есть у товара и
 * относятся к оставшимся размерам; ключи сравниваются нормализованно
 * (как в resolveSizeStock), сами GUID не меняются.
 * Если список размеров пустой — возвращаем всё, что было (ничего не теряем).
 */
export function keepExistingSizeCharacteristicIds(existing: unknown, sizes: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return out;
  const wanted = new Set(
    (Array.isArray(sizes) ? sizes : [])
      .map((s) => normalizeSizeKey(String(s ?? '')))
      .filter(Boolean),
  );
  for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (wanted.size > 0 && !wanted.has(normalizeSizeKey(key))) continue;
    out[key] = value;
  }
  return out;
}
