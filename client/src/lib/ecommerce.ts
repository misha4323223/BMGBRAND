/**
 * Яндекс.Метрика — электронная коммерция через dataLayer.
 *
 * Счётчик инициализируется в client/index.html с параметром ecommerce: "dataLayer",
 * а глобальный массив window.dataLayer создаётся там же до инициализации.
 * Здесь — только отправка событий (detail / add / remove / purchase).
 *
 * ВАЖНО: цены везде принимаются в КОПЕЙКАХ (как хранятся в БД),
 * в dataLayer уходят в рублях (требование Метрики: price числом).
 */
import { CATEGORIES } from "@shared/schema";

export interface EcommerceProductInput {
  /** Стабильный ID/SKU товара (должен совпадать на просмотре, в корзине и покупке) */
  id: string | number;
  name: string;
  /** Цена в копейках (как в БД) */
  priceCents: number;
  /** Иерархическая категория: "Одежда / Футболки" */
  category?: string;
  /** Вариант: "Черный / L" */
  variant?: string;
  quantity?: number;
}

type EcommerceAction = "detail" | "add" | "remove";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

const BRAND = "BOOOMERANGS";
const CURRENCY = "RUB";
const PURCHASE_KEY = "bmg_ym_purchase_ids";

function getDataLayer(): Record<string, unknown>[] | null {
  if (typeof window === "undefined" || !Array.isArray(window.dataLayer)) return null;
  return window.dataLayer;
}

function toProduct(p: EcommerceProductInput): Record<string, unknown> {
  const product: Record<string, unknown> = {
    id: String(p.id),
    name: p.name,
    price: Math.round(p.priceCents / 100),
    brand: BRAND,
  };
  if (p.category) product.category = p.category;
  if (p.variant) product.variant = p.variant;
  if (p.quantity != null) product.quantity = p.quantity;
  return product;
}

/** Просмотр карточки товара / добавление / удаление. */
export function pushEcommerce(action: EcommerceAction, products: EcommerceProductInput[]): void {
  const dl = getDataLayer();
  if (!dl || !products.length) return;
  dl.push({
    ecommerce: {
      currencyCode: CURRENCY,
      [action]: { products: products.map(toProduct) },
    },
  });
}

function wasPurchaseSent(orderId: string | number): boolean {
  try {
    const raw = window.localStorage.getItem(PURCHASE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    return ids.includes(String(orderId));
  } catch {
    return false;
  }
}

function markPurchaseSent(orderId: string | number): void {
  try {
    const raw = window.localStorage.getItem(PURCHASE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(String(orderId))) {
      ids.push(String(orderId));
      window.localStorage.setItem(PURCHASE_KEY, JSON.stringify(ids.slice(-200)));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Покупка — отправляется ТОЛЬКО один раз на один заказ
 * (защита от дублей при обновлении страницы подтверждения заказа).
 */
export function pushEcommercePurchase(orderId: string | number, products: EcommerceProductInput[]): void {
  const dl = getDataLayer();
  if (!dl || !products.length) return;
  if (wasPurchaseSent(orderId)) return;
  markPurchaseSent(orderId);
  dl.push({
    ecommerce: {
      currencyCode: CURRENCY,
      purchase: {
        actionField: { id: String(orderId) },
        products: products.map(toProduct),
      },
    },
  });
}

/** Вариант товара: "Цвет / Размер" (пропускает "Default"/"One Size"). */
export function makeVariant(size?: string | null, color?: string | null): string | undefined {
  const parts: string[] = [];
  if (color && color !== "Default") parts.push(color);
  if (size && size !== "One Size") parts.push(size);
  return parts.length ? parts.join(" / ") : undefined;
}

/** Иерархическая категория: "Одежда / Футболки". */
export function makeCategory(categoryName?: string | null, subcategory?: string | null): string | undefined {
  if (!categoryName) return undefined;
  return subcategory ? `${categoryName} / ${subcategory}` : categoryName;
}

/** Категория из слагов продукта (category=clothing → "Одежда / Футболки"). */
export function makeCategoryFromSlugs(
  categorySlug?: string | null,
  subcategory?: string | null,
): string | undefined {
  if (!categorySlug) return undefined;
  const name = (CATEGORIES as Record<string, { name?: string }>)[categorySlug]?.name ?? categorySlug;
  return makeCategory(name, subcategory);
}

/**
 * ID счётчика Яндекс.Метрики. Должен совпадать с инициализацией в client/index.html.
 */
export const YANDEX_METRIKA_COUNTER_ID = 107182693;

declare global {
  interface Window {
    ym?: any;
  }
}

/**
 * Принудительно загружает счётчик Метрики немедленно (если ещё не загружен).
 * На обычных страницах Метрика грузится лениво (после первого действия или 5с) —
 * на checkout/success её можно подтянуть сразу, чтобы события воронки и purchase
 * надёжно уходили даже при быстрых переходах и возврате с платёжки.
 * Идемпотентно: повторные вызовы ничего не ломают.
 */
export function ensureMetrikaLoaded(): void {
  if (typeof window === "undefined") return;
  // Если скрипт tag.js уже загружен — ничего не делаем (счётчик инициализируется в onload).
  const win = window as any;
  if (win.__bmMetrikaLoaded || (win.ym && win.ym.a)) return;
  win.__bmMetrikaLoaded = true;

  // Создаём шум-шим как в index.html на случай, если скрипт ещё не добрался.
  if (typeof win.ym !== "function") {
    win.ym = win.ym || function () {
      (win.ym.a = win.ym.a || []).push(arguments);
    };
    win.ym.l = Date.now();
  }

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://mc.yandex.ru/metrika/tag.js";
  s.onload = () => {
    win.ym(YANDEX_METRIKA_COUNTER_ID, "init", {
      id: YANDEX_METRIKA_COUNTER_ID,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true,
      ecommerce: "dataLayer",
    });
  };
  document.head.appendChild(s);
}

/**
 * Отправка цели (goal) в Яндекс.Метрику: ym(<id>, 'reachGoal', <goalId>).
 * Целевые идентификаторы должны быть созданы в кабинете счётчика (Цели → JavaScript-событие).
 * Безопасно, если Метрика ещё не загружена (шум-шим накопит вызов).
 */
export function reachGoal(goalId: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const win = window as any;
  if (typeof win.ym !== "function") return;
  if (params) {
    win.ym(YANDEX_METRIKA_COUNTER_ID, "reachGoal", goalId, params);
  } else {
    win.ym(YANDEX_METRIKA_COUNTER_ID, "reachGoal", goalId);
  }
}
