import { describe, it, expect } from "vitest";
import {
  OzonDeliveryTokenService,
  OZON_DELIVERY_DEFAULT_SCOPES,
  OZON_DELIVERY_MANDATORY_SCOPES,
  OZON_DELIVERY_TOKEN_URL,
  normalizeOzonExpiresAt,
  parseOzonScopes,
  type OzonAccessToken,
  type OzonTokenServiceOptions,
} from "../ozon-delivery-api/token";
import { OzonDeliveryApiClient } from "../ozon-delivery-api/client";
import { OzonHttpClient } from "../ozon-delivery-api/http";
import {
  OzonDeliveryApiService,
  OZON_DELIVERY_CHECK_CLIENT_PATH,
} from "../ozon-delivery-api/index";
import {
  OZON_DELIVERY_TOKEN_SETTING_KEY,
  YdbOzonTokenStore,
  fingerprintOzonClientId,
  type BonusSettingsAdapter,
  type OzonTokenStore,
} from "../ozon-delivery-api/token-store";

const NOW = 1_700_000_000_000;
const API_URL = "https://api-delivery.ozon.ru/v1/delivery-point/list";

class MemoryTokenStore implements OzonTokenStore {
  value: { clientIdHash: string; token: OzonAccessToken } | null = null;
  saves = 0;
  clears = 0;
  failLoad = false;
  failSave = false;

  async load(clientIdHash: string): Promise<OzonAccessToken | null> {
    if (this.failLoad) throw new Error("YDB unavailable");
    return this.value?.clientIdHash === clientIdHash ? this.value.token : null;
  }

  async save(clientIdHash: string, token: OzonAccessToken): Promise<void> {
    if (this.failSave) throw new Error("YDB unavailable");
    this.value = { clientIdHash, token };
    this.saves++;
  }

  async clear(): Promise<void> {
    this.value = null;
    this.clears++;
  }
}

function makeSettingsAdapter(initial = ""): BonusSettingsAdapter & {
  value: string;
  sets: number;
} {
  return {
    value: initial,
    sets: 0,
    async get(key: string) {
      expect(key).toBe(OZON_DELIVERY_TOKEN_SETTING_KEY);
      return this.value || undefined;
    },
    async set(key: string, value: string) {
      expect(key).toBe(OZON_DELIVERY_TOKEN_SETTING_KEY);
      this.value = value;
      this.sets++;
    },
  };
}

type FetchCall = { url: string; init: RequestInit };

function makeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeTokenService(
  fetchImpl: any,
  overrides: Partial<OzonTokenServiceOptions> = {},
): OzonDeliveryTokenService {
  return new OzonDeliveryTokenService({
    clientId: "client-123456",
    clientSecret: "super-secret",
    fetchImpl,
    now: () => NOW,
    sleep: async () => {},
    timeoutMs: 100,
    store: new MemoryTokenStore(),
    ...overrides,
  });
}

function makeClient(
  fetchImpl: any,
  tokenService: OzonDeliveryTokenService,
): OzonDeliveryApiClient {
  return new OzonDeliveryApiClient({
    tokenService,
    fetchImpl,
    timeoutMs: 100,
    sleep: async () => {},
    attempts: 1,
  });
}

function bodyOf(call: FetchCall): any {
  return JSON.parse(String(call.init.body));
}

describe("normalizeOzonExpiresAt", () => {
  it("понимает абсолютное Unix-время в секундах (как отдаёт боевой Ozon)", () => {
    expect(normalizeOzonExpiresAt(1_800_000_000, NOW)).toBe(1_800_000_000_000);
  });

  it("понимает абсолютное время в миллисекундах", () => {
    expect(normalizeOzonExpiresAt(1_800_000_000_000, NOW)).toBe(
      1_800_000_000_000,
    );
  });

  it("понимает длительность в секундах", () => {
    expect(normalizeOzonExpiresAt(3600, NOW)).toBe(NOW + 3_600_000);
  });

  it("на некорректное значение даёт час", () => {
    expect(normalizeOzonExpiresAt("bad", NOW)).toBe(NOW + 3_600_000);
  });
});

describe("parseOzonScopes", () => {
  it("по умолчанию отдаёт все 8 прав Delivery API", () => {
    expect(parseOzonScopes(undefined)).toEqual([
      ...OZON_DELIVERY_DEFAULT_SCOPES,
    ]);
  });

  it("добавляет delivery-api.* из строки и JSON, убирает дубли", () => {
    const scopes = parseOzonScopes(
      JSON.stringify([
        "delivery-api.order",
        "delivery-api.shipment-method",
        "delivery-api.shipment-method",
      ]),
    );
    expect(scopes).toContain("delivery-api.shipment-method");
    expect(scopes).toHaveLength(OZON_DELIVERY_DEFAULT_SCOPES.length);
  });

  it("игнорирует seller-api.* из старого окружения", () => {
    expect(parseOzonScopes("seller-api.fbs delivery-api.order")).toEqual([
      ...OZON_DELIVERY_DEFAULT_SCOPES,
    ]);
  });
});

describe("OzonDeliveryTokenService", () => {
  it("запрашивает client_credentials и не раскрывает токен/секрет в статусе", async () => {
    const fake = makeFetch(() =>
      json({ access_token: "tok-secret", expires_in: 3600 }),
    );
    const service = makeTokenService(fake.fetchImpl);

    const first = await service.getAccessToken();
    const second = await service.getAccessToken();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);

    const body = bodyOf(fake.calls[0]);
    expect(body.client_id).toBe("client-123456");
    expect(body.client_secret).toBe("super-secret");
    expect(body.grant_type).toBe("client_credentials");
    expect(body.scope).toEqual([...OZON_DELIVERY_DEFAULT_SCOPES]);

    const status = service.getStatus();
    expect(status.scopes).toHaveLength(8);
    expect(status.configured).toBe(true);
    expect(status.authenticated).toBe(true);
    expect(status.expiresInSeconds).toBe(3600);
    expect(status.clientIdMasked).toBe("clie…56");
    expect(JSON.stringify(status)).not.toContain("tok-secret");
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });

  it("повторяет POST после 307 с тем же телом и cookie", async () => {
    let calls = 0;
    const fake = makeFetch(() => {
      calls++;
      if (calls === 1) {
        return new Response("", {
          status: 307,
          headers: {
            location: "https://xapi.ozon.ru/oauth/token/redirect",
            "set-cookie": "ozon_session=abc; Path=/; HttpOnly",
          },
        });
      }
      return json({ access_token: "tok", expires_in: 3600 });
    });
    const service = makeTokenService(fake.fetchImpl);

    const result = await service.getAccessToken();

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].url).toBe(
      "https://xapi.ozon.ru/oauth/token/redirect",
    );
    expect(fake.calls[1].init.body).toBe(fake.calls[0].init.body);
    expect(
      (fake.calls[1].init.headers as Record<string, string>).Cookie,
    ).toContain("ozon_session=abc");
  });

  it("повторяет запрос после 500", async () => {
    let calls = 0;
    const fake = makeFetch(() => {
      calls++;
      return calls === 1
        ? json({ error: "server_error" }, 500)
        : json({ access_token: "tok", expires_in: 3600 });
    });
    const service = makeTokenService(fake.fetchImpl);

    const result = await service.getAccessToken();

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("при invalid_scope повторяет с обязательными правами", async () => {
    let calls = 0;
    const fake = makeFetch(() => {
      calls++;
      return calls === 1
        ? json(
            {
              error: "invalid_scope",
              error_description: "unknown delivery-api.shipment-method",
            },
            400,
          )
        : json({ access_token: "tok", expires_in: 3600 });
    });
    const service = makeTokenService(fake.fetchImpl, {
      scopes: [...OZON_DELIVERY_MANDATORY_SCOPES, "delivery-api.shipment-method"],
    });

    const result = await service.getAccessToken();

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(bodyOf(fake.calls[0]).scope).toHaveLength(
      OZON_DELIVERY_MANDATORY_SCOPES.length + 1,
    );
    expect(bodyOf(fake.calls[1]).scope).toEqual([
      ...OZON_DELIVERY_MANDATORY_SCOPES,
    ]);
  });

  it("не ходит в сеть без Client ID/Secret", async () => {
    const fake = makeFetch(() => json({ access_token: "tok" }));
    const service = makeTokenService(fake.fetchImpl, {
      clientId: "",
      clientSecret: "",
    });

    const result = await service.getAccessToken();

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(service.getStatus().configured).toBe(false);
  });

  it("использует только новые OZON_DELIVERY_API_* env-имена", () => {
    const keys = [
      "OZON_CLIENT_ID",
      "OZON_CLIENT_SECRET",
      "OZON_DELIVERY_API_CLIENT_ID",
      "OZON_DELIVERY_API_CLIENT_SECRET",
    ];
    const saved = keys.map((key) => [key, process.env[key]] as const);
    try {
      process.env.OZON_CLIENT_ID = "legacy-client";
      process.env.OZON_CLIENT_SECRET = "legacy-secret";
      delete process.env.OZON_DELIVERY_API_CLIENT_ID;
      delete process.env.OZON_DELIVERY_API_CLIENT_SECRET;

      const legacyOnly = new OzonDeliveryTokenService({
        store: new MemoryTokenStore(),
      });
      expect(legacyOnly.isConfigured()).toBe(false);

      process.env.OZON_DELIVERY_API_CLIENT_ID = "new-client";
      process.env.OZON_DELIVERY_API_CLIENT_SECRET = "new-secret";
      const withNew = new OzonDeliveryTokenService({
        store: new MemoryTokenStore(),
      });
      expect(withNew.isConfigured()).toBe(true);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("переживает перезапуск: второй сервис берёт токен из YDB без сети", async () => {
    const store = new MemoryTokenStore();
    const firstFake = makeFetch(() =>
      json({ access_token: "tok-persisted", expires_in: 3600 }),
    );
    const first = makeTokenService(firstFake.fetchImpl, { store });
    expect((await first.getAccessToken()).ok).toBe(true);
    expect(store.saves).toBe(1);

    const secondFake = makeFetch(() => {
      throw new Error("network must not be called");
    });
    const second = makeTokenService(secondFake.fetchImpl, { store });
    const restored = await second.getAccessToken();

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.token.accessToken).toBe("tok-persisted");
    expect(secondFake.calls).toHaveLength(0);
    expect(second.getStatus().authenticated).toBe(true);
  });

  it("сохраняет в YDB отпечаток Client ID, а не Client ID/Secret", async () => {
    const store = new MemoryTokenStore();
    const fake = makeFetch(() =>
      json({ access_token: "tok-secret", expires_in: 3600 }),
    );
    const service = makeTokenService(fake.fetchImpl, { store });

    await service.getAccessToken();

    expect(store.value?.clientIdHash).toBe(
      fingerprintOzonClientId("client-123456"),
    );
    const serialized = JSON.stringify(store.value);
    expect(serialized).not.toContain("client-123456");
    expect(serialized).not.toContain("super-secret");
    expect(store.value?.token.accessToken).toBe("tok-secret");
  });

  it("сбой YDB не мешает получить токен", async () => {
    const store = new MemoryTokenStore();
    store.failLoad = true;
    store.failSave = true;
    const fake = makeFetch(() =>
      json({ access_token: "tok-live", expires_in: 3600 }),
    );
    const service = makeTokenService(fake.fetchImpl, { store });

    const result = await service.getAccessToken();

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("YdbOzonTokenStore", () => {
  const clientId = "client-123456";
  const hash = fingerprintOzonClientId(clientId);
  const token: OzonAccessToken = {
    accessToken: "tok-ydb",
    expiresAt: NOW + 3_600_000,
    obtainedAt: NOW,
    scopes: [...OZON_DELIVERY_MANDATORY_SCOPES],
  };

  it("читает валидный токен и не пишет сырой Client ID/токен", async () => {
    const adapter = makeSettingsAdapter();
    const store = new YdbOzonTokenStore(adapter, () => NOW);

    await store.save(hash, token);
    expect(adapter.value).not.toContain(clientId);
    expect(adapter.value).not.toContain("tok-ydb");
    expect(await store.load(hash)).toEqual(token);
  });

  it("игнорирует подменённый шифротекст", async () => {
    const adapter = makeSettingsAdapter();
    const store = new YdbOzonTokenStore(adapter, () => NOW);
    await store.save(hash, token);

    const payload = JSON.parse(adapter.value);
    payload.encryptedAccessToken.data = "AAAA";
    adapter.value = JSON.stringify(payload);

    expect(await store.load(hash)).toBeNull();
    expect(adapter.value).toBe("");
  });

  it("игнорирует и стирает токен другого Client ID", async () => {
    const adapter = makeSettingsAdapter();
    const store = new YdbOzonTokenStore(adapter, () => NOW);
    await store.save(fingerprintOzonClientId("other-client"), token);

    expect(await store.load(hash)).toBeNull();
    expect(adapter.value).toBe("");
  });

  it("игнорирует и стирает истёкший токен", async () => {
    const adapter = makeSettingsAdapter();
    const store = new YdbOzonTokenStore(adapter, () => NOW);
    await store.save(hash, { ...token, expiresAt: NOW - 1 });

    expect(await store.load(hash)).toBeNull();
    expect(adapter.value).toBe("");
  });

  it("игнорирует повреждённый JSON", async () => {
    const adapter = makeSettingsAdapter("{broken");
    const store = new YdbOzonTokenStore(adapter, () => NOW);

    expect(await store.load(hash)).toBeNull();
    expect(adapter.value).toBe("");
  });
});

describe("OzonDeliveryApiClient", () => {
  it("при 401 получает новый токен и повторяет запрос", async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const fake = makeFetch((url) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        tokenCalls++;
        return json({
          access_token: `tok-${tokenCalls}`,
          expires_in: 3600,
        });
      }
      if (url === API_URL) {
        apiCalls++;
        if (apiCalls === 1) {
          return json(
            { error: { code: 16, message: "API access disabled" } },
            401,
          );
        }
        return json(
          { items: [{ id: "1" }] },
          200,
          { "x-o3-trace-id": "trace-42" },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);

    const result = await client.request("/v1/delivery-point/list", {
      pagination: { limit: 1, offset: 0 },
    });

    expect(result.ok).toBe(true);
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(2);
    const lastApiCall = fake.calls.filter((c) => c.url === API_URL).at(-1)!;
    expect(
      (lastApiCall.init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer tok-2");
  });

  it("передаёт Idempotency-Key и сохраняет его при обновлении токена", async () => {
    let apiCalls = 0;
    const fake = makeFetch((url) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        return json({ access_token: "tok-idem", expires_in: 3600 });
      }
      apiCalls++;
      if (apiCalls === 1) {
        return json({ error: { code: 16, message: "expired" } }, 401);
      }
      return json({ order_number: "YY-1" }, 200);
    });
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);
    const key = "11111111-1111-4111-8111-111111111111";

    const result = await client.request(
      "/v1/order/create",
      { postings: [] },
      { "Idempotency-Key": key },
    );

    expect(result.ok).toBe(true);
    expect(apiCalls).toBe(2);
    for (const call of fake.calls.filter((item) =>
      item.url.endsWith("/v1/order/create"),
    )) {
      expect(
        (call.init.headers as Record<string, string>)["Idempotency-Key"],
      ).toBe(key);
      expect(
        (call.init.headers as Record<string, string>).Authorization,
      ).toContain("Bearer tok-idem");
    }
  });

  it("возвращает trace id и ошибку API без тела с секретами", async () => {
    const fake = makeFetch((url) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        return json({ access_token: "tok-secret", expires_in: 3600 });
      }
      return json(
        { error: { code: 7, message: "Access denied" } },
        403,
        { "x-o3-trace-id": "trace-403" },
      );
    });
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);

    const result = await client.request("/v1/delivery-point/list", {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error?.code).toBe("7");
    expect(result.error?.message).toBe("Access denied");
    expect(result.traceId).toBe("trace-403");
    expect(JSON.stringify(result)).not.toContain("tok-secret");
  });
});

describe("OzonDeliveryApiService.checkConnection", () => {
  it("подтверждает токен и доступ к delivery-point/list", async () => {
    const fake = makeFetch((url) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        return json({ access_token: "tok-secret", expires_in: 3600 });
      }
      if (url === API_URL) {
        return json(
          { items: [{ id: "1" }] },
          200,
          { "x-o3-trace-id": "trace-42" },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);
    const service = new OzonDeliveryApiService({ token, client });

    const check = await service.checkConnection();

    expect(check.success).toBe(true);
    expect(check.token.ok).toBe(true);
    expect(check.token.clientIdMasked).toBe("clie…56");
    expect(check.api?.ok).toBe(true);
    expect(check.api?.itemsCount).toBe(1);
    expect(check.api?.traceId).toBe("trace-42");
    expect(JSON.stringify(check)).not.toContain("tok-secret");
  });

  it("показывает успешный токен отдельно от ошибки API", async () => {
    const fake = makeFetch((url) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        return json({ access_token: "tok-secret", expires_in: 3600 });
      }
      return json(
        { error: { code: 7, message: "Access denied" } },
        403,
        { "x-o3-trace-id": "trace-403" },
      );
    });
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);
    const service = new OzonDeliveryApiService({ token, client });

    const check = await service.checkConnection();

    expect(check.success).toBe(false);
    expect(check.token.ok).toBe(true);
    expect(check.api?.ok).toBe(false);
    expect(check.api?.status).toBe(403);
    expect(check.api?.error?.message).toBe("Access denied");
    expect(check.api?.traceId).toBe("trace-403");
  });

  it("без кредитов возвращает not_configured и не вызывает API", async () => {
    const fake = makeFetch(() => json({}));
    const token = makeTokenService(fake.fetchImpl, {
      clientId: "",
      clientSecret: "",
    });
    const service = new OzonDeliveryApiService({ token });

    const check = await service.checkConnection();

    expect(check.success).toBe(false);
    expect(check.token.ok).toBe(false);
    expect(check.token.configured).toBe(false);
    expect(check.token.error?.code).toBe("not_configured");
    expect(check.api).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("OzonHttpClient testcookie", () => {
  it("переносит Domain-cookie между поддоменами Ozon", async () => {
    const fake = makeFetch((url, init) => {
      if (url === "https://xapi.ozon.ru/oauth/token") {
        return new Response("", {
          status: 307,
          headers: {
            location: "https://api-delivery.ozon.ru/v1/delivery-point/list",
            "set-cookie":
              "__Secure-ETC=abc; Domain=.ozon.ru; Path=/; Secure; HttpOnly",
          },
        });
      }
      if (url === "https://api-delivery.ozon.ru/v1/delivery-point/list") {
        expect(
          (init.headers as Record<string, string>).Cookie,
        ).toContain("__Secure-ETC=abc");
        return json({ items: [] });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const client = new OzonHttpClient({
      fetchImpl: fake.fetchImpl,
      attempts: 1,
      sleep: async () => {},
    });

    const result = await client.post("https://xapi.ozon.ru/oauth/token", {});

    expect(result.status).toBe(200);
    expect(result.redirectCount).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });

  it("повторяет 307 без Location, а не отдаёт его наружу", async () => {
    let calls = 0;
    const fake = makeFetch(() => {
      calls++;
      return calls === 1
        ? new Response("", { status: 307 })
        : json({ ok: true });
    });
    const client = new OzonHttpClient({
      fetchImpl: fake.fetchImpl,
      attempts: 2,
      sleep: async () => {},
    });

    const result = await client.post(
      "https://api-delivery.ozon.ru/v1/delivery-point/list",
      {},
    );

    expect(result.status).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });

  it("не отправляет тело с секретом на не-Ozon редирект", async () => {
    const fake = makeFetch(() =>
      new Response("", {
        status: 307,
        headers: { location: "https://evil.example/collect" },
      }),
    );
    const client = new OzonHttpClient({
      fetchImpl: fake.fetchImpl,
      attempts: 2,
      sleep: async () => {},
    });

    const result = await client.post("https://xapi.ozon.ru/oauth/token", {
      client_secret: "secret-value",
    });

    expect(result.redirectError).toContain("не-Ozon");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe("https://xapi.ozon.ru/oauth/token");
  });
});

describe("OzonDeliveryApiService.checkClient", () => {
  function makeServiceForCheck(
    onCheck: (call: FetchCall) => Response | Promise<Response>,
  ) {
    const fake = makeFetch((url, init) => {
      if (url === OZON_DELIVERY_TOKEN_URL) {
        return json({ access_token: "tok-secret", expires_in: 3600 });
      }
      if (
        url ===
        `https://api-delivery.ozon.ru${OZON_DELIVERY_CHECK_CLIENT_PATH}`
      ) {
        return onCheck({ url, init });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);
    return {
      service: new OzonDeliveryApiService({ token, client }),
      fake,
    };
  }

  it("нормализует телефон и подтверждает аккаунт Ozon", async () => {
    const { service, fake } = makeServiceForCheck((call) => {
      expect(JSON.parse(String(call.init.body))).toEqual({
        phone_number: "+79001234567",
      });
      return json({ can_be_delivered: true });
    });

    const result = await service.checkClient("8 (900) 123-45-67");

    expect(result).toMatchObject({
      success: true,
      canBeDelivered: true,
      phoneNumber: "+79001234567",
      status: 200,
    });
    expect(fake.calls.map((call) => call.url)).toContain(
      `https://api-delivery.ozon.ru${OZON_DELIVERY_CHECK_CLIENT_PATH}`,
    );
  });

  it("возвращает понятную ошибку для номера без аккаунта Ozon", async () => {
    const { service } = makeServiceForCheck(() =>
      json({ can_be_delivered: false }),
    );

    const result = await service.checkClient("+7 900 123-45-67");

    expect(result.success).toBe(true);
    expect(result.canBeDelivered).toBe(false);
    expect(result.code).toBe("not_registered");
    expect(result.error).toContain("не зарегистрирован в Ozon");
  });

  it("не пропускает ошибку API как подтверждённый аккаунт", async () => {
    const { service } = makeServiceForCheck(() =>
      json({ error: { message: "Access denied" } }, 403),
    );

    const result = await service.checkClient("+79001234567");

    expect(result.success).toBe(false);
    expect(result.canBeDelivered).toBe(false);
    expect(result.code).toBe("api_error");
    expect(result.status).toBe(403);
    expect(result.error).toBe("Access denied");
  });

  it("не делает сетевой запрос для заведомо неверного телефона", async () => {
    const fake = makeFetch(() => json({ can_be_delivered: true }));
    const token = makeTokenService(fake.fetchImpl);
    const client = makeClient(fake.fetchImpl, token);
    const service = new OzonDeliveryApiService({ token, client });

    const result = await service.checkClient("123");

    expect(result.success).toBe(false);
    expect(result.code).toBe("invalid_phone");
    expect(fake.calls).toHaveLength(0);
  });
});
