import { describe, it, expect } from "vitest";
import {
  isPinnableSection,
  toPinnedIds,
  homepageSectionTitle,
  resolveHomepageSectionUpdate,
  homepageSectionResponse,
} from "../lib/homepage-sections";

const popular = { title: "Новинки", mode: "manual", pinnedProductIds: [10, 20, 30] };
const hits = { type: "custom_hits", title: "Хиты продаж", mode: "auto", pinnedProductIds: [] };
const autoPopular = { title: "Новинки", mode: "auto", pinnedProductIds: [5, 6] };

const base = { sectionId: "popular", section: popular, productId: 99, productExists: true, action: "prepend" as const };

describe("isPinnableSection", () => {
  it("разрешает popular и custom_hits", () => {
    expect(isPinnableSection("popular", popular)).toBe(true);
    expect(isPinnableSection("custom_hits_1", hits)).toBe(true);
  });

  it("запрещает остальные секции", () => {
    expect(isPinnableSection("hero", { title: "Главный слайдер" })).toBe(false);
    expect(isPinnableSection("blog", { type: "blog" })).toBe(false);
    expect(isPinnableSection("custom_text_1", { type: "custom_text" })).toBe(false);
  });
});

describe("toPinnedIds", () => {
  it("чистит строки, нули, NaN и не-массивы", () => {
    expect(toPinnedIds(["12", 34, "abc", 0, null, -5, 7.5])).toEqual([12, 34, 7.5]);
    expect(toPinnedIds(undefined)).toEqual([]);
    expect(toPinnedIds("12,34")).toEqual([]);
  });
});

describe("homepageSectionTitle", () => {
  it("берёт title из настроек, иначе фолбэк по секции", () => {
    expect(homepageSectionTitle("popular", popular)).toBe("Новинки");
    expect(homepageSectionTitle("popular", { title: "  " })).toBe("Новинки");
    expect(homepageSectionTitle("custom_hits_1", { type: "custom_hits" })).toBe("Хиты продаж");
  });
});

describe("resolveHomepageSectionUpdate — ошибки", () => {
  it("несуществующая секция → 404", () => {
    const r = resolveHomepageSectionUpdate({ ...base, section: undefined });
    expect(r).toEqual({ ok: false, status: 404, error: "Секция «popular» не найдена" });
  });

  it("непродуктовая секция → 400", () => {
    const r = resolveHomepageSectionUpdate({ sectionId: "hero", section: { title: "Слайдер" }, productId: 1, productExists: true, action: "prepend" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("несуществующий товар → 404", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productExists: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("скрытый товар → 400 только при закреплении", () => {
    const add = resolveHomepageSectionUpdate({ ...base, productIsHidden: true });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.error).toContain("скрыт");

    const remove = resolveHomepageSectionUpdate({ ...base, productId: 10, productIsHidden: true, action: "remove" });
    expect(remove.ok).toBe(true);
  });

  it("некорректный ID товара → 400", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("resolveHomepageSectionUpdate — закрепление", () => {
  it("ставит товар на первое место", () => {
    const r = resolveHomepageSectionUpdate(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([99, 10, 20, 30]);
    expect(r.meta.position).toBe(1);
    expect(r.meta.alreadyFirst).toBe(false);
    expect(r.meta.pinnedCount).toBe(4);
    expect(r.meta.modeWas).toBe("manual");
    expect(r.meta.emptied).toBe(false);
  });

  it("переставляет товар наверх без дублей", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([30, 10, 20]);
    expect(r.meta.pinnedCount).toBe(3);
  });

  it("повторное закрепление первого товара: alreadyFirst, список не меняется", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([10, 20, 30]);
    expect(r.meta.alreadyFirst).toBe(true);
  });

  it("сообщает, что секция была в режиме «Авто»", () => {
    const r = resolveHomepageSectionUpdate({ ...base, section: autoPopular, productId: 99 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.modeWas).toBe("auto");
    expect(r.next).toEqual([99, 5, 6]);
  });

  it("пустая секция: список из одного товара", () => {
    const r = resolveHomepageSectionUpdate({ ...base, section: hits, productId: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([7]);
    expect(r.meta.title).toBe("Хиты продаж");
  });
});

describe("resolveHomepageSectionUpdate — удаление", () => {
  it("убирает товар, сохраняя порядок остальных", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 20, action: "remove" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([10, 30]);
    expect(r.meta.removed).toBe(true);
    expect(r.meta.emptied).toBe(false);
  });

  it("товара нет в секции — removed: false, ничего не меняется", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 777, action: "remove" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([10, 20, 30]);
    expect(r.meta.removed).toBe(false);
  });

  it("последний товар: emptied: true", () => {
    const r = resolveHomepageSectionUpdate({ ...base, section: hits, productId: 7, action: "remove" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next).toEqual([]);
    expect(r.meta.emptied).toBe(true);
  });
});

describe("homepageSectionResponse", () => {
  it("возвращает успешный ответ для закрепления", () => {
    const r = resolveHomepageSectionUpdate(base);
    if (!r.ok) throw new Error("unexpected");
    expect(homepageSectionResponse("popular", "prepend", r.meta)).toEqual({
      success: true,
      sectionId: "popular",
      action: "prepend",
      title: "Новинки",
      pinnedCount: 4,
      position: 1,
      alreadyFirst: false,
      modeWas: "manual",
      emptied: false,
      removed: true,
    });
  });

  it("для «нечего удалять» добавляет пояснение", () => {
    const r = resolveHomepageSectionUpdate({ ...base, productId: 777, action: "remove" });
    if (!r.ok) throw new Error("unexpected");
    const body: any = homepageSectionResponse("popular", "remove", r.meta);
    expect(body.removed).toBe(false);
    expect(body.message).toBe("Товара уже нет в этой секции");
  });
});
