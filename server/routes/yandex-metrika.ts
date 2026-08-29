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

// Метрика записывает «undefined» для purchase-событий, где название товара не
// попало в dataLayer. Такие строки не несут информации — убираем их из выдачи,
// чтобы в панели показывались только реальные товары.
function dropUndefinedProductRows(body: any): any {
  if (Array.isArray(body?.data)) {
    body.data = body.data.filter((row: any) => {
      const name = row?.dimensions?.[0]?.name;
      return typeof name === "string" && name.trim() !== "" && name.trim().toLowerCase() !== "undefined";
    });
  }
  return body;
}

export function registerYandexMetrikaRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
) {
  // lang=ru — API Метрики отдаёт названия измерений на языке счётчика по умолчанию;
  // явный lang=ru локализует источники трафика, города и т.д.
  const route = async (
    req: any,
    res: any,
    path: string,
    params: Record<string, string> = {},
    transform?: (body: any) => any,
    // Для маршрутов, которым нужно несколько запросов к API Метрики:
    // fetchFn получает токен и готовые параметры, возвращает тело ответа.
    fetchFn?: (token: string, params: Record<string, string>) => Promise<any>,
  ) => {
    if (!authorized(req, getAdminKey)) return res.status(401).json({ error: "Unauthorized" });
    const token = process.env.YANDEX_METRIKA_OAUTH_TOKEN?.trim();
    if (!token) return res.status(503).json({ configured: false, error: "YANDEX_METRIKA_OAUTH_TOKEN is not configured" });
    try {
      const body = fetchFn
        ? await fetchFn(token, { ...params, ids: COUNTER_ID, lang: "ru" })
        : await metrikaRequest(path, token, { ...params, ids: COUNTER_ID, lang: "ru" });
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

  // Сводка по источникам трафика (7 дней по умолчанию)
  app.get("/api/admin/yandex-metrika/summary", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:ecommerceRevenue,ym:s:ecommercePurchases",
    dimensions: "ym:s:lastsignTrafficSource",
    date1: String(req.query.from || "7daysAgo"),
    date2: String(req.query.to || "today"),
    limit: "100",
  }));

  // Товары электронной коммерции (30 дней по умолчанию)
  app.get("/api/admin/yandex-metrika/products", (req, res) =>
    route(req, res, "/stat/v1/data", {
      metrics: "ym:s:ecommercePurchases,ym:s:ecommerceRevenue,ym:s:ecommerceQuantity",
      dimensions: "ym:s:productName",
      date1: String(req.query.from || "30daysAgo"),
      date2: String(req.query.to || "today"),
      sort: "ym:s:ecommerceRevenue",
      limit: "100",
    }, dropUndefinedProductRows),
  );

  // График визитов/выручки/покупок по дням (ТЗ: dimension ym:s:date)
  app.get("/api/admin/yandex-metrika/daily", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:ecommerceRevenue,ym:s:ecommercePurchases",
    dimensions: "ym:s:date",
    date1: String(req.query.from || "30daysAgo"),
    date2: String(req.query.to || "today"),
    sort: "ym:s:date",
    limit: "100",
  }));

  // Продажи товара по дням — композитная разбивка товар × дата (ТЗ)
  app.get("/api/admin/yandex-metrika/product-dates", (req, res) =>
    route(req, res, "/stat/v1/data", {
      metrics: "ym:s:ecommercePurchases,ym:s:ecommerceRevenue,ym:s:ecommerceQuantity",
      dimensions: "ym:s:productName,ym:s:date",
      date1: String(req.query.from || "30daysAgo"),
      date2: String(req.query.to || "today"),
      sort: "ym:s:date",
      limit: "200",
    }, dropUndefinedProductRows),
  );

  // Популярные страницы входа
  app.get("/api/admin/yandex-metrika/pages", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:pageviews",
    dimensions: "ym:s:startURL",
    date1: String(req.query.from || "7daysAgo"),
    date2: String(req.query.to || "today"),
    sort: "-ym:s:visits",
    limit: "20",
  }));

  // Устройства (смартфоны/десктопы/планшеты)
  app.get("/api/admin/yandex-metrika/devices", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:users,ym:s:bounceRate",
    dimensions: "ym:s:deviceCategory",
    date1: String(req.query.from || "7daysAgo"),
    date2: String(req.query.to || "today"),
    limit: "10",
  }));

  // Города
  app.get("/api/admin/yandex-metrika/geo", (req, res) => route(req, res, "/stat/v1/data", {
    metrics: "ym:s:visits,ym:s:users",
    dimensions: "ym:s:regionCity",
    date1: String(req.query.from || "7daysAgo"),
    date2: String(req.query.to || "today"),
    sort: "-ym:s:visits",
    limit: "15",
  }));

  // Цели счётчика
  app.get("/api/admin/yandex-metrika/goals", (req, res) => route(req, res, `/management/v1/counter/${COUNTER_ID}/goals`, {}));

  // Статистика целей: сколько раз сработала каждая цель за период.
  // Считаем через ym:s:goal<ID>reaches батчами по 10 (Метрика может
  // ограничивать число метрик в одном запросе); при ошибке батча цель
  // переспрашивается отдельным запросом. Сортировка по reaches, убывание.
  app.get("/api/admin/yandex-metrika/goals-stats", (req, res) =>
    route(req, res, `/management/v1/counter/${COUNTER_ID}/goals`, {}, undefined, async (token) => {
      const from = String(req.query.from || "7daysAgo");
      const to = String(req.query.to || "today");
      const toNum = (v: unknown): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const goalsBody = await metrikaRequest(`/management/v1/counter/${COUNTER_ID}/goals`, token, {});
      const goals: Array<{ id: number; name: string }> = Array.isArray(goalsBody?.goals) ? goalsBody.goals : [];

      const reachesById = new Map<number, number>();
      const BATCH_SIZE = 10;
      for (let i = 0; i < goals.length; i += BATCH_SIZE) {
        const chunk = goals.slice(i, i + BATCH_SIZE);
        try {
          const stat = await metrikaRequest("/stat/v1/data", token, {
            ids: COUNTER_ID,
            lang: "ru",
            metrics: chunk.map((goal) => `ym:s:goal${goal.id}reaches`).join(","),
            date1: from,
            date2: to,
          });
          const values = stat?.data?.[0]?.metrics;
          chunk.forEach((goal, index) => {
            reachesById.set(goal.id, toNum(values?.[index]));
          });
        } catch {
          // Батч отклонён — цель будет переспрошена отдельно ниже.
        }
      }

      const missing = goals.filter((goal) => !reachesById.has(goal.id));
      for (const goal of missing) {
        try {
          const stat = await metrikaRequest("/stat/v1/data", token, {
            ids: COUNTER_ID,
            lang: "ru",
            metrics: `ym:s:goal${goal.id}reaches`,
            date1: from,
            date2: to,
          });
          reachesById.set(goal.id, toNum(stat?.data?.[0]?.metrics?.[0]));
        } catch {
          reachesById.set(goal.id, 0);
        }
      }

      const result = goals
        .map((goal) => ({ id: goal.id, name: goal.name, reaches: reachesById.get(goal.id) ?? 0 }))
        .sort((a, b) => b.reaches - a.reaches);
      return { ok: true, goals: result };
    }),
  );
}
