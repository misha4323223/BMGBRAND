# BOOOMERANGS project architecture

## Назначение
- Российский интернет-магазин одежды BOOOMERANGS / BMG BRAND.
- Основные домены продукта: каталог, товары, корзина и заказы, оплата, доставка, личный кабинет, оптовый модуль, партнёрская программа, CMS/SEO, блог, страницы артистов и админ-панель.

## Стек и запуск
- TypeScript + ESM.
- Backend: Express в `server/`, запускается через `tsx server/index.ts`.
- Frontend: React + Vite в `client/`, маршрутизация через Wouter, UI на Tailwind/shadcn-подобных компонентах.
- Общие типы и схема находятся в `shared/`.
- `package.json`: `dev` запускает сервер на `PORT` (Freebuff Preview использует 5000), `build` — `script/build.ts`, `start` — собранный `dist/index.cjs`.
- Сервер должен слушать `0.0.0.0`; не менять entrypoint и настройки HMR без явной необходимости.
- Freebuff API Keys редактирует локальный `.env`: сначала загружается `.env`, затем используется `.env.local`, если `.env` отсутствует. Секреты в заметки не записывать.

## Данные и хранилище
- Основное production-хранилище — Yandex Database (YDB), инициализация в `server/db.ts`.
- `server/storage.ts` — основной storage-слой приложения и in-memory cache с TTL/stale TTL; здесь реализованы товары, заказы, настройки страниц, отзывы, партнёрские данные и другие домены.
- `YDB_SA_KEY` — JSON ключ сервисного аккаунта с `private_key`; обработчик нормализует внешние кавычки/экранирование и умеет читать многострочный JSON из `.env` без вывода секрета.
- Важный legacy-инвариант: `orders.partner_id` в production YDB хранится как `Utf8?`, а не `Uint64`. Нельзя заменять `serializeOrderPartnerId`/`deserializeOrderPartnerId` или удалять `DECLARE $partner_id AS Utf8` без полной миграции.
- `drizzle.config.ts` и PostgreSQL-зависимости присутствуют, но основной runtime storage для каталога и заказов — YDB.

## Серверный boot flow
- `server/index.ts` нормализует имена env-переменных, создаёт Express, включает CORS/Helmet/compression/cookies/body parsing, инициализирует YDB, регистрирует API routes и Virtual Try-On, затем запускает Vite/static serving.
- После старта выполняются seed юридических документов, cache warmup, рекомендации, рейтинги/отзывы, page settings и фоновые jobs.
- YDB transport/auth ошибки обрабатываются через `shouldReconnectYdb`/`reconnectYdb`; не добавлять бесконтрольные повторные подключения.
- Backend запускается без `--watch`; после изменений backend нужен перезапуск Preview/workflow.

## Функциональные модули и интеграции
- API и бизнес-логика: `server/routes.ts`, `server/auth-routes.ts`, `server/partner-routes.ts`, `server/storage.ts`.
- Платежи: ЮKassa и T-Bank.
- Доставка: CDEK; Ozon Delivery через Seller API/OAuth. Старый Yandex Delivery удалён.
- Почта: SMTP/Postbox через `server/email.ts`.
- Уведомления: Telegram и VK.
- Изображения: Yandex/Object Storage/S3-compatible слой.
- CRM/обмен: Bitrix24 и 1С CommerceML.
- AI: `server/ai-chat.ts`, Autonomous Agent; Virtual Try-On реализован в `server/virtual-tryon.ts` и клиентском компоненте.
- SEO/боты: `server/bot-ssr.ts`, `server/static.ts`, SEO page settings и redirect-логика. Bot SSR должен использовать только прогретый in-memory cache и не ходить напрямую в YDB на запросе.

## Правила безопасной работы
- Не читать, не выводить и не сохранять значения `.env`, API keys или приватных ключей.
- Перед изменением server/storage/YDB-логики сначала проверить связанные memory notes и legacy-схему.
- После изменений backend: `bun tsc -b --noEmit`, затем `freebuff-preview restart`, затем `freebuff-preview status` и `freebuff-preview logs`.
- Не считать Preview исправным только по `statusCode: 200`: проверять логи и фактические признаки подключения нужной интеграции.
- Не запускать production deploy, git delivery или destructive git-команды без явного запроса владельца.
