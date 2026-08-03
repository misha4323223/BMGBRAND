---
name: Ozon delivery check field name
description: /v1/delivery/check uses client_phone not customer_phone; protobuf error decoding trick
---

## Rule
`/v1/delivery/check` JSON body field is `client_phone`, not `customer_phone`.

**Why:** Ozon uses protobuf under the hood. Their error message `invalid DeliveryCheckRequest.ClientPhone` is protobuf CamelCase — maps to `client_phone` in JSON. The error text "does not match regex" was misleading; the real issue was the wrong field name causing the field to be missing/empty.

**How to apply:** Any future changes to `checkDelivery()` in `server/ozon-delivery.ts` must use `client_phone` as the JSON key. If Ozon returns a validation error about a field, decode CamelCase → snake_case to find the correct JSON key.
