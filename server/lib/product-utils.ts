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
