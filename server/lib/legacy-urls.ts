/**
 * Легаси-адреса старого сайта (WooCommerce, Tilda) и технические варианты
 * slug'ов товаров — единый резолвер для bot-SSR и обычной отдачи.
 *
 * Зачем: в Search Console висят сотни 404 из истории (`/product/:slug/`,
 * `/product-category/...`, `/wp-json/`, числовые ID, Tilda `tproduct`,
 * `-2/-3`, размерные хвосты `-34-39`, `№`/`_` в слагах). Каждый такой адрес
 * должен получать ровно ОДИН ответ: 301 на живую страницу или 410 Gone —
 * тогда Google убирает его из отчёта, а пользователь не видит тупик.
 *
 * Правила только детерминированные: жив ли товар — решает вызывающая сторона
 * через `productExists` (тёплый кэш, без запросов в YDB).
 */

export type LegacyDecision =
  | { status: 301; target: string; reason: string }
  | { status: 410; reason: string };

type ProductExists = (slug: string) => boolean;

/**
 * Страницы артистов, которые не должны попадать в индекс: технические
 * (`artist-<номер>`) и пустые (`vashana` — страница без контента и товаров).
 * Бот получает на них 410, sitemap/llms.txt их не перечисляют.
 */
export const HIDDEN_ARTIST_SLUGS: ReadonlySet<string> = new Set(["vashana"]);
const TECHNICAL_ARTIST_RE = /^artist-\d+$/;

export function isHiddenArtistSlug(slug: string): boolean {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return false;
  return HIDDEN_ARTIST_SLUGS.has(s) || TECHNICAL_ARTIST_RE.test(s);
}

/** Плоские легаси-разделы старого сайта → живая страница (301). */
export const LEGACY_FLAT_REDIRECTS: Record<string, string> = {
  main: "/",
  contacts: "/about",
  offer: "/terms",
  policy6: "/privacy",
  kurtki2: "/products/clothing/jackets",
  longsleeve: "/t-shirts",
  noski: "/products/socks",
  hudi: "/hoodies",
  bryuki: "/products/clothing/trousers",
  detskie: "/t-shirts",
  kruzhki: "/products/accessories",
  krossovki: "/products",
  "korotkie-34-39": "/products/socks",
  "klassicheskie-34-39": "/products/socks",
  "klassicheskie-40-45": "/products/socks",
  "sportivnye-34-39": "/products/socks",
  "sportivnye-40-45": "/products/socks",
  "sportivnye-34-39-2": "/products/socks",
  // Опечатка-сирота: подкатегория называется /t-shirts.
  "t-shirt": "/t-shirts",
};

/** Первая часть slug'а товара → ближайший живой раздел каталога. */
const PRODUCT_PREFIX_CATEGORY: ReadonlyArray<readonly [string, string]> = [
  ["noski", "/products/socks"],
  ["zip-hudi", "/hoodies"],
  ["hudi", "/hoodies"],
  ["svitshot", "/sweatshirts"],
  ["sviter", "/sweaters"],
  ["futbolka", "/t-shirts"],
  // "longsliv" сознательно нет: /longsliv — живой раздел (200), а не легаси.
  ["shorty", "/shorts"],
  ["bryuki", "/products/clothing/trousers"],
  ["dzhoggery", "/products/clothing/trousers"],
  ["kurtka", "/products/clothing/jackets"],
  ["anorak", "/products/clothing/jackets"],
  ["zhiletka", "/products/clothing/jackets"],
  ["olimpijka", "/products/clothing/jackets"],
  ["mantiya", "/products/clothing/jackets"],
  ["baff", "/products/accessories"],
  ["shapka", "/products/accessories/headwear"],
  ["panama", "/products/accessories/headwear"],
  ["shopper", "/products/accessories"],
  ["sumka", "/products/accessories"],
  ["ryukzak", "/products/accessories"],
  ["poyasnaya", "/products/accessories"],
  ["remen", "/products/accessories"],
  ["kejs", "/products/accessories"],
  ["derzhatel", "/products/accessories"],
  ["kruzhka", "/products/accessories"],
  ["stikerpak", "/products/accessories"],
  ["stikerpaki", "/products/accessories"],
  ["nashivka", "/products/accessories"],
  ["silikonovyj", "/products/accessories"],
  ["braslet", "/products/accessories"],
  ["aromatizator", "/products/accessories"],
  ["obrazec", "/products"],
];

/** Старые рубрики WooCommerce → каталог. */
const WP_CATEGORY_MAP: Record<string, string> = {
  noski: "/products/socks",
  "noski-2": "/products/socks",
  aksessuary: "/products/accessories",
  odezhda: "/products/clothing",
  clothes: "/products/clothing",
  merch: "/products/merch",
  sale: "/products/sale",
  rasprodazha: "/products/sale",
  "dikaya-myata": "/dikaya-myata",
};

/** Размерный хвост вариантов: -34-39, -40-45-2, -40-452st, -o-s. */
const SIZE_SUFFIX_RE = /-(?:34-39|40-45|29-33|o-s)(?:-?\d+)?(?:2st|2-st)?$/i;
/** Номер клона от повторного импорта: -2 … -9. */
const CLONE_SUFFIX_RE = /-[2-9]$/;
/** Числовые ID из старого импорта: /1782920232484. */
const NUMERIC_ID_RE = /^\/\d{6,}$/;

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function cleanSlug(raw: string): string {
  return raw
    .replace(/№/g, "-")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Варианты слага: как есть → без размера → без клона → без обоих. */
function slugCandidates(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  const cleaned = cleanSlug(raw);
  push(cleaned);
  const noSize = cleaned.replace(SIZE_SUFFIX_RE, "");
  push(noSize);
  const noClone = cleaned.replace(CLONE_SUFFIX_RE, "");
  push(noClone);
  push(noSize.replace(CLONE_SUFFIX_RE, ""));
  return out;
}

function categoryByProductPrefix(slug: string): string | null {
  for (const [prefix, target] of PRODUCT_PREFIX_CATEGORY) {
    if (slug === prefix || slug.startsWith(`${prefix}-`)) return target;
  }
  return null;
}

/** Служебный мусор старого CMS — 410, 301 тут не нужен. */
function isCmsJunk(lower: string): boolean {
  if (/^\/wp-(?:json|admin|login|content|includes|cron|comments-post|signup|trackback)/.test(lower)) return true;
  if (lower === "/wp-json" || lower === "/xmlrpc" || lower === "/xmlrpc.php") return true;
  if (/^\/(?:category|tag|author|product-tag|product-cat)\//.test(lower)) return true;
  if (lower === "/feed" || /\/feed$/.test(lower)) return true;
  return false;
}

/**
 * Легаси-раздел или технический вариант slug'а → решение 301/410.
 * `null` означает «это не легаси-адрес, обрабатывайте как обычно».
 */
export function resolveLegacyUrl(
  pathname: string,
  productExists: ProductExists,
): LegacyDecision | null {
  if (!pathname || !pathname.startsWith("/")) return null;
  // Вызывающие могут передать путь вместе с query/hash — работаем только с путём.
  const decoded = safeDecode(pathname).split("?")[0].split("#")[0];
  if (decoded === "/") return null;
  if (/^\/(?:api|assets|images|admin)(?:\/|$)/i.test(decoded)) return null;

  const path = decoded.replace(/\/+$/, "");
  if (!path) return null;
  const lower = path.toLowerCase();

  if (isCmsJunk(lower)) return { status: 410, reason: "cms-junk" };
  if (NUMERIC_ID_RE.test(lower)) return { status: 410, reason: "numeric-id" };

  // Старые рубрики WooCommerce: /product-category/noski-2/podarochnye-nabory/
  if (lower.startsWith("/product-category/")) {
    const seg = lower.slice("/product-category/".length).split("/")[0] || "";
    return { status: 301, target: WP_CATEGORY_MAP[seg] || "/products", reason: "wp-category" };
  }

  // Старый адрес товара WooCommerce: /product/:slug/ (+ ?add-to-cart, /feed/)
  if (lower.startsWith("/product/")) {
    const raw = path.slice("/product/".length).split("/")[0] || "";
    for (const candidate of slugCandidates(raw)) {
      if (productExists(candidate)) {
        return { status: 301, target: `/${candidate}`, reason: "woo-product" };
      }
    }
    const category = categoryByProductPrefix(cleanSlug(raw));
    if (category) return { status: 301, target: category, reason: "woo-product-category" };
    return { status: 410, reason: "woo-product-gone" };
  }

  // Tilda: /gift-sets/tproduct/763467710-277842192422-podarochnii-nabor-...
  if (lower.includes("/tproduct/")) {
    const tail = path.slice(lower.indexOf("/tproduct/") + "/tproduct/".length);
    const raw = tail.replace(/^(?:\d+-)+/, "");
    for (const candidate of slugCandidates(raw)) {
      if (productExists(candidate)) {
        return { status: 301, target: `/${candidate}`, reason: "tilda-product" };
      }
    }
    if (lower.startsWith("/gift-sets")) {
      return { status: 301, target: "/gift-cards", reason: "tilda-gift" };
    }
    return { status: 410, reason: "tilda-gone" };
  }

  // Дальше — только плоские адреса вида /slug.
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const rawSlug = segments[0];
  const slugLower = cleanSlug(rawSlug) || rawSlug.toLowerCase();

  if (LEGACY_FLAT_REDIRECTS[slugLower]) {
    return { status: 301, target: LEGACY_FLAT_REDIRECTS[slugLower], reason: "legacy-flat" };
  }

  // Живой товар (в том числе временно скрытый) не трогаем: у скрытого свой
  // ответ 404 «нет в наличии», иначе мы бы увели Google с вернувшегося товара.
  if (productExists(rawSlug)) return null;

  // Грязный слаг / размерный хвост / клон -2…-9 → живой товар.
  for (const candidate of slugCandidates(rawSlug)) {
    if (productExists(candidate)) {
      return { status: 301, target: `/${candidate}`, reason: "slug-alias" };
    }
  }

  // Мёртвый товар, но по префиксу понятен раздел: 301 на раздел вместо 404.
  const category = categoryByProductPrefix(slugLower);
  if (category) return { status: 301, target: category, reason: "product-prefix" };

  return null;
}
