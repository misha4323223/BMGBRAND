/**
 * Единый генератор JSON-LD для карточек товара.
 *
 * Согласовано 2026-09-23 (ТЗ «Автоматическая генерация товарной микроразметки JSON-LD»):
 * - на странице РОВНО один самостоятельный объект Product (без ProductGroup/hasVariant);
 * - связь цветовых вариантов — `inProductGroupWithID` (общий артикул модели,
 *   у всех цветов одной модели он одинаковый);
 * - `sku` уникален для каждой карточки: берём артикул карточки (product.article),
 *   а если его нет — генерируем из артикула модели и ID товара (`MODEL-ID`);
 * - `url` выводится ТОЛЬКО внутри `offers.url` (адрес текущей карточки);
 * - `brand.name` всегда BOOOMERANGS;
 * - `offers.price` — фактическая розничная цена числом: фиксированная цена со
 *   скидкой (salePrice) → общая скидка (discountPercent) / скидка выбранного
 *   размера (sizeDiscounts) → обычная розничная цена. Оптовую цену не берём;
 * - `availability`: PreOrder (приоритет, если включён предзаказ) → InStock →
 *   OutOfStock. Если у товара есть складские варианты (sizeStock/stockBySize),
 *   общий остаток = сумма остатков вариантов, иначе — общий stock;
 * - `seller` / `hasMerchantReturnPolicy` / `shippingDetails` в карточке НЕ выводим
 *   (их место — общая разметка Organization, отдельной задачей);
 * - `priceValidUntil` не выводим: подставлять условную дату нельзя.
 *
 * Ручное переопределение из админки (поле «SEO микроразметка JSON-LD») отключено
 * (см. MANUAL_PRODUCT_JSONLD_ENABLED ниже). Старые записи остаются в БД как архив.
 *
 * Модуль чистый (без Node/DOM API): его импортируют server/bot-ssr.ts,
 * server/static.ts, server/vite.ts и client/src/pages/ProductDetail.tsx —
 * все поверхности обязаны отдавать одинаковую разметку.
 */

/**
 * Ручное переопределение JSON-LD из карточки товара выключено с 2026-09-23
 * (89 старых записей остаются в БД как архив и на сайте не выводятся).
 * Если переопределение понадобится снова — включать отдельным переключателем
 * и ПОЛНОСТЬЮ заменять автоматическую разметку, а не объединять с ней:
 * иначе на странице окажется два объекта Product с разными данными.
 */
export const MANUAL_PRODUCT_JSONLD_ENABLED = false;

export const PRODUCT_JSONLD_BRAND = "BOOOMERANGS";

const SCHEMA_IN_STOCK = "https://schema.org/InStock";
const SCHEMA_OUT_OF_STOCK = "https://schema.org/OutOfStock";
const SCHEMA_PREORDER = "https://schema.org/PreOrder";
const SCHEMA_NEW_CONDITION = "https://schema.org/NewCondition";

export interface ProductJsonLdSpec {
  name: string;
  value: string;
}

export interface ProductJsonLdReview {
  authorName?: string | null;
  rating: number;
  comment?: string | null;
  createdAt?: string | null;
}

export interface ProductJsonLdRating {
  ratingValue: number | string;
  reviewCount: number;
}

export interface ProductJsonLdInput {
  /** ID товара в БД — нужен для генерации уникального sku, если нет артикула. */
  id?: string | number | null;
  /** Обычное название товара. */
  name?: string | null;
  /** SEO название (seoTitle). Предпочитается, если заполнено. */
  seoName?: string | null;
  /** Основное описание товара. */
  description?: string | null;
  /** Краткое описание (если появится в модели). */
  shortDescription?: string | null;
  /** SEO описание. Предпочитается, если заполнено. */
  seoDescription?: string | null;
  /** Изображения: главное — первым. Относительные пути абсолютизируются через siteUrl. */
  images?: Array<string | null | undefined> | null;
  /** Корень сайта (https://booomerangs.ru) — для абсолютизации относительных путей. */
  siteUrl?: string | null;
  /** Полный URL текущей карточки → offers.url (единственное место, где выводится url). */
  url?: string | null;
  /** Индивидуальный артикул карточки (product.article). */
  sku?: string | null;
  /** Общий артикул модели (product.sku): одинаков у всех цветов → inProductGroupWithID. */
  modelSku?: string | null;
  /** Цвет текущего варианта (поле «Цвет» карточки). */
  color?: string | null;
  /** Категория: готовая строка или части пути (соединяются через « > »). */
  category?: string | Array<string | null | undefined> | null;
  /** Размеры товара (S/M/L…, 40-45…) → additionalProperty «Размер». */
  sizes?: string[] | null;
  /** HTML характеристик (specsHtml) → отдельные PropertyValue. */
  specsHtml?: string | null;
  /** Состав из карточки. */
  composition?: string | null;
  /** Уход из карточки. */
  careInstructions?: string | null;
  /** Таблица размеров (мерки). */
  measurements?: Array<Record<string, unknown>> | null;
  /** SEO-текст карточки (seoBody) → additionalProperty «Подробнее о товаре». */
  seoBody?: string | null;
  /** Дополнительные характеристики, которых нет в перечисленных полях (бейджи и т.п.). */
  extraCharacteristics?: ProductJsonLdSpec[] | null;
  /** Базовая розничная цена в копейках. */
  price?: number | null;
  /** Фиксированная цена со скидкой в копейках (имеет приоритет). */
  salePrice?: number | null;
  /** Общая скидка на товар, %. */
  discountPercent?: number | null;
  /** Скидки по размерам, % (применяются только к выбранному размеру). */
  sizeDiscounts?: Record<string, number> | null;
  /** Выбранный размер (только если страница реально показывает цену этого размера). */
  size?: string | null;
  /** Общий остаток товара. */
  stock?: number | null;
  /** Остатки по размерам/вариантам: сумма считается по значениям. */
  stockBySize?: Record<string, number> | null;
  /** Товар доступен по предзаказу — приоритетнее расчёта остатка. */
  preorder?: boolean | null;
  /** Агрегированный рейтинг карточки (только если есть настоящие отзывы). */
  aggregateRating?: ProductJsonLdRating | null;
  /** Отзывы карточки. */
  reviews?: ProductJsonLdReview[] | null;
  /** Дата публикации карточки (YYYY-MM-DD). */
  datePublished?: string | null;
  /** Дата последнего изменения карточки (YYYY-MM-DD). */
  dateModified?: string | null;
}

export interface BuildProductJsonLdOptions {
  /** Колбэк для записи ошибки, когда обязательных данных не хватает. */
  onError?: (message: string) => void;
}

/** Удаляет HTML-теги и нормализует пробелы (описания, состав, SEO-блоки). */
export function stripHtmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Разбирает specsHtml вида `<li><b>Название:</b> значение</li>` на пары
 * «Имя → Значение» — отдельные PropertyValue, которые Яндекс/Google показывают
 * строками. Если разобрать нечего (произвольный HTML) — пустой массив.
 */
export function parseSpecPairs(html: string): ProductJsonLdSpec[] {
  const pairs: ProductJsonLdSpec[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const li = m[1].trim();
    if (!li) continue;
    let name = "";
    let value = "";
    const bm = li.match(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>[\s:]*([\s\S]*)/i);
    if (bm) {
      name = stripHtmlText(bm[1]);
      value = stripHtmlText(bm[2]);
    } else {
      const text = stripHtmlText(li);
      const ci = text.indexOf(":");
      if (ci <= 0) continue;
      name = text.slice(0, ci);
      value = text.slice(ci + 1);
    }
    name = name.replace(/^[-–—\s:]+/, "").replace(/[:：\s]+$/, "").replace(/\s+/g, " ").trim();
    value = value.replace(/^[:：,\s]+/, "").replace(/\s+/g, " ").trim();
    if (name && value) pairs.push({ name, value });
    if (pairs.length >= 30) break;
  }
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Убирает служебный хвост SEO-заголовка («— купить», «| купить BMGBRAND»),
 * чтобы в Product.name попало имя товара, а не браузерный title.
 */
function cleanSeoName(value: string): string {
  let s = value.trim();
  let changed = true;
  while (changed && s) {
    changed = false;
    const brand = s.match(/\s*[|•]\s*(?:купить\s+)?(?:bmgbrand|booomerangs)\s*$/i);
    if (brand) {
      s = s.slice(0, brand.index).trim();
      changed = true;
      continue;
    }
    const cta = s.match(/\s*[-–—,]\s*купить\s*$/i);
    if (cta) {
      s = s.slice(0, cta.index).trim();
      changed = true;
    }
  }
  return s;
}

/** Абсолютные HTTPS-ссылки без дублей и миниатюр; главное фото — первым. */
export function normalizeImages(
  images: Array<string | null | undefined> | null | undefined,
  siteUrl?: string | null,
): string[] {
  const origin = (siteUrl || "").replace(/\/+$/, "");
  const out: string[] = [];
  for (const raw of Array.isArray(images) ? images : []) {
    if (typeof raw !== "string") continue;
    let value = raw.trim();
    if (!value) continue;
    if (value.startsWith("//")) value = `https:${value}`;
    else if (value.startsWith("/") && origin) value = `${origin}${value}`;
    if (!value.startsWith("https://")) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Фактическая розничная цена в копейках (розничная ветка resolveItemPrice
 * из server/lib/pricing.ts — держать в синхроне). Оптовые цены не участвуют.
 */
export function resolveRetailPriceKopeks(input: {
  price?: number | null;
  salePrice?: number | null;
  discountPercent?: number | null;
  sizeDiscounts?: Record<string, number> | null;
  size?: string | null;
}): number {
  const base = toFiniteNumber(input.price) ?? 0;
  if (base <= 0) return 0;

  const sale = toFiniteNumber(input.salePrice);
  if (sale != null && sale > 0 && sale < base) return Math.round(sale);

  const sizeDiscount =
    input.size && input.sizeDiscounts
      ? toFiniteNumber(input.sizeDiscounts[input.size])
      : null;
  const discount = sizeDiscount ?? toFiniteNumber(input.discountPercent);
  if (discount != null && discount > 0) {
    return Math.round(base * (1 - discount / 100));
  }
  return base;
}

/**
 * Наличие: предзаказ имеет приоритет; иначе остаток = сумма остатков
 * складских вариантов (если они есть), а не общий stock.
 */
export function resolveAvailability(input: {
  preorder?: boolean | null;
  stock?: number | null;
  stockBySize?: Record<string, number> | null;
}): string {
  if (input.preorder === true) return SCHEMA_PREORDER;
  const map = input.stockBySize;
  let total: number | null = null;
  if (map && typeof map === "object" && Object.keys(map).length > 0) {
    total = Object.values(map).reduce(
      (sum, v) => sum + (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0),
      0,
    );
  }
  const stock = total != null ? total : (toFiniteNumber(input.stock) ?? 0);
  return stock > 0 ? SCHEMA_IN_STOCK : SCHEMA_OUT_OF_STOCK;
}

/** Уникальный артикул карточки: article → «MODEL-ID» → ID → артикул модели. */
export function resolveCardSku(input: {
  id?: string | number | null;
  sku?: string | null;
  modelSku?: string | null;
}): string {
  const article = String(input.sku ?? "").trim();
  if (article) return article;
  const model = String(input.modelSku ?? "").trim();
  const id = input.id != null ? String(input.id).trim() : "";
  if (model && id) return `${model}-${id}`;
  return model || id;
}

export function buildCategoryPath(
  category: string | Array<string | null | undefined> | null | undefined,
): string {
  const parts = Array.isArray(category) ? category : [category];
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" > ");
}

function buildCharacteristics(input: ProductJsonLdInput): ProductJsonLdSpec[] {
  const props: ProductJsonLdSpec[] = [];
  const seen = new Set<string>();
  const push = (name: unknown, value: unknown) => {
    const n = String(name ?? "").trim();
    const v = String(value ?? "").trim();
    if (!n || !v) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    props.push({ name: n, value: v });
  };

  const specs = input.specsHtml ? parseSpecPairs(input.specsHtml) : [];

  const sizes = (Array.isArray(input.sizes) ? input.sizes : [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
  if (sizes.length > 0) push("Размер", sizes.join(", "));

  for (const pair of specs) push(pair.name, pair.value);

  const composition = stripHtmlText(input.composition);
  const care = stripHtmlText(input.careInstructions);
  const specsHaveComposition = specs.some((p) => p.name.toLowerCase() === "состав");
  const specsHaveCare = specs.some((p) => p.name.toLowerCase().startsWith("уход"));
  if (composition && !specsHaveComposition) push("Состав", composition);
  if (care && !specsHaveCare) push("Уход", care);

  if (specs.length === 0 && input.specsHtml) {
    push("Характеристики", stripHtmlText(input.specsHtml));
  }

  const measurements = Array.isArray(input.measurements) ? input.measurements : [];
  if (measurements.length > 0) {
    const text = measurements
      .map((row) =>
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", "),
      )
      .join(" | ");
    push("Таблица размеров", text);
  }

  if (input.seoBody) push("Подробнее о товаре", stripHtmlText(input.seoBody));

  for (const extra of Array.isArray(input.extraCharacteristics) ? input.extraCharacteristics : []) {
    if (extra) push(extra.name, extra.value);
  }

  return props;
}

function pruneEmptyFields(object: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(object)) {
    const value = object[key];
    if (
      value === "" ||
      value === null ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete object[key];
    }
  }
  return object;
}

/**
 * Собирает объект Product в формате schema.org.
 * Возвращает null (и зовёт onError), если нет обязательных name / image / price —
 * заведомо неполный объект на страницу не выводится.
 */
export function buildProductJsonLd(
  input: ProductJsonLdInput,
  options: BuildProductJsonLdOptions = {},
): Record<string, any> | null {
  const name = cleanSeoName(stripHtmlText(input.seoName)) || stripHtmlText(input.name);
  const images = normalizeImages(input.images, input.siteUrl);
  const sku = resolveCardSku(input);
  const priceKopeks = resolveRetailPriceKopeks(input);

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (images.length === 0) missing.push("image");
  if (priceKopeks <= 0) missing.push("offers.price");
  if (missing.length > 0) {
    options.onError?.(
      `Product JSON-LD: отсутствуют обязательные данные (${missing.join(", ")}), SKU ${sku || "не указан"}`,
    );
    return null;
  }

  const specs = input.specsHtml ? parseSpecPairs(input.specsHtml) : [];
  const material =
    stripHtmlText(specs.find((p) => p.name.toLowerCase() === "состав")?.value) ||
    stripHtmlText(input.composition) ||
    stripHtmlText(specs.find((p) => p.name.toLowerCase() === "материал")?.value);

  const modelSku = String(input.modelSku ?? "").trim();
  const category = buildCategoryPath(input.category);
  const characteristics = buildCharacteristics(input);

  const offers: Record<string, any> = {
    "@type": "Offer",
    price: Math.round(priceKopeks) / 100,
    priceCurrency: "RUB",
    availability: resolveAvailability(input),
    itemCondition: SCHEMA_NEW_CONDITION,
    url: input.url ? String(input.url).trim() : "",
  };

  const rating = input.aggregateRating;
  const reviews = (Array.isArray(input.reviews) ? input.reviews : [])
    .filter((r) => r && toFiniteNumber(r.rating) != null)
    .map((r) => {
      const review: Record<string, any> = {
        "@type": "Review",
        author: { "@type": "Person", name: stripHtmlText(r.authorName) || "Покупатель" },
        reviewRating: {
          "@type": "Rating",
          ratingValue: toFiniteNumber(r.rating) ?? 0,
          bestRating: 5,
          worstRating: 1,
        },
      };
      const comment = stripHtmlText(r.comment);
      if (comment) review.reviewBody = comment;
      if (r.createdAt) review.datePublished = String(r.createdAt).split("T")[0];
      return review;
    });

  const result: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    image: images,
    description: stripHtmlText(input.seoDescription || input.shortDescription || input.description),
    sku,
    brand: { "@type": "Brand", name: PRODUCT_JSONLD_BRAND },
    inProductGroupWithID: modelSku,
    color: stripHtmlText(input.color),
    material,
    category,
    additionalProperty: characteristics.map((p) => ({
      "@type": "PropertyValue",
      name: p.name,
      value: p.value,
    })),
    offers,
    datePublished: input.datePublished ? String(input.datePublished).split("T")[0] : "",
    dateModified: input.dateModified ? String(input.dateModified).split("T")[0] : "",
    aggregateRating:
      rating && toFiniteNumber(rating.reviewCount) && Number(rating.reviewCount) >= 1
        ? {
            "@type": "AggregateRating",
            ratingValue: toFiniteNumber(rating.ratingValue) ?? undefined,
            reviewCount: Number(rating.reviewCount),
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
    review: reviews,
  };

  pruneEmptyFields(result);
  pruneEmptyFields(offers);
  return result;
}

/** JSON.stringify с экранированием `<`, `>`, `&` и U+2028/U+2029 — безопасно для `<script>`. */
export function serializeJsonLd(value: unknown, options: { pretty?: boolean } = {}): string {
  const json = options.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Готовый JSON-LD строкой или null, если обязательных данных не хватает. */
export function serializeProductJsonLd(
  input: ProductJsonLdInput,
  options: BuildProductJsonLdOptions = {},
): string | null {
  const built = buildProductJsonLd(input, options);
  return built ? serializeJsonLd(built, { pretty: true }) : null;
}
