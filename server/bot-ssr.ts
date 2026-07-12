/**
 * SSR middleware for search engine and AI crawlers.
 *
 * Serves real visible HTML to bots (not <noscript> wrappers) so that
 * Yandex, GPTBot, ClaudeBot and other non-JS crawlers can index the site.
 *
 * Rules:
 *  - Only fires on GET requests from known bots (User-Agent detection).
 *  - NEVER makes YDB calls — reads only from warm in-memory caches.
 *  - Has its own 5-min in-memory cache so every bot hit doesn't regenerate HTML.
 *  - If cache is empty (server just started) it passes through to normal serving.
 *  - Gracefully falls through on any error — humans always get the React app.
 */

import { Request, Response, NextFunction } from "express";
import {
  getCachedProductMetaBySlug,
  getCachedProductsByCategory,
  getCachedAllVisibleProducts,
  getCachedRatingByProductId,
  getCachedProductsForRecommendations,
  getCachedReviewsByProductId,
  getCachedProductsForVariantMatching,
} from "./storage";
import { getRecommendationsSync } from "./recommendations";
import { findProductVariantsSync } from "./variant-matching";

// ─── Bot User-Agent detection ─────────────────────────────────────────────────
// Only include server-side crawlers and link-preview fetchers.
// Deliberately excludes in-app browsers (WhatsApp WebView, Instagram, etc.)
// that contain browser keywords — those are real users who need the React app.
const BOT_UA_PATTERNS: RegExp[] = [
  // Google
  /googlebot/i, /google-inspectiontool/i, /google-extended/i, /googleother/i,
  // Yandex
  /yandexbot/i, /yandexmobilebot/i, /yandeximages/i, /yandeximageresizer/i,
  // Bing / Microsoft
  /bingbot/i, /msnbot/i, /bingpreview/i, /adidxbot/i,
  // AI crawlers — server-only, never user browsers
  /gptbot/i, /chatgpt-user/i, /oai-searchbot/i,
  /claudebot/i, /anthropic-ai/i,
  /perplexitybot/i,
  /applebot/i,
  /youbot/i, /duckassistbot/i,
  // Mail.ru
  /mail\.ru_bot/i,
  // Social link-preview fetchers (server-side, not in-app browsers)
  /facebookexternalhit/i, /facebookcatalog/i,
  /twitterbot/i, /linkedinbot/i, /telegrambot/i,
  /vkshare/i,
  // NOTE: "whatsapp" intentionally omitted — WhatsApp in-app browser is a real
  // user browser; link previews use facebookexternalhit which is already above.
  // SEO & audit tools
  /semrushbot/i, /ahrefsbot/i, /dotbot/i, /mj12bot/i, /rogerbot/i,
  /screaming.?frog/i, /slurp/i, /baiduspider/i, /diffbot/i,
];

export function isBot(ua: string): boolean {
  return BOT_UA_PATTERNS.some(p => p.test(ua));
}

// ─── Tiny in-memory cache for rendered bot pages ──────────────────────────────
interface BotCacheEntry { html: string; ts: number }
const botCache = new Map<string, BotCacheEntry>();
const BOT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BOT_CACHE_MAX = 500;              // max cached paths

function botCacheGet(key: string): string | null {
  const entry = botCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > BOT_CACHE_TTL_MS) { botCache.delete(key); return null; }
  return entry.html;
}

function botCacheSet(key: string, html: string): void {
  if (botCache.size >= BOT_CACHE_MAX) {
    // Evict the oldest entry
    const firstKey = botCache.keys().next().value;
    if (firstKey) botCache.delete(firstKey);
  }
  botCache.set(key, { html, ts: Date.now() });
}

// ─── Static site data (mirrors server/static.ts — kept in sync manually) ─────
const SITE_NAME = "BMGBRAND";
const SITE_URL = (process.env.SITE_URL || "https://booomerangs.ru").replace(/\/$/, "");

const CATEGORIES: Record<string, { name: string; title?: string; desc: string }> = {
  clothing:    { name: "Одежда",                    desc: "Купить одежду с авторскими принтами BMGBRAND — худи, свитшоты, футболки, шорты. Доставка по всей России." },
  merch:       { name: "Мерч",                      desc: "Купить официальный мерч артистов BMGBRAND — одежда и аксессуары с уникальными принтами. Доставка по всей России." },
  socks:       {
    name: "Необычные носки с принтом",
    title: "Купить необычные носки с принтом — прикольные носки с мемами | BMGBRAND",
    desc: "Купить необычные носки с принтом BOOOMERANGS: оригинальные носки с мемами, прикольные авторские рисунки, носки хорошего качества — хлопок 75%. Большой выбор принтов. Доставка по всей России СДЭК и Яндекс Доставкой.",
  },
  accessories: { name: "Аксессуары",                desc: "Купить аксессуары BMGBRAND — шапки, сумки, ремни и другие аксессуары. Доставка по всей России." },
  sale:        { name: "Распродажа",                desc: "Распродажа BMGBRAND — выгодные цены на одежду и аксессуары. Доставка по всей России." },
};

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function price(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString("ru-RU") + "\u00a0₽";
}

// Safe JSON-LD serialization: user-generated text (review comments, author
// names) flows into these objects, so raw JSON.stringify output must be
// neutralized against </script> breakout and U+2028/U+2029 line separators
// before being embedded inside a <script type="application/ld+json"> tag.
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#F0EDE8;color:#1C1C1C;line-height:1.5}
a{color:#1C1C1C;text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:1280px;margin:0 auto;padding:0 1rem}
header{background:#1C1C1C;color:#fff;padding:1rem 0}
header a{color:#fff}
nav{display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center}
.logo{font-weight:900;font-size:1.25rem;letter-spacing:2px;text-transform:uppercase}
main{padding:2rem 0}
h1{font-size:2rem;font-weight:900;margin-bottom:1rem;text-transform:uppercase;letter-spacing:1px}
h2{font-size:1.3rem;font-weight:700;margin:1.5rem 0 .75rem;text-transform:uppercase;letter-spacing:.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin:.75rem 0}
.card{background:#fff;border-radius:8px;padding:1rem}
.card .name{font-weight:600;margin-bottom:.25rem;font-size:.95rem}
.card .price{font-size:1.05rem;font-weight:700}
.card .status{font-size:.8rem;color:#666;margin-top:.25rem}
.cats{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0}
.cat-link{display:inline-block;padding:.5rem 1rem;background:#1C1C1C;color:#fff!important;border-radius:4px;font-weight:600;text-transform:uppercase;font-size:.875rem}
.cat-link:hover{background:#333;text-decoration:none!important}
.desc{color:#555;margin-bottom:1.5rem;max-width:720px;font-size:.95rem}
.breadcrumb{font-size:.85rem;color:#888;margin-bottom:1.25rem}
.breadcrumb a{color:#888}
.product-images{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0 1.5rem}
.product-images img{width:200px;height:200px;object-fit:cover;border-radius:6px}
.buy-btn{display:inline-block;padding:.75rem 2rem;background:#1C1C1C;color:#fff!important;border-radius:4px;font-weight:700;margin-top:1rem;font-size:1rem}
.buy-btn:hover{background:#333;text-decoration:none!important}
.recs{margin-top:2rem}
.recs ul{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem;margin-top:.75rem}
.recs li a{font-weight:600}
.recs li .rprice{font-size:.9rem;color:#444}
footer{background:#1C1C1C;color:#999;padding:2rem 0;margin-top:3rem;font-size:.875rem}
footer a{color:#999}footer p+p{margin-top:.5rem}
.rating{color:#888;font-size:.9rem;margin-top:.35rem}
.variants{margin-top:2rem}
.variants ul{list-style:none;display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.75rem}
.variants li a{display:flex;flex-direction:column;align-items:center;gap:.35rem;font-size:.85rem;font-weight:600}
.variants li img{border-radius:6px;object-fit:cover}
.reviews{margin-top:2rem}
.review{background:#fff;border-radius:8px;padding:1rem;margin-top:.75rem}
.review-head{font-size:.9rem;color:#333}
.review-date{color:#999;font-size:.8rem}
.review-text{margin-top:.5rem;color:#333;font-size:.95rem}
.in-stock{color:#2a7a2a}
.preorder{color:#c47000}
.out-of-stock{color:#888}
`.trim();

function baseHead(opts: {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType?: string;
  jsonLd?: string;
}): string {
  const { title, description, canonical, ogImage, ogType = "website", jsonLd } = opts;
  const t = esc(title);
  const d = esc(description.slice(0, 220));
  return [
    `  <meta charset="UTF-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `  <title>${t}</title>`,
    `  <meta name="description" content="${d}">`,
    `  <meta name="robots" content="index, follow">`,
    `  <link rel="canonical" href="${esc(canonical)}">`,
    `  <meta property="og:type" content="${esc(ogType)}">`,
    `  <meta property="og:title" content="${t}">`,
    `  <meta property="og:description" content="${d}">`,
    `  <meta property="og:image" content="${esc(ogImage)}">`,
    `  <meta property="og:locale" content="ru_RU">`,
    `  <meta property="og:site_name" content="Booomerangs">`,
    `  <link rel="icon" type="image/png" href="/favicon.png">`,
    jsonLd ? `  <script type="application/ld+json">${jsonLd}</script>` : "",
    `  <style>${CSS}</style>`,
  ].filter(Boolean).join("\n");
}

function navHtml(): string {
  return `<header>
  <div class="container">
    <nav>
      <a href="/" class="logo">Booomerangs</a>
      <a href="/products">Каталог</a>
      <a href="/products/socks">Носки</a>
      <a href="/products/clothing">Одежда</a>
      <a href="/products/accessories">Аксессуары</a>
      <a href="/merch-na-zakaz">Мерч на заказ</a>
    </nav>
  </div>
</header>`;
}

function footerHtml(): string {
  return `<footer>
  <div class="container">
    <p>© ${new Date().getFullYear()} BMGBRAND (Booomerangs). Все права защищены.</p>
    <p><a href="https://vk.com/bmgbrand">ВКонтакте</a> · <a href="https://t.me/bmg_booomerangs">Telegram</a> · <a href="mailto:info@booomerangs.ru">info@booomerangs.ru</a></p>
    <p><a href="/products">Каталог</a> · <a href="/about">О бренде</a> · <a href="/faq">Вопросы и ответы</a> · <a href="/contacts">Контакты</a> · <a href="/merch-na-zakaz">Мерч на заказ</a></p>
  </div>
</footer>`;
}

function wrapPage(head: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
${head}
</head>
<body>
${navHtml()}
<main>
  <div class="container">
${body}
  </div>
</main>
${footerHtml()}
</body>
</html>`;
}

// ─── Route renderers ──────────────────────────────────────────────────────────

function renderHome(): string | null {
  const products = getCachedAllVisibleProducts(24);
  // If cache is still warming — pass through to React SPA
  if (products.length === 0) return null;
  const inStock = products.filter(p => p.stock > 0).slice(0, 12);

  const catLinks = Object.entries(CATEGORIES)
    .map(([slug, cat]) => `<a href="/products/${slug}" class="cat-link">${esc(cat.name)}</a>`)
    .join("\n");

  const cards = inStock.map(p => `
    <div class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status in-stock">в наличии</div>
    </div>`).join("\n");

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": SITE_NAME,
      "alternateName": "Booomerangs",
      "description": "Официальный магазин мерча российского бренда одежды и аксессуаров BMGBRAND.",
      "url": SITE_URL,
      "logo": `${SITE_URL}/favicon.png`,
      "sameAs": ["https://vk.com/bmgbrand", "https://t.me/bmg_booomerangs"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Booomerangs",
      "url": `${SITE_URL}/`,
      "potentialAction": {
        "@type": "SearchAction",
        "target": `${SITE_URL}/products?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ]);

  const head = baseHead({
    title: `Официальный сайт бренда Booomerangs | ${SITE_NAME}`,
    description: "Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России.",
    canonical: `${SITE_URL}/`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<h1>BOOOMERANGS — официальный магазин бренда BMGBRAND</h1>
<p class="desc">Российский бренд одежды с авторскими принтами из Тулы. Худи, свитшоты, футболки, носки и аксессуары. Делаем вещи, которые носим сами. Доставка по всей России СДЭК и Яндекс Доставкой.</p>
<h2>Категории товаров</h2>
<div class="cats">${catLinks}</div>
${inStock.length > 0 ? `<h2>Популярные товары</h2><div class="grid">${cards}</div>` : ""}
<p style="margin-top:1.5rem"><a href="/products">Смотреть весь каталог →</a></p>`;

  return wrapPage(head, body);
}

function renderCatalog(): string | null {
  const products = getCachedAllVisibleProducts(80);
  // If cache is still warming — pass through to React SPA
  if (products.length === 0) return null;
  const catGroups: Record<string, typeof products> = {};
  for (const p of products) {
    if (!catGroups[p.category]) catGroups[p.category] = [];
    catGroups[p.category].push(p);
  }

  const catBlocks = Object.entries(CATEGORIES).map(([slug, cat]) => {
    const catProducts = catGroups[slug] || [];
    if (catProducts.length === 0) return "";
    const items = catProducts.slice(0, 8).map(p =>
      `<div class="card"><div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div><div class="price">${price(p.price)}</div><div class="status">${p.stock > 0 ? "в наличии" : "под заказ"}</div></div>`
    ).join("\n");
    return `<h2><a href="/products/${slug}">${esc(cat.name)}</a> <span style="font-size:.75rem;font-weight:400;text-transform:none;color:#888">(${catProducts.length} тов.)</span></h2><div class="grid">${items}</div>`;
  }).filter(Boolean).join("\n");

  const jsonLd = safeJsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
      { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
    ],
  });

  const head = baseHead({
    title: `Каталог — одежда и аксессуары | ${SITE_NAME}`,
    description: "Каталог BMGBRAND — одежда с авторскими принтами, мерч артистов, носки, аксессуары. Доставка по всей России.",
    canonical: `${SITE_URL}/products`,
    ogImage: `${SITE_URL}/favicon.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Каталог</div>
<h1>Каталог BOOOMERANGS</h1>
<p class="desc">Официальный магазин бренда BMGBRAND. Доставка по всей России.</p>
${catBlocks || "<p>Товары загружаются...</p>"}`;

  return wrapPage(head, body);
}

function renderCategory(catSlug: string): string | null {
  const cat = CATEGORIES[catSlug];
  if (!cat) return null;

  const products = getCachedProductsByCategory(catSlug, 80);
  // If cache is still warming, pass through to the React app
  if (products.length === 0) return null;

  const inStock = products.filter(p => p.stock > 0);
  const outOfStock = products.filter(p => p.stock === 0);
  const allSorted = [...inStock, ...outOfStock];

  const cards = allSorted.map(p => `
    <div class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status ${p.stock > 0 ? "in-stock" : "out-of-stock"}">${p.stock > 0 ? "в наличии" : "под заказ"}</div>
    </div>`).join("\n");

  const title = cat.title || `${cat.name} — купить в BMGBRAND | ${SITE_NAME}`;
  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
        { "@type": "ListItem", "position": 3, "name": cat.name, "item": `${SITE_URL}/products/${catSlug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": cat.name,
      "description": cat.desc,
      "url": `${SITE_URL}/products/${catSlug}`,
      "numberOfItems": allSorted.length,
      "itemListElement": allSorted.map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": {
          "@type": "Product",
          "name": p.name,
          "url": `${SITE_URL}/${p.slug}`,
          "offers": {
            "@type": "Offer",
            "priceCurrency": "RUB",
            "price": (p.price / 100).toFixed(2),
            "availability": p.stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          },
        },
      })),
    },
  ]);

  const head = baseHead({
    title,
    description: cat.desc,
    canonical: `${SITE_URL}/products/${catSlug}`,
    ogImage: `${SITE_URL}/favicon.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / ${esc(cat.name)}</div>
<h1>${esc(cat.name)}</h1>
<p class="desc">${esc(cat.desc)}</p>
<p style="margin-bottom:1rem;color:#888;font-size:.9rem">Всего товаров: <strong>${products.length}</strong>. В наличии: <strong>${inStock.length}</strong>.</p>
<div class="grid">${cards}</div>`;

  return wrapPage(head, body);
}

/**
 * Check whether a product slug is publicly visible.
 * Uses the same filter as getCachedAllVisibleProducts: !isHidden && !artistOnly && price > 0.
 * getCachedProductsForRecommendations already applies exactly this filter with a limit of 2000,
 * which is sufficient for the full catalog (~825 products at time of writing).
 */
function isPublicProduct(slug: string): boolean {
  const visibleProducts = getCachedProductsForRecommendations(2000);
  return visibleProducts.some(p => p.slug === slug);
}

function renderProduct(slug: string): string | null {
  // Guard: only render publicly visible products (not isHidden, not artistOnly)
  if (!isPublicProduct(slug)) return null;

  const meta = getCachedProductMetaBySlug(slug);
  if (!meta || !meta.title) return null;

  const isMerch = ["merch", "мерч"].includes((meta.category || "").toLowerCase());
  const title = meta.seoTitle || `${meta.title}${isMerch ? " — купить мерч" : " — купить"} | ${SITE_NAME}`;
  const desc = meta.seoDescription || [
    isMerch ? `Купить мерч ${meta.title} BOOOMERANGS` : `Купить ${meta.title} BOOOMERANGS`,
    meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "",
    "Доставка по России СДЭК и Яндекс Доставкой.",
    meta.description ? meta.description.slice(0, 80) : "",
  ].filter(Boolean).join(" ").slice(0, 220);

  const statusCls = meta.preorderEnabled ? "preorder" : meta.stock > 0 ? "in-stock" : "out-of-stock";
  const statusText = meta.preorderEnabled ? "предзаказ" : meta.stock > 0 ? "в наличии" : "нет в наличии";
  const availability = meta.preorderEnabled
    ? "https://schema.org/PreOrder"
    : meta.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const rating = getCachedRatingByProductId(meta.productId);
  const priceValidUntil = new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    .toISOString().split("T")[0];

  const productSchema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": meta.title,
    "description": desc,
    "image": meta.images.length > 0 ? meta.images.slice(0, 6) : (meta.image ? [meta.image] : []),
    "url": `${SITE_URL}/${slug}`,
    "sku": meta.sku,
    "brand": { "@type": "Brand", "name": SITE_NAME },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "RUB",
      "price": (meta.price / 100).toFixed(2),
      "priceValidUntil": priceValidUntil,
      "availability": availability,
      "itemCondition": "https://schema.org/NewCondition",
      "url": `${SITE_URL}/${slug}`,
      "seller": { "@type": "Organization", "name": SITE_NAME },
    },
  };
  if (rating && rating.reviewCount >= 1) {
    productSchema.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": rating.averageRating.toFixed(1),
      "reviewCount": rating.reviewCount,
      "bestRating": "5",
      "worstRating": "1",
    };
  }

  const cachedReviews = getCachedReviewsByProductId(meta.productId);
  if (cachedReviews.length > 0) {
    productSchema.review = cachedReviews.map(r => {
      const reviewSchema: Record<string, any> = {
        "@type": "Review",
        "author": { "@type": "Person", "name": r.authorName },
        "reviewRating": {
          "@type": "Rating",
          "ratingValue": String(r.rating),
          "bestRating": "5",
          "worstRating": "1",
        },
      };
      if (r.comment) reviewSchema.reviewBody = r.comment;
      if (r.createdAt) reviewSchema.datePublished = r.createdAt.split("T")[0];
      return reviewSchema;
    });
  }
  const additionalProps: any[] = [];
  if (meta.sizes.length > 0) {
    additionalProps.push({ "@type": "PropertyValue", "name": "Доступные размеры", "value": meta.sizes.join(", ") });
  }
  if (meta.composition) {
    productSchema.material = meta.composition;
    additionalProps.push({ "@type": "PropertyValue", "name": "Состав", "value": meta.composition });
  }
  if (meta.careInstructions) {
    additionalProps.push({ "@type": "PropertyValue", "name": "Уход", "value": meta.careInstructions });
  }
  if (meta.measurements && meta.measurements.length > 0) {
    const measurementStr = meta.measurements.map(row =>
      Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(", ")
    ).join(" | ");
    additionalProps.push({ "@type": "PropertyValue", "name": "Таблица размеров", "value": measurementStr });
  }
  if (additionalProps.length > 0) {
    productSchema.additionalProperty = additionalProps;
  }

  // Color/model variants — synchronous, in-memory only (never touches YDB).
  // Mirrors the live /api/products/:id/variants matching cascade.
  let variantsHtml = "";
  try {
    const variantCandidates = getCachedProductsForVariantMatching();
    const currentAsInput = variantCandidates.find(p => p.id === meta.productId);
    if (currentAsInput) {
      const variants = findProductVariantsSync(currentAsInput, variantCandidates)
        .filter(v => v.slug && v.slug !== slug);
      if (variants.length > 0) {
        productSchema.isVariantOf = {
          "@type": "ProductGroup",
          "name": meta.title,
          "url": `${SITE_URL}/${slug}`,
          "hasVariant": [
            {
              "@type": "Product",
              "name": meta.title,
              "url": `${SITE_URL}/${slug}`,
              "sku": meta.sku,
              "image": meta.image || undefined,
            },
            ...variants.map(v => ({
              "@type": "Product",
              "name": v.name,
              "url": `${SITE_URL}/${v.slug}`,
              "image": v.imageUrl || undefined,
            })),
          ],
        };
        variantsHtml = `<div class="variants"><h2>Другие цвета</h2><ul>${variants.map(v =>
          `<li><a href="/${esc(v.slug)}">${v.color ? `<img src="${esc(v.thumbnailUrl || v.imageUrl)}" alt="${esc(v.color)}" width="60" height="60" loading="lazy"><span>${esc(v.color)}</span>` : esc(v.name)}</a></li>`
        ).join("\n")}</ul></div>`;
      }
    }
  } catch { /* safe to skip */ }

  const catName = meta.category ? CATEGORIES[meta.category]?.name || meta.category : "";
  const breadcrumbItems: any[] = [
    { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
    { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
  ];
  if (catName) {
    breadcrumbItems.push({ "@type": "ListItem", "position": 3, "name": catName, "item": `${SITE_URL}/products/${meta.category}` });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    "position": catName ? 4 : 3,
    "name": meta.title,
    "item": `${SITE_URL}/${slug}`,
  });
  const breadcrumbSchema = { "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": breadcrumbItems };

  const ogImage = meta.image && meta.image.startsWith("http") ? meta.image : `${SITE_URL}${meta.image || "/og-image.png"}`;

  const head = baseHead({
    title,
    description: desc,
    canonical: `${SITE_URL}/${slug}`,
    ogImage,
    ogType: "product",
    jsonLd: safeJsonLd([productSchema, breadcrumbSchema]),
  });

  const imagesHtml = meta.images.slice(0, 6).map((imgUrl, idx) =>
    `<img src="${esc(imgUrl)}" alt="${esc(idx === 0 ? meta.title + " — фото" : meta.title + " — фото " + (idx + 1))}" width="400" height="400" loading="${idx === 0 ? "eager" : "lazy"}">`
  ).join("\n");

  const videoHtml = meta.videoUrl
    ? `<video src="${esc(meta.videoUrl)}" controls muted loop playsinline preload="none" poster="${esc(meta.image)}" style="max-width:400px;width:100%;border-radius:6px;margin:.5rem 0" data-testid="video-product-bot"></video>`
    : "";

  // Recommendations — uses co-purchase index built at server startup
  let recsHtml = "";
  try {
    const candidates = getCachedProductsForRecommendations();
    const recs = getRecommendationsSync(meta.productId, 4, candidates);
    if (recs.length > 0) {
      const recCards = recs.map(r =>
        `<li><a href="/${esc(r.slug)}">${esc(r.name)}</a><div class="rprice">${price(r.price)}</div></li>`
      ).join("\n");
      recsHtml = `<div class="recs"><h2>С этим часто берут</h2><ul>${recCards}</ul></div>`;
    }
  } catch { /* safe to skip */ }

  const ratingHtml = rating && rating.reviewCount >= 1
    ? `<p class="rating">⭐ ${rating.averageRating.toFixed(1)} из 5 (${rating.reviewCount} ${rating.reviewCount === 1 ? "отзыв" : rating.reviewCount < 5 ? "отзыва" : "отзывов"})</p>`
    : "";

  const reviewsHtml = cachedReviews.length > 0
    ? `<div class="reviews"><h2>Отзывы покупателей</h2>${cachedReviews.map(r => `
    <div class="review">
      <div class="review-head"><strong>${esc(r.authorName)}</strong> — ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}${r.createdAt ? ` <span class="review-date">${esc(r.createdAt.split("T")[0])}</span>` : ""}</div>
      ${r.comment ? `<p class="review-text">${esc(r.comment)}</p>` : ""}
    </div>`).join("\n")}</div>`
    : "";

  const breadcrumbHtml = `<div class="breadcrumb">
  <a href="/">Главная</a> /
  <a href="/products">Каталог</a>${catName ? ` / <a href="/products/${esc(meta.category)}">${esc(catName)}</a>` : ""} /
  ${esc(meta.title)}
</div>`;

  const body = `
${breadcrumbHtml}
${imagesHtml ? `<div class="product-images">${imagesHtml}</div>` : ""}
${videoHtml}
<h1>${esc(meta.title)}</h1>
<div style="margin:1rem 0">
  <div style="font-size:2rem;font-weight:900">${price(meta.price)}</div>
  <div class="status ${statusCls}" style="margin-top:.5rem;font-weight:600">${statusText}</div>
  ${ratingHtml}
  ${meta.sizes.length > 0 ? `<p style="margin-top:.75rem">Размеры: <strong>${esc(meta.sizes.join(", "))}</strong></p>` : ""}
  ${meta.colors.length > 0 ? `<p>Цвета: ${esc(meta.colors.join(", "))}</p>` : ""}
  ${catName ? `<p>Категория: <a href="/products/${esc(meta.category)}">${esc(catName)}</a></p>` : ""}
  ${meta.description ? `<p class="desc" style="margin-top:1rem;max-width:none">${esc(meta.description)}</p>` : ""}
  ${meta.composition ? `<p style="margin-top:.75rem"><strong>Состав:</strong> ${esc(meta.composition)}</p>` : ""}
  ${meta.careInstructions ? `<p style="margin-top:.5rem"><strong>Уход:</strong> ${esc(meta.careInstructions)}</p>` : ""}
  ${meta.measurements && meta.measurements.length > 0 ? (() => {
    const cols = Object.keys(meta.measurements[0]);
    const header = cols.map(c => `<th>${esc(c)}</th>`).join("");
    const rows = meta.measurements.map(row =>
      `<tr>${cols.map(c => `<td>${esc(String(row[c] ?? ""))}</td>`).join("")}</tr>`
    ).join("\n");
    return `<div style="margin-top:.75rem;overflow-x:auto"><strong>Таблица размеров (см):</strong><table style="border-collapse:collapse;margin-top:.4rem;font-size:.85rem"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  })() : ""}
  <p style="margin-top:.75rem">Доставка по всей России СДЭК и Яндекс Доставкой.</p>
  <a href="/${esc(slug)}" class="buy-btn">Купить на сайте</a>
</div>
${variantsHtml}
${reviewsHtml}
${recsHtml}`;

  return wrapPage(head, body);
}

// ─── Express middleware ───────────────────────────────────────────────────────

export function botSsrMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only GET requests
  if (req.method !== "GET") return next();

  // Must be a known bot
  const ua = req.headers["user-agent"] || "";
  if (!isBot(ua)) return next();

  // Skip API calls, static assets, and paths with file extensions
  const reqPath = req.path;
  if (
    reqPath.startsWith("/api/") ||
    reqPath.startsWith("/assets/") ||
    reqPath.startsWith("/images/") ||
    reqPath.includes(".")
  ) {
    return next();
  }

  try {
    // Check bot HTML cache first
    const cacheKey = reqPath;
    const cached = botCacheGet(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      res.setHeader("X-Bot-SSR", "cache-hit");
      res.send(cached);
      return;
    }

    let html: string | null = null;

    if (reqPath === "/" || reqPath === "") {
      html = renderHome();
    } else if (reqPath === "/products") {
      html = renderCatalog();
    } else if (reqPath.startsWith("/products/")) {
      // /products/:catSlug — ignore deeper paths like /products/clothing/hoodies
      const rest = reqPath.slice("/products/".length);
      const catSlug = rest.split("/")[0];
      if (catSlug && !rest.includes("/") && CATEGORIES[catSlug]) {
        html = renderCategory(catSlug);
      }
    } else {
      // Try /:slug — product detail page
      const slugMatch = reqPath.match(/^\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/);
      if (slugMatch) {
        html = renderProduct(slugMatch[1]);
      }
    }

    // If nothing rendered (unknown route, empty cache, etc.) — pass through
    if (!html) return next();

    botCacheSet(cacheKey, html);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.setHeader("X-Bot-SSR", "rendered");
    res.send(html);
  } catch (err: any) {
    // Never break the site for real users — just pass through
    console.error("[BotSSR] Error rendering for bot:", reqPath, err?.message);
    next();
  }
}
