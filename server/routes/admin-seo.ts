import type { Express } from "express";
import { logError, logInfo } from "../logger";
import { storage, getCachedProductsForSeoAudit } from "../storage";
import {
  CATEGORIES as SEO_CATEGORY_DEFAULTS,
  ARTISTS as SEO_ARTIST_DEFAULTS,
  HOME_SEO_DEFAULT,
  CONCEPT_SEO_DEFAULT,
  MERCH_ORDER_SEO_DEFAULT,
  PARTNER_REGISTER_SEO_DEFAULT,
} from "../static";
import { CATEGORIES, normalizeCategories, type CategoryConfig } from "@shared/schema";

// Admin SEO + media upload routes extracted from routes.ts:
// - SEO audit (structured data / meta coverage health check)
// - SEO pages list (aggregated editable SEO fields for every page type)
// - SEO home hero (save slide-0 image/alt without clobbering carousel)
// - Upload image / video to Yandex Storage (WebP conversion via sharp)
// - Extract video thumbnail via ffmpeg → WebP
export function registerAdminSeoRoutes(
  app: Express,
  getAdminKey: () => string | undefined
) {
  // Admin: SEO audit — technical health check for structured data and meta coverage
  app.get("/api/admin/seo-audit", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    try {
      const all = getCachedProductsForSeoAudit();
      const visible = all.filter(p => !p.isHidden && !p.artistOnly && p.price > 0);
      const hidden = all.filter(p => p.isHidden || p.artistOnly || p.price === 0);

      const withSeoTitle = visible.filter(p => p.hasSeoTitle).length;
      const withSeoDesc = visible.filter(p => p.hasSeoDesc).length;
      const withSeoBody = visible.filter(p => p.hasSeoBody).length;
      const withImage = visible.filter(p => p.hasImage).length;

      const missingTitle = visible.filter(p => !p.hasSeoTitle).slice(0, 50).map(p => ({ id: p.id, slug: p.slug, name: p.name, category: p.category }));
      const missingDesc = visible.filter(p => !p.hasSeoDesc).slice(0, 50).map(p => ({ id: p.id, slug: p.slug, name: p.name, category: p.category }));
      const missingBody = visible.filter(p => !p.hasSeoBody).slice(0, 50).map(p => ({ id: p.id, slug: p.slug, name: p.name, category: p.category }));

      res.json({
        products: {
          total: all.length,
          visible: visible.length,
          hidden: hidden.length,
          withSeoTitle,
          withSeoDesc,
          withSeoBody,
          withImage,
          pctTitle: visible.length ? Math.round(withSeoTitle / visible.length * 100) : 0,
          pctDesc: visible.length ? Math.round(withSeoDesc / visible.length * 100) : 0,
          pctBody: visible.length ? Math.round(withSeoBody / visible.length * 100) : 0,
          missingTitle,
          missingDesc,
          missingBody,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: SEO section — aggregated list of every editable page with its
  // current effective title/description (admin override merged over the
  // hardcoded/default value) so the admin can see & edit real current SEO text.
  app.get("/api/admin/seo/pages", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const seoOverrides = await storage.getPageSettings("seo");

      const field = (defaultTitle: string | undefined, defaultDescription: string | undefined, override: any) => ({
        title: { default: defaultTitle || "", value: (typeof override?.title === "string" && override.title.trim()) ? override.title : (defaultTitle || "") },
        description: { default: defaultDescription || "", value: (typeof override?.description === "string" && override.description.trim()) ? override.description : (defaultDescription || "") },
      });

      const pages: any[] = [];

      // --- Home ---
      const homeSettings = await storage.getPageSettings("home");
      const homeHero = homeSettings?.hero || {};
      const homeHeroSlide = Array.isArray(homeHero.slides) && homeHero.slides.length > 0 ? homeHero.slides[0] : homeHero;
      pages.push({
        type: "home",
        key: "home",
        label: "Главная страница",
        fields: field(HOME_SEO_DEFAULT.title, HOME_SEO_DEFAULT.description, seoOverrides["home"]),
        hero: {
          heroImage: homeHeroSlide?.heroImage || "",
          heroImageMobile: homeHeroSlide?.heroImageMobile || "",
          heroImageAlt: homeHeroSlide?.heroImageAlt || "",
          note: Array.isArray(homeHero.slides) && homeHero.slides.length > 1 ? `Слайдер из ${homeHero.slides.length} слайдов — здесь редактируется только 1-й (главный) слайд. Остальные слайды и их картинки — в разделе «Страницы» → Hero.` : undefined,
        },
      });

      // --- Concept / Pre-drop ---
      let conceptSettings: Record<string, any> = {};
      try { conceptSettings = await storage.getPageSettings("concept"); } catch { /* none yet */ }
      const conceptHero = conceptSettings?.hero || {};
      pages.push({
        type: "concept",
        key: "concept",
        label: "Pre-drop (предзаказ)",
        fields: field(CONCEPT_SEO_DEFAULT.title, CONCEPT_SEO_DEFAULT.description, seoOverrides["concept"]),
        hero: {
          heroImage: conceptHero.heroImage || "",
          heroImageMobile: conceptHero.heroImageMobile || "",
          heroImageAlt: conceptHero.heroImageAlt || "",
        },
      });

      // --- Merch na zakaz (custom merch landing) ---
      const MERCH_ORDER_DEFAULT_FAQ: Array<{ question: string; answer: string }> = [
        { question: "Какой минимальный тираж для создания мерча на заказ?", answer: "Минимальный тираж зависит от типа продукции: носки - от 50 пар, футболки и худи - от 1 штуки, аксессуары - от 30 единиц." },
        { question: "Сколько стоит мерч на заказ?", answer: "Стоимость зависит от типа изделия, тиража и сложности принта. Точный расчёт делаем индивидуально - после того, как вы расскажете о задаче." },
        { question: "Вы помогаете с разработкой дизайна?", answer: "Да. Мы предоставляем полный цикл: от разработки концепции и дизайна до готовой продукции. Если у вас уже есть макет - адаптируем его под производство. Дизайнерская работа включена в стоимость заказа." },
        { question: "Сколько времени занимает изготовление?", answer: "Одежда - от 3 дней. Носки - от 14 рабочих дней. Срочные заказы обсуждаются отдельно." },
        { question: "Вы работаете с физическими лицами, блогерами и артистами?", answer: "Да. Работаем с физлицами, ИП, ООО, блогерами, музыкантами и организаторами мероприятий. Опыт: Гудтаймс, Молодость внутри, Дикая Мята, Драгни, МультFильмы." },
        { question: "Можно ли заказать мерч с моим логотипом или фирменным стилем?", answer: "Конечно. Предоставьте логотип в векторном формате (AI, EPS, SVG) или в хорошем разрешении - подготовим макет. Если фирменного стиля нет - разработаем с нуля." },
        { question: "Как выглядит качество продукции?", answer: "Носки — хлопок 75%, полиамид 17%, эластан 8%. Одежда выпускается из различных тканей на выбор — уточняйте у менеджера. Перед отгрузкой — контроль качества каждой партии." },
        { question: "Вы доставляете в другие города и регионы?", answer: "Да, отправляем по всей России. Работаем с СДЭК, ПЭК, Почтой России, Байкал Сервисом. По другим перевозчикам — уточняйте у менеджера." },
        { question: "Что происходит, если в партии окажется брак?", answer: "Мы несём полную ответственность за качество. Если обнаружен брак - перевыпускаем бракованные позиции за наш счёт или компенсируем стоимость. Перед отгрузкой каждая партия проходит контроль качества." },
      ];
      let merchOrderSettings: Record<string, any> = {};
      try { merchOrderSettings = await storage.getPageSettings("merch_order"); } catch { /* none yet */ }
      const merchOrderHero = merchOrderSettings?.hero || {};
      const merchOrderContent = (merchOrderSettings?.content as Record<string, any>) || {};
      pages.push({
        type: "merch_order",
        key: "merch_order",
        label: "Мерч на заказ",
        fields: field(MERCH_ORDER_SEO_DEFAULT.title, MERCH_ORDER_SEO_DEFAULT.description, seoOverrides["merch_order"]),
        hero: {
          heroImage: merchOrderHero.heroImage || "",
          heroImageMobile: merchOrderHero.heroImageMobile || "",
          heroImageAlt: merchOrderHero.heroImageAlt || "",
        },
        content: {
          h1: (merchOrderContent.h1 as string) || "",
          introParagraph: (merchOrderContent.introParagraph as string) || "",
          techText: (merchOrderContent.techText as string) || "",
          b2bText: (merchOrderContent.b2bText as string) || "",
          faqItems: Array.isArray(merchOrderContent.faqItems) && merchOrderContent.faqItems.length > 0
            ? merchOrderContent.faqItems as Array<{ question: string; answer: string }>
            : MERCH_ORDER_DEFAULT_FAQ,
        },
      });

      // --- Partner register (become-a-partner landing) ---
      let partnerRegisterSettings: Record<string, any> = {};
      try { partnerRegisterSettings = await storage.getPageSettings("partner_register"); } catch { /* none yet */ }
      const partnerRegisterHero = partnerRegisterSettings?.hero || {};
      pages.push({
        type: "partner_register",
        key: "partner_register",
        label: "Страница партнёра",
        fields: field(PARTNER_REGISTER_SEO_DEFAULT.title, PARTNER_REGISTER_SEO_DEFAULT.description, seoOverrides["partner_register"]),
        hero: {
          heroImage: partnerRegisterHero.heroImage || "",
          heroImageMobile: partnerRegisterHero.heroImageMobile || "",
          heroImageAlt: partnerRegisterHero.heroImageAlt || "",
          note: "Редактируется только 1-й слайд hero-баннера (реклама программы). 2-й слайд («Создавай вместе с BOOOMERANGS») остаётся неизменным.",
        },
      });

      // --- Categories & subcategories (dynamic config with hardcoded fallback) ---
      let cats: Record<string, CategoryConfig> = CATEGORIES;
      try {
        const siteConfig = await storage.getPageSettings("site_config");
        if (siteConfig?.categories_data) {
          const raw = typeof siteConfig.categories_data === 'string'
            ? JSON.parse(siteConfig.categories_data)
            : siteConfig.categories_data;
          const normalized = normalizeCategories(raw);
          if (normalized && Object.keys(normalized).length > 0) cats = normalized;
        }
      } catch { /* keep hardcoded fallback */ }

      for (const [slug, cat] of Object.entries(cats)) {
        const seoDefault = (SEO_CATEGORY_DEFAULTS as any)[slug];
        pages.push({
          type: "category",
          key: slug,
          label: cat.name,
          fields: field(seoDefault?.title || `${cat.name} — купить в BMGBRAND`, seoDefault?.desc, seoOverrides[`category:${slug}`]),
        });
        for (const sub of cat.subcategories || []) {
          const subKey = `${slug}:${sub.slug}`;
          pages.push({
            type: "subcategory",
            key: subKey,
            label: `${cat.name} → ${sub.name}`,
            fields: field(undefined, undefined, seoOverrides[`subcategory:${subKey}`]),
          });
          for (const subSub of (sub.subSubcategories || [])) {
            const subSubKey = `${slug}:${sub.slug}:${subSub.slug}`;
            pages.push({
              type: "subsubcategory",
              key: subSubKey,
              label: `${cat.name} → ${sub.name} → ${subSub.name}`,
              fields: field(
                `${subSub.name} — купить в BMGBRAND | ${sub.name}, ${cat.name}`,
                undefined,
                seoOverrides[`subsubcategory:${subSubKey}`]
              ),
            });
          }
        }
      }

      // --- Static / informational pages ---
      const staticPageDefs = [
        { key: "catalog",            label: "Каталог (/products)",                        defaultTitle: "Каталог — одежда и аксессуары | BMGBRAND",                                              defaultDesc: "Каталог BMGBRAND — одежда с авторскими принтами, мерч артистов, носки, аксессуары. Доставка по всей России." },
        { key: "about",              label: "О нас (/about)",                              defaultTitle: "О бренде BOOOMERANGS — история, производство, команда | BMGBRAND",                     defaultDesc: "BOOOMERANGS (BMGBRAND) — российский бренд одежды из Тулы. Основан в 2006 году, своё производство с 2019 года." },
        { key: "faq",                label: "FAQ — Вопросы и ответы (/faq)",               defaultTitle: "Вопросы и ответы | BMGBRAND",                                                          defaultDesc: "Ответы на частые вопросы о заказах, доставке, оплате и возврате в интернет-магазине BMGBRAND." },
        { key: "blog",               label: "Блог (/blog)",                                defaultTitle: "Блог BMGBRAND",                                                                        defaultDesc: "Новости, статьи и истории бренда BMGBRAND." },
        { key: "vacancies",          label: "Вакансии (/vacancies)",                       defaultTitle: "Вакансии — BMGBRAND",                                                                  defaultDesc: "Открытые вакансии в команду BMGBRAND." },
        { key: "terms",              label: "Пользовательское соглашение (/terms)",        defaultTitle: "Пользовательское соглашение | BMGBRAND",                                               defaultDesc: "Условия использования сайта BMGBRAND." },
        { key: "privacy",            label: "Политика конфиденциальности (/privacy)",      defaultTitle: "Политика конфиденциальности | BMGBRAND",                                               defaultDesc: "Политика обработки персональных данных BMGBRAND." },
        { key: "care",               label: "Уход за изделиями (/care)",                   defaultTitle: "Уход за изделиями | BMGBRAND",                                                         defaultDesc: "Рекомендации по уходу за одеждой и аксессуарами BMGBRAND." },
        { key: "links",              label: "Ссылки (/links)",                             defaultTitle: "BMGBRAND — Ссылки",                                                                    defaultDesc: "Официальные ссылки и соцсети бренда BMGBRAND." },
        { key: "gift_cards",         label: "Подарочные карты (/gift-cards)",              defaultTitle: "Подарочные карты BMGBRAND",                                                            defaultDesc: "Подарочные карты интернет-магазина BMGBRAND — идеальный подарок." },
        { key: "wholesale_register", label: "Оптовая программа (/wholesale/register)",     defaultTitle: "Оптовая программа BMGBRAND",                                                           defaultDesc: "Стать оптовым партнёром BMGBRAND — условия сотрудничества и регистрация." },
      ];
      for (const sp of staticPageDefs) {
        pages.push({
          type: "static",
          key: sp.key,
          label: sp.label,
          fields: field(sp.defaultTitle, sp.defaultDesc, seoOverrides[`static:${sp.key}`]),
        });
      }

      // --- Artists ---
      let artistPages: Record<string, any> = {};
      try { artistPages = await storage.getPageSettings("artist_pages"); } catch { /* none yet */ }
      const artistSlugs = new Set<string>([...Object.keys(SEO_ARTIST_DEFAULTS), ...Object.keys(artistPages)]);
      for (const slug of artistSlugs) {
        const seoDefault = (SEO_ARTIST_DEFAULTS as any)[slug];
        const settings = artistPages[slug] || {};
        const name = settings.name || seoDefault?.name || slug;
        pages.push({
          type: "artist",
          key: slug,
          label: `Мерч ${name}`,
          fields: field(
            `Мерч ${name} — купить официальный мерч | BMGBRAND`,
            seoDefault?.desc,
            { title: settings.seoTitle, description: settings.seoDescription },
          ),
          hero: {
            heroImage: settings.heroImage || "",
            heroImageMobile: settings.heroImageMobile || "",
            heroImageAlt: settings.heroImageAlt || "",
          },
        });
      }

      res.json({ pages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: SEO tab — save hero image/alt for the home page without clobbering
  // the multi-slide carousel (updates slide 0 only; other slides untouched).
  app.post("/api/admin/seo/home-hero", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { heroImage, heroImageMobile, heroImageAlt } = req.body;
      const homeSettings = await storage.getPageSettings("home");
      const hero = { ...(homeSettings?.hero || {}) };
      if (Array.isArray(hero.slides) && hero.slides.length > 0) {
        const newSlides = [...hero.slides];
        newSlides[0] = { ...newSlides[0], heroImage, heroImageMobile, heroImageAlt };
        hero.slides = newSlides;
      } else {
        hero.heroImage = heroImage;
        hero.heroImageMobile = heroImageMobile;
        hero.heroImageAlt = heroImageAlt;
      }
      await storage.setPageSectionSettings("home", "hero", hero);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Upload image for page settings
  app.post("/api/admin/upload-image", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const contentType = req.headers["content-type"] || "image/webp";
      const rawFilename = (req.headers["x-filename"] as string) || `upload_${Date.now()}.webp`;
      const filename = (() => { try { return decodeURIComponent(rawFilename); } catch { return rawFilename; } })();
      
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      
      if (buffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }
      
      const sharp = (await import("sharp")).default;
      const webpBuffer = await sharp(buffer)
        .webp({ quality: 85 })
        .toBuffer();

      const thumbBuffer = await sharp(buffer)
        .resize(800, null, { withoutEnlargement: true, kernel: 'lanczos3' })
        .sharpen()
        .webp({ quality: 88 })
        .toBuffer();
      
      const ts = Date.now();
      const cleanName = filename.replace(/\.[^.]+$/, ".webp").replace(/[^a-zA-Z0-9._-]/g, "_");
      
      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      const s3Key = `site/${ts}_${cleanName}`;
      const s3ThumbKey = s3Key.replace('.webp', '_thumb.webp');
      
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
        },
      });
      
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: webpBuffer,
        ContentType: "image/webp",
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3ThumbKey,
        Body: thumbBuffer,
        ContentType: "image/webp",
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      
      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
      logInfo(`[Upload] Image uploaded: ${url}`);
      
      res.json({ url, success: true });
    } catch (err: any) {
      logError("[Upload] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Upload video file
  app.post("/api/admin/upload-video", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const contentType = req.headers["content-type"] || "video/mp4";
      const rawFilenameVideo = (req.headers["x-filename"] as string) || `video_${Date.now()}.mp4`;
      const filename = (() => { try { return decodeURIComponent(rawFilenameVideo); } catch { return rawFilenameVideo; } })();

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }

      if (buffer.length > 100 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large (max 100MB)" });
      }

      const ts = Date.now();
      const ext = filename.match(/\.(mp4|webm|mov|avi)$/i)?.[0] || ".mp4";
      const cleanName = filename.replace(/\.[^.]+$/, ext).replace(/[^a-zA-Z0-9._-]/g, "_");

      const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
      const s3Key = `site/video/${ts}_${cleanName}`;

      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "ru-central1",
        endpoint: "https://storage.yandexcloud.net",
        credentials: {
          accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
        },
      });

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read",
        CacheControl: "public, max-age=31536000, immutable",
      }));

      const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
      logInfo(`[Upload] Video uploaded: ${url} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

      res.json({ url, success: true });
    } catch (err: any) {
      logError("[Upload] Video error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Extract video thumbnail via ffmpeg (server-side, no CORS issues)
  app.post("/api/admin/extract-video-thumbnail", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    const expectedKey = getAdminKey();
    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { videoUrl } = req.body as { videoUrl?: string };
      if (!videoUrl || typeof videoUrl !== "string") {
        return res.status(400).json({ error: "videoUrl required" });
      }

      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const { mkdtemp, readFile, rm } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const { createHash } = await import("crypto");
      const execAsync = promisify(exec);

      const tmpDir = await mkdtemp(join(tmpdir(), "vthumb-"));
      const outPath = join(tmpDir, "thumb.jpg");

      try {
        // ffmpeg читает видео по URL напрямую, берёт 1 кадр на 0.5с
        // -ss перед -i для быстрого seek; timeout 30s
        await execAsync(
          `ffmpeg -y -ss 0.5 -i "${videoUrl.replace(/"/g, '\\"')}" -vframes 1 -q:v 3 "${outPath}"`,
          { timeout: 30000 }
        );

        const jpegBuffer = await readFile(outPath);

        // Конвертируем в WebP через sharp — 400px достаточно для кружка 80–96px
        const sharp = (await import("sharp")).default;
        const webpBuffer = await sharp(jpegBuffer)
          .resize(400, null, { withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();

        // Детерминированное имя: MD5 от videoUrl — один файл на видео,
        // повторное извлечение перезаписывает тот же объект, мусора нет
        const urlHash = createHash("md5").update(videoUrl).digest("hex").slice(0, 16);
        const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";
        const s3Key = `site/thumb_${urlHash}.webp`;

        const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({
          region: "ru-central1",
          endpoint: "https://storage.yandexcloud.net",
          credentials: {
            accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
            secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
          },
        });

        await s3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: webpBuffer,
          ContentType: "image/webp",
          ACL: "public-read",
          CacheControl: "public, max-age=31536000, immutable",
        }));

        const url = `https://storage.yandexcloud.net/${bucketName}/${s3Key}`;
        logInfo(`[Thumbnail] Extracted from video: ${url}`);
        res.json({ url, success: true });
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    } catch (err: any) {
      logError("[Thumbnail] ffmpeg error:", err.message);
      res.status(500).json({ error: "Не удалось извлечь кадр: " + err.message });
    }
  });
}
