---
name: Временный режим «сайт на адресе контейнера»
description: TEMP_PUBLIC_ORIGIN — аварийный переключатель, когда домен недоступен, а контейнер работает
---

# TEMP_PUBLIC_ORIGIN (временный режим)

Домен `booomerangs.ru` может быть недоступен (фронт API Gateway), при этом контейнер
`https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net` жив.

`TEMP_PUBLIC_ORIGIN=<адрес контейнера>` переключает на него: cookie входа (без `Domain`,
иначе браузер отбрасывает cookie и вход не держится), возврат оплаты `SuccessURL/FailURL`,
`NotificationURL` вебхука, ссылки в письмах (`rewriteSiteLinks` в `server/email.ts`),
`redirect_uri` Яндекс ID, вебхук Telegram, ссылки ВК, CORS.

Не задано → поведение как раньше (проверяется юнит-тестами `server/__tests__/public-origin.test.ts`).

Вся логика — `server/public-origin.ts`. Включение/выключение и чек-лист проверки —
`docs/TEMP-CONTAINER-MODE.md`. В прод переменная попадает секретом `TEMP_PUBLIC_ORIGIN`
через `.github/workflows/deploy.yml`.

Не покрыто режимом (остаётся на домене): SEO (sitemap, canonical, llms.txt, bot-ssr),
настройки внешних кабинетов (redirect_uri в приложении Яндекс ID).
