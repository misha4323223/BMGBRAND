/**
 * Единый расчёт цены позиции заказа.
 * Извлечено из обработчика обычного заказа, чтобы предзаказы считали цену
 * так же, как её видит покупатель на витрине (оптовая цена / salePrice /
 * discountPercent / скидка по размеру).
 */

export interface PriceableProduct {
  price: number;
  wholesalePrice?: number | null;
  wholesaleDiscountPercent?: number | null;
  salePrice?: number | null;
  discountPercent?: number | null;
  sizeDiscounts?: Record<string, number> | null;
}

export interface ResolvedItemPrice {
  /** Цена за единицу в копейках. */
  price: number;
  /** Сумма оптовой скидки на единицу (0 для розницы) — для отображения в счетах и уведомлениях. */
  wholesaleDiscountPerUnit: number;
}

export interface ResolveItemPriceOptions {
  isWholesale?: boolean;
  /**
   * Размер позиции. Передаётся только там, где цена хранится отдельно для
   * каждого размера — иначе скидка по размеру не применяется.
   */
  size?: string | null;
}

export function resolveItemPrice(
  product: PriceableProduct,
  options: ResolveItemPriceOptions = {},
): ResolvedItemPrice {
  const { isWholesale = false, size = null } = options;

  if (isWholesale) {
    const wholesalePrice = product.wholesalePrice;
    if (wholesalePrice && wholesalePrice > 0) {
      const discountPercent = product.wholesaleDiscountPercent;
      if (discountPercent && discountPercent > 0) {
        const discounted = Math.round(wholesalePrice * (1 - discountPercent / 100));
        return { price: discounted, wholesaleDiscountPerUnit: wholesalePrice - discounted };
      }
      return { price: wholesalePrice, wholesaleDiscountPerUnit: 0 };
    }
    return { price: product.price, wholesaleDiscountPerUnit: 0 };
  }

  const salePrice = product.salePrice;
  if (salePrice && salePrice > 0 && salePrice < product.price) {
    return { price: salePrice, wholesaleDiscountPerUnit: 0 };
  }

  const sizeDiscount = (product.sizeDiscounts && size && product.sizeDiscounts[size]) || null;
  const effectiveDiscount = sizeDiscount ?? (product.discountPercent || 0);
  if (effectiveDiscount > 0) {
    return {
      price: Math.round(product.price * (1 - effectiveDiscount / 100)),
      wholesaleDiscountPerUnit: 0,
    };
  }

  return { price: product.price, wholesaleDiscountPerUnit: 0 };
}
