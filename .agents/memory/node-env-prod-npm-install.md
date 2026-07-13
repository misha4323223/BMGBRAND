---
name: NODE_ENV=production secret breaks npm install of devDependencies
description: When NODE_ENV secret is set to production, plain `npm install` skips devDependencies (vite, tsx, esbuild) and the dev server fails with "Cannot find package 'vite'"
---

## Правило
Если в Replit Secrets присутствует `NODE_ENV=production` (например, скопирован из `.env.production.example` для деплоя), обычный `npm install` пропускает `devDependencies` — npm видит ambient `NODE_ENV=production` и ведёт себя как `npm install --omit=dev`.

## Why
Сервер запускается через `NODE_ENV=development npx tsx server/index.ts` (workflow), это переопределяет `NODE_ENV` только для самого процесса, но не влияет на `npm install`, который запускается отдельно и наследует `NODE_ENV=production` из окружения/секретов. Результат: `vite`, `tsx`, `esbuild` и т.д. не устанавливаются, сервер падает с `Cannot find package 'vite' imported from server/vite.ts` при первом же запросе к Vite dev middleware.

## How to apply
- После `npm install`, если сервер падает с "Cannot find package 'vite'" (или другого dev-инструмента), проверить `echo $NODE_ENV` — если `production`, выполнить `npm install --include=dev` вместо обычного install.
- Секрет `NODE_ENV=production` в этом проекте нужен только для продакшен-деплоя (Yandex Cloud), в Replit dev его наличие — источник этой проблемы, но менять/удалять его не нужно, если это осознанный выбор пользователя для сохранения совместимости конфигов.
