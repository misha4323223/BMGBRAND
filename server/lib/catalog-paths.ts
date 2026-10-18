import { normalizeCategories } from "../../shared/schema";
import { getCachedRawPageSettings } from "../storage";

/**
 * Slug'и верхнего уровня из живого `site_config.categories_data`.
 *
 * Возвращает `null`, если кэш ещё холодный (контейнер только стартовал или
 * истекли 600 с): в этом случае нельзя отличить «категории нет» от «категорию
 * не успели прочитать», поэтому решение о 404 принимать нельзя.
 *
 * Нужен, чтобы неизвестный `/products/<slug>` (например, `/products/1C Import`,
 * оставшийся от старого импорта) отдавал 404, а не 200-оболочку с title главной.
 */
/**
 * 301 для легаси-адреса `/products?category=<slug>` → `/products/<slug>`.
 *
 * Параметрическая копия категории отвечает 200 и отдаёт canonical на /products,
 * конфликтуя с canonical самой категории. Редиректим ТОЛЬКО когда `category` —
 * единственный параметр запроса: адреса с фильтрами (`?category=…&size=…`,
 * `?category=…&sale=true`) не трогаем, чтобы не ломать работу фильтров (ТЗ п.2).
 *
 * Возвращает путь для редиректа или `null`, если редирект не нужен
 * (в т.ч. когда кэш категорий ещё холодный).
 */
export function legacyCategoryParamRedirect(url: string): string | null {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== "category") return null;
  const cat = (params.get("category") || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(cat)) return null;
  const known = knownCategorySlugs();
  if (!known || !known.has(cat)) return null;
  return `/products/${cat}`;
}

export function knownCategorySlugs(): Set<string> | null {
  const siteConfig = getCachedRawPageSettings("site_config");
  const raw = siteConfig?.categories_data;
  if (!raw) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const normalized = normalizeCategories(parsed as any);
  const slugs = Object.keys(normalized || {});
  return slugs.length > 0 ? new Set(slugs) : null;
}
