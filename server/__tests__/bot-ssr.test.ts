import { describe, it, expect, afterEach } from "vitest";
import { isBot, isBrowser, CYRILLIC_TO_CANONICAL, renderArtist, renderSubcategory, botSsrMiddleware } from "../bot-ssr";
import { pageSettingsCache, productsCache } from "../storage";

describe("isBot / isBrowser", () => {
  it("определяет поисковых ботов", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)")).toBe(true);
  });

  it("не путает обычные браузеры с ботами", () => {
    expect(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe(false);
    expect(isBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe(true);
  });
});

describe("CYRILLIC_TO_CANONICAL", () => {
  it("ведёт с кириллических слагов на английские каноны (для 301)", () => {
    expect(CYRILLIC_TO_CANONICAL["tolstovki"]).toBe("hoodies");
    expect(CYRILLIC_TO_CANONICAL["futbolki"]).toBe("t-shirts");
  });

  it("все значения — непустые строки", () => {
    for (const [from, to] of Object.entries(CYRILLIC_TO_CANONICAL)) {
      expect(typeof from).toBe("string");
      expect(typeof to).toBe("string");
      expect(to.length).toBeGreaterThan(0);
    }
  });
});

describe("renderSubcategory: пустая подкатегория", () => {
  // Реальный случай: в конфиге SALE есть «Носки» (sale-socks) и «Куртки»
  // (sale-jackets), но товаров в них нет. Робот получал 404 на адрес, который
  // есть в меню; теперь — 200 с noindex вместо 404.
  const seed = () => {
    pageSettingsCache.set("site_config", {
      categories_data: JSON.stringify({
        sale: {
          name: "SALE",
          slug: "sale",
          subcategories: [
            { name: "Худи", slug: "hoodie" },
            { name: "Носки", slug: "sale-socks" },
          ],
        },
      }),
    });
    productsCache.set("all", [
      { id: 1, slug: "sale-hoodie", name: "Худи SALE", price: 199000, stock: 2, category: "sale", subcategory: "Худи", isHidden: false, artistOnly: false },
    ]);
  };

  afterEach(() => {
    pageSettingsCache.clear();
    productsCache.clear();
  });

  it("отдаёт 200-страницу с noindex вместо null", () => {
    seed();
    const html = renderSubcategory("sale-socks");
    expect(html).not.toBeNull();
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/sale-socks"/);
    expect(html).toContain("<h1>Носки</h1>");
  });

  it("по-прежнему возвращает null для несуществующего слага", () => {
    seed();
    expect(renderSubcategory("not-a-real-subcategory")).toBeNull();
  });
});

describe("botSsrMiddleware: /concept/:slug", () => {
  // Страницы кампаний читаются из page_settings(`concept_campaign_<slug>`) только
  // из кэша. Раньше без прогрева робот получал оболочку главной, а у скрытой
  // кампании — soft-404 с title главной.
  const botUa = "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)";

  const makeReq = (path: string) => ({
    method: "GET",
    path,
    originalUrl: path,
    headers: { "user-agent": botUa },
    query: {},
  }) as any;

  const makeRes = () => {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(name: string, value: string) { res.headers[name] = value; return res; },
      status(code: number) { res.statusCode = code; return res; },
      type() { return res; },
      send(payload: string) { res.body = payload; return res; },
      end() { return res; },
      redirect(code: number, location: string) { res.statusCode = code; res.headers.Location = location; return res; },
    };
    return res;
  };

  afterEach(() => {
    pageSettingsCache.clear();
    productsCache.clear();
  });

  it("отдаёт HTML кампании из прогретого кэша", async () => {
    pageSettingsCache.set("concept_campaign_bmgbrand", {
      hero: { title: "BMG 2026", visible: true },
    });
    const res = makeRes();
    let nextCalled = false;

    await botSsrMiddleware(makeReq("/concept/bmgbrand"), res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.headers["X-Bot-SSR"]).toBe("rendered");
    expect(res.body).toContain("<title>BMG 2026 | Pre-drop BOOOMERANGS</title>");
  });

  it("несуществующую кампанию (пустые настройки и нет товаров) отдаёт как 404", async () => {
    // Именно так хранится YDB-промах: строк нет → в кэше {}.
    pageSettingsCache.set("concept_campaign_nonexistent-campaign", {});
    const res = makeRes();
    let nextCalled = false;

    await botSsrMiddleware(makeReq("/concept/nonexistent-campaign"), res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('name="robots" content="noindex"');
  });

  it("скрытую кампанию отдаёт как 404 с noindex, а не как главную", async () => {
    pageSettingsCache.set("concept_campaign_hidden-campaign", {
      hero: { title: "Скрытая", visible: false },
    });
    const res = makeRes();
    let nextCalled = false;

    await botSsrMiddleware(makeReq("/concept/hidden-campaign"), res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.headers["X-Bot-SSR"]).toBe("concept-not-found");
    expect(res.body).toContain('name="robots" content="noindex"');
    expect(res.body).not.toContain("BOOOMERANGS — российский бренд");
  });
});

describe("renderArtist", () => {
  const setArtistPages = (pages: Record<string, any> | null) => {
    if (pages === null) pageSettingsCache.clear();
    else pageSettingsCache.set("artist_pages", pages);
  };

  afterEach(() => {
    pageSettingsCache.clear();
  });

  it("ставит title/description из админки выше автотекста", () => {
    setArtistPages({
      vashana: {
        name: "Вашана",
        role: "Фестиваль",
        aboutText: "Текст о коллаборации, который не должен попасть в meta description.",
        seoTitle: "Официальный мерч Вашана (VASHANA) купить",
        seoDescription: "Описание из админки про мерч Вашаны.",
      },
    });

    const html = renderArtist("vashana");
    expect(html).not.toBeNull();
    expect(html).toContain("<title>Официальный мерч Вашана (VASHANA) купить</title>");
    // aboutText остаётся в видимом тексте страницы, но не подменяет meta description.
    const metaDescription = html!.match(/<meta name="description" content="([^"]*)"/)?.[1] || "";
    expect(metaDescription).toBe("Описание из админки про мерч Вашаны.");
    expect(metaDescription).not.toContain("Текст о коллаборации");
    // Один title и один description — без дублей в документе.
    expect(html!.match(/<title>/g)).toHaveLength(1);
    expect(html!.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain('/@vashana"');
  });

  it("без SEO-полей оставляет прежний автотекст", () => {
    setArtistPages({ molodostvnutri: { name: "Молодость внутри" } });

    const html = renderArtist("molodostvnutri");
    expect(html).toContain("<title>Молодость внутри × BOOOMERANGS</title>");
  });

  it("игнорирует пустые и пробельные SEO-поля", () => {
    setArtistPages({
      molodostvnutri: { name: "Молодость внутри", seoTitle: "   ", seoDescription: "" },
    });

    const html = renderArtist("molodostvnutri");
    expect(html).toContain("<title>Молодость внутри × BOOOMERANGS</title>");
    expect(html).toContain("Официальный мерч Молодость внутри");
  });

  it("возвращает null, если кэш пуст или артиста нет", () => {
    setArtistPages(null);
    expect(renderArtist("vashana")).toBeNull();

    setArtistPages({ vashana: { name: "Вашана" } });
    expect(renderArtist("mark-i-monti")).toBeNull();
  });
});
