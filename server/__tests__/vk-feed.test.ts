import { describe, expect, it, beforeAll } from "vitest";
import { escapeXml, formatFeedPriceRub, vkFeedDescription } from "@shared/feed-utils";
import {
  isVkFriendlyImage,
  storageKeyFromUrl,
  vkDirectStorageUrl,
  vkImagePathToSourceCandidates,
  vkJpegKeyFor,
  vkPictureUrl,
} from "../lib/vk-image";
import { VK_FEED_MIRROR_KEY, isVkFeedXml, vkFeedMirrorUrl } from "../vk-feed-mirror";
import { filterExistingVkImages, vkImageSourceKeys } from "../lib/vk-image";

describe("escapeXml", () => {
  it("экранирует спецсимволы XML", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });

  it("не трогает обычный текст", () => {
    expect(escapeXml("Худи BOOOMERANGS 100% хлопок")).toBe("Худи BOOOMERANGS 100% хлопок");
  });
});

describe("formatFeedPriceRub", () => {
  it("обычный формат — с копейками", () => {
    expect(formatFeedPriceRub(295000, false)).toBe("2950.00");
    expect(formatFeedPriceRub(39900, false)).toBe("399.00");
  });

  it("формат VK — целые рубли без .00", () => {
    expect(formatFeedPriceRub(295000, true)).toBe("2950");
    expect(formatFeedPriceRub(39900, true)).toBe("399");
  });

  it("корректно округляет некруглые копейки", () => {
    expect(formatFeedPriceRub(295050, true)).toBe("2951");
    expect(formatFeedPriceRub(0, true)).toBe("0");
    expect(formatFeedPriceRub(0, false)).toBe("0.00");
  });
});

describe("storageKeyFromUrl", () => {
  it("извлекает ключ из нашего бакета", () => {
    expect(
      storageKeyFromUrl("https://storage.yandexcloud.net/bmg/site/photo.webp"),
    ).toBe("site/photo.webp");
    expect(
      storageKeyFromUrl("https://storage.yandexcloud.net/bmg/products/a/b.webp?x=1"),
    ).toBe("products/a/b.webp");
  });

  it("отклоняет чужие URL", () => {
    expect(storageKeyFromUrl("https://example.com/bmg/site/photo.webp")).toBeNull();
    expect(storageKeyFromUrl("")).toBeNull();
    expect(storageKeyFromUrl(undefined as any)).toBeNull();
  });

  it("не пропускает выход из каталога (в т.ч. percent-encoded)", () => {
    expect(
      storageKeyFromUrl("https://storage.yandexcloud.net/bmg/site/%2e%2e/secret.webp"),
    ).toBeNull();
    expect(storageKeyFromUrl("https://storage.yandexcloud.net/bmg/../x.webp")).toBeNull();
  });
});

describe("isVkFriendlyImage", () => {
  it("jpg/jpeg/png — дружелюбные, webp — нет", () => {
    expect(isVkFriendlyImage("https://x/a.jpg")).toBe(true);
    expect(isVkFriendlyImage("https://x/a.JPEG")).toBe(true);
    expect(isVkFriendlyImage("https://x/a.png")).toBe(true);
    expect(isVkFriendlyImage("https://x/a.webp")).toBe(false);
  });
});

describe("vkJpegKeyFor", () => {
  it("добавляет _vk перед расширением", () => {
    expect(vkJpegKeyFor("site/foo.webp")).toBe("site/foo_vk.jpg");
    expect(vkJpegKeyFor("products/bar.JPG")).toBe("products/bar_vk.jpg");
  });
});

describe("vkFeedDescription", () => {
  it("короткое или пустое описание заменяется запасным (порог ВК — 10 символов)", () => {
    expect(vkFeedDescription("500 мл", "fallback")).toBe("fallback");
    expect(vkFeedDescription("", "fallback")).toBe("fallback");
    expect(vkFeedDescription("   ", "fallback")).toBe("fallback");
    expect(vkFeedDescription("123456789", "fallback")).toBe("fallback");
  });

  it("описание длинее 9 символов остаётся, пробелы нормализуются", () => {
    expect(vkFeedDescription("100% Хлопок", "fallback")).toBe("100% Хлопок");
    expect(vkFeedDescription("  Футболка   с\n принтом ", "fb")).toBe("Футболка с принтом");
  });
});

describe("vkDirectStorageUrl", () => {
  beforeAll(() => {
    process.env.YANDEX_STORAGE_BUCKET_NAME = "bmg";
  });

  it("webp из бакета → прямая ссылка на JPEG-версию _vk.jpg", () => {
    expect(
      vkDirectStorageUrl("https://storage.yandexcloud.net/bmg/site/foo.webp"),
    ).toBe("https://storage.yandexcloud.net/bmg/site/foo_vk.jpg");
  });

  it("jpg/png в бакете → прямая ссылка на сам файл", () => {
    expect(
      vkDirectStorageUrl("https://storage.yandexcloud.net/bmg/site/foo.jpg"),
    ).toBe("https://storage.yandexcloud.net/bmg/site/foo.jpg");
  });

  it("прокси /vk-img/ → прямая ссылка на JPEG-версию", () => {
    expect(
      vkDirectStorageUrl("https://booomerangs.ru/vk-img/site/foo.jpg"),
    ).toBe("https://storage.yandexcloud.net/bmg/site/foo_vk.jpg");
    expect(
      vkDirectStorageUrl("https://booomerangs.ru/vk-img/site/foo.webp"),
    ).toBe("https://storage.yandexcloud.net/bmg/site/foo_vk.jpg");
  });

  it("чужой хост или не-картинка → null (вызывающий оставляет оригинал)", () => {
    expect(vkDirectStorageUrl("https://example.com/a.jpg")).toBeNull();
    expect(vkDirectStorageUrl("https://booomerangs.ru/vk-img/..")).toBeNull();
    expect(vkDirectStorageUrl("")).toBeNull();
  });
});

describe("vkPictureUrl", () => {
  const base = "https://booomerangs.ru";

  it("webp из нашего бакета → /vk-img/…​.jpg", () => {
    expect(
      vkPictureUrl(base, "https://storage.yandexcloud.net/bmg/site/photo_1.webp"),
    ).toBe("https://booomerangs.ru/vk-img/site/photo_1.jpg");
  });

  it("jpg/png проходят без изменений", () => {
    const jpg = "https://storage.yandexcloud.net/bmg/site/photo.jpg";
    const png = "https://storage.yandexcloud.net/bmg/site/photo.png";
    expect(vkPictureUrl(base, jpg)).toBe(jpg);
    expect(vkPictureUrl(base, png)).toBe(png);
  });

  it("чужой webp не проксируем", () => {
    const foreign = "https://example.com/photo.webp";
    expect(vkPictureUrl(base, foreign)).toBe(foreign);
  });
});

describe("vkImagePathToSourceCandidates", () => {
  it("строит кандидатов: webp первым", () => {
    expect(vkImagePathToSourceCandidates("site/photo.jpg")).toEqual([
      "site/photo.webp",
      "site/photo.jpg",
      "site/photo.jpeg",
      "site/photo.png",
    ]);
  });

  it("отклоняет выход из каталога и не-картинки", () => {
    expect(vkImagePathToSourceCandidates("../secrets.jpg")).toEqual([]);
    expect(vkImagePathToSourceCandidates("site/%2e%2e/x.jpg")).toEqual([]);
    expect(vkImagePathToSourceCandidates("site/photo.webp")).toEqual([]);
    expect(vkImagePathToSourceCandidates("")).toEqual([]);
  });
});

describe("зеркало VK-фида", () => {
  it("ссылка для ВК оканчивается на .yml (требование справки ВК)", () => {
    expect(VK_FEED_MIRROR_KEY.endsWith(".yml")).toBe(true);
    const prev = process.env.YANDEX_STORAGE_BUCKET_NAME;
    process.env.YANDEX_STORAGE_BUCKET_NAME = "bmg";
    expect(vkFeedMirrorUrl()).toBe(`https://storage.yandexcloud.net/bmg/${VK_FEED_MIRROR_KEY}`);
    if (prev === undefined) delete process.env.YANDEX_STORAGE_BUCKET_NAME;
    else process.env.YANDEX_STORAGE_BUCKET_NAME = prev;
  });

  it("принимает только настоящий YML-фид", () => {
    expect(isVkFeedXml('<?xml version="1.0" encoding="UTF-8"?>\n<yml_catalog date="x">')).toBe(true);
    expect(isVkFeedXml("<!DOCTYPE html><html><body>404</body></html>")).toBe(false);
    expect(isVkFeedXml("")).toBe(false);
    // Страница ошибки контейнера не должна попасть в бакет как «фид».
    expect(isVkFeedXml('<?xml version="1.0"?><error>boom</error>')).toBe(false);
  });
});

describe("filterExistingVkImages — убрать битые картинки из VK-фида", () => {
  it("наш бакет → ключ сбрасывается от query; чужой хост → null (проверке не подлежит)", () => {
    expect(vkImageSourceKeys("https://storage.yandexcloud.net/bmg/site/a.webp?v=1769945169494")).toEqual([
      "site/a.webp",
    ]);
    expect(vkImageSourceKeys("https://example.com/photo.webp")).toBeNull();
    expect(vkImageSourceKeys("https://booomerangs.ru/vk-img/site/a.jpg")).toEqual([
      "site/a.webp",
      "site/a.jpg",
      "site/a.jpeg",
      "site/a.png",
    ]);
  });

  it("оставляет картинку, если исходник есть хотя бы в одном варианте", async () => {
    const checked: string[] = [];
    const out = await filterExistingVkImages(
      ["https://booomerangs.ru/vk-img/site/a.jpg"],
      async (key) => {
        checked.push(key);
        return key === "site/a.webp";
      },
    );
    expect(out).toEqual(["https://booomerangs.ru/vk-img/site/a.jpg"]);
    expect(checked).toEqual(["site/a.webp"]);
  });

  it("убирает ссылку, которой нет в хранилище", async () => {
    const out = await filterExistingVkImages(
      ["https://storage.yandexcloud.net/bmg/products/gone.webp"],
      async () => false,
    );
    expect(out).toEqual([]);
  });

  it("чужие ссылки не проверяем и не удаляем", async () => {
    const foreign = "https://example.com/photo.webp";
    const out = await filterExistingVkImages([foreign], async () => false);
    expect(out).toEqual([foreign]);
  });

  it("страховка: пакет из 8+ ссылок, всё «не найдено» — сбой хранилища, возвращаем как было", async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://storage.yandexcloud.net/bmg/site/${i}.webp`);
    const out = await filterExistingVkImages(urls, async () => false);
    expect(out).toEqual(urls);
  });

  it("на полном пакете живые ссылки остаются, битые — уходят", async () => {
    const urls = Array.from({ length: 13 }, (_, i) => `https://storage.yandexcloud.net/bmg/site/x${i}.webp`);
    const out = await filterExistingVkImages(
      urls,
      async (key) => /^site\/x[0-6]\.webp$/.test(key),
    );
    expect(out).toHaveLength(7);
    expect(out[0]).toBe("https://storage.yandexcloud.net/bmg/site/x0.webp");
  });
});
