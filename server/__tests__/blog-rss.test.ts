import { describe, expect, it } from "vitest";
import {
  MAX_FEED_ITEMS,
  MAX_TITLE_LENGTH,
  blogPostUrl,
  blogRssFullText,
  blogRssTitle,
  buildBlogRssFeed,
  formatRfc822Date,
  formatRfc822DateTime,
} from "@shared/blog-rss";
import type { BlogPostForSsr } from "@shared/blog-post";

function post(over: Partial<BlogPostForSsr> & { id: number }): BlogPostForSsr {
  return {
    id: over.id,
    title: over.title ?? `Статья ${over.id}`,
    date: over.date ?? "1 октября 2026",
    dateIso: over.dateIso ?? "2026-10-01",
    category: over.category ?? "Мерч",
    author: over.author ?? "BOOOMERANGS Team",
    excerpt: over.excerpt ?? "",
    image: over.image ?? "",
    content: over.content ?? "<p>Текст статьи</p>",
    seoTitle: over.seoTitle ?? "",
    seoDescription: over.seoDescription ?? "",
    tags: over.tags ?? [],
    productsVisible: over.productsVisible ?? false,
    productsTitle: over.productsTitle ?? "Товары из статьи",
    productsCategory: over.productsCategory ?? "",
    productsSubcategory: over.productsSubcategory ?? "",
    linkedProducts: over.linkedProducts ?? [],
  };
}

const OPTS = { siteUrl: "https://booomerangs.ru", now: new Date("2026-10-08T10:00:00Z") };

describe("formatRfc822Date", () => {
  it("дату из статьи переводит в RFC-822 с московским смещением", () => {
    expect(formatRfc822Date("2026-10-08")).toBe("Thu, 08 Oct 2026 12:00:00 +0300");
    expect(formatRfc822Date("2026-10-01")).toBe("Thu, 01 Oct 2026 12:00:00 +0300");
  });

  it("поддерживает високосный февраль и отклоняет несуществующие дни", () => {
    expect(formatRfc822Date("2024-02-29")).toBe("Thu, 29 Feb 2024 12:00:00 +0300");
    expect(formatRfc822Date("2026-02-30")).toBeNull();
    expect(formatRfc822Date("2026-13-01")).toBeNull();
  });

  it("не-ISO значение возвращает null (в фиде элемент будет без pubDate)", () => {
    expect(formatRfc822Date("")).toBeNull();
    expect(formatRfc822Date("29 сентября 2026")).toBeNull();
  });
});

describe("formatRfc822DateTime", () => {
  it("пересчитывает момент времени в МСК, а не берёт локальные часы сервера", () => {
    // Контейнер живёт в UTC: 10:00Z — это 13:00 в Москве.
    expect(formatRfc822DateTime(new Date("2026-10-08T10:00:00Z"))).toBe(
      "Thu, 08 Oct 2026 13:00:00 +0300",
    );
    expect(formatRfc822DateTime(new Date("2026-10-07T22:30:15Z"))).toBe(
      "Thu, 08 Oct 2026 01:30:15 +0300",
    );
  });

  it("lastBuildDate канала берёт реальное время сборки", () => {
    const xml = buildBlogRssFeed([post({ id: 8 })], OPTS);
    expect(xml).toContain("<lastBuildDate>Thu, 08 Oct 2026 13:00:00 +0300</lastBuildDate>");
  });
});

describe("blogRssTitle", () => {
  it("убирает точку в конце и лишние пробелы", () => {
    expect(blogRssTitle("  Как выбрать худи.  ")).toBe("Как выбрать худи");
    expect(blogRssTitle("Худи\nна осень")).toBe("Худи на осень");
  });

  it("обрезает заголовок до лимита Яндекса (200 символов)", () => {
    const long = "слово ".repeat(80).trim();
    const cut = blogRssTitle(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(long.startsWith(cut)).toBe(true);
  });
});

describe("blogRssFullText", () => {
  it("отдаёт текст без HTML-разметки", () => {
    expect(blogRssFullText("<p>Худи из <b>футера</b></p><img src='x.jpg' alt='фото'>")).toBe(
      "Худи из футера",
    );
  });

  it("вырезает script/style целиком", () => {
    expect(blogRssFullText("<style>p{color:red}</style><p>Текст</p><script>alert(1)</script>")).toBe("Текст");
  });
});

describe("buildBlogRssFeed", () => {
  it("содержит обязательные для Яндекса элементы канала и item", () => {
    const xml = buildBlogRssFeed([post({ id: 3 })], OPTS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss xmlns:yandex="http://news.yandex.ru"');
    expect(xml).toContain('<rss');
    expect(xml).toContain('version="2.0"');
    expect(xml).toContain("<language>ru</language>");
    expect(xml).toContain("<title>Статья 3</title>");
    expect(xml).toContain("<link>https://booomerangs.ru/blog/3</link>");
    expect(xml).toContain("<pubDate>Thu, 01 Oct 2026 12:00:00 +0300</pubDate>");
    expect(xml).toContain("<yandex:full-text>Текст статьи</yandex:full-text>");
    expect(xml).toContain("<yandex:genre>article</yandex:genre>");
  });

  it("сортирует статьи от новых к старым", () => {
    const xml = buildBlogRssFeed(
      [post({ id: 1, dateIso: "2026-09-01" }), post({ id: 2, dateIso: "2026-10-05" })],
      OPTS,
    );
    expect(xml.indexOf("/blog/2")).toBeLessThan(xml.indexOf("/blog/1"));
  });

  it("экранирует спецсимволы XML в заголовке и тексте", () => {
    const xml = buildBlogRssFeed(
      [post({ id: 4, title: "Худи & футболка <3", content: "<p>100% хлопок & лён</p>" })],
      OPTS,
    );
    expect(xml).toContain("Худи &amp; футболка &lt;3");
    expect(xml).toContain("100% хлопок &amp; лён");
    expect(xml).not.toMatch(/<yandex:full-text>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("картинку отдаёт абсолютным URL в media:group", () => {
    const xml = buildBlogRssFeed([post({ id: 5, image: "/uploads/blog/5.webp" })], OPTS);
    expect(xml).toContain('<media:content url="https://booomerangs.ru/uploads/blog/5.webp" type="image/webp"/>');
    expect(xml).toContain('<media:thumbnail url="https://booomerangs.ru/uploads/blog/5.webp"/>');
  });

  it("статью без валидной даты ставит в конец и без pubDate", () => {
    const xml = buildBlogRssFeed(
      [post({ id: 6, dateIso: "не дата" }), post({ id: 7, dateIso: "2026-10-02" })],
      OPTS,
    );
    const datedAt = xml.indexOf("/blog/7");
    const undatedAt = xml.indexOf("/blog/6");
    expect(datedAt).toBeGreaterThan(-1);
    expect(undatedAt).toBeGreaterThan(datedAt);
    const lastItem = xml.slice(undatedAt);
    expect(lastItem).not.toContain("<pubDate>");
  });

  it("ограничивает количество материалов в канале", () => {
    const posts = Array.from({ length: MAX_FEED_ITEMS + 5 }, (_, i) =>
      post({ id: i + 1, dateIso: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const xml = buildBlogRssFeed(posts, OPTS);
    expect(xml.match(/<item>/g)?.length).toBe(MAX_FEED_ITEMS);
  });

  it("не оставляет относительных ссылок на статьи", () => {
    expect(blogPostUrl("https://booomerangs.ru/", 9)).toBe("https://booomerangs.ru/blog/9");
    const xml = buildBlogRssFeed([post({ id: 9 })], OPTS);
    expect(xml).not.toContain("<link>/blog/9</link>");
  });
});
