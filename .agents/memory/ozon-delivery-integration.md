---
name: Ozon Delivery integration
description: Замена Ozon Pay на Ozon Delivery (логистика Ozon) через Seller API OAuth 2.0
---

## Архитектура

- **server/ozon-delivery.ts** — новый сервис: `checkDelivery`, `createOrder`, `cancelOrder`, `getOrder`. Авторизация через `ozonDeliveryOAuth.getAccessToken()`. Base URL: `https://api-seller.ozon.ru`.
- **server/ozon-delivery-oauth.ts** — OAuth 2.0 (без изменений). Токены хранятся в bonus_settings с ключами из `OZON_OAUTH_KEYS`.
- **server/ozon-pay.ts** — файл оставлен, но не импортируется нигде. `ozonPayService` больше не используется.

## Управление включением

- Флаг `ozon_delivery_enabled` в bonus_settings (string "true"/"false").
- `ozonDeliveryService.isEnabled()` = флаг AND OAuth authenticated AND not expired.
- Загружается при старте сервера в initialization block.
- Меняется через `POST /api/admin/ozon-delivery/settings`.

## Ключевые API-эндпоинты

- `POST /api/ozon-delivery/check` — публичный; phone+items → {available, cost(копейки), error}
- `GET /api/admin/ozon-delivery/settings` — статус + oauth info (admin only)
- `POST /api/admin/ozon-delivery/settings` — включить/выключить (admin only)
- `GET /api/admin/ozon-oauth/authorize` — получить authUrl (admin only)
- `POST /api/admin/ozon-oauth/revoke` — сбросить токены (admin only)
- `POST /api/admin/ozon-delivery/check-order` — статус заказа по ozonOrderId (admin only)

## Чекаут (client/src/pages/Checkout.tsx)

- `ozonDeliveryEnabled` берётся из `/api/payment-methods` (заменил `ozonPayEnabled`)
- Платёжная секция показывается для Ozon delivery (YooKassa/T-Bank — как обычно)
- Ozon delivery guard: `{ozonDeliveryEnabled && ...}` (был `{ozonPayEnabled && ...}`)
- useEffect для Ozon больше не форсирует "ozon-pay" — только auto-fill адреса

## Вебхуки оплаты

После оплаты (YooKassa или T-Bank), если `order.deliveryService === "ozon"` и сервис включён,
вызывается `ozonDeliveryService.createOrder(...)` — **fire-and-forget**, не блокирует ответ вебхука.
Ошибки логируются + отправляется `notifyError("Ozon Доставка", ...)`.

## offer_id для API

`item.article || item.sku || String(item.productId)` — та же формула, что в `/ozon-feed.xml`.

## Формат ответа API Ozon (предположительный)

API-формат `v1/delivery/check` / `v1/delivery/order/create` не подтверждён документацией
(Cloudflare-protected). Сервис написан с fallback: проверяет несколько возможных ключей ответа.

**Why:** Docs были недоступны при реализации — код нужно будет подправить после тестирования реального API.

## Admin UI

- Новый таб "Интеграции" в Admin.tsx (VALID_TABS + кнопка "Store" icon)
- Компонент `OzonDeliveryIntegration` показывает: OAuth status, toggle enable, connect/revoke buttons, инструкция
