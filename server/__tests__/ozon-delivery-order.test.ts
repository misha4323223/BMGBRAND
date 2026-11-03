import { describe, it, expect } from "vitest";
import {
  OZON_DELIVERY_ORDER_CREATE_PATH,
  OzonDeliveryOrderService,
  parseOzonOrderCreateResponse,
  type OzonOrderCreateRequest,
} from "../ozon-delivery-api/order";
import type { OzonDeliveryQuote } from "../ozon-delivery-api/quote";

const NOW = 1_700_000_000_000;
const IDEM = "11111111-1111-4111-8111-111111111111";

function quote(overrides: Partial<OzonDeliveryQuote> = {}): OzonDeliveryQuote {
  return {
    deliveryPointId: "9000000000000001",
    shipmentMethodId: "9000000000000002",
    deliveryCostKopeks: 125050,
    insuranceCostKopeks: 9900,
    costKopeks: 134950,
    estimatedDeliveryDays: 2,
    cutoffAt: "2026-07-16T12:00:00Z",
    requestIds: ["1"],
    traceId: "trace-quote",
    ...overrides,
  };
}

function baseRequest(
  overrides: Partial<OzonOrderCreateRequest> = {},
): OzonOrderCreateRequest {
  return {
    deliveryPointId: "9000000000000001",
    phoneNumber: "+7 (900) 123-45-67",
    declaredValueKopeks: 350000,
    itemCount: 3,
    description: "Смартфон и чехол",
    fullName: "Иванов Иван Иванович",
    orderExternalId: "shop-order-42",
    postingExternalId: "shop-posting-42-1",
    ...overrides,
  };
}

function makeService(options: {
  quoteResult?: any;
  response?: any;
  newId?: () => string;
} = {}) {
  const quoteCalls: any[] = [];
  const calls: Array<{ path: string; body: any; headers: Record<string, string> }> =
    [];

  const quoteService = {
    async calculate(request: any) {
      quoteCalls.push(request);
      return (
        options.quoteResult ?? {
          success: true,
          quote: quote(),
        }
      );
    },
  };

  const client = {
    async request(path: string, body: any, headers: Record<string, string> = {}) {
      calls.push({ path, body, headers });
      return (
        options.response ?? {
          ok: true,
          status: 200,
          traceId: "trace-create",
          data: {
            order_number: "YY-123BE456PY78-90YY",
            order_external_id: "shop-order-42",
            postings: [
              {
                request_id: 101,
                posting_number: "123BE456PY78-90YY",
                posting_external_id: "shop-posting-42-1",
                estimated_delivery_days: 2,
                cutoff_at: "2026-07-16T12:00:00Z",
              },
            ],
          },
        }
      );
    },
  };

  const service = new OzonDeliveryOrderService({
    client: client as any,
    quote: quoteService as any,
    now: () => NOW,
    newId: options.newId ?? (() => IDEM),
  });

  return { service, quoteCalls, calls };
}

describe("parseOzonOrderCreateResponse", () => {
  it("разбирает заказ и отправления по официальной схеме", () => {
    const parsed = parseOzonOrderCreateResponse({
      order_number: "YY-123BE456PY78-90YY",
      order_external_id: "shop-order-42",
      postings: [
        {
          request_id: 101,
          posting_number: "123BE456PY78-90YY",
          posting_external_id: "shop-posting-42-1",
          estimated_delivery_days: 2,
          cutoff_at: "2026-07-16T12:00:00Z",
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.orderNumber).toBe("YY-123BE456PY78-90YY");
    expect(parsed.value.orderExternalId).toBe("shop-order-42");
    expect(parsed.value.postings).toEqual([
      {
        requestId: "101",
        postingNumber: "123BE456PY78-90YY",
        postingExternalId: "shop-posting-42-1",
        estimatedDeliveryDays: 2,
        cutoffAt: "2026-07-16T12:00:00Z",
      },
    ]);
  });

  it("сохраняет большие request_id строками", () => {
    const parsed = parseOzonOrderCreateResponse({
      order_number: "YY-1",
      postings: [
        {
          request_id: "9007199254740993",
          posting_number: "POSTING-1",
        },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.postings[0].requestId).toBe("9007199254740993");
  });

  it("возвращает ошибку Ozon", () => {
    expect(
      parseOzonOrderCreateResponse({
        error: { code: "NotEnoughBalance", message: "Недостаточно средств" },
      }),
    ).toEqual({ ok: false, error: "Недостаточно средств" });
  });

  it("не принимает ответ без order_number или отправлений", () => {
    expect(
      parseOzonOrderCreateResponse({
        postings: [{ posting_number: "POSTING-1" }],
      }),
    ).toEqual({ ok: false, error: "Ozon не вернул order_number" });

    expect(
      parseOzonOrderCreateResponse({
        order_number: "YY-1",
        postings: [],
      }),
    ).toEqual({ ok: false, error: "Ozon не вернул отправления заказа" });
  });

  it("не принимает отправление без posting_number", () => {
    expect(
      parseOzonOrderCreateResponse({
        order_number: "YY-1",
        postings: [{ request_id: 1 }],
      }),
    ).toEqual({
      ok: false,
      error: "Ozon не вернул posting_number созданного отправления",
    });
  });
});

describe("OzonDeliveryOrderService", () => {
  it("сначала делает quote теми же параметрами, затем создаёт заказ", async () => {
    const { service, quoteCalls, calls } = makeService();

    const result = await service.create(baseRequest());

    expect(result.success).toBe(true);
    expect(result.order).toMatchObject({
      orderNumber: "YY-123BE456PY78-90YY",
      orderExternalId: "shop-order-42",
      postings: [
        {
          requestId: "101",
          postingNumber: "123BE456PY78-90YY",
          postingExternalId: "shop-posting-42-1",
          estimatedDeliveryDays: 2,
        },
      ],
    });
    expect(result.quote?.costKopeks).toBe(134950);
    expect(result.idempotencyKey).toBe(IDEM);
    expect(result.traceId).toBe("trace-create");

    expect(quoteCalls).toHaveLength(1);
    expect(quoteCalls[0]).toMatchObject({
      deliveryPointId: "9000000000000001",
      phoneNumber: "+79001234567",
      declaredValueKopeks: 350000,
      itemCount: 3,
      dimensions: {
        weightGrams: 900,
        lengthMm: 290,
        widthMm: 200,
        heightMm: 50,
      },
    });
    expect(quoteCalls[0].cutoffAt).toBe(
      new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(OZON_DELIVERY_ORDER_CREATE_PATH);
    expect(calls[0].headers["Idempotency-Key"]).toBe(IDEM);
    expect(calls[0].body).toMatchObject({
      order_external_id: "shop-order-42",
      recipient: {
        phone_number: "+79001234567",
        full_name: "Иванов Иван Иванович",
      },
      postings: [
        {
          request_id: 1,
          posting_external_id: "shop-posting-42-1",
          shipment_method_id: 9000000000000002,
          description: "Смартфон и чехол",
          declared_value: { amount: "3500.00", currency_code: "RUB" },
          dimensions: {
            weight_g: 900,
            length_mm: 290,
            width_mm: 200,
            height_mm: 50,
          },
        },
      ],
      delivery: {
        delivery_point: { delivery_point_id: 9000000000000001 },
      },
    });
    expect(calls[0].body.postings[0].cutoff_at).toBe(
      quoteCalls[0].cutoffAt,
    );
  });

  it("не передаёт пустые необязательные поля", async () => {
    const { service, calls } = makeService();

    const result = await service.create(
      baseRequest({
        fullName: "",
        orderExternalId: "",
        postingExternalId: "",
      }),
    );

    expect(result.success).toBe(true);
    expect(calls[0].body).not.toHaveProperty("order_external_id");
    expect(calls[0].body.recipient).toEqual({
      phone_number: "+79001234567",
    });
    expect(calls[0].body.postings[0]).not.toHaveProperty(
      "posting_external_id",
    );
    expect(result.order?.orderExternalId).toBe("shop-order-42");
  });

  it("передаёт длинные ID строками, не теряя точность", async () => {
    const pointId = "9007199254740993";
    const methodId = "9007199254740995";
    const { service, quoteCalls, calls } = makeService({
      quoteResult: {
        success: true,
        quote: quote({
          deliveryPointId: pointId,
          shipmentMethodId: methodId,
        }),
      },
    });

    const result = await service.create(
      baseRequest({ deliveryPointId: pointId }),
    );

    expect(result.success).toBe(true);
    expect(quoteCalls[0].deliveryPointId).toBe(pointId);
    expect(calls[0].body.postings[0].shipment_method_id).toBe(methodId);
    expect(calls[0].body.delivery.delivery_point.delivery_point_id).toBe(
      pointId,
    );
  });

  it("принимает явный UUID и не генерирует новый", async () => {
    const explicit = "22222222-2222-4222-8222-222222222222";
    const { service, calls } = makeService({
      newId: () => {
        throw new Error("newId must not be called");
      },
    });

    const result = await service.create(
      baseRequest({ idempotencyKey: explicit }),
    );

    expect(result.success).toBe(true);
    expect(result.idempotencyKey).toBe(explicit);
    expect(calls[0].headers["Idempotency-Key"]).toBe(explicit);
  });

  it("не создаёт заказ, если quote не прошёл", async () => {
    const { service, quoteCalls, calls } = makeService({
      quoteResult: {
        success: false,
        code: "api_error",
        error: "Access denied",
        status: 403,
        traceId: "trace-quote-403",
      },
    });

    const result = await service.create(baseRequest());

    expect(result).toMatchObject({
      success: false,
      code: "quote_failed",
      quoteCode: "api_error",
      status: 403,
      traceId: "trace-quote-403",
      error: "Access denied",
      idempotencyKey: IDEM,
    });
    expect(quoteCalls).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("помечает 5xx и сетевую ошибку как возможное создание заказа", async () => {
    const serverError = makeService({
      response: {
        ok: false,
        status: 500,
        traceId: "trace-500",
        error: { code: "http_error", message: "Internal error" },
      },
    });
    const networkError = makeService({
      response: {
        ok: false,
        status: 0,
        error: { code: "network_error", message: "timeout" },
      },
    });

    const first = await serverError.service.create(baseRequest());
    const second = await networkError.service.create(baseRequest());

    expect(first.success).toBe(false);
    expect(first.code).toBe("api_error");
    expect(first.mayHaveBeenCreated).toBe(true);
    expect(second.success).toBe(false);
    expect(second.mayHaveBeenCreated).toBe(true);
  });

  it("не отправляет create, если quote вернул некорректный shipment_method_id", async () => {
    const { service, calls } = makeService({
      quoteResult: {
        success: true,
        quote: quote({ shipmentMethodId: "not-a-method" }),
      },
    });

    const result = await service.create(baseRequest());

    expect(result.success).toBe(false);
    expect(result.code).toBe("invalid_response");
    expect(result.mayHaveBeenCreated).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it("не считает ошибкой создания отказ Ozon 400 или ошибку токена", async () => {
    const badRequest = makeService({
      response: {
        ok: false,
        status: 400,
        error: { code: "bad_request", message: "Invalid dimensions" },
      },
    });
    const tokenError = makeService({
      response: {
        ok: false,
        status: 0,
        error: { code: "token_error", message: "Client secret invalid" },
      },
    });

    const first = await badRequest.service.create(baseRequest());
    const second = await tokenError.service.create(baseRequest());

    expect(first.mayHaveBeenCreated).toBe(false);
    expect(second.mayHaveBeenCreated).toBe(false);
  });

  it("считает разбор 200-ответа без order_number неизвестным результатом", async () => {
    const { service } = makeService({
      response: {
        ok: true,
        status: 200,
        traceId: "trace-empty",
        data: {},
      },
    });

    const result = await service.create(baseRequest());

    expect(result.success).toBe(false);
    expect(result.code).toBe("invalid_response");
    expect(result.mayHaveBeenCreated).toBe(true);
    expect(result.idempotencyKey).toBe(IDEM);
  });

  it("валидирует телефон, сумму, количество, описание и UUID до Ozon", async () => {
    const { service, quoteCalls, calls } = makeService();

    const results = await Promise.all([
      service.create(baseRequest({ phoneNumber: "123" })),
      service.create(
        baseRequest({ declaredValueKopeks: 50_000_001 }),
      ),
      service.create(baseRequest({ itemCount: 101 })),
      service.create(baseRequest({ description: "x".repeat(501) })),
      service.create(baseRequest({ idempotencyKey: "not-a-uuid" })),
      service.create(baseRequest({ cutoffAt: "not-a-date" })),
    ]);

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.code).toBe("invalid_request");
    }
    expect(quoteCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
