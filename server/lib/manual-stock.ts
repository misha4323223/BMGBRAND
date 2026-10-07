/**
 * Ручные остатки (Вариант B).
 *
 * Товар, у которого остатки ведёт админ, а не 1С. Два источника флага:
 *   1) stockSyncDisabled — явный переключатель «Остатки вручную» в админке;
 *   2) preorderEnabled  — розничный предзаказ. Флаг ставится автоматически, но
 *      проверяем и сам предзаказ: у предзаказных товаров, созданных до появления
 *      колонки, `stock_sync_disabled` пустой, и без этой ветки они остались бы
 *      без защиты до первого сохранения в админке.
 *
 * Для таких товаров 1С НЕ перезаписывает stock / sizeStock / sizes и не
 * переключает видимость, но price, wholesalePrice и sizeCharacteristicIds
 * обновляются как раньше: GUID характеристик нужны для выгрузки заказов в 1С
 * (см. resolveSizeCharacteristicId в routes.ts).
 */
export function isStockSyncDisabled(product: any): boolean {
  if (!product) return false;
  return product.stockSyncDisabled === true || product.preorderEnabled === true;
}

/**
 * Итоговое значение флага при сохранении карточки в админке.
 *
 *   • включили предзаказ  → true (остатки ведём вручную);
 *   • выключили предзаказ → false, синхронизация возвращается (сброс кампании
 *     предзаказа шлёт только preorderEnabled: false);
 *   • поле пришло явно    → выбор админа побеждает, кроме случая с включённым
 *     предзаказом: там предзаказ сильнее галочки;
 *   • поля в запросе нет  → undefined, флаг не трогаем.
 */
export function resolveStockSyncDisabled(
  preorderEnabled: unknown,
  stockSyncDisabled: unknown,
): boolean | undefined {
  const preorderOn = preorderEnabled === true || preorderEnabled === 'true';
  if (preorderOn) return true;
  if (stockSyncDisabled !== undefined) return stockSyncDisabled === true;
  if (preorderEnabled !== undefined) return false;
  return undefined;
}
