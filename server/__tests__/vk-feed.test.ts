import { describe, expect, it } from "vitest";
import { escapeXml, formatFeedPriceRub } from "@shared/feed-utils";
import {
  isVkFriendlyImage,
  storageKeyFromUrl,
  vkImagePathToSourceCandidates,
  vkJpegKeyFor,
  vkPictureUrl,
} from "../lib/vk-image";

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
