/**
 * Выбор ключа ручных SEO-текстов подкатегории.
 *
 * В `page_settings.seo` ключи выглядят как `subcategory:<catSlug>:<slug>`, где
 * slug — публичный (английский) слаг из URL: `subcategory:clothing:sweaters`.
 * При этом в каталоге у подкатегории может быть другой (YDB) слаг — `svitera`.
 * На legacy-адресах `/sweaters` в URL нет YDB-слага, поэтому перебираем
 * кандидатов и берём первого, для кого переопределение реально сохранено.
 */
export function resolveSubcategorySeoKey(
  catSlug: string,
  candidates: Array<string | null | undefined>,
  hasOverride: (key: string) => boolean,
): string | null {
  const slugs = candidates.filter((s): s is string => typeof s === "string" && s.length > 0);
  const match = slugs.find((slug) => hasOverride(`subcategory:${catSlug}:${slug}`));
  return match ? `subcategory:${catSlug}:${match}` : null;
}
