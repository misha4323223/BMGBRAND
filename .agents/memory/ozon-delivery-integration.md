---
name: Ozon Delivery integration
description: Замена Ozon Pay на Ozon Delivery (логистика Ozon) через Seller API OAuth 2.0 с выбором ПВЗ до оплаты
---

## Архитектура

- **server/ozon-delivery.ts** — сервис: `getPvzList`, `checkDelivery`, `createOrder` (→ `/v2/delivery/checkout`), `cancelOrder`, `getOrder`. Авторизация через Bearer token от `ozonDeliveryOAuth.getAccessToken()`.
- **server/ozon-delivery-oauth.ts** — OAuth 2.0 Authorization Code flow. Токены в bonus_settings. Auth URL: `seller.ozon.ru/app/appstore/oauth/authorize`. Token URL: `xapi.ozon.ru/oauth/token`.
- Base URL API: `https://api-seller.ozon.ru`

## Ключевые Ozon API endpoints

- `POST /v1/delivery/point/list` — список ПВЗ по городу. Params: `{ city, limit }`.
- `POST /v1/delivery/check` — проверка доступности по телефону.
- `POST /v2/delivery/checkout` — создание заказа с `pvz_id`. Заменяет `/v1/delivery/order/create`.

**Why:** Ответы API не подтверждены — код с fallback по нескольким ключам ответа.

## PVZ-picker flow (чекаут)

1. Покупатель выбирает "Доставка до ПВЗ Ozon"
2. Вводит город → debounced fetch `POST /api/ozon-delivery/points` → список ПВЗ
3. Выбирает ПВЗ → адрес поля формы заполняется автоматически
4. Платит через ЮКассу или Т-Банк
5. После оплаты вебхук вызывает `createOrder` с `pvzId` — fire-and-forget

`ozonPvzId` и `ozonPvzAddress` хранятся в `cdekData` JSON (поле orders.cdek_data в YDB).

## Управление включением

- Флаг `ozon_delivery_enabled` в bonus_settings.
- `isEnabled()` = флаг AND OAuth authenticated AND not expired.
- OAuth токены: ключи `OZON_OAUTH_KEYS.accessToken/refreshToken/expiresAt` в bonus_settings.
- При старте сервера: init OAuth → загрузить токены из YDB → установить флаг.

## Сервер endpoints

- `POST /api/ozon-delivery/points` — публичный, список ПВЗ по городу
- `POST /api/ozon-delivery/check` — публичный, проверка доступности
- `GET /api/admin/ozon-delivery/settings` — статус (configured, enabled, serviceReady, oauthStatus)
- `POST /api/admin/ozon-delivery/settings` — включить/выключить
- `GET /api/admin/ozon-oauth/authorize` — authUrl для открытия в браузере
- `GET /api/ozon/oauth/callback` — OAuth callback (redirect_uri = https://booomerangs.ru/api/ozon/oauth/callback)
- `POST /api/admin/ozon-oauth/revoke` — сбросить токены + отключить

## Admin UI (Интеграции таб)

Компонент `OzonDeliveryIntegration`: OAuth status grid (configured + token), connect/revoke кнопки, enable toggle (только если isConnected), инструкция с redirect URI.

## Checkout state

- `ozonPvz: { id, name, address, city, workingHours } | null`
- `ozonCitySearch: string` — ввод города
- `ozonPvzList: any[]` — результаты
- Submit guard: если ozon и !ozonPvz → toast и return
