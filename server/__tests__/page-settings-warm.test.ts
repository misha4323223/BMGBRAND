import { afterEach, beforeEach, describe, expect, it } from "vitest";
// side-effect: патчит DatabaseStorage.prototype.getPageSettings — так же, как
// сервер при старте через storage/index.ts. Тянем только settings.ts, чтобы не
// поднимать в тесте все domain-модули storage.
import "../storage/settings";
import { storage, pageSettingsCache, ensurePageSettingsCached } from "../storage/core";

const PAGE = "blog_pages";

describe("ensurePageSettingsCached", () => {
  beforeEach(() => {
    pageSettingsCache.delete(PAGE);
  });

  afterEach(() => {
    // Снимаем возможную подмену и возвращаем родной метод с прототипа.
    delete (storage as any).getPageSettings;
    pageSettingsCache.delete(PAGE);
  });

  it("тёплый кэш: возвращает true и не ходит в YDB", async () => {
    pageSettingsCache.set(PAGE, { "0": { title: "Худи" } });
    (storage as any).getPageSettings = () => {
      throw new Error("YDB не должен вызываться при тёплом кэше");
    };
    await expect(ensurePageSettingsCached(PAGE)).resolves.toBe(true);
  });

  it("холодный кэш: прогревает blog_pages через storage.getPageSettings", async () => {
    let calls = 0;
    (storage as any).getPageSettings = async (name: string) => {
      calls += 1;
      const data = { "0": { title: "Худи" } };
      pageSettingsCache.set(name, data);
      return data;
    };
    await expect(ensurePageSettingsCached(PAGE)).resolves.toBe(true);
    expect(calls).toBe(1);
    expect(pageSettingsCache.get(PAGE)).toBeTruthy();
  });

  it("дедуплицирует параллельные запросы", async () => {
    let calls = 0;
    (storage as any).getPageSettings = async (name: string) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      pageSettingsCache.set(name, {});
      return {};
    };
    const [a, b] = await Promise.all([
      ensurePageSettingsCached(PAGE),
      ensurePageSettingsCached(PAGE),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toBe(1);
  });

  it("ошибка YDB (пусто и без кэширования) — false, без исключения", async () => {
    (storage as any).getPageSettings = async () => ({});
    await expect(ensurePageSettingsCached(PAGE, 50)).resolves.toBe(false);
  });

  // ВАЖНО: тест с зависшим промисом идёт последним. Такой промис остаётся в
  // pageSettingsWarmInflight до конца файла, и следующие тесты присоединялись
  // бы к нему вместо собственных моков.
  it("не ждёт вечно: по таймауту возвращает false", async () => {
    (storage as any).getPageSettings = () => new Promise<never>(() => {});
    await expect(ensurePageSettingsCached(PAGE, 25)).resolves.toBe(false);
  });
});
