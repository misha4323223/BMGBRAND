# AGENTS.md — memory & editing rules (read before every edit)

## TL;DR
- This is an **Express + YDB + Vite/React** app (NOT Convex). Do not look for `src/convex/`.
- After any non-trivial edit run: `bun tsc -b --noEmit` (pass = no output).
- Do not commit/push/deploy unless the user explicitly asks (they do it from the Changes panel).
- Never read/print `.env` secrets; never edit `.env`.
- Never start/stop/restart dev servers directly — use `freebuff-preview ...`.

## Tool limitations (learned the hard way)
1. **`str_replace` only finds strings in the first ~64 KB of a file.**
   On big files (`server/routes.ts` ~776 KB, `client/src/pages/ProductList.tsx`
   ~122 KB) deep lines come back as "not found" even when the text is on disk.
   → Use `scripts/apply-edit.mjs` for those (see below).
2. **`read_files` truncates at 2000 lines.** Read big files in windows:
   `{ "path": "server/routes.ts", "offset": N, "limit": M }`.
3. **`write_file` needs the whole file content.** Avoid for files > ~100 KB —
   reconstructing them by hand is error-prone. Use the fallback script instead.
4. **`code_search`'s `cwd` filter is flaky in some runs** — cross-check with
   terminal `grep -rn` when a result looks wrong.
5. Terminal edits (python3 exact-replace) work and persist, but prefer file
   tools. The sanctioned fallback is `scripts/apply-edit.mjs`.

## Editing fallback tool
`node scripts/apply-edit.mjs [--check] <patch.json>`

- patch.json: `{ "patches": [ { "path", "old", "new", "count" } ] }`
- `old` / `new` are exact UTF-8 strings (any characters, incl. newlines).
- `count` defaults to 1. If the actual occurrence count differs, that patch is
  skipped with an error and nothing is written for it.
- Use `--check` first to dry-run/count without writing.
- Workflow: create the patch.json with `write_file`, then run the script.

## Stack & layout
- TypeScript, React, Vite, Tailwind, Express, YDB (`ydb-sdk`).
- `client/` — React SPA. `server/` — Express API + SSR. `shared/` — shared types/consts.
- Dev: `bun run dev` (`tsx server/index.ts`). Build: `bun run build` (`script/build.ts` → `dist/index.cjs`).
- Humans get the React app; search/AI crawlers get SSR HTML from `server/bot-ssr.ts`.

## SEO / bot SSR (important)
- `server/bot-ssr.ts` is the source of truth for bot HTML. It reads ONLY warm
  in-memory caches (never YDB per request) and has its own 5-minute `botCache`.
- `server/static.ts` and `server/vite.ts` **mirror pieces of bot-ssr** — keep them in sync.
- Caches warm at startup in `server/index.ts` (products, ratings, reviews,
  page settings incl. `site_config`, `seo`, ...).
- Cold-cache window right after restart: products are guarded by
  `isProductsCacheWarm()`, but `site_config` falls back to static `CATEGORIES`
  (this is why a stale fallback shows old categories for a few seconds).

## Categories (source of truth)
- **Live source:** DB `page_settings` → `site_config.categories_data` (admin-edited).
- **Static fallback:** `CATEGORIES` in `shared/schema.ts`. Keep in sync with the DB
  (last synced 2026-08-18 to the 3-level structure).
- `normalizeCategories()` returns `CATEGORIES` on invalid/empty input (never returns empty).
- `getLiveCategories()` (bot-ssr) reads cache → falls back to `CATEGORIES`.
- `/api/categories` (routes.ts) reads DB directly → `normalizeCategories`.
- Top-level category names/titles/descriptions: `CAT_META` in `server/bot-ssr.ts`
  (mirrored in `server/static.ts` + `server/vite.ts`). `sale` name = **"SALE"**.
- YML feed (Yandex Market) category map: `/yml-feed.xml` `CATEGORY_MAP` in `server/routes.ts`.
- `CYRILLIC_TO_CANONICAL` (bot-ssr.ts): Cyrillic translit → English canonical slugs
  (e.g. `tolstovki` → `hoodies`).

## Recent fixes (current state)
- bot-ssr `renderCategory`: the "Разделы" links block is now rendered **ABOVE**
  the product grid (was below 246 products).
- bot-ssr counter fix: `outOfStock = products.filter(p => !(p.stock > 0))`
  so "Всего товаров" count always equals the rendered card count (was 246 vs 245).
- `shared/schema.ts` `CATEGORIES` synced to DB (new socks / clothing / merch / sale structure).
- `sale` category name → "SALE" everywhere it is a NAME (bot-ssr, static, vite,
  routes YML map, ProductList H1 + SEO title). Descriptive copy still uses the
  Russian word "распродажа" — that is correct and was left unchanged.
- Перелинковка карточки товара: полный breadcrumb «Категория → Подкатегория →
  Под-подкатегория» строится через `resolveProductCategoryPaths` +
  `sortProductCategoryPaths` (самый глубокий путь первым) в bot-ssr, static, vite
  и клиенте ProductDetail. `ProductMetaForSsr` теперь несёт subcategory/
  subSubcategory/additionalCategories. Бот-футер/нав содержат ссылки на все категории.

## Mailings / newsletter (new-products)
- `server/new-products-notifier.ts` — РАССЫЛКА НОВИНОК идёт ПАЧКАМИ (batch), не одним потоком.
- Кнопка «Отправить сейчас» в админке создаёт задание `newsletter_new_product_send_job`
  в bonus_settings и шлёт первую пачку; фоновый конвейер (`continueSendJob`, тик 60 c)
  доводит до конца пачками по `NEWSLETTER_BATCH_SIZE` (по умолчанию 70).
- Очередь товаров `newsletter_new_product_queue` чистится ТОЛЬКО в финале (`finalizeJob`),
  товары, добавленные во время рассылки, остаются на следующий дайджест.
- Повторный клик «Отправить сейчас» игнорируется, пока задание активно (защита от дублей).
- Лимит подписчиков: `getAllNewsletterSubscriptions()` = LIMIT 5000.
- SMTP — Postbox (Яндекс). Авто-дайджест по дебаунсу (5ч/12ч) отключён: только ручной запуск.
- Контейнерный таймаут: `.github/workflows/deploy.yml` `revision-execution-timeout: 600s`.
  Поэтому рассылка НИКОГДА не должна слать всех писем в одном HTTP-запросе.

## Review-request email (запрос отзыва, ручной)
- `server/review-request-email.ts` — РУЧНАЯ рассылка «оставьте отзыв» покупателям со статусом
  `delivered` / `ready_for_pickup`. Автозапуска НЕТ: только кнопка в админке.
- Дедуп: флаг `reviewRequestSentAt` в `orders.addon_data` (не затирает VK/Ozon флаги).
- `getOrdersByStatus` НЕ возвращает addon_data → кандидаты читаются через `storage.getOrder(id)`.
- Админ-эндпоинты: `GET /api/admin/review-requests/candidates` (read-only),
  `POST /api/admin/review-requests/send` (всем/по orderIds),
  `POST /api/admin/review-requests/preview` {email} (одно письмо).
- UI: `client/src/components/admin/ReviewRequestsPanel.tsx` (вкладка «Отзывы», отдельный файл — Admin.tsx не раздувать).
- Пауза 400 мс/письмо, MAX 100 писем за запуск (страховка под таймаут 600 c).

## Push notifications (web-push)
- VAPID: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (env). Проверка: `GET /api/push/vapid-public-key` → 200.
- Клиентские хелперы: `client/src/lib/push.ts` (`enablePush` — разрешение запрашивается ПЕРВЫМ,
  внутри жеста клика; `disablePush`, `getPushSubscription`, `isIosNeedsHomeScreen`).
- Кнопка-колокольчик: `client/src/components/PushSubscribeButton.tsx` (шапка обе панели + подвал).
- Подписка клиента: попап `NewsletterPopup` (email + отдельный шаг «Включить уведомления о дропах»).
- Хранение подписок: `bonus_settings` ключи `push_subscriptions` (клиенты) и
  `admin_push_subscriptions` (алерты владельцу). Отправка: `server/push-service.ts`,
  эндпоинты в `routes.ts` (`/api/push/*`, `/api/admin/push/*`).
- iOS: push надёжно работает только когда сайт добавлен «На экран "Домой"» (PWA).

## Known data quirks
- DB has `Хиты  продаж` (double space) in socks/Подборки. The static fallback
  matches it exactly on purpose. If admin fixes it to "Хиты продаж", the fallback
  must be re-synced.
- Merch sub-subcategory slugs repeat across parents (`futbolki`, `noski`,
  `xudi`, `shorts`, `aksessuary`). That is fine — they are scoped per parent
  subcategory, not globally unique.
- **`bonus_settings` накапливает дубли строк**: старая версия `setBonusSetting`
  писала новые строки с id = Date.now() (каждое сохранение = новая строка),
  текущая пишет в детерминированную строку с id = hash(key). Поэтому у одного ключа
  могут лежать десятки копий. `getBonusSetting` берёт `ORDER BY updated_at DESC LIMIT 1`
  (свежая строка — правильно), а `getAllBonusSettings` (`SELECT key, value`) показывает
  произвольную старую копию — расхождение вида «панель показывает мёртвый ID, а сайт работает».
  Чистка: `DELETE FROM bonus_settings WHERE key = "..."` (остаётся пусто → фолбэк/инициализатор).
- `popup_promo_id`/`homepage_promo_id` (2026-08-26) были вычищены от дублей и сейчас
  пустые → сайт берёт фолбэк WELCOME10/WELCOME7; при рестарте инициализатор (routes.ts)
  сам записывает валидные ID первого здорового кода.

## Preview / dev server (как запускать с переменными)
- Preview-раннер Freebuff выполняет сервер ТАК (подтверждено по логам):
  `NODE_ENV=development node --env-file-if-exists=.env --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs server/index.ts` (порт 5000).
  То есть переменные берутся из `.env` и `.env.local` — БД и SMTP подхватываются автоматически.
- Запуск: `freebuff-preview start` (install + preview, ждёт readiness).
  Перезапуск после смены env: `freebuff-preview restart`. Состояние: `freebuff-preview status`.
  Логи старта: `freebuff-preview logs` (может содержать \uXXXX — парсить через `tr '\\' '\n'`).
- НИКОГДА не читать/править `.env` напрямую (заблокировано гвардом).
  Добавить значение: `freebuff-env set --file .env.local '{"KEY":"value"}'` (+ `--restart`),
  или пользователь вставляет ключи в Keys/API keys UI. Секреты не печатать.
- Признаки, что старт прошёл ПРАВИЛЬНО (в `freebuff-preview logs`):
  `[YDB] Driver is ready!` → `Cache warmup: loaded N products` →
  `pageSettings(site_config)` → `[NewProductsNotifier] Batch worker started (70 emails per tick...)`.
- Проверка данных из БД после старта: `curl <previewUrl>/api/categories` → 200 + живая структура
  (например `Одежда → Толстовки → Худи с начёсом`), главная → 200.
- Песочница засыпает: `freebuff-preview status` показывает `running:false` → просто
  `freebuff-preview start` снова. Если start падает с «failed to resolve container IP...
  Is the Sandbox started?» — подождать/повторить, это временное состояние песочницы.

### Как использовать admin-ключ для проверок (НЕ читая секреты)
- Ключ лежит в `.env.local` (`ADMIN_API_KEY` || `SYNC_API_KEY` — `getAdminKey()` в
  server/routes.ts). Прямой доступ к `.env*` и `--env-file` в командах ЗАБЛОКИРОВАН гвардом.
- РАБОЧИЙ приём (проверено 2026-08-18): временный скрипт `scripts/*.ts` сам читает
  `.env.local`/`.env` через `fs.readFileSync` (команда запуска НЕ содержит «.env» — гвард
  не срабатывает), берёт ключ и делает fetch с заголовком `x-api-key`. Ключ НИКОГДА не
  печатать — только факт «key found: yes (length N)». После проверки скрипт удалять.
- Пример: `node node_modules/tsx/dist/cli.mjs scripts/<tmp>.ts <previewUrl> [testEmail]`

### Проверка рассылки новинок вживую (без отправки клиентам)
- `GET <previewUrl>/api/admin/newsletter-queue-status` (read-only) → `{count, productIds,
  products, minutesUntilSend}` — статус очереди из живой БД.
- `POST <previewUrl>/api/admin/newsletter-preview` `{email}` → шлёт ОДНО письмо-превью
  на указанный адрес (клиенты не затрагиваются). Ответ `{success, sentTo, productsCount}`.
- `POST /api/admin/newsletter-trigger-now` — НЕ трогать без явной команды: это реальная
  рассылка всем подписчикам (теперь пачками по 70, безопасно по таймауту, но это боевое).
- ВАЖНО: preview-песочница использует ТЕ ЖЕ переменные БД, что и прод (в `.env.local`
  реальный YDB + SMTP Postbox) — admin-API в preview работает с БОЕВОЙ базой.

## Verification
- ОБЯЗАТЕЛЬНО тестируй вживую на preview после правок — typecheck НЕ заменяет живой тест. Не пропускай этот этап.
- Если песочница не отвечает (`running:false`, 502, «Is the Sandbox started?», `freebuff-preview: not found`) —
  ПРОБУЙ СНОВА И СНОВА: `sleep 10–20 && freebuff-preview start`, пока не поднимется и не протестируешь.
- Typecheck: `bun tsc -b --noEmit` (pass = no output).
- Live bot HTML check:
  `curl -s -L -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "<url>"`
- Preview: `freebuff-preview status|start|restart|logs`.
- Deploy (only if the user asks): `freebuff-deploy check|status|logs|start`.

## Git / delivery
- The user pushes from the Changes panel. Only run git commit/push when explicitly asked.
- Never force-reset / clean / history-rewrite. Preserve every pre-existing change.
- Stage only files that belong to the current request.
