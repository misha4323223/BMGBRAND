---
name: ydb-sdk INT64 не принимает BigInt (createProduct писал 0)
description: В INT64-параметрах ydb-sdk передавайте обычный number — bigint кодируется как 0, из-за чего createProduct терял stock и wholesalePrice
---

## Симптом
Товар, созданный через `storage.createProduct()` (админка «Добавить товар», импорт каталога
из 1С), появлялся в YDB с `stock = 0` и `wholesale_price = 0`, хотя значения были переданы
(в том числе `stock`, посчитанный из `sizeStock`). Админка показывала остаток, сайт — «нет в наличии».
Обновление того же товара (`updateProduct({ stock: 9 })`) применялось корректно.

## Причина
`server/storage/products.ts`, `createProduct`: параметры INT64 строились как
`TypedValues.fromNative(Types.INT64, BigInt(value))`. ydb-sdk отдаёт это значение в protobuf
как есть, и bigint кодируется нулём. В `updateProduct` те же колонки пишутся обычным number —
поэтому там всё работало.

**Fix (2026-10-07):** в `createProduct` — `Number((p as any).stock || 0)` и
`Number((p as any).wholesalePrice || 0)` (без `BigInt`).

**How to apply:** в INT64-параметрах YDB использовать `number` (при риске выйти за
2^53 — приводить к строке и кастовать в запросе). Никогда не передавать `BigInt` в
`TypedValues.fromNative` / `TypedValues.primitive`.

## Проверка
`npx tsx scripts/check-stock-columns-live.ts` (боевая YDB, скрытые тестовые товары):
`stock: 42` и `wholesalePrice: 300` доезжают, `stock` из `sizeStock` считается (1+1=2),
`updateProduct({ stock: 9 })` работает.
