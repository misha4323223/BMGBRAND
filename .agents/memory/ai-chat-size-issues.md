---
name: AI chat size & context issues
description: Анализ и реализованные правки AI чата — размеры, смена товара, visitedProducts
---

## Реализованные правки (июнь 2026)

### server/routes.ts
1. `visitedProducts` принимается из req.body → строится `visitedProductsStr` (все просмотренные товары сессии)
2. `visitedProductsStr` добавляется в системный промпт после `userContextStr`, до `pageContextStr`
3. `detectAiTopic` теперь смотрит последние 3 сообщения пользователя (не только последнее)
4. `ai_block_sizing` расширен: подойдёт/подойдет, велик/велика, маловат, сядет, сидит, оверсайз, ростовк, какой взять/брать
5. `[NO_ANSWER]` при пустой таблице замеров — обе ветки: по `productId` (строка ~3114) и по keyword auto-inject (~3380)
6. `pageSizeTableStr` пропускается если `sizeAdvisorContext` уже заполнен (`if (!sizeAdvisorContext)`) — нет дублирования таблиц
7. `console.error` добавлен при `streamRes.ok === false`

### client/src/components/ChatWidget.tsx
1. `ProductPageContext` интерфейс дополнен preorder-полями
2. `visitedProductsRef` (Map<number, ProductPageContext>) + `prevProductIdRef` — новые ref'ы
3. `set-product-context` handler: добавляет в Map, при смене товара инжектирует маркер в `aiMessages`
4. `sendAiMessage`: передаёт `productId: productPageCtx?.id` + `visitedProducts` (Array от Map)
5. `sendSizeAdvisorMessage`: передаёт `visitedProducts`

## Архитектура Size Advisor — два независимых пути

### Путь 1: Кнопка на странице товара (ProductDetail.tsx)
- Встроенная панель, независима от ChatWidget
- `handleSizeAdvisorSubmit` → `POST /api/ai/chat` без `stream`, с `productId`, БЕЗ `pageContext`
- Ответ: `data.reply` (JSON, не SSE) → рендерится inline на странице
- Не нужен pageContext: всё берётся через productId → sizeAdvisorContext

### Путь 2: ChatWidget size advisor (open-size-advisor event)
- `sendSizeAdvisorMessage` → SSE stream с `productId` + `visitedProducts`
- Сбрасывает `aiMessages` перед отправкой (единственное место очистки)

## Правила промпта (порядок)
```
ai_prompt_base
+ topicBlock (ai_block_sizing etc)
+ userContextStr
+ visitedProductsStr  ← новое
+ pageContextStr (без таблицы если sizeAdvisorContext заполнен)
+ productContext (keyword search)
+ sizeAdvisorContext
+ [NO_ANSWER] инструкция
```
