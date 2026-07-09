---
name: Bot SSR middleware
description: SSR middleware for crawlers in server/bot-ssr.ts — design rules, placement, and key guards.
---

# Bot SSR middleware

## Rules
- Only fires on `GET` + known bot User-Agent (BOT_UA_PATTERNS in bot-ssr.ts).
- `whatsapp` intentionally excluded — in-app browser is a real user; facebookexternalhit already covers WA link previews.
- NEVER calls YDB. Only reads in-memory caches: `getCachedAllVisibleProducts`, `getCachedProductsByCategory`, `getCachedProductMetaBySlug`, `getCachedRatingByProductId`, `getCachedProductsForRecommendations`.
- Own in-memory HTML cache: TTL 5 min, max 500 entries, FIFO eviction.
- If product/category cache is empty (server still warming) → `return null` → `next()` falls through to React SPA.
- Any exception → `next()`. Never crashes for real users.

## Visibility guard (critical)
`getCachedProductMetaBySlug` does NOT filter by isHidden/artistOnly.
`renderProduct` calls `isPublicProduct(slug)` first — checks via `getCachedProductsForRecommendations(2000)` which already applies `!isHidden && !artistOnly && price > 0`.
If slug not in visible list → `return null` → `next()`.

## Placement in server/index.ts
```
await registerRoutes(httpServer, app);
app.use(error handler);
app.use(botSsrMiddleware);   // ← must be before serveStatic/setupVite
if (production) serveStatic(app); else setupVite(httpServer, app);
```

## Covered routes
- `/` — home with featured products + category links
- `/products` — full catalog grouped by category
- `/products/:catSlug` — category page (clothing, socks, accessories, merch, sale)
- `/:slug` — product detail with JSON-LD Product + BreadcrumbList + co-purchase recs

## Diagnostic header
Response includes `X-Bot-SSR: rendered` (first render) or `X-Bot-SSR: cache-hit`.

**Why:** Without this middleware Yandex, GPTBot, ClaudeBot (non-JS crawlers) see empty `<div id="root"></div>` and cannot index the catalog — risk of de-indexing.
