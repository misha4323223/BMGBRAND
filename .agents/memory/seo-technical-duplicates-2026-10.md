---
name: SEO: технические дубли (октябрь 2026)
description: 301 для слэша, 404 для неизвестных категорий, кэш артистов, ручные SEO-ключи, data-rh
---

# SEO: технические дубли — что починено 2026-10-18

Исходный отчёт владельца от 15.10.2026 (5 пунктов). Ниже — фактическое состояние после правок
и места, где что лежит, чтобы не искать заново.

## 1. URL со слэшем на конце
`server/index.ts` — middleware **перед** `botSsrMiddleware`: GET/HEAD с `pathname.endsWith("/")`
→ 301 на путь без слэшей, query сохраняется. Исключения: `/`, `/api/*`, `/assets/*`.
Проверено в dev: `/sweaters/`, `/t-shirts/`, `/@slug/`, `/products/clothing/` → 301;
`/api/categories/` → 200 без редиректа.

## 2. Страницы артистов: кэш и админский SEO
- `artist_pages` живёт в `pageSettingsCache = SimpleCache(120, 600)`: `get()` возвращает `null`
  через 600 с без чтения, а читают его только админка/API. Из-за этого `renderArtist()`
  возвращал `null` и робот/браузер получал SPA-оболочку с title главной.
- Лечение: `await ensurePageSettingsCached("artist_pages")` в ветке `/@` в **bot-ssr.ts** и
  **static.ts**, плюс keep-alive раз в 4 мин в `server/index.ts` (рядом с `blog_pages`).
- `renderArtist()` теперь берёт `artist_pages[slug].seoTitle/seoDescription` (как static.ts),
  а не только `{name} × BMGBRAND`. Экспортируется для тестов.
- Если кэш холодный и YDB не ответил за 4 с — поведение прежнее (оболочка), 404 не отдаём.

## 3. Служебные слаг-клоны артистов
`server/lib/artist-redirects.ts`: `artist-1772386526792 → /@molodostvnutri`,
`artist-1772387909100 → /tula-designers` (у обоих 0 своих товаров; у канонических — 21 и 13).
301 отдаётся в bot-ssr, static.ts и (для dev) vite.ts; слаги исключены из sitemap и llms.txt.
Записи в админке не трогали — редирект безопасен, даже если их удалить.

## 4. Неизвестные `/products/<slug>`
`server/lib/catalog-paths.ts` → `knownCategorySlugs()`: живой список категорий из
`site_config.categories_data`; возвращает `null`, пока кэш холодный (тогда 404 не отдаём,
чтобы не убить новую категорию в первые секунды после старта).
- bot-ssr: неизвестный слаг → 404 + noindex (`X-Bot-SSR: unknown-category`).
- static.ts / vite.ts: 404 + `robots: noindex` в оболочке.
- Клиент (`ProductList.tsx`): неизвестный `/products/:catSlug` рендерит `NotFound`,
  чтобы человек не видел каталог под чужим URL.
Именно так теперь ведёт себя `/products/1C%20Import` (категории с таким именем в БД нет).

## 5. Ручные SEO подкатегорий
Ключи в `page_settings.seo`: `subcategory:<catSlug>:<публичный slug>` (например
`subcategory:clothing:sweaters`). Было две ошибки:
- `static.ts` искал несуществующее `getSeoOverride(catSlug).subcategories[slug]` → браузер
  всегда получал автотекст;
- `ProductList` на legacy-адресах собирал ключ из YDB-слага (`svitera`), которого в настройках нет.
Теперь: `shared/seo-overrides.ts` → `resolveSubcategorySeoKey()` перебирает кандидатов
(`pathSubSlug`, `forcedUrlSlug`, `forcedSubSlug`, YDB-слаг) и берёт первый существующий.
Проверено в dev: `/sweaters`, `/t-shirts`, `/hoodies` отдают ровно админские title/description.

## 6. Прочее из того же отчёта
- `sitemap.xml`: убран `/concept/list` (был 404 из-за fallback по ключам объекта).
  Отдельные `/concept/<slug>` тоже не публикуются: на бою они отдают 404 —
  `renderConceptCampaign` читает `concept_campaign_<slug>` только из кэша и никто его
  не прогревает, а `static.ts` не считает `/concept/...` известным маршрутом.
  В sitemap остался живой `/concept`. Починка кампаний — отдельная задача.
- 404 в `static.ts` больше не отдаёт title/description главной.
- `client/index.html`: description/robots/og/twitter помечены `data-rh="true"`; canonical и
  `og:url` из `injectMeta` — тоже. `react-helmet-async` удаляет только теги с `data-rh`,
  без маркера после гидратации оставались два description/canonical/og-набора.
- `robots.txt`: `Disallow: /track/`.

## 7. Пустые подкатегории (2026-10-18)
`/sale-jackets`, `/sale-socks`, `/swetsale` есть в `site_config.categories_data` и в меню,
но товаров в них нет (в SALE живут только «Худи» и «Футболки»). Раньше бот получал 404
на живой адрес из меню. Теперь `renderSubcategory()` при нуле товаров возвращает
`renderEmptySubcategory()` — 200 + `robots: noindex, follow` + canonical на свой URL
(как уже было у 3-го уровня). 404 остаётся только для слага, которого нет в конфиге.
Холодный кэш по-прежнему даёт `renderLoadingPlaceholder`, а не пустую страницу.

## 8. `/concept/<slug>` и остальные живые SPA-роуты
После введения честных 404 в `static.ts` (production) любой путь, которого нет в
`knownRoutes`/`knownPrefixes`, стал 404. Под раздачу попали живые роуты `App.tsx`:
`/concept/:slug`, `/partner/:slug`, `/partner/:slug/widget`, `/partner/confirm-signature`,
`/predrop/checkout`, `/care` (последние два — многосегментные/не-слаговые).
Лечение: списки вынесены в экспортируемые `KNOWN_STATIC_ROUTES` / `KNOWN_STATIC_PREFIXES`
и покрывают все роуты клиента; регресс ловит `server/__tests__/static-routes.test.ts`.
Бот на `/concept/:slug` теперь греет `concept_campaign_<slug>` через
`ensurePageSettingsCached()`; если настройки прочитаны, а кампании нет или она скрыта —
404 + noindex, иначе — реальная страница кампании.

## Проверка
```
bun run test            # 338 тестов: bot-ssr (в т.ч. пустая подкатегория и /concept-404),
                        # static-routes, artist-redirects, static-meta, seo-overrides
NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsc -b --noEmit
```
`bun tsc` без NODE_OPTIONS падает по OOM на этом проекте.

## Ограничение
`static.ts` работает только в production; локально (dev) его ветки не выполняются.
Статические правила продублированы в `vite.ts` и проверены на preview, но финальную
проверку prod-ветки нужно делать на бою после деплоя.
