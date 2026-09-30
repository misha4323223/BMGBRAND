import { type Express } from "express";
import { logError } from "./logger";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getCachedProductMetaBySlug, getCachedArtistHeroImage, getCachedRawPageSettings, ensurePageSettingsCached } from "./storage";
import { CATEGORIES as SCHEMA_CATEGORIES, buildCategoryIndex, resolveProductCategoryPaths, sortProductCategoryPaths } from "../shared/schema";
import { buildProductJsonLd } from "../shared/product-jsonld";
import { resolveBlogPostForSsr, parseBlogIndex, blogPageTitle, blogDescriptionFor, buildBlogPostJsonLd, buildBlogBreadcrumbJsonLd, type BlogPostForSsr } from "../shared/blog-post";
import { sanitizeHtmlBlock } from "./lib/product-utils";

const SITE_NAME = "BMGBRAND";

const ARTISTS: Record<string, { name: string; desc: string }> = {
  "goodtimes":      { name: "ГУДТАЙМС",        desc: "Официальный мерч ГУДТАЙМС — купить футболки, худи, аксессуары. Доставка по всей России." },
  "molodostvnutri": { name: "Молодость внутри", desc: "Официальный мерч Молодость внутри — купить одежду и аксессуары. Доставка по всей России." },
  "dikaya-myata":   { name: "ДИКАЯ МЯТА",       desc: "Официальный мерч ДИКАЯ МЯТА — купить худи, футболки, аксессуары. Доставка по всей России." },
  "dragni":         { name: "ДРАГНИ",           desc: "Официальный мерч ДРАГНИ — купить одежду и аксессуары. Доставка по всей России." },
  "multfilmy":      { name: "МультFильмы",      desc: "Официальный мерч МультFильмы — купить уникальную одежду и аксессуары. Доставка по всей России." },
};

const CATEGORIES: Record<string, { name: string; desc: string }> = {
  "clothing":    { name: "Одежда",      desc: "Купить одежду с авторскими принтами BMGBRAND — худи, свитшоты, футболки, шорты. Доставка по всей России." },
  "merch":       { name: "Мерч",        desc: "Купить официальный мерч артистов BMGBRAND — одежда и аксессуары с уникальными принтами. Доставка по всей России." },
  "socks":       { name: "Носки",       desc: "Купить носки BMGBRAND — стильные носки с уникальными принтами. Доставка по всей России." },
  "accessories": { name: "Аксессуары", desc: "Купить аксессуары BMGBRAND — шапки, сумки, ремни. Доставка по всей России." },
  "sale":        { name: "SALE", desc: "Распродажа BMGBRAND — выгодные цены на одежду и аксессуары. Доставка по всей России." },
};

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function injectMeta(html: string, opts: {
  title: string; description: string; ogImage: string;
  ogType?: string; canonical?: string; jsonLd?: string;
}): string {
  const { title, description, ogImage, ogType = "website", canonical, jsonLd } = opts;
  const t = escHtml(title);
  const d = escHtml(description.slice(0, 220));
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
  }

  if (jsonLd) {
    html = html.replace('</head>', `    <script type="application/ld+json" data-rh="true">${jsonLd}</script>\n  </head>`);
  }

  return html;
}

/**
 * Noscript-блок статьи (зеркало static.ts): H1, мета-строка, картинка и
 * полный HTML-текст — чтобы контент был в первом HTML-ответе и без JS.
 */
function buildBlogPostNoscript(post: BlogPostForSsr, siteUrl: string): string {
  const image = post.image
    ? (post.image.startsWith("http") ? post.image : `${siteUrl}${post.image}`)
    : "";
  const metaLine = [
    post.date ? `<time datetime="${escHtml(post.dateIso)}">${escHtml(post.date)}</time>` : "",
    escHtml(post.category),
    escHtml(post.author),
  ].filter(Boolean).join(" · ");
  return `<noscript><article>` +
    `<h1>${escHtml(post.title)}</h1>` +
    (metaLine ? `<p>${metaLine}</p>` : "") +
    (image ? `<img src="${escHtml(image)}" alt="${escHtml(post.title)}" style="max-width:100%;height:auto">` : "") +
    sanitizeHtmlBlock(post.content) +
    `<p><a href="${escHtml(siteUrl + "/blog")}">← Все статьи блога</a></p>` +
    `</article></noscript>`;
}

async function applyBotMetaInjection(html: string, url: string, origin: string): Promise<string> {
  const cleanUrl = url.split('?')[0].split('#')[0];

  try {
    // --- Product page: /:slug ---
    const knownRoutes = new Set(['/', '/products', '/cart', '/checkout', '/about', '/admin', '/verify-email', '/reset-password', '/profile', '/favorites', '/vacancies', '/faq', '/terms', '/privacy', '/links', '/concept', '/blog']);
    const knownPrefixes = ['/products/', '/wholesale/', '/gift-cards/', '/blog/', '/artist/', '/order-success/', '/order-failed/', '/track/', '/api/', '/assets/'];
    const isKnownRoute = knownRoutes.has(cleanUrl) || knownPrefixes.some(p => cleanUrl.startsWith(p));
    const slugMatch = !isKnownRoute ? cleanUrl.match(/^\/([a-z0-9][a-z0-9-]*[a-z0-9])(?:\/?)$/) : null;

    if (slugMatch) {
      const slug = decodeURIComponent(slugMatch[1]);
      const meta = getCachedProductMetaBySlug(slug);
      if (meta && meta.title) {
        const isMerch = ["merch", "мерч"].includes(meta.category.toLowerCase());
        const title = meta.seoTitle || `${meta.title}${isMerch ? " — купить мерч" : " — купить"} | ${SITE_NAME}`;
        const desc = meta.seoDescription || [
          isMerch ? `Купить мерч ${meta.title} BOOOMERANGS` : `Купить ${meta.title} BOOOMERANGS`,
          meta.sizes.length > 0 ? `Размеры: ${meta.sizes.join(", ")}.` : "",
          "Доставка по России СДЭК.",
          meta.description ? meta.description.slice(0, 80) : "",
        ].filter(Boolean).join(" ").slice(0, 220);
        const image = meta.image.startsWith("http") ? meta.image : `${origin}${meta.image}`;
        const bcPaths = sortProductCategoryPaths(resolveProductCategoryPaths(
          { category: meta.category, subcategory: meta.subcategory, subSubcategory: meta.subSubcategory, additionalCategories: meta.additionalCategories },
          buildCategoryIndex(SCHEMA_CATEGORIES),
        ));
        const bcPrimary = bcPaths[0] || null;
        const bcItems: any[] = [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
          { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${origin}/products` },
        ];
        let bcPos = 3;
        if (bcPrimary) {
          bcItems.push({ "@type": "ListItem", "position": bcPos++, "name": SCHEMA_CATEGORIES[bcPrimary.categorySlug]?.name || bcPrimary.categorySlug, "item": `${origin}/products/${bcPrimary.categorySlug}` });
          if (bcPrimary.subcategorySlug) {
            bcItems.push({ "@type": "ListItem", "position": bcPos++, "name": bcPrimary.subcategoryName || bcPrimary.subcategorySlug, "item": `${origin}/${bcPrimary.subcategorySlug}` });
          }
          if (bcPrimary.subcategorySlug && bcPrimary.subSubcategorySlug) {
            bcItems.push({ "@type": "ListItem", "position": bcPos++, "name": bcPrimary.subSubcategoryName || bcPrimary.subSubcategorySlug, "item": `${origin}/products/${bcPrimary.categorySlug}/${bcPrimary.subcategorySlug}/${bcPrimary.subSubcategorySlug}` });
          }
        } else if (meta.category) {
          bcItems.push({ "@type": "ListItem", "position": bcPos++, "name": CATEGORIES[meta.category]?.name || meta.category, "item": `${origin}/products/${meta.category}` });
        }
        bcItems.push({ "@type": "ListItem", "position": bcPos, "name": meta.title, "item": `${origin}/${slug}` });
        const productSchema = buildProductJsonLd({
          id: meta.productId,
          name: meta.title,
          seoName: meta.seoTitle,
          description: meta.description,
          seoDescription: meta.seoDescription,
          images: meta.images.length > 0 ? meta.images : [meta.image],
          siteUrl: origin,
          url: origin + "/" + slug,
          sku: meta.article,
          modelSku: meta.modelSku,
          color: meta.color || meta.colors[0] || null,
          category: bcPrimary
            ? [
                SCHEMA_CATEGORIES[bcPrimary.categorySlug]?.name || bcPrimary.categorySlug,
                bcPrimary.subcategoryName,
                bcPrimary.subSubcategoryName,
              ]
            : [SCHEMA_CATEGORIES[meta.category]?.name || meta.category],
          sizes: meta.sizes,
          specsHtml: meta.specsHtml,
          composition: meta.composition,
          careInstructions: meta.careInstructions,
          measurements: meta.measurements,
          seoBody: meta.seoBody,
          price: meta.price,
          salePrice: meta.salePrice,
          discountPercent: meta.discountPercent,
          stock: meta.stock,
          stockBySize: meta.sizeStock,
          preorder: meta.preorderEnabled,
        }, { onError: (message) => logError("[vite] " + message) });
        const jsonLd = JSON.stringify([
          ...(productSchema ? [productSchema] : []),
          {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": bcItems,
          },
        ]);
        return injectMeta(html, { title, description: desc, ogImage: image, ogType: "product", canonical: `${origin}/${slug}`, jsonLd });
      }
    }

    // --- Artist/creator page: /@:slug ---
    const artistMatch = cleanUrl.match(/^\/@([a-z0-9][a-z0-9-]*)$/);
    if (artistMatch) {
      const artistSlug = artistMatch[1];
      const staticArtist = ARTISTS[artistSlug];
      const artistHero = getCachedArtistHeroImage(artistSlug);
      const artistName = staticArtist?.name || artistHero.name;
      const artistDesc = staticArtist?.desc || (artistName
        ? `Официальный мерч ${artistName} — купить одежду и аксессуары с символикой артиста. Доставка по всей России.`
        : null);
      if (artistName && artistDesc) {
        const title = `Мерч ${artistName} — купить официальный мерч | ${SITE_NAME}`;
        const artistOgImage = artistHero.img || artistHero.imgMobile || `${origin}/og-image.png`;
        const jsonLd = JSON.stringify({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
            { "@type": "ListItem", "position": 2, "name": "Мерч", "item": `${origin}/products/merch` },
            { "@type": "ListItem", "position": 3, "name": artistName, "item": `${origin}/@${artistSlug}` },
          ],
        });
        return injectMeta(html, { title, description: artistDesc, ogImage: artistOgImage, canonical: `${origin}/@${artistSlug}`, jsonLd });
      }
    }

    // --- Category page: /products/:catSlug ---
    const catMatch = cleanUrl.match(/^\/products\/([a-z0-9][a-z0-9-]*)$/);
    if (catMatch) {
      const cat = CATEGORIES[catMatch[1]];
      if (cat) {
        const title = `${cat.name} — купить в BMGBRAND | ${SITE_NAME}`;
        const jsonLd = JSON.stringify({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
            { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${origin}/products` },
            { "@type": "ListItem", "position": 3, "name": cat.name, "item": `${origin}/products/${catMatch[1]}` },
          ],
        });
        return injectMeta(html, { title, description: cat.desc, ogImage: `${origin}/og-image.png`, canonical: `${origin}/products/${catMatch[1]}`, jsonLd });
      }
    }

    // --- Catalog page ---
    if (cleanUrl === "/products") {
      return injectMeta(html, {
        title: `Каталог — одежда и аксессуары | ${SITE_NAME}`,
        description: "Каталог BMGBRAND — уличная одежда, мерч артистов, носки, аксессуары. Доставка по всей России.",
        ogImage: `${origin}/og-image.png`,
        canonical: `${origin}/products`,
      });
    }

    // --- Blog article: /blog/{id} (мета в первом HTML-ответе) ---
    const blogArticleId = parseBlogIndex(cleanUrl.match(/^\/blog\/([^/]+)\/?$/)?.[1]);
    if (blogArticleId !== null) {
      // Существующая статья не должна отдавать 404 из-за пустого кэша
      // page settings: на промахе точечно прогреваем blog_pages из YDB.
      await ensurePageSettingsCached("blog_pages");
      const post = resolveBlogPostForSsr(
        getCachedRawPageSettings("blog_pages") as Record<string, any> | null,
        (getCachedRawPageSettings("home") as Record<string, any> | null)?.blog?.items,
        blogArticleId,
      );
      if (post) {
        const url = `${origin}/blog/${post.id}`;
        const image = post.image
          ? (post.image.startsWith("http") ? post.image : `${origin}${post.image}`)
          : `${origin}/og-image.png`;
        const withMeta = injectMeta(html, {
          title: blogPageTitle(post),
          description: blogDescriptionFor(post),
          ogImage: image,
          ogType: "article",
          canonical: url,
          jsonLd: JSON.stringify([
            buildBlogPostJsonLd(post, { url, siteUrl: origin }),
            buildBlogBreadcrumbJsonLd(post, { url, siteUrl: origin }),
          ]),
        });
        return withMeta.replace("</body>", `${buildBlogPostNoscript(post, origin)}\n</body>`);
      }
    }
  } catch (e) {
    logError("[Vite] Meta injection error:", e);
  }

  return html;
}

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // Дедупликация URL блога (как в prod static.ts и bot-ssr):
      // /blog/{id}/ → /blog/{id}, /blog/ → /blog (301).
      const cleanBlogUrl = url.split('?')[0].split('#')[0];
      if (cleanBlogUrl === "/blog/") {
        res.redirect(301, "/blog");
        return;
      }
      if (cleanBlogUrl.startsWith("/blog/") && cleanBlogUrl.endsWith("/")) {
        res.redirect(301, cleanBlogUrl.replace(/\/+$/, ""));
        return;
      }
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      let page = await vite.transformIndexHtml(url, template);

      const origin = `${req.protocol}://${req.get('host')}`;
      page = await applyBotMetaInjection(page, url, origin);

      // Inject home page settings for dev mode (same pattern as production static.ts).
      // Eliminates the settingsLoading blank screen by pre-populating React Query cache.
      const cleanUrl = url.split('?')[0].split('#')[0];
      if (cleanUrl === '/' || cleanUrl === '') {
        const homeSettings = getCachedRawPageSettings('home');
        if (homeSettings) {
          const safeSettings = JSON.stringify(homeSettings).replace(/<\/script>/gi, '<\\/script>');
          page = page.replace('</head>', `    <script>window.__HOME_SETTINGS__=${safeSettings};</script>\n  </head>`);
        }
      }

      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
