import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getCachedProductMetaBySlug, getCachedArtistHeroImage, getCachedRawPageSettings } from "./storage";

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
  "sale":        { name: "Распродажа", desc: "Распродажа BMGBRAND — выгодные цены на одежду и аксессуары. Доставка по всей России." },
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

function applyBotMetaInjection(html: string, url: string, origin: string): string {
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
        const priceValidUntil = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0];
        const availability = meta.preorderEnabled ? "https://schema.org/PreOrder"
          : meta.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
        const jsonLd = JSON.stringify([
          {
            "@context": "https://schema.org", "@type": "Product",
            "name": meta.title, "description": desc,
            "image": meta.images.length > 0 ? meta.images : [image],
            "url": `${origin}/${slug}`, "sku": meta.sku,
            "brand": { "@type": "Brand", "name": SITE_NAME },
            "offers": {
              "@type": "Offer", "priceCurrency": "RUB",
              "price": (meta.price / 100).toFixed(2),
              "priceValidUntil": priceValidUntil,
              "availability": availability,
              "itemCondition": "https://schema.org/NewCondition",
              "url": `${origin}/${slug}`,
              "seller": { "@type": "Organization", "name": SITE_NAME },
              "hasMerchantReturnPolicy": {
                "@type": "MerchantReturnPolicy",
                "applicableCountry": "RU",
                "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                "merchantReturnDays": 14,
                "returnMethod": "https://schema.org/ReturnByMail",
                "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
              },
              "shippingDetails": {
                "@type": "OfferShippingDetails",
                "shippingRate": { "@type": "MonetaryAmount", "currency": "RUB", "minValue": "0", "maxValue": "600" },
                "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "RU" },
                "deliveryTime": {
                  "@type": "ShippingDeliveryTime",
                  "handlingTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 2, "unitCode": "DAY" },
                  "transitTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 10, "unitCode": "DAY" },
                },
              },
            },
            ...(meta.category ? { "category": meta.category } : {}),
            ...(meta.colors.length > 0 ? { "color": meta.colors.join(", ") } : {}),
            ...(meta.sizes.length > 0 ? { "size": meta.sizes.join(", ") } : {}),
          },
          {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": origin },
              { "@type": "ListItem", "position": 2, "name": "Каталог", "item": `${origin}/products` },
              ...(meta.category ? [{ "@type": "ListItem", "position": 3, "name": CATEGORIES[meta.category]?.name || meta.category, "item": `${origin}/products/${meta.category}` }] : []),
              { "@type": "ListItem", "position": meta.category ? 4 : 3, "name": meta.title, "item": `${origin}/${slug}` },
            ],
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
  } catch (e) {
    console.error("[Vite] Meta injection error:", e);
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
      page = applyBotMetaInjection(page, url, origin);

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
