---
name: SEO admin override architecture
description: How admin-editable SEO title/description overrides for home/category/subcategory/artist pages are stored and consumed
---

Admin SEO overrides live in `page_settings` with `pageName="seo"`, keyed by section id:
`"home"`, `"category:<slug>"`, `"subcategory:<catSlug>:<subSlug>"`. Each holds `{ title, description }` only.

Artists do NOT use this table — they keep their own existing `pageName="artist_pages"`,
`sectionId=<slug>`, fields `seoTitle`/`seoDescription` (same fields the "Артисты" admin tab already
edited before this feature existed). The SEO admin tab writes to that same location for artist-type
pages so there's a single source of truth, not a duplicate.

**Why:** avoids a new duplicated storage path for artists and keeps `static.ts`/`bot-ssr.ts` reading
from the same cache keys they already warm.

**How to apply:** any new page type added to the SEO admin picker should decide whether it has its own
existing storage (like artists) — in which case reuse it — or whether it's net-new (like categories),
in which case add it under `pageName="seo"` with a new section-key convention consistent with the ones
above. Always read overrides via `getCachedRawPageSettings` (sync, cache-only) in `static.ts`/`bot-ssr.ts`,
never via the async `storage.getPageSettings` in those hot paths — and add the `pageName` to the
`criticalPages` warmup array in `server/index.ts` or it will silently read as empty until the first
cache-warming request.

Reads for humans use the public `GET /api/page-settings/:pageName` route; the admin aggregation endpoint
`GET /api/admin/seo/pages` merges overrides with hardcoded defaults exported from `server/static.ts`
(`CATEGORIES`, `ARTISTS`, `HOME_SEO_DEFAULT`) so the admin UI always shows the real currently-live value,
not a guess. Saves go through the existing generic `POST /api/admin/page-settings/:pageName/:sectionId`
route — no new POST route was needed.

Also fixed while building this: `server/static.ts`'s artist meta injection (used in production only,
since dev serves via Vite middleware and skips `static.ts` entirely) was ignoring the admin-edited
`seoTitle`/`seoDescription` from `artist_pages` and only used the hardcoded fallback — now reads the
stored override first.
