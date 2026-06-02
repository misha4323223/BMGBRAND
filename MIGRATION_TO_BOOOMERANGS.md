# Переход на домен booomerangs.ru

> Полная инструкция по переключению сайта на домен **booomerangs.ru**.  
> После выполнения всех шагов сайт будет работать **только** на `booomerangs.ru`.  
> Выполнять строго по порядку.

---

## 1. Яндекс Облако — подключение домена

### 1.1 Контейнер / API Gateway
1. Открыть [Яндекс Облако → Serverless Containers](https://console.yandex.cloud/)
2. Добавить домены `booomerangs.ru` и `www.booomerangs.ru` в настройки контейнера
3. Убедиться, что контейнер принимает запросы по обоим доменам

### 1.2 SSL-сертификат
1. В разделе **Certificate Manager** создать сертификат для `booomerangs.ru` и `www.booomerangs.ru`
2. Дождаться статуса `ISSUED`
3. Привязать сертификат к контейнеру / API-шлюзу

### 1.3 DNS-записи
В панели управления DNS для домена `booomerangs.ru` добавить:
```
A/CNAME  @    →  IP-адрес или CNAME контейнера в Яндекс Облаке
A/CNAME  www  →  IP-адрес или CNAME контейнера в Яндекс Облаке
```
Распространение DNS: от 15 минут до 24 часов.

### 1.4 Проверка
Открыть `https://www.booomerangs.ru` в браузере — сайт должен работать.

---

## 2. Переменные окружения (Replit Secrets + Яндекс Облако)

Обновить в **обоих местах** — в Replit Secrets и в переменных окружения контейнера Яндекс Облака:

| Переменная   | Старое значение                  | Новое значение                    |
|--------------|----------------------------------|-----------------------------------|
| `SITE_URL`   | `https://www.brandbmg.ru`        | `https://www.booomerangs.ru`      |
| `APP_DOMAIN` | `https://www.brandbmg.ru`        | `https://www.booomerangs.ru`      |
| `EMAIL_FROM` | `noreply@brandbmg.ru`            | `noreply@booomerangs.ru`          |
| `SMTP_USER`  | (старый ящик на brandbmg.ru)     | (новый ящик на booomerangs.ru)    |
| `SMTP_PASS`  | (пароль старого ящика)           | (пароль нового ящика)             |

> После изменения переменных в Яндекс Облаке нужно **пересобрать и задеплоить** контейнер.

---

## 3. Изменения в коде

### 3.1 server/config.ts — дефолтные значения

Заменить:
```typescript
domain: process.env.APP_DOMAIN || 'https://www.brandbmg.ru',
from: process.env.EMAIL_FROM || 'noreply@brandbmg.ru',
```
На:
```typescript
domain: process.env.APP_DOMAIN || 'https://www.booomerangs.ru',
from: process.env.EMAIL_FROM || 'noreply@booomerangs.ru',
```

### 3.2 server/index.ts — CORS и разрешённые домены

Заменить:
```typescript
'https://brandbmg.ru',
'https://www.brandbmg.ru',
```
На:
```typescript
'https://booomerangs.ru',
'https://www.booomerangs.ru',
```

Удалить строки-заглушки (строки ~70–71), они больше не нужны:
```typescript
// Domain redirect placeholder — disabled while on brandbmg.ru
// Enable when migrating to booomerangs.ru
```

### 3.3 server/routes.ts — все baseUrl и тексты

**Строка ~622** — baseUrl для уведомлений о снижении цены:
```typescript
// Было:
const baseUrl = process.env.SITE_URL || 'https://www.brandbmg.ru';
// Стало:
const baseUrl = process.env.SITE_URL || 'https://www.booomerangs.ru';
```

**Строка ~1529** — Telegram wholesale webhook (домен-зависимый!):
```typescript
// Было:
const tgWebhookBase = process.env.APP_DOMAIN || process.env.SITE_URL || 'https://www.brandbmg.ru';
// Стало:
const tgWebhookBase = process.env.APP_DOMAIN || process.env.SITE_URL || 'https://www.booomerangs.ru';
```

**Строка ~2276** — текст в письме о подарочной карте:
```
// Было:
...на сайте brandbmg.ru
// Стало:
...на сайте booomerangs.ru
```

**Строка ~4658** — baseUrl для уведомлений о предзаказах (1С-синхронизация):
```typescript
// Было:
const baseUrl = process.env.SITE_URL || 'https://www.brandbmg.ru';
// Стало:
const baseUrl = process.env.SITE_URL || 'https://www.booomerangs.ru';
```

### 3.4 server/email.ts — все ссылки в email-шаблонах

Выполнить глобальную замену во всём файле:
```bash
sed -i 's|brandbmg\.ru|booomerangs.ru|g' server/email.ts
```

Затронутые шаблоны (все перечислены для контроля):
| Функция | Что содержит |
|---------|-------------|
| `getGiftCardPaidEmailHtml` | Ссылка на сайт + инструкция по использованию |
| `getGiftCardReceivedEmailHtml` | Ссылка на сайт + инструкция |
| `getOrderPaidEmailHtml` | Ссылка на ЛК (`/profile`) + подпись |
| `getPreorderDepositEmailHtml` | Ссылка на ЛК + подпись |
| `getPreorderDepositPaidEmailHtml` | Ссылка на ЛК + подпись |
| `getPreorderRemainingPaidEmailHtml` | Ссылка на ЛК + подпись |
| `getPreorderStatusEmailHtml` | Ссылка на ЛК + подпись |
| `getStockNotificationEmailHtml` | Ссылка на товар |
| `sendPriceDropEmail` | Ссылка на товар |
| `getPreorderNotificationEmailHtml` | Ссылка на Pre-drop страницу |

После замены убедиться командой:
```bash
grep -n "brandbmg" server/email.ts
```
Вывод должен быть пустым.

---

## 4. Фронтенд — проверка

Эти файлы **уже содержат** ссылки на `booomerangs.ru`, менять ничего не нужно:

- `client/src/pages/Terms.tsx` — оферта
- `client/src/pages/Privacy.tsx` — политика конфиденциальности
- `client/src/pages/FAQ.tsx` — `info@booomerangs.ru`
- `client/src/pages/WholesaleProfile.tsx` — `m.pimashin@booomerangs.ru`
- `client/src/pages/WholesaleRegister.tsx` — `m.pimashin@booomerangs.ru`
- `client/src/pages/GiftCards.tsx` — ссылки на оферту/политику
- `client/src/components/CheckoutEditor.tsx` — дефолты ссылок
- `client/src/components/FooterEditor.tsx` — email в футере

---

## 5. Внешние сервисы

### 5.1 ЮKassa
1. Открыть [Личный кабинет ЮKassa → HTTP-уведомления](https://yookassa.ru/my/merchant/integration/http-notifications)
2. Обновить URL вебхука:
   ```
   https://www.booomerangs.ru/api/webhooks/yookassa
   ```
3. **Магазин → Настройки** → обновить URL сайта: `https://www.booomerangs.ru`
4. Проверить, что вебхук получает события `payment.succeeded` и `payment.canceled`

### 5.2 T-Bank (Тинькофф)
Вебхук для T-Bank формируется **автоматически** из переменной `APP_DOMAIN` — после обновления переменной URL вебхука обновится сам.

Но дополнительно в личном кабинете T-Bank:
1. Открыть настройки терминала
2. Проверить и обновить **SuccessURL** и **FailURL** если они зафиксированы вручную:
   ```
   SuccessURL: https://www.booomerangs.ru/order-success/{orderId}
   FailURL:    https://www.booomerangs.ru/
   ```
3. Аналогично для **подарочных сертификатов** — T-Bank webhook для гифт-карт обрабатывается тем же обработчиком `/api/webhooks/tbank`, домен-зависимости нет, но return URL задаётся автоматически из `APP_DOMAIN`.

### 5.3 Postbox / SMTP (почта)

Сайт отправляет письма через SMTP-сервис (Postbox). Письма уходят по следующим событиям:
- Подтверждение email при регистрации
- Оплата заказа
- Статус предзаказа (депозит, доплата, изменение статуса)
- Уведомление о поступлении товара
- Уведомление о снижении цены
- Подписка на предзаказы (при открытии нового предзаказа)
- Подарочные сертификаты (покупателю и получателю)
- Сброс пароля

**Что нужно сделать:**
1. В Postbox (или у провайдера SMTP) добавить и верифицировать домен **`booomerangs.ru`**
2. Получить у провайдера DNS-записи для домена и добавить в DNS `booomerangs.ru`:
   - **MX-запись** (для входящей почты, если нужна)
   - **SPF-запись** — разрешает Postbox отправлять от имени домена
   - **DKIM-запись** — подпись для защиты от спама
   - **DMARC-запись** (рекомендуется) — политика обработки
3. Создать (или настроить алиас) почтовый ящик **`noreply@booomerangs.ru`**
4. Обновить секреты в Replit и Яндекс Облаке:
   ```
   EMAIL_FROM = noreply@booomerangs.ru
   SMTP_HOST  = (хост Postbox — не меняется)
   SMTP_PORT  = (порт — не меняется)
   SMTP_USER  = (логин нового ящика)
   SMTP_PASS  = (пароль нового ящика)
   ```
5. После деплоя отправить тестовое письмо через форму регистрации или сброс пароля

### 5.4 Telegram-боты

В проекте два Telegram-взаимодействия:

**a) Уведомления в чат (notifyNewOrder, notifyPreorderDeposit и т.д.)**  
Работают через Bot API по токену — **не зависят от домена**. Менять ничего не нужно.

**b) Wholesale webhook (`/api/auth/telegram/webhook`)**  
Этот адрес **зависит от домена** — при старте сервер регистрирует вебхук в Telegram:
```
https://www.booomerangs.ru/api/auth/telegram/webhook
```
После обновления `APP_DOMAIN` и перезапуска контейнера вебхук перерегистрируется **автоматически**.  
Проверить в логах при старте:
```
[Telegram] Wholesale webhook registered: https://www.booomerangs.ru/api/auth/telegram/webhook
```

### 5.5 CDEK
Авторизация CDEK через OAuth-токен — **не зависит от домена**. Ничего не нужно менять.

### 5.6 Яндекс Доставка
Авторизация по API-ключу — **не зависит от домена**. Ничего не нужно менять.

### 5.7 Bitrix24
Если в Bitrix24 настроен входящий вебхук с адресом `brandbmg.ru`:
1. Открыть Bitrix24 → Приложения → Вебхуки
2. Обновить URL на `booomerangs.ru`

### 5.8 1С синхронизация
Если в настройках 1С прописан URL сервера — обновить:
```
https://www.booomerangs.ru/api/1c/sync
```
Ключи синхронизации (`SYNC_API_KEY`, `ADMIN_API_KEY`) — **не меняются**.

---

## 6. SEO — переезд в поисковиках

1. Добавить `booomerangs.ru` в [Google Search Console](https://search.google.com/search-console)
2. Загрузить sitemap: `https://www.booomerangs.ru/sitemap.xml`
3. Добавить `booomerangs.ru` в [Яндекс Вебмастер](https://webmaster.yandex.ru/)
4. Загрузить sitemap в Яндекс Вебмастер
5. В Google Search Console для старого домена `brandbmg.ru` — указать смену адреса на `booomerangs.ru` (инструмент «Смена адреса»), если ранее индексировался

---

## 7. Деплой

После выполнения всех шагов в коде:
1. В Яндекс Облаке обновить переменные окружения контейнера (`SITE_URL`, `APP_DOMAIN`, `EMAIL_FROM`, `SMTP_USER`, `SMTP_PASS`)
2. Пересобрать контейнер с новым кодом
3. Задеплоить
4. Проверить что `https://www.booomerangs.ru` открывается

---

## 8. Тестирование после деплоя

Пройти по каждому пункту вручную:

| Тест | Что проверить |
|------|---------------|
| Открытие сайта | `https://www.booomerangs.ru` → главная страница |
| Регистрация | Email подтверждения приходит с `noreply@booomerangs.ru` |
| Сброс пароля | Письмо приходит, ссылка ведёт на `booomerangs.ru` |
| Оплата ЮKassa | Тестовый заказ → оплата → webhook получен → email о заказе |
| Оплата T-Bank | Тестовый заказ → оплата → webhook → email |
| Оплата подарочного сертификата | Оба email (покупатель + получатель) приходят с правильным доменом |
| Предзаказ | Оформить предзаказ → email о депозите → смена статуса → email об изменении |
| Подписка на предзаказы | Подписаться на `/concept` → включить предзаказ в админке → письмо пришло |
| Уведомление о поступлении | Подписаться на товар → прийти email с правильной ссылкой на товар |
| Снижение цены | Подписаться → изменить цену → письмо с правильной ссылкой |
| Telegram wholesale | Зайти через Telegram → убедиться что вход работает |
| Telegram уведомления | Оформить заказ → уведомление пришло в чат |
| CDEK | Оформить доставку → трекинг работает |
| 1С | Запустить синхронизацию → товары обновились |

---

## 9. Финальный чеклист

**Инфраструктура:**
- [ ] DNS-записи для `booomerangs.ru` настроены и распространились
- [ ] SSL-сертификат выпущен (статус `ISSUED`) и привязан
- [ ] Переменные `SITE_URL`, `APP_DOMAIN`, `EMAIL_FROM`, `SMTP_USER`, `SMTP_PASS` обновлены в Replit и Яндекс Облаке

**Код:**
- [ ] `server/config.ts` — дефолтный домен и email обновлены
- [ ] `server/index.ts` — CORS-список обновлён, строки-заглушки удалены
- [ ] `server/routes.ts` — все 4 вхождения `brandbmg.ru` заменены
- [ ] `server/email.ts` — все вхождения `brandbmg.ru` заменены (проверить: `grep "brandbmg" server/email.ts`)
- [ ] Контейнер пересобран и задеплоен

**Внешние сервисы:**
- [ ] ЮKassa: webhook URL обновлён → `booomerangs.ru/api/webhooks/yookassa`
- [ ] T-Bank: SuccessURL и FailURL проверены
- [ ] Postbox/SMTP: домен `booomerangs.ru` верифицирован, SPF/DKIM/DMARC настроены
- [ ] Ящик `noreply@booomerangs.ru` создан и работает
- [ ] Telegram wholesale webhook перерегистрировался (видно в логах при старте)
- [ ] Bitrix24: вебхуки обновлены (если были)
- [ ] 1С: URL синхронизации обновлён (если был прописан)

**Тестирование:**
- [ ] Тестовый заказ: оформление → оплата → email → отображение в ЛК
- [ ] Email о предзаказе приходит с правильным доменом
- [ ] Email подписки на предзаказы работает
- [ ] Уведомления о поступлении и снижении цены — ссылки правильные
- [ ] Google Search Console и Яндекс Вебмастер: новый домен добавлен
