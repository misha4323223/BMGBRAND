# Переезд с Yandex Cloud на другую платформу

> План миграции BOOOMERANGS (вычисления, реестр образов, S3, домен, база данных).
> **Статус: план. Ничего не перенесено, действий не выполнялось.**
> Дата подготовки: 9 октября 2026.

---

## 0. Что сейчас живёт в Yandex Cloud

| Компонент | Параметры (из `.github/workflows/deploy.yml`, `docs/DEPLOY-MANUAL.md`) | Заменяемость |
|---|---|---|
| Serverless Containers | контейнер `bmg-app`, 1 ядро / 2 ГБ, core-fraction 100%, concurrency 13, **provisioned 1**, timeout 600 с, каталог `b1g54bhp2g3klqsgpsbp`, сервисный аккаунт `ajemoq00jglva97nqi47` | высокая (обычный Docker) |
| Container Registry | `cr.yandex/crpp1bes63avh83rbvte/bmg:<sha>` | высокая, **но горит** (см. §1) |
| YDB Serverless | env `YDB_ENDPOINT`, `YDB_DATABASE`, `YDB_SA_KEY`; `ydb-sdk` | низкая (YQL вместо SQL) |
| Object Storage | `https://storage.yandexcloud.net/<bucket>/…`, публичный бакет, картинки товаров | высокая (S3 API) |
| Домен и SSL | Certificate Manager + DNS `booomerangs.ru` (см. `MIGRATION_TO_BOOOMERANGS.md`) | высокая |
| CI/CD | GitHub Actions: `yc-actions/yc-cr-login@v3` + `yc-actions/yc-sls-container-deploy@v5`, 56 ссылок на секреты в `revision-env` | высокая |

**От облака не зависят** (переезжают без изменений): ЮKassa, T-Bank, Ozon Pay, CDEK, Ozon Delivery, Telegram/VK, SMTP, 1С CommerceML, Bitrix24, Groq/HF.
**Яндекс-сервисы, но не инфраструктура** (можно оставить): Yandex ID (вход), Метрика (`YANDEX_METRIKA_OAUTH_TOKEN`), YCP «Кнопка Купить» (`server/ycp.ts`).
**Не используется:** `@yandex-cloud/nodejs-sdk` в коде не вызывается — из зависимостей можно убрать.

---

## 1. 🔴 Срочно: закрывается Yandex Container Registry

Источник: [Закрытие сервиса Yandex Container Registry](https://yandex.cloud/ru/docs/container-registry/sunset)

| Дата | Что происходит |
|---|---|
| 13.10.2026 | прекращение новых продаж (существующие пользователи работают дальше) |
| **10.11.2026** | режим read-only: **новые образы загрузить нельзя → автодеплой и hotfix встают** |
| **14.12.2026** | полное выключение сервиса |

Уже задеплоенная ревизия продолжает работать, но обновить, откатить (`docs/ROLLBACK-1C.md`) или пересоздать контейнер станет невозможно. Поэтому задача №1 — перенести реестр **до 10 ноября 2026**.

### 1.1 Cloud Registry — это да, замена Container Registry

[Cloud Registry](https://yandex.cloud/ru/docs/cloud-registry/) — официальный преемник того же сервиса: хранение и распространение Docker-образов (плюс прочие артефакты), IAM-роли, шифрование, оплата за фактически занимаемое место. Новый адрес образов — `registry.yandexcloud.net/<id_реестра>/<имя>:<тег>` (документация: [push](https://yandex.cloud/ru/docs/cloud-registry/operations/docker/push)).

Официальная миграция: [Миграция с Container Registry на Cloud Registry](https://yandex.cloud/ru/docs/container-registry/tutorials/container-registry-migration)

Почему это просто:
- **идентификаторы реестров и адреса Docker-образов сохраняются**, после миграции ссылки в инфраструктуре менять не обязательно;
- по умолчанию включаются **редиректы**: все запросы к `cr.yandex` уходят в Cloud Registry → текущий `deploy.yml` и `docs/DEPLOY-MANUAL.md` продолжают работать **без правок**;
- переносятся метаданные, права доступа, политики IP, политики жизненного цикла, настройки сканирования, алиасы.

Команды (выполнять **до 10 ноября 2026**):

```bash
# Роли на каталог (назначает владелец/администратор):
#   cloud-registry.registries.migrationRunner  — кто запускает миграцию
#   cloud-registry.registries.migrationViewer  — кто следит за статусом
#   container-registry.images.puller / images.pusher — для проверки pull/push
export FOLDER_ID="b1g54bhp2g3klqsgpsbp"
yc cloud-registry v1 migration start-folder "$FOLDER_ID" --async --format json   # вернёт id операции
yc cloud-registry v1 operation get <id_операции>                                 # статус операции
```

Приёмка миграции: общий статус `COMPLETED`, счётчики `failed = 0`, `completed = total` (дашборд: `yc cloud-registry v1 migration get-folder-migration-status-dashboard "$FOLDER_ID"`).

Проверка после миграции:

```bash
yc iam create-token | docker login --username iam --password-stdin cr.yandex
docker pull "cr.yandex/crpp1bes63avh83rbvte/bmg:latest"
```

Хеш скачанного образа должен совпасть с хешем до миграции.

**Что сделать после (обязательно до 14.12.2026):** перейти с `cr.yandex` на `registry.yandexcloud.net`. Меняются **две** привязки в `.github/workflows/deploy.yml`:
1. шаг логина `yc-actions/yc-cr-login@v3` — он логинится в `cr.yandex`; логин на новом адресе по документации — `yc iam create-token | docker login --username iam --password-stdin registry.yandexcloud.net` (нужно проверить, как получить токен из `YC_SA_JSON_CREDENTIALS` в CI);
2. тег образа `cr.yandex/${CR_REGISTRY}/${CR_REPOSITORY}` → `registry.yandexcloud.net/…` (в `deploy.yml` и в `docs/DEPLOY-MANUAL.md`).
Отключить редиректы (только одновременно с правками выше):
```bash
yc cloud-registry v1 migration toggle-folder-redirects "$FOLDER_ID" --enabled=false
```
Пока редиректы включены, старый адрес работает и правки можно не делать. **Не откладывать на 14.12.2026** — адрес `cr.yandex` держится на сервисе, который выключают.

### 1.2 Пошаговая инструкция (простыми словами)

Весь переход — **одна команда + одна проверка**, 15–30 минут работы плюс ожидание статуса. **Сайт при этом не перезапускается и не падает**: переносятся образы, старые адреса продолжают работать через автоматический редирект. Официальный гайд описывает **только CLI** — кнопки в веб-консоли для запуска миграции нет.

**Шаг 1 — установить утилиту `yc` и войти в аккаунт** (на компьютере владельца, один раз, ~2 минуты):
```bash
curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
exec -l $SHELL        # перезапустить оболочку, чтобы подхватился PATH
yc init               # интерактивное создание профиля: откроется браузер, нажать «разрешить»
```
Источник: [Начало работы с CLI](https://yandex.cloud/ru/docs/cli/quickstart) (Linux/macOS; для Windows тот же раздел — там `install.ps1`).

**Шаг 2 — выдать роль в консоли Яндекса** (один раз): каталог `b1g54bhp2g3klqsgpsbp` → Доступ → Добавить участника → роль `cloud-registry.registries.migrationRunner`.

**Шаг 3 — запустить миграцию** (одна строка):
```bash
yc cloud-registry v1 migration start-folder "b1g54bhp2g3klqsgpsbp" --async
```

**Шаг 4 — дождаться статуса** (10–30 минут, терминал можно закрыть):
```bash
yc cloud-registry v1 migration get-folder-migration-status-dashboard "b1g54bhp2g3klqsgpsbp"
```
Нужно увидеть общий статус `COMPLETED` и `failed = 0`.

**Шаг 5 — проверка pull** (команды в §1.1) и затем правки CI (§1.3).

Срок — **до 10 ноября 2026**.

**Кто что делает:**

| Задача | Кто |
|---|---|
| Установка `yc`, логин в аккаунт, выдача роли, запуск команды | **владелец** — нужен доступ к аккаунту Яндекс Облака; ключи/токены агенту не передаются |
| Подготовка скрипта, правки `.github/workflows/deploy.yml` и `docs/DEPLOY-MANUAL.md`, проверки | агент (сразу после шага 4) |
| `docker pull` для сверки хеша | машина с Docker — в песочнице нет ни `yc`, ни `docker` |

### 1.3 Если решаем уходить из Яндекса совсем

Тогда вместо §1.1 — сразу пушить образ в реестр нового провайдера (`docker pull cr.yandex/…` → `docker tag` → `docker push <новый-реестр>`), Dockerfile не пересобирается. Но резервную миграцию в Cloud Registry всё равно стоит сделать: это страховка и заодно тест всего процесса.

---

## 2. Куда переезжать (шортлист)

Жёсткое требование: **никакого scale-to-zero** (у нас SSR для ботов и прогретые in-memory кэши) и **один постоянно живой инстанс** (см. §5, фоновые задачи живут в процессе).

| Платформа | Вычисления | Managed PostgreSQL | S3 | Комментарий |
|---|---|---|---|---|
| **Timeweb Cloud** | App Platform принимает Dockerfile, свой домен + Let's Encrypt | PostgreSQL 14–18, реплики, бэкапы (6 ₽/ГБ) | 10 ГБ — 79 ₽/мес, 100 ГБ — 349 ₽/мес, 100 ГБ egress бесплатно | самый простой деплой; уточнить письменно цену конфигурации 2 ГБ и отсутствие автоостанова |
| **Selectel** | VM (или Managed Kubernetes) | PostgreSQL 15–18, реплики, PITR | S3 + CDN с HTTPS и своим доменом | явные заявления по 152-ФЗ (УЗ-1); видимый стартовый DBaaS (2 vCPU/12 ГБ, ~7 570 ₽/мес) избыточен — торговать минимальный профиль |
| **VK Cloud** | Managed Containers = Kubernetes (не PaaS) | PostgreSQL 10–17 | S3 + CDN, привязка домена, объекты `public-read` | цены только через калькулятор |
| **Cloud.ru Evolution** | VM / Managed Kubernetes | по ресурсам (~1 730 ₽/мес за 1 vCPU/1 ГБ/30 ГБ по тарифу, оценка) | AWS-совместимый, первые 15 ГБ хранения и 10 ТБ egress бесплатно | уточнить публичный CDN-домен для картинок |

Предварительный выбор: **Timeweb** (приоритет простоты) или **Selectel** (приоритет надёжности и 152-ФЗ). «Serverless»-варианты не рассматривать.

---

## 3. База данных: три сценария

Объём работ (честно, пересчитано по коду 2026-10-09): **726 параметризованных YQL-запросов** (`DECLARE $`), 274 вызова `executeQuery(` и 226 вызова `safeQuery(`; YDB/YQL упоминается в **56 файлах**. Storage-слой — **9 712 строк в 19 файлах** `server/storage/*`. `UPSERT INTO` — 39 мест, `Utf8` — 477 упоминаний. Единая точка входа — `DatabaseStorage.safeQuery()` в `server/storage/core.ts`. Drizzle-схема PostgreSQL уже есть (`shared/schema.ts`, 30+ `pgTable`, `server/pg-db.ts`), но она из шаблона и требует сверки с боевой схемой YDB (она задаётся `CREATE TABLE`/`ALTER` в `server/routes.ts`).

| | Что делаем | Плюсы / минусы |
|---|---|---|
| **1. «Эвакуация»** (~1 неделя) | Образ, S3, домен, секреты → новая платформа. YDB остаётся в Яндексе (её публичный endpoint доступен извне) | код почти не меняется; риск закрытия YC-сервисов закрыт. Минус: платим двум провайдерам, +сетевые задержки gRPC |
| **2. YDB OSS на своей ВМ** (2–3 недели) | YDB — open source, single-node Docker; меняются только endpoint/ключ | запросы не трогаем вообще; минусы: single-node официально для дев/тестов, свой админ, прожорливо по RAM |
| **3. PostgreSQL** (1,5–3 месяца) | Managed PostgreSQL + перенос данных + переписывание YQL | правильная цель: дешевле, бэкапы/PITR, SQL-стандарт, переносимость между провайдерами |

**Рекомендация: разделить два риска.** Риск «YC-сервис закрылся» — сценарий 1 (неделя, без изменений кода). Риск «мы заперты в YDB» — сценарий 3 как отдельный спокойный проект. Сценарий 2 — тактический костыль на случай срочного ухода любой ценой.

Для переноса данных S1→S3: официальный [Yandex Data Transfer: YDB → PostgreSQL](https://yandex.cloud/ru/docs/managed-postgresql/tutorials/ydb-to-postgresql) (приёмником можно указать внешний PostgreSQL) либо `ydb CLI export` → CSV/Parquet → `COPY`.

---

## 4. План работ по фазам

- [ ] **Фаза 0 (эта неделя, 1–2 дня):**
  - [ ] миграция реестра образов в Cloud Registry — пошагово см. §1.1–§1.2, **до 10.11.2026**;
  - [ ] резервная копия YDB — **экспортного скрипта в `scripts/` сейчас нет вообще**, написать;
  - [ ] выгрузка бакета S3 (`rclone copy`, не `sync`; листинг публичного бакета без ключей недоступен → копировать с ключами).
- [ ] **Фаза 1 (1–2 недели):** зеркальная среда на новой платформе, поднятая **на боевой YDB**. Ноль риска для прода; проверяем контейнер, S3, секреты, домен, CI/CD.
- [ ] **Фаза 2 (2–4 недели):** Postgres-слой по доменам в порядке возрастания риска: `page_settings`/`legal` → `products`/`cart` → **`orders`/`partners`/`commissions`/`payouts` последними**.
- [ ] **Фаза 3:** перенос данных + сверка: количество строк и контрольные суммы по каждой таблице, выборочно JSON в `page_settings`, выборочные заказы и партнёры.
- [ ] **Фаза 4:** переключение ночью (короткое окно), старый контейнер и YDB — в тёплый резерв на 1–2 недели, не удалять.
- [ ] **Фаза 5:** вывод Яндекса из эксплуатации после 2–4 недель стабильной работы.

Порядок секретов к переносу — из `revision-env` в `.github/workflows/deploy.yml` (56 переменных) плюс `YANDEX_STORAGE_*` (заменяются на ключи нового S3) и `CDN_URL`.

---

## 5. Подводные камни

1. **`page_settings` — весь контент и дизайн сайта.** Ключи: `home`, `navbar`, `footer`, `artist_pages`, `seo`, `static_pages`, `product_feature_templates`, `deleted_slugs`, `site_config`, `checkout`, `blog_pages`. Тип в YDB — `settings Json` → в PostgreSQL `jsonb`. Терять строки нельзя, сверка обязательна. Код местами читает `settings` строкой, местами объектом — проверить до переключения, иначе пустые блоки на главной.
2. **URL картинок внутри контента.** `storage.yandexcloud.net` встречается 77 раз в коде и в данных. Самый безопасный путь — сохранить прежний домен/путь и переключить через существующий `CDN_URL` + `toCdnUrl()` (`server/storage/core.ts`); либо отдельная замена по данным.
3. **Нельзя `replicas: 3`.** Планировщик предзаказов, брошенные корзины, `order-notify-watcher`, autonomous-agent живут в процессе и размножатся кратно. Либо один инстанс, либо выносить воркер.
4. **Кэши прогреваются на старте** (`server/index.ts`). Любой холодный старт = медленный SSR и риск для ботов → отсюда требование «всегда прогрето».
5. **Легаси: `orders.partner_id` в YDB — `Utf8?`, не число.** В PostgreSQL колонка должна стать `text`, иначе заказы потеряют привязку к партнёрам. См. также `.agents/memory/ydb-int64-bigint.md` (BigInt в INT64 писался нулём).
6. **ID генерируются приложением** (стиль `Date.now()`) — при переносе проверить уникальность/PK и не завести sequence, который начнёт выдавать занятые значения.
7. **YQL → SQL различия:** `UPSERT INTO` → `INSERT … ON CONFLICT`, `Utf8`/`Utf8?`/`Int64`/`Uint64` → `text`/`bigint`/`numeric`, именованные `$param` → `$1`, ретраи `server/lib/ydb-retry.ts` + `shouldReconnectYdb` → пул `pg`.
8. **Персональные данные** покупателей и партнёров: с новым провайдером нужен договор поручения на обработку ПДн и размещение в РФ (152-ФЗ).
9. **Цены** у Selectel/VK/Timeweb/MWS подтвердить в консоли или коммерческим предложением — из тарифных страниц они извлекаются частично.

---

## 6. Ссылки

- Закрытие Container Registry: https://yandex.cloud/ru/docs/container-registry/sunset
- Миграция на Cloud Registry: https://yandex.cloud/ru/docs/container-registry/tutorials/container-registry-migration
- Cloud Registry (сервис): https://yandex.cloud/ru/docs/cloud-registry/
- Docker push в Cloud Registry: https://yandex.cloud/ru/docs/cloud-registry/operations/docker/push
- Data Transfer YDB → PostgreSQL: https://yandex.cloud/ru/docs/managed-postgresql/tutorials/ydb-to-postgresql
- YDB CLI export/import: https://ydb.tech/docs/en/reference/ydb-cli/export-import/
- rclone между S3: https://rclone.org/s3/
