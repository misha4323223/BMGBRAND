import { describe, it, expect } from "vitest";
import {
  parseBlogDateRu,
  parseBlogIndex,
  stripBlogHtml,
  blogDescriptionFor,
  resolveBlogPostForSsr,
  blogPageTitle,
  buildBlogPostJsonLd,
  buildBlogBreadcrumbJsonLd,
} from "../../shared/blog-post";

const RAW_POST = {
  title: "Худи: гид по выбору",
  seoTitle: "Худи с принтом — как выбрать | BOOOMERANGS",
  seoDescription: "Разбираем, как выбрать худи: плотность футера, посадка, уход.",
  date: "24 сентября 2026",
  category: "Гид",
  author: "BOOOMERANGS Team",
  excerpt: "Короткий тизер статьи.",
  image: "/uploads/blog/hoodie.jpg",
  content: "<p>Первый абзац.</p><h2>Подзаголовок</h2><p>Второй абзац.</p>",
  tags: ["худи", "стиль"],
  linkedProducts: [12, "34"],
  productsVisible: true,
  productsTitle: "Худи из статьи",
  productsCategory: "clothing",
};

describe("parseBlogDateRu", () => {
  it("переводит русскую дату в ISO", () => {
    expect(parseBlogDateRu("24 сентября 2026")).toBe("2026-09-24");
    expect(parseBlogDateRu("1 января 2026")).toBe("2026-01-01");
  });

  it("возвращает исходное значение, если формат незнакомый", () => {
    expect(parseBlogDateRu("2026-09-24")).toBe("2026-09-24");
    expect(parseBlogDateRu("")).toBe("");
  });
});

describe("parseBlogIndex", () => {
  it("принимает только цифры", () => {
    expect(parseBlogIndex("0")).toBe(0);
    expect(parseBlogIndex("12")).toBe(12);
    expect(parseBlogIndex("abc")).toBeNull();
    expect(parseBlogIndex("-1")).toBeNull();
    expect(parseBlogIndex("1.5")).toBeNull();
    expect(parseBlogIndex(undefined)).toBeNull();
  });
});

describe("stripBlogHtml", () => {
  it("убирает теги, скрипты и лишние пробелы", () => {
    expect(stripBlogHtml("<p>Привет&nbsp;<b>мир</b></p>")).toBe("Привет мир");
    expect(stripBlogHtml("<script>alert(1)</script>текст")).toBe("текст");
    expect(stripBlogHtml("a &amp; b")).toBe("a & b");
  });
});

describe("resolveBlogPostForSsr", () => {
  it("собирает статью из blog_pages", () => {
    const post = resolveBlogPostForSsr({ "2": RAW_POST }, [], 2);
    expect(post).not.toBeNull();
    expect(post!.id).toBe(2);
    expect(post!.title).toBe("Худи: гид по выбору");
    expect(post!.dateIso).toBe("2026-09-24");
    expect(post!.linkedProducts).toEqual([12, 34]);
    expect(post!.productsVisible).toBe(true);
  });

  it("падает на фолбэк home.blog.items, если blog_pages пустого поля не имеет", () => {
    const post = resolveBlogPostForSsr({ "0": { content: "<p>текст</p>" } }, [{ title: "Из списка", date: "5 мая 2026", category: "Новости" }], 0);
    expect(post).not.toBeNull();
    expect(post!.title).toBe("Из списка");
    expect(post!.dateIso).toBe("2026-05-05");
  });

  it("возвращает null для отсутствующей, скрытой или пустой статьи", () => {
    expect(resolveBlogPostForSsr({}, [], 0)).toBeNull();
    expect(resolveBlogPostForSsr({ "0": { ...RAW_POST, visible: false } }, [], 0)).toBeNull();
    expect(resolveBlogPostForSsr({ "0": { title: "Без текста" } }, [], 0)).toBeNull();
    expect(resolveBlogPostForSsr({ "0": RAW_POST }, [], -1)).toBeNull();
  });
});

describe("blogPageTitle / blogDescriptionFor", () => {
  it("берёт SEO-заголовок статьи", () => {
    const post = resolveBlogPostForSsr({ "0": RAW_POST }, [], 0)!;
    expect(blogPageTitle(post)).toBe("Худи с принтом — как выбрать | BOOOMERANGS");
  });

  it("без SEO-заголовка добавляет бренд BOOOMERANGS (без BMGBRAND)", () => {
    const post = resolveBlogPostForSsr({ "0": { ...RAW_POST, seoTitle: "" } }, [], 0)!;
    expect(blogPageTitle(post)).toBe("Худи: гид по выбору — блог BOOOMERANGS");
    expect(blogPageTitle(post)).not.toContain("BMGBRAND");
  });

  it("описание: seoDescription → excerpt → текст статьи", () => {
    const withSeo = resolveBlogPostForSsr({ "0": RAW_POST }, [], 0)!;
    expect(blogDescriptionFor(withSeo)).toBe("Разбираем, как выбрать худи: плотность футера, посадка, уход.");

    const withExcerpt = resolveBlogPostForSsr({ "0": { ...RAW_POST, seoDescription: "" } }, [], 0)!;
    expect(blogDescriptionFor(withExcerpt)).toBe("Короткий тизер статьи.");

    const fromContent = resolveBlogPostForSsr({ "0": { ...RAW_POST, seoDescription: "", excerpt: "" } }, [], 0)!;
    expect(blogDescriptionFor(fromContent)).toBe("Первый абзац. Подзаголовок Второй абзац.");
  });

  it("обрезает длинное описание по границе слова", () => {
    const long = "слово ".repeat(60).trim();
    const post = resolveBlogPostForSsr({ "0": { ...RAW_POST, seoDescription: long } }, [], 0)!;
    const desc = blogDescriptionFor(post, 50);
    expect(desc.length).toBeLessThanOrEqual(51);
    expect(desc.endsWith("…")).toBe(true);
  });
});

describe("JSON-LD статьи", () => {
  const post = resolveBlogPostForSsr({ "3": RAW_POST }, [], 3)!;
  const opts = { url: "https://booomerangs.ru/blog/3", siteUrl: "https://booomerangs.ru" };

  it("BlogPosting с абсолютной картинкой, датой и BOOOMERANGS-издателем", () => {
    const ld = buildBlogPostJsonLd(post, opts);
    expect(ld["@type"]).toBe("BlogPosting");
    expect(ld.url).toBe(opts.url);
    expect(ld.headline).toBe("Худи: гид по выбору");
    expect(ld.image).toEqual(["https://booomerangs.ru/uploads/blog/hoodie.jpg"]);
    expect(ld.datePublished).toBe("2026-09-24");
    expect(ld.publisher.name).toBe("BOOOMERANGS");
    expect(ld.publisher["@id"]).toBe("https://booomerangs.ru/#organization");
    expect(ld.articleSection).toBe("Гид");
    expect(ld.keywords).toBe("худи, стиль");
    expect(JSON.stringify(ld)).not.toContain("BMGBRAND");
  });

  it("использует og-image, если картинки у статьи нет", () => {
    const noImg = resolveBlogPostForSsr({ "3": { ...RAW_POST, image: "" } }, [], 3)!;
    expect(buildBlogPostJsonLd(noImg, opts).image).toEqual(["https://booomerangs.ru/og-image.png"]);
  });

  it("уже абсолютные картинки не дублируют домен", () => {
    const abs = resolveBlogPostForSsr({ "3": { ...RAW_POST, image: "https://cdn.example/x.jpg" } }, [], 3)!;
    expect(buildBlogPostJsonLd(abs, opts).image).toEqual(["https://cdn.example/x.jpg"]);
  });

  it("хлебные крошки: Главная → Блог → Статья", () => {
    const bc = buildBlogBreadcrumbJsonLd(post, opts);
    expect(bc["@type"]).toBe("BreadcrumbList");
    expect(bc.itemListElement.map((i: any) => i.name)).toEqual(["Главная", "Блог", "Худи: гид по выбору"]);
    expect(bc.itemListElement[1].item).toBe("https://booomerangs.ru/blog");
    expect(bc.itemListElement[2].item).toBe(opts.url);
  });
});
