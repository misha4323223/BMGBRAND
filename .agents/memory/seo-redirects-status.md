---
name: SEO redirects status
description: Статус SEO-редиректов (кириллица, легаси, подкатегории) — что работает и что нет
---

# SEO-редиректы: статус реализации

## Что работает ✅

### Bot-SSR (server/bot-ssr.ts) — константы
- `CYRILLIC_TO_CANONICAL` (line ~1085): tolstovki→hoodies, svitshoty→sweatshirts, svitera→sweaters, futbolki→t-shirts, shorty→shorts, shapki→hats, sumki→bags
- `BOT_LEGACY_SLUG_MAP`: расширен category-level записями (clothes→clothing, rasprodazha→sale, rasprodazha-2→sale, podarochnye-nabory→merch) с пустым subcategory

### Bot-SSR роутинг (line ~2320-2365)
- `/:cyrillicSlug` → 301 `/:englishSlug` ✅ (CYRILLIC_TO_CANONICAL проверяется ДО renderSubcategory)
- `/:legacyCategorySlug` → 301 `/products/:category` ✅ (else if (legacy && !legacy.subcategory))
- `/:englishSubSlug` (hoodies, t-shirts, ...) → 200 с контентом ✅

### Static.ts (server/static.ts, только production) — code correct, не тестировалось в dev
- `STATIC_CYRILLIC_TO_CANONICAL` (line ~31): зеркало CYRILLIC_TO_CANONICAL
- `STATIC_LEGACY_CATEGORY_MAP` (line ~42): 4 легаси категории
- `SUBCATEGORY_ALIASES` (line ~50): 11 английских слагов с catSlug + name для canonical injection
- Redirect logic (line ~676-683): fired before LCP image/link headers
- Canonical injection (line ~784-800): after product meta block, for English alias slugs

## Нерешённая проблема ⚠️

### 2-хоп редирект /products/:cat/:sub с кирилличным subSlug

**Симптом**: `/products/clothing/tolstovki` → 301 `/tolstovki` (хоп 1) → 301 `/hoodies` (хоп 2). Должен быть 1 хоп: → `/hoodies`.

**Где должен фикситься**: `server/routes.ts` line ~1121-1140 — `app.get('/products/:catSlug/:subSlug', ...)`

**Что сделано**: добавлен `SUBCATEGORY_CYRILLIC_MAP` внутрь функции registerRoutes + `SUBCATEGORY_CYRILLIC_MAP[subSlug] || subSlug` в redirect. Но тест показывает что маппинг не применяется (всё равно идёт на `/tolstovki`).

**Гипотезы для диагностики**:
1. Проверить TypeScript-компиляцию routes.ts (const внутри async функции registerRoutes — должно работать, но проверить)
2. Добавить временный `console.log(\`[DBG] subSlug=\${subSlug} mapped=\${SUBCATEGORY_CYRILLIC_MAP[subSlug]}\`)` прямо в обработчик
3. Проверить нет ли ещё одного handler'а для `/products/:catSlug/:subSlug` зарегистрированного ДО line 1121 (хотя grep не нашёл)
4. Проверить, что `req.params.subSlug` действительно = "tolstovki" (не закодировано, не имеет невидимых символов)

**Важно**: это minor-баг — итоговый URL всё равно правильный (/hoodies), просто 2 хопа вместо 1. Google/Яндекс терпят цепочки до 5 редиректов.

## Порядок middleware (server/index.ts)
```
registerRoutes(httpServer, app)  ← line 382, регистрирует /products/:cat/:sub
app.use(botSsrMiddleware)         ← line 399
serveStatic(app)  // production only, line 404-405
setupVite(httpServer, app)  // dev only, line 407-408
```

**Вывод**: routes.ts-редирект перехватывает /products/clothing/* ДО bot-ssr. Bot-ssr обрабатывает только /:slug (корневые пути).
