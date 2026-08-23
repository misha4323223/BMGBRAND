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
import crypto from "node:crypto";
import {
  getCachedProductMetaBySlug,
  getCachedDeletedSlugs,
  getCachedProductsByCategory,
  getCachedAllVisibleProducts,
  getCachedRatingByProductId,
  getCachedProductsForRecommendations,
  getCachedReviewsByProductId,
  getCachedProductsForVariantMatching,
  getCachedRawPageSettings,
  isProductsCacheWarm,
  getProductMetaBySlugFromDb,
  type ProductMetaForSsr,
} from "./storage";
import { getRecommendationsSync } from "./recommendations";
import { findProductVariantsSync } from "./variant-matching";
import { CATEGORIES, normalizeCategories, findCategoryBySubcategorySlug, findCategoryBySubSubcategorySlug, buildCategoryIndex, resolveProductCategoryPaths, sortProductCategoryPaths, GIFT_CARD_AMOUNTS } from "../shared/schema";

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
  // OpenAI
  /gptbot/i, /chatgpt-user/i, /oai-searchbot/i,
  // Anthropic
  /claudebot/i, /anthropic-ai/i,
  // Perplexity
  /perplexitybot/i,
  // DeepSeek
  /deepseek/i,
  // Google Gemini AI (google-extended и googleother уже в секции Google выше)
  // Meta AI
  /meta-externalagent/i, /facebookbot/i,
  // Mistral AI
  /mistralai/i,
  // Cohere
  /cohere-ai/i, /coherebot/i,
  // Amazon / Alexa
  /amazonbot/i,
  // xAI Grok
  /xai-grok/i,
  // ByteDance
  /bytespider/i,
  // Apple (including AI training crawler)
  /applebot/i, /applebot-extended/i,
  // You.com / DuckDuckGo
  /youbot/i, /duckassistbot/i,
  // Brave Search (not the browser — bot only)
  /brave-search/i,
  // Allen Institute for AI
  /ai2bot/i,
  // Common Crawl (used for LLM training datasets)
  /ccbot/i,
  // Huawei PetalBot
  /petalbot/i,
  // Timpi
  /timpibot/i,
  // Generic AI agent patterns
  /llmspider/i, /aibot/i, /ai-crawler/i, /ai_archiver/i,
  // ── Российские ИИ ──────────────────────────────────────────────────────────
  // Сбер GigaChat
  /gigachat/i, /sberbot/i, /sbercrawler/i,
  // Яндекс Нейро / YandexGPT (основные yandexbot-паттерны выше уже покрывают,
  // но на случай отдельного краулера для нейро-продуктов)
  /yandexgpt/i, /yandexneiro/i, /yandexai/i,
  // VK AI (Маруся и др.)
  /vkrobot/i, /vk_ai/i, /marusia/i,
  // MTS AI
  /mts-ai/i,
  // Сбер Салют
  /salutespeech/i, /sber-ai/i,
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

/**
 * Returns true ONLY for real user browsers: Chrome, Firefox, Safari, Edge, Opera.
 * Anything that doesn't positively match a browser gets SSR HTML instead of the
 * empty React shell — so SEO tools, new AI crawlers, and unknown scrapers all see
 * full content without needing to be whitelisted.
 */
export function isBrowser(ua: string): boolean {
  if (!ua.includes("Mozilla/5.0")) return false;
  return (
    /Chrome\/\d/.test(ua)  ||   // Chrome, Chromium, Brave
    /Firefox\/\d/.test(ua) ||   // Firefox
    /Edg\/\d/.test(ua)     ||   // Edge (modern)
    /OPR\/\d/.test(ua)     ||   // Opera
    (/Safari\/\d/.test(ua) && /Version\/\d/.test(ua)) // Safari (not Chrome)
  );
}

// ─── Tiny in-memory cache for rendered bot pages ──────────────────────────────
interface BotCacheEntry { html: string; ts: number }
const botCache = new Map<string, BotCacheEntry>();

/**
 * YDB slug-lookup fallback: remembers slugs already checked against YDB so a bot
 * re-crawling an unknown/old URL doesn't hammer the database. TTL 60s.
 * - entry.hidden === true  → product exists in YDB but isn't public → 404
 * - entry.hidden === false → slug confirmed absent in YDB → pass through
 * Rendered (public) products are NOT stored here — the bot HTML cache handles them.
 */
const dbSlugCheckCache = new Map<string, { ts: number; hidden: boolean }>();
const DB_SLUG_CHECK_TTL_MS = 60_000;
const BOT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BOT_CACHE_MAX = 2000;             // max cached paths

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

/** Admin helper: wipe the entire bot-SSR in-memory cache (e.g. after SEO data changes). */
export function clearBotSsrCache(): number {
  const size = botCache.size;
  botCache.clear();
  return size;
}

// ─── Static site data (mirrors server/static.ts — kept in sync manually) ─────
const SITE_NAME = "BMGBRAND";
const SITE_URL = (process.env.SITE_URL || "https://booomerangs.ru").replace(/\/$/, "");

// Единая сущность Organization с @id — используется как ссылка (brand/seller)
// на карточках товаров, чтобы Google/Яндекс распознавали продавца как ту же
// полноценную организацию, что описана на главной странице, а не как
// анонимную заглушку без url/logo/sameAs. Держим в синхроне с server/static.ts.
function buildOrganizationSchema() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    "name": SITE_NAME,
    "alternateName": "Booomerangs",
    "url": SITE_URL,
    "logo": `${SITE_URL}/favicon.png`,
    "sameAs": [
      "https://vk.com/bmgbrand",
      "https://t.me/bmg_booomerangs",
    ],
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Тула",
      "addressCountry": "RU",
    },
  };
}

// Реальная политика возврата — 14 дней, совпадает с текстом FAQ/Terms/страницы товара.
function buildMerchantReturnPolicy() {
  return {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": "RU",
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 14,
    "returnMethod": "https://schema.org/ReturnByMail",
    "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
  };
}

// Стандартные условия доставки по России СДЭК/Яндекс.
function buildShippingDetails() {
  return {
    "@type": "OfferShippingDetails",
    "shippingRate": {
      "@type": "MonetaryAmount",
      "currency": "RUB",
      "minValue": "0",
      "maxValue": "600",
    },
    "shippingDestination": {
      "@type": "DefinedRegion",
      "addressCountry": "RU",
    },
    "deliveryTime": {
      "@type": "ShippingDeliveryTime",
      "handlingTime": {
        "@type": "QuantitativeValue",
        "minValue": 1,
        "maxValue": 2,
        "unitCode": "DAY",
      },
      "transitTime": {
        "@type": "QuantitativeValue",
        "minValue": 1,
        "maxValue": 10,
        "unitCode": "DAY",
      },
    },
  };
}

// Дефолтные вопросы/ответы FAQ — держим в синхроне с client/src/pages/FAQ.tsx.
// Используются только если админ ещё не сохранил свой faq_data в static_pages.
const DEFAULT_FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  { question: "Как оформить заказ?", answer: "Выберите понравившиеся товары, добавьте их в корзину, перейдите к оформлению и заполните данные для доставки. После оформления заказа вам придёт уведомление на электронную почту. Отследить статус заказа и местонахождение посылки можно в личном кабинете." },
  { question: "Какие способы оплаты доступны?", answer: "Мы принимаем оплату банковскими картами через ЮKassa и Т-Банк. Доступны банковские карты (Visa, MasterCard, МИР), СБП (Система быстрых платежей), а также Т-Pay." },
  { question: "Сколько стоит доставка?", answer: "Доставка по России осуществляется через СДЭК. Стоимость рассчитывается автоматически при оформлении заказа в зависимости от региона и веса посылки." },
  { question: "Сколько времени занимает доставка?", answer: "Срок доставки зависит от вашего региона и выбранного способа доставки — обычно от 1 до 10 рабочих дней по России." },
  { question: "Можно ли вернуть или обменять товар?", answer: "Да, вы можете вернуть или обменять товар в течение 14 дней с момента получения. Товар должен сохранить товарный вид, бирки и упаковку. Подробнее в разделе 'Доставка и возврат' на странице товара." },
  { question: "Как подобрать размер?", answer: "На странице каждого товара есть таблица размеров с точными замерами. Если у вас остались вопросы, напишите нам в Telegram или на почту — поможем с выбором." },
  { question: "Есть ли у вас офлайн-магазин?", answer: "Мы работаем онлайн, но наша одежда уже представлена у дистрибьюторов более чем в 40 городах России. Также планируем открытие собственного шоурума — следите за новостями в наших соцсетях!" },
  { question: "Как связаться с поддержкой?", answer: "Напишите нам на info@booomerangs.ru, в Telegram @bmg_booomerangs или в группу ВКонтакте vk.com/bmgbrand. Мы отвечаем в течение 24 часов." },
];

// Реальный контент FAQ, отредактированный в админке (static_pages.faq_data), с фолбэком —
// та же логика парсинга, что в client/src/pages/FAQ.tsx и server/static.ts.
function getFaqItems(): Array<{ question: string; answer: string }> {
  try {
    const staticPages = getCachedRawPageSettings("static_pages");
    const raw = staticPages?.faq_data;
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    if (parsed?.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed.items;
    }
  } catch { /* keep defaults */ }
  return DEFAULT_FAQ_ITEMS;
}

const CAT_META: Record<string, { name: string; title?: string; desc: string }> = {
  clothing:    { name: "Одежда",                    desc: "Купить одежду с авторскими принтами BMGBRAND — худи, свитшоты, футболки, шорты. Доставка по всей России." },
  merch:       { name: "Мерч",                      desc: "Купить официальный мерч артистов BMGBRAND — одежда и аксессуары с уникальными принтами. Доставка по всей России." },
  socks:       {
    name: "Необычные носки с принтом",
    title: "Купить необычные носки с принтом — прикольные носки с мемами | BMGBRAND",
    desc: "Купить необычные носки с принтом BOOOMERANGS: оригинальные носки с мемами, прикольные авторские рисунки, носки хорошего качества — хлопок 75%. Большой выбор принтов. Доставка по всей России СДЭК.",
  },
  accessories: { name: "Аксессуары",                desc: "Купить аксессуары BMGBRAND — шапки, сумки, ремни и другие аксессуары. Доставка по всей России." },
  sale:        { name: "SALE",                desc: "Распродажа BMGBRAND — выгодные цены на одежду и аксессуары. Доставка по всей России." },
};

// ─── Admin-editable SEO overrides ──────────────────────────────────────────────
// Стораются в page_settings (pageName="seo"), редактируются в разделе SEO админки.
// Ключи секций: "home", "category:<slug>", "subcategory:<catSlug>:<subSlug>".
// Читаем только из тёплого кэша — как и весь остальной bot-ssr, без обращений к YDB.
function getSeoOverride(key: string): { title?: string; description?: string } {
  try {
    const seo = getCachedRawPageSettings("seo");
    const entry = seo?.[key];
    if (entry && typeof entry === "object") {
      const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : undefined;
      const description = typeof entry.description === "string" && entry.description.trim() ? entry.description.trim() : undefined;
      return { title, description };
    }
  } catch { /* keep defaults */ }
  return {};
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
// Strips HTML tags and collapses whitespace — used to feed admin-pasted HTML blocks
// (seoBody, specsHtml) into plain-text schema.org fields for bots that don't render HTML.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

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

// Availability of a product for SSR listing cards. Preorder products (stock is a
// preorder reserve, not shelf stock) must be labeled "предзаказ" / PreOrder —
// showing them as "в наличии" / InStock misleads search engines and users.
function cardStatus(p: { stock: number; preorderEnabled?: boolean }): {
  cls: string;
  text: string;
  availability: string;
} {
  if (p.preorderEnabled) {
    return {
      cls: "preorder",
      text: "предзаказ",
      availability: "https://schema.org/PreOrder",
    };
  }
  if (p.stock > 0) {
    return {
      cls: "in-stock",
      text: "в наличии",
      availability: "https://schema.org/InStock",
    };
  }
  return {
    cls: "out-of-stock",
    text: "под заказ",
    availability: "https://schema.org/OutOfStock",
  };
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

/** Trim description to ≤155 chars, breaking at the last word boundary so the
 *  text never ends mid-word in SERPs. Appends "…" only when actually cut. */
function trimDesc(s: string, max = 155): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max);
  return (cut > 60 ? s.slice(0, cut) : s.slice(0, max)) + "…";
}

/**
 * Absolute product image URL for listing JSON-LD (Google Merchant requires "image").
 * Falls back to thumbnail, then first gallery image; returns undefined if none.
 */
function productImageUrl(p: any): string | undefined {
  const img = p.imageUrl || p.thumbnailUrl || (Array.isArray(p.images) ? p.images[0] : null);
  if (!img) return undefined;
  return img.startsWith("http") ? img : `${SITE_URL}${img}`;
}

/**
 * Полная Product-сущность для листингов (ItemList / CollectionPage).
 * Google Merchant требует в каждом offers поля hasMerchantReturnPolicy и
 * shippingDetails, а в самом Product — description. Раньше листинги отдавали
 * «лёгкий» Product без этих полей, из-за чего Search Console ругался на
 * /remni, /products/accessories и другие страницы-каталоги.
 */
function buildListingProductItem(
  p: any,
  opts: { availability?: string; url?: string } = {},
): Record<string, any> {
  const url = opts.url || `${SITE_URL}/${p.slug}`;
  const availability = opts.availability || cardStatus(p).availability;
  const rawDesc = p.description || p.seoDescription || "";
  const description = rawDesc
    ? trimDesc(stripHtml(String(rawDesc)), 160)
    : `Купить ${p.name} в интернет-магазине BMGBRAND. Доставка по России.`;
  return {
    "@type": "Product",
    "name": p.name,
    "description": description,
    "image": productImageUrl(p),
    "sku": p.article || p.sku || String(p.id),
    "brand": { "@type": "Brand", "name": "BMGBRAND" },
    "url": url,
    "offers": {
      "@type": "Offer",
      "priceCurrency": "RUB",
      "price": (p.price / 100).toFixed(2),
      "availability": availability,
      "url": url,
      "hasMerchantReturnPolicy": buildMerchantReturnPolicy(),
      "shippingDetails": buildShippingDetails(),
    },
  };
}

function baseHead(opts: {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType?: string;
  jsonLd?: string;
  /** Raw HTML to inject verbatim into <head> — use for noindex etc. */
  extra?: string;
  /** LCP image URL — emits <link rel="preload"> so the browser starts
   *  fetching the hero/product photo before it parses the <img> tag. */
  preloadImage?: string;
  /** OG image dimensions — emit og:image:width/height only when known */
  ogImageWidth?: string;
  ogImageHeight?: string;
}): string {
  const { title, description, canonical, ogImage, ogType = "website", jsonLd, extra, preloadImage, ogImageWidth, ogImageHeight } = opts;
  const t = esc(title);
  const d = esc(trimDesc(description));
  return [
    `  <meta charset="UTF-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `  <title>${t}</title>`,
    `  <meta name="description" content="${d}">`,
    extra || `  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">`,
    `  <link rel="canonical" href="${esc(canonical)}">`,
    // LCP preload: browser begins fetching the main product image immediately,
    // before it encounters the <img> tag further down the page.
    preloadImage ? `  <link rel="preload" as="image" href="${esc(preloadImage)}" fetchpriority="high">` : "",
    `  <meta property="og:type" content="${esc(ogType)}">`,
    `  <meta property="og:url" content="${esc(canonical)}">`,
    `  <meta property="og:title" content="${t}">`,
    `  <meta property="og:description" content="${d}">`,
    `  <meta property="og:image" content="${esc(ogImage)}">`,
    ogImageWidth  ? `  <meta property="og:image:width" content="${esc(ogImageWidth)}">` : "",
    ogImageHeight ? `  <meta property="og:image:height" content="${esc(ogImageHeight)}">` : "",
    `  <meta property="og:locale" content="ru_RU">`,
    `  <meta property="og:site_name" content="Booomerangs">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${t}">`,
    `  <meta name="twitter:description" content="${d}">`,
    `  <meta name="twitter:image" content="${esc(ogImage)}">`,
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
      <a href="/products/merch">Мерч</a>
      <a href="/products/sale">SALE</a>
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
    <p><a href="/products">Каталог</a> · <a href="/products/socks">Носки</a> · <a href="/products/clothing">Одежда</a> · <a href="/products/accessories">Аксессуары</a> · <a href="/products/merch">Мерч</a> · <a href="/products/sale">SALE</a></p>
    <p><a href="/about">О бренде</a> · <a href="/faq">Вопросы и ответы</a> · <a href="/contacts">Контакты</a> · <a href="/merch-na-zakaz">Мерч на заказ</a></p>
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

  const catLinks = Object.entries(CAT_META)
    .map(([slug, cat]) => `<a href="/products/${slug}" class="cat-link">${esc(cat.name)}</a>`)
    .join("\n");

  const cards = inStock.map(p => `
    <article class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status ${cardStatus(p).cls}">${cardStatus(p).text}</div>
    </article>`).join("\n");

  const homeSeoTitle = getSeoOverride("home").title || `Официальный сайт бренда Booomerangs | ${SITE_NAME}`;
  const homeSeoDesc = getSeoOverride("home").description || "Booomerangs (BMGBRAND) — официальный магазин мерча со встроенным ИИ-консультантом BOOOM AI. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России.";
  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      ...buildOrganizationSchema(),
      "description": "Официальный магазин мерча российского бренда одежды и аксессуаров BMGBRAND со встроенным ИИ-консультантом BOOOM AI, который помогает подобрать размер и рассказывает о товаре.",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "name": "Booomerangs",
      "alternateName": SITE_NAME,
      "url": SITE_URL,
      "inLanguage": "ru-RU",
      "publisher": { "@id": `${SITE_URL}/#organization` },
      "potentialAction": {
        "@type": "SearchAction",
        "target": `${SITE_URL}/products?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_URL}/#webpage`,
      "url": SITE_URL,
      "name": homeSeoTitle,
      "description": homeSeoDesc,
      "inLanguage": "ru-RU",
      "isPartOf": { "@id": `${SITE_URL}/#website` },
      "about": { "@id": `${SITE_URL}/#organization` },
      "speakable": {
        "@type": "SpeakableSpecification",
        "xpath": ["//h1", "//p[@class='desc']"],
      },
    },
  ]);

  const head = baseHead({
    title: homeSeoTitle,
    description: homeSeoDesc,
    canonical: SITE_URL,
    ogImage: `${SITE_URL}/og-image.png`,
    ogImageWidth: "1024",
    ogImageHeight: "1024",
    jsonLd,
  });

  const body = `
<h1>BOOOMERANGS — официальный магазин бренда BMGBRAND</h1>
<p class="desc">Российский бренд одежды с авторскими принтами из Тулы. Худи, свитшоты, футболки, носки и аксессуары. Делаем вещи, которые носим сами. На каждой странице товара работает встроенный ИИ-консультант BOOOM AI — помогает подобрать размер и отвечает на вопросы о составе, уходе и коллаборациях. Доставка по всей России СДЭК.</p>
<h2>Категории товаров</h2>
<div class="cats">${catLinks}</div>
${inStock.length > 0 ? `<h2>Популярные товары</h2><div class="grid">${cards}</div>` : ""}
<p style="margin-top:1.5rem"><a href="/products">Смотреть весь каталог →</a></p>`;

  return wrapPage(head, body);
}

function renderCatalog(): string | null {
  const products = getCachedAllVisibleProducts(500);
  // If cache is still warming — pass through to React SPA
  if (products.length === 0) return null;
  const catGroups: Record<string, typeof products> = {};
  for (const p of products) {
    if (!catGroups[p.category]) catGroups[p.category] = [];
    catGroups[p.category].push(p);
  }

  const catBlocks = Object.entries(CAT_META).map(([slug, cat]) => {
    const catProducts = catGroups[slug] || [];
    if (catProducts.length === 0) return "";
    const items = catProducts.slice(0, 8).map(p =>
      `<article class="card"><div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div><div class="price">${price(p.price)}</div><div class="status ${cardStatus(p).cls}">${cardStatus(p).text}</div></article>`
    ).join("\n");
    return `<h2><a href="/products/${slug}">${esc(cat.name)}</a> <span style="font-size:.75rem;font-weight:400;text-transform:none;color:#888">(${catProducts.length} тов.)</span></h2><div class="grid">${items}</div>`;
  }).filter(Boolean).join("\n");

  const topProducts = products.slice(0, 12);
  const catalogSeo = getSeoOverride("static:catalog");
  const catalogTitle = catalogSeo.title || `Каталог — одежда и аксессуары | ${SITE_NAME}`;
  const catalogDesc = catalogSeo.description || "Каталог BMGBRAND — одежда с авторскими принтами, мерч артистов, носки, аксессуары. Доставка по всей России.";
  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_URL}/products#webpage`,
      "url": `${SITE_URL}/products`,
      "name": catalogTitle,
      "description": catalogDesc,
      "inLanguage": "ru-RU",
      "isPartOf": { "@id": `${SITE_URL}/#website` },
    },
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": catalogTitle,
      "description": catalogDesc,
      "url": `${SITE_URL}/products`,
      "numberOfItems": products.length,
      "itemListElement": topProducts.map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": buildListingProductItem(p),
      })),
    },
  ]);

  const head = baseHead({
    title: catalogTitle,
    description: catalogDesc,
    canonical: `${SITE_URL}/products`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Каталог</div>
<h1>Каталог BOOOMERANGS</h1>
<p class="desc">Официальный магазин бренда BMGBRAND. Доставка по всей России.</p>
${catBlocks || "<p>Товары загружаются...</p>"}`;

  return wrapPage(head, body);
}

/**
 * Live category tree from site_config.categories_data (same source as
 * /api/categories), falling back to the static schema CATEGORIES when the
 * in-memory page-settings cache is cold. Used to emit crawlable links to
 * subcategories and sub-subcategories from category pages.
 */
function getLiveCategories(): Record<string, any> {
  try {
    const siteConfig = getCachedRawPageSettings('site_config');
    if (siteConfig?.categories_data) {
      const raw = typeof siteConfig.categories_data === 'string'
        ? JSON.parse(siteConfig.categories_data)
        : siteConfig.categories_data;
      const normalized = normalizeCategories(raw);
      if (Object.keys(normalized).length > 0) return normalized as Record<string, any>;
    }
  } catch { /* keep static fallback */ }
  return CATEGORIES as Record<string, any>;
}

function renderCategory(catSlug: string): string | null {
  const cat = CAT_META[catSlug];
  if (!cat) return null;

  const products = getCachedProductsByCategory(catSlug, 500);
  // Кэш ещё холодный (первые секунды после рестарта) — отдаём временную
  // страницу с правильным canonical/title, а не пустую SPA-оболочку,
  // которую поисковики и ИИ-краулеры «не видят».
  if (products.length === 0 && !isProductsCacheWarm()) {
    const catSeo = getSeoOverride(`category:${catSlug}`);
    const title = catSeo.title || cat.title || `${cat.name} — купить в BMGBRAND | ${SITE_NAME}`;
    const desc = catSeo.description || cat.desc;
    return renderLoadingPlaceholder({
      title,
      description: desc,
      canonical: `${SITE_URL}/products/${catSlug}`,
      breadcrumb: `<a href="/">Главная</a> / <a href="/products">Каталог</a> / ${esc(cat.name)}`,
      body: `<h1>${esc(cat.name)}</h1><p class="desc">${esc(desc)}</p><p>Товары раздела загружаются — зайдите чуть позже.</p>`,
    });
  }
  if (products.length === 0) return null;

  const inStock = products.filter(p => p.stock > 0);
  // Всё, что не «в наличии» (0, отрицательное, null/undefined/NaN), попадает
  // в «под заказ» — иначе товар с «битым» stock не выводился бы вообще, а счётчик
  // «Всего товаров» (products.length) расходился бы с числом карточек.
  const outOfStock = products.filter(p => !(p.stock > 0));
  const allSorted = [...inStock, ...outOfStock];

  const cards = allSorted.map(p => `
    <article class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status ${cardStatus(p).cls}">${cardStatus(p).text}</div>
    </article>`).join("\n");

  // Crawlable links to subcategories (level 2) and sub-subcategories (level 3).
  // The sitemap lists them too, but search engines also discover pages via
  // internal links — without these, deep category pages relied solely on
  // sitemap.xml and were often skipped by crawlers that prioritise link discovery.
  const liveCatsForLinks = getLiveCategories();
  const liveCatForLinks = liveCatsForLinks[catSlug];
  const subLinkItems = (liveCatForLinks?.subcategories || [])
    .map((sub: any) => {
      const subCanonical = CYRILLIC_TO_CANONICAL[sub.slug] || sub.slug;
      const subSubLinks = (sub.subSubcategories || [])
        .map((ss: any) => `<li><a href="/products/${esc(catSlug)}/${esc(sub.slug)}/${esc(ss.slug)}">${esc(ss.name)}</a></li>`)
        .join("");
      return `<li><a href="/${esc(subCanonical)}">${esc(sub.name)}</a>${subSubLinks ? `<ul>${subSubLinks}</ul>` : ""}</li>`;
    })
    .join("");
  const subLinksBlock = subLinkItems
    ? `<h2>Разделы</h2><ul>${subLinkItems}</ul>`
    : "";

  const catSeo = getSeoOverride(`category:${catSlug}`);
  const title = catSeo.title || cat.title || `${cat.name} — купить в BMGBRAND | ${SITE_NAME}`;
  const desc = catSeo.description || cat.desc;
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
      "@type": "WebPage",
      "@id": `${SITE_URL}/products/${catSlug}#webpage`,
      "url": `${SITE_URL}/products/${catSlug}`,
      "name": title,
      "description": desc,
      "inLanguage": "ru-RU",
      "isPartOf": { "@id": `${SITE_URL}/#website` },
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": cat.name,
      "description": desc,
      "url": `${SITE_URL}/products/${catSlug}`,
      "numberOfItems": allSorted.length,
      "itemListElement": allSorted.map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": buildListingProductItem(p),
      })),
    },
  ]);

  const head = baseHead({
    title,
    description: desc,
    canonical: `${SITE_URL}/products/${catSlug}`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / ${esc(cat.name)}</div>
<h1>${esc(cat.name)}</h1>
<p class="desc">${esc(desc)}</p>
<p style="margin-bottom:1rem;color:#888;font-size:.9rem">Всего товаров: <strong>${products.length}</strong>. В наличии: <strong>${inStock.length}</strong>.</p>
${subLinksBlock}
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

  return renderProductHtml(slug, meta);
}

/**
 * Builds the full SSR product HTML from product meta. `slug` is the URL slug used
 * for canonical/self links (may differ from the slug stored on the product).
 * Shared by the cache path (renderProduct) and the YDB fallback path.
 */
function renderProductHtml(slug: string, meta: ProductMetaForSsr): string {
  const isMerch = ["merch", "мерч"].includes((meta.category || "").toLowerCase());
  const title = meta.seoTitle || `${meta.title}${isMerch ? " — купить мерч" : " — купить"} | ${SITE_NAME}`;
  const desc = meta.seoDescription || [
    isMerch ? `Купить мерч ${meta.title} BOOOMERANGS` : `Купить ${meta.title} BOOOMERANGS`,
    meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "",
    "Доставка по России СДЭК.",
    meta.description ? trimDesc(meta.description, 120) : "",
  ].filter(Boolean).join(" ").slice(0, 220);

  const statusCls = meta.preorderEnabled ? "preorder" : meta.stock > 0 ? "in-stock" : "out-of-stock";
  const statusText = meta.preorderEnabled ? "предзаказ" : meta.stock > 0 ? "в наличии" : "нет в наличии";
  const availability = meta.preorderEnabled
    ? "https://schema.org/PreOrder"
    : meta.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const rating = getCachedRatingByProductId(meta.productId);
  const priceValidUntil = new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    .toISOString().split("T")[0];

  // Защита от "Invalid time value": некоторые товары имеют сломанное поле дат.
  const safeISODate = (d: Date | null | undefined): string | undefined => {
    if (!d) return undefined;
    const ms = d instanceof Date ? d.getTime() : new Date(d as any).getTime();
    return isNaN(ms) ? undefined : new Date(ms).toISOString().split("T")[0];
  };

  const organizationSchema = buildOrganizationSchema();
  const rawImages: string[] = meta.images.length > 0 ? meta.images.slice(0, 6) : (meta.image ? [meta.image] : []);
  // Google Merchant Listings: image must be URL or ImageObject.
  // Single image → plain URL (simplest). Multiple → ImageObject array.
  // Empty → undefined (JSON.stringify strips it).
  // representativeOfPage is NOT recognized by Google on ImageObject — omit it.
  const productImageJsonLd: string | Record<string, any>[] | undefined =
    rawImages.length === 0 ? undefined
    : rawImages.length === 1 ? rawImages[0]
    : rawImages.map((url) => ({
        "@type": "ImageObject",
        "url": url,
        "contentUrl": url,
      }));
  const productSchema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": meta.title,
    "description": desc,
    ...(productImageJsonLd ? { "image": productImageJsonLd } : {}),
    "url": `${SITE_URL}/${slug}`,
    "sku": meta.sku,
    "brand": { "@id": organizationSchema["@id"] },
    ...(safeISODate(meta.createdAt) ? { "datePublished": safeISODate(meta.createdAt) } : {}),
    // dateModified — сигнал свежести карточки для Google/Яндекса. Берём updatedAt,
    // если товар когда-либо редактировался в админке; иначе падаем на createdAt.
    ...((safeISODate(meta.updatedAt) || safeISODate(meta.createdAt))
      ? { "dateModified": safeISODate(meta.updatedAt) ?? safeISODate(meta.createdAt) }
      : {}),
    "offers": {
      "@type": "Offer",
      "priceCurrency": "RUB",
      "price": (meta.price / 100).toFixed(2),
      "priceValidUntil": priceValidUntil,
      "availability": availability,
      "itemCondition": "https://schema.org/NewCondition",
      "url": `${SITE_URL}/${slug}`,
      "seller": { "@id": organizationSchema["@id"] },
      "hasMerchantReturnPolicy": buildMerchantReturnPolicy(),
      "shippingDetails": buildShippingDetails(),
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
  if (meta.seoBody) {
    const seoBodyText = stripHtml(meta.seoBody);
    if (seoBodyText) additionalProps.push({ "@type": "PropertyValue", "name": "Подробнее о товаре", "value": seoBodyText });
  }
  if (meta.specsHtml) {
    const specsText = stripHtml(meta.specsHtml);
    if (specsText) additionalProps.push({ "@type": "PropertyValue", "name": "Характеристики", "value": specsText });
  } else {
    if (meta.composition) {
      productSchema.material = meta.composition;
      additionalProps.push({ "@type": "PropertyValue", "name": "Состав", "value": meta.composition });
    }
    if (meta.careInstructions) {
      additionalProps.push({ "@type": "PropertyValue", "name": "Уход", "value": meta.careInstructions });
    }
  }
  if (meta.measurements && meta.measurements.length > 0) {
    const measurementStr = meta.measurements.map(row =>
      Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(", ")
    ).join(" | ");
    additionalProps.push({ "@type": "PropertyValue", "name": "Таблица размеров", "value": measurementStr });
  }
  // Feature badges (admin-editable templates: icon + title + description) — exposed as visible text + schema for bots/AI crawlers
  let featureBadgesHtml = "";
  if (Array.isArray((meta as any).featureBadgeIds) && (meta as any).featureBadgeIds.length > 0) {
    try {
      const templates = getCachedRawPageSettings("product_feature_templates") || {};
      const badges = (meta as any).featureBadgeIds
        .map((id: string) => templates[id])
        .filter((t: any) => t && t.title);
      if (badges.length > 0) {
        featureBadgesHtml = `<ul class="feature-badges" style="margin-top:1rem;list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.5rem">${badges.map((b: any) =>
          `<li style="border:1px solid #ddd;border-radius:.5rem;padding:.5rem .75rem"><strong>${esc(b.title)}</strong>${b.description ? ` — ${esc(b.description)}` : ""}</li>`
        ).join("\n")}</ul>`;
        additionalProps.push({ "@type": "PropertyValue", "name": "Особенности товара", "value": badges.map((b: any) => b.description ? `${b.title}: ${b.description}` : b.title).join("; ") });
      }
    } catch { /* safe to skip */ }
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
        // Каждый вариант группы получает собственные offers (цена + наличие),
        // как рекомендует Google для ProductGroup — раньше варианты были только
        // «указателями» без цены. Предзаказ наследуется от текущего товара:
        // варианты цвета относятся к той же модели.
        const variantAvailability = (stock: number) =>
          meta.preorderEnabled
            ? "https://schema.org/PreOrder"
            : stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock";
        const variantOffers = (price: number, stock: number, url: string) => ({
          "@type": "Offer",
          "priceCurrency": "RUB",
          "price": (price / 100).toFixed(2),
          "availability": variantAvailability(stock),
          "url": url,
          "hasMerchantReturnPolicy": buildMerchantReturnPolicy(),
          "shippingDetails": buildShippingDetails(),
        });
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
              "offers": variantOffers(meta.price, meta.stock, `${SITE_URL}/${slug}`),
            },
            ...variants.map(v => ({
              "@type": "Product",
              "name": v.name,
              "url": `${SITE_URL}/${v.slug}`,
              "image": v.imageUrl || undefined,
              "offers": variantOffers(v.price, v.stock, `${SITE_URL}/${v.slug}`),
            })),
          ],
        };
        variantsHtml = `<div class="variants"><h2>Другие цвета</h2><ul>${variants.map(v =>
          `<li><a href="/${esc(v.slug)}">${v.color ? `<img src="${esc(v.thumbnailUrl || v.imageUrl)}" alt="${esc(v.color)}" width="60" height="60" loading="lazy"><span>${esc(v.color)}</span>` : esc(v.name)}</a></li>`
        ).join("\n")}</ul></div>`;
      }
    }
  } catch { /* safe to skip */ }

  const catName = meta.category ? CAT_META[meta.category]?.name || meta.category : "";
  // Полные пути товара (категория → подкатегория → под-подкатегория), включая
  // дополнительные категории (коллаборации). Тот же резолвер, что в sitemap.xml.
  const catPaths = sortProductCategoryPaths(resolveProductCategoryPaths(
    { category: meta.category, subcategory: meta.subcategory, subSubcategory: meta.subSubcategory, additionalCategories: meta.additionalCategories },
    buildCategoryIndex(getLiveCategories()),
  ));
  const primaryPath = catPaths[0] || null;

  const breadcrumbItems: any[] = [
    { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
    { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
  ];
  let bcPos = 3;
  if (primaryPath) {
    breadcrumbItems.push({ "@type": "ListItem", "position": bcPos++, "name": CAT_META[primaryPath.categorySlug]?.name || primaryPath.categorySlug, "item": `${SITE_URL}/products/${primaryPath.categorySlug}` });
    if (primaryPath.subcategorySlug) {
      const subCanonical = CYRILLIC_TO_CANONICAL[primaryPath.subcategorySlug] || primaryPath.subcategorySlug;
      breadcrumbItems.push({ "@type": "ListItem", "position": bcPos++, "name": primaryPath.subcategoryName || primaryPath.subcategorySlug, "item": `${SITE_URL}/${subCanonical}` });
    }
    if (primaryPath.subcategorySlug && primaryPath.subSubcategorySlug) {
      breadcrumbItems.push({ "@type": "ListItem", "position": bcPos++, "name": primaryPath.subSubcategoryName || primaryPath.subSubcategorySlug, "item": `${SITE_URL}/products/${primaryPath.categorySlug}/${primaryPath.subcategorySlug}/${primaryPath.subSubcategorySlug}` });
    }
  } else if (catName) {
    breadcrumbItems.push({ "@type": "ListItem", "position": bcPos++, "name": catName, "item": `${SITE_URL}/products/${meta.category}` });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    "position": bcPos,
    "name": meta.title,
    "item": `${SITE_URL}/${slug}`,
  });
  const breadcrumbSchema = { "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": breadcrumbItems };

  const ogImage = meta.image && meta.image.startsWith("http") ? meta.image : `${SITE_URL}${meta.image || "/og-image.png"}`;

  const lcpImageUrl = (meta.images.length > 0 ? meta.images[0] : meta.image) || "";
  // ─── Admin JSON-LD override ──────────────────────────────────────────────────
  // Strategy (Variant B):
  //   • If admin set seoJsonLd with @type Product/ProductGroup → merge its fields
  //     ON TOP of the auto-generated productSchema (admin wins, auto fills the gaps).
  //     Placeholder/empty URLs are silently skipped so stale admin data can't break
  //     a valid auto-generated field.  Result: exactly ONE Product schema.
  //   • Non-Product types (FAQPage, VideoObject, etc.) from admin are appended as a
  //     separate <script> block alongside the main Product schema.
  const isPlaceholderValue = (v: any): boolean =>
    typeof v === "string" && (v.includes("/placeholder") || v.includes("example.com") || v.trim() === "");

  let customNonProductScript = "";
  if ((meta as any).seoJsonLd) {
    try {
      const parsed = JSON.parse((meta as any).seoJsonLd);

      // Extract the first Product/ProductGroup object (parsed may be array or plain object)
      const extractProduct = (obj: any): Record<string, any> | null => {
        if (!obj) return null;
        if (Array.isArray(obj)) {
          for (const x of obj) { const f = extractProduct(x); if (f) return f; }
          return null;
        }
        const t = obj["@type"];
        return (t === "Product" || t === "ProductGroup") ? obj : null;
      };

      const adminProduct = extractProduct(parsed);
      if (adminProduct) {
        // Merge admin fields on top of auto-generated productSchema (admin overrides)
        for (const [key, val] of Object.entries(adminProduct)) {
          if (key === "@context" || key === "@type") continue;  // keep auto-generated type
          if (isPlaceholderValue(val)) continue;                // skip stale placeholders
          (productSchema as any)[key] = val;
        }
      }

      // Collect any non-Product schemas from admin (e.g. FAQPage) to append separately
      const nonProductItems = Array.isArray(parsed)
        ? parsed.filter((x: any) => x && x["@type"] !== "Product" && x["@type"] !== "ProductGroup")
        : (parsed && parsed["@type"] !== "Product" && parsed["@type"] !== "ProductGroup" ? [parsed] : []);
      if (nonProductItems.length > 0) {
        customNonProductScript = `\n  <script type="application/ld+json">${JSON.stringify(nonProductItems)}</script>`;
      }
    } catch { /* invalid JSON — skip silently */ }
  }

  const head = baseHead({
    title,
    description: desc,
    canonical: `${SITE_URL}/${slug}`,
    ogImage,
    ogType: "product",
    jsonLd: safeJsonLd([productSchema, organizationSchema, breadcrumbSchema]),
    // Preload the first product photo so the browser starts fetching it
    // before it parses the <img> tag — directly improves LCP score.
    preloadImage: lcpImageUrl.startsWith("http") ? lcpImageUrl : undefined,
  }) + customNonProductScript;

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

  const breadcrumbSegmentsHtml = primaryPath
    ? (() => {
        const segs: string[] = [];
        segs.push(`<a href="/products/${esc(primaryPath.categorySlug)}">${esc(CAT_META[primaryPath.categorySlug]?.name || primaryPath.categorySlug)}</a>`);
        if (primaryPath.subcategorySlug) {
          const subCanonical = CYRILLIC_TO_CANONICAL[primaryPath.subcategorySlug] || primaryPath.subcategorySlug;
          segs.push(`<a href="/${esc(subCanonical)}">${esc(primaryPath.subcategoryName || primaryPath.subcategorySlug)}</a>`);
        }
        if (primaryPath.subcategorySlug && primaryPath.subSubcategorySlug) {
          segs.push(`<a href="/products/${esc(primaryPath.categorySlug)}/${esc(primaryPath.subcategorySlug)}/${esc(primaryPath.subSubcategorySlug)}">${esc(primaryPath.subSubcategoryName || primaryPath.subSubcategorySlug)}</a>`);
        }
        return segs.join(" / ");
      })()
    : (catName ? `<a href="/products/${esc(meta.category)}">${esc(catName)}</a>` : "");

  const breadcrumbHtml = `<div class="breadcrumb">
  <a href="/">Главная</a> /
  <a href="/products">Каталог</a>${breadcrumbSegmentsHtml ? ` / ${breadcrumbSegmentsHtml}` : ""} /
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
  ${catPaths.length > 0 ? `<p>Разделы: ${catPaths.map((p) => {
    const segs: string[] = [];
    segs.push(`<a href="/products/${esc(p.categorySlug)}">${esc(CAT_META[p.categorySlug]?.name || p.categorySlug)}</a>`);
    if (p.subcategorySlug) {
      const subCanonical = CYRILLIC_TO_CANONICAL[p.subcategorySlug] || p.subcategorySlug;
      segs.push(`<a href="/${esc(subCanonical)}">${esc(p.subcategoryName || p.subcategorySlug)}</a>`);
    }
    if (p.subcategorySlug && p.subSubcategorySlug) {
      segs.push(`<a href="/products/${esc(p.categorySlug)}/${esc(p.subcategorySlug)}/${esc(p.subSubcategorySlug)}">${esc(p.subSubcategoryName || p.subSubcategorySlug)}</a>`);
    }
    return segs.join(" → ");
  }).join(" · ")}</p>` : ""}
  ${meta.description ? `<p class="desc" style="margin-top:1rem;max-width:none">${esc(meta.description)}</p>` : ""}
  ${featureBadgesHtml}
  ${meta.seoBody ? `<div style="margin-top:1rem"><h2>Подробнее о товаре</h2>${meta.seoBody}</div>` : ""}
  ${meta.specsHtml
    ? `<div style="margin-top:.75rem"><h2>Характеристики</h2>${meta.specsHtml}</div>`
    : `${meta.composition ? `<p style="margin-top:.75rem"><strong>Состав:</strong> ${esc(meta.composition)}</p>` : ""}
  ${meta.careInstructions ? `<p style="margin-top:.5rem"><strong>Уход:</strong> ${esc(meta.careInstructions)}</p>` : ""}`
  }
  ${meta.measurements && meta.measurements.length > 0 ? (() => {
    const cols = Object.keys(meta.measurements[0]);
    const header = cols.map(c => `<th>${esc(c)}</th>`).join("");
    const rows = meta.measurements.map(row =>
      `<tr>${cols.map(c => `<td>${esc(String(row[c] ?? ""))}</td>`).join("")}</tr>`
    ).join("\n");
    return `<div style="margin-top:.75rem;overflow-x:auto"><strong>Таблица размеров (см):</strong><table style="border-collapse:collapse;margin-top:.4rem;font-size:.85rem"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  })() : ""}
  <p style="margin-top:.75rem">Доставка по всей России СДЭК.</p>
  <a href="/${esc(slug)}" class="buy-btn">Купить на сайте</a>
</div>
${variantsHtml}
${reviewsHtml}
${recsHtml}`;

  return wrapPage(head, body);
}

/**
 * Legacy URL slugs → { category, subcategoryName }.
 * Mirrors SlugResolver.tsx LEGACY_SLUG_MAP so bots hitting /sweaters, /hoodies etc.
 * get a fully-rendered SSR page with the correct self-canonical.
 */
const BOT_LEGACY_SLUG_MAP: Record<string, { category: string; subcategory: string }> = {
  hoodies:               { category: "clothing",    subcategory: "Толстовки" },
  sweatshirts:           { category: "clothing",    subcategory: "Свитшоты" },
  sweaters:              { category: "clothing",    subcategory: "Свитера" },
  "t-shirts":            { category: "clothing",    subcategory: "Футболки" },
  shorts:                { category: "clothing",    subcategory: "Шорты" },
  hats:                  { category: "accessories", subcategory: "Шапки" },
  bags:                  { category: "accessories", subcategory: "Сумки" },
  remni:                 { category: "accessories", subcategory: "Ремни" },
  "sportivnye-40-45":    { category: "socks",       subcategory: "Спортивные (40-45)" },
  "sportivnye-34-39-2":  { category: "socks",       subcategory: "Спортивные (34-39)" },
  "tula-designers":      { category: "merch",       subcategory: "Тульские Дизайнеры" },
  // Category-level legacy slugs (empty subcategory → 301 to /products/:category)
  clothes:               { category: "clothing",    subcategory: "" },
  rasprodazha:           { category: "sale",        subcategory: "" },
  "rasprodazha-2":       { category: "sale",        subcategory: "" },
  "podarochnye-nabory":  { category: "merch",       subcategory: "" },
};

/**
 * Transliterated YDB/schema subcategory slugs → preferred English canonical slug.
 * When a bot hits /tolstovki it gets 301 → /hoodies so only the English URL is indexed.
 * Keys are generated by transliterateToSlug() from the Russian subcategory names.
 */
export const CYRILLIC_TO_CANONICAL: Record<string, string> = {
  tolstovki:  "hoodies",
  svitshoty:  "sweatshirts",
  svitera:    "sweaters",
  futbolki:   "t-shirts",
  shorty:     "shorts",
  shapki:     "hats",
  sumki:      "bags",
};

function renderSubcategory(subSlug: string, canonicalSlug?: string): string | null {
  // Build the live category map the same way /api/categories does:
  // read from the in-memory page-settings cache (site_config.categories_data),
  // fall back to the static schema CATEGORIES if the cache is cold.
  // This guarantees slug lookups match actual DB slugs (e.g. "hoodies", not "tolstovki").
  let cats = CATEGORIES; // static fallback (schema slugs)
  try {
    const siteConfig = getCachedRawPageSettings('site_config');
    if (siteConfig?.categories_data) {
      const raw = typeof siteConfig.categories_data === 'string'
        ? JSON.parse(siteConfig.categories_data)
        : siteConfig.categories_data;
      const normalized = normalizeCategories(raw);
      if (Object.keys(normalized).length > 0) cats = normalized;
    }
  } catch { /* keep static fallback */ }

  const found = findCategoryBySubcategorySlug(cats, subSlug);
  if (!found) return null;

  const { category, subcategory } = found;
  const products = getCachedProductsByCategory(category.slug, 500);
  if (products.length === 0) {
    // Холодный кэш — временная страница с правильным canonical, не SPA-оболочка.
    if (!isProductsCacheWarm()) {
      const pageSlug = canonicalSlug ?? subSlug;
      const subSeo = getSeoOverride(`subcategory:${category.slug}:${subSlug}`);
      const catMeta = CAT_META[category.slug];
      const catName = catMeta?.name || category.name;
      const isMerch = category.slug === "merch";
      const title = subSeo.title || (isMerch
        ? `Мерч ${subcategory.name} — купить официальный мерч | ${SITE_NAME}`
        : `${subcategory.name} — купить в ${SITE_NAME} | ${catName}`);
      const desc = subSeo.description || (isMerch
        ? `Официальный мерч ${subcategory.name} в интернет-магазине BMGBRAND: одежда и аксессуары с авторскими принтами. Доставка по всей России СДЭК.`
        : `${subcategory.name} от BMGBRAND — ${catName.toLowerCase()} с авторскими принтами. Доставка по всей России.`);
      return renderLoadingPlaceholder({
        title,
        description: desc,
        canonical: `${SITE_URL}/${pageSlug}`,
        breadcrumb: `<a href="/">Главная</a> / <a href="/products">Каталог</a> / <a href="/products/${esc(category.slug)}">${esc(catName)}</a> / ${esc(subcategory.name)}`,
        body: `<h1>${esc(subcategory.name)}</h1><p class="desc">${esc(desc)}</p><p>Товары раздела загружаются — зайдите чуть позже.</p>`,
      });
    }
    return null;
  }

  // Products belong to a subcategory either directly (p.subcategory) or via
  // additionalCategories (e.g. merch collabs like "Людмил Огурченко" whose products
  // live under clothing/accessories but list the merch subcategory in additionalCategories).
  // Единый резолвер shared/schema.ts — тот же, что в sitemap.xml и /api/products.
  const catIndex = buildCategoryIndex(cats);
  const targetCatSlug = category.slug;
  const targetSubSlug = subcategory.slug;
  const filtered = (products as any[]).filter((p: any) =>
    resolveProductCategoryPaths(p, catIndex).some((path) =>
      path.categorySlug === targetCatSlug && path.subcategorySlug === targetSubSlug
    )
  );
  if (filtered.length === 0) return null;

  const inStock = filtered.filter((p: any) => p.stock > 0);
  const outOfStock = filtered.filter((p: any) => p.stock === 0);
  const allSorted = [...inStock, ...outOfStock];

  const catMeta = CAT_META[category.slug];
  const catName = catMeta?.name || category.name;
  const isMerch = category.slug === "merch";

  const subSeo = getSeoOverride(`subcategory:${category.slug}:${subSlug}`);
  const title = subSeo.title || (isMerch
    ? `Мерч ${subcategory.name} — купить официальный мерч | ${SITE_NAME}`
    : `${subcategory.name} — купить в ${SITE_NAME} | ${catName}`);
  const desc = subSeo.description || (isMerch
    ? `Официальный мерч ${subcategory.name} в интернет-магазине BMGBRAND: одежда и аксессуары с авторскими принтами. Доставка по всей России СДЭК.`
    : `${subcategory.name} от BMGBRAND — ${catName.toLowerCase()} с авторскими принтами. ${inStock.length > 0 ? `В наличии: ${inStock.length} моделей.` : ''} Доставка по всей России.`);

  // canonicalSlug is the URL the bot actually arrived at (e.g. "sweaters").
  // subSlug is the internal YDB slug (e.g. "svitera"). Use canonicalSlug when set.
  const pageSlug = canonicalSlug ?? subSlug;

  // Crawlable links to sub-subcategories (level 3) so crawlers discover them
  // from the parent subcategory page, not just from sitemap.xml.
  const subSubLinkItems = (subcategory.subSubcategories || [])
    .map((ss: any) => `<li><a href="/products/${esc(category.slug)}/${esc(subcategory.slug)}/${esc(ss.slug)}">${esc(ss.name)}</a></li>`)
    .join("");
  const subSubLinksBlock = subSubLinkItems
    ? `<h2>Подразделы</h2><ul>${subSubLinkItems}</ul>`
    : "";

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
        { "@type": "ListItem", "position": 3, "name": catName, "item": `${SITE_URL}/products/${category.slug}` },
        { "@type": "ListItem", "position": 4, "name": subcategory.name, "item": `${SITE_URL}/${pageSlug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": subcategory.name,
      "description": desc,
      "url": `${SITE_URL}/${pageSlug}`,
      "numberOfItems": allSorted.length,
      "itemListElement": allSorted.slice(0, 30).map((p: any, i: number) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": buildListingProductItem(p),
      })),
    },
  ]);

  const head = baseHead({
    title,
    description: desc,
    canonical: `${SITE_URL}/${pageSlug}`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const cards = allSorted.map((p: any) => `
    <article class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status ${cardStatus(p).cls}">${cardStatus(p).text}</div>
    </article>`).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / <a href="/products/${esc(category.slug)}">${esc(catName)}</a> / ${esc(subcategory.name)}</div>
<h1>${esc(subcategory.name)}</h1>
<p class="desc">${esc(desc)}</p>
<p style="margin-bottom:1rem;color:#888;font-size:.9rem">Всего: <strong>${allSorted.length}</strong>. В наличии: <strong>${inStock.length}</strong>.</p>
<div class="grid">${cards}</div>
${subSubLinksBlock}
<p style="margin-top:1.5rem"><a href="/products/${esc(category.slug)}">← Все ${esc(catName)}</a></p>`;

  return wrapPage(head, body);
}

function renderEmptySubSubcategory(
  category: { name: string; slug: string },
  subcategory: { name: string; slug: string },
  subSubcategory: { name: string; slug: string },
): string {
  const catMeta = CAT_META[category.slug];
  const catName = catMeta?.name || category.name;
  const pageUrl = `${SITE_URL}/products/${category.slug}/${subcategory.slug}/${subSubcategory.slug}`;
  const title = `${subSubcategory.name} — купить в ${SITE_NAME} | ${subcategory.name}, ${catName}`;
  const desc = `В разделе «${subSubcategory.name}» пока нет товаров. Посмотрите другие разделы каталога ${SITE_NAME}.`;

  const head = baseHead({
    title,
    description: desc,
    canonical: pageUrl,
    ogImage: `${SITE_URL}/og-image.png`,
    extra: '<meta name="robots" content="noindex, follow">',
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / <a href="/products/${esc(category.slug)}">${esc(catName)}</a> / <a href="/${esc(subcategory.slug)}">${esc(subcategory.name)}</a> / ${esc(subSubcategory.name)}</div>
<h1>${esc(subSubcategory.name)}</h1>
<p class="desc">${esc(desc)}</p>
<p style="margin-top:1.5rem"><a href="/${esc(subcategory.slug)}">← Все ${esc(subcategory.name)}</a></p>`;

  return wrapPage(head, body);
}

/**
 * Временная страница на время холодного кэша (первые секунды после рестарта).
 * Раньше в этом случае боты получали пустую SPA-оболочку с заголовком и
 * canonical главной — поисковики и ИИ-краулеры «не видели» раздел. Теперь
 * отдаём полноценный HTML с правильными canonical/title, хлебными крошками
 * и ссылками на соседние разделы. baseHead по умолчанию отдаёт index,follow —
 * краулер успевает заиндексировать страницу, а когда кэш прогреется и товары
 * появятся, следующий обход получит полную страницу (кэш ботов живёт 5 минут).
 */
function renderLoadingPlaceholder(opts: {
  title: string;
  description: string;
  canonical: string;
  breadcrumb: string;
  body: string;
}): string {
  const head = baseHead({
    title: opts.title,
    description: opts.description,
    canonical: opts.canonical,
    ogImage: `${SITE_URL}/og-image.png`,
  });
  return wrapPage(head, `<div class="breadcrumb">${opts.breadcrumb}</div>${opts.body}`);
}

function renderSubSubcategoryLoading(
  category: { name: string; slug: string },
  subcategory: { name: string; slug: string },
  subSubcategory: { name: string; slug: string },
): string {
  const catMeta = CAT_META[category.slug];
  const catName = catMeta?.name || category.name;
  const pageUrl = `${SITE_URL}/products/${category.slug}/${subcategory.slug}/${subSubcategory.slug}`;
  const subSubSeo = getSeoOverride(`subsubcategory:${category.slug}:${subcategory.slug}:${subSubcategory.slug}`);
  const title = subSubSeo.title || `${subSubcategory.name} — купить в ${SITE_NAME} | ${subcategory.name}, ${catName}`;
  const desc = subSubSeo.description || `${subSubcategory.name} от BMGBRAND — ${subcategory.name.toLowerCase()}, ${catName.toLowerCase()} с авторскими принтами. Доставка по всей России СДЭК.`;

  // Ссылки на соседние под-подкатегории — краулеры продолжают обход по разделу
  let siblingLinks = "";
  try {
    const live = getLiveCategories()[category.slug]?.subcategories || [];
    const liveSub = (live as any[]).find((s: any) => s.slug === subcategory.slug);
    const siblings: Array<{ name: string; slug: string }> = (liveSub?.subSubcategories || []);
    if (siblings.length > 0) {
      siblingLinks = `<h2>Разделы</h2><ul>${siblings.map((ss: any) =>
        `<li><a href="/products/${esc(category.slug)}/${esc(subcategory.slug)}/${esc(ss.slug)}">${esc(ss.name)}</a></li>`
      ).join("")}</ul>`;
    }
  } catch { /* нет конфига — обходимся без ссылок */ }

  const head = baseHead({ title, description: desc, canonical: pageUrl, ogImage: `${SITE_URL}/og-image.png` });
  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / <a href="/products/${esc(category.slug)}">${esc(catName)}</a> / <a href="/${esc(subcategory.slug)}">${esc(subcategory.name)}</a> / ${esc(subSubcategory.name)}</div>
<h1>${esc(subSubcategory.name)}</h1>
<p class="desc">${esc(desc)}</p>
<p>Товары раздела загружаются — зайдите чуть позже.</p>
${siblingLinks}
<p style="margin-top:1.5rem"><a href="/${esc(subcategory.slug)}">← Все ${esc(subcategory.name)}</a></p>`;
  return wrapPage(head, body);
}

function renderSubSubcategory(catSlug: string, subSlug: string, subSubSlug: string): string | null {
  let cats = CATEGORIES as Record<string, any>;
  try {
    const raw = getCachedRawPageSettings('site_config');
    if (raw?.categories_data) {
      const parsed = typeof raw.categories_data === 'string'
        ? JSON.parse(raw.categories_data)
        : raw.categories_data;
      const normalized = normalizeCategories(parsed);
      if (Object.keys(normalized).length > 0) cats = normalized;
    }
  } catch { /* keep static fallback */ }

  const found = findCategoryBySubSubcategorySlug(cats, subSlug, subSubSlug);
  if (!found) return null;

  const { category, subcategory, subSubcategory } = found;
  const products = getCachedProductsByCategory(category.slug, 1000);
  // Кэш тёплый и товаров нет → честная noindex-страница (не индексируем пустоту).
  if (products.length === 0 && isProductsCacheWarm()) {
    return renderEmptySubSubcategory(category, subcategory, subSubcategory);
  }
  // Кэш ещё холодный (первые секунды после рестарта) — отдаём временную страницу
  // с правильным canonical/title и ссылками на соседние разделы, а НЕ пустую
  // SPA-оболочку с заголовком главной: раньше из-за этого поисковики и
  // ИИ-краулеры «не видели» 3-й уровень категорий.
  if (products.length === 0) {
    return renderSubSubcategoryLoading(category, subcategory, subSubcategory);
  }

  // Единый резолвер shared/schema.ts — тот же, что в sitemap.xml и /api/products.
  const catIndex = buildCategoryIndex(cats);
  const targetCatSlug = category.slug;
  const targetSubSlug = subcategory.slug;
  const targetSubSubSlug = subSubcategory.slug;
  const filtered = (products as any[]).filter((p: any) =>
    resolveProductCategoryPaths(p, catIndex).some((path) =>
      path.categorySlug === targetCatSlug &&
      path.subcategorySlug === targetSubSlug &&
      path.subSubcategorySlug === targetSubSubSlug
    )
  );
  // Валидная под-подкатегория без товаров → отдаём честную страницу с noindex,
  // а не пустую SPA-оболочку с тайтлом главной (soft-404).
  if (filtered.length === 0) {
    return renderEmptySubSubcategory(category, subcategory, subSubcategory);
  }

  const inStock = filtered.filter((p: any) => p.stock > 0);
  const outOfStock = filtered.filter((p: any) => p.stock === 0);
  const allSorted = [...inStock, ...outOfStock];

  const catMeta = CAT_META[category.slug];
  const catName = catMeta?.name || category.name;
  const pageUrl = `${SITE_URL}/products/${category.slug}/${subSlug}/${subSubSlug}`;

  const subSubSeo = getSeoOverride(`subsubcategory:${catSlug}:${subSlug}:${subSubSlug}`);
  const title = subSubSeo.title || `${subSubcategory.name} — купить в ${SITE_NAME} | ${subcategory.name}, ${catName}`;
  const desc = subSubSeo.description || `${subSubcategory.name} от BMGBRAND — ${subcategory.name.toLowerCase()}, ${catName.toLowerCase()} с авторскими принтами. ${inStock.length > 0 ? `В наличии: ${inStock.length} моделей.` : ''} Доставка по всей России СДЭК.`;

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${SITE_URL}/products` },
        { "@type": "ListItem", "position": 3, "name": catName, "item": `${SITE_URL}/products/${category.slug}` },
        { "@type": "ListItem", "position": 4, "name": subcategory.name, "item": `${SITE_URL}/${subSlug}` },
        { "@type": "ListItem", "position": 5, "name": subSubcategory.name, "item": pageUrl },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": subSubcategory.name,
      "description": desc,
      "url": pageUrl,
      "numberOfItems": allSorted.length,
      "itemListElement": allSorted.slice(0, 30).map((p: any, i: number) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": buildListingProductItem(p),
      })),
    },
  ]);

  const head = baseHead({ title, description: desc, canonical: pageUrl, ogImage: `${SITE_URL}/og-image.png`, jsonLd });

  const cards = allSorted.map((p: any) => `
    <article class="card">
      <div class="name"><a href="/${esc(p.slug)}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status ${cardStatus(p).cls}">${cardStatus(p).text}</div>
    </article>`).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products">Каталог</a> / <a href="/products/${esc(category.slug)}">${esc(catName)}</a> / <a href="/${esc(subSlug)}">${esc(subcategory.name)}</a> / ${esc(subSubcategory.name)}</div>
<h1>${esc(subSubcategory.name)}</h1>
<p class="desc">${esc(desc)}</p>
<p style="margin-bottom:1rem;color:#888;font-size:.9rem">Всего: <strong>${allSorted.length}</strong>. В наличии: <strong>${inStock.length}</strong>.</p>
<div class="grid">${cards}</div>
<p style="margin-top:1.5rem"><a href="/${esc(subSlug)}">← Все ${esc(subcategory.name)}</a></p>`;

  return wrapPage(head, body);
}

function renderAbout(): string {
  const description = "BOOOMERANGS (BMGBRAND) — российский бренд одежды из Тулы. Основан в 2006 году, своё производство с 2019 года. 200+ моделей носков, мерч для артистов, встроенный ИИ-консультант BOOOM AI.";

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "BMGBRAND",
      "alternateName": ["Booomerangs", "BOOOMERANGS"],
      "description": description,
      "url": SITE_URL,
      "logo": `${SITE_URL}/favicon.png`,
      "image": `${SITE_URL}/images/about-hero.webp`,
      "foundingDate": "2006",
      "foundingLocation": {
        "@type": "Place",
        "name": "Тула, Россия",
      },
      "founder": {
        "@type": "Person",
        "name": "Евгений Соболев",
        "jobTitle": "Основатель BOOOMERANGS",
      },
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Тула",
        "addressRegion": "Тульская область",
        "addressCountry": "RU",
      },
      "sameAs": [
        "https://vk.com/bmgbrand",
        "https://t.me/bmg_booomerangs",
      ],
      "knowsAbout": ["streetwear", "мерч", "носки с принтом", "одежда с авторскими принтами", "ИИ-консультант BOOOM AI"],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "О бренде", "item": `${SITE_URL}/about` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": "Евгений Соболев",
      "jobTitle": "Основатель",
      "worksFor": {
        "@type": "Organization",
        "name": "BMGBRAND",
        "url": SITE_URL,
      },
      "quote": "Сначала приходит вдохновение. Потом эскиз, подбор тканей, тестирование — стираем и носим сами, пока не убедимся что вещь готова. И только потом — в производство.",
    },
  ]);

  const aboutSeo = getSeoOverride("static:about");
  const head = baseHead({
    title: aboutSeo.title || `О бренде BOOOMERANGS — история, производство, команда | ${SITE_NAME}`,
    description: aboutSeo.description || description,
    canonical: `${SITE_URL}/about`,
    ogImage: `${SITE_URL}/images/about-hero.webp`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / О бренде</div>
<h1>О бренде BOOOMERANGS (BMGBRAND)</h1>
<p class="desc">${esc(description)}</p>

<h2>Цифры</h2>
<ul>
  <li><strong>2006</strong> — год открытия первого магазина</li>
  <li><strong>200+</strong> моделей носков в каталоге</li>
  <li><strong>100+</strong> магазинов по всей России</li>
</ul>

<h2>История бренда</h2>
<ul>
  <li><strong>2006</strong> — открыли StreetWear — мультибренд уличной одежды. С него всё началось.</li>
  <li><strong>2019</strong> — запустили полный производственный цикл в Узловском районе Тульской области. Теперь шьём, печатаем и упаковываем сами.</li>
  <li><strong>2020</strong> — в пандемию сделали первые мемные носки с принтами соды, соли и сахара. Покупатели оценили.</li>
</ul>

<h2>Слово основателя</h2>
<blockquote style="border-left:3px solid #ccc;padding-left:1rem;margin:1rem 0;color:#444;font-style:italic">
  «Сначала приходит вдохновение. Потом эскиз, подбор тканей, тестирование — стираем и носим сами, пока не убедимся что вещь готова. И только потом — в производство.»
</blockquote>
<p style="color:#888;font-size:.9rem">Евгений Соболев — основатель BOOOMERANGS</p>

<h2>Что мы делаем</h2>
<div class="grid">
  <div class="card">
    <div class="name">Одежда</div>
    <p class="desc" style="margin:0">Футболки, худи, свитшоты, куртки, брюки — оверсайз-силуэт, унисекс. Ничего лишнего.</p>
  </div>
  <div class="card">
    <div class="name">Носки</div>
    <p class="desc" style="margin:0">200+ моделей — мемные, яркие, классические. Одни из самых узнаваемых в России.</p>
  </div>
  <div class="card">
    <div class="name">Аксессуары</div>
    <p class="desc" style="margin:0">Шопперы, кепки, шапки, сумки. Всё что завершает образ.</p>
  </div>
  <div class="card">
    <div class="name">Мерч под ключ</div>
    <p class="desc" style="margin:0">Производим официальный мерч для артистов, фестивалей и брендов. Официальный партнёр мерча «Дикая мята».</p>
  </div>
  <div class="card">
    <div class="name">ИИ-консультант BOOOM AI</div>
    <p class="desc" style="margin:0">Встроенный ИИ-ассистент на странице каждого товара — помогает подобрать размер по параметрам тела, рассказывает о составе, уходе и коллаборациях с артистами.</p>
  </div>
</div>

<h2>Признание</h2>
<p>Участник VI федерального форума-фестиваля <strong>Российская Креативная Неделя</strong>. Включены в экосистему креативных индустрий Тульской области. Цель — стать одним из символов региона и продвигать Тулу как модную столицу.</p>

<p style="margin-top:2rem">
  <a href="/products" class="buy-btn" style="margin-right:1rem">Перейти в каталог</a>
  <a href="/merch-na-zakaz" style="color:#1C1C1C;font-weight:600;text-decoration:underline">Заказать мерч</a>
</p>`;

  return wrapPage(head, body);
}

// ─── Express middleware ───────────────────────────────────────────────────────

function renderFaq(): string {
  const faqItems = getFaqItems();
  const description = "Ответы на частые вопросы о заказах, доставке, оплате и возврате в интернет-магазине BMGBRAND.";

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqItems.map(item => ({
        "@type": "Question",
        "name": item.question,
        "acceptedAnswer": { "@type": "Answer", "text": item.answer },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Вопросы и ответы", "item": `${SITE_URL}/faq` },
      ],
    },
  ]);

  const faqSeo = getSeoOverride("static:faq");
  const head = baseHead({
    title: faqSeo.title || `Вопросы и ответы | ${SITE_NAME}`,
    description: faqSeo.description || description,
    canonical: `${SITE_URL}/faq`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Вопросы и ответы</div>
<h1>Часто задаваемые вопросы</h1>
<p class="desc">${esc(description)}</p>
${faqItems.map(item => `<h2>${esc(item.question)}</h2><p>${esc(item.answer)}</p>`).join("\n")}
`;

  return wrapPage(head, body);
}

function renderMerchOrder(): string {
  const DEFAULT_MERCH_FAQ = [
    { q: "Какой минимальный тираж для создания мерча на заказ?", a: "Минимальный тираж зависит от типа продукции: носки — от 50 пар, футболки и худи — от 1 штуки, аксессуары — от 30 единиц." },
    { q: "Сколько стоит мерч на заказ?", a: "Носки с принтом — от 180 ₽/пара, футболки — от 900 ₽, худи — от 1 800 ₽, брюки — от 1 500 ₽. Точный расчёт делаем индивидуально." },
    { q: "Вы помогаете с разработкой дизайна?", a: "Да. Разработаем дизайн с нуля или адаптируем ваши материалы. Дизайнерская работа включена в стоимость заказа." },
    { q: "Сколько времени занимает изготовление?", a: "Одежда — от 3 дней. Носки — от 14 рабочих дней. Срочные заказы обсуждаются отдельно." },
    { q: "Вы работаете с юридическими лицами и ИП?", a: "Да. Работаем с физлицами, ИП, ООО, блогерами, музыкантами и организаторами мероприятий. Опыт: Гудтаймс, Молодость внутри, Дикая Мята, Драгни, МультFильмы." },
    { q: "Можно ли заказать мерч с логотипом компании?", a: "Конечно. Предоставьте логотип в векторном формате (AI, EPS, SVG) — подготовим макет. Если фирменного стиля нет — разработаем с нуля." },
    { q: "Вы доставляете в Москву, Санкт-Петербург и другие регионы?", a: "Да, отправляем по всей России — в Москву, СПб и другие города. Работаем с СДЭК, ПЭК, Почтой России, Байкал Сервисом." },
    { q: "Что такое корпоративный мерч и как его заказать?", a: "Корпоративный мерч — брендированная одежда и аксессуары с логотипом компании. Подходит для сотрудников, мероприятий и подарков. Оставьте заявку — менеджер свяжется в течение 24 часов." },
  ];

  // Read content overrides from cached page settings (no YDB calls)
  const cachedMerchSettings = getCachedRawPageSettings("merch_order") || {};
  const content = (cachedMerchSettings.content as Record<string, any>) || {};
  const pageH1: string = (content.h1 as string) || "Мерч на заказ — производство мерча под ключ от BMGBRAND";
  const techText: string = (content.techText as string) || "Используем шелкографию, термотрансфер и вышивку. Это обеспечивает долговечность и яркость принта после многократных стирок. Подбираем технологию под ваш дизайн, материал и тираж — менеджер расскажет о плюсах каждого метода при обсуждении заказа.";
  const b2bText: string = (content.b2bText as string) || "Заказать корпоративный мерч оптом для вашей компании, фестиваля или бренда. Работаем с юридическими лицами, ИП и физическими лицами. Минимальный тираж — от 20 штук одежды или от 50 пар носков. Бесплатный макет и полный цикл согласования перед запуском производства. Доставляем по всей России: Москва, Санкт-Петербург и регионы.";
  const rawFaq = Array.isArray(content.faqItems) && content.faqItems.length > 0
    ? (content.faqItems as Array<{ question: string; answer: string }>).map(f => ({ q: f.question, a: f.answer }))
    : DEFAULT_MERCH_FAQ;
  const MERCH_FAQ = rawFaq;

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": `${SITE_NAME} (Booomerangs)`,
      "url": SITE_URL,
      "image": `${SITE_URL}/og-image.png`,
      "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары с авторскими принтами. Работаем с юридическими лицами, ИП и физлицами по всей России.",
      "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressRegion": "Тульская область", "addressCountry": "RU" },
      "areaServed": ["Москва", "Санкт-Петербург", "RU"],
      "priceRange": "от 180 ₽",
      "sameAs": ["https://vk.com/bmgbrand", "https://t.me/bmg_booomerangs"],
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": "Создание мерча на заказ",
      "provider": {
        "@type": "Organization",
        "name": SITE_NAME,
        "url": SITE_URL,
        "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressCountry": "RU" },
      },
      "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары. Шелкография, термотрансфер, вышивка. Работаем с компаниями, блогерами, артистами по всей России. Тираж от 20 штук. Разработка дизайна бесплатно.",
      "areaServed": "RU",
      "serviceType": "Производство мерча",
      "offers": [
        { "@type": "Offer", "name": "Носки с принтом на заказ", "priceCurrency": "RUB", "price": 180, "description": "Носки с принтом от 180 ₽/пара при тираже от 50 пар. 200+ дизайнов." },
        { "@type": "Offer", "name": "Футболки с логотипом на заказ", "priceCurrency": "RUB", "price": 900, "description": "Футболки с принтом от 900 ₽. Шелкография, термотрансфер. 100% хлопок." },
        { "@type": "Offer", "name": "Худи и толстовки с принтом на заказ", "priceCurrency": "RUB", "price": 1800, "description": "Худи и свитшоты от 1 800 ₽. Вышивка и шелкография. Трёхнитка." },
        { "@type": "Offer", "name": "Корпоративный мерч", "priceCurrency": "RUB", "price": 180, "description": "Мерч для компаний, мероприятий, фестивалей. Брендирование под ключ." },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "name": "Как заказать мерч в BMGBRAND",
      "description": "Производство мерча на заказ под ключ: от заявки до доставки по всей России.",
      "step": [
        { "@type": "HowToStep", "position": 1, "name": "Заявка", "text": "Заполните форму на сайте. Опишите идею, тип товара и тираж." },
        { "@type": "HowToStep", "position": 2, "name": "Обсуждение", "text": "Менеджер свяжется в течение 24 часов. Уточним детали и стоимость." },
        { "@type": "HowToStep", "position": 3, "name": "Дизайн", "text": "Разработаем стиль с нуля или адаптируем ваши материалы." },
        { "@type": "HowToStep", "position": 4, "name": "Производство", "text": "Запускаем тираж на собственном производстве — полный контроль качества." },
        { "@type": "HowToStep", "position": 5, "name": "Доставка", "text": "Отправим готовый мерч по всей России: Москва, СПб, регионы." },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": MERCH_FAQ.map(({ q, a }) => ({
        "@type": "Question",
        "name": q,
        "acceptedAnswer": { "@type": "Answer", "text": a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Мерч на заказ", "item": `${SITE_URL}/merch-na-zakaz` },
      ],
    },
  ]);

  const seoOverride = getSeoOverride("merch_order");
  const title = seoOverride.title || `Мерч на заказ — футболки, худи, носки с принтом от 180 ₽ | ${SITE_NAME}`;
  const description = seoOverride.description || "Производство мерча на заказ от BMGBRAND: футболки от 900 ₽, худи от 1800 ₽, носки от 180 ₽/пара. Тираж от 20 шт. Разработка дизайна бесплатно. Работаем с блогерами, артистами, компаниями. Доставка по всей России — Тула, Москва, регионы.";

  const head = baseHead({
    title,
    description,
    canonical: `${SITE_URL}/merch-na-zakaz`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Мерч на заказ</div>
<h1>Мерч на заказ — производство мерча под ключ от BMGBRAND</h1>
<p class="desc">Производство мерча на заказ: футболки с логотипом, худи с вышивкой, носки с принтом от 180 ₽/пара. Собственное производство в Туле — полный цикл без посредников. Тираж от 20 штук. Бесплатная разработка дизайна. Доставка по всей России: Москва, Санкт-Петербург, регионы.</p>

<h2>Мерч для компаний и брендов</h2>
<p>Заказать корпоративный мерч оптом для вашей компании, фестиваля или бренда. Производим футболки, худи, носки и аксессуары с нанесением логотипа. Работаем с юридическими лицами, ИП и физическими лицами. Минимальный тираж — от 20 штук одежды или от 50 пар носков. Бесплатный макет и полный цикл согласования перед запуском производства.</p>

<h2>Технологии нанесения</h2>
<p>Используем шелкографию, термотрансфер и вышивку. Это обеспечивает долговечность и яркость принта после многократных стирок. Подбираем технологию под ваш дизайн, материал и тираж — менеджер расскажет о плюсах каждого метода при обсуждении заказа.</p>

<h2>Футболки с логотипом на заказ</h2>
<p>Производим футболки оверсайз и классического кроя с нанесением логотипа или авторского принта. Стоимость — от 900 ₽. 100% хлопок, шелкография или термотрансфер. Подходит для корпоративных подарков, мерча блогеров и фирменной одежды сотрудников в Москве, Санкт-Петербурге и других городах России.</p>

<h2>Худи и толстовки с принтом</h2>
<p>Худи и свитшоты с вышивкой или принтом — от 1 800 ₽. Трёхнитка с начёсом, высокое качество пошива на собственном производстве. Доступна вышивка, шелкография и термотрансфер. Отлично подходит для мерча музыкантов, спортивных команд и корпоративного гардероба.</p>

<h2>Носки с символикой компании</h2>
<p>Носки с принтом — от 180 ₽/пара при тираже от 50 пар. 200+ авторских дизайнов, производим носки с любым логотипом или принтом. Хлопок 75%, полиамид 17%, эластан 8%. Один из самых популярных форматов корпоративного мерча и подарков для партнёров.</p>

<h2>Как это работает</h2>
<ol style="margin:.75rem 0;padding-left:1.5rem">
  <li><strong>Заявка</strong> — заполните форму, опишите идею и тираж</li>
  <li><strong>Обсуждение</strong> — менеджер свяжется в течение 24 часов</li>
  <li><strong>Дизайн</strong> — разработаем с нуля или адаптируем ваши материалы</li>
  <li><strong>Производство</strong> — запускаем тираж, полный контроль качества</li>
  <li><strong>Доставка</strong> — отправляем по всей России (Москва, СПб, регионы)</li>
</ol>

<h2>Наши преимущества</h2>
<div class="grid">
  <div class="card"><div class="name">Собственное производство</div><p class="desc" style="margin:0">100% своё производство — никаких посредников. Полный контроль качества на каждом этапе.</p></div>
  <div class="card"><div class="name">Бесплатный макет</div><p class="desc" style="margin:0">Разрабатываем дизайн с нуля или адаптируем ваши материалы. Включено в стоимость заказа.</p></div>
  <div class="card"><div class="name">Контроль качества</div><p class="desc" style="margin:0">Брак — перевыпускаем за наш счёт. Каждая партия проходит контроль перед отгрузкой.</p></div>
  <div class="card"><div class="name">Доставка по РФ</div><p class="desc" style="margin:0">Москва, Санкт-Петербург и все регионы. СДЭК, ПЭК, Почта России, Байкал Сервис.</p></div>
  <div class="card"><div class="name">Опыт с артистами</div><p class="desc" style="margin:0">Гудтаймс, Молодость внутри, Дикая Мята, Драгни, МультFильмы — официальный мерч.</p></div>
  <div class="card"><div class="name">Работа с юр. лицами</div><p class="desc" style="margin:0">ИП, ООО, физлица. Закрывающие документы, договор, счёт на оплату.</p></div>
</div>

<h2>Часто заказывают</h2>
<ul style="margin:.75rem 0;padding-left:1.5rem">
  <li><a href="/products/clothing">Футболки с принтом</a> — оверсайз и классика, от 900 ₽</li>
  <li><a href="/products/clothing">Худи с вышивкой</a> — трёхнитка, от 1 800 ₽</li>
  <li><a href="/products/socks">Носки с логотипом</a> — от 180 ₽/пара, тираж от 50 пар</li>
  <li><a href="/products/accessories">Аксессуары с логотипом</a> — шапки, сумки, кепки, шопперы</li>
  <li><a href="/products/merch">Мерч для артистов</a> — официальный мерч блогеров и музыкантов</li>
</ul>

<h2>Частые вопросы</h2>
${MERCH_FAQ.map(({ q, a }) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("\n")}

<p style="margin-top:2rem">
  <a href="/merch-na-zakaz" class="buy-btn">Оставить заявку на мерч</a>
</p>`;

  return wrapPage(head, body);
}

// ─── /concept — список кампаний предзаказа ────────────────────────────────────

function renderConceptIndex(): string | null {
  // Собираем слаги кампаний из двух источников (как в /api/preorder/campaigns):
  // 1. товары с preorderEnabled + preorderGroup из тёплого кэша
  // 2. ручной список slugs из page_settings("concept_campaigns")
  const allProducts = getCachedProductsForRecommendations(2000);
  const preorderProducts = allProducts.filter((p: any) => p.preorderEnabled && p.preorderGroup);
  const slugsFromProducts = [...new Set(preorderProducts.map((p: any) => p.preorderGroup as string))];

  const campaignsList = getCachedRawPageSettings("concept_campaigns");
  const manualSlugs: string[] = campaignsList?.list?.slugs || [];
  const allSlugs = [...new Set([...slugsFromProducts, ...manualSlugs])];

  // Для каждого слага подтягиваем настройки из кэша
  const campaigns: Array<{
    slug: string; title: string; subtitle: string;
    coverImage: string; productCount: number;
  }> = [];

  for (const slug of allSlugs) {
    const settings = getCachedRawPageSettings(`concept_campaign_${slug}`);
    const hero = settings?.hero || {};
    // Пропускаем скрытые кампании (hero.visible === false)
    if (hero.visible === false) continue;

    const groupProducts = preorderProducts.filter((p: any) => p.preorderGroup === slug);
    const firstImg: string = (groupProducts[0] as any)?.imageUrl || (groupProducts[0] as any)?.thumbnailUrl || "";
    campaigns.push({
      slug,
      title: hero.title || slug,
      subtitle: hero.subtitle || "",
      coverImage: hero.coverImage || hero.heroImage || firstImg,
      productCount: groupProducts.length,
    });
  }

  // Кэш пустой или кампаний нет — пропускаем до React SPA
  if (campaigns.length === 0) return null;

  const conceptSettings = getCachedRawPageSettings("concept");
  const hero = conceptSettings?.hero || {};
  const seoSettings = getCachedRawPageSettings("seo");
  const conceptSeo = seoSettings?.concept || {};
  const pageTitle = conceptSeo.title || `Pre-drop — предзаказы BOOOMERANGS | ${SITE_NAME}`;
  const pageDesc = conceptSeo.description || "Предзаказы и коллаборации BOOOMERANGS — оформи предзаказ на ограниченные коллекции до старта продаж. Уникальный мерч артистов.";

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Pre-drop", "item": `${SITE_URL}/concept` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": "Коллаборации и предзаказы BOOOMERANGS",
      "description": pageDesc,
      "url": `${SITE_URL}/concept`,
      "numberOfItems": campaigns.length,
      "itemListElement": campaigns.map((c, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": {
          "@type": "WebPage",
          "name": c.title,
          "url": `${SITE_URL}/concept/${c.slug}`,
          "description": c.subtitle || `Предзаказ ${c.title} — BOOOMERANGS`,
        },
      })),
    },
  ]);

  const head = baseHead({
    title: pageTitle,
    description: pageDesc,
    canonical: `${SITE_URL}/concept`,
    ogImage: campaigns[0]?.coverImage || `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const heroImgHtml = hero.heroImage
    ? `<div style="margin-bottom:1.5rem"><img src="${esc(hero.heroImage)}" alt="Pre-drop BOOOMERANGS" style="width:100%;max-height:400px;object-fit:cover;border-radius:8px" loading="eager"></div>`
    : "";

  const cards = campaigns.map(c => {
    const imgHtml = c.coverImage
      ? `<div style="aspect-ratio:3/4;overflow:hidden;border-radius:6px;margin-bottom:.75rem"><img src="${esc(c.coverImage)}" alt="${esc(c.title)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`
      : "";
    return `<div class="card" style="padding:0;overflow:hidden">
      ${imgHtml}
      <div style="padding:1rem">
        <div class="name"><a href="/concept/${esc(c.slug)}">${esc(c.title)}</a></div>
        ${c.subtitle ? `<p class="status" style="margin-top:.25rem">${esc(c.subtitle)}</p>` : ""}
        ${c.productCount > 0 ? `<p class="status" style="margin-top:.25rem">${c.productCount} тов.</p>` : ""}
        <a href="/concept/${esc(c.slug)}" class="buy-btn" style="margin-top:.75rem;padding:.5rem 1.25rem;font-size:.85rem;display:inline-block">Смотреть →</a>
      </div>
    </div>`;
  }).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Pre-drop</div>
<h1>Pre-drop — предзаказы и коллаборации</h1>
<p class="desc">Оформи предзаказ на ограниченные коллекции до старта официальных продаж. Уникальный мерч артистов и фестивалей — только для тех, кто успел.</p>
${heroImgHtml}
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
${cards}
</div>`;

  return wrapPage(head, body);
}

// ─── /concept/:slug — страница конкретной кампании ───────────────────────────

function renderConceptCampaign(slug: string): string | null {
  const settings = getCachedRawPageSettings(`concept_campaign_${slug}`);
  // Если нет настроек — проверим хотя бы есть ли товары в этой группе
  const hero = settings?.hero || {};

  // Пропускаем скрытые кампании
  if (hero.visible === false) return null;

  // Собираем товары этой кампании из тёплого кэша
  const allProducts = getCachedProductsForRecommendations(2000);
  const campaignProducts = allProducts.filter(
    (p: any) => p.preorderEnabled && p.preorderGroup === slug
  );

  // Если ни настроек, ни товаров — страница не существует
  if (!settings && campaignProducts.length === 0) return null;

  const pageTitle: string = hero.title || slug;
  const pageSubtitle: string = hero.subtitle || "";
  const coverImage: string = hero.heroImage || hero.heroImageMobile || hero.coverImage || "";
  const seoTitle: string = hero.seoTitle || `${pageTitle} | Pre-drop BOOOMERANGS`;
  const seoDesc: string = hero.seoDescription || `Предзаказ ${pageTitle} — BOOOMERANGS. Ограниченная коллекция. Оформи предзаказ первым.`;

  const STATUS_LABELS: Record<string, string> = {
    collecting: "Сбор заявок",
    production: "Производство",
    shipping: "Отправка",
    shipped: "Отправлено",
    cancelled: "Отменено",
  };

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Pre-drop", "item": `${SITE_URL}/concept` },
        { "@type": "ListItem", "position": 3, "name": pageTitle, "item": `${SITE_URL}/concept/${slug}` },
      ],
    },
    ...(campaignProducts.length > 0 ? [{
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": `Предзаказ ${pageTitle}`,
      "description": seoDesc,
      "url": `${SITE_URL}/concept/${slug}`,
      "numberOfItems": campaignProducts.length,
      "itemListElement": campaignProducts.slice(0, 20).map((p: any, i: number) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": buildListingProductItem(p, { availability: "https://schema.org/PreOrder", url: p.slug ? `${SITE_URL}/${p.slug}` : `${SITE_URL}/concept/${slug}` }),
      })),
    }] : []),
  ]);

  const ogImage = coverImage && coverImage.startsWith("http")
    ? coverImage
    : coverImage ? `${SITE_URL}${coverImage}` : `${SITE_URL}/og-image.png`;

  const head = baseHead({
    title: seoTitle,
    description: seoDesc,
    canonical: `${SITE_URL}/concept/${slug}`,
    ogImage,
    jsonLd,
  });

  const heroHtml = coverImage
    ? `<div style="margin-bottom:1.5rem"><img src="${esc(coverImage)}" alt="${esc(pageTitle)}" style="width:100%;max-height:480px;object-fit:cover;border-radius:8px" loading="eager"></div>`
    : "";

  const productCards = campaignProducts.map((p: any) => {
    const imgUrl: string = p.imageUrl || p.thumbnailUrl || "";
    const statusLabel: string = STATUS_LABELS[p.preorderStatus || "collecting"] || "Предзаказ";
    const productUrl = p.slug ? `/${esc(p.slug)}` : `/concept/${esc(slug)}`;
    return `<div class="card">
      ${imgUrl ? `<div style="aspect-ratio:3/4;overflow:hidden;border-radius:4px;margin-bottom:.75rem"><img src="${esc(imgUrl)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>` : ""}
      <div class="name"><a href="${productUrl}">${esc(p.name)}</a></div>
      <div class="price">${price(p.price)}</div>
      <div class="status preorder" style="margin-top:.25rem">${esc(statusLabel)}</div>
    </div>`;
  }).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/concept">Pre-drop</a> / ${esc(pageTitle)}</div>
${heroHtml}
<h1>${esc(pageTitle)}</h1>
${pageSubtitle ? `<p class="desc">${esc(pageSubtitle)}</p>` : ""}
<p class="desc" style="margin-top:.5rem">Ограниченная коллекция в предзаказе — оформи заявку до старта официальных продаж.</p>
${campaignProducts.length > 0
  ? `<h2>Товары коллекции (${campaignProducts.length})</h2>
<div class="grid">${productCards}</div>`
  : `<p style="color:#888;margin-top:1.5rem">Товары скоро появятся. <a href="/concept">← Все предзаказы</a></p>`}
<p style="margin-top:2rem"><a href="/concept" style="color:#888">← Все предзаказы</a></p>`;

  return wrapPage(head, body);
}

// ─── Static-content page renderers ───────────────────────────────────────────

function renderBlog(): string {
  const homeSettings  = getCachedRawPageSettings("home")  as Record<string, any> | null;
  const blogPageMeta  = getCachedRawPageSettings("blog_pages") as Record<string, any> | null;
  const blogSeo       = getSeoOverride("blog");

  const defaultPosts = [
    { title: "SS'26: Новая эстетика уличной моды",    date: "15 января 2026",  category: "Коллекции",    excerpt: "Исследуем грани между российской уличной модой и современным искусством в новом дропе." },
    { title: "Лукбук: Urban Vibes в ритме города",    date: "10 января 2026",  category: "Лукбук",       excerpt: "Как сочетать комфорт и стиль в динамичной городской среде. Наш взгляд на повседневность." },
    { title: "Коллаб: BMG x Tula Artists",            date: "5 января 2026",   category: "Коллаборации", excerpt: "Лимитированная серия, созданная совместно с локальными художниками Тулы." },
  ];

  const rawItems: any[] = homeSettings?.blog?.items || defaultPosts;
  const posts = rawItems.map((item: any, idx: number) => {
    const meta = blogPageMeta?.[String(idx)] || {};
    return {
      title:    meta.title    || item.title    || "",
      date:     meta.date     || item.date     || "",
      category: meta.category || item.category || "",
      excerpt:  meta.excerpt  || item.excerpt  || "",
    };
  }).filter((p: any) => p.title);

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      "name": "Блог BMGBRAND",
      "url": `${SITE_URL}/blog`,
      "description": "Новости бренда, тренды российской моды, новые коллекции и коллаборации.",
      "publisher": { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
      "blogPost": posts.map((p: any) => ({
        "@type": "BlogPosting",
        "headline": p.title,
        "datePublished": p.date,
        "articleSection": p.category,
        "description": p.excerpt,
        "url": `${SITE_URL}/blog`,
        "author": { "@type": "Organization", "name": "BMGBRAND" },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Блог",    "item": `${SITE_URL}/blog` },
      ],
    },
  ]);

  const head = baseHead({
    title:       blogSeo.title       || `Блог BMGBRAND — новости, коллекции, коллаборации | ${SITE_NAME}`,
    description: blogSeo.description || "Блог BMGBRAND — новости бренда, тренды российской моды, новые коллекции и коллаборации с артистами.",
    canonical:   `${SITE_URL}/blog`,
    ogImage:     `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const cards = posts.map((p: any) => `
    <div class="card">
      <div style="font-size:.75rem;color:#888;margin-bottom:.25rem">${esc(p.category)} · ${esc(p.date)}</div>
      <div class="name">${esc(p.title)}</div>
      <p class="desc" style="margin:.25rem 0 0">${esc(p.excerpt)}</p>
    </div>`).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Блог</div>
<h1>Блог BMGBRAND</h1>
<p class="desc">Новости бренда, тренды российской моды, новые коллекции и коллаборации с артистами.</p>
${posts.length > 0 ? `<div class="grid">${cards}</div>` : "<p>Статьи скоро появятся.</p>"}
<p style="margin-top:2rem"><a href="/products">Перейти в каталог →</a></p>`;

  return wrapPage(head, body);
}

function renderVacancies(): string {
  const pageSettings  = getCachedRawPageSettings("vacancies") as Record<string, any> | null;
  const vacSeo        = getSeoOverride("vacancies");

  const defaultVacancies = [
    { id: "1", title: "Менеджер по продажам",  location: "Тула",      type: "Полная занятость",    description: "Ищем активного менеджера для работы с клиентами и развития продаж." },
    { id: "2", title: "SMM-специалист",         location: "Удалённо",  type: "Частичная занятость", description: "Ведение социальных сетей бренда, создание контента, взаимодействие с аудиторией." },
    { id: "3", title: "Дизайнер одежды",        location: "Тула",      type: "Полная занятость",    description: "Разработка новых коллекций, работа с принтами и паттернами, подбор материалов." },
  ];

  const raw = pageSettings?.vacancies_data;
  const settings = raw
    ? (typeof raw === "string" ? JSON.parse(raw) : raw)
    : { vacancies: defaultVacancies, pageTitle: "Вакансии", pageSubtitle: "Присоединяйся к команде BMGBRAND!", hrEmail: "hr@booomerangs.ru" };

  if (settings.pageVisible === false) {
    // Page is hidden — render minimal placeholder (still valid HTML for bots)
    const head = baseHead({
      title: "Вакансии — BMGBRAND",
      description: "Открытые вакансии в команду BMGBRAND.",
      canonical: `${SITE_URL}/vacancies`,
      ogImage: `${SITE_URL}/og-image.png`,
    });
    return wrapPage(head, `<h1>Вакансии временно недоступны</h1><p><a href="/">На главную</a></p>`);
  }

  const vacancies: any[] = (settings.vacancies || defaultVacancies).filter((v: any) => v.visible !== false);
  const hrEmail   = settings.hrEmail   || "hr@booomerangs.ru";
  const pageTitle = settings.pageTitle || "Вакансии";
  const subtitle  = settings.pageSubtitle || "Присоединяйся к команде BMGBRAND!";

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная",  "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Вакансии", "item": `${SITE_URL}/vacancies` },
      ],
    },
    ...vacancies.map((v: any) => ({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "title": v.title,
      "description": v.description,
      "hiringOrganization": { "@type": "Organization", "@id": `${SITE_URL}/#organization` },
      "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": v.location || "Тула", "addressCountry": "RU" } },
      "employmentType": v.type === "Удалённо" ? "TELECOMMUTE" : "FULL_TIME",
    })),
  ]);

  const head = baseHead({
    title:       vacSeo.title       || `Вакансии — присоединяйся к команде BMGBRAND | ${SITE_NAME}`,
    description: vacSeo.description || `Открытые вакансии в команду BMGBRAND. ${vacancies.map((v: any) => v.title).join(", ")}.`,
    canonical:   `${SITE_URL}/vacancies`,
    ogImage:     `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const cards = vacancies.map((v: any) => `
    <div class="card">
      <div class="name">${esc(v.title)}</div>
      <div style="font-size:.8rem;color:#888;margin:.25rem 0">${esc(v.location || "Тула")} · ${esc(v.type || "")}</div>
      <p class="desc" style="margin:0">${esc(v.description || "")}</p>
    </div>`).join("\n");

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Вакансии</div>
<h1>${esc(pageTitle)}</h1>
<p class="desc">${esc(subtitle)}</p>
${vacancies.length > 0
  ? `<div class="grid">${cards}</div>`
  : `<p>Сейчас открытых вакансий нет.</p>`}
<p style="margin-top:2rem">Отправьте резюме: <a href="mailto:${esc(hrEmail)}">${esc(hrEmail)}</a></p>`;

  return wrapPage(head, body);
}

/** Strips Tailwind utility class names from an HTML string for cleaner bot output. */
function stripTailwindClasses(html: string): string {
  return html.replace(/ class="[^"]*"/g, "");
}

function renderTerms(): string {
  const staticPages = getCachedRawPageSettings("static_pages") as Record<string, any> | null;
  const raw         = staticPages?.terms_data;
  const parsed      = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;

  const DEFAULT_TERMS = `<h1>Публичная оферта</h1>
<p>Публичная оферта о продаже товаров через интернет-магазин. г. Новомосковск.</p>
<p>Настоящая оферта является официальным предложением ИП Соболев Дмитрий Анатольевич, ИНН 711614027971, ОГРНИП 316715400111210 (Продавец).</p>
<h2>1. Общие положения</h2><ul>
<li>Заказ товара означает полное принятие условий настоящей Оферты.</li>
<li>Продавец вправе изменять условия без предварительного уведомления.</li></ul>
<h2>2. Предмет договора</h2><ul>
<li>Продавец обязуется передать товар из интернет-магазина booomerangs.ru, Покупатель — оплатить и принять его.</li></ul>
<h2>3. Оформление заказа и оплата</h2><ul>
<li>Заказ оформляется на сайте. Оплата — Т-Банк, ЮKassa. Цены в рублях, включая налоги.</li></ul>
<h2>3.1. Предзаказ</h2><ul>
<li>Предоплата 100%. Отмена возможна до передачи в производство.</li></ul>
<h2>4. Доставка</h2><ul>
<li>Доставка по России СДЭК. Стоимость рассчитывается при оформлении.</li></ul>
<h2>5. Возврат и обмен</h2><ul>
<li>Возврат товара надлежащего качества — в течение 14 дней при сохранении товарного вида.</li></ul>
<h2>6. Ответственность</h2><ul>
<li>Продавец не несёт ответственности за задержки транспортных компаний.</li></ul>
<h2>7. Конфиденциальность</h2><ul>
<li>Данные обрабатываются в соответствии со ст. 152-ФЗ «О персональных данных».</li></ul>
<h2>Реквизиты</h2>
<p>ИП Соболев Дмитрий Анатольевич, ИНН 711614027971, ОГРНИП 316715400111210.<br>
E-mail: <a href="mailto:info@booomerangs.ru">info@booomerangs.ru</a></p>`;

  const content = parsed?.content ? stripTailwindClasses(parsed.content) : DEFAULT_TERMS;

  const head = baseHead({
    title:       `Пользовательское соглашение | ${SITE_NAME}`,
    description: "Условия использования и публичная оферта интернет-магазина BMGBRAND.",
    canonical:   `${SITE_URL}/terms`,
    ogImage:     `${SITE_URL}/og-image.png`,
    extra:       '<meta name="robots" content="noindex, follow">',
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Условия использования</div>
${content}
<p style="margin-top:2rem"><a href="/">На главную</a></p>`;

  return wrapPage(head, body);
}

function renderPrivacy(): string {
  const staticPages = getCachedRawPageSettings("static_pages") as Record<string, any> | null;
  const raw         = staticPages?.privacy_data;
  const parsed      = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;

  const DEFAULT_PRIVACY = `<h1>Политика конфиденциальности</h1>
<p>Дата последнего обновления: 01 сентября 2025 г.</p>
<p>Настоящая Политика действует в отношении всей информации, которую сайт booomerangs.ru может получить о Пользователе.</p>
<h2>1. Общие положения</h2><p>Политика составлена в соответствии с ФЗ №152 «О персональных данных». Использование сайта означает согласие с Политикой.</p>
<h2>2. Собираемые данные</h2><ul>
<li>ФИО, телефон, e-mail (при указании);</li>
<li>IP-адрес, cookies, данные браузера, время доступа.</li></ul>
<h2>3. Цели обработки</h2><ul>
<li>Идентификация пользователя, выполнение заказов, улучшение качества сервиса.</li></ul>
<h2>4. Cookie и аналитика</h2><p>Используется Яндекс.Метрика. Пользователь может отключить cookies в настройках браузера.</p>
<h2>5. Передача данных</h2><p>Данные передаются: ЮKassa, Т-Банк, СДЭК, Яндекс — только для выполнения заказов. По законным основаниям — государственным органам РФ.</p>
<h2>6. Права пользователя</h2><p>Получить информацию, потребовать уточнения или удаления данных, отозвать согласие.</p>
<h2>7. Контакты</h2>
<p>E-mail: <a href="mailto:info@booomerangs.ru">info@booomerangs.ru</a><br>
Телефон: <a href="tel:+79606000047">+7 (960) 600-00-47</a><br>
301666, Тульская область, г. Новомосковск, ул. Генерала Белова, д. 21, кв. 48.</p>`;

  const content = parsed?.content ? stripTailwindClasses(parsed.content) : DEFAULT_PRIVACY;

  const head = baseHead({
    title:       `Политика конфиденциальности | ${SITE_NAME}`,
    description: "Политика конфиденциальности и обработки персональных данных BMGBRAND.",
    canonical:   `${SITE_URL}/privacy`,
    ogImage:     `${SITE_URL}/og-image.png`,
    extra:       '<meta name="robots" content="noindex, follow">',
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Политика конфиденциальности</div>
${content}
<p style="margin-top:2rem"><a href="/">На главную</a></p>`;

  return wrapPage(head, body);
}

/** SSR для /care — «Уход за одеждой». Контент из static_pages.care_data
 *  (если админ сохранил) или дефолтные рекомендации (как на клиенте). */
function renderCare(): string {
  const staticPages = getCachedRawPageSettings("static_pages") as Record<string, any> | null;
  const raw = staticPages?.care_data;
  const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;

  const CARE_SECTIONS: Array<{ title: string; rules: string[]; tip: string }> = [
    { title: "Носки",     rules: ["Стирка при 30–40°C", "Деликатный или ручной режим", "Без отбеливателей", "Сушить в расправленном виде", "Не выкручивать", "Гладить при низкой температуре"], tip: "Стирайте тёмные и светлые носки отдельно, чтобы сохранить яркость цвета." },
    { title: "Футболки",  rules: ["Стирка при 30–40°C", "Бережный режим стирки", "Без отбеливателей", "Сушить горизонтально", "Гладить при 110–150°C", "Стирать наизнанку"], tip: "Стирайте наизнанку — это сохраняет насыщенность принта и продлевает жизнь рисунку." },
    { title: "Худи",      rules: ["Стирка при 30°C", "Деликатный режим", "Без отбеливателей и сушки в машине", "Сушить в расправленном виде", "Гладить через ткань при 110°C", "Стирать наизнанку"], tip: "Не вешайте худи на крючок за капюшон — это деформирует капюшон и швы." },
    { title: "Свитшоты",  rules: ["Стирка при 30°C", "Деликатный режим", "Без отбеливателей", "Сушить горизонтально", "Гладить при 110°C через ткань", "Не выкручивать"], tip: "Чтобы ткань не скаталась, используйте мешок для стирки или стирайте наизнанку на деликатном режиме." },
    { title: "Куртки",    rules: ["Стирка при 30°C или по ярлыку", "Деликатный режим", "Без отбеливателей", "Сушить на плечиках", "Гладить через ткань или не гладить", "Застёгивать молнии перед стиркой"], tip: "Всегда проверяйте ярлык на куртке — разные материалы требуют разного ухода." },
    { title: "Брюки",     rules: ["Стирка при 30–40°C", "Стандартный или деликатный режим", "Без агрессивных отбеливателей", "Сушить в расправленном виде", "Гладить при 150°C", "Стирать наизнанку"], tip: "Для сохранения формы сушите брюки на вешалке за пояс, а не за штанины." },
    { title: "Шорты",     rules: ["Стирка при 30–40°C", "Деликатный режим", "Без отбеливателей", "Сушить горизонтально или на вешалке", "Гладить при 110–150°C", "Стирать наизнанку"], tip: "Стирайте тёмные шорты с вывернутой стороны и при минимальной температуре — так цвет дольше остаётся насыщенным." },
  ];

  const defaultBody =
    '<h1>Уход за одеждой</h1>\n' +
    '<p class="desc">Правильный уход продлевает жизнь вашей одежде и сохраняет её первоначальный вид. Следуйте нашим рекомендациям, чтобы ваши вещи служили дольше.</p>\n' +
    CARE_SECTIONS.map(s =>
      '<h2>' + esc(s.title) + '</h2>\n' +
      '<ul>' + s.rules.map(r => '<li>' + esc(r) + '</li>').join('\n') + '</ul>\n' +
      '<p>💡 ' + esc(s.tip) + '</p>'
    ).join('\n') +
    '\n<h2>Общие советы по хранению</h2>\n<ul>\n' +
    '<li><strong>Храните правильно</strong> — складывайте трикотаж горизонтально, вешайте куртки и брюки на плечики.</li>\n' +
    '<li><strong>Избегайте солнца</strong> — прямые солнечные лучи выгорают ткань, храните одежду в тёмном месте.</li>\n' +
    '<li><strong>Проветривайте</strong> — после носки давайте одежде проветриться, это снижает частоту стирки.</li>\n' +
    '</ul>\n<p style="margin-top:2rem"><a href="/products">Смотреть все товары →</a></p>';

  const content = parsed?.content ? stripTailwindClasses(parsed.content) : defaultBody;

  const head = baseHead({
    title: "Уход за одеждой — BOOOMERANGS | " + SITE_NAME,
    description: "Рекомендации по уходу за одеждой BOOOMERANGS: носки, футболки, худи, свитшоты, куртки, брюки и шорты. Правильная стирка, сушка и хранение.",
    canonical: SITE_URL + "/care",
    ogImage: SITE_URL + "/og-image.png",
  });

  const body =
    '<div class="breadcrumb"><a href="/">Главная</a> / Уход за одеждой</div>\n' +
    content;

  return wrapPage(head, body);
}

function renderGiftCards(): string {
  const amountsList = GIFT_CARD_AMOUNTS.map(a => a.label).join(", ");
  const minAmount = GIFT_CARD_AMOUNTS[0].label;
  const maxAmount = GIFT_CARD_AMOUNTS[GIFT_CARD_AMOUNTS.length - 1].label;

  const jsonLd = safeJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        { "@type": "ListItem", "position": 2, "name": "Подарочные карты", "item": `${SITE_URL}/gift-cards` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Подарочная карта BMGBRAND",
      "description": `Электронная подарочная карта интернет-магазина BMGBRAND (Booomerangs). Номиналы: ${amountsList}. Доставляется на e-mail получателя, действует 1 год.`,
      "image": `${SITE_URL}/og-image.png`,
      "brand": { "@id": `${SITE_URL}/#organization` },
      "offers": GIFT_CARD_AMOUNTS.map(a => ({
        "@type": "Offer",
        "price": (a.value / 100).toFixed(2),
        "priceCurrency": "RUB",
        "availability": "https://schema.org/InStock",
        "url": `${SITE_URL}/gift-cards`,
        "seller": { "@id": `${SITE_URL}/#organization` },
        "hasMerchantReturnPolicy": buildMerchantReturnPolicy(),
        "shippingDetails": buildShippingDetails(),
      })),
    },
  ]);

  const head = baseHead({
    title: `Подарочная карта BMGBRAND — от ${minAmount} до ${maxAmount} | ${SITE_NAME}`,
    description: `Электронная подарочная карта интернет-магазина BMGBRAND. Номиналы: ${amountsList}. Мгновенная доставка на e-mail, действует 1 год. Оплата картой, ЮKassa, Т-Банк.`,
    canonical: `${SITE_URL}/gift-cards`,
    ogImage: `${SITE_URL}/og-image.png`,
    jsonLd,
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / Подарочные карты</div>
<h1>Подарочная карта BMGBRAND</h1>
<p class="desc">Электронная подарочная карта интернет-магазина BMGBRAND (Booomerangs). Идеальный подарок, если не уверены в размере или модели — получатель сам выберет товар в каталоге.</p>
<h2>Доступные номиналы</h2>
<ul>${GIFT_CARD_AMOUNTS.map(a => `<li>${esc(a.label)}</li>`).join("\n")}</ul>
<h2>Как это работает</h2>
<ol>
  <li>Выберите номинал и дизайн карты.</li>
  <li>Укажите e-mail получателя и, при желании, персональное сообщение.</li>
  <li>Оплатите картой МИР/Visa/MasterCard через ЮKassa или Т-Банк.</li>
  <li>Получатель получает код карты на e-mail и активирует его при оформлении заказа на сайте.</li>
</ol>
<h2>Условия</h2>
<ul>
  <li>Срок действия — 1 год с момента покупки.</li>
  <li>Можно использовать частями — остаток сохраняется на карте.</li>
  <li>Действует на весь каталог booomerangs.ru.</li>
</ul>
<p style="margin-top:2rem"><a href="/">На главную</a> · <a href="/products">Смотреть каталог</a></p>`;

  return wrapPage(head, body);
}

/** SSR for artist pages: /@artistSlug */
function renderArtist(artistSlug: string): string | null {
  const artistPages = getCachedRawPageSettings("artist_pages") as Record<string, any> | null;
  if (!artistPages) return null;
  const data = artistPages[artistSlug];
  if (!data || !data.name) return null;

  const name = esc(data.name as string);
  const role = data.role ? esc(data.role as string) : "";
  const aboutTitle = data.aboutTitle ? esc(data.aboutTitle as string) : "";
  const aboutText = ((data.aboutText || data.shortDescription || "") as string).trim();
  const heroImage = (data.heroImage as string) || "";
  const canonical = `${SITE_URL}/@${artistSlug}`;

  const rawDesc = aboutText
    ? trimDesc(aboutText)
    : `${data.name}${role ? ` — ${data.role}` : ""}. Официальный мерч ${data.name} в интернет-магазине BOOOMERANGS. Доставка по всей России.`;

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
      { "@type": "ListItem", "position": 2, "name": "Мерч", "item": `${SITE_URL}/products/merch` },
      { "@type": "ListItem", "position": 3, "name": data.name, "item": canonical },
    ]
  });

  const personSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    "name": data.name,
    "description": rawDesc,
    ...(data.role ? { "jobTitle": data.role } : {}),
    ...(heroImage ? { "image": heroImage } : {}),
    "url": canonical,
    "sameAs": [`${SITE_URL}/@${artistSlug}`],
  });

  const head = baseHead({
    title: `${data.name} × BMGBRAND | BOOOMERANGS`,
    description: rawDesc,
    canonical,
    ogImage: heroImage,
    ogType: "profile",
    jsonLd: breadcrumbSchema,
    extra: [
      `  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">`,
      `  <script type="application/ld+json">${personSchema}</script>`,
    ].join("\n"),
  });

  const body = `
<div class="breadcrumb"><a href="/">Главная</a> / <a href="/products/merch">Мерч</a> / ${name}</div>
<h1>${name}</h1>
${role ? `<p class="desc">${role}</p>` : ""}
${aboutTitle ? `<h2>${aboutTitle}</h2>` : ""}
${aboutText ? `<p class="desc">${esc(aboutText)}</p>` : ""}
<p style="margin-top:1.5rem"><a href="/products/merch">← Смотреть весь мерч</a></p>`;

  return wrapPage(head, body);
}

/** Compute a strong ETag from HTML content for HTTP conditional requests. */
function makeETag(html: string): string {
  return '"' + crypto.createHash("md5").update(html).digest("hex") + '"';
}

// Односегментные клиентские страницы, которые рендерит React, а не bot-ssr
// (корзина, ЛК, партнёрка и т.п.). Для ботов пропускаем их к SPA и НЕ отдаём
// 404 — в отличие от мёртвых товарных слагов, которых нет ни в каталоге, ни в YDB.
const KNOWN_CLIENT_SLUGS = new Set<string>([
  "cart", "checkout", "admin", "verify-email", "reset-password",
  "profile", "favorites", "links", "partner", "wholesale",
]);

export async function botSsrMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Only GET requests
  if (req.method !== "GET") return next();

  // Serve SSR to known bots AND to anything that isn't clearly a real browser.
  // This way new AI crawlers, SEO tools, and unknown scrapers all get full HTML
  // without needing to be whitelisted — only real Chrome/Firefox/Safari/Edge
  // users bypass SSR and get the React app.
  const ua = req.headers["user-agent"] || "";
  if (!isBot(ua) && isBrowser(ua)) return next();

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
      const etag = makeETag(cached);
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      res.setHeader("ETag", etag);
      res.setHeader("X-Bot-SSR", "cache-hit");
      res.send(cached);
      return;
    }

    let html: string | null = null;

    if (reqPath === "/" || reqPath === "") {
      html = renderHome();
    } else if (reqPath === "/about") {
      html = renderAbout();
    } else if (reqPath === "/faq") {
      html = renderFaq();
    } else if (reqPath === "/merch-na-zakaz") {
      html = renderMerchOrder();
    } else if (reqPath === "/blog") {
      html = renderBlog();
    } else if (reqPath === "/vacancies") {
      html = renderVacancies();
    } else if (reqPath === "/gift-cards") {
      html = renderGiftCards();
    } else if (reqPath === "/terms") {
      html = renderTerms();
    } else if (reqPath === "/privacy") {
      html = renderPrivacy();
    } else if (reqPath === "/care") {
      html = renderCare();
    } else if (reqPath === "/concept") {
      html = renderConceptIndex();
    } else if (reqPath.startsWith("/concept/")) {
      const campaignSlug = reqPath.slice("/concept/".length).replace(/\/$/, "");
      // Только валидные slug-строки: строчные буквы/цифры/дефис
      if (campaignSlug && /^[a-z0-9][a-z0-9-]*$/.test(campaignSlug)) {
        html = renderConceptCampaign(campaignSlug);
      }
    } else if (reqPath.startsWith("/@")) {
      // Artist pages: /@artistSlug
      const artistSlug = reqPath.slice(2).replace(/\/$/, "");
      if (artistSlug && /^[a-z0-9][a-z0-9-]*$/.test(artistSlug)) {
        html = renderArtist(artistSlug);
      }
    } else if (reqPath === "/products") {
      html = renderCatalog();
    } else if (reqPath.startsWith("/products/")) {
      const rest = reqPath.slice("/products/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length === 1 && CATEGORIES[parts[0]]) {
        // /products/:catSlug
        html = renderCategory(parts[0]);
      } else if (parts.length === 2) {
        // /products/:catSlug/:subSlug → 301 to canonical /:subSlug (or English equivalent)
        const targetSlug = CYRILLIC_TO_CANONICAL[parts[1]] || parts[1];
        res.redirect(301, `/${targetSlug}`);
        return;
      } else if (parts.length === 3) {
        // /products/:catSlug/:subSlug/:subSubSlug
        html = renderSubSubcategory(parts[0], parts[1], parts[2]);
      }
    } else {
      // Try /:slug — product detail page, then subcategory page
      const slugMatch = reqPath.match(/^\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/);
      if (slugMatch) {
        const slug = slugMatch[1];
        html = renderProduct(slug);
        // Transliterated Cyrillic slug → immediate 301 to English canonical.
        // Do this BEFORE renderSubcategory: YDB uses English slugs ("hoodies"),
        // so renderSubcategory("tolstovki") would return null and the redirect would never fire.
        if (!html && CYRILLIC_TO_CANONICAL[slug]) {
          res.redirect(301, `/${CYRILLIC_TO_CANONICAL[slug]}`);
          return;
        }
        // If not a product, check if it's a subcategory slug (e.g. /dikaya-myata, /hoodies)
        if (!html) {
          html = renderSubcategory(slug);
        }
        // If still no match, try legacy English slugs (e.g. /sweaters → YDB slug "svitera").
        // Canonical is set to the legacy slug so Яндекс indexes /sweaters, not /svitera.
        if (!html) {
          const legacy = BOT_LEGACY_SLUG_MAP[slug];
          if (legacy?.subcategory) {
            let cats: Record<string, any> = CATEGORIES;
            try {
              const siteConfig = getCachedRawPageSettings('site_config');
              if (siteConfig?.categories_data) {
                const raw = typeof siteConfig.categories_data === 'string'
                  ? JSON.parse(siteConfig.categories_data) : siteConfig.categories_data;
                const normalized = normalizeCategories(raw);
                if (Object.keys(normalized).length > 0) cats = normalized;
              }
            } catch { /* keep static fallback */ }
            const cat = cats[legacy.category];
            if (cat) {
              const sub = (cat.subcategories as any[]).find((s: any) => s.name === legacy.subcategory);
              if (sub) {
                // Render with the YDB slug but override canonical to the legacy URL slug
                html = renderSubcategory(sub.slug, slug);
              }
            }
          } else if (legacy && !legacy.subcategory && legacy.category) {
            // Category-level legacy slug (e.g. /rasprodazha → /products/sale, /clothes → /products/clothing)
            res.redirect(301, `/products/${legacy.category}`);
            return;
          }
        }
        // If not a product or subcategory, check if it's a top-level category slug
        // (e.g. /socks → /products/socks). Redirect bots to the canonical URL.
        if (!html && CATEGORIES[slug]) {
          res.redirect(301, `/products/${slug}`);
          return;
        }
        if (!html) {
          // Check if this slug belongs to a hidden/unavailable product.
          // getCachedProductMetaBySlug searches the FULL cache (including isHidden products),
          // so a non-null result means the product exists but isn't public right now.
          const hiddenMeta = getCachedProductMetaBySlug(slug);
          if (hiddenMeta) {
            // Product exists in DB but is hidden (e.g. out of stock) — tell bots it's temporarily gone
            res.setHeader("X-Bot-SSR", "hidden-product");
            res.setHeader("Cache-Control", "no-store");
            res.status(404).type("text/html").send(
              `<!doctype html><html><head><title>404 Not Found</title></head>` +
              `<body><h1>404 Not Found</h1><p>This product is temporarily unavailable.</p>` +
              `<p><a href="/">Back to store</a></p></body></html>`
            );
            return;
          }
          // Check if this slug was permanently deleted — return 410 Gone
          // so search engines remove it from index immediately.
          const deletedSlugs = getCachedDeletedSlugs();
          if (deletedSlugs.has(slug)) {
            res.setHeader("X-Bot-SSR", "deleted-product");
            res.setHeader("Cache-Control", "no-store");
            res.status(410).type("text/html").send(
              `<!doctype html><html><head><title>410 Gone</title></head>` +
              `<body><h1>410 Gone</h1><p>This product no longer exists.</p>` +
              `<p><a href="/products">Browse catalog</a></p></body></html>`
            );
            return;
          }
          // YDB fallback: the slug wasn't found in the in-memory cache (e.g. right
          // after a server restart, or the product was created outside this process).
          // Ask YDB directly so bots get the real product card instead of the empty
          // SPA shell with the home page title/canonical.
          let dbHidden = false;
          // Слаг подтверждённо отсутствует в каталоге и в YDB — только тогда
          // отдаём ботам честный 404. Раньше бот получал оболочку главной с
          // canonical на корень (soft-404), из-за чего поисковики путались.
          let confirmedMissing = false;
          const dbCheck = dbSlugCheckCache.get(slug);
          if (dbCheck && Date.now() - dbCheck.ts < DB_SLUG_CHECK_TTL_MS) {
            dbHidden = dbCheck.hidden;
            // negative cache (hidden:false) = слаг подтверждённо отсутствует
            confirmedMissing = !dbCheck.hidden;
          } else {
            try {
              const dbProduct = await getProductMetaBySlugFromDb(slug);
              if (dbProduct) {
                if (dbProduct.isPublic && dbProduct.meta.title) {
                  html = renderProductHtml(slug, dbProduct.meta);
                } else {
                  // Product exists in YDB but isn't public right now — same 404 as above.
                  dbHidden = true;
                  dbSlugCheckCache.set(slug, { ts: Date.now(), hidden: true });
                }
              } else {
                // Slug confirmed absent in YDB — negative cache to avoid hammering the DB.
                confirmedMissing = true;
                dbSlugCheckCache.set(slug, { ts: Date.now(), hidden: false });
              }
            } catch (err: any) {
              // Never break the site — on DB errors fall through to the SPA as before.
              console.error("[BotSSR] YDB slug lookup failed:", slug, err?.message);
            }
          }
          if (dbHidden) {
            res.setHeader("X-Bot-SSR", "hidden-product");
            res.setHeader("Cache-Control", "no-store");
            res.status(404).type("text/html").send(
              `<!doctype html><html><head><title>404 Not Found</title></head>` +
              `<body><h1>404 Not Found</h1><p>This product is temporarily unavailable.</p>` +
              `<p><a href="/">Back to store</a></p></body></html>`
            );
            return;
          }
          if (KNOWN_CLIENT_SLUGS.has(slug)) {
            // Реальная клиентская страница (корзина, ЛК, партнёрка и т.п.) —
            // пропускаем к React SPA.
          } else if (confirmedMissing) {
            // Мёртвая ссылка: слага нет ни в каталоге, ни в YDB. Честный 404
            // с noindex — поисковик быстро выбросит URL из индекса.
            res.setHeader("X-Bot-SSR", "not-found");
            res.setHeader("Cache-Control", "no-store");
            res.status(404).type("text/html").send(
              '<!doctype html><html lang="ru"><head><meta charset="UTF-8">' +
              '<meta name="robots" content="noindex"><title>404 — Страница не найдена | ' + SITE_NAME + '</title></head>' +
              '<body><h1>404 — Страница не найдена</h1>' +
              '<p>Такой страницы не существует. Возможно, товар снят с продажи или ссылка устарела.</p>' +
              '<p><a href="/">На главную</a> · <a href="/products">Каталог</a></p></body></html>'
            );
            return;
          }
          // Всё остальное (ошибка БД, холодный кэш, неизвестный статический
          // путь) — как раньше, пропускаем к React SPA.
        }
      }
    }

    // If nothing rendered (unknown route, empty cache, etc.) — pass through
    if (!html) return next();

    botCacheSet(cacheKey, html);

    const etag = makeETag(html);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.setHeader("ETag", etag);
    res.setHeader("X-Bot-SSR", "rendered");
    res.send(html);
  } catch (err: any) {
    // Never break the site for real users — just pass through
    console.error("[BotSSR] Error rendering for bot:", reqPath, err?.message);
    next();
  }
}
