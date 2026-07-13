---
name: Bot SSR subcategory fix
description: Как renderSubcategory находит подкатегорию по slug — критичный баг и правильное решение
---

# Bot SSR subcategory

## Правило
`renderSubcategory` в `server/bot-ssr.ts` должна читать категории из `getCachedRawPageSettings('site_config')` → `normalizeCategories()`, а не из статической `CATEGORIES` schema.

**Why:** В YDB слаги подкатегорий — английские (`hoodies`, `sweatshirts`), а schema.ts генерирует транслитерацию (`tolstovki`, `svitshoty`). Поиск по schema никогда не найдёт "hoodies". Данные из `site_config.categories_data` — это те же данные что отдаёт `/api/categories`, они содержат реальные слаги.

**How to apply:** В bot-ssr.ts всегда проверяй что:
1. Локальный `CAT_META` (name/desc для renderCategory/renderCatalog) ≠ импортированный `CATEGORIES` из schema (для renderSubcategory)
2. `renderSubcategory` строит `cats` через `getCachedRawPageSettings('site_config')?.categories_data` → `normalizeCategories(raw)`, fallback → `CATEGORIES` (schema)
3. `findCategoryBySubcategorySlug(cats, subSlug)` — ищет по живым slugам из YDB

## Дополнительный баг (исторический)
Было: `const CATEGORIES = {...}` на строке 89 перекрывал `import { CATEGORIES }` на строке 27 → renderSubcategory всегда возвращала null → боты видели пустой React shell → 79% страниц с одинаковым title в Яндекс.Вебмастере.
Исправлено: локальный переименован в `CAT_META`.
