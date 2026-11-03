import { describe, it, expect } from "vitest";
import {
  buildOzonOrderIdempotencyKey,
  buildPaidOzonOrderRequest,
} from "../ozon-delivery-api/paid-order";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function order(overrides: Record<string, any> = {}) {
  return {
    id: 12345,
    customerPhone: "+7 (900) 123-45-67",
    customerName: "Иванов Иван Иванович",
    cdekData: {
      ozonPvzId: "9000000000000001",
      ozonShipmentMethodId: "9000000000000002",
    },
    items: [
      { productId: 1, productName: "Худи", quantity: 2, price: 250000 },
      { productId: 2, productName: "Носки", quantity: 1, price: 50000 },
    ],
    addonData: "{}",
    ...overrides,
  };
}

describe("buildOzonOrderIdempotencyKey", () => {
  it("детерминирован для одного заказа и является UUID v4", () => {
    const first = buildOzonOrderIdempotencyKey(12345);
    const second = buildOzonOrderIdempotencyKey("12345");

    expect(first).toBe(second);
    expect(first).toMatch(UUID_RE);
    expect(buildOzonOrderIdempotencyKey(12346)).not.toBe(first);
  });
});

describe("buildPaidOzonOrderRequest", () => {
  it("считает количество и объявленную стоимость по позициям", () => {
    const result = buildPaidOzonOrderRequest(order());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toMatchObject({
      deliveryPointId: "9000000000000001",
      shipmentMethodId: "9000000000000002",
      phoneNumber: "+7 (900) 123-45-67",
      declaredValueKopeks: 550000,
      itemCount: 3,
      orderExternalId: "12345",
      idempotencyKey: result.idempotencyKey,
    });
    expect(result.request.description).toContain("Худи");
    expect(result.request.description).toContain("Носки");
    expect(result.request.fullName).toBe("Иванов Иван Иванович");
  });

  it("не отправляет заказ без ПВЗ", () => {
    const result = buildPaidOzonOrderRequest(
      order({ cdekData: { ozonShipmentMethodId: "9000000000000002" } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ПВЗ");
  });

  it("не отправляет заказ дороже 500 000 ₽", () => {
    const result = buildPaidOzonOrderRequest(
      order({
        items: [{ productId: 1, productName: "Дорого", quantity: 1, price: 50_000_001 }],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("500 000");
  });

  it("не отправляет пустой заказ", () => {
    const result = buildPaidOzonOrderRequest(order({ items: [] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("нет товаров");
  });
});
