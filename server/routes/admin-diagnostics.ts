import type { Express } from "express";
import { getRecentErrors, getRequestStats } from "../log-buffer";
import { getCoPurchaseIndexSize } from "../recommendations";
import { storage } from "../storage";

/**
 * Диагностика сервера (ТЗ №5): журнал ошибок, статистика запросов, состояние кэшей.
 * Все эндпоинты read-only, защищены x-api-key (паттерн как в admin-users.ts).
 * Буферы живут в памяти процесса — при рестарте очищаются (by design).
 */
export function registerAdminDiagnosticsRoutes(
  app: Express,
  getAdminKey: () => string | undefined,
) {
  // Журнал последних записей (фильтр по уровню)
  app.get("/api/admin/diagnostics/logs", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    const level = String(req.query.level ?? "error");
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
    const logs = getRecentErrors(limit).filter((e) =>
      level === "all" ? true : level === "warn" ? e.level !== "info" : e.level === level,
    );
    res.json({ ok: true, logs });
  });

  // Статистика запросов за окно (4xx/5xx, средняя/p95 задержка, самые медленные)
  app.get("/api/admin/diagnostics/requests", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    const minutes = Math.min(1440, Math.max(5, Number(req.query.minutes ?? 60) || 60));
    res.json({ ok: true, stats: getRequestStats(minutes) });
  });

  // Состояние кэшей (товары, секции, рейтинги, отзывы, co-purchase)
  app.get("/api/admin/diagnostics/cache", async (req, res) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== getAdminKey()) return res.status(401).json({ error: "Unauthorized" });
    const cache: Record<string, { size: number; ttlSec?: number; ageSec?: number | null }> = {
      ...storage.getCacheStats(),
      coPurchase: { size: getCoPurchaseIndexSize() },
    };
    res.json({ ok: true, cache });
  });
}
