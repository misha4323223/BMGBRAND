import type { Express } from "express";
import { logError } from "../logger";

const COUNTER_ID = "107182693";
const API_BASE = "https://api-metrika.yandex.net";

function authorized(req: any, getAdminKey: () => string | undefined): boolean {
  const supplied = req.headers["x-api-key"];
  return typeof supplied === "string" && supplied.length > 0 && supplied === getAdminKey();
}

async function metrikaRequest(path: string, token: string, params: Record<string, string>) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export function registerYandexMetrikaRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
) {
  // lang=ru — API Метрики отдаёт названия измерений на языке счётчика по умолчанию;
  // явный lang=ru локализует источники трафика («Поисковые системы», «Прямые заходы» и т.д.).
  const route = async (
    req: any,
    res: any,
    path: string,
    params: Record<string, string> = {},
    transform?: (body: any) => any,
  ) => {
    if (!authorized(req, getAdminKey)) return res.status(401).json({ error: "Unauthorized" });
    const token = process.env.YANDEX_METRIKA_OAUTH_TOKEN?.trim();
    if (!token) return res.status(503).json({ configured: false, error: "YANDEX_METRIKA_OAUTH_TOKEN is not configured" });
    try {
      const body = await metrikaRequest(path, token, { ...params, ids: COUNTER_ID, lang: "ru" });
      return res.json(transform ? transform(body) : body);
    } catch (error: any) {
      logError("[Yandex Metrika] API error:", error?.message || error);
      return res.status(502).json({ configured: true, error: error?.message || "Metrika API error" });
    }
  };

  app.get("/api/admin/yandex-metrika/status", async (req, res) => {
    if (!authorized(req, getAdminKey)) return res.status(401).json({ error: "Unauthorized" });
    const token = process.env.YANDEX_METRIKA_OAUTH_TOKEN?.trim();
    if (!token) return res.json({ configured: false, counterId: COUNTER_ID });
    try {
      await metrikaRequest(`/management/v1/counter/${COUNTER_ID}`, token, {});
      return res.json({ configured: true, counterId: COUNTER_ID });
    } catch (error: any) {
      return res.status(502).json({ configured: true, counterId: COUNTER_ID, error: error?.message || "Access check failed" });
    }
  });

  app.get("/api/admin/yandex-metrika/summary", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:ecommerceRevenue,ym:s:ecommercePurchases",
    dimensions: "ym:s:lastsignTrafficSource",
    date1: String(req.query.from || "7daysAgo"),
    date2: String(req.query.to || "today"),
    limit: "100",
  }));

  app.get("/api/admin/yandex-metrika/products", (req, res) =>
    route(req, res, "/stat/v1/data", {
      metrics: "ym:s:ecommercePurchases,ym:s:ecommerceRevenue,ym:s:ecommerceQuantity",
      dimensions: "ym:s:productName",
      date1: String(req.query.from || "30daysAgo"),
      date2: String(req.query.to || "today"),
      sort: "ym:s:ecommerceRevenue",
      limit: "100",
    }, (body) => {
      // Метрика записывает «undefined» для purchase-событий, где название товара не
      // попало в dataLayer. Такие строки не несут информации — убираем их из выдачи,
      // чтобы в панели показывались только реальные товары.
      if (Array.isArray(body?.data)) {
        body.data = body.data.filter((row: any) => {
          const name = row?.dimensions?.[0]?.name;
          return typeof name === "string" && name.trim() !== "" && name.trim().toLowerCase() !== "undefined";
        });
      }
      return body;
    }),
  );

  app.get("/api/admin/yandex-metrika/goals", (req, res) => route(req, res, `/management/v1/counter/${COUNTER_ID}/goals`, {}));
}
