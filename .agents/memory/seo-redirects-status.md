---
name: SEO redirects status
description: Статус SEO-редиректов (кириллица, легаси, подкатегории) — что работает и что нет
---

# SEO-редиректы: статус реализации

Обновлено 2026-10-08 (проверки на боевом сайте + локальный dev-сервер с bot-UA).

## Что работает ✅

### Bot-SSR (server/bot-ssr.ts) — константы
- `CYRILLIC_TO_CANONICAL` (~line 1187): tolstovki→hoodies, svitshoty→sweatshirts, svitera→sweaters, futbolki→t-shirts, shorty→shorts, shapki→hats, sumki→bags
- `LEGACY_FLAT_REDIRECTS` (~line 1203): hats/shapki → `/products/accessories/headwear/hats`;
  sportivnye-40-45 / sportivnye-34-39 / sportivnye-34-39-2 → `/products/socks`
  (проверяется ПОСЛЕ `renderProduct`, ДО `CYRILLIC_TO_CANONICAL`, только если html ещё пуст)
- `BOT_LEGACY_SLUG_MAP`: расширен category-level записями (clothes→clothing, rasprodazha→sale, rasprodazha-2→sale, podarochnye-nabory→merch) с пустым subcategory

### Bot-SSR роутинг
- `/:cyrillicSlug` → 301 `/:englishSlug` ✅
- `/:legacyCategorySlug` → 301 `/products/:category` ✅
- `/:legacyFlatSlug` (шапки, «спортивные» носки) → 301 на живую страницу ✅
  (на бою ДО деплоя 2026-10-08 бот получал тут 404: `/shapki` → 301 `/hats` → 404)
- `/:englishSubSlug` (hoodies, t-shirts, ...) → 200 с контентом ✅

### Static.ts (server/static.ts, только production)
- `STATIC_CYRILLIC_TO_CANONICAL` (~line 31), `STATIC_LEGACY_CATEGORY_MAP` (~line 43),
  `STATIC_LEGACY_FLAT_REDIRECTS` (~line 54) — зеркала bot-ssr, держать в паре;
  плюс `SUBCATEGORY_ALIASES` (~line 68) для canonical injection
- Redirect logic стреляет ДО LCP-заголовков; canonical injection — после блока меты товара
- ⚠️ В dev (`NODE_ENV=development`) static.ts не подключён вообще (там `vite.ts`),
  поэтому человеческую ветку можно проверять только на бою после деплоя

### Проверено живьём 2026-10-08
- `/products/clothing/tolstovki` → 301 `/hoodies` → 200 — **ОДИН** хоп (в прежней версии этого
  файла баг «2 хопа» числился нерешённым; боевой сайт уже отдаёт один хоп, править больше нечего)
- `/products/sale/socks` → 301 `/products/sale/sale-socks` → 301 `/sale-socks` → 404 (бот) — см. ниже

## Открытые проблемы ⚠️

### /sale-socks и /sale-jackets: бот — 404, человек — 200-оболочку
Цепочка `/products/sale/socks` (и `/products/sale/jackets`) заканчивается 404 для бота и
пустой SPA-оболочкой для человека. Причина: у 24 товаров SALE в поле `subcategory` остались
СТАРЫЕ имена (например «Спортивные (40-45)»), поэтому `resolveProductCategoryPaths` не относит их
ни к `sale-socks`, ни к `sale-jackets` → `renderSubcategory` возвращает null → 404.
Варианты лечения: (а) привести подкатегории товаров SALE к новым слагам (данные),
(б) в bot-ssr отдавать фолбэк на родительскую `/products/sale`, если у подкатегории 0 товаров.
НЕ трогал (2026-10-08).

## Порядок middleware (server/index.ts)
```
registerRoutes(httpServer, app)  ← ~line 382, регистрирует /products/:cat/:sub
app.use(botSsrMiddleware)        ← ~line 399
serveStatic(app)                 // production only, ~line 404-405
setupVite(httpServer, app)       // dev only, ~line 407-408
```
`routes.ts`-редирект перехватывает `/products/clothing/*` ДО bot-ssr. Bot-ssr обрабатывает
только `/`-корневые пути.
