import { describe, it, expect } from "vitest";
import { isStockSyncDisabled, resolveStockSyncDisabled } from "../lib/manual-stock";

describe("isStockSyncDisabled — 1С не трогает остатки ручного товара", () => {
  it("обычный товар синхронизируется", () => {
    expect(isStockSyncDisabled({ id: 1, name: "Футболка" })).toBe(false);
    expect(isStockSyncDisabled({ stockSyncDisabled: false, preorderEnabled: false })).toBe(false);
  });

  it("явный флаг «остатки вручную» защищает товар", () => {
    expect(isStockSyncDisabled({ stockSyncDisabled: true })).toBe(true);
  });

  it("предзаказ защищает товар даже без новой колонки", () => {
    // Продовый случай: товар создан до появления stock_sync_disabled,
    // в БД колонка пустая — предзаказ всё равно должен защищать остатки.
    expect(isStockSyncDisabled({ preorderEnabled: true })).toBe(true);
    expect(isStockSyncDisabled({ stockSyncDisabled: null, preorderEnabled: true })).toBe(true);
  });

  it("пустые/битые значения не ломают проверку", () => {
    expect(isStockSyncDisabled(null)).toBe(false);
    expect(isStockSyncDisabled(undefined)).toBe(false);
    expect(isStockSyncDisabled({ stockSyncDisabled: 1 })).toBe(false);
    expect(isStockSyncDisabled({ stockSyncDisabled: "true" })).toBe(false);
  });
});

describe("resolveStockSyncDisabled — флаг следует за предзаказом", () => {
  it("включили предзаказ → ручные остатки", () => {
    expect(resolveStockSyncDisabled(true, undefined)).toBe(true);
    expect(resolveStockSyncDisabled("true", undefined)).toBe(true);
    expect(resolveStockSyncDisabled(true, false)).toBe(true);
  });

  it("выключили предзаказ → синхронизация возвращается", () => {
    expect(resolveStockSyncDisabled(false, undefined)).toBe(false);
    expect(resolveStockSyncDisabled("false", undefined)).toBe(false);
  });

  it("явный выбор админа побеждает", () => {
    expect(resolveStockSyncDisabled(undefined, true)).toBe(true);
    expect(resolveStockSyncDisabled(undefined, false)).toBe(false);
    expect(resolveStockSyncDisabled(false, true)).toBe(true);
    expect(resolveStockSyncDisabled(false, false)).toBe(false);
  });

  it("поля в запросе нет → флаг не трогаем", () => {
    expect(resolveStockSyncDisabled(undefined, undefined)).toBeUndefined();
  });

  it("значение «не true» не включает ручной режим", () => {
    expect(resolveStockSyncDisabled(undefined, "true")).toBe(false);
    expect(resolveStockSyncDisabled(undefined, 1)).toBe(false);
  });
});
