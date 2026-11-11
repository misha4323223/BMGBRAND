/**
 * Резолвер промокодов попапа и баннера главной страницы.
 *
 * Порядок одинаковый везде (публичный API, админка, старт сервера):
 *   1) промокод по ID из bonus_settings;
 *   2) если ID пустой или устаревший (код удалён) — по коду (WELCOME10 / WELCOME7).
 *
 * Раньше каждый вызов писал свой вариант поиска, а инициализатор при сбое YDB
 * создавал новый WELCOME10 со скидкой 10 % — поэтому после деплоя процент в
 * попапе «сбрасывался» и в promo_codes появлялись дубли одного кода.
 */

export interface SubscriptionPromoLike {
  id: number | string;
  code?: string | null;
  discountPercent?: number | null;
  isActive?: boolean | null;
}

export function resolveSubscriptionPromo<T extends SubscriptionPromoLike>(
  promos: T[] | null | undefined,
  storedId: string | null | undefined,
  code: string,
): T | null {
  const list = Array.isArray(promos) ? promos : [];
  const wanted = code.trim().toUpperCase();

  if (storedId) {
    const byId = list.find((promo) => String(promo.id) === String(storedId));
    if (byId) return byId;
  }

  return list.find((promo) => String(promo.code || "").trim().toUpperCase() === wanted) ?? null;
}
