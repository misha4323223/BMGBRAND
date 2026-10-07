---
name: Ручные остатки товара (stockSyncDisabled)
description: Флаг «Остатки вручную» — 1С не перезаписывает stock/sizeStock/sizes и не управляет видимостью товара; предзаказ включает флаг автоматически
---

## Правило
Товар считается «ручным», если `stockSyncDisabled === true` ИЛИ `preorderEnabled === true`
(`isStockSyncDisabled()` в `server/lib/manual-stock.ts`).

**Why:** владелец ведёт остатки части товаров вручную (в том числе мерч и предзаказы).
До этого 1С на каждом обмене перезаписывала `stock` / `sizeStock` / `sizes` и скрывала
товар при нулевом остатке в выгрузке — ручные правки затирались.

**How to apply:** любая НОВАЯ точка записи остатков из 1С должна проверять
`isStockSyncDisabled(product)` перед записью `stock` / `sizeStock` / `sizes` / `isHidden`.
Цена (`price`, `wholesalePrice`) и `sizeCharacteristicIds` синхронизируются КАК РАНЬШЕ —
GUID характеристик нужны для выгрузки заказов в 1С.

## Что покрыто (2026-10-07)
- `server/routes.ts` `updateProductSizesFromOffers()` — `continue` на ручном товаре.
- `server/routes.ts` `updateProductPricesFromOffers()` — не пишет `stock`/`sizeStock`,
  не скрывает/показывает товар и НЕ шлёт уведомления о появлении размера.
- `server/routes.ts` bulk-обновление размеров («Обновить размеры из 1С»).
- `POST /api/sync/products` — обе ветки (`items`, `updates`) применяют патч без `sizes`.
- `server/routes/admin-products.ts` — приём `stockSyncDisabled` в PATCH, автопостановка
  при включении предзаказа; при создании товара флаг доставляется отдельным
  `updateProduct` (createProduct пишет фиксированный набор колонок).
- `client/src/pages/Admin.tsx` — переключатель «Остатки вручную (не брать из 1С)»
  рядом с тумблером предзаказа (галочка заблокирована и включена, пока предзаказ включён).

## Колонка БД
`products.stock_sync_disabled Bool` — создаётся лениво и идемпотентно при старте:
`storage.addStockSyncDisabledColumn()` вызывается из `server/index.ts` при warmup.
Чтение — `parseProduct` в `server/storage/core.ts`, запись — `updateProduct`
в `server/storage/products.ts`. Явного endpoint'а миграции нет (не нужен: ALTER
идемпотентен, повторный вызов гасится «already exists»).

## Границы (сознательно не покрыто)
Импорт номенклатуры (goods.xml: `POST /api/sync-from-storage`, `[1C IMPORT]`) по-прежнему
пишет `sizes` из названия товара — это каталог, а не остатки. Если понадобится — там те же
`updateData.sizes` (7 мест в routes.ts).

## Проверка
- Юнит: `server/__tests__/manual-stock.test.ts` — контракт флага и связка с предзаказом.
- Живые прогоны на боевой YDB (нужны прод-переменные; каждый создаёт СКРЫТЫЕ тестовые
  товары и удаляет их в finally, есть обработчик SIGTERM):
  - `npx tsx scripts/check-manual-stock-live.ts` — обе прямые выгрузки 1С
    (`POST /api/sync/products`, `POST /api/sync/inventory`) через работающий стенд.
  - `npx tsx scripts/check-offers-live.ts` — пайплайн offers.xml
    (`updateProductPricesFromOffers` / `updateProductSizesFromOffers`): временная копия
    `server/routes.__live_harness.ts` с ранним return в 4 фоновых задачах и без импорта
    `./ycp` (прогрев ПВЗ СДЭК стартует на импорте), плюс экспорт двух функций.
  - `npx tsx scripts/check-stock-columns-live.ts` — запись INT64-полей при создании товара.
  Логи: `[Stock SKIP]`, `[Sizes] SKIP`, `[UpdateSizes] SKIP`, `[Migration] stock_sync_disabled`.

## Результат живой проверки (2026-10-07, боевая YDB, 1202 товара)
- Колонка `stock_sync_disabled` создалась на старте; флаг читается как boolean, у продовых
  товаров он `false` (0 из 1202 помечено вручную, 14 предзаказов защищены веткой предзаказа).
- `check-manual-stock-live.ts` — 17/17: ручной товар не принимает `sizes` из 1С
  (`/api/sync/products`, `/api/sync/inventory`), но принимает прочие поля; контрольный
  товар принимает всё; предзаказный защищён без колонки.
- `check-offers-live.ts` — 16/16: в пайплайне offers.xml ручной/предзаказный товар
  получает только цену и GUID характеристик, остатки/размеры и видимость — нет;
  контрольный товар обновляется как раньше.
- Побочная находка: `createProduct` терял `stock` и `wholesalePrice` (писалась 0) —
  см. `ydb-int64-bigint.md`, там же фикс и его живая проверка.
