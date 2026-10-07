# Откат релиза «1С: склейка файлов фрагментами» (2026-10-07)

Точки опоры (git-теги):

- `pre-1c-parts` — состояние **до** изменений (коммит `df6f8d6`).
- `1c-parts-v1` — релиз со склейкой (код в этом коммите).

Каждый деплой в Yandex Cloud — отдельная **ревизия** контейнера (`bmg-app`), образ тегируется
неизменяемым `github.sha`, ревизии не удаляются. Это и есть «бэкап» прода.

## Уровень 1. Прод без Git (секунды)

```bash
# список ревизий (активная помечена)
yc serverless container revision list --container-name bmg-app

# сделать активной прежнюю ревизию
yc serverless containers rollback --name bmg-app --revision-id <ID>
```

Или в консоли: Serverless Containers → `bmg-app` → «Ревизии» → сделать активной предыдущую.
Скрипт-обёртка: `./scripts/rollback-prod.sh <ID>` (без аргумента — печатает список ревизий).

Важно: откатывается **весь релиз целиком** — вернётся и прежний `file_limit=100 МБ`,
и все прочие правки того же пуша.

## Уровень 2. Код (если нужно вернуть и репозиторий)

Полный откат релиза:

```bash
git revert 1c-parts-v1     # или кнопка Revert на GitHub
git push                   # Actions пересоберёт и задеплоит
```

Только 1С (остальные задачи сессии остаются):

```bash
git checkout pre-1c-parts -- server/lib/storage-s3.ts
git rm server/lib/one-c-file-parts.ts server/__tests__/one-c-file-parts.test.ts
# server/routes.ts — точечно, см. список ниже
git commit -m "Revert 1C chunked upload pipeline to pre-parts behavior" && git push
```

1С-часть в `server/routes.ts` изолирована: `file_limit` в `init`; ветка приёма
`mode=file` (`accumulateOneCFilePart`); `publishOneCFile` / `flushPendingOneCFiles` /
`oneCThumbExists` / `readStoredOneCXml`; ключ картинки (`finalFilename`); проверка
существования превью в `generate1cThumbUrl`. Рядом живут правки ручных остатков
(`isStockSyncDisabled`) — их не трогать. По запросу владельца этот точечный откат делает
агент (с прогоном тестов и типов).

## Уровень 3. Пауза обмена без отката

```http
POST /api/admin/1c-sync-toggle   {"enabled": false}
```

1С получает `failure`, выгрузка останавливается. Флаг хранится в памяти процесса —
после рестарта/новой ревизии снова включён.

## Если деплой упал на шаге «Login to Yandex Container Registry»

`Could not login: … context deadline exceeded` — транзиентный сетевой сбой раннера
GitHub ↔ реестр Yandex, к коду отношения не имеет (сборка даже не начиналась).
Перезапустите workflow: GitHub → Actions → «Deploy to Yandex Serverless Container» →
**Run workflow** (ручной запуск, `workflow_dispatch`) или «Re-run failed jobs»;
либо просто сделайте любой новый пуш в `main`.

Наблюдение 2026-10-07: два провала подряд на шаге логина (`cr.yandex/v2` — таймаут),
при этом с других хостов реестр отвечает за <1 с (HTTP 401 без авторизации = норма).
Это сетевая недоступность только с подсети GitHub Actions — повторный пуш помогает.

## Что смотреть после выгрузки (логи контейнера)

Успех:

- `[1C FILE] Принят фрагмент N файла … (сборка … Б)`
- `[1C PARTS] Публикую catalog/…: N фрагм., … Б`
- `[1C IMAGE] *** SUCCESS …`
- `[1C IMPORT]   - XML paths: N, Found in S3: N, Missing: 0`
- `[1C IMPORT] Thumb generated: …` — только для новых/изменённых фото

Сигналы проблем:

- `[1C PARTS] … не похожи на целый файл — не публикую` — обрезок отброшен, файл перешлётся;
- `[1C PARTS] Не опубликован …` — ошибка Object Storage, смотреть дальше по логам;
- `[1C IMPORT]   - MISSING FILES (1C did not upload): …` — 1С не выгрузила этот файл.

## Данные

Миграций БД нет. Фото и XML пишутся по тем же ключам, что и раньше; служебная папка
`1c_parts/` (незавершённые сборки) старым кодом игнорируется. Чистить ничего не нужно.
