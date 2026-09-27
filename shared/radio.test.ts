import { describe, expect, it } from "vitest";
import {
  RADIO_HIDDEN_PATH_PREFIXES,
  RADIO_LISTENERS_MIN_DISPLAY,
  RADIO_STATION,
  formatListenersCount,
  getVisibleListenersCount,
  listenersVerb,
  sanitizeListenerId,
  shouldShowRadioStrip,
} from "./radio";

describe("shouldShowRadioStrip", () => {
  it("показывает полоску на обычных страницах магазина", () => {
    for (const path of [
      "/",
      "/products",
      "/products/hoodies",
      "/blog",
      "/blog/0",
      "/cart",
      "/favorites",
      "/@miyagi",
      "/concept/some-drop",
    ]) {
      expect(shouldShowRadioStrip(path)).toBe(true);
    }
  });

  it("скрывает полоску в админке, партнёрке, опте и оформлении заказа", () => {
    for (const path of [
      "/admin",
      "/admin/products",
      "/partner",
      "/partner/register",
      "/wholesale",
      "/wholesale/register",
      "/checkout",
      "/predrop/checkout",
    ]) {
      expect(shouldShowRadioStrip(path)).toBe(false);
    }
  });

  it("не путает похожие пути с запрещёнными префиксами", () => {
    expect(shouldShowRadioStrip("/partners")).toBe(true);
    expect(shouldShowRadioStrip("/checkoutsky")).toBe(true);
    expect(shouldShowRadioStrip("/administrator")).toBe(true);
  });

  it("пустой путь считает безопасным (показываем)", () => {
    expect(shouldShowRadioStrip("")).toBe(true);
  });

  it("конфиг станции ссылается на https-поток и наш эндпоинт", () => {
    expect(RADIO_STATION.streamUrl.startsWith("https://")).toBe(true);
    expect(RADIO_STATION.nowPlayingUrl.startsWith("/api/")).toBe(true);
    expect(RADIO_STATION.name).toBe("Дикая Мята");
    expect(RADIO_HIDDEN_PATH_PREFIXES).toContain("/admin");
    expect(RADIO_HIDDEN_PATH_PREFIXES).toContain("/checkout");
  });
});

describe("getVisibleListenersCount", () => {
  it("скрывает счётчик при 0, 1 и 2 слушателях", () => {
    expect(RADIO_LISTENERS_MIN_DISPLAY).toBe(3);
    expect(getVisibleListenersCount(0)).toBeNull();
    expect(getVisibleListenersCount(1)).toBeNull();
    expect(getVisibleListenersCount(2)).toBeNull();
  });

  it("показывает счётчик от 3 слушателей", () => {
    expect(getVisibleListenersCount(3)).toBe(3);
    expect(getVisibleListenersCount(7)).toBe(7);
    expect(getVisibleListenersCount(123)).toBe(123);
  });

  it("округляет вниз и игнорирует мусор", () => {
    expect(getVisibleListenersCount(3.9)).toBe(3);
    expect(getVisibleListenersCount(null)).toBeNull();
    expect(getVisibleListenersCount(undefined)).toBeNull();
    expect(getVisibleListenersCount(Number.NaN)).toBeNull();
    expect(getVisibleListenersCount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("склонение слушателей", () => {
  it("1 и 21 — «слушает», остальные — «слушают»", () => {
    expect(listenersVerb(1)).toBe("слушает");
    expect(listenersVerb(21)).toBe("слушает");
    expect(listenersVerb(31)).toBe("слушает");
    expect(listenersVerb(2)).toBe("слушают");
    expect(listenersVerb(3)).toBe("слушают");
    expect(listenersVerb(11)).toBe("слушают");
    expect(listenersVerb(12)).toBe("слушают");
    expect(listenersVerb(111)).toBe("слушают");
    expect(listenersVerb(112)).toBe("слушают");
  });

  it("formatListenersCount собирает строку", () => {
    expect(formatListenersCount(3)).toBe("3 слушают");
    expect(formatListenersCount(21)).toBe("21 слушает");
    expect(formatListenersCount(0)).toBe("0 слушают");
  });
});

describe("sanitizeListenerId", () => {
  it("принимает анонимные id гостя и пользователя", () => {
    expect(sanitizeListenerId("V1StGXR8_Z5jdHi6B-myT")).toBe("V1StGXR8_Z5jdHi6B-myT");
    expect(sanitizeListenerId("user_123")).toBe("user_123");
    expect(sanitizeListenerId("  abcdef  ")).toBe("abcdef");
  });

  it("отбивает слишком короткие, длинные и подозрительные значения", () => {
    expect(sanitizeListenerId("abc")).toBeNull();
    expect(sanitizeListenerId("a".repeat(65))).toBeNull();
    expect(sanitizeListenerId("id with spaces")).toBeNull();
    expect(sanitizeListenerId("id/slash")).toBeNull();
    expect(sanitizeListenerId("id.dot")).toBeNull();
    expect(sanitizeListenerId("ид-кириллица")).toBeNull();
    expect(sanitizeListenerId("'; DROP TABLE radio_listeners; --")).toBeNull();
  });

  it("не принимает не-строки", () => {
    expect(sanitizeListenerId(42)).toBeNull();
    expect(sanitizeListenerId(null)).toBeNull();
    expect(sanitizeListenerId(undefined)).toBeNull();
    expect(sanitizeListenerId(["abc123"])).toBeNull();
    expect(sanitizeListenerId({ id: "abcdef" })).toBeNull();
  });
});
