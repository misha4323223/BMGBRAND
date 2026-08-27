import type { Express } from "express";

// Dadata proxy routes (address and party/INN autocomplete).
// Вынесено из server/routes.ts без изменения поведения.

export function registerDadataRoutes(app: Express): void {
  app.post("/api/dadata/address", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 7 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Подсказка городов для выбора ПВЗ Ozon (возвращает упрощённый список)
  app.post("/api/dadata/city-suggest", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.json({ suggestions: [] });
      const { query } = req.body;
      if (!query || String(query).trim().length < 2) return res.json({ suggestions: [] });
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({
          query: String(query).trim(),
          count: 12,
          from_bound: { value: "city" },
          to_bound: { value: "city" },
          locations: [{ country: "*" }],
        }),
      });
      const data: any = await response.json();
      const suggestions = (data.suggestions ?? []).map((s: any) => ({
        value: s.value,
        city: s.data?.city ?? s.data?.settlement ?? s.data?.region_with_type ?? s.value,
        region: s.data?.region_with_type ?? "",
      }));
      res.json({ suggestions });
    } catch (err: any) {
      res.json({ suggestions: [] });
    }
  });

  app.post("/api/dadata/party", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 5 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Подсказка банка по БИК (для автозаполнения банковских реквизитов партнёра)
  app.post("/api/dadata/bank", async (req, res) => {
    try {
      const apiKey = process.env.DADATA_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Dadata not configured" });
      const { query, count = 5 } = req.body;
      const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/bank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Token ${apiKey}`,
        },
        body: JSON.stringify({ query, count }),
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
