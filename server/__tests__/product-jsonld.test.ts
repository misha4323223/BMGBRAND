import { describe, it, expect } from "vitest";
import {
  buildProductJsonLd,
  resolveAvailability,
  resolveRetailPriceKopeks,
  serializeJsonLd,
  serializeProductJsonLd,
  stripHtmlText,
  type ProductJsonLdInput,
} from "@shared/product-jsonld";

/** Минимальный набор обязательных данных (как у реальной карточки). */
function baseInput(overrides: Partial<ProductJsonLdInput> = {}): ProductJsonLdInput {
  return {
    id: 1789402583099,
    name: "Худи BLOCK унисекс свободного кроя, чёрный/коричневый",
    description: "Худи унисекс свободного кроя",
    images: ["https://storage.yandexcloud.net/bmg/products/block.webp"],
    siteUrl: "https://booomerangs.ru",
    url: "https://booomerangs.ru/hudi-block-chyornyj-korichnevyj",
    sku: null,
    modelSku: "BLOCK01",
    color: "Черный",
    price: 649000,
    stock: 8,
    ...overrides,
  };
}

describe("stripHtmlText", () => {
  it("удаляет теги, скрипты и нормализует пробелы", () => {
    expect(stripHtmlText("<p>Худи&nbsp; BLOCK</p><script>alert(1)</script>")).toBe("Худи BLOCK");
    expect(stripHtmlText("  a\n\n  b  ")).toBe("a b");
  });
});

describe("resolveRetailPriceKopeks", () => {
  it("фиксированная цена со скидкой имеет приоритет", () => {
    expect(resolveRetailPriceKopeks({ price: 459000, salePrice: 399000 })).toBe(399000);
  });

  it("иначе применяется общая скидка", () => {
    expect(resolveRetailPriceKopeks({ price: 459000, discountPercent: 10 })).toBe(413100);
  });

  it("скидка выбранного размера важнее общей", () => {
    expect(
      resolveRetailPriceKopeks({ price: 459000, discountPercent: 10, sizeDiscounts: { XL: 30 }, size: "XL" }),
    ).toBe(321300);
  });

  it("скидка по размеру не применяется, если размер не выбран", () => {
    expect(resolveRetailPriceKopeks({ price: 459000, discountPercent: 10, sizeDiscounts: { XL: 30 } })).toBe(413100);
  });

  it("обычная цена, если скидок нет", () => {
    expect(resolveRetailPriceKopeks({ price: 649000 })).toBe(649000);
    expect(resolveRetailPriceKopeks({ price: 649000, salePrice: 0 })).toBe(649000);
  });
});

describe("resolveAvailability", () => {
  it("предзаказ важнее остатка", () => {
    expect(resolveAvailability({ preorder: true, stock: 10, stockBySize: { M: 5 } })).toBe(
      "https://schema.org/PreOrder",
    );
  });

  it("сумма остатков вариантов вместо общего stock", () => {
    expect(resolveAvailability({ stock: 8, stockBySize: { S: 2, M: 2, L: 2, XL: 2 } })).toBe(
      "https://schema.org/InStock",
    );
    expect(resolveAvailability({ stock: 8, stockBySize: { S: 0, M: 0, L: 0, XL: 0 } })).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("без складских вариантов — по общему остатку", () => {
    expect(resolveAvailability({ stock: 0 })).toBe("https://schema.org/OutOfStock");
    expect(resolveAvailability({ stock: 3 })).toBe("https://schema.org/InStock");
  });
});

describe("buildProductJsonLd — структура", () => {
  it("ровно один Product: никаких ProductGroup / hasVariant / isVariantOf", () => {
    const schema = buildProductJsonLd(baseInput())!;
    expect(schema["@type"]).toBe("Product");
    expect(schema).not.toHaveProperty("isVariantOf");
    expect(schema).not.toHaveProperty("hasVariant");
  });

  it("brand всегда BOOOMERANGS, url только в offers", () => {
    const schema = buildProductJsonLd(baseInput())!;
    expect(schema.brand).toEqual({ "@type": "Brand", name: "BOOOMERANGS" });
    expect(schema).not.toHaveProperty("url");
    expect(schema.offers.url).toBe("https://booomerangs.ru/hudi-block-chyornyj-korichnevyj");
  });

  it("уникальный sku из артикула модели и ID + inProductGroupWithID", () => {
    const schema = buildProductJsonLd(baseInput())!;
    expect(schema.sku).toBe("BLOCK01-1789402583099");
    expect(schema.inProductGroupWithID).toBe("BLOCK01");
  });

  it("артикул карточки (article) имеет приоритет над сгенерированным sku", () => {
    const schema = buildProductJsonLd(baseInput({ sku: "BLOCK01-BLACK" }))!;
    expect(schema.sku).toBe("BLOCK01-BLACK");
    expect(schema.inProductGroupWithID).toBe("BLOCK01");
  });

  it("без артикула модели inProductGroupWithID не выводится", () => {
    const schema = buildProductJsonLd(baseInput({ modelSku: null }))!;
    expect(schema.sku).toBe("1789402583099");
    expect(schema).not.toHaveProperty("inProductGroupWithID");
  });

  it("SEO название и описание имеют приоритет, служебный хвост убирается", () => {
    const schema = buildProductJsonLd(
      baseInput({
        seoName: "Сумка-бочка хаки Oxford 600D 45×25×25 см - купить",
        seoDescription: "Купить сумку-бочку из Oxford 600D",
      }),
    )!;
    expect(schema.name).toBe("Сумка-бочка хаки Oxford 600D 45×25×25 см");
    expect(schema.description).toBe("Купить сумку-бочку из Oxford 600D");
  });

  it("image — абсолютные HTTPS-ссылки без дублей, главное фото первым", () => {
    const schema = buildProductJsonLd(
      baseInput({
        images: [
          "/uploads/main.webp",
          "https://cdn.example.com/extra.jpg",
          "/uploads/main.webp",
          "http://insecure.example.com/x.jpg",
        ],
      }),
    )!;
    expect(schema.image).toEqual([
      "https://booomerangs.ru/uploads/main.webp",
      "https://cdn.example.com/extra.jpg",
    ]);
  });

  it("цена выводится числом в рублях, без оптовой цены и priceValidUntil", () => {
    const schema = buildProductJsonLd(baseInput({ price: 459000, salePrice: 399000 }))!;
    expect(schema.offers.price).toBe(3990);
    expect(typeof schema.offers.price).toBe("number");
    expect(schema.offers).not.toHaveProperty("priceValidUntil");
    expect(schema.offers).not.toHaveProperty("seller");
    expect(schema.offers).not.toHaveProperty("hasMerchantReturnPolicy");
    expect(schema.offers).not.toHaveProperty("shippingDetails");
  });

  it("категория — путь через « > »", () => {
    const schema = buildProductJsonLd(baseInput({ category: ["Одежда", "Толстовки", "Худи с начёсом"] }))!;
    expect(schema.category).toBe("Одежда > Толстовки > Худи с начёсом");
  });

  it("характеристики из specsHtml: состав, уход, размеры", () => {
    const schema = buildProductJsonLd(
      baseInput({
        sizes: ["S", "M", "L", "XL"],
        specsHtml:
          "<ul><li><b>Состав:</b> 80% хлопок, 20% полиэстер</li><li><b>Пол:</b> унисекс</li></ul>",
        composition: "80% хлопок, 20% полиэстер",
        careInstructions: "Стирка при 30°C",
      }),
    )!;
    const props = schema.additionalProperty as Array<{ name: string; value: string }>;
    expect(props).toContainEqual({ "@type": "PropertyValue", name: "Размер", value: "S, M, L, XL" });
    expect(props).toContainEqual({ "@type": "PropertyValue", name: "Состав", value: "80% хлопок, 20% полиэстер" });
    expect(props).toContainEqual({ "@type": "PropertyValue", name: "Уход", value: "Стирка при 30°C" });
    // Состав из specsHtml не дублируется полем composition
    expect(props.filter((p) => p.name === "Состав")).toHaveLength(1);
    // material берётся из подтверждённого состава
    expect(schema.material).toBe("80% хлопок, 20% полиэстер");
  });

  it("пустые необязательные свойства не выводятся", () => {
    const schema = buildProductJsonLd(baseInput({ color: "", modelSku: null, category: null }))!;
    expect(schema).not.toHaveProperty("color");
    expect(schema).not.toHaveProperty("category");
    expect(schema).not.toHaveProperty("additionalProperty");
    expect(schema).not.toHaveProperty("review");
  });

  it("без обязательных полей возвращает null и зовёт onError", () => {
    const errors: string[] = [];
    expect(buildProductJsonLd(baseInput({ name: "", images: [] }), { onError: (m) => errors.push(m) })).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("name");
  });

  it("оптовый покупатель не влияет на цену — берётся розничная", () => {
    const schema = buildProductJsonLd(baseInput({ price: 1000000, salePrice: 500000 }))!;
    expect(schema.offers.price).toBe(5000);
  });
});

describe("serializeProductJsonLd", () => {
  it("экранирует <, > и & внутри JSON", () => {
    const json = serializeProductJsonLd(baseInput({ name: "Футболка A & B" }))!;
    expect(json).toContain("\\u0026");

    const direct = serializeJsonLd({ malicious: "<script>alert(1)</script> & more" });
    expect(direct).not.toContain("<script>");
    expect(direct).toContain("\\u003c");
    expect(direct).toContain("\\u003e");
    expect(direct).toContain("\\u0026");
  });

  it("serializeJsonLd экранирует U+2028/U+2029", () => {
    const json = serializeJsonLd({ text: "a\u2028b\u2029c" });
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
  });

  it("валидный JSON без комментариев и лишних запятых", () => {
    const json = serializeProductJsonLd(baseInput())!;
    const parsed = JSON.parse(json);
    expect(parsed["@type"]).toBe("Product");
  });
});
