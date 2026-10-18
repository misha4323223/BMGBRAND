import { describe, it, expect } from "vitest";
import { resolveSubcategorySeoKey } from "../seo-overrides";

const overrides = new Set([
  "subcategory:clothing:sweaters",
  "subcategory:clothing:t-shirts",
  "subcategory:merch:gudtajms",
]);
const hasOverride = (key: string) => overrides.has(key);

describe("resolveSubcategorySeoKey", () => {
  it("находит ключ по публичному слагу, когда в URL YDB-слаг отсутствует", () => {
    // /sweaters: pathSubSlug пуст, forcedUrlSlug = "sweaters", YDB-слаг = "svitera".
    expect(resolveSubcategorySeoKey("clothing", ["svitera", "sweaters"], hasOverride))
      .toBe("subcategory:clothing:sweaters");
  });

  it("работает для обычных /products/:cat/:sub страниц", () => {
    expect(resolveSubcategorySeoKey("merch", ["gudtajms"], hasOverride))
      .toBe("subcategory:merch:gudtajms");
  });

  it("возвращает null, если переопределения нет ни для одного кандидата", () => {
    expect(resolveSubcategorySeoKey("clothing", ["svitera", "jackets"], hasOverride)).toBeNull();
  });

  it("пропускает пустые и null-кандидаты", () => {
    expect(resolveSubcategorySeoKey("clothing", [null, undefined, "", "t-shirts"], hasOverride))
      .toBe("subcategory:clothing:t-shirts");
  });

  it("не подставляет YDB-слаг, если сохранён только он — ключ должен существовать", () => {
    const onlyYdb = (key: string) => key === "subcategory:clothing:svitera";
    expect(resolveSubcategorySeoKey("clothing", ["svitera", "sweaters"], onlyYdb))
      .toBe("subcategory:clothing:svitera");
  });
});
