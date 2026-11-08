import { describe, expect, it } from "vitest";
import {
  collectFaqCategories,
  FAQ_UNCATEGORIZED,
  groupFaqItems,
  normalizeFaqItems,
} from "../faq";

const q = (question: string, answer = "Ответ", category?: string) =>
  category ? { question, answer, category } : { question, answer };

describe("normalizeFaqItems", () => {
  it("читает объект и JSON-строку одинаково", () => {
    const data = { items: [q("Вопрос", "Ответ", "Доставка")] };
    expect(normalizeFaqItems(data)).toEqual(normalizeFaqItems(JSON.stringify(data)));
  });

  it("возвращает пустой массив для мусора", () => {
    expect(normalizeFaqItems(null)).toEqual([]);
    expect(normalizeFaqItems("not json")).toEqual([]);
    expect(normalizeFaqItems({ items: "oops" })).toEqual([]);
    expect(normalizeFaqItems({ items: [null, 42, "x"] })).toEqual([]);
  });

  it("отбрасывает вопросы без вопроса или ответа", () => {
    const items = normalizeFaqItems({
      items: [
        { question: "  ", answer: "Ответ" },
        { question: "Вопрос", answer: "   " },
        { question: "Ок", answer: "Ответ" },
      ],
    });
    expect(items).toEqual([{ question: "Ок", answer: "Ответ" }]);
  });

  it("обрезает пробелы и не сохраняет пустую категорию", () => {
    const items = normalizeFaqItems({
      items: [
        { question: " Вопрос ", answer: " Ответ ", category: "  Доставка  " },
        { question: "Второй", answer: "Ответ", category: "   " },
      ],
    });
    expect(items).toEqual([
      { question: "Вопрос", answer: "Ответ", category: "Доставка" },
      { question: "Второй", answer: "Ответ" },
    ]);
  });

  it("не ломает старый формат без категорий", () => {
    const legacy = { items: [q("Вопрос")] };
    expect(normalizeFaqItems(legacy)).toEqual([{ question: "Вопрос", answer: "Ответ" }]);
  });
});

describe("collectFaqCategories", () => {
  it("возвращает уникальные категории в порядке появления", () => {
    const items = [q("1", "Ответ", "Доставка"), q("2", "Ответ", "Ткань"), q("3", "Ответ", "Доставка")];
    expect(collectFaqCategories(items)).toEqual(["Доставка", "Ткань"]);
  });

  it("игнорирует вопросы без категории", () => {
    expect(collectFaqCategories([q("1"), q("2", "Ответ", "Оплата")])).toEqual(["Оплата"]);
  });
});

describe("groupFaqItems", () => {
  it("без категорий отдаёт один раздел без заголовка", () => {
    const items = [q("Первый"), q("Второй")];
    expect(groupFaqItems(items)).toEqual([{ title: "", anchor: "faq", items }]);
  });

  it("для пустого списка отдаёт пустой массив", () => {
    expect(groupFaqItems([])).toEqual([]);
  });

  it("группирует по категориям в порядке первого появления", () => {
    const items = [
      q("Доставка 1", "Ответ", "Доставка"),
      q("Ткань 1", "Ответ", "Ткань"),
      q("Доставка 2", "Ответ", "Доставка"),
    ];
    const groups = groupFaqItems(items);

    expect(groups.map((g) => g.title)).toEqual(["Доставка", "Ткань"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
    expect(groups[0].anchor).not.toBe(groups[1].anchor);
  });

  it("вопросы без категории уходят в «Общие вопросы» последними", () => {
    const groups = groupFaqItems([q("Без категории"), q("С категорией", "Ответ", "Оплата")]);

    expect(groups.map((g) => g.title)).toEqual(["Оплата", FAQ_UNCATEGORIZED]);
    expect(groups[1].items[0].question).toBe("Без категории");
  });

  it("не теряет вопросы и сохраняет порядок внутри раздела", () => {
    const items = [
      q("A", "Ответ", "Разное"),
      q("B"),
      q("C", "Ответ", "Разное"),
      q("D"),
    ];
    const groups = groupFaqItems(items);

    expect(groups.flatMap((g) => g.items)).toHaveLength(items.length);
    expect(groups[0].items.map((i) => i.question)).toEqual(["A", "C"]);
    expect(groups[1].items.map((i) => i.question)).toEqual(["B", "D"]);
  });
});
