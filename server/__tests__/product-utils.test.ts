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
  keepExistingSizeCharacteristicIds,
  resolveSizeCharacteristicId,
  isOneCCharacteristicGuid,
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

describe("keepExistingSizeCharacteristicIds (GUID характеристик из 1С)", () => {
  it("сохраняет GUID из 1С для оставшихся размеров", () => {
    const existing = { S: "guid-s", M: "guid-m", XL: "guid-xl" };
    expect(keepExistingSizeCharacteristicIds(existing, ["S", "M", "L"])).toEqual({ S: "guid-s", M: "guid-m" });
  });

  it("НЕ выдумывает GUID для нового размера", () => {
    const out = keepExistingSizeCharacteristicIds({ S: "guid-s" }, ["S", "XXL"]);
    expect(out).toEqual({ S: "guid-s" });
    expect(out.XXL).toBeUndefined();
  });

  it("не теряет GUID при расхождении ключа (40-45 против (40-45))", () => {
    expect(keepExistingSizeCharacteristicIds({ "(40-45)": "guid-40-45" }, ["40-45"]))
      .toEqual({ "(40-45)": "guid-40-45" });
  });

  it("пустой список размеров → ничего не теряем", () => {
    expect(keepExistingSizeCharacteristicIds({ S: "guid-s" }, [])).toEqual({ S: "guid-s" });
  });

  it("нет данных / мусор → пустая карта", () => {
    expect(keepExistingSizeCharacteristicIds(undefined, ["M"])).toEqual({});
    expect(keepExistingSizeCharacteristicIds({ M: "" }, ["M"])).toEqual({});
    expect(keepExistingSizeCharacteristicIds({ M: 123 }, ["M"])).toEqual({});
  });

  it("исходная карта не мутируется", () => {
    const existing = { M: "guid-m", XL: "guid-xl" };
    keepExistingSizeCharacteristicIds(existing, ["M"]);
    expect(existing).toEqual({ M: "guid-m", XL: "guid-xl" });
  });
});

describe("resolveSizeCharacteristicId (размер заказа → GUID характеристики 1С)", () => {
  it("находит GUID по точному ключу", () => {
    expect(resolveSizeCharacteristicId({ L: "guid-l", XL: "guid-xl" }, "XL")).toBe("guid-xl");
  });

  it("находит GUID при расхождении ключа: (40-45) в заказе, 40-45 в карте", () => {
    expect(resolveSizeCharacteristicId({ "40-45": "guid-40-45" }, "(40-45)")).toBe("guid-40-45");
    expect(resolveSizeCharacteristicId({ "(40-45)": "guid-40-45" }, "40-45")).toBe("guid-40-45");
  });

  it("находит GUID для one size в любом написании", () => {
    const ids = { OneSize: "guid-one" };
    expect(resolveSizeCharacteristicId(ids, "One Size")).toBe("guid-one");
    expect(resolveSizeCharacteristicId(ids, "onesize")).toBe("guid-one");
    expect(resolveSizeCharacteristicId(ids, "(OneSize)")).toBe("guid-one");
  });

  it("размер в другом регистре или с пробелами", () => {
    expect(resolveSizeCharacteristicId({ xl: "guid-xl" }, " XL ")).toBe("guid-xl");
  });

  it("нет пары → undefined (GUID не выдумываем)", () => {
    expect(resolveSizeCharacteristicId({ S: "guid-s" }, "XXL")).toBeUndefined();
    expect(resolveSizeCharacteristicId({}, "M")).toBeUndefined();
    expect(resolveSizeCharacteristicId(null, "M")).toBeUndefined();
    expect(resolveSizeCharacteristicId({ M: "guid-m" }, undefined)).toBeUndefined();
    expect(resolveSizeCharacteristicId({ M: "" }, "M")).toBeUndefined();
    expect(resolveSizeCharacteristicId({ M: 123 }, "M")).toBeUndefined();
  });

  it("при выборе между сайтовым и 1С-овским GUID побеждает 1С-овский", () => {
    const siteGuid = "056bbb92-d741-4192-8bed-bd0a6d1070ec"; // v4 — выдуман сайтом
    const oneCGuid = "cd89fe24-a90d-11f0-9b2a-00155d46f61a"; // v1 — из 1С
    // точный ключ ведёт на сайтовый, но 1С-овский должен победить
    expect(resolveSizeCharacteristicId({ "(OneSize)": siteGuid, OneSize: oneCGuid }, "(OneSize)")).toBe(oneCGuid);
    expect(resolveSizeCharacteristicId({ "(OneSize)": siteGuid, OneSize: oneCGuid }, "OneSize")).toBe(oneCGuid);
  });
});

describe("isOneCCharacteristicGuid (GUID выдала 1С, а не сайт)", () => {
  it("GUID версии 1 из 1С → true", () => {
    expect(isOneCCharacteristicGuid("cd89fe24-a90d-11f0-9b2a-00155d46f61a")).toBe(true);
    expect(isOneCCharacteristicGuid("b070bf56-a2b0-11eb-9e6e-00155d467600")).toBe(true);
    expect(isOneCCharacteristicGuid("  CD89FE24-A90D-11F0-9B2A-00155D46F61A  ")).toBe(true);
  });

  it("UUID версии 4 (придуман сайтом) → false", () => {
    expect(isOneCCharacteristicGuid("056bbb92-d741-4192-8bed-bd0a6d1070ec")).toBe(false);
    expect(isOneCCharacteristicGuid("4e7dbdf7-45fd-470f-8819-77c0aa7259c8")).toBe(false);
  });

  it("пусто, мусор и не-строки → false", () => {
    expect(isOneCCharacteristicGuid(null)).toBe(false);
    expect(isOneCCharacteristicGuid(undefined)).toBe(false);
    expect(isOneCCharacteristicGuid("")).toBe(false);
    expect(isOneCCharacteristicGuid("guid-l")).toBe(false);
    expect(isOneCCharacteristicGuid("not-a-guid-at-all-here-000000000000")).toBe(false);
    expect(isOneCCharacteristicGuid(123)).toBe(false);
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