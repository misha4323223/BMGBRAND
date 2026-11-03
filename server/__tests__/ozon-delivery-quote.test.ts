import { describe, it, expect } from "vitest";
import {
  OZON_DELIVERY_ORDER_CHECKOUT_PATH,
  OzonDeliveryQuoteService,
  buildOzonQuoteDimensions,
  normalizeOzonPhone,
  parseOzonOrderCheckoutResponse,
} from "../ozon-delivery-api/quote";
import type { OzonQuotePoint } from "../ozon-delivery-api/points-store";

const NOW = 1_700_000_000_000;

function quotePoint(
  overrides: Partial<OzonQuotePoint> = {},
): OzonQuotePoint {
  return {
    id: "9000000000000001",
    name: "ПВЗ Москва",
    address: "г. Москва, ул. Тестовая, 1",
    city: "Москва",
    lat: 55.75,
    lng: 37.62,
    shipmentMethodIds: ["9000000000000002"],
    detailsOk: true,
    isActive: true,
    ...overrides,
  };
}

function makeService(options: {
  point?: OzonQuotePoint | null;
  pointError?: Error;
  response?: any;
}) {
  const calls: Array<{ path: string; body: any }> = [];
  const client = {
    async request(path: string, body: any) {
      calls.push({ path, body });
      return (
        options.response ?? {
          ok: true,
          status: 200,
          traceId: "trace-quote",
          data: {
            results: [
              {
                request_id: 1,
                posting: {
                  estimated_delivery_cost: {
                    amount: "1250.50",
                    currency_code: "RUB",
                  },
                  estimated_insurance_cost: {
                    amount: "99.00",
                    currency_code: "RUB",
                  },
                  estimated_delivery_days: 2,
                  cutoff_at: "2026-11-01T12:00:00Z",
                },
              },
            ],
          },
        }
      );
    },
  };
  const points = {
    async getPointForQuote() {
      if (options.pointError) throw options.pointError;
      return options.point === undefined ? quotePoint() : options.point;
    },
  };
  const service = new OzonDeliveryQuoteService({
    client: client as any,
    points: points as any,
    now: () => NOW,
  });
  return { service, calls };
}

describe("normalizeOzonPhone", () => {
  it("приводит российские номера к +7XXXXXXXXXX", () => {
    expect(normalizeOzonPhone("+7 (900) 123-45-67")).toBe("+79001234567");
    expect(normalizeOzonPhone("8 900 123 45 67")).toBe("+79001234567");
    expect(normalizeOzonPhone("9001234567")).toBe("+79001234567");
  });

  it("отклоняет короткие и мусорные номера", () => {
    expect(normalizeOzonPhone("123")).toBeNull();
    expect(normalizeOzonPhone("")).toBeNull();
  });
});

describe("buildOzonQuoteDimensions", () => {
  it("считает вес по количеству товаров и не уходит ниже 500 г", () => {
    expect(buildOzonQuoteDimensions(1).weightGrams).toBe(500);
    expect(buildOzonQuoteDimensions(3).weightGrams).toBe(1500);
  });

  it("позволяет переопределить габариты", () => {
    expect(
      buildOzonQuoteDimensions(2, {
        weightGrams: 1500,
        lengthMm: 400,
        widthMm: 300,
        heightMm: 200,
      }),
    ).toEqual({
      weightGrams: 1500,
      lengthMm: 400,
      widthMm: 300,
      heightMm: 200,
    });
  });
});

describe("parseOzonOrderCheckoutResponse", () => {
  it("складывает доставку и страховку без потерь на копейках", () => {
    const parsed = parseOzonOrderCheckoutResponse({
      results: [
        {
          request_id: 1,
          posting: {
            estimated_delivery_cost: {
              amount: "1250.50",
              currency_code: "RUB",
            },
            estimated_insurance_cost: {
              amount: "99.00",
              currency_code: "RUB",
            },
            estimated_delivery_days: 2,
            cutoff_at: "2026-11-01T12:00:00Z",
          },
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.deliveryCostKopeks).toBe(125050);
    expect(parsed.value.insuranceCostKopeks).toBe(9900);
    expect(parsed.value.estimatedDeliveryDays).toBe(2);
    expect(parsed.value.cutoffAt).toBe("2026-11-01T12:00:00Z");
    expect(parsed.value.requestIds).toEqual(["1"]);
  });

  it("возвращает ошибку из result.error", () => {
    const parsed = parseOzonOrderCheckoutResponse({
      results: [
        {
          request_id: 1,
          error: { code: "DeliveryPointNotFound", message: "ПВЗ не найден" },
        },
      ],
    });

    expect(parsed).toEqual({ ok: false, error: "ПВЗ не найден" });
  });

  it("не принимает пустой ответ", () => {
    expect(parseOzonOrderCheckoutResponse({})).toEqual({
      ok: false,
      error: "Ozon не вернул результаты расчёта",
    });
  });
});

describe("OzonDeliveryQuoteService", () => {
  it("собирает checkout-запрос по официальной схеме и возвращает quote", async () => {
    const { service, calls } = makeService({});

    const result = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "+7 (900) 123-45-67",
      declaredValueKopeks: 350000,
      itemCount: 3,
    });

    expect(result.success).toBe(true);
    expect(result.quote).toMatchObject({
      deliveryPointId: "9000000000000001",
      shipmentMethodId: "9000000000000002",
      deliveryCostKopeks: 125050,
      insuranceCostKopeks: 9900,
      costKopeks: 134950,
      estimatedDeliveryDays: 2,
      traceId: "trace-quote",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(OZON_DELIVERY_ORDER_CHECKOUT_PATH);
    expect(calls[0].body).toMatchObject({
      recipient: { phone_number: "+79001234567" },
      postings: [
        {
          request_id: 1,
          shipment_method_id: 9000000000000002,
          declared_value: { amount: "3500.00", currency_code: "RUB" },
          dimensions: {
            weight_g: 1500,
            length_mm: 300,
            width_mm: 250,
            height_mm: 50,
          },
        },
      ],
      delivery: {
        delivery_point: { delivery_point_id: 9000000000000001 },
      },
    });
    expect(calls[0].body.postings[0].cutoff_at).toBe(
      new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    );
  });

  it("сохраняет точность коротких ID числом для Ozon", async () => {
    const { service, calls } = makeService({
      point: quotePoint({
        id: "123",
        shipmentMethodIds: ["456"],
      }),
    });

    const result = await service.calculate({
      deliveryPointId: "123",
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(true);
    expect(calls[0].body.postings[0].shipment_method_id).toBe(456);
    expect(calls[0].body.delivery.delivery_point.delivery_point_id).toBe(123);
  });

  it("длинные ID вне safe integer передаёт строкой", async () => {
    const pointId = "9007199254740993";
    const methodId = "9007199254740995";
    const { service, calls } = makeService({
      point: quotePoint({
        id: pointId,
        shipmentMethodIds: [methodId],
      }),
    });

    const result = await service.calculate({
      deliveryPointId: pointId,
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(true);
    expect(calls[0].body.postings[0].shipment_method_id).toBe(methodId);
    expect(calls[0].body.delivery.delivery_point.delivery_point_id).toBe(pointId);
  });

  it("не ходит в Ozon, если ПВЗ не найден", async () => {
    const { service, calls } = makeService({ point: null });

    const result = await service.calculate({
      deliveryPointId: "123",
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("point_not_found");
    expect(calls).toHaveLength(0);
  });

  it("не считает доставку в неактивный ПВЗ", async () => {
    const { service, calls } = makeService({
      point: quotePoint({ isActive: false }),
    });

    const result = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("point_inactive");
    expect(calls).toHaveLength(0);
  });

  it("требует shipment_method_id у ПВЗ", async () => {
    const { service, calls } = makeService({
      point: quotePoint({ shipmentMethodIds: [] }),
    });

    const result = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("no_shipment_method");
    expect(calls).toHaveLength(0);
  });

  it("возвращает ошибку API со статусом и trace id", async () => {
    const { service } = makeService({
      response: {
        ok: false,
        status: 403,
        traceId: "trace-403",
        error: { code: "7", message: "Access denied" },
      },
    });

    const result = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "9001234567",
      declaredValueKopeks: 100000,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("api_error");
    expect(result.status).toBe(403);
    expect(result.traceId).toBe("trace-403");
    expect(result.error).toBe("Access denied");
  });

  it("проверяет телефон и объявленную стоимость до запроса", async () => {
    const { service, calls } = makeService({});

    const badPhone = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "123",
      declaredValueKopeks: 100000,
    });
    const badValue = await service.calculate({
      deliveryPointId: "9000000000000001",
      phoneNumber: "9001234567",
      declaredValueKopeks: 0,
    });

    expect(badPhone.code).toBe("invalid_request");
    expect(badValue.code).toBe("invalid_request");
    expect(calls).toHaveLength(0);
  });
});
