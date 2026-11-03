import { describe, it, expect } from "vitest";
import { parseOzonJson } from "../ozon-delivery-api/json";

describe("parseOzonJson", () => {
  it("сохраняет большие int64 строками", () => {
    const parsed = parseOzonJson(
      '{"delivery_point_id":9007199254740993,"shipment_method_id":9007199254740995}',
    );
    expect(parsed.delivery_point_id).toBe("9007199254740993");
    expect(parsed.shipment_method_id).toBe("9007199254740995");
  });

  it("оставляет безопасные числа числами", () => {
    const parsed = parseOzonJson(
      '{"id":123,"days":2,"cost":1250.50,"exp":1e5}',
    );
    expect(parsed.id).toBe(123);
    expect(parsed.days).toBe(2);
    expect(parsed.cost).toBe(1250.5);
    expect(parsed.exp).toBe(100000);
  });

  it("не трогает цифры внутри строк и escape-последовательности", () => {
    const parsed = parseOzonJson(
      '{"text":"ID 9007199254740993 \\"quoted\\"","nested":{"id":9007199254740993}}',
    );
    expect(parsed.text).toBe('ID 9007199254740993 "quoted"');
    expect(parsed.nested.id).toBe("9007199254740993");
  });

  it("поддерживает отрицательные большие числа", () => {
    expect(parseOzonJson('{"delta":-9007199254740993}').delta).toBe(
      "-9007199254740993",
    );
  });
});
