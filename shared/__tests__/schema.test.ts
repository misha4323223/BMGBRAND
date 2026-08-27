import { describe, it, expect } from "vitest";
import {
  transliterateToSlug,
  normalizeCategories,
  buildCategoryIndex,
  resolveProductCategoryPaths,
  CATEGORIES,
} from "../schema";

describe("transliterateToSlug", () => {
  it("транслитерирует и строит слаг", () => {
    expect(transliterateToSlug("Толстовки")).toBe("tolstovki");
  });

  it("ц → ts, схлопывает дефисы", () => {
    expect(transliterateToSlug("Цена   дня")).toBe("tsena-dnya");
  });
});

describe("normalizeCategories", () => {
  it("невалидный/пустой ввод возвращает статический фолбэк CATEGORIES", () => {
    expect(normalizeCategories(null)).toBe(CATEGORIES);
    expect(normalizeCategories(undefined)).toBe(CATEGORIES);
    expect(normalizeCategories({})).toBe(CATEGORIES);
  });

  it("строковые подкатегории конвертируются в объекты со слагом", () => {
    const result = normalizeCategories({
      clothing: { name: "Одежда", subcategories: ["Толстовки", "Футболки"] },
    });
    expect(result.clothing.subcategories).toEqual([
      { name: "Толстовки", slug: "tolstovki" },
      { name: "Футболки", slug: "futbolki" },
    ]);
  });

  it("сохраняет явные слаги", () => {
    const result = normalizeCategories({
      clothing: { name: "Одежда", slug: "clothing", subcategories: [{ name: "Толстовки", slug: "hoodies" }] },
    });
    expect(result.clothing.slug).toBe("clothing");
    expect(result.clothing.subcategories[0].slug).toBe("hoodies");
  });

  it("никогда не возвращает пустой объект", () => {
    expect(normalizeCategories({ bad: { subcategories: [] } })).toBe(CATEGORIES);
  });
});

describe("resolveProductCategoryPaths", () => {
  const index = buildCategoryIndex(CATEGORIES);

  it("резолвит полный путь товара: категория → подкатегория → под-подкатегория", () => {
    const paths = resolveProductCategoryPaths(
      { category: "Одежда", subcategory: "Толстовки", subSubcategory: "Худи с начёсом" },
      index,
    );
    expect(paths).toEqual([
      {
        categorySlug: "clothing",
        subcategorySlug: "hoodies",
        subSubcategorySlug: "xudi-s-nacyosom",
        subcategoryName: "Толстовки",
        subSubcategoryName: "Худи с начёсом",
      },
    ]);
  });

  it("резолвит категорию по слагу", () => {
    const paths = resolveProductCategoryPaths({ category: "clothing" }, index);
    expect(paths[0].categorySlug).toBe("clothing");
    expect(paths[0].subcategorySlug).toBeNull();
  });

  it("пустая категория → пустой список (не падает)", () => {
    expect(resolveProductCategoryPaths({ category: null }, index)).toEqual([]);
  });
});