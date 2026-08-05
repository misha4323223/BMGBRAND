---
name: Ozon delivery protobuf field mapping
description: Ozon API uses protobuf — decode error CamelCase to find JSON snake_case key; buyer object required for order creation
---

## Rule
Ozon Seller API uses protobuf under the hood. Validation errors like `invalid SomeRequest.FieldName` map to `field_name` in JSON (CamelCase → snake_case).

**Known field mappings:**
- `/v1/delivery/check` → `client_phone` (not `customer_phone`)
- `/v2/order/create` → `buyer: { name, phone }` (NOT flat `customer_name`/`customer_phone` — `OrderCreateRequestV2.Buyer` is a required nested message)
- `/v2/delivery/checkout` → **не использовать**. Поле `delivery_type` обязательно, но любое значение (int `2`, `"TO_PVZ"`, `"DELIVERY_TYPE_PVZ"`, `"DELIVERY_TYPE_TO_PVZ"`) даёт `proto: syntax error (line 1:49)`. Endpoint парсит тело через proto text-парсер, а не JSON. Заменён на `/v1/delivery/check` в методе `checkoutDelivery()`.

**Why:** Ozon HTTP gateway reflects protobuf message structure. Nested protobuf messages become nested JSON objects. If a required nested message is missing entirely, you get `value is required` not a field-level error.

**How to apply:** 
- Any changes to `createOrder()` in `server/ozon-delivery.ts` must send `buyer: { name, phone }` — flat customer fields at top level are silently ignored.
- If Ozon returns a validation error about a field, decode CamelCase → snake_case to find the JSON key. If it says `value is required` on a type (not a primitive), it's a missing nested object.
