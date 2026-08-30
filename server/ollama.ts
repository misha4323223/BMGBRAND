import type { Express } from "express";
import { logError, logInfo, logWarn } from "./logger";
import { getAiKnowledgeCached, loadAiKnowledgeIfNeeded, detectAiTopic } from "./ai-chat";
import { storage } from "./storage";

// ─── Локальная модель (Ollama через Tailscale Funnel) ─────────────────────────
// Проксируется ТОЛЬКО с сервера: туннель публичный, URL модели не должен
// попадать в клиентский код и запросы из браузера напрямую не выполняются.

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "https://bmg.taila98d3a.ts.net").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";

// Флаг видимости «BOOM AI» (локальная модель) в чате. Хранится в bonus_settings,
// управляется из админки (Интеграции). По умолчанию — включён.
const BOOOM_AI_ENABLED_KEY = "booom_ai_enabled";

export async function isBoomAiEnabled(): Promise<boolean> {
  try {
    const raw = await storage.getBonusSetting(BOOOM_AI_ENABLED_KEY);
    if (raw === undefined) return true; // не настраивалось — включено
    return raw !== "false";
  } catch {
    return true;
  }
}

// Правила краткости — ДОБАВЛЯЮТСЯ к знаниям бренда (ai_knowledge из админки):
// маленькие модели склонны ПРОГОВАРИВАТЬ ход мыслей в тексте ответа
// («дай подумаю…, проверю…») — эти правила заставляют отвечать сразу и кратко.
// Промпт собирается на сервере, клиент его не видит.
const OLLAMA_BREVITY_RULES =
  "Ты — ассистент интернет-магазина BOOOMERANGS (бренд одежды и мерча из Тулы). Отвечай на русском языке.\n" +
  "Правила:\n" +
  "1) Сразу давай итоговый ответ, максимум 1–3 предложения.\n" +
  "2) Никогда не описывай свои мысли и ход рассуждений.\n" +
  "3) Не перефразируй вопрос и не повторяй его.\n" +
  "4) Не начинай ответ со слов: «Хорошо», «Давайте», «Проверю», «Начну», «Итак», «Пользователь».\n" +
  "5) Для вычислений пиши только результат. Если не знаешь ответа — так и скажи.";

export function registerOllamaRoutes(
  app: Express,
  authMiddleware?: (req: any, res: any, next: any) => void,
  requireAdminRole?: (req: any, res: any, next: any) => void
) {
  // Публичный статус: включён ли «BOOM AI» в чате. Клиентский виджет прячет
  // кнопку, если false.
  app.get("/api/booom-ai/status", async (_req, res) => {
    res.json({ enabled: await isBoomAiEnabled() });
  });

  // Админский статус + переключатель (Интеграции).
  if (authMiddleware && requireAdminRole) {
    app.get("/api/admin/booom-ai/settings", authMiddleware, requireAdminRole, async (_req, res) => {
      res.json({ enabled: await isBoomAiEnabled() });
    });

    app.post("/api/admin/booom-ai/settings", authMiddleware, requireAdminRole, async (req, res) => {
      const { enabled } = (req.body || {}) as { enabled: boolean };
      await storage.setBonusSetting(BOOOM_AI_ENABLED_KEY, enabled ? "true" : "false").catch(() => {});
      logInfo(`[Ollama] BOOM AI ${enabled ? "включён" : "отключён"} администратором`);
      res.json({ success: true, enabled });
    });
  }

  app.post("/api/ollama/chat", async (req, res) => {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages_required" });
    }

    // Если админ выключил «BOOM AI» — отдаём внятную ошибку (чат не должен работать).
    if (!(await isBoomAiEnabled())) {
      return res.status(403).json({ error: "booom_ai_disabled" });
    }

    // ── Тот же системный промпт, что у облачного AI (Groq) ──
    // база из админ-настроек (ai_prompt_base) + блок ассортимента + блок по теме
    // вопроса (доставка/оплата/возврат/размеры/промокоды и т.д.), затем правила
    // краткости. Кэш знаний подгружается один раз по TTL — это не блокирует чат.
    try {
      await loadAiKnowledgeIfNeeded();
    } catch { /* знания не критичны — чат работает и без них */ }
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const topicKey = lastUserMsg ? detectAiTopic(String((lastUserMsg as any).content || "")) : null;
    let localSystemPrompt = getAiKnowledgeCached("ai_prompt_base");
    const assortmentBlock = getAiKnowledgeCached("ai_block_assortment");
    if (assortmentBlock) localSystemPrompt += "\n\n" + assortmentBlock;
    if (topicKey) {
      const topicBlock = getAiKnowledgeCached(topicKey);
      if (topicBlock) localSystemPrompt += "\n\n" + topicBlock;
    }
    localSystemPrompt += "\n\n" + OLLAMA_BREVITY_RULES;

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

    let timedOut = false;
    // Страховка: если туннель завис и перестал слать данные, не держим запрос
    // вечно. Таймаут ПО ПРОСТОЮ (не общий): медленная, но живая генерация не
    // обрывается, а мёртвое соединение (0 байт > 60 c) закрывается внятной ошибкой.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    };
    resetIdleTimer();

    try {
      // Нативное /api/chat. qwen3 — рассуждающая модель: думает и шлёт ход мыслей
      // в поле message.thinking (у некоторых версий — reasoning), а чистый ответ —
      // в message.content. Думание НЕ отключаем (с выключенным думанием маленькая
      // qwen3 начинает писать размышления прямо в content и их не отрезать),
      // а просто не отдаём thinking клиенту — как у облачной модели (Groq).
      // keep_alive: держим модель в памяти (Ollama по умолчанию выгружает через
      // 5 минут) — холодный старт тянется долго и туннель успевает оборвать стрим.
      const ollamaRes = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "system", content: localSystemPrompt }, ...messages.map((m: any) => ({ role: m.role, content: m.content }))],
          stream: true,
          keep_alive: "30m",
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

      // Groq-style: вырезаем <think>...</think> блоки из content (на случай, если
      // модель вставит размышления прямо в текст ответа, как это бывает у qwen3
      // на некоторых версиях Ollama). Теги могут рваться между чанками — буфер.
      let thinkBuf = "";
      const stripThink = (raw: string): string => {
        thinkBuf += raw;
        let out = "";
        while (true) {
          const start = thinkBuf.indexOf("<think>");
          const end = thinkBuf.indexOf("</think>");
          if (start === -1) {
            out += thinkBuf;
            thinkBuf = "";
            break;
          }
          if (end === -1) {
            out += thinkBuf.slice(0, start);
            thinkBuf = thinkBuf.slice(start);
            break;
          }
          if (end < start) {
            out += thinkBuf.slice(0, end + 8);
            thinkBuf = thinkBuf.slice(end + 8);
            continue;
          }
          out += thinkBuf.slice(0, start);
          thinkBuf = thinkBuf.slice(end + 8);
        }
        return out;
      };

      // Нативный формат /api/chat — NDJSON-строки без префикса "data:":
      // {"model":"qwen3:4b","message":{"role":"assistant","content":"..."},"done":false}
      // Подстрахуемся и от OpenAI-формата (если вдруг upstream поменяется).
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        resetIdleTimer(); // данные пришли — соединение живое, продлеваем ожидание
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let payload = trimmed;
          if (trimmed.startsWith("data:")) {
            payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
          }
          try {
            const chunk = JSON.parse(payload);
            // Клиентам отдаём ТОЛЬКО финальный ответ: поле message.thinking
            // (ход мыслей qwen3) игнорируем, а из content дополнительно
            // вырезаем возможные <think>...</think> блоки.
            const raw = typeof chunk?.message?.content === "string" ? chunk.message.content : "";
            const cleaned = stripThink(raw);
            if (cleaned) send(cleaned);
          } catch {
            continue; // частичная строка JSON
          }
        }
      }
      clearTimeout(idleTimer);
      res.end();
    } catch (err: any) {
      clearTimeout(idleTimer);
      if (err?.name === "AbortError") {
        // Если оборвал не клиент, а наш таймаут — сообщаем клиенту внятную ошибку.
        if (timedOut && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: "ollama_unavailable" })}\n\n`);
        }
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
