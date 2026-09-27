import { describe, it, expect } from "vitest";
import { isRetryableYdbError, withYdbRetry } from "../lib/ydb-retry";

// Точная форма ошибки из инцидента 26.09.2026 (алерт «Необработанная ошибка»):
// Aborted (code 400040): [Transaction locks invalidated...] + Operation is aborting...
function locksInvalidatedError(): any {
  const err: any = new Error(
    'Aborted (code 400040): [\n  {\n    "message": "Transaction locks invalidated. Table: `/ru-central1/.../cart_items`.",\n    "issueCode": 2001,\n    "severity": 1\n  },\n  {\n    "message": "Operation is aborting because locks are not valid",\n    "issueCode": 2001,\n    "severity": 1\n  }\n]',
  );
  err.code = 400040;
  err.issues = [
    { message: "Transaction locks invalidated", issueCode: 2001, severity: 1 },
    { message: "Operation is aborting because locks are not valid", issueCode: 2001, severity: 1 },
  ];
  return err;
}

describe("isRetryableYdbError", () => {
  it("распознаёт реальную ошибку из инцидента (400040 / locks invalidated)", () => {
    expect(isRetryableYdbError(locksInvalidatedError())).toBe(true);
  });

  it("распознаёт ошибку только по issues, без маркеров в message", () => {
    const err: any = new Error("some transport wrapper");
    err.issues = [{ message: "Transaction locks invalidated", issueCode: 2001 }];
    expect(isRetryableYdbError(err)).toBe(true);
  });

  it("распознаёт BadSession по имени класса", () => {
    class BadSession extends Error {}
    expect(isRetryableYdbError(new BadSession("session is bad"))).toBe(true);
  });

  it("распознаёт транспортные ошибки (UNAVAILABLE / ETIMEDOUT)", () => {
    expect(isRetryableYdbError(new Error("UNAVAILABLE: No connection established"))).toBe(true);
    expect(isRetryableYdbError(new Error("connect ETIMEDOUT 1.2.3.4:2135"))).toBe(true);
  });

  it("распознаёт RESOURCE_EXHAUSTED (rate limit)", () => {
    expect(isRetryableYdbError(new Error("RESOURCE_EXHAUSTED: request rate exceeded"))).toBe(true);
  });

  it("НЕ считает ретраибельной обычную ошибку", () => {
    expect(isRetryableYdbError(new Error("validation failed"))).toBe(false);
  });

  it("НЕ считает ретраибельной ZodError-подобную ошибку с issues", () => {
    const err: any = new Error("invalid input");
    err.issues = [{ message: "Expected number, received string", code: "invalid_type" }];
    expect(isRetryableYdbError(err)).toBe(false);
  });

  it("false для null/undefined", () => {
    expect(isRetryableYdbError(null)).toBe(false);
    expect(isRetryableYdbError(undefined)).toBe(false);
  });
});

describe("withYdbRetry", () => {
  it("повторяет операцию и возвращает результат после гонки", async () => {
    let calls = 0;
    const result = await withYdbRetry(
      async () => {
        calls++;
        if (calls < 3) throw locksInvalidatedError();
        return "ok";
      },
      { baseDelayMs: 0, label: "test" },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("бросает ПОСЛЕДНЮЮ ошибку после исчерпания попыток (не проглатывает)", async () => {
    let calls = 0;
    await expect(
      withYdbRetry(
        async () => {
          calls++;
          throw locksInvalidatedError();
        },
        { attempts: 3, baseDelayMs: 0, label: "test" },
      ),
    ).rejects.toThrow(/locks invalidated/);
    expect(calls).toBe(3);
  });

  it("НЕ повторяет непоправимые ошибки (одна попытка)", async () => {
    let calls = 0;
    await expect(
      withYdbRetry(
        async () => {
          calls++;
          throw new Error("validation failed");
        },
        { baseDelayMs: 0, label: "test" },
      ),
    ).rejects.toThrow("validation failed");
    expect(calls).toBe(1);
  });

  it("attempts=1 отключает повторы", async () => {
    let calls = 0;
    await expect(
      withYdbRetry(
        async () => {
          calls++;
          throw locksInvalidatedError();
        },
        { attempts: 1, baseDelayMs: 0, label: "test" },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
