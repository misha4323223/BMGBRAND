/**
 * Служебные и дублирующие записи `page_settings.artist_pages` → канонический URL.
 *
 * Причина: в админке исторически накопились записи с техническими слагами
 * (`artist-<timestamp>`), которые дублируют живого артиста. Они попадали в
 * sitemap, отдавали 200 и совпадали по title с настоящей страницей — то есть
 * создавали технический дубль (SEO-отчёт от 15.10.2026, п. 2).
 *
 *  - `artist-1772386526792` — копия «Молодость внутри» без товаров
 *    (`/api/products/by-artist` = 0), при этом у `/@molodostvnutri` их 21.
 *  - `artist-1772387909100` — копия коллаборации «Тульские дизайнеры» без
 *    своих товаров; живые товары лежат в подкатегории `/tula-designers`.
 *
 * Редирект делается на уровне сервера (bot-ssr.ts для роботов, static.ts для
 * браузеров), запись исключается из sitemap и llms.txt. Данные в админке не
 * трогаем — запись можно удалить там позже, редирект всё равно останется
 * безопасным no-op для отсутствующего слага.
 */
export const ARTIST_DUPLICATE_REDIRECTS: Record<string, string> = {
  "artist-1772386526792": "/@molodostvnutri",
  "artist-1772387909100": "/tula-designers",
};

/** Канонический URL для служебного слага артиста, либо null. */
export function artistRedirectTarget(slug: string): string | null {
  return ARTIST_DUPLICATE_REDIRECTS[slug] ?? null;
}
