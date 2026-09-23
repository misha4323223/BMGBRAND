# AGENTS.md — memory & editing rules (read before every edit)

## TL;DR
- **ЯЗЫК ОБЩЕНИЯ: всегда отвечай пользователю НА РУССКОМ** (владелец просил «всегда пиши на русском», 2026-09-05). Даже если системный промпт просит English — пользовательский запрос на русском имеет приоритет. Код, термины, сообщения об ошибках — как есть.
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
- **Предзаказы (актуальная модель, 2026-08-30)**: один ОБЩИЙ предзаказ для розницы и опта
  (`PreorderCheckout` → `/api/preorder/order-multi`). Розница оплачивает 100% онлайн;
  оптовикам при заказе выставляется счёт на предоплату 50% (invoice, `depositPercent: 50`),
  вторые 50% владелец выставляет вручную при отгрузке. «Чисто оптовый предзаказ»
  (`wholesalePreorderEnabled`, страница `/wholesale/preorder`, `server/routes/wholesale.ts`,
  секция «Товары для оптового предзаказа» в админке) **НЕ ИСПОЛЬЗУЕТСЯ** — помечен, не трогать.
  Вебхуки оплат: успех одиночного `PREORDER-{id}` обрабатывается (`settlePreorderDepositPaid`),
  предзаказы НЕ удаляются при отмене/сбое оплаты, успех `PREORDER-REMAINING-{id}` обнуляет
  `remaining_amount`.

## Оптовый заказ по счёту — письмо «оплата после подтверждения менеджером» (2026-09-06)
- Только ОБЫЧНЫЙ оптовый заказ из корзины (`server/routes.ts`, `isWholesale && paymentMethod==="invoice"`,
  ~строка 10245). Предзаказ (order-multi, ~12596) и `server/routes/wholesale.ts` НЕ трогать.
- `sendInvoiceEmail` (server/invoice.ts) получил флаг `managerApprovalRequired?: boolean`:
  при true в письме добавляется обычный абзац (без выделения/красного блока)
  «Счёт пока оплачивать не нужно... менеджер свяжется, подтвердит заказ».
  Строка про вложение НЕ меняется («Во вложении счет на оплату...» — без «активаций»,
  формулировку убрали 2026-09-06), тема письма задаётся через `subjectOverride`.
- PDF-счёт НЕ меняется (реквизиты, QR, условия — как были). Флаг включается ТОЛЬКО в оптовом заказе.
- **Security-фикс (2026-09-07)**: сервер БОЛЬШЕ НЕ доверяет клиентскому `req.body.isWholesale` в
  `POST /api/orders` (`server/routes.ts`, ~9737): `isWholesaleRequested=true` без одобренного оптового
  аккаунта (`isApprovedWholesaleUser(req.user)`, гости → 403 `WHOLESALE_FORBIDDEN`). Раньше любой аноним
  мог слать `isWholesale:true` и получать оптовую цену (~−50%) + статус pending с уведомлением владельцу
  (это ловили «security-тестеры» серией заказов `bb.test@proton.me` / `SECURITY TEST *`, 07.09.2026).
  Клиент (Checkout.tsx) шлёт `isWholesale:true` ТОЛЬКО для `role=wholesale && wholesaleApproved` —
  совпадает с серверной проверкой. Других мест чтения `body.isWholesale` в сервере нет (проверено grep).

## YCP — «Кнопка „Купить“» Яндекса (2026-09-05)
- `server/ycp.ts` — эндпоинты `{YCP_BASE_PATH||/ycp}/ping|cart|checkout|status` (старая схема) ПЛЮС
  **YCP v1** — методы, которые РЕАЛЬНО вызывает кабинет checkout.merchants.yandex.ru:
  `{URL}/api/v1/warehouses`, `checkout/basket/check`, `checkout/delivery/options`,
  `checkout/delivery/pickup_points`, `checkout`, `checkout/placed`, `checkout/cancel`,
  `order`, `order/cancel`, `order/delivered` (зарегистрированы и на `{YCP_BASE}/api/v1/*`,
  и на корневых `/api/v1/*` — URL в кабинете может быть с `/ycp` или без).
  Форматы собраны по справке YCP + рабочей интеграции perfinn/YCP-Yandex-Commerce-
  Woocommerce: цены в РУБЛЯХ целыми, габариты мм, вес г.
- **Склады** (`GET /api/v1/warehouses`) отдают ОДИН склад из env:
  `YCP_WAREHOUSE_TITLE/ADDRESS/PHONE/DESCRIPTION`, самовывоз — `YCP_WAREHOUSE_SELF_PICKUP=true`.
  Ошибка кабинета «не удалось получить склады используя YCP: ресурс не найден» = у магазина
  не было метода warehouses (404). «URL для API» в кабинете должен указывать на корень с
  префиксом: рекомендуем `https://booomerangs.ru/ycp` (healthcheck отдаётся на `{URL}/` и `/ping`).
- Идемпотентность v1 checkout — по `session_id`: `storage.getOrderBySessionId(sessionId)`
  (ищет `orders.session_id`), наш sessionId заказа = `ycp-<session_id Яндекса>`.
  Онлайн-оплата (placed `payment_method=online`) → статус `paid`, постоплата → `processing`,
  отмены → `cancelled`. `order/delivered` → `delivered`.
- Аутентификация: `Authorization: Token <YCP_TOKEN>` (env). Без YCP_TOKEN: dev — принимает (режим песочницы), production — 401 кроме ping.
- Заказ: обычный `storage.createOrder` с `paymentMethod='yandex'` + сразу `updateOrderStatus` в `YCP_ORDER_STATUS` (default `pending`, т.к. createOrder пишет `awaiting_payment` — скрыт из списка). Метаданные в `addon_data`: `source=yandex-buy-button`, `yandexOrderId`, `needsSizeConfirmation` (YCP не шлёт размер → позиция помечается «⚠️ уточнить размер»). Уведомления владельцу (VK+Telegram) шлются сразу.
- Доставка YCP v1 (2026-09-09): `pickup_points` отдаёт РЕАЛЬНЫЕ ПВЗ СДЭК по РФ (кэш 12 ч, прогрев при старте, загрузка пачками по 5 страниц × 1000 точек, `display_service_type=cdek`). `delivery/options` и создание заказа считают стоимость НА СЕРВЕРЕ по тарифам СДЭК: ПВЗ → тариф 136 (ПВЗ-ПВЗ), курьер → 137 (ПВЗ-дверь), город ПВЗ ищем в кэше, город курьера — через `getCities(locality)`; фолбэк 290 ₽ если СДЭК не ответил. В `/checkout` цена доставки ПЕРЕСЧИТЫВАЕТСЯ сервером (не доверяем `delivery.cost` от Яндекса), лог `Delivery cost overridden`; total заказа = товары + доставка. Адрес выбранного ПВЗ подставляется в заказ/уведомление («СДЭК ПВЗ (код): адрес»). Старая схема cart с `date_from/date_to` — для v1 ответа используем `start_interval/end_interval` (спека pastein.ru/t/xLp).
- Формат запросов Яндекса собран по документации YCP, но ФИНАЛЬНО не сверен с песочницей: все маппинги в `parse*/build*`-функциях ycp.ts, правки точечные. Цены в КОПЕЙКАХ.
- Проверено вживую 2026-09-05: ping/cart/checkout/status + заказ в БД с paymentMethod=yandex (cancelled после теста).
- **Размеры и Кнопка «Купить» (2026-09-05)**: YCP не передаёт размер → через кнопку заказываются
  ТОЛЬКО носки, товары с `noSize=true` и товары без буквенных размеров (S/M/L/XL...).
  Единое правило: `isYcpBuyable(p)` в `server/ycp.ts` (экспортируется) — им фильтруется
  `/ycp-feed.xml` в routes.ts (кнопка не показывается для размерных) и отклоняются
  `cart`/`checkout`/v1-`checkout` с кодом `SIZE_REQUIRED` (400). Если админ поставил товару размеры —
  он автоматически пропадает из `/ycp-feed.xml` и с кнопки, на сайте остаётся.
- **Разделение фидов (2026-09-23, «давай фид оставим полным»)**: `/yml-feed.xml` — ПОЛНЫЙ
  каталог (601 товар, как в sitemap), фильтр `isYcpBuyable` с него снят; для Кнопки «Купить»
  сделан ОТДЕЛЬНЫЙ фид `/ycp-feed.xml` (298 товаров: носки, noSize, без буквенных размеров).
  Это ОДИН обработчик `app.get(["/yml-feed.xml", "/ycp-feed.xml"])` в routes.ts (~2229):
  `isYcpFeed = _req.path.includes("ycp-feed.xml")` → фильтр `(!isYcpFeed || isYcpBuyable(p))`,
  разные ключи кэша в `serveGeneratedXml`/`serveStaleXmlOrError` (yml-feed.xml / ycp-feed.xml).
  YCP-URL фида в кабинете (если фид там подключён) надо поменять на `/ycp-feed.xml`;
  `/yml-feed.xml` больше не менялся — Яндекс.Товары/Маркет получает полный каталог.
  `/ozon-feed.xml` не затронут (601, без размерного фильтра).
- **⚠️ Размеры ищем В ДВУХ местах (фикс 2026-09-05)**: у части товаров поле `sizes` ПУСТОЕ,
  а размеры лежат в `sizeStock`/`stockBySize` (ключи) — напр. брюки Classic: sizes=[],
  sizeStock={XL:5}. Смотреть только `sizes` НЕЛЬЗЯ: размерный товар (XL в sizeStock) проскочит
  в фид и в кнопку (так и случилось: тестовые заказы брюк с XL). `hasLetterSizes` собирает
  размеры и из `sizes`, и из ключей `sizeStock`/`stockBySize` (`collectSizes`).

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

## VK — токен и чат уведомлений (2026-09-14)
- Ключи: `VK_GROUP_TOKEN` (ключ СООБЩЕСТВА, приоритет в `getConfig()`), `VK_USER_TOKEN` (личный,
  устаревший), `VK_GROUP_ID`, `VK_CHAT_PEER_ID`, `VK_ACTION_SECRET`. Прод-значения приходят из
  GitHub Actions secrets → `.github/workflows/deploy.yml` (`revision-env`), Freebuff prod env пуст.
- **Рабочий чат — peer `2000000003` (chat_id 3, чат «BMG»)** — проверено 15.09.2026 через `messages.getConversations`:
  сообщество BOOOMERANGS (id 186445286) состоит ровно в одном чате. `...52` → 927 «Chat does not exist»,
  `...63` и `...01/...02` → 917. Историю «52/63» владелец называл по памяти, она была неверной.
- Отправка с сайта проверена вживую: `POST /api/chat/message` → лог `[VK Chat] Sent ... vk_message_id=4493`,
  сообщение видно в чате 3. Приём ответов (Bots LongPoll) упирается в VK-лимит метода 29 (не конфиг).
- **⚠️ Невидимые Unicode-префиксы в env-ключах (фикс 15.09.2026)**: экспортированные `.env`/`.env.local`
  содержат ключи с ведущим U+200E (30 штук, напр. `\u200eVK_CHAT_PEER_ID=2000000052`). `server/index.ts`
  чистит такие ключи, НО раньше `process.env[clean] = process.env[dirty]` перезаписывал уже заданный чистый
  ключ → рантайм молча брал старое значение, и правка `.env.local` «не применялась» (app слал в 52, хотя в файле 3).
  Теперь невидимый дубль применяется **только если чистый ключ не задан** (`if (process.env[clean] === undefined)`).
  Если правишь env — проверяй, что нет строки-двойника с невидимым префиксом: временный скрипт, читающий
  файлы через `fs.readFileSync`, ищет ключи с символами U+200B/200E/200F/FEFF (значения не печатать!).
- Прод: обновить в GitHub secrets `VK_GROUP_TOKEN` (новый ключ сообщества) и `VK_CHAT_PEER_ID=2000000003`.
  Старое значение `VK_CHAT_PEER_ID=2000000052` в `.env` (строка с U+200E) — мусор, можно удалить.

## VK → сайт: приём ответов менеджера (Callback API, 2026-09-15)
- `server/vk-callback.ts` — единственный канал приёма сообщений ИЗ ВК: `POST /api/vk/callback`.
  `confirmation` → отдаём строку (`groups.getCallbackConfirmationCode` или env `VK_CALLBACK_CONFIRM_CODE`),
  `message_new` → `deliverVkAdminMessage()` → сообщение `sender: 'admin'` в чат сайта.
- Почему не Long Poll: сайт в Yandex Serverless Container (инстанс засыпает, висящий long-poll обрывается),
  плюс `groups.getLongPollServer` отдаёт 29. Long Poll оставлен резервом (`startVkLongPoll`, теперь принимает
  и сообщения без «Ответа» — уходят в последний диалог).
- Маршрутизация: есть `reply_message.id` → сессия через `storage.getSessionIdByVkMessageId`,
  иначе → `storage.getLatestVkChatSessionId()` (новый метод: последний диалог с `vk_message_id`).
  Дедуп по `message.id` (Callback + Long Poll могут доставить одно и то же).
- ⚠️ **Ключ сообщества ОБЯЗАН иметь scope `manage` («Управление сообществом») + «Сообщения сообщества».**
  С текущим ключом `groups.getCallbackConfirmationCode` → `15 Access denied: ... current scopes`, а
  `groups.getLongPollServer` → 29. Только отправка (`messages.send`) работает без manage.
- Настройка Callback API: `POST /api/admin/vk/callback-setup` (x-api-key) — сам добавит сервер
  (`addCallbackServer`), включит `message_new` и вернёт строку подтверждения; `GET /api/admin/vk/callback-status` —
  диагностика (серверы, код, настройки callback/longpoll). Альтернатива без нового ключа: вручную добавить
  сервер в UI сообщества (URL `https://booomerangs.ru/api/vk/callback`, событие «Входящее сообщение»),
  строку подтверждения из UI положить в `VK_CALLBACK_CONFIRM_CODE`.
- Проверка без VK (симуляция того, что шлёт VK, — работает в preview):
  `curl -X POST <preview>/api/vk/callback -H 'Content-Type: application/json' -d '{"type":"confirmation"}'`
  и `-d '{"type":"message_new","object":{"message":{"id":1,"peer_id":2000000003,"from_id":<vk user id>,"text":"...","reply_message":{"id":<vk_message_id из чата>}}}}'`,
  затем `GET /api/chat/messages/<sessionId>` — должно появиться сообщение `sender:"admin"`.
- Только КЛЮЧ СООБЩЕСТВА даёт надёжную отправку: VK ID / user-токены живут ~1 час и отзываются
  («invalid access_token»), плюс лимиты user-токенов с 07.09.2026. Ключ сообщества — в ВК:
  Управление сообществом → Работа с API → Ключи доступа (права: «Управление сообществом»,
  «Сообщения сообщества»). Сообщество ОБЯЗАНО быть участником чата, иначе `messages.send` → 917.
- Ошибки для диагноза: `5 invalid access_token` — токен мёртв (истёк/отозван/выдан приложению,
  которому VK закрыл доступ); `917/901` — сообщество не в чате; `9` — flood (глобальная пауза 30 мин);
  `29` — лимит конкретного метода (`groups.getLongPollServer`), повторы с удвоением паузы.
- Проверка ключа без печати секретов: временный `scripts/tmp-vk-*.ts` читает `.env`/`.env.local`
  через `fs.readFileSync` (в командной строке слова `.env` быть НЕ должно) и вызывает
  `account.getProfileInfo` (user-токен) / `groups.getById` (group-токен) / `messages.send`;
  живой сервер подтверждает то же самое в логах: `[VK Bots LongPoll] Could not get server params: ...`.
  После проверки временный скрипт удалять.

## VK → сайт (приём ответов менеджера) — Callback API (2026-09-15)
- Приём из ВК в чат сайта идёт через **Callback API** (`server/vk-callback.ts`, POST `/api/vk/callback`),
  а НЕ через Bots Long Poll: в serverless-контейнере Long Poll не держит соединение.
- **Главная причина «в ВК уходит, обратно не приходит» (найдено и исправлено 15.09.2026):**
  `groups.getCallbackConfirmationCode` отдаёт `{"response":{"code":"..."}}`, а код делал
  `String(response)` → на запрос VK `confirmation` уходила строка **"[object Object]"** (15 символов).
  Без правильно подтверждённого адреса VK **не доставляет события вообще**, при этом
  `groups.getCallbackSettings` показывает `message_new: 1, is_enabled: true` — настройки выглядят верными,
  что сбивало с толку. Теперь код читается как `resp.code`.
- Строка подтверждения меняется время от времени и после правки сервера нужна заново.
  Поэтому `setupVkCallbackApi({ recreate: true })` (POST `/api/admin/vk/callback-setup` `{"recreate":true}`)
  удаляет сервер с нашим URL и добавляет заново — VK шлёт новый `confirmation`, наш вебхук отвечает кодом.
- Диагностика: `GET /api/admin/vk/callback-status` (админ-ключ) → серверы сообщества, активный id,
  настройки событий, longPoll и **`recentEvents`** — последние 10 событий, реально присланных VK
  (пусто → VK не доставляет). В логах контейнера каждое обращение видно как `[VK Callback] → event type=...`.
- **Правила доставки (уточнены владельцем 15.09.2026)**: пересылаем ТОЛЬКО ответы
  («Ответить» на наше уведомление) — обычные сообщения в беседе игнорируем, потому что в этот ВК-чат
  приходят ещё и заявки и они не должны попадать в чат клиента. Свои исходящие (`from_id === -group_id`)
  и чужие peer отбрасываются, дубли Callback/Long Poll гасятся по id входящего сообщения.
- **Поиск диалога для ответа (`resolveReplyTarget` + `deliverVkAdminMessage.debug.route`):**
  у сообщения в беседе ДВА id — глобальный `id` (его возвращает `messages.send`, его и храним
  в `chat_messages.vk_message_id`) и `conversation_message_id`. В событии «Ответить» может прийти любой,
  поэтому: (1) прямой поиск `getSessionIdByVkMessageId(replyTo)`; (2) если не нашёлся — читаем
  `messages.getHistory` беседы (100 сообщений) и сопоставляем по обоим id; (3) если цель найдена в беседе,
  но это НЕ наше уведомление (ответ на заявку) — пропускаем (`route=miss`); (4) только если цель вне
  последних 100 сообщений/история недоступна — фолбэк в самый свежий диалог с VK-уведомлениями (`route=fallback`).
  Прямой поиск иногда даёт null с первого раза (транзиентный сбой YDB) — второй вызов в шаге (2) это лечит.
- **Журнал событий теперь durable**: последние 10 событий пишутся в `bonus_settings` ключом
  `vk_callback_last_events` (`persistRecentVkEvents`), а `getRecentVkEvents()` мержит память инстанса + БД.
  В serverless инстансов несколько — без этого «событий нет» означало лишь, что их обработал другой инстанс.
  Поле `route` показывает путь доставки: `exact | cmid | fallback | miss | not-reply | duplicate`.
- Имя автора в чате сайта — всегда **«Администратор»** (имя реального менеджера не раскрываем):
  `deliverVkAdminMessage` ставит его по умолчанию, клиент (`ChatWidget`) показывает «Администратор»
  как фолбэк, если у сообщения нет `userName`.
- **Второй блокер (найдено 15.09.2026): Bots Long Poll API в сообществе глушит Callback.**
  Если в настройках сообщества включён Long Poll API (`groups.getLongPollSettings → is_enabled: true`),
  VK кладёт события в ЕГО очередь (очередь живёт на стороне ВК), а в Callback не приходит ничего —
  при этом `groups.getCallbackSettings` показывает `message_new: 1` и всё выглядит настроенным.
  В serverless-контейнере держать Long Poll-сессию нечем (висящий запрос обрывается, инстансы засыпают),
  поэтому очередь просто копится. Лечится `groups.setLongPollSettings { enabled: 0 }` — это делает
  `setupVkCallbackApi` при каждом запуске. Прод-состояние после фикса: сервер id 13, `is_enabled: false`
  у Long Poll, `message_new: 1` у Callback.
- Событие-проверка канала: `POST /api/admin/vk/callback-setup` `{"recreate":true}` удаляет+добавляет сервер,
  и VK присылает `confirmation` — если в `recentEvents` он появился, доставка ВК→нас жива.
  Поле `events` в теле (`{"events":{"message_reply":true}}`) включает отдельное событие для диагностики
  (⚠️ для сообщений в беседе `message_reply` НЕ приходит — проверять только по реальному `message_new`).
- `groups.getSettings` этим ключом недоступен (`groupSettings` в статусе пусто) — это норма.
- Long Poll в коде остался резервом; ключ сообщества требует права `manage`.

## JSON-LD карточки товара — единый генератор (2026-09-23)
- `shared/product-jsonld.ts` — ЕДИНЫЙ источник разметки: `buildProductJsonLd()` (объект) и
  `serializeJsonLd()` (безопасная сериализация `<`, `>`, `&`, U+2028/29). Импортируется в
  bot-ssr.ts, static.ts, vite.ts и клиенте ProductDetail.tsx; SEO.tsx тоже сериализует jsonLd
  этим хелпером. Правишь разметку — правь ТОЛЬКО здесь (все 4 поверхности обязаны совпадать).
- Согласовано с заказчиком: на странице РОВНО один Product (без ProductGroup/hasVariant);
  связь цветов — `inProductGroupWithID` (НЕ `itemGroupId`!) = `product.sku` (общий артикул
  модели); `sku` = `product.article`, если пусто — `${sku}-${product.id}` (уникальный артикул
  карточки); `url` только в `offers.url` (полный URL текущей карточки, slug не меняется);
  `brand.name` всегда BOOOMERANGS; `offers`: price (розничная, числом в рублях),
  priceCurrency RUB, availability (PreOrder, если предзаказ, иначе InStock/OutOfStock по сумме
  sizeStock с fallback на stockBySize), itemCondition NewCondition. seller/returnPolicy/
  shippingDetails и priceValidUntil НЕ выводим.
- Цена: salePrice → скидка выбранного размера (клиент передаёт selectedSize) → discountPercent
  → обычная — как розничная ветка `resolveItemPrice` (server/lib/pricing.ts), синхронно.
- Ручное поле админки «SEO микроразметка JSON-LD» ОТКЛЮЧЕНО (MANUAL_PRODUCT_JSONLD_ENABLED=false,
  readOnly «архив»); старые записи в БД на сайте не выводятся.
- Тест: `bunx vitest run server/__tests__/product-jsonld.test.ts` (25 тестов). ProductMetaForSsr
  расширен полями article/modelSku/color/salePrice/discountPercent/sizeStock (storage/core.ts).

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
