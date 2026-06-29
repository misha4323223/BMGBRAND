---
name: AI Chat Module
description: Архитектура AI чат-виджета — где что лежит, какие экспорты, какие баги были починены.
---

## Структура

- `server/ai-chat.ts` — весь AI Knowledge Cache, `detectAiTopic`, `registerAiChatRoute`
- `server/routes.ts` — вызывает `registerAiChatRoute(app)` + 3 admin-роута `/api/admin/ai-knowledge` (остались там, т.к. используют `checkAdminKey`)
- `server/index.ts` — импортирует `migrateAiKnowledgeDefaults` из `./ai-chat` (НЕ из `./routes`)
- `client/src/components/ChatWidget.tsx` — клиентский виджет

## Экспорты из `server/ai-chat.ts`

- `registerAiChatRoute(app)` — регистрирует POST /api/ai/chat
- `migrateAiKnowledgeDefaults()` — вызывается в index.ts при старте
- `resetAiKnowledgeCache()` — вызывается из routes.ts при approve agent-queue item
- `loadAiKnowledgeIfNeeded()`, `getAiKnowledgeCached(key)`, `invalidateAiKnowledgeCache()`
- `setAiKnowledgeCacheEntry(key, value)` — для admin-роутов (вместо прямого `aiKnowledgeCache.set`)
- `AI_KNOWLEDGE_KEYS`, `AI_KNOWLEDGE_DEFAULTS`, `type AiKnowledgeKey`

## Исправленные баги

**Bug 1 (server):** После SSE-стриминга force-flush `outputBuf` если `noAnswerOutputChecked === false` — иначе ответы короче 11 символов не доходят до клиента.

**Bug 2 (client):** `lastTriggerRef.current = null` сразу после `await fetch(...)` — проактивный триггер (`exit_intent` и др.) не наследуется последующими сообщениями.

**Bug 3 (client):** `cartRemovedProductRef.current = null` после `fetch` — `cart_remove` pageType не «залипает» при переходе к карточке товара.

**Bug 4 (client):** `.filter(m => !m.id.startsWith('ctx-'))` перед `.map()` в `messages` — UI-маркеры смены товара (`ctx-*`) не уходят на сервер как `role: "assistant"`.

**Bug 5 (server):** `max_tokens` 600 → 1000 для обычных вопросов, 1500 для size advisor — Qwen3-32B тратит 200–500 токенов на `<think>`, старого лимита не хватало.

**Why:** Qwen3-32B использует внутренний `<think>` блок (~400 токенов), который вырезается на сервере до отправки клиенту. При лимите 600 на реальный ответ оставалось мало.
