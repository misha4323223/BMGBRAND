import { describe, it, expect } from "vitest";
import { isBot, isBrowser, CYRILLIC_TO_CANONICAL } from "../bot-ssr";

describe("isBot / isBrowser", () => {
  it("определяет поисковых ботов", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)")).toBe(true);
  });

  it("не путает обычные браузеры с ботами", () => {
    expect(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe(false);
    expect(isBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36")).toBe(true);
  });
});

describe("CYRILLIC_TO_CANONICAL", () => {
  it("ведёт с кириллических слагов на английские каноны (для 301)", () => {
    expect(CYRILLIC_TO_CANONICAL["tolstovki"]).toBe("hoodies");
    expect(CYRILLIC_TO_CANONICAL["futbolki"]).toBe("t-shirts");
  });

  it("все значения — непустые строки", () => {
    for (const [from, to] of Object.entries(CYRILLIC_TO_CANONICAL)) {
      expect(typeof from).toBe("string");
      expect(typeof to).toBe("string");
      expect(to.length).toBeGreaterThan(0);
    }
  });
});