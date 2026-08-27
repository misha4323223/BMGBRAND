/**
 * Чистая логика расчёта промокода для заказа.
 * Извлечена из applyPromoToOrder() в server/routes.ts дословно, без изменения
 * поведения — чтобы её можно было покрыть юнит-тестами без обращения к БД.
 *
 * Все денежные величины здесь в копейках (как во всём сервере).
 */

export interface PromoItem {
  price: number;
  quantity: number;
  size?: string | null;
  product?: any;
}

/** Товар уже имеет собственную скидку (sale/discount/размер) — промокод к нему не применяется. */
export function isItemDiscounted(item: PromoItem): boolean {
  const p = item.product as any;
  return (
    !!p &&
    ((p.salePrice && p.salePrice > 0 && p.salePrice < (p.price || 0)) ||
      p.discountPercent > 0 ||
      (item.size != null && p.sizeDiscounts?.[item.size] > 0))
  );
}

/** Сумма позиций, к которым промокод может примениться (без товаров со своей скидкой). */
export function computePromoEligibleSubtotal(items: PromoItem[]): number {
  return items.reduce((sum, it) => {
    if (isItemDiscounted(it)) return sum;
    return sum + it.price * it.quantity;
  }, 0);
}

/** Скидка промокода: процент от eligible-суммы или фикс. сумма, но не больше самой суммы. */
export function computePromoDiscount(
  promo: { discountPercent?: number | null; discountAmount?: number | null },
  eligibleSubtotal: number,
): number {
  let promoDiscount = 0;
  if (promo.discountPercent) {
    promoDiscount = Math.round(eligibleSubtotal * (promo.discountPercent / 100));
  } else if (promo.discountAmount) {
    promoDiscount = promo.discountAmount;
  }
  return Math.min(promoDiscount, eligibleSubtotal);
}
