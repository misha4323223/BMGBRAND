---
name: seoBody product field
description: How the per-product SEO HTML block field works and where its safety net lives
---

Added a `seoBody` field (Utf8 column `seo_body` in YDB `products` table) parallel to the existing
`seoTitle`/`seoDescription` pattern — one per product row, so per-color variants (each a separate
product row) get independent SEO HTML.

Admin pastes raw HTML (can include stray `<title>`/`<h1>` from a template) into a textarea in the
product SEO tab. The server sanitizes it on every create/update (see `sanitizeSeoBody` in
server/routes.ts): strips `<title>` entirely, downgrades `<h1>`→`<h2>` so it never duplicates the
page's real `<h1>` (the product name). Renders on the product detail page as a visible accordion
("Подробнее о товаре") via `dangerouslySetInnerHTML`, only when non-empty.

**Why:** user wanted to paste rich SEO copy per color variant without touching page structure or
duplicating title/h1 elements already covered by `seoTitle` and the product name.

**How to apply:** if adding another free-text HTML field admin-editable field, follow the same
pattern — sanitize server-side (not just client-side) since the PATCH/POST endpoints are the only
enforcement point, and confirm the underlying YDB column actually exists before trusting a
`success:true` response (see safequery-silent-write-failures.md — YDB write failures on missing
columns don't surface as HTTP errors under some paths).
