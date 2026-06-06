# BMGBRAND (Booomerangs) Project Summary

## Как запустить проект в Replit

### Workflow (автозапуск)
Проект запускается через workflow **"Start application"** командой:
```
NODE_ENV=development npx tsx server/index.ts
```

### Почему `npx tsx`, а не `node_modules/.bin/tsx`
В `package.json` скрипт `dev` прописан как `node_modules/.bin/tsx server/index.ts` — прямой вызов бинарника. В Replit этот путь **не добавляется в `$PATH` автоматически**, поэтому при запуске через workflow система не находит `tsx` и падает с ошибкой `sh: 1: node_modules/.bin/tsx: not found`.

**Решение:** использовать `npx tsx` — `npx` всегда ищет бинарники сначала в `node_modules/.bin/` текущего проекта, поэтому находит `tsx` корректно независимо от `$PATH`.

### Что происходит при старте
1. Подключается YDB (Yandex Database Serverless) через IAM-ключ из секрета `YDB_SA_KEY`
2. Применяются миграции схемы (если нужны)
3. Прогревается кэш: загружаются все продукты (~1181 шт.), настройки страниц, рейтинги
4. Загружается кэш городов CDEK (~54 000 городов)
5. Сервер начинает слушать на порту 5000

Полный запуск занимает около **5–7 секунд**.

### Команды
| Команда | Назначение |
|---|---|
| `npx tsx server/index.ts` | Dev-сервер (Vite + Express на порту 5000) |
| `npm run build` | Сборка фронтенда в `dist/` |
| `npm run db:push` | Применить миграции схемы к PostgreSQL |

### Важно
- Все секреты (YDB, платёжные шлюзы, SMTP, Telegram) хранятся в **Replit Secrets** — не в коде
- В dev-режиме фронтенд раздаётся через Vite (HMR); в production — через `serveStatic()` из `dist/`
- Изображения хранятся в **Yandex Object Storage** — в preview Replit они могут не отображаться (CORS/CDN), это нормально

### package.json — overrides для CVE-уязвимостей

Replit блокирует установку пакетов с известными CVE. В `package.json` добавлены `overrides` — принудительное обновление транзитивных зависимостей `ydb-sdk`:

```json
"overrides": {
  "form-data": "^4.0.0",
  "protobufjs": "^7.6.2",
  "fast-xml-parser": "^5.8.0"
}
```

| Пакет | Было | Стало | Причина |
|---|---|---|---|
| `form-data` | 2.3.3 | ^4.0.0 | CVE критическая, заблокирован Replit |
| `protobufjs` | 7.5.4 | ^7.6.2 | Уязвимость, заблокирован Replit |
| `fast-xml-parser` | 5.3.3 | ^5.8.0 | Заблокирован Replit |

На продакшен не влияет — те же мажорные версии, обратно совместимы. GitHub Actions при сборке Docker тоже получает эти версии (это хорошо — старые версии с CVE в продакшене нежелательны).

**YDB dev vs продакшен** определяется в `server/db.ts`:
```ts
const isCloud = process.env.NODE_ENV === "production" || !!process.env.YDB_SA_KEY;
```
- Replit dev: `NODE_ENV=development`, `YDB_SA_KEY` не задан → YDB не инициализируется, используется in-memory
- Yandex Cloud: `NODE_ENV=production` или задан `YDB_SA_KEY` → YDB через IamAuthService

---

## Overview

BMGBRAND (Booomerangs) is a comprehensive e-commerce platform for a Russian streetwear brand. It features a product catalog, shopping cart, order processing, various payment and delivery options, a personal user account, a wholesale module, gift certificates, a blog, job postings, artist pages, and a full-fledged CMS for administration. The project aims to be a leading online retail destination in the Russian streetwear market.

## User Preferences

The language of communication with the user is Russian. Always think and write in Russian.

## System Architecture

**Frontend:**
Developed with React 18, Vite, TypeScript, Tailwind CSS, and Shadcn UI (based on Radix UI). It utilizes TanStack Query v5 for data fetching, Wouter for routing, Framer Motion for animations, Recharts for admin dashboards, and React Helmet Async for SEO management.

**Backend:**
Built on Node.js 20 with Express 4 and TypeScript. Drizzle ORM is used for database interactions, complemented by Drizzle Zod for validation. Passport.js (local strategy) handles authentication with session management via `express-session` and `connect-pg-simple`.

**Database:**
- **Yandex Database (YDB Serverless):** Primary production database, serving as a document store for core entities like users, products, orders, gift cards, and reviews.
- **PostgreSQL (Replit-hosted):** Used as a relational database for development environments and session storage.

**File Storage:**
Yandex Object Storage (S3-compatible) is integrated via the AWS SDK. Sharp is used for on-the-fly generation of WebP image previews (800px, 100% quality).

**Deployment (Production):**
The application is deployed on Yandex Cloud, leveraging:
- **Yandex Serverless Containers:** Main hosting for the application (Docker container based on `node:20-slim`).
- **Yandex Container Registry:** For storing Docker images.
- **Yandex Database (YDB Serverless):** Production database.
- **Yandex Object Storage (S3):** For storing images, XML logs, and 1C files.
- **Yandex Certificate Manager:** Manages SSL/TLS certificates for the domain.
- **Yandex API Gateway:** Routes incoming requests to the container.
- **Yandex Postbox:** Email sending service (SMTP).

**Key Features:**

- **Product Catalog:** Comprehensive product listings with categories, subcategories, sizes, colors, advanced filtering, and search. Supports multi-category product assignment and SEO-friendly slug-based URLs with 301 redirects for legacy paths.
- **Cart & Checkout:** Multi-step checkout process with real-time delivery cost calculation.
- **Payment Systems:** Integration with YooKassa, T-Bank (Tinkoff), and Ozon Pay Acquiring, featuring webhook-based payment confirmation. Ozon Pay uniquely combines payment and delivery point selection.
- **Delivery:** CDEK API (courier, pickup points) and Yandex Delivery NDD (pickup points).
- **1C Synchronization:** Automated import of products, prices, and inventory via CommerceML (XML). Includes category mapping and automatic creation of subcategories.
- **Wholesale Module:** Dedicated registration for wholesale buyers, admin approval, custom discounts, and saved delivery data.
- **Gift Certificates:** Unique format, configurable denominations, and email delivery.
- **Loyalty System:** Multi-tier discounts based on purchase history and promotional codes.
- **User Account:** Order history, favorites, profile management, and order tracking.
- **CMS (Admin Panel):** Extensive management capabilities for products, orders, categories, static content (home, navbar, footer, FAQ, about us, privacy policy), blog, vacancies, artists, SEO, promo codes, badges, and banners.
- **Blog & Artist Pages:** Full-featured blog with SEO capabilities. Artist pages offer configurable content blocks.
- **Inventory Control:** Server-side stock validation during cart additions and checkout, with "X items left" badges.
- **SEO:** Comprehensive meta-tags, Open Graph, JSON-LD, `robots.txt`, `sitemap.xml`, and canonical URLs.
- **Notifications:** Telegram bot for orders and wholesale alerts, email notifications for order confirmations, gift certificates, and stock availability.
- **Partner Program:** A multi-tiered partner program enabling individuals (self-employed, individual entrepreneurs, legal entities) to earn commissions by promoting products. Features include a partner registration wizard with legal document signing (Simple Electronic Signature, 63-FZ PЭП), a personalized dashboard with sales statistics, unique referral links and QR codes, a dedicated product selection tool, and a robust payout management system with hold periods and audit trails. It supports custom promotional codes for partner attribution and provides an admin panel for comprehensive partner and commission management.

**Performance Optimizations:**
- **In-memory caching** for frequently accessed API endpoints (`/api/subscription-promos`) to reduce database load.
- **Early exit for bot traffic** (`HTTP 410 Gone`) for old/invalid URLs to save CPU and backend resources.
- **Lazy loading of product variants** in catalog views to reduce initial API requests.
- **Cache-first strategy** for `getProduct(id)` to reduce direct YDB calls during background cache refreshes.
- **Robust YDB error handling** with extended network error detection and reconnection logic, preventing Express crashes and ensuring service stability.
- **Atomic YDB transactions** for partner registration and payout processing to ensure data consistency and prevent partial data writes.
- **IP spoofing protection** by trusting only one proxy hop (`app.set('trust proxy', 1)`) and recording both X-Forwarded-For and socket remote IP for legal audit trails.
- **GeoIP lookup** during partner registration to record country, region, and city for legal dispute resolution.
- **In-memory mutexes** for critical operations like document uploads and payout creation to prevent race conditions in single-instance deployments.

## External Dependencies

- **Yandex Cloud Services:**
    - Yandex Database (YDB)
    - Yandex Object Storage (S3)
    - Yandex Serverless Containers
    - Yandex Container Registry
    - Yandex API Gateway
    - Yandex Certificate Manager
    - Yandex Postbox (SMTP)
    - Yandex Delivery (NDD)
- **Payment Gateways:**
    - YooKassa
    - T-Bank (Tinkoff)
    - Ozon Pay Acquiring
- **Delivery Services:**
    - CDEK API
    - Yandex Delivery
- **Enterprise Integrations:**
    - 1C (CommerceML for product synchronization)
    - Bitrix24 (CRM)
- **Communication:**
    - Telegram Bot API
- **Development & Local:**
    - PostgreSQL (for development and sessions)
- **Other APIs:**
    - ip-api.com (for GeoIP lookup)

## Changelog

### Партнёрская программа — расширение для блогеров и смена URL артистов (май 2026)

**Что изменилось:**

1. **Регистрация партнёра** (`client/src/pages/PartnerRegister.tsx`): чекбокс и секция «Специально для артистов и блогеров» — формулировки обновлены, URL в описании изменён на `/@ваш-slug`.

2. **ЛК партнёра** (`client/src/pages/partner/ArtistTab.tsx`): ссылка на публичную страницу теперь отображается как `/@slug` вместо `/artist/slug`.

3. **Смена публичного URL страниц**: `/artist/:slug` → `/@:slug` во всём проекте.

**Технические детали реализации `/@slug`:**
- Библиотека `regexparam` (используется Wouter) не поддерживает `@` перед именованным параметром — `/@:slug` не парсится как роут с параметром.
- Решение: роут `/:slug` в `App.tsx` проверяет `slug.startsWith('@')` и рендерит `ArtistPage` вместо `SlugResolver`. В `ArtistPage.tsx` слаг очищается от `@` через `.replace(/^@/, '')`.
- 301-редирект `/artist/:slug` → `/@:slug` добавлен в `server/routes.ts` для обратной совместимости (SEO, существующие ссылки).

**Файлы изменены:**
- `server/routes.ts` — 301-редирект + sitemap URL
- `server/static.ts` — knownPrefixes, SEO regex, canonical/JSON-LD
- `server/admin-partner-routes.ts` — link-поле при добавлении артиста на главную
- `client/src/App.tsx` — роутинг `/@slug`
- `client/src/pages/Home.tsx` — ссылки на страницы артистов
- `client/src/pages/partner/ArtistTab.tsx` — отображение ссылки в ЛК
- `client/src/pages/PartnerRegister.tsx` — текст описания
- `client/src/pages/Admin.tsx` — отображение в админке
- `client/src/pages/ArtistPage.tsx` — стрипинг `@` из slug

---

### Email-уведомления для оптовиков и партнёров + фикс isArtist (май 2026)

**Что изменилось:**

1. **Email при одобрении/отказе оптовика** (`server/email.ts`, `server/auth-routes.ts`):
   - Добавлены 2 новых HTML-шаблона: `getWholesaleApprovedEmailHtml(name)` и `getWholesaleRejectedEmailHtml(name)`.
   - Письма отправляются при одобрении/отказе через админку и через Telegram-бота (все 4 точки).
   - Ссылка в кнопке «Войти в кабинет»: `booomerangs.ru/wholesale/register?mode=login`.
   - Скидка в письме не упоминается — убрана по требованию.

2. **Email при одобрении/отказе партнёра** (`server/email.ts`, `server/admin-partner-routes.ts`):
   - Добавлены 2 новых HTML-шаблона: `getPartnerApprovedEmailHtml(contactName, partnerSlug)` и `getPartnerRejectedEmailHtml(contactName)`.
   - Письма отправляются в `PATCH /api/admin/partners/:id/status` при смене статуса.
   - Письмо об одобрении содержит ссылки на `/@slug` и `/partner`.

3. **Баг: чекбокс «Я артист/блогер» не сохранялся** (`shared/schema.ts`, `server/auth-routes.ts`):
   - **Причина:** поле `isArtist` отсутствовало в Zod-схеме `partnerCommonFields` → Zod вырезал его при парсинге. Дополнительно, поле не включалось в объект `payload` pending-записи в YDB.
   - **Исправление:**
     - В `shared/schema.ts` добавлено `isArtist: z.boolean().optional().default(false)` в `partnerCommonFields`.
     - В `server/auth-routes.ts` (маршрут `POST /api/auth/partner/register`) в объект `payload` добавлено `isArtist: Boolean((data as any).isArtist)`.
   - **Результат:** после подтверждения email партнёр создаётся с корректным `isArtist = true`, и раздел «Персональная страница» появляется в ЛК.

**Файлы изменены:**
- `server/email.ts` — 4 новых шаблона (wholesale approved/rejected, partner approved/rejected)
- `server/auth-routes.ts` — sendEmail в 4 точках одобрения/отказа оптовиков + `isArtist` в payload
- `server/admin-partner-routes.ts` — sendEmail в PATCH `/partners/:id/status`
- `shared/schema.ts` — `isArtist` добавлен в `partnerCommonFields`

---

### Ozon Delivery OAuth 2.0 + включение Ozon Pay на чекауте (май 2026)

**Что изменилось:**

1. **Новый OAuth-сервис для Ozon Delivery** (`server/ozon-delivery-oauth.ts`):
   - Реализован OAuth 2.0 Authorization Code flow для подключения Ozon Seller API через частное приложение dev.ozon.ru (приложение «Ozon Доставка BMGBRAND-6603»).
   - Авторизационный URL: `https://seller.ozon.ru/app/appstore/oauth/authorize` с параметрами `response_type=code`, `access_type=offline`.
   - Токенный эндпоинт: `https://xapi.ozon.ru/oauth/token`.
   - `redirect_uri`: `https://booomerangs.ru/api/ozon/oauth/callback` (уже прописан в настройках приложения dev.ozon.ru).
   - CSRF-защита через `state`-параметр (in-memory, TTL 15 минут).
   - Автоматическое обновление токена (`refresh_token`) — через `setTimeout` за 5 минут до истечения.
   - Персистентность: токены сохраняются в таблице `bonus_settings` (YDB) по ключам `ozon_oauth_access_token`, `ozon_oauth_refresh_token`, `ozon_oauth_expires_at` и загружаются при старте сервера.

2. **Новые API-маршруты** (`server/routes.ts`):
   - `GET /api/admin/ozon-oauth/status` — статус OAuth (настроен/авторизован/истёк), только для админа.
   - `GET /api/admin/ozon-oauth/authorize` — генерирует URL авторизации, только для админа. Администратор копирует `authUrl` и открывает его в браузере.
   - `POST /api/admin/ozon-oauth/revoke` — сброс токенов (отключение), только для админа.
   - `GET /api/ozon/oauth/callback` — публичный callback, вызывается Ozon после успешной авторизации. Обменивает `code` на токены, сохраняет в БД, редиректит на `/admin?ozon_oauth=success`.

3. **Ozon Pay включён на странице оформления заказа** (`client/src/pages/Checkout.tsx`):
   - Убран `{false && ...}`, скрывавший блок Ozon Pay.
   - Убран бейдж «временно не работает».
   - Ozon Pay теперь отображается, если `ozonPayEnabled === true` (т.е. когда заданы `OZON_PAY_ACCESS_KEY`, `OZON_PAY_SECRET_KEY`, `OZON_PAY_NOTIFICATION_SECRET`).

**Необходимые переменные окружения:**
- `OZON_CLIENT_ID` — UUID клиента приложения из dev.ozon.ru
- `OZON_CLIENT_SECRET` — секрет клиента из dev.ozon.ru

**Процесс первоначальной авторизации:**
1. Добавить `OZON_CLIENT_ID` и `OZON_CLIENT_SECRET` в переменные окружения.
2. Вызвать `GET /api/admin/ozon-oauth/authorize` (залогиниться как admin).
3. Открыть возвращённый `authUrl` в браузере.
4. Авторизоваться в Ozon и подтвердить доступ.
5. Ozon перенаправит на `/api/ozon/oauth/callback` — токены сохранятся автоматически.

**Необходимые переменные окружения (Yandex Cloud Container):**
- `OZON_CLIENT_ID` — UUID из dev.ozon.ru ✅ добавлено
- `OZON_CLIENT_SECRET` — секрет из dev.ozon.ru ✅ добавлено
- `OZON_SCOPES` — `seller-api.ozon-logistics seller-api.posting-fbs seller-api.product seller-api.report` ✅ добавлено

**Статус авторизации (май 2026):**
✅ OAuth-авторизация **пройдена** — токены получены и сохранены в YDB (`bonus_settings`).
Токены загружаются при каждом старте контейнера автоматически.

**Фикс бага TimeoutOverflowWarning:**
Ozon возвращает `expires_in` ~1 год. `setTimeout` в Node.js не поддерживает задержки > 2^31-1 мс (~24.8 дней) — вызывало бесконечную цепочку refresh-запросов. Исправлено: задержка ограничена 23 часами, при каждом срабатывании перепланируется снова.

**Файлы изменены:**
- `server/ozon-delivery-oauth.ts` — новый OAuth-сервис (создан) + фикс TimeoutOverflow
- `server/routes.ts` — импорт + инициализация + 4 новых маршрута
- `client/src/pages/Checkout.tsx` — Ozon Pay теперь виден, бейдж «тестовый режим»

---

### Исследование и фиксы Ozon Pay + доставка (май 2026)

**Что тестировалось и выяснено:**

В ходе тестирования в Replit dev (запросы идут к реальному Ozon Pay API):

**Ошибка 1 — стоимость заказа не совпадает с суммой позиций** → ИСПРАВЛЕНО ранее (`server/ozon-pay.ts`: пропорциональное распределение скидки между позициями).

**Ошибка 2 — "ошибка в количестве товаров" при `withDelivery: true`:**
- Воспроизводится стабильно при `deliverySettings: { isEnabled: true }` в запросе к Ozon Pay
- **Причина (выяснена точно):** `withDelivery: true` в Ozon Pay — это режим для **Ozon Marketplace (FBO/FBS)**. Когда доставка включена, Ozon проверяет поле `sku` в позициях заказа по своему каталогу маркетплейса. Наши SKU — это внутренние YDB timestamp-ID, не Ozon item_id → Ozon не может подтвердить наличие товара → ошибка.
- Подтверждено даже для носков (которые есть на Ozon): наш `sku: 1772457335397` ≠ Ozon item_id носков.
- Убирание `enableFiscalization: true` не помогает — ошибка остаётся.
- **Текущее решение:** `withDelivery: false` — Ozon Pay работает как обычный платёжный шлюз. ✅ Протестировано, платёжная ссылка создаётся успешно.

**Статус бейджа "тестовый режим" на странице Ozon:**
- Это статус мерчант-аккаунта в ЛК Ozon Pay (не наш код). Нужно активировать боевой режим в Ozon Pay Seller Cabinet. Наш бейдж из Checkout.tsx убран.

**Что нужно для `withDelivery: true` (Ozon Pay + доставка до ПВЗ):**
1. Зарегистрировать товары на Ozon Marketplace (схема FBS)
2. После модерации получить Ozon item_id для каждого товара
3. Сохранить Ozon item_id в БД (добавить поле `ozonItemId` к продуктам)
4. При создании заказа передавать `sku: ozonItemId` вместо нашего внутреннего ID

**Ozon Feed для загрузки товаров:**
- Создан отдельный эндпоинт `/ozon-feed.xml` (Яндексовый `/yml-feed.xml` не тронут)
- Включает: категории под Ozon, обязательные атрибуты (Пол, Сезон, Состав, Размер, Цвет, Бренд), вес и габариты
- Состав ткани — дефолт `Хлопок 80%, Полиэстер 20%` (для носков берётся из описания в БД)
- ID категорий (100-300) — примерные, нужно сверить с реальным деревом категорий Ozon в ЛК продавца

**Файлы изменены в этой сессии:**
- `server/ozon-pay.ts` — убран `enableFiscalization: true` при delivery mode
- `server/routes.ts` — `withDelivery: false` (текущий рабочий режим), новый эндпоинт `/ozon-feed.xml`
- `client/src/pages/Checkout.tsx` — убран бейдж «тестовый режим» (он был на нашей стороне)
- `client/src/pages/wholesale/FeedTab.tsx` — товары без оптовой цены скрыты в ЛК оптовика

---

### Скрытие комиссий в ЛК партнёра (май 2026)

**Что реализовано:**

Партнёр может скрыть любую комиссию из своего списка (корзина-иконка). Запись остаётся в БД — админ видит всё. Скрытые ID хранятся в `bonus_settings` по ключу `partner_hidden_commissions_{partnerId}`.

**Серверная часть:**

1. **`POST /api/partner/commissions/:id/hide`** (`server/partner-routes.ts`) — сохраняет ID в `bonus_settings`. Проверяет принадлежность комиссии партнёру (403 если чужая).
2. **`GET /api/partner/commissions`** — фильтрует скрытые ID перед возвратом. Нормализация типов через `Number()` чтобы избежать BigInt/string несовпадений.
3. **`GET /api/partner/stats`** — передаёт `excludeIds` в `getPartnerStats(partnerId, excludeIds)`, скрытые комиссии не учитываются в подсчёте заказов, оборота и суммы.
4. **`GET /api/partner/artist/stats`** — находит `orderId` скрытых комиссий и передаёт их в `getArtistStatsBySlug(slug, excludeOrderIds)`, чтобы верхний дашборд артиста тоже не считал скрытые заказы.
5. **`DELETE /api/admin/partner-commissions/:id`** (`server/admin-partner-routes.ts`) — хард-удаление из БД (только для отменённых, только для админа).

**Storage:**

- `getPartnerStats(partnerId, excludeIds?: number[])` — новый параметр исключения.
- `getArtistStatsBySlug(slug, excludeOrderIds?: Set<number>)` — фильтрует строки результата YDB по order ID в JS-цикле (без изменения SQL).

**Фронтенд (`client/src/pages/PartnerProfile.tsx`):**

- Кнопка корзины на каждой строке комиссии (любой статус).
- **Оптимистичное обновление**: комиссия исчезает из списка мгновенно (до ответа сервера). Откатывается при ошибке.
- Через 1.5 сек — инвалидация трёх кэшей: `/api/partner/commissions`, `/api/partner/stats`, `/api/partner/artist/stats`.
- Обработка ответа через `res.text()` + `JSON.parse()` — защита от случая когда сервер вернул HTML вместо JSON.
- Заменён `<Fragment key={c.id}>` на `<tbody key={c.id}>` — убрано предупреждение React о `data-replit-metadata`.

**Кнопка удаления в админке** (`client/src/pages/admin/PartnersTab.tsx`): красная иконка корзины рядом с отменёнными комиссиями — хард-удаляет из БД через `DELETE /api/admin/partner-commissions/:id`.

**Важное замечание по дашборду артиста:**
`items` в artist stats считает ВСЕ продажи товаров артиста (включая прямые покупки без реферальной ссылки). Поэтому `items` может быть больше `ordersCount` из partner stats — это корректное поведение, не баг.

**Файлы изменены:**
- `server/partner-routes.ts` — POST hide + GET commissions (фильтр) + GET stats (excludeIds) + GET artist/stats (excludeOrderIds)
- `server/admin-partner-routes.ts` — DELETE /partner-commissions/:id
- `server/storage.ts` — getPartnerStats(excludeIds), getArtistStatsBySlug(excludeOrderIds) интерфейс + реализация
- `client/src/pages/PartnerProfile.tsx` — hideCommissionMutation с оптимистичным обновлением, tbody вместо Fragment
- `client/src/pages/admin/PartnersTab.tsx` — кнопка хард-удаления для отменённых комиссий

---

## Текущий статус системы (май 2026)

### ✅ Реализовано и работает
| Функция | Статус |
|---|---|
| Ozon Delivery OAuth 2.0 | ✅ Авторизован, токены в YDB |
| Ozon Pay на чекауте | ✅ Работает как платёжный шлюз (`withDelivery: false`) |
| Ozon Pay Acquiring (платежи) | ✅ Реализован (`server/ozon-pay.ts`), платёжная ссылка создаётся |
| Ozon Feed `/ozon-feed.xml` | ✅ Генерируется, готов к загрузке в Ozon ЛК |
| YooKassa, T-Bank | ✅ Работают |
| CDEK, Yandex Delivery | ✅ Работают |
| Партнёрская программа | ✅ Полностью реализована |
| Email-уведомления | ✅ Работают (оптовики, партнёры) |
| Артист-страницы `/@slug` | ✅ Работают |
| ЛК оптовика — фильтр товаров | ✅ Скрыты товары без оптовой цены |

### 🔧 Что ещё нужно для Ozon Pay + доставка
| Задача | Приоритет |
|---|---|
| Загрузить товары на Ozon Marketplace через `/ozon-feed.xml` | Высокий |
| Получить Ozon item_id после модерации и сохранить в БД | Высокий |
| Включить `withDelivery: true` + передавать Ozon item_id как `sku` | Высокий |
| Активировать боевой режим Ozon Pay в ЛК Ozon (убрать «тестовый режим») | Средний |
| Протестировать webhook `/api/webhooks/ozon-pay` на реальном платеже | Высокий |

### ⚠️ Известные особенности
- **`withDelivery: true` не работает** без регистрации товаров на Ozon Marketplace с реальными Ozon item_id в поле `sku`
- **Yandex Serverless Containers** запускает несколько экземпляров параллельно — OAuth refresh-таймер работает в каждом экземпляре независимо (но токены читаются из общей YDB, так что это безопасно)
- `OZON_CLIENT_ID` / `OZON_CLIENT_SECRET` / `OZON_SCOPES` — только для продакшена, не нужны в Replit dev (нет доступа к внешним Ozon API из Replit)