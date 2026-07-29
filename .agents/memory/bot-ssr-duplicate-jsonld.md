---
name: Bot SSR duplicate Product JSON-LD
description: Root cause and fix for AI/Google bots seeing duplicate Product JSON-LD schemas on product pages
---

## The problem
bot-ssr.ts auto-generates a full Product JSON-LD schema for every product page. It also appended `customJsonLdScript` from the per-product `seoJsonLd` DB field — without checking whether it duplicated the auto-generated Product schema.

At some point an admin tool stored bad `seoJsonLd` values (placeholder images like `/placeholder/black-shorts.jpg`, fake SKUs like `BMG-MR-BK-007`) for 12 products. Bots saw two conflicting `@type: Product` schemas — one correct, one with non-existent image URLs — causing structured data errors and AI crawlers to distrust/skip those pages.

## Fix applied (July 2026)
1. **Database** — `seoJsonLd` cleared to `""` for all 12 affected products via `PATCH /api/admin/products/:id` with `{"seoJsonLd":""}`.
2. **bot-ssr.ts** (line ~873) — added `hasProductType()` guard: if `seoJsonLd` parses to a Product/ProductGroup schema, it is silently skipped. The auto-generated schema is authoritative and must never be duplicated.
3. **routes.ts** — added `POST /api/admin/cache/flush` (requireAdminOrApiKey) that calls `clearBotSsrCache()` + `storage.clearCache()`. Import of `clearBotSsrCache` added from `./bot-ssr`.
4. **bot-ssr.ts** — exported `clearBotSsrCache(): number` that wipes the in-memory botCache Map.

**Why:** Yandex Cloud Serverless runs multiple instances; in-memory cache cannot be cleared globally without a deployment. Deploying applies all fixes to all instances simultaneously.

## How to apply in future
- If bots stop seeing product pages → check for duplicate JSON-LD with `curl -s -A "GPTBot/1.1" https://booomerangs.ru/<slug> | grep -c "application/ld+json"`. Should be 1.
- After any SEO data change, call `POST /api/admin/cache/flush` (x-api-key: ADMIN_API_KEY) to immediately refresh all caches.
- Never allow `seoJsonLd` field to contain `@type: Product` — the code now filters it, but admins should still not set it.
