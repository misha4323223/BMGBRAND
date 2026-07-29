---
name: Artist pages → merch subcategory sync
description: How artist/festival pages are synced to the merch subcategory list; storage format gotcha
---

## The rule
Artist/festival pages (stored in `page_settings` / `artist_pages`) are NOT automatically linked to merch subcategories. Two separate systems. Fix: `syncArtistPagesToMerchSubcategories` runs on startup + `autoAddSubcategory("merch", name, storage)` is called on every `POST /api/admin/page-settings/artist_pages/:slug`.

**Why:** categories config (`site_config.categories_data`) and artist pages are stored independently; creating a page never touched the categories config.

**How to apply:** if a new artist/festival page doesn't appear in merch subcategory dropdowns, check that the startup sync ran (`[AutoSubcat] Startup sync` in logs). If the page's `name` field changes, the old subcategory entry is NOT removed — only new names are added.

## Subcategory storage format gotcha
`categories[slug].subcategories` is an array of **objects** `{name: string, slug: string}`, NOT plain strings. The original `autoAddSubcategory` assumed strings — caused `TypeError: s.toLowerCase is not a function`. Fixed: use `nameOf(s)` helper that handles both formats; push `{name, slug}` when existing entries are objects.
