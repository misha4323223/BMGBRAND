import { describe, it, expect } from "vitest";
import {
  computePromoEligibleSubtotal,
  computePromoDiscount,
  isItemDiscounted,
  selectPromoEligibleItems,
  type PromoItem,
} from "../lib/checkout";

const item = (over: Partial<PromoItem>): PromoItem => ({ price: 100000, quantity: 1, ...over });

describe("isItemDiscounted", () => {
  it("salePrice ниже розницы = скидка", () => {
    expect(isItemDiscounted(item({ product: { price: 100000, salePrice: 90000 } }))).toBe(true);
  });

  it("discountPercent > 0 = скидка", () => {
    expect(isItemDiscounted(item({ product: { price: 100000, discountPercent: 10 } }))).toBe(true);
  });

  it("скидка по размеру считается только для конкретного размера", () => {
    expect(
      isItemDiscounted(item({ size: "M", product: { price: 100000, sizeDiscounts: { M: 20 } } })),
    ).toBe(true);
    expect(
      isItemDiscounted(item({ size: "L", product: { price: 100000, sizeDiscounts: { M: 20 } } })),
    ).toBe(false);
  });

  it("без product → не скидка", () => {
    expect(isItemDiscounted(item({ product: undefined }))).toBe(false);
  });
});

describe("computePromoEligibleSubtotal", () => {
  it("суммирует только товары без собственной скидки", () => {
    const items = [
      item({ price: 100000, quantity: 2 }), // 200000
      item({ price: 50000, quantity: 1, product: { price: 50000, salePrice: 40000 } }), // пропуск
      item({ price: 30000, quantity: 3 }), // 90000
    ];
    expect(computePromoEligibleSubtotal(items)).toBe(290000);
  });
});

describe("computePromoDiscount", () => {
  it("процент от eligible-суммы", () => {
    expect(computePromoDiscount({ discountPercent: 10 }, 290000)).toBe(29000);
  });

  it("фиксированная сумма", () => {
    expect(computePromoDiscount({ discountAmount: 15000 }, 290000)).toBe(15000);
  });

  it("скидка не может быть больше eligible-суммы", () => {
    expect(computePromoDiscount({ discountAmount: 500000 }, 290000)).toBe(290000);
  });

  it("без скидки → 0", () => {
    expect(computePromoDiscount({}, 290000)).toBe(0);
  });

  it("процент округляется до копеек", () => {
    // 9999 * 0.33 = 3299.67 → 3300
    expect(computePromoDiscount({ discountPercent: 33 }, 9999)).toBe(3300);
  });

  it("фикс-сумма не выходит за eligible, даже если заказ дороже", () => {
    // Заказ: 10 000 ₽ товаров со скидкой + 100 ₽ без скидки, промокод «−300 ₽».
    expect(computePromoDiscount({ discountAmount: 30000 }, 10000)).toBe(10000);
  });

  it("фикс-сумма целиком влезает в eligible — не урезается", () => {
    expect(computePromoDiscount({ discountAmount: 30000 }, 50000)).toBe(30000);
  });
});

describe("selectPromoEligibleItems", () => {
  it("оставляет только позиции без своей скидки", () => {
    const items = [
      item({ price: 169000, product: { price: 169000 } }),
      item({ price: 101400, product: { price: 120000, salePrice: 101400 } }),
      item({ price: 90000, product: { price: 90000, discountPercent: 10 } }),
      item({ size: "M", price: 80000, product: { price: 100000, sizeDiscounts: { M: 20 } } }),
    ];
    const eligible = selectPromoEligibleItems(items);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].price).toBe(169000);
  });

  it("возвращает позиции в исходном порядке", () => {
    const items = [
      item({ price: 100000, product: { price: 100000 } }),
      item({ price: 50000, product: { price: 60000, salePrice: 50000 } }),
      item({ price: 30000, product: { price: 30000 } }),
    ];
    expect(selectPromoEligibleItems(items).map((it) => it.price)).toEqual([100000, 30000]);
  });
});