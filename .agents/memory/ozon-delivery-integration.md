---
name: Ozon Delivery integration (два контура)
description: Актуальный контур Ozon Доставки на api-delivery.ozon.ru (client_credentials) — ручки, флаги, ключи YDB, проверка получателя, порядок заказа; отдельно старый Seller-контур, который не трогаем
---

# Ozon Доставка: два контура, не путать

| | **Новый (рабочий)** | **Старый Seller** |
|---|---|---|
| API | `api-delivery.ozon.ru` | Seller API |
| Авторизация | `client_credentials` → `https://xapi.ozon.ru/oauth/token` | OAuth (кнопка «Подхватить токены») |
| Код | `server/ozon-delivery-api/*` | `server/ozon-delivery.ts`, `server/ozon-delivery-oauth.ts` |
| Флаг в `bonus_settings` | `ozon_delivery_api_enabled` | `ozon_delivery_enabled` |
| Env | `OZON_DELIVERY_API_CLIENT_ID` / `_SECRET` / `_SCOPES` | `OZON_CLIENT_ID` / `_SECRET` / `OZON_SCOPES` |
| Статус | **работает в проде, живые заказы есть** | выключен, не трогать без команды |

Общий админский UI — `client/src/components/admin/OzonDeliveryIntegration.tsx` (таб «Интеграции»), он умеет оба контура.

# Новый контур (актуальный)

## Ручки Ozon

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/oauth/token` (`xapi.ozon.ru`) | токен, grant `client_credentials` |
| POST | `/v1/delivery-point/list` | справочник ПВЗ (курсорная пагинация, `shipment_method_id`) |
| POST | `/v1/delivery-point/info` | детали ПВЗ батчем (до 100 id) |
| POST | `/v1/delivery/check-client` | есть ли у номера аккаунт Ozon (`can_be_delivered`) |
| POST | `/v1/order/checkout` | расчёт стоимости/сроков (заказ НЕ создаёт) |
| POST | `/v1/order/create` | создание отправления, требует `Idempotency-Key` |

## Токен
- `OZON_DELIVERY_API_SCOPES`: JSON-массив, строка через запятую/пробел или пусто; принимаются только `delivery-api.*`, `seller-api.*` отбрасываются. По умолчанию 8 прав (5 обязательных + 3 опциональных), при `invalid_scope` — фолбэк на обязательные.
- `expires_in` понимается и как абсолютное время (с/мс), и как длительность. Параллельные запросы не плодят токены (single-flight).
- Хранение: `bonus_settings` → `ozon_delivery_api_token`. Внутри: access token, зашифрованный **AES-256-GCM** (ключ выводится из `JWT_SECRET`), `expiresAt`, `obtainedAt`, `scopes`, SHA-256 отпечаток Client ID. Сырые Client ID/Secret и открытый токен в БД не пишутся.
- На старте `restoreFromStorage()`: валидный токен подхватывается без запроса, чужой Client ID и истёкший — стираются, ошибка YDB старт не блокирует.
- 401 от API → принудительный refresh + один повтор запроса (с тем же `Idempotency-Key`).

## HTTP-транспорт (`http.ts`)
- База `https://api-delivery.ozon.ru`, таймаут 10 с (`DEFAULT_TIMEOUT_MS`), ретрай сетевых ошибок/429/5xx (число попыток — `DEFAULT_ATTEMPTS`), до 5 редиректов (`DEFAULT_MAX_REDIRECTS`).
- Ozon отвечает 307 с `Domain=.ozon.ru` cookie (`testcookie`): нужен **один домен-aware cookie-jar на всю цепочку** и проход по редиректам. Host-only jar (как было сначала) приводил к бесконечному циклу редиректов на `delivery-point/list`.
- `Authorization` и `Idempotency-Key` НИКОГДА не уходят на не-Ozon хост; тело токен-запроса туда тоже не пересылается.
- `x-o3-trace-id` сохраняется в результат и в ошибки — по нему ищется запрос в кабинете Ozon.

## ПВЗ
- Таблица `ozon_delivery_points` создаётся через YDB SDK `createTable` (DDL обычным запросом запрещён), индекс `idx_ozon_delivery_points_city`.
- Состояние синхронизации — `bonus_settings` → `ozon_delivery_points_sync` (`completedAt`, `hasMore`, курсор).
- Полная синхронизация — `POST /api/admin/ozon-delivery-api/points/sync`; неактивные точки чистятся, `last_seen_run` обновляется.
- `shipment_method_id` приходит из `delivery-point/list`. Если у ПВЗ его нет, расчёт вернёт код `no_shipment_method` с просьбой создать метод доставки в кабинете Ozon и повторить синхронизацию.

## Проверка получателя (`checkClient`)
- Ozon Доставка принимает только получателей с аккаунтом Ozon, поэтому номер проверяется **до расчёта и до платежа**.
- `success:true, canBeDelivered:true` — можно везти; `success:true, canBeDelivered:false, code:"not_registered"` — аккаунта нет; `success:false, code:"api_error"` — Ozon не ответил/отказал; `invalid_phone` — номер не нормализовался, сеть не дёргается.
- Вызовы: публичный `POST /api/ozon-delivery/check` (коды `ozon_phone_check_failed` / `ozon_account_required`) и создание заказа в `server/routes.ts` перед платежом (HTTP 400 `OZON_PHONE_CHECK_FAILED` / `OZON_ACCOUNT_REQUIRED`).
- **Кэша нет**: проверка идёт на каждый пересчёт стоимости и повторно при создании заказа. Это лишние запросы в чекауте, но гарантирует, что деньги не спишут за недоставимый заказ.

## Расчёт (`/v1/order/checkout`)
- Габариты по умолчанию: 500 г на товар, минимум 500 г на посылку, коробка 300×250×50 мм (`OZON_QUOTE_ITEM_WEIGHT_G`, `OZON_QUOTE_MIN_WEIGHT_G`, `OZON_QUOTE_DEFAULT_BOX` в `quote.ts`). Это эвристика: если реальная посылка больше, Ozon пересчитает при создании и итог разойдётся с показанным.
- Лимиты: ≤ 100 позиций (`OZON_QUOTE_MAX_ITEM_COUNT`), объявленная стоимость ≤ 500 000 ₽ (`OZON_ORDER_MAX_DECLARED_VALUE_KOPEKS`), cutoff 2 ч.
- Ответ: `estimated_delivery_cost`, `estimated_insurance_cost`, `estimated_delivery_days`, `cutoff_at`. Деньги — в копейках.
- Телефон нормализуется `normalizeOzonPhone` (8/7 → `+7…`).

## Заказ
- Порядок: quote → `POST /v1/order/create`. Ответ отдаёт `posting_number` и (если пришёл) `posting_external_id`.
- `Idempotency-Key` для заказа магазина детерминирован: `buildOzonOrderIdempotencyKey(orderId)` = sha256 от `ozon-delivery-order:<id>` → UUID (`paid-order.ts`). Повтор вебхука ЮKassa/Т-Банка или ретрай после таймаута использует тот же ключ и НЕ создаёт второе отправление.
- Неоднозначный результат (таймаут/сеть/5xx) возвращается как `mayHaveBeenCreated`: повторять можно **только с тем же ключом**, новый ключ = риск дубля.
- Создание после оплаты: `paid-order.ts`, ПВЗ и метод доставки берутся из `orders.cdek_data` (`ozonPvzId`, `ozonShipmentMethodId`).

## Публичный чекаут
- Включается флагом `bonus_settings/ozon_delivery_api_enabled` и показывается только если ОДНОВРЕМЕННО: заданы ключи (`getStatus().configured`), флаг = `"true"`, синхронизация ПВЗ завершена (`completedAt` && `hasMore === false`). Логика — `isOzonDeliveryApiPublicEnabled()` в `server/ozon-delivery-api/public.ts`; ошибка чтения чего-либо = `false` (лучше не показать, чем показать сломанное).
- `GET /api/payment-methods` отдаёт `ozonDeliveryEnabled` — по нему `Checkout.tsx` решает, показывать ли способ.
- Публичные ручки (без авторизации, но под тем же флагом): `POST /api/ozon-delivery/points`, `/map-points`, `/point-detail`, `/check`.
- ⚠️ Поведение при сбое: на `api_error` ручка отдаёт `available:false`, `ozonDeliveryCost` остаётся `null`, кнопка оформления блокируется (в UI — красная строка). Автофолбэка на СДЭК нет. Решение осознанное: не брать оплату за недоставимый заказ.

## Админка и диагностика
- `GET/POST /api/admin/ozon-delivery-api/settings`, `POST .../check`, `POST .../points/sync`, `POST .../quote`, `POST .../order/create` — все под `authMiddleware` + `requireAdminRole`.
- Диагностика по админ-ключу: `POST /api/admin/diagnostics/ozon-delivery/check` (цепочка редиректов, cookie, trace), `POST /api/admin/diagnostics/ozon-delivery/points-sync` (одна страница ПВЗ end-to-end + запись в YDB, без полного каталога).
- Статус подключения отдаёт маскированный Client ID, срок токена и список прав; токен и секрет наружу не отдаются.

## Живой статус
- Контур работает в проде: покупатели выбирают ПВЗ, стоимость считает Ozon, после оплаты создаётся отправление. Реальные заказы через него оформлялись (подтверждено владельцем 10.11.2026).
- Журнал этапов и чек-лист — `docs/OZON-DELIVERY-API-STAGES.md`.
- Отдельным прогоном НЕ фиксировались: повтор с тем же `Idempotency-Key`, поведение при недоступном Ozon после оплаты, очистка неактивных ПВЗ.

# Старый Seller-контур (выключен, не трогать)

Сохранён на случай возврата и для истории; включается флагом `ozon_delivery_enabled`, работает через OAuth.

- `/v1/delivery/point/list` в нём НЕ фильтрует по городу и отдаёт ~92k точек только с координатами (`coordinate.long`, не `lng`). Поиск ПВЗ по городу: геокодинг города (DaData) → haversine-фильтр по закэшированным координатам (радиус 100 км, авто-расширение до 300 км) → топ-N в один батч `/v1/delivery/point/info`.
- `/v1/delivery/point/info` принимает до 100 id массивом, порядок ответа = порядок запроса, `work_schedule` — массив объектов (не строка), `description` — навигация, а не часы работы.
- Порядок заказа: `/v1/delivery/check` (или `/v2/delivery/check`) → `/v2/delivery/checkout` (сроки, НЕ создаёт заказ) → `/v2/order/create`.
- В этом контуре нет эндпоинта расчёта стоимости — стоимость задаётся фиксированно админкой или по порогу суммы.
- Поле телефона в старом `/v1/delivery/check` — `client_phone` (не `customer_phone`), см. `ozon-delivery-check-field.md`.
