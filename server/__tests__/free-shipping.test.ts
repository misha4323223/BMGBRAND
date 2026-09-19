import { describe, it, expect } from "vitest";
import {
  DEFAULT_FREE_COURIER_THRESHOLD,
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  getFreeShippingThreshold,
  qualifiesForFreeShipping,
  resolveFreeShippingThresholds,
  resolveThreshold,
} from "@shared/free-shipping";

describe("resolveThreshold", () => {
  it("число >= 0 принимаем как есть", () => {
    expect(resolveThreshold(1500000, DEFAULT_FREE_SHIPPING_THRESHOLD)).toBe(1500000);
    expect(resolveThreshold(0, DEFAULT_FREE_SHIPPING_THRESHOLD)).toBe(0);
  });

  it("строку с числом приводим к числу (значение из JSON/админки)", () => {
    expect(resolveThreshold("1500000", DEFAULT_FREE_SHIPPING_THRESHOLD)).toBe(1500000);
  });

  it("мусор, отрицательные, NaN, Infinity, undefined → фолбэк", () => {
    for (const bad of [undefined, null, "", "abc", -1, NaN, Infinity, -Infinity, {}, []]) {
      expect(resolveThreshold(bad, DEFAULT_FREE_COURIER_THRESHOLD)).toBe(DEFAULT_FREE_COURIER_THRESHOLD);
    }
  });
});

describe("resolveFreeShippingThresholds", () => {
  it("без настроек → 5 000 ₽ ПВЗ и 15 000 ₽ курьер", () => {
    for (const empty of [undefined, null, {}, "строка"]) {
      expect(resolveFreeShippingThresholds(empty)).toEqual({
        pickup: 500000,
        courier: 1500000,
      });
    }
  });

  it("значения из админки перекрывают фолбэки", () => {
    expect(
      resolveFreeShippingThresholds({ freeDeliveryThreshold: 700000, freeCourierDeliveryThreshold: 2000000 }),
    ).toEqual({ pickup: 700000, courier: 2000000 });
  });

  it("битый курьерский порог не ломает ПВЗ-порог", () => {
    expect(resolveFreeShippingThresholds({ freeDeliveryThreshold: 600000, freeCourierDeliveryThreshold: "x" })).toEqual({
      pickup: 600000,
      courier: 1500000,
    });
  });

  it("старые настройки без курьерского порога дают 15 000 ₽", () => {
    expect(resolveFreeShippingThresholds({ freeDeliveryThreshold: 500000 })).toEqual({
      pickup: 500000,
      courier: 1500000,
    });
  });
});

describe("getFreeShippingThreshold", () => {
  it("ПВЗ/Ozon/самовывоз — порог ПВЗ, курьер — курьерский", () => {
    const t = { pickup: 500000, courier: 1500000 };
    expect(getFreeShippingThreshold(t, false)).toBe(500000);
    expect(getFreeShippingThreshold(t, true)).toBe(1500000);
    expect(getFreeShippingThreshold(t)).toBe(500000);
  });
});

describe("qualifiesForFreeShipping", () => {
  const thresholds = { pickup: 500000, courier: 1500000 };

  it("ПВЗ бесплатно от 5 000 ₽ (строго по порогу)", () => {
    expect(qualifiesForFreeShipping({ subtotal: 499999, thresholds })).toBe(false);
    expect(qualifiesForFreeShipping({ subtotal: 500000, thresholds })).toBe(true);
    expect(qualifiesForFreeShipping({ subtotal: 1600000, thresholds })).toBe(true);
  });

  it("курьер бесплатно только от 15 000 ₽", () => {
    expect(qualifiesForFreeShipping({ subtotal: 600000, thresholds, isCourierDelivery: true })).toBe(false);
    expect(qualifiesForFreeShipping({ subtotal: 1499999, thresholds, isCourierDelivery: true })).toBe(false);
    expect(qualifiesForFreeShipping({ subtotal: 1500000, thresholds, isCourierDelivery: true })).toBe(true);
  });

  it("Ozon/самовывоз (не курьер) остаются на пороге 5 000 ₽", () => {
    expect(qualifiesForFreeShipping({ subtotal: 500000, thresholds, isCourierDelivery: false })).toBe(true);
  });

  it("оптовые заказы не получают бесплатную доставку ни при какой сумме", () => {
    expect(qualifiesForFreeShipping({ subtotal: 100000000, thresholds, isWholesale: true })).toBe(false);
    expect(qualifiesForFreeShipping({ subtotal: 100000000, thresholds, isWholesale: true, isCourierDelivery: true })).toBe(false);
  });
});
