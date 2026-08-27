import { describe, it, expect } from "vitest";
import {
  mapProductCategory,
  extractColorFromName,
  extractSizesFromName,
  getArtistSlugFromName,
  isOnSale,
  isAllowedRootGroup,
  isIgnoredRootGroup,
  getRootGroupCategorySlug,
  mapGroupHierarchyToCategory,
} from "../categoryMapper";

describe("mapProductCategory — носки", () => {
  it("SC-артикул → спортивные (по размеру из названия)", () => {
    expect(mapProductCategory("SC02", "Носки (Классика Спорт SC02) Черный 34-39")).toEqual({
      category: "socks",
      subcategory: "Спортивные (34-39)",
    });
  });

  it("N-артикул → классические 40-45", () => {
    expect(mapProductCategory("N123", "Носки Классические N123 Черный 40-45")).toEqual({
      category: "socks",
      subcategory: "Классические (40-45)",
    });
  });
});

describe("mapProductCategory — одежда/аксессуары/мерч/группы", () => {
  it("ключевое слово «худи» → clothing/Толстовки", () => {
    expect(mapProductCategory("H001", "Худи 3-х нитка с начёсом")).toEqual({
      category: "clothing",
      subcategory: "Толстовки",
    });
  });

  it("ключевое слово «шапк» → accessories/Шапки", () => {
    expect(mapProductCategory("C05", "Шапка бини C05 Черный")).toEqual({
      category: "accessories",
      subcategory: "Шапки",
    });
  });

  it("мерч-бренд «гудтаймс» имеет приоритет над одеждой", () => {
    expect(mapProductCategory("T02", "Футболка ГУДТАЙМС Logo T02 Черный")).toEqual({
      category: "merch",
      subcategory: "ГУДТАЙМС",
    });
  });

  it("группа 1С «sale» → sale", () => {
    expect(mapProductCategory("XYZ", "Что-то", "SALE")).toEqual({ category: "sale", subcategory: null });
  });

  it("группа 1С «мерч» → merch", () => {
    expect(mapProductCategory("XYZ", "Что-то", "Мерч бренда")).toEqual({ category: "merch", subcategory: null });
  });

  it("неизвестный товар → 1C Import", () => {
    expect(mapProductCategory("XYZ", "Совершенно неизвестная вещь")).toEqual({
      category: "1C Import",
      subcategory: null,
    });
  });
});

describe("extractColorFromName", () => {
  it("цвет из скобок", () => {
    expect(extractColorFromName("Футболка (Черный)")).toBe("Черный");
  });

  it("цвет по ключевому слову, нормализация окончаний", () => {
    expect(extractColorFromName("Шапка Белая")).toBe("Белый");
  });

  it("без цвета → null", () => {
    expect(extractColorFromName("Кружка без цвета")).toBeNull();
  });
});

describe("extractSizesFromName", () => {
  it("носковый размер", () => {
    expect(extractSizesFromName("Носки 40-45")).toEqual(["40-45"]);
  });

  it("одежда", () => {
    expect(extractSizesFromName("Худи XL Черный")).toEqual(["XL"]);
  });

  it("размер в скобках", () => {
    expect(extractSizesFromName("Футболка (M)")).toEqual(["M"]);
  });

  it("OneSize", () => {
    expect(extractSizesFromName("Носки OneSize")).toEqual(["OneSize"]);
  });
});

describe("getArtistSlugFromName", () => {
  it("гудтаймс", () => {
    expect(getArtistSlugFromName("Футболка ГУДТАЙМС")).toBe("gudtajms");
  });

  it("дикая мята", () => {
    expect(getArtistSlugFromName("Худи Дикая Мята")).toBe("dikaya-myata");
  });

  it("без артиста → null", () => {
    expect(getArtistSlugFromName("Обычная футболка")).toBeNull();
  });
});

describe("isOnSale", () => {
  it("по названию", () => {
    expect(isOnSale("Распродажа часов", 10000)).toBe(true);
  });

  it("по цене ниже 80% от оригинала", () => {
    expect(isOnSale("Худи", 7000, 10000)).toBe(true);
  });

  it("не распродажа при цене выше 80%", () => {
    expect(isOnSale("Худи", 9000, 10000)).toBe(false);
  });
});

describe("корневые группы 1С", () => {
  it("isAllowedRootGroup", () => {
    expect(isAllowedRootGroup("Носки мужские")).toBe(true);
    expect(isAllowedRootGroup("Одежда")).toBe(true);
    expect(isAllowedRootGroup("Ткани")).toBe(false);
  });

  it("isIgnoredRootGroup", () => {
    expect(isIgnoredRootGroup("Архив")).toBe(true);
    expect(isIgnoredRootGroup("Носки")).toBe(false);
  });

  it("getRootGroupCategorySlug", () => {
    expect(getRootGroupCategorySlug("Носки мужские")).toBe("socks");
    expect(getRootGroupCategorySlug("Ткани")).toBeNull();
  });

  it("mapGroupHierarchyToCategory", () => {
    expect(mapGroupHierarchyToCategory({ rootGroup: "Носки", subGroup: "Классика" })).toEqual({
      category: "socks",
      subcategory: null,
    });
    expect(mapGroupHierarchyToCategory({ rootGroup: "Одежда", subGroup: "Толстовки" })).toEqual({
      category: "clothing",
      subcategory: "Толстовки",
    });
    expect(mapGroupHierarchyToCategory({ rootGroup: "Ткани", subGroup: null })).toBeNull();
  });
});