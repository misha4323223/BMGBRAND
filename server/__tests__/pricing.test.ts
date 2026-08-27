import { describe, it, expect } from "vitest";
import { resolveItemPrice, type PriceableProduct } from "../lib/pricing";

// Все суммы в копейках.
const base = (over: Partial<PriceableProduct> = {}): PriceableProduct => ({
  price: 100000, // 1000 ₽
  ...over,
});

describe("resolveItemPrice — розница", () => {
  it("возвращает базовую цену без скидок", () => {
    expect(resolveItemPrice(base())).toEqual({ price: 100000, wholesaleDiscountPerUnit: 0 });
  });

  it("применяет salePrice, если она ниже базовой", () => {
    expect(resolveItemPrice(base({ salePrice: 80000 }))).toEqual({
      price: 80000,
      wholesaleDiscountPerUnit: 0,
    });
  });

  it("игнорирует salePrice, если она НЕ ниже базовой (не может удорожать)", () => {
    expect(resolveItemPrice(base({ salePrice: 120000 })).price).toBe(100000);
  });

  it("применяет discountPercent", () => {
    expect(resolveItemPrice(base({ discountPercent: 15 })).price).toBe(85000);
  });

  it("применяет скидку по размеру и отдаёт ей приоритет над discountPercent", () => {
    expect(
      resolveItemPrice(base({ discountPercent: 10, sizeDiscounts: { M: 20 } }), { size: "M" }).price,
    ).toBe(80000);
  });

  it("скидка по размеру не применяется к другому размеру", () => {
    expect(
      resolveItemPrice(base({ discountPercent: 10, sizeDiscounts: { M: 20 } }), { size: "L" }).price,
    ).toBe(90000);
  });

  it("округляет копейки", () => {
    // 9999 * (1 - 0.33) = 6699.33 → 6699
    expect(resolveItemPrice({ price: 9999, discountPercent: 33 }).price).toBe(6699);
  });
});

describe("resolveItemPrice — опт", () => {
  it("использует wholesalePrice; без доп. скидок discountPerUnit = 0", () => {
    expect(
      resolveItemPrice(base({ wholesalePrice: 70000 }), { isWholesale: true }),
    ).toEqual({ price: 70000, wholesaleDiscountPerUnit: 0 });
  });

  it("применяет оптовый discountPercent товара, затем персональную скидку пользователя", () => {
    const r = resolveItemPrice(
      base({ wholesalePrice: 70000, wholesaleDiscountPercent: 10 }),
      { isWholesale: true, userWholesaleDiscount: 5 },
    );
    // 70000 → -10% = 63000 → -5% = 59850
    expect(r.price).toBe(59850);
    expect(r.wholesaleDiscountPerUnit).toBe(70000 - 59850);
  });

  it("отрицательный персональный процент = наценка", () => {
    const r = resolveItemPrice(base({ wholesalePrice: 70000 }), {
      isWholesale: true,
      userWholesaleDiscount: -5,
    });
    expect(r.price).toBe(73500);
    expect(r.wholesaleDiscountPerUnit).toBe(70000 - 73500);
  });

  it("fallback: без оптовой цены применяет персональную скидку к рознице", () => {
    expect(
      resolveItemPrice(base({ wholesalePrice: null }), { isWholesale: true, userWholesaleDiscount: 10 }),
    ).toEqual({ price: 90000, wholesaleDiscountPerUnit: 10000 });
  });

  it("fallback: без оптовой цены и без персональной скидки — розничная цена", () => {
    expect(resolveItemPrice(base({ wholesalePrice: null }), { isWholesale: true })).toEqual({
      price: 100000,
      wholesaleDiscountPerUnit: 0,
    });
  });
});