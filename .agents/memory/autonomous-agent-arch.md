---
name: Autonomous agent architecture
description: Ключевые решения архитектуры автономного AI-агента BOOOM
---

## Структура файлов
- `server/agent-queue.ts` — очередь + лог + настройки (CRUD поверх bonus_settings)
- `server/autonomous-agent.ts` — ядро агента, экспортирует runSeoJob, runAlertsJob, runDescriptionJob, runStaleProductsJob, runWeeklyDigest, runAutonomousAgent, initAutonomousAgent, getAgentStatus
- Telegram-функции добавлены в конец `server/telegram.ts`: notifyAgentQueueItem, sendAgentAlert, sendAgentDigest

## Хранение данных
- Всё через `(storage as any).getBonusSetting(key)` / `setBonusSetting(key, value)`
- Ключи: `agent_queue` (JSON массив QueueItem[]), `agent_log` (JSON массив LogEntry[]), `agent_settings` (JSON объект AgentSettings)

## Telegram callback_query
- Обрабатывается в существующем `/api/telegram/chat-webhook` endpoint
- Формат callback_data: `agent_approve:<itemId>` и `agent_reject:<itemId>`
- itemId формат: `q_<timestamp>_<4chars>` — не превышает 64 байт

## API роуты (все требуют x-api-key)
- GET/POST /api/admin/agent-queue, /api/admin/agent-queue/:id/approve|reject
- GET /api/admin/autonomous-agent/status|log
- PUT /api/admin/autonomous-agent/settings
- POST /api/admin/autonomous-agent/run (body: { job: "all"|"seo"|"alerts"|"digest" })

## UI
- AdminAgentChat.tsx переписан с 4 вкладками: Чат | Очередь | Лог | Настройки
- Встроен в AiKnowledgeTab.tsx через `<AdminAgentChat apiKey={...} adminFetch={...} />`
- Статус агента (pendingCount) показывает бейдж на вкладке Очередь

## Расписание
- SEO-батч: 03:00 МСК каждую ночь, до 50 товаров, ≤ 200 Groq-запросов
- Алерты: каждые 6 часов (первый через 5 мин после старта)
- Дайджест: каждый понедельник

**Why:** bonus_settings выбран потому что это единственное key-value хранилище доступное без новых таблиц; Telegram webhook уже настроен и умеет callback_query (используется для модерации отзывов).
