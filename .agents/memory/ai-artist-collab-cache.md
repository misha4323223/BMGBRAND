---
name: BOOOM AI product chat losing artist-collab context
description: getCachedArtistHeroImage() is a raw cache read with no refetch — silently returns empty after 10 min idle, breaking AI collab context
---

## Правило
Для любого места, где нужны актуальные `page_settings` (в т.ч. `artist_pages`), использовать `await storage.getPageSettings(pageName)`, а НЕ синхронные `getCached*` геттеры типа `getCachedArtistHeroImage` / `getCachedRawPageSettings`, если это критично для корректности ответа (например, для промпта ИИ).

## Why
`getCachedArtistHeroImage(slug)` в `server/storage.ts` делает `pageSettingsCache.get("artist_pages")` — прямое чтение in-memory кэша без похода в YDB. У `pageSettingsCache` жёсткий TTL 600 сек (10 мин): после истечения `get()` тихо удаляет запись и возвращает `null`, без ошибки и без фонового обновления.
`storage.getPageSettings()` — правильная обёртка: при протухшем кэше запускает фоновое обновление из YDB, при отсутствии кэша — идёт в YDB синхронно.
Из-за этого в `/api/ai/product-info` (BOOOM AI чат в карточке товара) коллаб-контекст пропадал сам по себе каждые ~10 минут простоя других частей сайта, которые обычно и прогревают `artist_pages` (SSR страницы артиста, админка, sitemap) — ИИ "забывал" о коллаборации без видимой причины.

## How to apply
- `getCachedArtistHeroImage` / `getCachedRawPageSettings` оставлять только для best-effort мест (SEO-мета-теги, SSR-гидратация) — там пустой fallback не критичен.
- Для любой логики, где отсутствие данных портит пользовательский опыт (AI-промпты, критичные проверки) — использовать `await storage.getPageSettings(...)`.
