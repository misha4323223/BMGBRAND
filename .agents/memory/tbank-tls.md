---
name: T-Bank TLS certificate issue
description: T-Bank (Tinkoff) uses Russian national CA (Минцифры) not trusted by Node.js default CA store; fix applied in payments.ts
---

## Rule
`fetch` calls to `securepay.tinkoff.ru` fail with `SSL certificate problem: self-signed certificate in certificate chain` because T-Bank's cert is signed by the Russian national CA (Минцифры/Минкомсвязи), which is NOT in Node.js's default CA bundle.

Symptoms: `fetch failed` error in ~26ms (immediate TLS rejection).

**Why:** After 2022, Russian companies lost access to Western CAs. T-Bank migrated to the Russian national CA (Минцифры root cert), which is not included in OpenSSL or Node.js by default — neither on Replit nor on Yandex Cloud containers.

**Fix applied in `server/payments.ts`:**
```typescript
import { Agent } from "undici";
const tbankTlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

// Pass to both Init and GetState fetch calls:
await fetch(url, { ..., dispatcher: tbankTlsAgent });
```

**How to apply:**
- Any new fetch calls to `securepay.tinkoff.ru` or `rest-api-test.tinkoff.ru` must use `dispatcher: tbankTlsAgent`.
- This disables cert verification ONLY for T-Bank calls — all other connections remain verified.
- Alternative (more secure): add the Минцифры root cert via `NODE_EXTRA_CA_CERTS` env var pointing to the PEM file.
