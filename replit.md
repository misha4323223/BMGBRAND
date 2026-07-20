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

### Повторный импорт (20.07.2026)
Тот же сценарий: после импорта `node_modules` был пуст, из секретов были только `SESSION_SECRET` и `DATABASE_URL`. Исправлено: `npm install --include=dev` → перезапуск workflow. Сервер стартовал в dev-режиме, YDB отключена (нет YDB_SA_KEY/YDB_ENDPOINT/YDB_DATABASE и других секретов). Пользователь должен добавить все остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.) для подключения к боевой YDB, после чего перезапустить workflow.

### Повторный импорт (16.07.2026, четвёртый раз)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. Все секреты были добавлены пользователем заранее (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.). Исправлено: `npm install --include=dev` → перезапуск workflow. Сервер подключился к боевой YDB, загрузил 827 товаров — приложение полностью рабочее.

### Повторный импорт (16.07.2026, третий раз)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. В Secrets был только `SESSION_SECRET`. Исправлено: `npm install --include=dev` → перезапуск workflow (сервер стартовал в dev-режиме, YDB отключена). Пользователь должен добавить все остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.) для подключения к боевой YDB.

### Повторный импорт (16.07.2026, второй раз)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. Все секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.) были добавлены пользователем заранее. Исправлено: `npm install --include=dev` → перезапуск workflow. Сервер подключился к боевой YDB, загрузил 827 товаров — приложение полностью рабочее.

### Повторный импорт (16.07.2026)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. В Secrets был только `SESSION_SECRET`. Исправлено: `npm install --include=dev` → перезапуск workflow (сервер стартовал в dev-режиме, YDB отключена). Пользователь должен добавить все остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.) для подключения к боевой YDB.

### Повторный импорт (15.07.2026, третий раз в тот же день)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. В Secrets был только `SESSION_SECRET`. Исправлено: `npm install --include=dev` → перезапуск workflow (сервер стартовал в dev-режиме, YDB отключена). Пользователь добавил все остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData, JWT, SMTP и др.). После повторного перезапуска workflow сервер подключился к боевой YDB, загрузил 827 товаров и 240 заказов — приложение полностью рабочее.

### Повторный импорт (15.07.2026, второй раз в тот же день)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. В Secrets был только `SESSION_SECRET`. Исправлено: `npm install --include=dev` → перезапуск workflow (сервер стартовал в dev-режиме, YDB отключена). Пользователь добавил все остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData и др.), включая `NODE_ENV=production`. После повторного `npm install --include=dev` и перезапуска workflow сервер подключился к боевой YDB, загрузил 827 товаров и 240 заказов — приложение полностью рабочее.

### Импорт проекта в Replit (08.07.2026)
После импорта из GitHub `node_modules` отсутствовал — workflow зависал на подтверждении установки `tsx`. Исправлено: `npm install --include=dev`. После добавления всех секретов (YDB, платёжные шлюзы, CDEK, Telegram, VK и т.д.) сервер подключился к боевой YDB, загрузил 823 товара и 232 заказа — приложение полностью рабочее.

### Повторный импорт (15.07.2026)
Тот же сценарий: после импорта `node_modules` был пуст, из секретов был только `SESSION_SECRET` (включая `NODE_ENV=production` как секрет позже). Пользователь добавил все остальные секреты, после чего: `npm install --include=dev` → перезапуск workflow. Сервер подключился к боевой YDB, загрузил 827 товаров, все платёжные/доставочные/уведомляющие интеграции инициализировались без ошибок — приложение полностью рабочее.

### Повторный импорт (13.07.2026)
Тот же сценарий: `node_modules` отсутствовал после импорта из GitHub, workflow зависал. Исправлено: `npm install --include=dev`. Все секреты были добавлены заранее. Сервер подключился к YDB, загрузил 826 таваров — приложение полностью рабочее.

### Повторный импорт (14.07.2026)
Тот же сценарий: после импорта `node_modules` был пуст, workflow завис на подтверждении установки `tsx`. В Secrets был только `SESSION_SECRET`; пользователь добавил остальные (YDB, платежи, CDEK, Telegram, VK, Yandex Storage, DaData и др.), включая `NODE_ENV=production` как секрет. Исправлено: `npm install --include=dev` (обязательно, т.к. `NODE_ENV=production` иначе пропускает devDependencies). После перезапуска workflow сервер подключился к боевой YDB, загрузил 826 товаров, все платёжные/доставочные/уведомляющие интеграции инициализировались без ошибок — приложение полностью рабочее.

### Повторный импорт (13.07.2026, второй раз в тот же день)
При старте задачи "Set up the imported project" в Secrets был только `SESSION_SECRET` — остальные секреты (YDB, платежи, CDEK, Telegram, VK, Yandex Storage и т.д.) отсутствовали, а `node_modules` был пуст. Пользователь добавил все нужные секреты, после чего: `npm install --include=dev` → перезапуск workflow. Сервер подключился к боевой YDB, загрузил 826 товаров, все платёжные/доставочные интеграции инициализировались без ошибок — приложение полностью рабочее.

### Повторный импорт (12.07.2026)
Тот же сценарий: `node_modules` отсутствовал после импорта из GitHub, workflow зависал. Исправлено: `npm install --include=dev`. Все секреты уже были добавлены заранее. Сервер подключился к YDB, загрузил 826 товаров — приложение полностью рабочее.

Дополнительно: исправлен дублирующийся `const bodyRefChest` в `server/ai-chat.ts` (строки 1298 и 1308) — вызывал TransformError при старте.

### Повторный импорт (09.07.2026)
Тот же сценарий повторился: `node_modules` снова отсутствовал (свежий импорт из GitHub), workflow падал на подтверждении установки `tsx`. Исправлено: `npm install --include=dev`. После добавления всех секретов (YDB, платежные шлюзы, CDEK, Telegram, VK, Yandex Storage и т.д.) сервер подключился к боевой YDB, загрузил 825 товаров — приложение полностью рабочее.

### Bot SSR middleware (07.2026)

Файл `server/bot-ssr.ts` — middleware для поисковых и AI-краулеров (Yandex, Google, GPTBot, ClaudeBot и др.).

**Проблема:** SPA отдаёт ботам пустой `<div id="root"></div>`. Яндекс и AI-краулеры не выполняют JS → страница не индексируется → риск санкций.

**Решение:** middleware перехватывает GET-запросы с User-Agent известных ботов и отдаёт готовый HTML с реальным контентом.

**Принципы:**
- Только GET + только боты по UA → людей не трогает
- Только чтение in-memory кэша (`getCachedProductsByCategory`, `getCachedAllVisibleProducts`, `getCachedProductMetaBySlug` и др.) — никаких запросов к YDB
- Собственный in-memory кэш сгенерированных HTML-страниц: TTL 5 мин, максимум 500 ключей
- Если кэш продуктов пустой или маршрут неизвестен → `next()`, React-приложение как обычно
- Любая ошибка → `next()`, сайт никогда не ломается для людей
- Заголовок `X-Bot-SSR: rendered|cache-hit` для диагностики

**Маршруты с SSR:**
- `/` — главная с популярными товарами и категориями
- `/products` — каталог по категориям
- `/products/:catSlug` — страница категории (clothing, socks, accessories, merch, sale)
- `/:slug` — карточка товара с JSON-LD Product + BreadcrumbList + рекомендации

**Регистрация в `server/index.ts`:**
```
await registerRoutes(httpServer, app);
// ... error handler ...
app.use(botSsrMiddleware);  // ← здесь, до serveStatic/setupVite
if (production) serveStatic(app); else setupVite(httpServer, app);
```

### GitHub Actions деплой в Yandex Cloud — retry на docker push
`docker push` в `cr.yandex` иногда падает с `read: connection reset by peer` — это транзиентная сетевая ошибка между раннером GitHub Actions и Yandex Container Registry, а не баг в коде. В `.github/workflows/deploy.yml` шаг `Push Docker image` обёрнут в retry-функцию (5 попыток с нарастающей паузой). Если пуш всё равно падает после 5 попыток — проблема на стороне сети/registry, стоит попробовать перезапустить workflow вручную.

### npm registry и package-lock.json — важно для GitHub Actions

В Replit npm по умолчанию проксирует запросы через внутренний адрес `package-firewall.replit.local`. Этот адрес **недоступен вне Replit** (GitHub Actions, Docker). Если установить пакеты без явного указания registry, в `package-lock.json` запишутся Replit-URL и Docker-сборка упадёт с ошибкой:
```
npm error network request to http://package-firewall.replit.local/npm/... failed
```

**Решение (постоянное):** в корне проекта лежит файл `.npmrc`:
```
registry=https://registry.npmjs.org
```
Это гарантирует, что все `npm install` — в Replit, в Docker и в GitHub Actions — используют публичный registry, а `package-lock.json` всегда содержит корректные URL.

**После импорта репозитория из GitHub в Replit** — никаких дополнительных действий не нужно, `.npmrc` работает автоматически.

**Если вдруг `package-lock.json` снова содержит Replit-URL** (проверить: `grep -c "package-firewall.replit.local" package-lock.json`), пересоздать:
```bash
rm -rf node_modules package-lock.json
NODE_ENV=development npm install --include=dev
```

**При установке новых пакетов** — просто `npm install <пакет>`, `.npmrc` сам направит на публичный registry.

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
- **Yandex Serverless Containers:** Main hosting for the application (Docker container based on `node:24-slim`).
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

### Рефакторинг routes.ts — AI/Chat блоки 3, 4, 5 (июнь 2026)

**Что сделано:** 12 AI/Chat маршрутов вынесены из `routes.ts` в `server/ai-chat.ts` через три именованные функции. `routes.ts` стал на 199 строк короче. При переносе исправлены найденные баги.

**Перенесённые функции и маршруты:**

`registerAdminAgentRoutes(app, checkAdminKey)` — Блок 3:
- `POST /api/admin/agent/chat`
- `POST /api/admin/agent/execute`

`registerAgentQueueRoutes(app, checkAdminKey, resetAiKnowledgeCache)` — Блок 4:
- `GET /api/admin/agent-queue`
- `POST /api/admin/agent-queue/:id/approve`
- `POST /api/admin/agent-queue/:id/reject`
- `GET /api/admin/autonomous-agent/status`
- `GET /api/admin/autonomous-agent/log`
- `PUT /api/admin/autonomous-agent/settings`
- `POST /api/admin/autonomous-agent/run`

`registerAiKnowledgeRoutes(app, checkAdminKey)` — Блок 5:
- `GET /api/admin/ai-knowledge`
- `POST /api/admin/ai-knowledge/:key`
- `POST /api/admin/ai-knowledge/:key/reset`

**Исправленные баги (при переносе блока 4):**
1. **Race condition в approve**: добавлен in-memory мьютекс (`approveLocks: Set<string>`) — двойной клик по «Одобрить» теперь возвращает 409 вместо двойного выполнения инструмента.
2. **«Мёртвый» статус approved+error**: при ошибке `executeWriteTool` статус сбрасывается в `"pending"` — раньше застревал навсегда без возможности retry.
3. **`/run` без валидации job**: неизвестный job теперь возвращает 400 до отправки ответа — раньше возвращал `{ok:true}` и молча ничего не делал.
4. **4 пропущенных джоба в `/run`**: добавлены `stale_products`, `chat_gap`, `chat_conversion`, `retention`.
5. **Сортировка `getQueue`**: при фильтрации по статусу результаты теперь тоже сортируются новые-сверху.
6. **Валидация настроек**: `PUT /settings` теперь проверяет тело через Zod-схему.
7. **Статические импорты**: убраны все `await import()` внутри обработчиков.

**Файлы изменены:**
- `server/ai-chat.ts` — 3 новые экспортируемые функции, статические импорты из `agent-queue`, `admin-agent`, `autonomous-agent`
- `server/agent-queue.ts` — фикс сортировки в `getQueue`
- `server/routes.ts` — 199 строк заменены тремя вызовами; импорт из `./ai-chat` сведён к 4 строкам

---

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

---

## 🤖 AI-интеграция — полная карта (июнь 2026)

### Провайдер и модель
| Параметр | Значение |
|---|---|
| API | Groq API (`https://api.groq.com`) или `GROQ_PROXY_URL` |
| Модель | `qwen/qwen3-32b` |
| Секрет | `GROQ_API_KEY` в Replit Secrets |
| Лимит (бесплатный тариф) | 30 RPM; используем 12 RPM (безопасный темп, 5 сек между запросами) |
| Fallback при 429 | Ждём 3 минуты, до 3 попыток; при трёх подряд — батч остановлен до следующего запуска |

> Ответы Qwen3 содержат `<think>...</think>` — всегда стрипаем через `raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()` перед парсингом JSON.

---

### Модуль 1 — Клиентский чат-виджет
| | |
|---|---|
| **Файлы** | `client/src/components/ChatWidget.tsx`, `/api/ai/chat` (в `server/routes.ts`) |
| **Что делает** | Консультирует покупателей по доставке, оплате, возвратам, размерам; ищет товары по запросу; Size Advisor (подбор размера по росту/обхватам) |
| **Проактивность** | Сам инициирует диалог по триггерам (useEffect на `location`, `mouseleave`): главная 20 сек, карточка товара 35 сек / нет в наличии, корзина 60 сек, чекаут 90 сек, exit intent |
| **База знаний** | 15 редактируемых блоков-промтов в админке (`AiKnowledgeTab`) — меняются без пересборки проекта |

---

### Модуль 2 — Автономный агент BOOOM AI (ночные задачи)
| | |
|---|---|
| **Файлы** | `server/autonomous-agent.ts`, `server/agent-queue.ts` |
| **Расписание** | SEO: каждые ~15 часов; Алерты + Дайджест: каждый понедельник |
| **SEO-батч** | До 20 товаров за запуск — генерирует `seoTitle` (60 симв.) + `seoDescription` (155 симв.) для товаров без метаданных |
| **Улучшение описаний** | Предлагает расширенные тексты для товаров с описанием < 40 символов |
| **Алерты** | Товары с остатком ≤ 2 шт. → Telegram + VK; товары без фото → Telegram + VK |
| **Скрытие стоков** | Предлагает скрыть товары с нулевым остатком, которые давно не обновлялись (STALE_DAYS = 14) |
| **Дайджест** | Еженедельный отчёт по магазину (заказы, выручка, топ товары) → Telegram + VK |
| **Очередь** | Все изменения кладутся в `pending` → администратор одобряет/отклоняет кнопкой в `AdminAgentChat`; хранится в `bonus_settings` YDB по ключу `agent_queue` |
| **Лог** | Последние 100 действий в `bonus_settings` по ключу `agent_log` |

---

### Модуль 3 — Чат администратора
| | |
|---|---|
| **Файлы** | `server/admin-agent.ts`, `client/src/pages/admin/AdminAgentChat.tsx` |
| **Что делает** | NLP-команды на русском языке в админке: поиск товаров, заказы, промокоды, статистика, обновление товаров |
| **Инструменты чтения** (без подтверждения) | `search_products`, `get_orders`, `get_promo_codes`, `get_stats` |
| **Инструменты записи** (требуют подтверждения кнопкой) | `update_product`, `hide_product`, `create_promo_code`, `update_promo_code`, `delete_promo_code`, `update_order_status` |
| **Важно** | Цены передаются в **копейках**: 4500 ₽ = 450000 копеек |

---

### Модуль 4 — Post-Purchase Email (письмо через 1 час после покупки)
| | |
|---|---|
| **Файл** | `server/post-purchase-email.ts` |
| **Триггер** | Оплаченный заказ → `schedulePostPurchaseEmail()` |
| **Задержка** | 1 час (`DELAY_MS = 60 * 60 * 1000`) |
| **Джоб** | Каждые 3 минуты проверяет очередь (`ppemail_queue` в `bonus_settings`) |
| **AI-текст** | Groq генерирует 1-2 предложения: обращение по имени, упоминание купленных товаров, tone: дружелюбный |
| **Рекомендации** | 3 товара через `getRecommendations()` (co-purchase index) |
| **Промокод** | Автоматически создаётся `THANKS-XXXXX`, скидка **10%**, одноразовый, действует **24 часа** |
| **Тема письма** | `Подарок за покупку — скидка 10% на следующий заказ` |

---

### Модуль 5 — Abandoned Cart (брошенная корзина)
| | |
|---|---|
| **Файл** | `server/abandoned-cart.ts` |
| **Расписание** | Раз в 24 часа (первый запуск через 1 мин после старта сервера) |
| **Условие** | Авторизованный пользователь с непустой корзиной и без заказа |
| **Cooldown** | 4 дня — не отправляет повторно, если уже слали за последние 4 дня |
| **Хэш корзины** | MD5 от `productId:size:color:quantity` — фиксирует состав корзины |
| **Тема письма** | `Вы кое-что забыли в корзине` |
| **Ограничение** | Работает только с YDB (в Replit dev-режиме пропускается автоматически) |

---

### Модуль 6 — Рекомендации «С этим часто берут»
| | |
|---|---|
| **Файлы** | `server/recommendations.ts`, `client/src/components/RecommendationBlock.tsx` |
| **Алгоритм** | Co-purchase index (in-memory): товары, которые чаще всего покупали вместе; fallback — случайные товары той же категории (Fisher-Yates shuffle) |
| **Индекс** | Строится при старте сервера из оплаченных заказов; инкрементально обновляется при каждом новом оплаченном заказе |
| **Кэш сервера** | 2 часа TTL; инвалидируется при обновлении co-purchase для конкретного товара |
| **API** | `GET /api/products/:id/recommendations?count=6&exclude=1,2,3` |
| **Компонент** | Два режима: `compact` (горизонтальный ряд в CartDrawer, 4 товара) и `full` (сетка на странице товара, 4 товара) |
| **Кэш клиента** | `staleTime: 10 минут` |

---

### База знаний AI (`AiKnowledgeTab`)
Редактируется в Админке → вкладка «AI / Знания». Хранится в `bonus_settings` YDB. 15 блоков:

| Ключ | Назначение |
|---|---|
| `ai_prompt_base` | Базовая личность, тон, правила бренда — используется в каждом запросе |
| `ai_block_delivery` | Доставка (CDEK, Яндекс, сроки, стоимость) |
| `ai_block_payment` | Оплата (ЮKassa, Т-Банк, Ozon Pay, рассрочка) |
| `ai_block_returns` | Возврат и обмен |
| `ai_block_sizing` | Размерная сетка, Size Advisor |
| `ai_block_merch_order` | Корпоративный мерч на заказ |
| `ai_block_partner` | Партнёрская программа |
| `ai_block_artist` | Платформа для артистов `/@slug` |
| `ai_block_wholesale` | Оптовые закупки B2B |
| `ai_block_giftcards` | Подарочные сертификаты |
| `ai_block_predrop` | Pre-drop / Предзаказы |
| `ai_block_loyalty` | Программа лояльности (Серебро/Золото) |
| `ai_block_promo` | Промокоды |
| `ai_block_account` | Личный кабинет |
| `ai_block_vacancies` | Вакансии |

---

### API-маршруты AI
| Маршрут | Назначение |
|---|---|
| `POST /api/ai/chat` | Клиентский чат |
| `POST /api/admin/agent/chat` | Чат администратора |
| `GET /api/admin/ai-knowledge` | Получить все блоки знаний |
| `PUT /api/admin/ai-knowledge/:key` | Сохранить блок знаний |
| `POST /api/admin/ai-knowledge/:key/reset` | Сбросить блок к дефолту |
| `GET /api/admin/agent-queue` | Очередь задач автономного агента |
| `POST /api/admin/agent-queue/:id/approve` | Одобрить задачу |
| `POST /api/admin/agent-queue/:id/reject` | Отклонить задачу |
| `GET /api/admin/agent-log` | Лог действий агента |
| `GET /api/admin/agent-settings` | Настройки агента |
| `PUT /api/admin/agent-settings` | Обновить настройки агента |
| `GET /api/products/:id/recommendations` | Рекомендации для товара |

---

### Настройки автономного агента (`agent_settings` в `bonus_settings`)
```json
{
  "enabled": true,
  "seoEnabled": true,
  "alertsEnabled": true,
  "digestEnabled": true
}
```
Меняются в AdminAgentChat → переключатели включения/выключения каждой функции.

---

### Web Push Уведомления (июнь 2026)

**Стек:** стандарт W3C Web Push + VAPID, без сторонних сервисов. Данные хранятся в YDB (Яндекс Облако) — соответствует ФЗ-152.

**Как работает:**
1. При загрузке сайта `App.tsx` регистрирует `client/public/sw.js` (Service Worker)
2. В `NewsletterPopup` пользователь видит кнопку «Подписаться на уведомления»
3. Клик → браузер спрашивает разрешение → при согласии создаётся push-подписка
4. Подписка (endpoint + ключи) сохраняется в `bonus_settings` YDB по ключу `push_subscriptions` (JSON-массив)
5. Для отправки: сервер берёт все подписки и через `web-push` рассылает уведомления

**VAPID-ключи** (хранятся в Replit Env Vars — `shared`):
- `VAPID_PUBLIC_KEY` — передаётся браузеру открыто
- `VAPID_PRIVATE_KEY` — только на сервере, для подписи запросов
- `VAPID_EMAIL` — `mailto:info@booomerangs.ru`

> ⚠️ Если нужно перегенерировать ключи: `node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k)"` — затем обновить обе переменные и **переподписать всех пользователей** (старые подписки станут невалидными).

**Файлы:**
| Файл | Роль |
|---|---|
| `client/public/sw.js` | Service Worker: получает push, показывает уведомление, обрабатывает клик |
| `client/src/components/NewsletterPopup.tsx` | UI: email-форма + кнопка push подписки в одном попапе |
| `client/src/App.tsx` | Регистрация SW через `navigator.serviceWorker.register('/sw.js')` |
| `server/routes.ts` | 4 новых роута (см. ниже) |

**API-маршруты push:**
| Маршрут | Доступ | Назначение |
|---|---|---|
| `GET /api/push/vapid-public-key` | Публичный | Отдаёт VAPID public key браузеру |
| `POST /api/push/subscribe` | Публичный | Сохраняет подписку браузера в YDB |
| `DELETE /api/push/unsubscribe` | Публичный | Удаляет подписку по endpoint |
| `POST /api/admin/push/send` | Только админ | Рассылает push всем подписчикам |
| `GET /api/admin/push/stats` | Только админ | Кол-во активных подписчиков |

**localStorage ключи (фронтенд):**
- `push-subscribed` = `"true"` — пользователь уже подписан, попап не показывать повторно
- `newsletter-popup-dismissed` — закрыл попап (и email, и push не нажимал)
- `newsletter-subscribed` — подписался на email

**UX-логика попапа:**
- Показывается если НЕ установлен ни один из трёх ключей выше
- Email-форма (со скидкой) + блок «или» + кнопка push — в одном окне
- После успешной email-подписки → экран с промокодом + дополнительная маленькая кнопка push
- После push-подписки → кнопка становится зелёной «Уведомления включены ✓», попап не закрывается автоматически
- Если браузер заблокировал уведомления → показывается подсказка как разблокировать
- Cookie-баннер не затронут

**Автоочистка протухших подписок:**
При рассылке `/api/admin/push/send` — подписки со статусом 410/404 от браузера автоматически удаляются из базы.

---

## Глобальный анализ AI-системы

### Движок
**Groq / Qwen3-32B** · Стриминг SSE · Макс. 600 токенов ответ · Retry ×3 при 429 (ожидание 3 мин)

---

### 1. Клиентский чат (ChatWidget)

**Возможности:**
- Текстовый диалог с полным контекстом страницы и пользователя
- Инжектируемый контекст: имя, уровень лояльности, последние 3 заказа с трекингом
- На странице товара: полные характеристики + остатки + предупреждение «мало осталось»
- Поиск товаров по категориям в реальном времени (запрос в БД → передаётся ИИ)
- Стриминг ответов побуквенно (SSE)
- Загрузка фото (только в режиме менеджера)
- **Подбор размера** — отдельный режим: рост + обхват → рекомендация размера из БД товара

**База знаний — 14 тематических блоков (загружаются по теме запроса):**
`доставка` · `оплата` · `возврат` · `размеры` · `мерч на заказ` · `партнёрка` · `артисты` · `опт` · `сертификаты` · `предзаказ` · `лояльность` · `промокоды` · `аккаунт` · `вакансии`

Определение темы — keyword-matching через `detectAiTopic` (`server/routes.ts`).
Версионирование базы знаний: `AI_KNOWLEDGE_VERSION = v5` — при смене версии кэш инвалидируется.

---

### 2. Проактивные триггеры (8 штук)

| Триггер | Условие срабатывания |
|---|---|
| `home_newuser` | 20 сек на главной странице |
| `product_time` | 35 сек на странице товара |
| `product_outofstock` | 5 сек на товаре с нулевым остатком |
| `cart_time` | 60 сек в корзине/drawer |
| `checkout_time` | 90 сек на странице оформления |
| `catalog_browse` | 120 сек в каталоге |
| `cart_remove` | 3 сек после удаления товара из корзины |
| `exit_intent` | Мышь покидает верхний край окна (только десктоп) |

Каждый триггер генерирует уникальное сообщение через AI-эндпоинт.
Аналитика событий: `shown` / `clicked` / `dismissed` — хранится в БД, отображается в вкладке «Знания» админки.
Супрессия: после dismiss — пауза 7 дней (`localStorage`). Повторный показ одного триггера — не ранее чем через сессию (`sessionStorage`).

---

### 3. Чат администратора (AdminAgentChat)

**Инструменты только для чтения (выполняются мгновенно):**
| Инструмент | Действие |
|---|---|
| `search_products` | Поиск товаров по названию, артикулу, ID |
| `get_orders` | Список заказов с фильтром по статусу / покупателю |
| `get_promo_codes` | Все промокоды и их статус |
| `get_stats` | Выручка, количество заказов, товаров |

**Инструменты записи (требуют подтверждения администратора):**
| Инструмент | Действие |
|---|---|
| `update_product` | Изменить поля товара: название, описание, цену, SEO |
| `hide_product` | Скрыть / показать товар |
| `create_promo_code` | Создать новый промокод |
| `update_promo_code` | Редактировать существующий промокод |
| `delete_promo_code` | Удалить промокод |
| `update_order_status` | Изменить статус заказа |
| `update_ai_knowledge_draft` | Добавить новые знания в базу BOOOM AI |
| `send_cart_promos` | Массовая рассылка персональных скидок пользователям |
| `send_retention_offers` | Сегментированные письма (горячие / риск оттока / новые) |
| `acknowledge_chat_insights` | Отметить отчёт по конверсии как просмотренный |

Флоу подтверждения: агент возвращает `type: "write"` → UI показывает кнопку «Выполнить» → вызов `/api/admin/agent/execute`.

---

### 4. Автономный агент — расписание задач

| Периодичность | Задача | Результат |
|---|---|---|
| Ежедневно | SEO-генерация (до 20 товаров без seoTitle/seoDescription) | Сохраняется в БД напрямую |
| Понедельник | Алерты: мало остатков (<2 шт.) + нет фото | → Telegram / VK / Push |
| Понедельник | Еженедельный дайджест продаж и трендов | → Telegram / VK / чат |
| Четверг | Предиктивное удержание (сегменты: горячие / риск оттока) | → Очередь на одобрение |
| Воскресенье | Залежавшиеся товары (0 остатков, 14+ дней без обновления) | → Очередь на одобрение |
| Воскресенье | Брошенные корзины → предложение промокодов | → Очередь на одобрение |
| Воскресенье | Анализ пробелов в знаниях ИИ (кластеризация без ответов) | → Очередь на одобрение |
| Среда | Анализ конверсии чата в заказы (через `session_id`) | → Карточка в чат |

Защита от дублей: distributed lock через `bonus_settings` (YDB). Ключ блокировки — имя задачи + дата.

---

### 5. Очередь агента (Agent Queue)

Файл: `server/agent-queue.ts`

Статусы: `pending` → `approved` / `rejected` → `executed`

Администратор видит очередь во вкладке «Очередь» в `AdminAgentChat.tsx`. Может редактировать параметры (например, размер скидки) перед одобрением. После одобрения сервер вызывает соответствующий инструмент из `admin-agent.ts`.

Типы задач в очереди: `stale_products` · `description_improvement` · `cart_promo` · `retention_offer` · `knowledge_gap` · `chat_conversion_insight`

---

### 6. Аналитика и уведомления

- **Конверсия чата:** корреляция `session_id` чата с оплаченными заказами → отчёт по средам
- **Проактивные события:** `shown` / `clicked` / `dismissed` по каждому триггеру
- **Лог действий агента:** все автономные и ручные действия записываются в `agent_log`
- **Каналы оповещений:** Telegram · VK · Web Push

---

### 6. Ключевые файлы AI-системы

| Файл | Назначение |
|---|---|
| `server/autonomous-agent.ts` | Все фоновые задачи и расписание |
| `server/admin-agent.ts` | Инструменты и логика чата администратора |
| `server/agent-queue.ts` | Очередь задач, статусы, типы |
| `server/routes.ts` | `/api/ai/chat`, `/api/ai/proactive-event`, знания |
| `client/src/components/ChatWidget.tsx` | Клиентский чат + проактивные триггеры |
| `client/src/pages/admin/AdminAgentChat.tsx` | UI чата администратора + очередь |
| `client/src/pages/admin/AiKnowledgeTab.tsx` | Управление базой знаний + аналитика триггеров |

---

## Changelog

### Видео на странице товара + улучшения AI-системы (июнь 2026)

**Видео на карточке товара:**
- Видео (`videoUrl`) вынесено из общей сетки фотографий в отдельный блок — отображается ниже галереи и на мобильном, и на десктопе
- Тег `<video autoPlay muted loop playsInline controls>` — автовоспроизведение без звука, клиент может включить звук сам
- Мобильная галерея возвращена к оригинальной логике (только фото), видео добавляется отдельным блоком ниже
- Убрано лишнее состояние `mobileIdx` — стало чище
- Файл: `client/src/pages/ProductDetail.tsx`

**Admin-агент — самообучение и честность:**
- Добавлен инструмент `update_ai_knowledge_draft` в системный промпт admin-агента (был написан в коде, но не подключён)
- Агент теперь знает: если администратор поправил его или сообщил новый факт → предложить записать в базу знаний клиентского бота через очередь подтверждения
- Добавлены правила честности: «не знаешь → скажи прямо», «тебя поправили → признай и предложи записать»
- Файл: `server/admin-agent.ts`

**Клиентский бот — полный поиск и уведомления о незнании:**
- Лимит поиска товаров поднят с 5 до 20
- Товары артистов (`artistOnly`) больше не исключаются из поиска
- Добавлен механизм `[NO_ANSWER]`: когда бот не знает ответа — ставит скрытый тег в начало ответа
- Сервер перехватывает тег, убирает его перед показом клиенту, отправляет алерт в Telegram и сохраняет вопрос в YDB
- Исправлен баг: тег правильно обнаруживается даже если разбивается между стриминг-чанками
- Файл: `server/routes.ts`

---

### Фиксы вёрстки под большие мониторы (июнь 2026)

**Проблема 1 — ошибка динамического импорта на больших мониторах в Replit dev:**
`Failed to fetch dynamically imported module: ...sisko.replit.dev/src/pages/Home.tsx`

Все страницы в `App.tsx` загружаются через `lazy()`. На больших экранах (27") больше секций попадает во viewport сразу → больше одновременных запросов динамических импортов → Vite блокировал их, не зная хост Replit-прокси.

**Исправление:** добавлена строка в `vite.config.ts`:
```ts
server: {
  allowedHosts: "all",  // ← добавлено
  fs: { strict: true, deny: ["**/.*"] },
},
```
**Откат:** удалить строку `allowedHosts: "all"` из `vite.config.ts`. На продакшене эта настройка не влияет (там нет Vite dev-сервера).

---

**Проблема 2 — очень большие отступы по бокам на мониторах 27" (2560px):**

Контейнер `max-w-8xl` = 1440px давал по 560px пустоты с каждой стороны на 2560px экране.

**Исправление:** изменены значения в `tailwind.config.ts`:
```ts
// Было:
'8xl': '1440px',
'9xl': '1600px',

// Стало:
'8xl': '1920px',
'9xl': '2560px',
```
Класс `max-w-8xl` используется везде на сайте: Home, ProductDetail, Catalog, Cart, Blog, Navbar, Footer.

**Откат:** вернуть значения обратно — `'8xl': '1440px'`, `'9xl': '1600px'` в `tailwind.config.ts`. На продакшене изменение вступает в силу при следующей сборке `npm run build`.

### AI чат-виджет — вынос в отдельный файл + багфиксы (июнь 2026)

**Рефакторинг:**
- Весь AI Knowledge Cache (константы, типы, кэш-функции), `detectAiTopic`, `logChatTopic`, `buildMRowStr/buildMRowCompact` и хэндлер `POST /api/ai/chat` вынесены из `server/routes.ts` в `server/ai-chat.ts`
- `server/routes.ts` теперь вызывает `registerAiChatRoute(app)` вместо 700 строк inline-кода
- `server/index.ts` импортирует `migrateAiKnowledgeDefaults` из `./ai-chat` (не из `./routes`)
- Admin-роуты `/api/admin/ai-knowledge` обновлены: используют `setAiKnowledgeCacheEntry()` вместо прямого доступа к `aiKnowledgeCache`

**Исправленные баги (`server/ai-chat.ts`):**
- **Bug 1** — короткие ответы < 11 символов не доходили до клиента: после SSE-стриминга добавлен force-flush `outputBuf` если `noAnswerOutputChecked === false`
- **Bug 5** — `max_tokens 600` → `1000` для обычных вопросов, `1500` для size advisor (Qwen3-32B тратит 200–500 токенов на `<think>`)

**Исправленные баги (`client/src/components/ChatWidget.tsx`):**
- **Bug 2** — `lastTriggerRef.current = null` после `fetch`: проактивный триггер (`exit_intent` и др.) больше не наследуется последующими сообщениями
- **Bug 3** — `cartRemovedProductRef.current = null` после `fetch`: `cart_remove` контекст не «залипает» при переходе на карточку товара
- **Bug 4** — `.filter(m => !m.id.startsWith('ctx-'))` перед `.map()` в `messages`: UI-маркеры смены товара не уходят на сервер как `role: "assistant"`