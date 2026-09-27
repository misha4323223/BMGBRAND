/**
 * Блог: чистые данные для SSR (bot-ssr / static / vite) и клиента.
 *
 * Источник данных — page settings `blog_pages` (полные статьи: seoTitle,
 * seoDescription, HTML-контент, картинка) поверх `home.blog.items`
 * (список карточек). Модуль без побочных эффектов — покрыт unit-тестами
 * (server/__tests__/blog-post.test.ts).
 */

const RUSSIAN_MONTHS: Record<string, string> = {
  "января": "01", "февраля": "02", "марта": "03", "апреля": "04",
  "мая": "05", "июня": "06", "июля": "07", "августа": "08",
  "сентября": "09", "октября": "10", "ноября": "11", "декабря": "12",
};

/** «24 сентября 2026» → «2026-09-24» (для JSON-LD). Невалидное значение — как есть. */
export function parseBlogDateRu(ruDate: string): string {
  const parts = String(ruDate || "").trim().split(" ");
  if (parts.length === 3) {
    const day = parts[0].padStart(2, "0");
    const month = RUSSIAN_MONTHS[parts[1].toLowerCase()];
    const year = parts[2];
    if (day && month && /^\d{4}$/.test(year)) return `${year}-${month}-${day}`;
  }
  return String(ruDate || "").trim();
}

/** id из URL /blog/{id}: только цифры, без мусора. null — если это не число. */
export function parseBlogIndex(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return parseInt(s, 10);
}

export interface BlogPostForSsr {
  id: number;
  title: string;
  date: string;
  dateIso: string;
  category: string;
  author: string;
  excerpt: string;
  image: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  productsVisible: boolean;
  productsTitle: string;
  productsCategory: string;
  productsSubcategory: string;
  linkedProducts: number[];
}

/** Убирает HTML-теги и лишние пробелы — для description/JSON-LD, если SEO-поля пустые. */
export function stripBlogHtml(html: string): string {
  return String(html || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Короткое описание статьи: seoDescription → excerpt → первые ~160 символов текста. */
export function blogDescriptionFor(post: BlogPostForSsr, max = 160): string {
  const direct = post.seoDescription || post.excerpt;
  if (direct) {
    const s = stripBlogHtml(direct);
    if (s.length <= max) return s;
    const cut = s.lastIndexOf(" ", max);
    return (cut > 60 ? s.slice(0, cut) : s.slice(0, max)) + "…";
  }
  const text = stripBlogHtml(post.content);
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return (cut > 60 ? text.slice(0, cut) : text.slice(0, max)) + "…";
}

/**
 * Статья для SSR по её id (индексу в blog_pages).
 * Возвращает null, если статьи нет, она скрыта или в ней нет контента —
 * вызывающий код должен отдать 404 + noindex, а не пустую оболочку.
 */
export function resolveBlogPostForSsr(
  blogPages: Record<string, any> | null | undefined,
  homeItems: any[] | null | undefined,
  index: number,
): BlogPostForSsr | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const raw = blogPages?.[String(index)];
  if (!raw || raw.visible === false) return null;

  const home = Array.isArray(homeItems) ? homeItems[index] : null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const title = str(raw.title) || str(home?.title);
  const content = typeof raw.content === "string" ? raw.content : "";
  if (!title || !content) return null;

  const date = str(raw.date) || str(home?.date);
  const image = str(raw.image) || str(home?.image);
  const linkedProducts = Array.isArray(raw.linkedProducts)
    ? raw.linkedProducts.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
    : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => str(t)).filter(Boolean) : [];

  return {
    id: index,
    title,
    date,
    dateIso: parseBlogDateRu(date),
    category: str(raw.category) || str(home?.category),
    author: str(raw.author) || "BOOOMERANGS Team",
    excerpt: str(raw.excerpt) || str(home?.excerpt),
    image,
    content,
    seoTitle: str(raw.seoTitle),
    seoDescription: str(raw.seoDescription),
    tags,
    productsVisible: raw.productsVisible === true,
    productsTitle: str(raw.productsTitle) || "Товары из статьи",
    productsCategory: str(raw.productsCategory),
    productsSubcategory: str(raw.productsSubcategory),
    linkedProducts,
  };
}

/** Заголовок страницы статьи: SEO-заголовок, иначе название + бренд. */
export function blogPageTitle(post: BlogPostForSsr): string {
  return post.seoTitle || `${post.title} — блог BOOOMERANGS`;
}

export interface BlogJsonLdOptions {
  /** Абсолютный URL статьи вида https://booomerangs.ru/blog/3 */
  url: string;
  siteUrl: string;
}

/** schema.org BlogPosting для страницы статьи. */
export function buildBlogPostJsonLd(post: BlogPostForSsr, opts: BlogJsonLdOptions): Record<string, any> {
  const image = post.image
    ? (post.image.startsWith("http") ? post.image : `${opts.siteUrl}${post.image}`)
    : `${opts.siteUrl}/og-image.png`;
  const jsonLd: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": blogDescriptionFor(post),
    "image": [image],
    "url": opts.url,
    "datePublished": post.dateIso,
    "dateModified": post.dateIso,
    "author": { "@type": "Organization", "name": post.author || "BOOOMERANGS" },
    "publisher": { "@type": "Organization", "@id": `${opts.siteUrl}/#organization`, "name": "BOOOMERANGS" },
    "mainEntityOfPage": { "@type": "WebPage", "@id": opts.url },
  };
  if (post.category) jsonLd.articleSection = post.category;
  if (post.tags.length > 0) jsonLd.keywords = post.tags.join(", ");
  return jsonLd;
}

/** Хлебные крошки «Главная → Блог → Статья». */
export function buildBlogBreadcrumbJsonLd(post: BlogPostForSsr, opts: BlogJsonLdOptions): Record<string, any> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Главная", "item": opts.siteUrl },
      { "@type": "ListItem", "position": 2, "name": "Блог", "item": `${opts.siteUrl}/blog` },
      { "@type": "ListItem", "position": 3, "name": post.title, "item": opts.url },
    ],
  };
}
