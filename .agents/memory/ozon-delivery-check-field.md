---
name: Ozon delivery protobuf field mapping
description: Ozon API uses protobuf — decode error CamelCase to find JSON snake_case key; buyer object required for order creation
---

## Rule
Ozon Seller API uses protobuf under the hood. Validation errors like `invalid SomeRequest.FieldName` map to `field_name` in JSON (CamelCase → snake_case).

**Known field mappings:**
- `/v1/delivery/check` → `client_phone` (not `customer_phone`)
- `/v2/order/create` → `buyer: { name, phone }` (NOT flat `customer_name`/`customer_phone` — `OrderCreateRequestV2.Buyer` is a required nested message)
- `/v2/delivery/checkout` → поле `delivery_type` **не нужно** — ни строка `"TO_PVZ"`, ни число `2` не принимаются (proto syntax error). Тип доставки Ozon определяет сам по наличию `pvz_id`.

**Why:** Ozon HTTP gateway reflects protobuf message structure. Nested protobuf messages become nested JSON objects. If a required nested message is missing entirely, you get `value is required` not a field-level error.

**How to apply:** 
- Any changes to `createOrder()` in `server/ozon-delivery.ts` must send `buyer: { name, phone }` — flat customer fields at top level are silently ignored.
- If Ozon returns a validation error about a field, decode CamelCase → snake_case to find the JSON key. If it says `value is required` on a type (not a primitive), it's a missing nested object.
