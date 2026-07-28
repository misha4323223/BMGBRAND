import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { getCachedLcpImageUrls, getCachedProductImageBySlug, getCachedProductMetaBySlug, getCachedRatingByProductId, getCachedProductsByCategory, getCachedAllVisibleProducts, getCachedProductsForRecommendations, getCachedHeroData, getCachedArtistHeroImage, getCachedRawPageSettings } from "./storage";

// Admin-editable SEO overrides (page_settings, pageName="seo").
// Ключи: "home", "category:<slug>". Читаем только из тёплого кэша.
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
import { getRecommendationsSync } from "./recommendations";

const SITE_NAME = "BMGBRAND";
const DEFAULT_TITLE = `Официальный сайт бренда Booomerangs | ${SITE_NAME}`;
const DEFAULT_DESC = "Российский бренд одежды с авторскими принтами — худи, футболки, носки и аксессуары. Доставка по всей России. Делаем вещи, которые носим сами.";

// Реальные хардкод-дефолты для главной страницы (используются в injectMeta ниже).
// Экспортируются, чтобы админка SEO могла показать их как "текущее значение по умолчанию".
export const HOME_SEO_DEFAULT = {
  title: DEFAULT_TITLE,
  description: "Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России.",
};

export const CONCEPT_SEO_DEFAULT = {
  title: "Pre-drop — предзаказ будущих релизов | BMGBRAND",
  description: "Оформите предзаказ на будущие релизы BMGBRAND — доступ к лимитированным дропам раньше всех.",
};

export const MERCH_ORDER_SEO_DEFAULT = {
  title: `Мерч на заказ — футболки, худи, носки с принтом от 180 ₽ | ${SITE_NAME}`,
  description: "Производство мерча на заказ от BMGBRAND: футболки от 900 ₽, худи от 1800 ₽, носки от 180 ₽/пара. Тираж от 20 шт. Разработка дизайна бесплатно. Работаем с блогерами, артистами, компаниями. Доставка по всей России — Тула, Москва, регионы.",
};

export const PARTNER_REGISTER_SEO_DEFAULT = {
  title: `Партнёрская программа ${SITE_NAME} — зарабатывай 15–25% на рекомендациях одежды`,
  description: "Рекомендуй одежду BOOOMERANGS и зарабатывай комиссию 15–25% с каждого заказа. Для самозанятых, ИП и юрлиц. Реферальная ссылка, личный кабинет, выплаты без минимума за 5 дней.",
};

export const ARTISTS: Record<string, { name: string; desc: string }> = {
  "goodtimes":      { name: "ГУДТАЙМС",          desc: "Официальный мерч ГУДТАЙМС — купить футболки, худи, аксессуары с символикой артиста. Доставка по всей России." },
  "molodostvnutri": { name: "Молодость внутри",   desc: "Официальный мерч Молодость внутри — купить одежду и аксессуары. Доставка по всей России." },
  "dikaya-myata":   { name: "ДИКАЯ МЯТА",         desc: "Официальный мерч ДИКАЯ МЯТА — купить худи, футболки, аксессуары. Доставка по всей России." },
  "dragni":         { name: "ДРАГНИ",             desc: "Официальный мерч ДРАГНИ — купить одежду и аксессуары с символикой артиста. Доставка по всей России." },
  "multfilmy":      { name: "МультFильмы",        desc: "Официальный мерч МультFильмы — купить уникальную одежду и аксессуары. Доставка по всей России." },
};

export const CATEGORIES: Record<string, { name: string; title?: string; desc: string }> = {
  "clothing": { name: "Одежда",      desc: "Купить одежду с авторскими принтами BMGBRAND — худи, свитшоты, футболки, шорты. Доставка по всей России." },
  "merch":    { name: "Мерч",        desc: "Купить официальный мерч артистов BMGBRAND — одежда и аксессуары с уникальными принтами. Доставка по всей России." },
  "socks":    {
    name: "Необычные носки с принтом",
    title: "Купить необычные носки с принтом — прикольные носки с мемами | BMGBRAND",
    desc: "Купить необычные носки с принтом BOOOMERANGS: оригинальные носки с мемами, прикольные авторские рисунки, носки хорошего качества — хлопок 75%. Большой выбор принтов. Доставка по всей России СДЭК.",
  },
  "accessories": { name: "Аксессуары", desc: "Купить аксессуары BMGBRAND — шапки, сумки, ремни и другие аксессуары. Доставка по всей России." },
  "sale":     { name: "Распродажа",  desc: "Распродажа BMGBRAND — выгодные цены на одежду и аксессуары. Доставка по всей России." },
};

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Strips HTML tags and collapses whitespace — used to feed admin-pasted HTML blocks
// (seoBody, specsHtml) into plain-text schema.org fields for bots that don't render HTML.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatPrice(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString("ru-RU") + " ₽";
}

function buildCategoryNoscript(catSlug: string, catName: string, catDesc: string, siteUrl: string): string {
  const products = getCachedProductsByCategory(catSlug, 80);
  if (products.length === 0) return "";

  const inStock = products.filter(p => p.stock > 0);
  const outOfStock = products.filter(p => p.stock === 0);
  const allSorted = [...inStock, ...outOfStock];

  const listItems = allSorted.map(p => {
    const status = p.stock > 0 ? "в наличии" : "под заказ";
    return `<li><a href="${escHtml(siteUrl + "/" + p.slug)}">${escHtml(p.name)}</a> — ${formatPrice(p.price)}, ${status}</li>`;
  }).join("\n");

  return `<noscript><div>` +
    `<h1>${escHtml(catName)}</h1>` +
    `<p>${escHtml(catDesc)}</p>` +
    `<p>Всего товаров: ${products.length}. В наличии: ${inStock.length}.</p>` +
    `<ul>\n${listItems}\n</ul>` +
    `</div></noscript>`;
}

function buildProductNoscript(meta: NonNullable<ReturnType<typeof getCachedProductMetaBySlug>>, siteUrl: string, slug: string): string {
  const price = formatPrice(meta.price);
  const status = meta.preorderEnabled ? "предзаказ" : meta.stock > 0 ? "в наличии" : "нет в наличии";
  const sizes = meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "";
  const colors = meta.colors.length > 0 ? `Цвета: ${meta.colors.join(", ")}.` : "";
  const desc = meta.description ? meta.description.slice(0, 300) : "";
  const catInfo = meta.category ? `Категория: ${meta.category}.` : "";
  const rating = getCachedRatingByProductId(meta.productId);
  const ratingStr = rating && rating.reviewCount >= 1
    ? `Рейтинг: ${rating.averageRating.toFixed(1)} из 5 (${rating.reviewCount} отзывов).`
    : "";

  const candidates = getCachedProductsForRecommendations();
  const recs = getRecommendationsSync(meta.productId, 4, candidates);
  const recsHtml = recs.length > 0
    ? `<h2>С этим часто берут</h2><ul>` +
      recs.map(r =>
        `<li><a href="${escHtml(siteUrl + "/" + r.slug)}">${escHtml(r.name)}</a> — ${formatPrice(r.price)}</li>`
      ).join("\n") +
      `</ul>`
    : "";

  const imagesHtml = meta.images.slice(0, 6).map((imgUrl, idx) => {
    const altLabel = idx === 0
      ? `${meta.title} — фото`
      : `${meta.title} — фото ${idx + 1}`;
    return `<img src="${escHtml(imgUrl)}" alt="${escHtml(altLabel)}" width="800" height="800" loading="lazy">`;
  }).join("\n");

  const aiSizeNote = meta.sizes.length > 0
    ? `<p>На странице доступен ИИ-подбор размера — нажмите «Подобрать размер с ИИ» для персональной рекомендации.</p>`
    : "";

  const seoBodyHtml = meta.seoBody ? `<h2>Подробнее о товаре</h2>${meta.seoBody}` : "";
  const specsHtmlBlock = meta.specsHtml
    ? `<h2>Характеристики</h2>${meta.specsHtml}`
    : (meta.composition || meta.careInstructions)
      ? `<h2>Состав и уход</h2>` +
        (meta.composition ? `<p>Состав: ${escHtml(meta.composition)}</p>` : "") +
        (meta.careInstructions ? `<p>Уход: ${escHtml(meta.careInstructions)}</p>` : "")
      : "";

  return `<noscript><div>` +
    `<h1>${escHtml(meta.title)} — купить</h1>` +
    `<p>Цена: ${escHtml(price)}. Статус: ${status}. ${escHtml(sizes)} ${escHtml(colors)} ${escHtml(catInfo)}</p>` +
    (desc ? `<p>${escHtml(desc)}</p>` : "") +
    (ratingStr ? `<p>${escHtml(ratingStr)}</p>` : "") +
    aiSizeNote +
    `<p>Доставка по всей России СДЭК.</p>` +
    (imagesHtml ? `<div>${imagesHtml}</div>` : "") +
    seoBodyHtml +
    specsHtmlBlock +
    `<p><a href="${escHtml(siteUrl + "/" + slug)}">Купить ${escHtml(meta.title)}</a></p>` +
    recsHtml +
    `</div></noscript>`;
}

function buildHomeNoscript(siteUrl: string): string {
  const products = getCachedAllVisibleProducts(24);
  const inStock = products.filter(p => p.stock > 0).slice(0, 12);

  const catLinks = Object.entries(CATEGORIES).map(([slug, cat]) =>
    `<li><a href="${escHtml(siteUrl + "/products/" + slug)}">${escHtml(cat.name)}</a></li>`
  ).join("\n");

  const productItems = inStock.map(p =>
    `<li><a href="${escHtml(siteUrl + "/" + p.slug)}">${escHtml(p.name)}</a> — ${formatPrice(p.price)}</li>`
  ).join("\n");

  return `<noscript><div>` +
    `<h1>BOOOMERANGS — официальный магазин российского бренда BMGBRAND</h1>` +
    `<p>Российский бренд одежды с авторскими принтами из Тулы. Авторские дизайны: худи, свитшоты, футболки, носки и аксессуары. Делаем вещи, которые носим сами. Доставка по всей России СДЭК.</p>` +
    `<h2>Категории</h2><ul>${catLinks}</ul>` +
    (productItems ? `<h2>Популярные товары</h2><ul>${productItems}</ul>` : "") +
    `<p><a href="${escHtml(siteUrl + "/products")}">Смотреть весь каталог</a></p>` +
    `</div></noscript>`;
}

function buildCatalogNoscript(siteUrl: string): string {
  const products = getCachedAllVisibleProducts(50);
  if (products.length === 0) return "";

  const catGroups: Record<string, typeof products> = {};
  for (const p of products) {
    if (!catGroups[p.category]) catGroups[p.category] = [];
    catGroups[p.category].push(p);
  }

  const catBlocks = Object.entries(CATEGORIES).map(([slug, cat]) => {
    const catProducts = catGroups[slug] || [];
    if (catProducts.length === 0) return "";
    const items = catProducts.slice(0, 10).map(p =>
      `<li><a href="${escHtml(siteUrl + "/" + p.slug)}">${escHtml(p.name)}</a> — ${formatPrice(p.price)}</li>`
    ).join("\n");
    return `<h2><a href="${escHtml(siteUrl + "/products/" + slug)}">${escHtml(cat.name)}</a></h2><ul>${items}</ul>`;
  }).filter(Boolean).join("\n");

  return `<noscript><div>` +
    `<h1>Каталог BOOOMERANGS — одежда и аксессуары</h1>` +
    `<p>Официальный магазин бренда BMGBRAND. Доставка по всей России.</p>` +
    catBlocks +
    `</div></noscript>`;
}

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

const DEFAULT_ABOUT = {
  title: "Мы —",
  titleAccent: "Booomerangs",
  description: "Базируясь в Туле — городе мастеров, пряников и самоваров — мы создаем вещи для повседневной жизни. На нашем счету более 200 моделей носков (мемных и просто ярких), а также собственная линейка качественной одежды, в которую входят куртки, худи, джоггеры, футболки, шорты и аксессуары.",
  quote: "Делаем вещи, которые носим сами",
};

const DEFAULT_VACANCIES = {
  pageTitle: "Вакансии",
  pageSubtitle: "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.",
  hrEmail: "hr@booomerangs.ru",
  vacancies: [
    { title: "Менеджер по продажам", location: "Тула", type: "Полная занятость", description: "Ищем активного менеджера для работы с клиентами и развития продаж в онлайн и офлайн каналах." },
    { title: "SMM-специалист", location: "Удалённо", type: "Частичная занятость", description: "Ведение социальных сетей бренда, создание контента, взаимодействие с аудиторией." },
    { title: "Дизайнер одежды", location: "Тула", type: "Полная занятость", description: "Разработка новых коллекций, работа с принтами и паттернами, подбор материалов." },
  ],
};

const DEFAULT_BLOG_POSTS: Array<{ title: string; date: string; category: string; author: string; excerpt: string }> = [
  { title: "SS'26: Новая эстетика уличной моды", date: "15 января 2026", category: "Коллекции", author: "BMG Team", excerpt: "Исследуем грани между российской уличной модой и современным искусством в новом дропе." },
  { title: "Лукбук: Urban Vibes в ритме города", date: "10 января 2026", category: "Лукбук", author: "BMG Team", excerpt: "Как сочетать комфорт и стиль в динамичной городской среде. Наш взгляд на повседневность." },
  { title: "Коллаб: BMG x Tula Artists", date: "5 января 2026", category: "Коллаборации", author: "BMG Team", excerpt: "Лимитированная серия, созданная совместно с локальными художниками Тулы." },
];

// Читает реальный контент FAQ, отредактированный в админке (static_pages.faq_data),
// с фолбэком на DEFAULT_FAQ_ITEMS — та же логика парсинга, что в client/src/pages/FAQ.tsx,
// чтобы structured data и noscript-разметка всегда совпадали с тем, что видит пользователь.
function getFaqItems(): Array<{ question: string; answer: string }> {
  try {
    const staticPages = getCachedRawPageSettings("static_pages");
    const raw = staticPages?.faq_data;
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    if (parsed?.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed.items;
    }
  } catch (e) {
    console.error("[Static] FAQ items parse error:", e);
  }
  return DEFAULT_FAQ_ITEMS;
}

function buildFaqNoscript(): string {
  const items = getFaqItems().map(item =>
    `<h2>${escHtml(item.question)}</h2><p>${escHtml(item.answer)}</p>`
  ).join("\n");
  return `<noscript><div>` +
    `<h1>Часто задаваемые вопросы</h1>` +
    `<p>Ответы на популярные вопросы о заказах, доставке и возврате BMGBRAND.</p>` +
    items +
    `</div></noscript>`;
}

function buildAboutNoscript(): string {
  return `<noscript><div itemscope itemtype="https://schema.org/Organization">` +
    `<h1>О бренде BOOOMERANGS (BMGBRAND)</h1>` +
    `<p itemprop="description">BOOOMERANGS — российский бренд одежды и аксессуаров с авторскими принтами из Тулы. Основан в 2006 году. Собственное производство с 2019 года в Узловском районе Тульской области. Производим худи, свитшоты, футболки, носки и аксессуары. Делаем вещи, которые носим сами.</p>` +
    `<h2>Цифры</h2>` +
    `<ul>` +
    `<li>2006 — год открытия первого магазина StreetWear</li>` +
    `<li>200+ моделей носков в каталоге</li>` +
    `<li>100+ магазинов по всей России</li>` +
    `</ul>` +
    `<h2>История</h2>` +
    `<ul>` +
    `<li><strong>2006</strong> — открыли StreetWear — мультибренд уличной одежды. С него всё началось.</li>` +
    `<li><strong>2019</strong> — запустили полный производственный цикл в Узловском районе Тульской области. Теперь шьём, печатаем и упаковываем сами.</li>` +
    `<li><strong>2020</strong> — в пандемию сделали первые мемные носки с принтами соды, соли и сахара. Покупатели оценили.</li>` +
    `</ul>` +
    `<h2>Что мы делаем</h2>` +
    `<ul>` +
    `<li><strong>Одежда</strong> — футболки, худи, свитшоты, куртки, брюки — оверсайз-силуэт, унисекс.</li>` +
    `<li><strong>Носки</strong> — 200+ моделей: мемные, яркие, классические. Одни из самых узнаваемых в России.</li>` +
    `<li><strong>Аксессуары</strong> — шопперы, кепки, шапки, сумки.</li>` +
    `<li><strong>Мерч под ключ</strong> — производим официальный мерч для артистов, фестивалей и брендов. Официальный партнёр мерча «Дикая мята».</li>` +
    `</ul>` +
    `<h2>Слово основателя</h2>` +
    `<blockquote>«Сначала приходит вдохновение. Потом эскиз, подбор тканей, тестирование — стираем и носим сами, пока не убедимся что вещь готова. И только потом — в производство.»</blockquote>` +
    `<p>Евгений Соболев — основатель BOOOMERANGS</p>` +
    `<h2>Признание</h2>` +
    `<p>Участник VI федерального форума-фестиваля Российская Креативная Неделя. Включены в экосистему креативных индустрий Тульской области.</p>` +
    `<p><a href="/products">Перейти в каталог</a> · <a href="/merch-na-zakaz">Заказать мерч</a></p>` +
    `</div></noscript>`;
}

function buildVacanciesNoscript(): string {
  const items = DEFAULT_VACANCIES.vacancies.map(v =>
    `<li><strong>${escHtml(v.title)}</strong> — ${escHtml(v.location)}, ${escHtml(v.type)}. ${escHtml(v.description)}</li>`
  ).join("\n");
  return `<noscript><div>` +
    `<h1>${escHtml(DEFAULT_VACANCIES.pageTitle)}</h1>` +
    `<p>${escHtml(DEFAULT_VACANCIES.pageSubtitle)}</p>` +
    `<ul>${items}</ul>` +
    `<p>Резюме отправляйте на <a href="mailto:${escHtml(DEFAULT_VACANCIES.hrEmail)}">${escHtml(DEFAULT_VACANCIES.hrEmail)}</a></p>` +
    `</div></noscript>`;
}

function buildBlogListNoscript(siteUrl: string): string {
  const items = DEFAULT_BLOG_POSTS.map((p, idx) =>
    `<li><a href="${escHtml(siteUrl + "/blog/" + idx)}">${escHtml(p.title)}</a> — ${escHtml(p.date)}, ${escHtml(p.category)}. ${escHtml(p.excerpt)}</li>`
  ).join("\n");
  return `<noscript><div>` +
    `<h1>Блог BMGBRAND — культура и стиль</h1>` +
    `<p>Анонсы новых коллекций, истории создания вещей и авторские дизайны бренда.</p>` +
    `<ul>${items}</ul>` +
    `</div></noscript>`;
}

function injectSeoBody(html: string, noscriptBlock: string): string {
  if (!noscriptBlock) return html;
  return html.replace("</body>", `${noscriptBlock}\n</body>`);
}

// Единая сущность Organization с @id — используется как ссылка (brand/seller)
// на карточках товаров, чтобы Google/Яндекс распознавали продавца как ту же
// полноценную организацию, что описана на главной странице, а не как
// анонимную заглушку без url/logo/sameAs.
function buildOrganizationSchema(siteUrl: string) {
  return {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    "name": SITE_NAME,
    "alternateName": "Booomerangs",
    "url": siteUrl,
    "logo": `${siteUrl}/favicon.png`,
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
function buildMerchantReturnPolicy(siteUrl: string) {
  return {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": "RU",
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 14,
    "returnMethod": "https://schema.org/ReturnByMail",
    "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
  };
}

function buildProductJsonLd(meta: NonNullable<ReturnType<typeof getCachedProductMetaBySlug>>, slug: string, siteUrl: string): string {
  const isMerch = ["merch", "мерч"].includes(meta.category.toLowerCase());
  const pageDesc = meta.seoDescription || [
    isMerch ? `Купить мерч ${meta.title} BOOOMERANGS` : `Купить ${meta.title} BOOOMERANGS`,
    meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "",
    "Доставка по России СДЭК.",
    meta.description ? meta.description.slice(0, 80) : "",
  ].filter(Boolean).join(" ").slice(0, 220);

  const productUrl = `${siteUrl}/${slug}`;
  const priceValidUntil = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0];
  const availability = meta.preorderEnabled
    ? "https://schema.org/PreOrder"
    : meta.stock > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";

  const rating = getCachedRatingByProductId(meta.productId);
  const organizationSchema = buildOrganizationSchema(siteUrl);

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": meta.title,
    "description": pageDesc,
    "image": meta.images.length > 0 ? meta.images : (meta.image ? [meta.image] : []),
    "url": productUrl,
    "sku": meta.sku,
    "brand": { "@id": organizationSchema["@id"] },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "RUB",
      "price": (meta.price / 100).toFixed(2),
      "priceValidUntil": priceValidUntil,
      "availability": availability,
      "itemCondition": "https://schema.org/NewCondition",
      "url": productUrl,
      "seller": { "@id": organizationSchema["@id"] },
      "hasMerchantReturnPolicy": buildMerchantReturnPolicy(siteUrl),
    },
    ...(rating && rating.reviewCount >= 1 ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": rating.averageRating.toFixed(1),
        "reviewCount": rating.reviewCount,
        "bestRating": "5",
        "worstRating": "1",
      }
    } : {}),
    ...(meta.category ? { "category": meta.category } : {}),
    ...(meta.colors.length > 0 ? { "color": meta.colors.join(", ") } : {}),
    ...(meta.sizes.length > 0 ? { "size": meta.sizes.join(", ") } : {}),
    ...(meta.specsHtml ? { "material": stripHtml(meta.specsHtml) } : meta.composition ? { "material": meta.composition } : {}),
    "additionalProperty": [
      ...(meta.sizes.length > 0 ? [
        {
          "@type": "PropertyValue",
          "name": "Доступные размеры",
          "value": meta.sizes.join(", "),
        },
        {
          "@type": "PropertyValue",
          "name": "Подбор размера",
          "value": "На странице доступен ИИ-подбор размера по параметрам покупателя",
        },
      ] : []),
      ...(meta.specsHtml
        ? [{ "@type": "PropertyValue", "name": "Характеристики", "value": stripHtml(meta.specsHtml) }]
        : [
            ...(meta.composition ? [{ "@type": "PropertyValue", "name": "Состав", "value": meta.composition }] : []),
            ...(meta.careInstructions ? [{ "@type": "PropertyValue", "name": "Уход", "value": meta.careInstructions }] : []),
          ]),
    ],
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
      { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${siteUrl}/products` },
      ...(meta.category ? [{ "@type": "ListItem", "position": 3, "name": CATEGORIES[meta.category]?.name || meta.category, "item": `${siteUrl}/products/${meta.category}` }] : []),
      { "@type": "ListItem", "position": meta.category ? 4 : 3, "name": meta.title, "item": productUrl },
    ],
  };

  return JSON.stringify([productSchema, organizationSchema, breadcrumbSchema]);
}

function injectMeta(html: string, opts: {
  title: string;
  description: string;
  ogImage: string;
  ogType?: string;
  canonical?: string;
  jsonLd?: string;
}): string {
  const { title, description, ogImage, ogType = "website", canonical, jsonLd } = opts;
  const t = escHtml(title);
  const d = escHtml(description.slice(0, 160));
  const img = escHtml(ogImage);

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${d}"`);
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${t}"`);
  html = html.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${d}"`);
  html = html.replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${img}"`);
  html = html.replace(/<meta property="og:type" content="[^"]*"/, `<meta property="og:type" content="${ogType}"`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${t}"`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${d}"`);
  html = html.replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${img}"`);

  if (canonical) {
    const canonTag = `<link rel="canonical" href="${escHtml(canonical)}">`;
    if (html.includes('<link rel="canonical"')) {
      html = html.replace(/<link rel="canonical"[^>]*>/, canonTag);
    } else {
      html = html.replace('</head>', `    ${canonTag}\n  </head>`);
    }
    const ogUrlTag = `<meta property="og:url" content="${escHtml(canonical)}">`;
    if (html.includes('<meta property="og:url"')) {
      html = html.replace(/<meta property="og:url"[^>]*>/, ogUrlTag);
    } else {
      html = html.replace('</head>', `    ${ogUrlTag}\n  </head>`);
    }
  }

  if (jsonLd) {
    const ldTag = `<script type="application/ld+json" data-rh="true">${jsonLd}</script>`;
    html = html.replace('</head>', `    ${ldTag}\n  </head>`);
  }

  return html;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const assetsDir = path.join(distPath, "assets");
  let cssFileName = "";
  let jsFileName = "";
  let allJsChunks: string[] = [];
  try {
    const files = fs.readdirSync(assetsDir);
    cssFileName = files.find((f: string) => f.endsWith(".css") && f.startsWith("index-")) || "";
    jsFileName = files.find((f: string) => f.endsWith(".js") && f.startsWith("index-")) || "";
    // Page-specific chunks — load lazily per route, never preload globally
    const pageChunkPrefixes = [
      "Admin", "Home", "ProductList", "ProductDetail", "Cart", "Checkout",
      "Profile", "About", "FAQ", "Blog", "BlogDetail", "ArtistPage",
      "WholesaleRegister", "WholesaleProfile", "WholesalePreorder",
      "GiftCard", "Order", "Favorites", "Links", "TrackOrder",
      "ConceptPage", "Vacancies", "Terms", "Privacy", "SlugResolver",
      "VerifyEmail", "ResetPassword", "MerchOrder", "Care"
    ];
    const isPageChunk = (name: string) =>
      pageChunkPrefixes.some(prefix => name.startsWith(prefix));

    // Admin-only heavy chunks — never preload for regular users
    const neverPreloadPrefixes = ['vendor-editor', 'vendor-charts', 'vendor-pdf'];
    const isNeverPreload = (name: string) =>
      neverPreloadPrefixes.some(prefix => name.startsWith(prefix));

    allJsChunks = files
      .filter((f: string) => f.endsWith(".js") && f !== jsFileName && !isPageChunk(f) && !isNeverPreload(f))
      .sort((a: string, b: string) => {
        try {
          const sizeA = fs.statSync(path.join(assetsDir, a)).size;
          const sizeB = fs.statSync(path.join(assetsDir, b)).size;
          return sizeB - sizeA;
        } catch { return 0; }
      })
      .slice(0, 15);
  } catch {}

  const criticalChunks = allJsChunks.slice(0, 6);
  const secondaryChunks = allJsChunks.slice(6);

  const indexHtmlPath = path.resolve(distPath, "index.html");
  let cachedHtml = "";
  try {
    let html = fs.readFileSync(indexHtmlPath, "utf-8");

    // LCP: logo is always the first meaningful image — preload it on every page
    const logoPreloadTag = `    <link rel="preload" as="image" href="/images/boomerangs-logo.webp" fetchpriority="high">`;
    html = html.replace('</head>', `${logoPreloadTag}\n  </head>`);

    const modulePreloadTags = criticalChunks
      .map(chunk => `    <link rel="modulepreload" href="/assets/${chunk}">`)
      .join('\n');
    if (modulePreloadTags) {
      html = html.replace('</head>', `${modulePreloadTags}\n  </head>`);
    }

    if (cssFileName) {
      const escapedCss = cssFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cssRegex = new RegExp(`<link[^>]*href="/assets/${escapedCss}"[^>]*>`, 'g');
      const asyncCss = `<link rel="preload" as="style" href="/assets/${cssFileName}"><link rel="stylesheet" href="/assets/${cssFileName}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="/assets/${cssFileName}"></noscript>`;
      const replaced = html.replace(cssRegex, asyncCss);
      if (replaced !== html) {
        html = replaced;
        console.log(`[Static] CSS async loading applied for ${cssFileName}`);
      } else {
        console.warn(`[Static] CSS tag not found in HTML for ${cssFileName}, blocking CSS remains`);
      }
    } else {
      console.warn("[Static] No CSS file found in assets directory");
    }

    cachedHtml = html;
  } catch {
    cachedHtml = "";
  }

  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false, // Prevent express.static from serving index.html directly for "/" — injection must happen in the catch-all handler
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    }
  }));

  // Rarely-changing marketing/content pages: safe to cache briefly with revalidation in background.
  // Excludes anything with live price/stock/availability data (home, product, category, catalog, cart, checkout, profile, etc).
  const CACHEABLE_STATIC_PATHS = new Set(['/about', '/faq', '/vacancies', '/blog', '/terms', '/privacy', '/links', '/concept']);
  // Individual blog posts (/blog/123) also rarely change once published.
  const CACHEABLE_STATIC_PREFIXES = ['/blog/'];

  app.use("*", (req, res) => {
    const url = req.originalUrl;
    const cleanUrl = url.split('?')[0].split('#')[0];
    const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;

    if (CACHEABLE_STATIC_PATHS.has(cleanUrl) || CACHEABLE_STATIC_PREFIXES.some(p => cleanUrl.startsWith(p))) {
      // Public, short max-age with background revalidation — reduces TTFB for bots/crawlers
      // repeatedly hitting rarely-updated pages, while still picking up CMS edits within minutes.
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    let routeLcpImage = "";

    const knownRoutes = new Set(['/', '/products', '/cart', '/checkout', '/about', '/admin', '/verify-email', '/reset-password', '/profile', '/favorites', '/vacancies', '/faq', '/terms', '/privacy', '/links', '/concept', '/blog', '/wholesale-register', '/wholesale-profile', '/order-success', '/order-failed', '/contacts', '/merch-na-zakaz', '/partner/register', '/partner/login']);
    const knownPrefixes = ['/products/', '/wholesale/', '/gift-cards/', '/blog/', '/@', '/order-success/', '/order-failed/', '/track/', '/api/', '/assets/'];
    const isKnownRoute = knownRoutes.has(cleanUrl) || knownPrefixes.some(p => url.startsWith(p));
    const slugMatch = !isKnownRoute ? cleanUrl.match(/^\/([a-z0-9][a-z0-9-]*[a-z0-9])(?:\/?)$/) : null;
    const isValidRoute = isKnownRoute || !!slugMatch;
    let detectedProductSlug = '';
    if (slugMatch) {
      try {
        detectedProductSlug = decodeURIComponent(slugMatch[1]);
        routeLcpImage = getCachedProductImageBySlug(detectedProductSlug);
      } catch {}
    }

    if (!routeLcpImage) {
      const lcpImages = getCachedLcpImageUrls();
      if (lcpImages.length > 0) routeLcpImage = lcpImages[0];
    }

    const linkParts: string[] = [];
    if (jsFileName) linkParts.push(`</assets/${jsFileName}>; rel=modulepreload`);
    for (const chunk of criticalChunks) linkParts.push(`</assets/${chunk}>; rel=modulepreload`);
    for (const chunk of secondaryChunks) linkParts.push(`</assets/${chunk}>; rel=modulepreload; nopush`);
    if (routeLcpImage) linkParts.push(`<${routeLcpImage}>; rel=preload; as=image; fetchpriority=high`);

    const isHomePage = url === "/" || url === "";
    if (isHomePage) {
      linkParts.push(`</api/products?page=1&limit=24>; rel=preload; as=fetch`);
      linkParts.push(`</api/page-settings/home>; rel=preload; as=fetch`);
      linkParts.push(`</api/page-settings/navbar>; rel=preload; as=fetch`);
    }
    if (linkParts.length > 0) res.setHeader('Link', linkParts.join(', '));

    if (!cachedHtml) {
      return res.sendFile(path.resolve(distPath, "index.html"));
    }

    let html = cachedHtml;

    html = html.replace(
      /<meta property="og:image" content="\/favicon\.png"/,
      `<meta property="og:image" content="${siteUrl}/favicon.png"`
    );
    html = html.replace(
      /<meta name="twitter:image" content="\/favicon\.png"/,
      `<meta name="twitter:image" content="${siteUrl}/favicon.png"`
    );
    // Safety net: абсолютизировать og-image.png если по какой-то причине остался относительным
    html = html.replace(
      /<meta property="og:image" content="\/og-image\.png"/,
      `<meta property="og:image" content="${siteUrl}/og-image.png"`
    );
    html = html.replace(
      /<meta name="twitter:image" content="\/og-image\.png"/,
      `<meta name="twitter:image" content="${siteUrl}/og-image.png"`
    );

    if (routeLcpImage) {
      const preloadTag = `<link rel="preload" as="image" href="${routeLcpImage}" fetchpriority="high">`;
      html = html.replace('</head>', `    ${preloadTag}\n  </head>`);
    }

    if (isHomePage) {
      const heroData = getCachedHeroData();
      if (heroData) {
        const safeHero = JSON.stringify(heroData).replace(/<\/script>/gi, '<\\/script>');
        const heroScript = `<script>window.__HERO__=${safeHero};</script>`;
        html = html.replace('</head>', `    ${heroScript}\n  </head>`);
        if (heroData.imgMobile) {
          const mobilePreload = `<link rel="preload" as="image" href="${heroData.imgMobile}" fetchpriority="high" media="(max-width: 639px)">`;
          html = html.replace('</head>', `    ${mobilePreload}\n  </head>`);
        }
        if (heroData.img) {
          const desktopPreload = `<link rel="preload" as="image" href="${heroData.img}" fetchpriority="high" media="(min-width: 640px)">`;
          html = html.replace('</head>', `    ${desktopPreload}\n  </head>`);
        }
      }
      // Inject full home page settings so React Query cache is pre-populated on
      // the client before first render — eliminates the settingsLoading blank screen.
      const homeSettings = getCachedRawPageSettings("home");
      if (homeSettings) {
        const safeSettings = JSON.stringify(homeSettings).replace(/<\/script>/gi, '<\\/script>');
        html = html.replace('</head>', `    <script>window.__HOME_SETTINGS__=${safeSettings};</script>\n  </head>`);
      }
    }

    try {
      // --- Product page ---
      if (detectedProductSlug) {
        const meta = getCachedProductMetaBySlug(detectedProductSlug);
        if (meta && meta.title) {
          const isMerch = ["merch", "мерч"].includes(meta.category.toLowerCase());
          const title = meta.seoTitle || `${meta.title}${isMerch ? " — купить мерч" : " — купить"} | ${SITE_NAME}`;
          const desc = meta.seoDescription || [
            isMerch ? `Купить мерч ${meta.title} BOOOMERANGS` : `Купить ${meta.title} BOOOMERANGS`,
            meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "",
            "Доставка по России СДЭК.",
            meta.description ? meta.description.slice(0, 80) : "",
          ].filter(Boolean).join(" ").slice(0, 220);
          const image = meta.image.startsWith("http") ? meta.image : `${siteUrl}${meta.image}`;
          const jsonLd = buildProductJsonLd(meta, detectedProductSlug, siteUrl);
          html = injectMeta(html, {
            title,
            description: desc,
            ogImage: image,
            ogType: "product",
            canonical: `${siteUrl}/${detectedProductSlug}`,
            jsonLd,
          });
          html = injectSeoBody(html, buildProductNoscript(meta, siteUrl, detectedProductSlug));
        }
      }

      // --- Home page ---
      if (cleanUrl === "/" || cleanUrl === "") {
        const homeJsonLd = JSON.stringify([
          {
            "@context": "https://schema.org",
            ...buildOrganizationSchema(siteUrl),
            "description": "Официальный магазин мерча российского бренда одежды и аксессуаров. Мерч Гудтаймс, Молодость внутри, Дикая мята и других артистов. Доставка по всей России.",
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Booomerangs",
            "alternateName": SITE_NAME,
            "url": `${siteUrl}/`,
            "potentialAction": {
              "@type": "SearchAction",
              "target": `${siteUrl}/products?search={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ]);
        const homeSeo = getSeoOverride("home");
        html = injectMeta(html, {
          title: homeSeo.title || DEFAULT_TITLE,
          description: homeSeo.description || "Booomerangs (BMGBRAND) — официальный магазин мерча. Купить мерч Гудтаймс, Молодость внутри, Дикая мята, Драгни, МультFильмы и других артистов. Доставка по всей России.",
          ogImage: `${siteUrl}/og-image.png`,
          canonical: `${siteUrl}/`,
          jsonLd: homeJsonLd,
        });
        html = injectSeoBody(html, buildHomeNoscript(siteUrl));
      }

      // --- Artist/creator page: /@:slug ---
      const artistMatch = cleanUrl.match(/^\/@([a-z0-9][a-z0-9-]*)$/);
      if (artistMatch) {
        const artistSlug = artistMatch[1];
        // getCachedArtistHeroImage нужен и для мета-тегов (fallback), и для гидратации клиента
        const artistHero = getCachedArtistHeroImage(artistSlug);
        const staticArtist = ARTISTS[artistSlug];
        // Админ-редактируемые SEO-поля артиста хранятся в page_settings("artist_pages")[slug],
        // тот же источник, что и вкладка "Артисты" в админке — приоритетнее хардкода.
        const artistPageSettings = getCachedRawPageSettings("artist_pages")?.[artistSlug];
        const artistSeoTitle = typeof artistPageSettings?.seoTitle === "string" && artistPageSettings.seoTitle.trim()
          ? artistPageSettings.seoTitle.trim() : undefined;
        const artistSeoDesc = typeof artistPageSettings?.seoDescription === "string" && artistPageSettings.seoDescription.trim()
          ? artistPageSettings.seoDescription.trim() : undefined;

        // Используем жёстко заданные данные или fallback из artist_pages в YDB
        const artistName = staticArtist?.name || artistPageSettings?.name || artistHero.name;
        const artistDesc = artistSeoDesc || staticArtist?.desc || (artistName
          ? `Официальный мерч ${artistName} — купить одежду и аксессуары с символикой артиста. Доставка по всей России.`
          : null);

        if (artistName && artistDesc) {
          const title = artistSeoTitle || `Мерч ${artistName} — купить официальный мерч | ${SITE_NAME}`;
          // Hero-изображение гораздо лучше для соцсетей, чем favicon
          const artistOgImage = artistHero.img || artistHero.imgMobile || `${siteUrl}/og-image.png`;
          const jsonLd = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
              { "@type": "ListItem", "position": 2, "name": "Мерч", "item": `${siteUrl}/products/merch` },
              { "@type": "ListItem", "position": 3, "name": artistName, "item": `${siteUrl}/@${artistSlug}` },
            ],
          });
          html = injectMeta(html, {
            title,
            description: artistDesc,
            ogImage: artistOgImage,
            ogType: "website",
            canonical: `${siteUrl}/@${artistSlug}`,
            jsonLd,
          });
        }

        // Inject hero data for immediate client-side use (avoids waiting for 2 API calls — already fetched above)
        if (artistHero.img || artistHero.imgMobile || artistHero.name) {
          const safeHero = JSON.stringify(artistHero).replace(/<\/script>/gi, '<\\/script>');
          html = html.replace('</head>', `    <script>window.__ARTIST_HERO__=${safeHero};</script>\n  </head>`);
        }
        // Preload hero image for LCP
        if (artistHero.imgMobile) {
          html = html.replace('</head>', `    <link rel="preload" as="image" href="${artistHero.imgMobile}" fetchpriority="high" media="(max-width: 1023px)">\n  </head>`);
        }
        if (artistHero.img) {
          const mq = artistHero.imgMobile ? ' media="(min-width: 1024px)"' : '';
          html = html.replace('</head>', `    <link rel="preload" as="image" href="${artistHero.img}" fetchpriority="high"${mq}>\n  </head>`);
        }
      }

      // --- Category page: /products/:catSlug ---
      const catMatch = cleanUrl.match(/^\/products\/([a-z0-9][a-z0-9-]*)$/);
      if (catMatch) {
        const catSlug = catMatch[1];
        const cat = CATEGORIES[catSlug];
        if (cat) {
          const catSeo = getSeoOverride(`category:${catSlug}`);
          const title = catSeo.title || cat.title || `${cat.name} — купить в BMGBRAND | ${SITE_NAME}`;
          const catDesc = catSeo.description || cat.desc;

          const breadcrumb = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
              { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${siteUrl}/products` },
              { "@type": "ListItem", "position": 3, "name": cat.name, "item": `${siteUrl}/products/${catSlug}` },
            ],
          };

          const socksFaq = catSlug === "socks" ? {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              { "@type": "Question", "name": "Какой состав у носков BOOOMERANGS?", "acceptedAnswer": { "@type": "Answer", "text": "Хлопок 75%, полиамид 17%, эластан 8%. Мягкие, комфортные, держат форму и цвет после стирки." } },
              { "@type": "Question", "name": "Какие размеры носков есть в наличии?", "acceptedAnswer": { "@type": "Answer", "text": "Носки BOOOMERANGS выпускаются в двух размерах: 34–39 (женские) и 40–45 (мужские). На странице каждой модели указан доступный размер." } },
              { "@type": "Question", "name": "Можно ли купить носки с необычным принтом оптом?", "acceptedAnswer": { "@type": "Answer", "text": "Да, для оптовых покупателей действуют специальные условия. Зарегистрируйтесь в разделе «Оптовым покупателям» или свяжитесь с нами." } },
              { "@type": "Question", "name": "Как ухаживать за носками с принтом?", "acceptedAnswer": { "@type": "Answer", "text": "Стирать при температуре до 30°C, не использовать отбеливатель, сушить без отжима. Так принт сохранится дольше." } },
              { "@type": "Question", "name": "Сколько идёт доставка носков по России?", "acceptedAnswer": { "@type": "Answer", "text": "Доставка СДЭК — 2–7 дней в зависимости от региона. Отправляем по всей России." } },
            ],
          } : null;

          const merchFaq = catSlug === "merch" ? {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              { "@type": "Question", "name": "Как купить мерч артиста на BMGBRAND?", "acceptedAnswer": { "@type": "Answer", "text": "Выберите артиста в каталоге, добавьте товар в корзину и оформите заказ. Оплата картой, СБП или Т-Pay. Доставка по всей России." } },
              { "@type": "Question", "name": "Мерч какихартистов продаётся на BMGBRAND?", "acceptedAnswer": { "@type": "Answer", "text": "BMGBRAND — официальный производитель мерча ГУДТАЙМС, Молодость внутри, Дикая Мята, Драгни, МультFильмы и других российских артистов." } },
              { "@type": "Question", "name": "Можно ли заказать мерч на заказ с логотипом?", "acceptedAnswer": { "@type": "Answer", "text": "Да. BMGBRAND производит мерч на заказ для брендов, артистов и мероприятий. Полный цикл: дизайн, производство, доставка. Подробнее на странице «Мерч на заказ»." } },
              { "@type": "Question", "name": "Из чего сделан мерч BMGBRAND?", "acceptedAnswer": { "@type": "Answer", "text": "Собственное производство полного цикла. Футболки — 100% хлопок или двухнитка. Носки — хлопок 75%. Контроль качества каждой партии." } },
            ],
          } : null;

          const schemas = [breadcrumb, socksFaq, merchFaq].filter(Boolean);
          const jsonLd = JSON.stringify(schemas.length === 1 ? schemas[0] : schemas);

          html = injectMeta(html, {
            title,
            description: catDesc,
            ogImage: `${siteUrl}/favicon.png`,
            ogType: "website",
            canonical: `${siteUrl}/products/${catSlug}`,
            jsonLd,
          });
          html = injectSeoBody(html, buildCategoryNoscript(catSlug, cat.name, catDesc, siteUrl));
        }
      }

      // --- Catalog page: /products ---
      if (cleanUrl === "/products") {
        const jsonLd = JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
            { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${siteUrl}/products` },
          ],
        });
        html = injectMeta(html, {
          title: `Каталог — одежда и аксессуары | ${SITE_NAME}`,
          description: "Каталог BMGBRAND — одежда с авторскими принтами, мерч артистов, носки, аксессуары. Доставка по всей России.",
          ogImage: `${siteUrl}/favicon.png`,
          canonical: `${siteUrl}/products`,
          jsonLd,
        });
        html = injectSeoBody(html, buildCatalogNoscript(siteUrl));
      }

      // --- Merch na zakaz page ---
      if (cleanUrl === "/merch-na-zakaz") {
        const merchOrderJsonLd = JSON.stringify([
          {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": `${SITE_NAME} (Booomerangs)`,
            "url": siteUrl,
            "image": `${siteUrl}/og-image.png`,
            "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары с авторскими принтами. Работаем по всей России.",
            "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressRegion": "Тульская область", "addressCountry": "RU" },
            "areaServed": "RU",
            "priceRange": "от 180 ₽",
            "sameAs": [
              "https://vk.com/bmgbrand",
              "https://t.me/bmg_booomerangs",
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "Мерч на заказ — BMGBRAND (Booomerangs)",
            "url": `${siteUrl}/merch-na-zakaz`,
            "speakable": {
              "@type": "SpeakableSpecification",
              "cssSelector": ["#merch-hero-desc", "#merch-faq"],
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "Создание мерча на заказ",
            "provider": { "@type": "Organization", "name": SITE_NAME, "url": siteUrl, "address": { "@type": "PostalAddress", "addressLocality": "Тула", "addressCountry": "RU" } },
            "description": "Производство мерча на заказ под ключ: футболки, худи, носки, аксессуары с авторскими принтами. Работаем по всей России. Тираж от 20 штук. Разработка дизайна бесплатно.",
            "areaServed": "RU",
            "serviceType": "Производство мерча",
            "offers": [
              { "@type": "Offer", "name": "Носки с принтом на заказ", "priceCurrency": "RUB", "price": "180", "description": "Носки с принтом от 180 ₽/пара при тираже от 50 пар. 200+ дизайнов." },
              { "@type": "Offer", "name": "Футболки на заказ", "priceCurrency": "RUB", "price": "900", "description": "Футболки с принтом от 900 ₽ при тираже от 20 штук. 100% хлопок." },
              { "@type": "Offer", "name": "Худи на заказ", "priceCurrency": "RUB", "price": "1800", "description": "Худи и свитшоты от 1 800 ₽ при тираже от 20 штук. Трёхнитка." },
              { "@type": "Offer", "name": "Брюки и джоггеры на заказ", "priceCurrency": "RUB", "price": "1500", "description": "Брюки и джоггеры от 1 500 ₽ при тираже от 20 штук." },
              { "@type": "Offer", "name": "Корпоративный мерч", "priceCurrency": "RUB", "price": "180", "description": "Мерч для компаний, мероприятий, фестивалей. Брендирование под ключ." },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              { "@type": "Question", "name": "Какой минимальный тираж для мерча на заказ?", "acceptedAnswer": { "@type": "Answer", "text": "Носки — от 50 пар, футболки и худи — от 20 штук, аксессуары — от 30 единиц. Для больших тиражей действуют скидки." } },
              { "@type": "Question", "name": "Сколько стоит мерч на заказ?", "acceptedAnswer": { "@type": "Answer", "text": "Носки с принтом — от 180 ₽/пара, футболки — от 900 ₽, худи — от 1 800 ₽, брюки — от 1 500 ₽. Точный расчёт делаем индивидуально." } },
              { "@type": "Question", "name": "Вы помогаете с разработкой дизайна мерча?", "acceptedAnswer": { "@type": "Answer", "text": "Да. Разработаем дизайн с нуля или адаптируем ваши материалы. Включено в стоимость при тиражах от 50 единиц." } },
              { "@type": "Question", "name": "Сколько времени занимает производство мерча?", "acceptedAnswer": { "@type": "Answer", "text": "Носки — от 10 рабочих дней. Одежда — 2–4 недели с момента согласования макета. Срочные заказы обсуждаются отдельно." } },
              { "@type": "Question", "name": "Вы работаете с физическими лицами и блогерами?", "acceptedAnswer": { "@type": "Answer", "text": "Да. Работаем с физлицами, ИП, ООО, блогерами, музыкантами и организаторами мероприятий. Среди клиентов: Гудтаймс, Молодость внутри, Дикая Мята." } },
              { "@type": "Question", "name": "Можно ли заказать мерч с моим логотипом?", "acceptedAnswer": { "@type": "Answer", "text": "Да. Предоставьте логотип в векторном формате (AI, EPS, SVG) или хорошем разрешении — подготовим макет. Если фирменного стиля нет — разработаем с нуля." } },
              { "@type": "Question", "name": "Вы доставляете мерч по всей России?", "acceptedAnswer": { "@type": "Answer", "text": "Да, отправляем по всей России через СДЭК. Для крупных тиражей возможна доставка паллетами через транспортные компании." } },
              { "@type": "Question", "name": "Что такое корпоративный мерч и как его заказать?", "acceptedAnswer": { "@type": "Answer", "text": "Корпоративный мерч — брендированная одежда и аксессуары с логотипом компании. Подходит для сотрудников, мероприятий и подарков. Оставьте заявку — менеджер свяжется в течение 24 часов." } },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
              { "@type": "ListItem", "position": 2, "name": "Мерч на заказ", "item": `${siteUrl}/merch-na-zakaz` },
            ],
          },
        ]);
        const merchSeo = getSeoOverride("merch_order");
        html = injectMeta(html, {
          title: merchSeo.title || MERCH_ORDER_SEO_DEFAULT.title,
          description: merchSeo.description || MERCH_ORDER_SEO_DEFAULT.description,
          ogImage: `${siteUrl}/og-image.png`,
          ogType: "website",
          canonical: `${siteUrl}/merch-na-zakaz`,
          jsonLd: merchOrderJsonLd,
        });
      }

      // --- Partner register page ---
      if (cleanUrl === "/partner/register" || cleanUrl === "/partner/login") {
        const partnerJsonLd = JSON.stringify([
          {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "Партнёрская программа BOOOMERANGS",
            "description": "Зарабатывайте 15–25% комиссии, рекомендуя одежду российского бренда BOOOMERANGS. Программа для самозанятых, ИП и юридических лиц. Выплаты без минимальной суммы за 5 рабочих дней.",
            "provider": { "@type": "Organization", "name": SITE_NAME, "url": siteUrl },
            "areaServed": "RU",
            "serviceType": "Партнёрская программа",
            "audience": { "@type": "Audience", "audienceType": "Самозанятые, ИП, юридические лица, блогеры, артисты" },
            "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "reviewCount": "63", "bestRating": "5" },
            "offers": { "@type": "Offer", "description": "Комиссия 15–25% с каждого оплаченного заказа по реферальной ссылке", "priceCurrency": "RUB" },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              { "@type": "Question", "name": "Сколько можно заработать в партнёрской программе BOOOMERANGS?", "acceptedAnswer": { "@type": "Answer", "text": "Комиссия от 15% до 25% с каждого оплаченного заказа. Процент растёт с объёмом продаж за месяц. Потолка нет." } },
              { "@type": "Question", "name": "Кто может стать партнёром BOOOMERANGS?", "acceptedAnswer": { "@type": "Answer", "text": "Самозанятый, индивидуальный предприниматель или юридическое лицо. Регистрация занимает несколько минут." } },
              { "@type": "Question", "name": "Как работает реферальная ссылка?", "acceptedAnswer": { "@type": "Answer", "text": "Вы получаете уникальную ссылку и промокод. С каждого заказа по вашей ссылке начисляется комиссия в личном кабинете." } },
              { "@type": "Question", "name": "Есть ли минимальная сумма для вывода комиссии?", "acceptedAnswer": { "@type": "Answer", "text": "Минимальной суммы нет. После 14-дневного холда выплатим на карту или расчётный счёт за 5 рабочих дней." } },
              { "@type": "Question", "name": "Что такое партнёрская программа для блогеров BOOOMERANGS?", "acceptedAnswer": { "@type": "Answer", "text": "Блогеры и артисты получают персональную страницу на booomerangs.ru/@slug, витрину мерча и договорной процент комиссии." } },
              { "@type": "Question", "name": "Когда я получу деньги после продажи?", "acceptedAnswer": { "@type": "Answer", "text": "После оплаты покупателем начинается 14-дневный холд. После его окончания средства доступны к выводу — выплата за 5 рабочих дней." } },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": siteUrl },
              { "@type": "ListItem", "position": 2, "name": "Партнёрская программа", "item": `${siteUrl}/partner/register` },
            ],
          },
        ]);
        const partnerSeo = getSeoOverride("partner_register");
        html = injectMeta(html, {
          title: partnerSeo.title || PARTNER_REGISTER_SEO_DEFAULT.title,
          description: partnerSeo.description || PARTNER_REGISTER_SEO_DEFAULT.description,
          ogImage: `${siteUrl}/og-partner.png`,
          ogType: "website",
          canonical: `${siteUrl}/partner/register`,
          jsonLd: partnerJsonLd,
        });
      }

      // --- Static pages ---
      const STATIC_PAGES: Record<string, { title: string; description: string }> = {
        "/about": {
          title: `О бренде | ${SITE_NAME}`,
          description: "BMGBRAND — российский бренд одежды с авторскими принтами из Тулы. Узнайте нашу историю, ценности и команду.",
        },
        "/faq": {
          title: `Вопросы и ответы | ${SITE_NAME}`,
          description: "Ответы на частые вопросы о заказах, доставке, оплате и возврате в интернет-магазине BMGBRAND.",
        },
        "/contacts": {
          title: `Контакты | ${SITE_NAME}`,
          description: "Контактная информация BMGBRAND. Свяжитесь с нами по вопросам заказов, сотрудничества и оптовых закупок.",
        },
        "/vacancies": {
          title: `Вакансии | ${SITE_NAME}`,
          description: "Открытые вакансии в команду BMGBRAND. Присоединяйтесь к нашему бренду одежды с авторскими принтами.",
        },
        "/terms": {
          title: `Условия использования | ${SITE_NAME}`,
          description: "Условия использования сайта и интернет-магазина BMGBRAND.",
        },
        "/privacy": {
          title: `Политика конфиденциальности | ${SITE_NAME}`,
          description: "Политика конфиденциальности и обработки персональных данных интернет-магазина BMGBRAND.",
        },
        "/links": {
          title: `Ссылки | ${SITE_NAME}`,
          description: "Официальные ссылки и социальные сети бренда BMGBRAND.",
        },
        "/concept": {
          title: `Концепция | ${SITE_NAME}`,
          description: "Концепция и философия бренда BMGBRAND — российский бренд одежды с авторскими принтами.",
        },
        "/blog": {
          title: `Блог | ${SITE_NAME}`,
          description: "Блог BMGBRAND — новости бренда, статьи о стиле и авторских дизайнах.",
        },
        "/wholesale-register": {
          title: `Оптовые закупки — регистрация | ${SITE_NAME}`,
          description: "Регистрация оптового покупателя BMGBRAND. Специальные цены и условия для бизнеса.",
        },
      };

      const staticPage = STATIC_PAGES[cleanUrl];
      if (staticPage) {
        let staticJsonLd: string | undefined;
        if (cleanUrl === "/faq") {
          staticJsonLd = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": getFaqItems().map(item => ({
              "@type": "Question",
              "name": item.question,
              "acceptedAnswer": { "@type": "Answer", "text": item.answer },
            })),
          });
        }
        html = injectMeta(html, {
          title: staticPage.title,
          description: staticPage.description,
          ogImage: `${siteUrl}/favicon.png`,
          canonical: `${siteUrl}${cleanUrl}`,
          jsonLd: staticJsonLd,
        });

        if (cleanUrl === "/faq") {
          html = injectSeoBody(html, buildFaqNoscript());
        } else if (cleanUrl === "/about") {
          html = injectSeoBody(html, buildAboutNoscript());
        } else if (cleanUrl === "/vacancies") {
          html = injectSeoBody(html, buildVacanciesNoscript());
        } else if (cleanUrl === "/blog") {
          html = injectSeoBody(html, buildBlogListNoscript(siteUrl));
        }
      }
    } catch (e) {
      console.error("[Static] Meta injection error:", e);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!isValidRoute) {
      html = html.replace('</head>', '  <meta name="robots" content="noindex,nofollow">\n  </head>');
      res.status(404);
    }

    res.send(html);
  });
}
