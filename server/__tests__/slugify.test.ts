import { describe, it, expect } from "vitest";
import { generateSlug, generateUniqueSlug, normalizeProductName } from "../slugify";

describe("generateSlug", () => {
  it("транслитерирует кириллицу и строит дефисный слаг", () => {
    expect(generateSlug("Футболка 3-х нитка Сирень")).toBe("futbolka-3-h-nitka-siren");
  });

  it("убирает скобки и спецсимволы", () => {
    expect(
      generateSlug("Носки BMGBRAND (Классика Спорт SC02) Черный 34-39"),
    ).toBe("noski-bmgbrand-klassika-sport-sc02-chernyj-34-39");
  });

  it("схлопывает повторяющиеся дефисы; ё → yo", () => {
    expect(generateSlug("Худи   без   начёса")).toBe("hudi-bez-nachyosa");
  });
});

describe("generateUniqueSlug", () => {
  it("возвращает базовый слаг, если он свободен", () => {
    expect(generateUniqueSlug("Худи", ["futbolki", "noski"])).toBe("hudi");
  });

  it("добавляет -2 при занятом слаге", () => {
    expect(generateUniqueSlug("Худи", ["hudi"])).toBe("hudi-2");
  });

  it("инкрементирует номер до свободного", () => {
    expect(generateUniqueSlug("Худи", ["hudi", "hudi-2", "hudi-3"])).toBe("hudi-4");
  });
});

describe("normalizeProductName", () => {
  it("приводит к нижнему регистру и убирает не-буквенно-цифровые символы", () => {
    expect(
      normalizeProductName("Носки (Классика Спорт SC02) Черный 34-39"),
    ).toBe("носкиклассикаспортsc02черный3439");
  });

  it("игнорирует брендовый шум — разные написания дают один ключ (дедуп дублей)", () => {
    expect(
      normalizeProductName("Носки BMGBRAND (Классика Спорт SC02) Черный 34-39"),
    ).toBe(normalizeProductName("Носки (Классика Спорт SC02) Черный 34-39"));
  });

  it("пустой ввод не падает", () => {
    expect(normalizeProductName("")).toBe("");
    expect(normalizeProductName(undefined as any)).toBe("");
  });
});