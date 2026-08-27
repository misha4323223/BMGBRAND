import { describe, it, expect } from "vitest";
import {
  SIZE_ORDER,
  STANDARD_CLOTHING_SIZES,
  sanitizeHtmlBlock,
  sanitizeJsonLd,
  sortSizes,
  normalizeSizeKey,
  canonicalizeSizeKey,
  resolveSizeStock,
} from "../lib/product-utils";

describe("sanitizeHtmlBlock", () => {
  it("убирает <title>", () => {
    expect(sanitizeHtmlBlock("<title>сео</title><p>текст</p>")).toBe("<p>текст</p>");
  });

  it("понижает <h1> до <h2> (в том числе с атрибутами)", () => {
    expect(sanitizeHtmlBlock('<h1 class="x">Заголовок</h1>')).toBe('<h2 class="x">Заголовок</h2>');
  });

  it("пустая строка → пустая строка", () => {
    expect(sanitizeHtmlBlock("")).toBe("");
  });
});

describe("sanitizeJsonLd", () => {
  it("валидный JSON не трогает", () => {
    expect(sanitizeJsonLd('{"a":1}')).toBe('{"a":1}');
  });

  it("экранирует перевод строки внутри строки", () => {
    expect(sanitizeJsonLd('{"t":"a\nb"}')).toBe('{"t":"a\\nb"}');
  });

  it("пустая строка → пустая", () => {
    expect(sanitizeJsonLd("")).toBe("");
  });
});

describe("sortSizes", () => {
  it("сортирует по логическому порядку размеров", () => {
    expect(sortSizes(["XL", "S", "M", "XXL"])).toEqual(["S", "M", "XL", "XXL"]);
  });

  it("неизвестные размеры идут в конец по алфавиту", () => {
    expect(sortSizes(["ZZZ", "S"])).toEqual(["S", "ZZZ"]);
  });
});

describe("normalizeSizeKey / canonicalizeSizeKey", () => {
  it("нормализует пробелы/скобки/регистр", () => {
    expect(normalizeSizeKey("(One Size)")).toBe("onesize");
    expect(normalizeSizeKey("OneSize")).toBe("onesize");
  });

  it("канонизирует все варианты one size в OneSize", () => {
    expect(canonicalizeSizeKey("One Size")).toBe("OneSize");
    expect(canonicalizeSizeKey("(OneSize)")).toBe("OneSize");
    expect(canonicalizeSizeKey("M")).toBe("M");
  });
});

describe("resolveSizeStock", () => {
  it("точное совпадение ключа", () => {
    expect(resolveSizeStock({ M: 5, L: 2 }, "M")).toBe(5);
  });

  it("находит по нормализованному ключу (legacy-варианты) и берёт максимум", () => {
    expect(resolveSizeStock({ "One Size": 3, OneSize: 7 }, "OneSize")).toBe(7);
  });

  it("нет совпадения → undefined", () => {
    expect(resolveSizeStock({ M: 5 }, "XL")).toBeUndefined();
  });
});

describe("константы", () => {
  it("SIZE_ORDER содержит стандартные размеры", () => {
    expect(SIZE_ORDER["S"]).toBe(4);
    expect(SIZE_ORDER["XXL"]).toBe(8);
  });

  it("STANDARD_CLOTHING_SIZES содержит буквенные и числовые размеры", () => {
    expect(STANDARD_CLOTHING_SIZES.has("M")).toBe(true);
    expect(STANDARD_CLOTHING_SIZES.has("50")).toBe(true);
    expect(STANDARD_CLOTHING_SIZES.has("XXX")).toBe(false);
  });
});