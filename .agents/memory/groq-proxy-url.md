---
name: GROQ_PROXY_URL only for production
description: GROQ_PROXY_URL недоступен из Replit dev — вызывает молчаливый сбой AI чата
---

## Правило
`GROQ_PROXY_URL` должен быть установлен ТОЛЬКО в Яндекс Клауд (продакшен), не в Replit Secrets.

## Why
Код в `server/routes.ts` даёт `GROQ_PROXY_URL` приоритет над `GROQ_API_KEY`:
```ts
const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, "") : "https://api.groq.com";
```
Прокси-URL — внутренний эндпоинт Яндекс Клауд, недоступен из Replit.
При сбое: `streamRes.ok === false` → SSE возвращает `{error: "ai_unavailable"}` с HTTP 200 за ~374ms.
До добавления `console.error` (добавлен в той же правке) ошибка была невидима в логах.

## How to apply
- При отладке AI в Replit: убедиться что `GROQ_PROXY_URL` отсутствует в Replit Secrets
- Признак проблемы: `POST /api/ai/chat 200 in ~374ms` без строки `[AI Chat] Groq stream error`
