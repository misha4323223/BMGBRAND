/**
 * Пороги бесплатной доставки для РОЗНИЧНЫХ заказов.
 *
 * Одна и та же логика используется сервером (POST /api/orders) и клиентом
 * (страница «Оформление заказа») — чтобы подписи на сайте и реальная сумма
 * заказа не расходились.
 *
 * Значения редактируются в админке: page_settings("checkout") -> checkout_data
 * (`freeDeliveryThreshold` и `freeCourierDeliveryThreshold`, в копейках).
 *
 * Правила (с 2026-09-16):
 * - ПВЗ СДЭК / Ozon / самовывоз — бесплатно от 5 000 ₽;
 * - курьер СДЭК «до двери» — бесплатно только от 15 000 ₽;
 * - оптовые заказы и предзаказы в правило не входят;
 * - порог считается по сумме ТОВАРОВ (без доставки).
 */

/** ПВЗ / Ozon / самовывоз — 5 000 ₽ (копейки). */
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 500000;
/** Курьер СДЭК «до двери» — 15 000 ₽ (копейки). */
export const DEFAULT_FREE_COURIER_THRESHOLD = 1500000;

export interface FreeShippingThresholds {
  /** ПВЗ / Ozon / самовывоз, копейки. */
  pickup: number;
  /** Курьер СДЭК «до двери», копейки. */
  courier: number;
}

/**
 * Принимаем только конечное число >= 0 (копейки), иначе — фолбэк.
 * Строки с числом допускаем (админка/JSON могут прислать строку), но null,
 * пустую строку, массивы и объекты — НЕ приводим к 0: `Number(null) === 0`
 * иначе сломанное значение в настройках сделало бы доставку бесплатной всем.
 */
export function resolveThreshold(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  return fallback;
}

/** Пороги из объекта настроек чекаута; нет настроек/мусор — фолбэки. */
export function resolveFreeShippingThresholds(checkoutData: unknown): FreeShippingThresholds {
  const data = (
    checkoutData && typeof checkoutData === "object" ? checkoutData : {}
  ) as Record<string, unknown>;
  return {
    pickup: resolveThreshold(data.freeDeliveryThreshold, DEFAULT_FREE_SHIPPING_THRESHOLD),
    courier: resolveThreshold(data.freeCourierDeliveryThreshold, DEFAULT_FREE_COURIER_THRESHOLD),
  };
}

/** Порог для выбранного способа доставки (у курьера «до двери» он свой). */
export function getFreeShippingThreshold(
  thresholds: FreeShippingThresholds,
  isCourierDelivery = false,
): number {
  return isCourierDelivery ? thresholds.courier : thresholds.pickup;
}

/**
 * Подпадает ли заказ под бесплатную доставку.
 * Сумма — по ТОВАРАМ без доставки; оптовые заказы исключены.
 */
export function qualifiesForFreeShipping(opts: {
  subtotal: number;
  thresholds: FreeShippingThresholds;
  isWholesale?: boolean;
  isCourierDelivery?: boolean;
}): boolean {
  if (opts.isWholesale) return false;
  return opts.subtotal >= getFreeShippingThreshold(opts.thresholds, opts.isCourierDelivery);
}
