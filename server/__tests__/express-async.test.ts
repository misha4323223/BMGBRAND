import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { enableExpressAsyncErrors } from "../lib/express-async";

// Проверяем, что патч Express действительно заворачивает async-хендлеры:
// rejected promise должен попадать в error-middleware (а не в unhandledRejection),
// при этом обычные хендлеры, next() и error-middleware (4 аргумента) не ломаются.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  enableExpressAsyncErrors();

  const app = express();
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/async-ok", async (_req, res) => {
    res.json({ ok: "async" });
  });
  app.get("/boom", async () => {
    throw new Error("boom-async");
  });
  app.get(
    "/with-next",
    (_req, _res, next) => {
      next();
    },
    (_req, res) => {
      res.json({ after: "next" });
    },
  );
  app.use((_req, res) => {
    res.status(404).json({ notFound: true });
  });
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ caught: err.message });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("enableExpressAsyncErrors", () => {
  it("обычный синхронный хендлер работает как раньше", async () => {
    const res = await fetch(`${baseUrl}/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("async-хендлер с успехом работает как раньше", async () => {
    const res = await fetch(`${baseUrl}/async-ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: "async" });
  });

  it("rejected promise уходит в error-middleware (а не в unhandledRejection)", async () => {
    const res = await fetch(`${baseUrl}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ caught: "boom-async" });
  });

  it("error-middleware всё ещё распознаётся (length === 4 сохранён)", async () => {
    const res = await fetch(`${baseUrl}/boom`);
    // Если бы патч потерял length, Express отдал бы свой HTML-обработчик
    expect(res.headers.get("content-type") || "").toContain("application/json");
  });

  it("цепочка хендлеров с next() продолжает работать", async () => {
    const res = await fetch(`${baseUrl}/with-next`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ after: "next" });
  });

  it("fallthrough-роут 404 не задет", async () => {
    const res = await fetch(`${baseUrl}/definitely-missing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ notFound: true });
  });
});
