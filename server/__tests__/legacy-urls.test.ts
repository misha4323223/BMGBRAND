import { describe, it, expect } from "vitest";
import {
  HIDDEN_ARTIST_SLUGS,
  LEGACY_FLAT_REDIRECTS,
  isHiddenArtistSlug,
  resolveLegacyUrl,
} from "../lib/legacy-urls";

const none = () => false;
const live = (...slugs: string[]) => (slug: string) => slugs.includes(slug);

const expectRedirect = (decision: unknown, target: string) => {
  expect(decision).toMatchObject({ status: 301, target });
};

describe("resolveLegacyUrl: старый WooCommerce", () => {
  it("/product/:slug/ ведёт на живой товар", () => {
    expectRedirect(
      resolveLegacyUrl("/product/noski-booomerangs-doshik-r188-krasnyj-40-45/", live("noski-booomerangs-doshik-r188-krasnyj-40-45")),
      "/noski-booomerangs-doshik-r188-krasnyj-40-45",
    );
  });

  it("/product/:slug/?add-to-cart=… тоже ведёт на товар (query уже отрезан)", () => {
    expectRedirect(
      resolveLegacyUrl("/product/hudi-bmgbrand-logo-01", live("hudi-bmgbrand-logo-01")),
      "/hudi-bmgbrand-logo-01",
    );
  });

  it("мёртвый товар с понятным префиксом уходит в свой раздел", () => {
    expectRedirect(
      resolveLegacyUrl("/product/noski-booomerangs-ikra-r199-chernyj-40-45", none),
      "/products/socks",
    );
  });

  it("путь с query не ломает slug (?add-to-cart)", () => {
    expectRedirect(
      resolveLegacyUrl("/product/noski-x-40-45?add-to-cart=1", live("noski-x")),
      "/noski-x",
    );
  });

  it("мёртвый товар без префикса — 410, а не 404", () => {
    expect(resolveLegacyUrl("/product/unknown-thing-xyz", none)).toMatchObject({ status: 410 });
  });

  it("/product/:slug/feed/ — мусор CMS", () => {
    expect(resolveLegacyUrl("/product/hudi-bmgbrand-logo-01/feed/", none)).toMatchObject({ status: 410 });
  });

  it("/product-category/:path/ ведёт в каталог", () => {
    expectRedirect(resolveLegacyUrl("/product-category/noski-2/podarochnye-nabory/", none), "/products/socks");
    expectRedirect(resolveLegacyUrl("/product-category/dikaya-myata/", none), "/dikaya-myata");
    expectRedirect(resolveLegacyUrl("/product-category/unknown/", none), "/products");
  });
});

describe("resolveLegacyUrl: мусор CMS и числовые ID", () => {
  it.each([
    "/wp-json/",
    "/wp-admin/admin-ajax.php",
    "/wp-content/uploads/x.jpg",
    "/category/без-рубрики/",
    "/feed",
    "/xmlrpc.php",
  ])("%s → 410", (url) => {
    expect(resolveLegacyUrl(url, none)).toMatchObject({ status: 410 });
  });

  it("числовой ID старого импорта → 410", () => {
    expect(resolveLegacyUrl("/1782920232484", none)).toMatchObject({ status: 410 });
    expect(resolveLegacyUrl("/1777458981102/", none)).toMatchObject({ status: 410 });
  });
});

describe("resolveLegacyUrl: Tilda", () => {
  it("tproduct находит живой товар по хвосту slug'а", () => {
    expectRedirect(
      resolveLegacyUrl("/gift-sets/tproduct/763467710-277842192422-podarochnii-nabor-dikaya-myata", live("podarochnii-nabor-dikaya-myata")),
      "/podarochnii-nabor-dikaya-myata",
    );
  });

  it("tproduct без живого товара в gift-sets ведёт на подарочные карты", () => {
    expectRedirect(
      resolveLegacyUrl("/gift-sets/tproduct/763467710-277842192422-podarochnii-nabor", none),
      "/gift-cards",
    );
  });

  it("tproduct вне gift-sets без товара → 410", () => {
    expect(resolveLegacyUrl("/hoodies/tproduct/763465783-167656274072-sviter", none)).toMatchObject({ status: 410 });
  });
});

describe("resolveLegacyUrl: плоские легаси-разделы", () => {
  it.each([
    ["/main", "/"],
    ["/contacts", "/about"],
    ["/offer", "/terms"],
    ["/policy6/", "/privacy"],
    ["/kurtki2/", "/products/clothing/jackets"],
    ["/noski", "/products/socks"],
    ["/hudi", "/hoodies"],
    ["/bryuki", "/products/clothing/trousers"],
    ["/kruzhki", "/products/accessories"],
    ["/krossovki", "/products"],
    ["/korotkie-34-39", "/products/socks"],
    ["/klassicheskie-40-45/", "/products/socks"],
    ["/t-shirt", "/t-shirts"],
  ])("%s → %s", (url, target) => {
    expectRedirect(resolveLegacyUrl(url, none), target);
  });

  it("каждая запись карты ведёт на внутренний путь", () => {
    for (const target of Object.values(LEGACY_FLAT_REDIRECTS)) {
      expect(target.startsWith("/")).toBe(true);
    }
  });
});

describe("resolveLegacyUrl: варианты slug'ов", () => {
  it("грязный слаг с №/_ → живой нормализованный", () => {
    expectRedirect(
      resolveLegacyUrl("/shapka-bmgbrand_bini_detskaya_b01-1-chernyj", live("shapka-bmgbrand-bini-detskaya-b01-1-chernyj")),
      "/shapka-bmgbrand-bini-detskaya-b01-1-chernyj",
    );
  });

  it("размерный хвост → товар без размера", () => {
    expectRedirect(
      resolveLegacyUrl("/noski-bmgbrand-klassika-sport-sc05-zelenyj-40-45-3", live("noski-bmgbrand-klassika-sport-sc05-zelenyj")),
      "/noski-bmgbrand-klassika-sport-sc05-zelenyj",
    );
  });

  it("клон -2 → базовый товар", () => {
    expectRedirect(
      resolveLegacyUrl("/futbolka-chaos-2", live("futbolka-chaos")),
      "/futbolka-chaos",
    );
  });

  it("живой товар с -2 в конце не трогаем", () => {
    expect(resolveLegacyUrl("/shorty-dikaya-myata-oranzhevye-2", live("shorty-dikaya-myata-oranzhevye-2"))).toBeNull();
  });

  it("скрытый товар (есть в кэше) не редиректим — у него свой ответ", () => {
    expect(resolveLegacyUrl("/bryuki-bmgbrand-velyur-chernyj", live("bryuki-bmgbrand-velyur-chernyj"))).toBeNull();
  });

  it("живой раздел /longsliv не считается товаром с префиксом", () => {
    expect(resolveLegacyUrl("/longsliv", none)).toBeNull();
  });

  it("мёртвый раздел /svitshot (404 на боевом) уходит в /sweatshirts", () => {
    expectRedirect(resolveLegacyUrl("/svitshot", none), "/sweatshirts");
  });

  it("мёртвый товар по префиксу — 301 в раздел", () => {
    expectRedirect(resolveLegacyUrl("/futbolka-chaos-24", none), "/t-shirts");
    expectRedirect(resolveLegacyUrl("/shapka-bmgbrand-bini-aw24-fioletovyj", none), "/products/accessories/headwear");
  });
});

describe("resolveLegacyUrl: не вмешивается в живые адреса", () => {
  it.each([
    "/",
    "/products",
    "/products/socks",
    "/products/clothing/hoodies/xudi-s-nacyosom",
    "/hoodies",
    // Живые разделы, которые нельзя перехватывать (проверено на боевом сайте).
    "/longsliv",
    "/hoodie",
    "/@goodtimes",
    "/blog/5",
    "/api/products",
    "/assets/index.js",
  ])("%s → null", (url) => {
    expect(resolveLegacyUrl(url, none)).toBeNull();
  });

  it("неизвестный плоский слаг без префикса остаётся обычному роутингу", () => {
    expect(resolveLegacyUrl("/nonexistent-slug-xyz", none)).toBeNull();
  });
});

describe("isHiddenArtistSlug", () => {
  it("скрывает технические и пустые страницы артистов", () => {
    expect(isHiddenArtistSlug("vashana")).toBe(true);
    expect(isHiddenArtistSlug("VASHANA")).toBe(true);
    expect(isHiddenArtistSlug("artist-1")).toBe(true);
    expect(isHiddenArtistSlug("artist-2")).toBe(true);
    expect(isHiddenArtistSlug("artist-1772386526792")).toBe(true);
  });

  it("не трогает нормальных артистов", () => {
    expect(isHiddenArtistSlug("goodtimes")).toBe(false);
    expect(isHiddenArtistSlug("molodostvnutri")).toBe(false);
    expect(isHiddenArtistSlug("")).toBe(false);
    expect(HIDDEN_ARTIST_SLUGS.has("vashana")).toBe(true);
  });
});
