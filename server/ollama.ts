import type { Express } from "express";
import { logError, logWarn } from "./logger";

// ─── Локальная модель (Ollama через Tailscale Funnel) ─────────────────────────
// Проксируется ТОЛЬКО с сервера: туннель публичный, URL модели не должен
// попадать в клиентский код и запросы из браузера напрямую не выполняются.
// Роут защищён кодом доступа (env OLLAMA_ACCESS_CODE); без кода роут выключен.

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "https://bmg.taila98d3a.ts.net").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";

export function registerOllamaRoutes(app: Express) {
  app.post("/api/ollama/chat", async (req, res) => {
    const accessCode = process.env.OLLAMA_ACCESS_CODE;
    if (!accessCode) {
      return res.status(503).json({ error: "ollama_not_configured" });
    }
    const provided = req.headers["x-ollama-code"] || req.query.code;
    if (typeof provided !== "string" || provided !== accessCode) {
      return res.status(403).json({ error: "invalid_access_code" });
    }

    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages_required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const controller = new AbortController();
    // ВНИМАНИЕ: req.on("close") в Express срабатывает, когда запрос уже прочитан
    // целиком (сразу после body-parser), а не при дисконнекте клиента — это
    // мгновенно убивало fetch. На дисконнект вешаемся через res.on("close").
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const ollamaRes = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });

      if (!ollamaRes.ok || !ollamaRes.body) {
        const detail = ollamaRes.ok ? "" : ` (HTTP ${ollamaRes.status})`;
        logWarn(`[Ollama] upstream error${detail}`);
        res.write(`data: ${JSON.stringify({ error: "ollama_unavailable" })}\n\n`);
        res.end();
        return;
      }

      const reader = (ollamaRes.body as any).getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const send = (text: string) => {
        if (!text) return;
        res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
      };

      // qwen3 думает по умолчанию (Ollama игнорирует think:false в OpenAI-совместимом
      // формате): дума приходит в delta.reasoning, ответ — в delta.content.
      // Проксируем оба — клиент видит ход мысли сразу, без тишины.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta;
            const text =
              typeof delta?.content === "string"
                ? delta.content
                : typeof delta?.reasoning === "string"
                  ? delta.reasoning
                  : "";
            if (text) send(text);
          } catch {
            continue; // частичная строка JSON
          }
        }
      }
      res.end();
    } catch (err: any) {
      if (err?.name === "AbortError") {
        res.end();
        return;
      }
      logError("[Ollama] proxy error:", err?.message || err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: "ollama_unavailable" })}\n\n`);
        res.end();
      }
    }
  });
}
