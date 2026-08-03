---
name: Ozon Delivery integration
description: Архитектура, форматы API и баги, найденные при интеграции Ozon Delivery (Seller API OAuth)
---

## Архитектура поиска ПВЗ

`/v1/delivery/point/list` НЕ поддерживает фильтрацию по городу. Возвращает ВСЕ ~92k точек в виде `{ points: [{map_point_id, coordinate: {lat, long}}] }` — только координаты, без адресов.

Правильный алгоритм:
1. Геокодировать название города через DaData → (lat, lng)
2. Загрузить/кешировать (6ч) все 92k точек с координатами
3. Haversine-фильтр, радиус 100 км (авто-расширение до 300 км если < 3 результатов)
4. Взять топ-N ближайших → один батч-запрос `/v1/delivery/point/info` с массивом map_point_ids

## /v1/delivery/point/list

- Параметры игнорируются (`city`, `limit` применяется у нас): возвращает все точки
- Поля каждой точки: `{ map_point_id: number, coordinate: { lat, long } }`
- `coordinate.long` (не `lng`)!
- Начальный TTL кеша: 6 часов

## /v1/delivery/point/info

- Запрос: `{ map_point_ids: number[] }` (массив! не `map_point_id: number`)
- API принимает до 100 ID за раз
- Ответ: `{ points: [{ delivery_method: { address, address_details: {city, street, house, region}, coordinates: {lat, long}, delivery_type: {id, name}, description, work_schedule }, enabled }] }`
- Порядок элементов в ответе соответствует порядку в запросе → map_point_ids[i] = points[i]
- `work_schedule` — массив `[{ date: ISO, periods: [{min: {hours, minutes}, max: {hours, minutes}}] }]` → не строка! Конвертировать в "10:00–22:00" из `periods[0]` первого элемента
- `description` — навигационные инструкции ("из метро Охотный ряд..."), НЕ часы работы

**Why:** эти форматы не задокументированы публично (за Cloudflare), получены эмпирически через debug-логирование.

## OAuth / авторизация

- Токен хранится в YDB (bonus_settings), HMAC-state верифицируется без shared-memory
- Кнопка "Подхватить токены" перезагружает токены из YDB без рестарта сервера
- При 401 — авто-refresh + retry; при неудаче refresh — очищаем токены в YDB

## Хранение выбранного ПВЗ в заказе

- `ozonPvzId` и `ozonPvzAddress` хранятся внутри JSON-поля `cdekData` (отдельная колонка не нужна)
- `offer_id` для Ozon: `item.article || item.sku || String(item.productId)`
