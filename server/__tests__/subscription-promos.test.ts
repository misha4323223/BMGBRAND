import { describe, it, expect } from "vitest";
import { resolveSubscriptionPromo } from "../lib/subscription-promos";

const promo = (over: Record<string, unknown>) => ({ id: 1, code: "WELCOME10", ...over });

describe("resolveSubscriptionPromo", () => {
  it("находит промокод по ID из настроек", () => {
    const promos = [promo({ id: 10, code: "WELCOME10", discountPercent: 7 }), promo({ id: 20, code: "WELCOME7" })];
    expect(resolveSubscriptionPromo(promos, "20", "WELCOME10")?.id).toBe(20);
  });

  it("если ID устарел — берёт по коду", () => {
    const promos = [promo({ id: 10, code: "WELCOME10", discountPercent: 7 })];
    expect(resolveSubscriptionPromo(promos, "999", "WELCOME10")?.id).toBe(10);
  });

  it("если ID пустой — берёт по коду", () => {
    const promos = [promo({ id: 10, code: "WELCOME10" })];
    expect(resolveSubscriptionPromo(promos, "", "WELCOME10")?.id).toBe(10);
    expect(resolveSubscriptionPromo(promos, null, "WELCOME10")?.id).toBe(10);
  });

  it("код сравнивается без учёта регистра и пробелов", () => {
    const promos = [promo({ id: 10, code: " welcome10 " })];
    expect(resolveSubscriptionPromo(promos, null, "WELCOME10")?.id).toBe(10);
  });

  it("ничего не нашли — null (дефолтный промокод не подставляется)", () => {
    expect(resolveSubscriptionPromo([promo({ id: 10, code: "WELCOME7" })], "", "WELCOME10")).toBeNull();
    expect(resolveSubscriptionPromo([], null, "WELCOME10")).toBeNull();
    expect(resolveSubscriptionPromo(null, "1", "WELCOME10")).toBeNull();
  });

  it("ID имеет приоритет над кодом", () => {
    const promos = [
      promo({ id: 1, code: "WELCOME7" }),
      promo({ id: 2, code: "WELCOME10" }),
    ];
    // Привязка к WELCOME7 должна уважаться, даже если ищем WELCOME10.
    expect(resolveSubscriptionPromo(promos, "1", "WELCOME10")?.code).toBe("WELCOME7");
  });
});
