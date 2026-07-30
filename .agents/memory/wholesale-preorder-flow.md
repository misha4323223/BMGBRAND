---
name: Wholesale preorder invoice flow
description: Как работает оптовый предзаказ — архитектура, ключевые файлы, баг с authMiddleware
---

## Что реализовано

Оптовый предзаказ работает в двух режимах по роли пользователя:
- `retail` — обычный флоу: ЮКасса/Т-Банк, СДЭК, розничные цены
- `wholesale` (+ `wholesaleApproved`) — счёт на email, выбор ТК, оптовые цены, Telegram-уведомление менеджерам

## Затронутые файлы

**Фронтенд:**
- `client/src/pages/ConceptPage.tsx` — карточки предзаказа: оптовая цена через `useWholesalePrice`, DolyameWidget скрыт для оптовиков
- `client/src/pages/ConceptCampaignPage.tsx` — то же самое
- `client/src/pages/PreorderCheckout.tsx` — полный разветвлённый флоу оформления

**Бэкенд:**
- `server/routes.ts`, эндпоинт `POST /api/preorder/order-multi` (~строка 15553) — invoice-ветка перед блоком оплаты

## Логика детекции оптового предзаказа (бэкенд)

```ts
const isWholesalePreorder = !!(
  req.user?.role === "wholesale" &&
  (req.user?.wholesaleApproved === true || req.user?.approved === true) &&
  paymentMethod === "invoice"
);
```

Фронт явно шлёт `paymentMethod: "invoice"` в теле запроса при `isWholesale === true`.

## Критический баг (и фикс)

**Проблема:** `order-multi` был зарегистрирован **без `authMiddleware`**, поэтому `req.user` был всегда `undefined` — условие `isWholesalePreorder` никогда не срабатывало, оптовик попадал в ветку оплаты картой.

**Фикс:** добавить `authMiddleware` к маршруту:
```ts
app.post("/api/preorder/order-multi", authMiddleware, async (req: any, res) => {
```

**Why:** `authMiddleware` не блокирует незалогиненных — если токена нет, просто вызывает `next()`. Поэтому безопасно добавлять его на маршруты с публичным доступом, когда нужна лишь опциональная идентификация пользователя.

**How to apply:** Любой эндпоинт, который должен вести себя по-разному для авторизованных vs анонимных пользователей, обязан иметь `authMiddleware` — даже если авторизация не *требуется*.

## Invoice-ветка на бэкенде

Если `isWholesalePreorder`:
1. Устанавливает статус заказа `pending`
2. Читает VAT-настройки из `bonus_settings` (`invoice_vat_rate`, `invoice_vat_mode`)
3. Вызывает `getNextInvoiceNumber()` + `storage.saveOrderInvoiceNumber()`
4. Запускает `sendInvoiceEmail(...)` (async, ошибки не роняют запрос)
5. Вызывает `notifyNewOrder(...)` с флагом `isWholesale: true` и `transportCompany`
6. Возвращает `{ orderId, invoiceSent: true, isPreorder: true }`

Ветка online-оплаты (`paymentService.createPayment`) пропускается полностью.

## Фронтенд onSuccess

```ts
if (data.invoiceSent) {
  clearCart();
  setLocation(`/order-success/${data.orderId}`);
} else if (data.confirmationToken) { ... }
```

## Цены в оптовом предзаказе

Бэкенд переопределяет цену товара из БД:
```ts
item.price = isWholesalePreorder && product.wholesalePrice
  ? product.wholesalePrice
  : product.price;
```
Цене с клиента не доверяем — она всегда перезаписывается.
