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
  /**
   * Персональная скидка/наценка оптового пользователя (в процентах).
   * Положительное = скидка, отрицательное = наценка. 0 = без изменений.
   */
  userWholesaleDiscount?: number;
}

export function resolveItemPrice(
  product: PriceableProduct,
  options: ResolveItemPriceOptions = {},
): ResolvedItemPrice {
  const { isWholesale = false, size = null, userWholesaleDiscount = 0 } = options;

  if (isWholesale) {
    const wholesalePrice = product.wholesalePrice;
    if (wholesalePrice && wholesalePrice > 0) {
      let price = wholesalePrice;

      // Step 1: product-level wholesale discount percent
      const discountPercent = product.wholesaleDiscountPercent;
      if (discountPercent && discountPercent > 0) {
        price = Math.round(price * (1 - discountPercent / 100));
      }

      // Step 2: user-level discount/markup (negative = markup)
      if (userWholesaleDiscount !== 0) {
        price = Math.round(price * (1 - userWholesaleDiscount / 100));
      }

      const wholesaleDiscountPerUnit = wholesalePrice - price;
      return { price, wholesaleDiscountPerUnit };
    }
    // Fallback: no wholesale price → apply user discount to retail
    if (userWholesaleDiscount !== 0) {
      const pr = Math.round(product.price * (1 - userWholesaleDiscount / 100));
      return { price: pr, wholesaleDiscountPerUnit: product.price - pr };
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
