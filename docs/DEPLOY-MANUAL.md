# Ручной деплой в обход GitHub Actions

Зачем: раннеры GitHub иногда не видят `cr.yandex` — шаг «Login to Yandex Container
Registry» падает с `context deadline exceeded` ещё до сборки, и автодеплой невозможен,
хотя hotfix нужен сейчас. Этим же путём можно задеплоить любой коммит вручную.

Параметры прода (из `.github/workflows/deploy.yml`):

| Параметр | Значение |
|---|---|
| Реестр/образ | `cr.yandex/crpp1bes63avh83rbvte/bmg:<sha>` |
| Контейнер | `bmg-app` |
| Каталог | `b1g54bhp2g3klqsgpsbp` |
| Сервисный аккаунт | `ajemoq00jglva97nqi47` |
| Память / ядра | 2 ГБ / 1, core-fraction 100% |
| Concurrency / provisioned | 13 / 1 |
| Таймаут | 600 с |

## 1. Собрать и запушить образ (машина с Docker и доступом к cr.yandex)

```bash
SHA=$(git rev-parse --short=12 HEAD)
IMAGE=cr.yandex/crpp1bes63avh83rbvte/bmg:$SHA

docker build --no-cache -t "$IMAGE" .
yc container registry configure-docker   # логин в реестр под своим аккаунтом
docker push "$IMAGE"
```

Какой SHA сейчас в проде: у активной ревизии контейнера (образ тегируется SHA коммита).

## 2. Создать ревизию

Консоль (безопаснее, ничего не забыть):

1. Serverless Containers → `bmg-app` → вкладка **Редактор**;
2. подменить URL образа на `cr.yandex/crpp1bes63avh83rbvte/bmg:<SHA>`;
3. проверить параметры: память 2 ГБ, cores 1, core-fraction 100%, concurrency 13,
   provisioned instances 1, timeout 600 с;
4. сверить переменные окружения (в редакторе они подставлены от текущей ревизии —
   сверьте со списком в `.github/workflows/deploy.yml`);
5. «Создать ревизию».

CLI-вариант — `yc serverless container revision deploy`: обязательны
`--container-name bmg-app`, `--image <URL>`, `--service-account-id ajemoq00jglva97nqi47`;
остальные флаги (`--memory`, `--cores`, `--execution-timeout`, `--concurrency`,
provisioned instances) и полный список `--environment KEY=VALUE` берите из workflow,
иначе ревизия создастся с дефолтами (128 МБ памяти) и прод будет работать иначе.

## 3. Проверить

- В консоли: активная ревизия сменилась на новую, статус `ACTIVE`;
- В логах контейнера после следующей выгрузки 1С: `[1C FILE] Принят фрагмент …`,
  `[1C PARTS] Публикую …`, `[1C IMPORT] … Missing: 0`;
- Откат — `docs/ROLLBACK-1C.md` (`yc serverless containers rollback --name bmg-app
  --revision-id <ID>`).
