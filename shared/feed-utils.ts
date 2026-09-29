/**
 * Общие утилиты для YML-фидов (Яндекс Маркет / YCP / Ozon / VK).
 *
 * Чистые функции без побочных эффектов — используются сервером и покрыты
 * unit-тестами (server/__tests__/vk-feed.test.ts).
 */

/** Экранирование текста для вставки в XML. */
export function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Цена для фида. В БД цены хранятся в копейках.
 *
 * `integer: false` — обычный формат с копейками: «2950.00».
 * `integer: true`  — только целые рубли: «2950» (требование VK).
 */
export function formatFeedPriceRub(kopeks: number, integer: boolean): string {
  const rub = (Number(kopeks) || 0) / 100;
  return integer ? String(Math.round(rub)) : rub.toFixed(2);
}

/**
 * Описание для VK-фида. ВК отклоняет позиции с описанием короче 10 символов
 * («Описание товара должно быть длиннее 9 символов»), поэтому короткий или
 * пустой текст заменяется запасным вариантом.
 */
export function vkFeedDescription(desc: string, fallback: string): string {
  const clean = String(desc || "").replace(/\s+/g, " ").trim();
  return clean.length > 9 ? clean : String(fallback || "");
}
