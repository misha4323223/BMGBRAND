/**
 * Общие преобразования для запросов Ozon Delivery API.
 *
 * ID приходят как int64: короткие можно отдавать числом, длинные — только
 * строкой, иначе JavaScript потеряет точность. Деньги Ozon принимает строкой
 * в рублях с двумя знаками после запятой.
 */

export function normalizeOzonId(value: any): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const id = String(value);
    return /^\d{1,20}$/.test(id) ? id : null;
  }
  const raw = String(value ?? "").trim();
  return /^\d{1,20}$/.test(raw) ? raw : null;
}

/** int64 в JSON: маленькие ID — числом, длинные — строкой без потери точности. */
export function toOzonApiInt64(id: string): string | number {
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : id;
}

export function kopeksToOzonAmount(kopeks: number): string {
  const safe = Math.max(0, Math.round(kopeks));
  return `${Math.floor(safe / 100)}.${String(safe % 100).padStart(2, "0")}`;
}
