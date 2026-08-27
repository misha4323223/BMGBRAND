/**
 * Admin API for the "AI Questions → FAQ" pipeline (Variant 2).
 *
 * Registered from server/index.ts — deliberately NOT inside the giant routes.ts.
 * Guard: x-api-key (same rule as other admin AI routes).
 */
import type { Express, Request, Response } from "express";
import { logError } from "./logger";
import { storage } from "./storage";
import {
  listAiQuestions,
  setAiQuestionDraft,
  deleteAiQuestion,
  pruneAiQuestions,
} from "./ai-questions-store";
import {
  normalizeAiQuestion,
  buildFaqDraftSystemPrompt,
} from "./ai-questions-lib";
import { loadAiKnowledgeIfNeeded, getAiKnowledgeCached } from "./ai-chat";
import { groqCompleteStream } from "./groq-utils";

function getAdminKey(): string | undefined {
  return process.env.ADMIN_API_KEY || process.env.SYNC_API_KEY;
}

function isAdmin(req: Request): boolean {
  const apiKey = req.headers["x-api-key"];
  const expected = getAdminKey();
  return !!expected && apiKey === expected;
}

async function loadFaqItems(): Promise<Array<{ question: string; answer: string }>> {
  try {
    const settings = await storage.getPageSettings("static_pages");
    const raw = settings?.faq_data;
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.filter(
      (i: any) => i && typeof i.question === "string" && typeof i.answer === "string"
    );
  } catch {
    return [];
  }
}

/** Streaming Groq call for FAQ draft generation. Mirrors the working chat route. */
async function generateFaqDraft(question: string, faqContext: Array<{ question: string; answer: string }>): Promise<string> {
  await loadAiKnowledgeIfNeeded();
  const brandPrompt = getAiKnowledgeCached("ai_prompt_base");
  const assortmentBlock = getAiKnowledgeCached("ai_block_assortment");
  const systemPrompt = buildFaqDraftSystemPrompt({
    brandPrompt,
    assortmentBlock,
    existingFaq: faqContext,
  });

  const proxyUrl = process.env.GROQ_PROXY_URL;
  const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, "") : "https://api.groq.com";
  const keys = [process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_3].filter(Boolean) as string[];
  // Proxy deployments may inject the Groq key server-side, so a key is only
  // mandatory when there is no proxy either (mirrors admin-agent.ts).
  if (keys.length === 0 && !proxyUrl) throw new Error("AI service not configured");
  const attempts = keys.length > 0 ? keys : [""];

  let lastError: Error | null = null;
  for (const key of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const text = await groqCompleteStream({
        baseUrl: groqBase,
        apiKey: key || undefined,
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Вопрос покупателя: ${question}` },
        ],
        temperature: 0.3,
        maxTokens: 1500,
        signal: ctrl.signal,
      });
      if (!text) throw new Error("Groq вернул пустой ответ");
      return text;
    } catch (err: any) {
      lastError = err;
      // Retry with the other key only on rate-limit / network hiccups.
      if (err.name === "AbortError") {
        lastError = new Error("Groq не ответил за 60 секунд — попробуйте ещё раз");
        throw lastError;
      }
      if (err?.status === 429) continue; // try the other key
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("AI недоступен");
}

export function registerAiQuestionsRoutes(app: Express): void {
  // List collected questions + current FAQ items (so the UI can flag duplicates).
  app.get("/api/admin/ai-questions", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const [questions, faq] = await Promise.all([listAiQuestions(), loadFaqItems()]);
      res.json({ questions, faq });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Generate a draft answer with Groq for a collected question.
  app.post("/api/admin/ai-questions/:question/regenerate", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const question = normalizeAiQuestion(String(req.params.question || "").trim());
      if (!question) return res.status(400).json({ message: "Вопрос пустой" });
      const faq = await loadFaqItems();
      const draft = await generateFaqDraft(question, faq);
      await setAiQuestionDraft(question, draft, "draft");
      res.json({ draft, status: "draft" });
    } catch (err: any) {
      logError("[AiQuestions] regenerate error:", err?.message || err);
      res.status(502).json({ message: err.message || "AI недоступен" });
    }
  });

  // Save an edited draft (no AI call).
  app.post("/api/admin/ai-questions/:question/draft", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const question = normalizeAiQuestion(String(req.params.question || "").trim());
      const answer = String((req.body as any)?.answer || "").trim();
      const status = String((req.body as any)?.status || "draft");
      if (!question || !answer) return res.status(400).json({ message: "Нужны вопрос и ответ" });
      await setAiQuestionDraft(question, answer, status);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Append the draft to the public FAQ page (static_pages → faq_data.items).
  app.post("/api/admin/ai-questions/:question/add-to-faq", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const question = normalizeAiQuestion(String(req.params.question || "").trim());
      const faq = await loadFaqItems();
      const existing = faq.find((f) => normalizeAiQuestion(f.question) === question);
      if (existing) {
        return res.json({ success: true, added: false, faqCount: faq.length, message: "Уже есть в FAQ" });
      }
      const row = (await listAiQuestions()).find((r) => r.question === question);
      const answer = String(req.body?.answer || row?.draftAnswer || "").trim();
      if (!answer) return res.status(400).json({ message: "Сначала сгенерируйте или введите ответ" });
      const newItems = [
        ...faq,
        { question: row?.originalText || question, answer },
      ].slice(0, 200);
      await storage.setPageSectionSettings("static_pages", "faq_data", { items: newItems });
      await setAiQuestionDraft(question, answer, "published");
      res.json({ success: true, added: true, faqCount: newItems.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Bulk cleanup: delete stale / never-repeated questions (or all, when no criteria given).
  app.post("/api/admin/ai-questions/prune", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const olderThanDays = Number((req.body as any)?.olderThanDays ?? 0);
      const maxCount = Number((req.body as any)?.maxCount ?? 0);
      const deleted = await pruneAiQuestions({
        olderThanDays: olderThanDays > 0 ? olderThanDays : undefined,
        maxCount: maxCount > 0 ? maxCount : undefined,
      });
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Remove a collected question (does NOT touch the public FAQ page).
  app.delete("/api/admin/ai-questions/:question", async (req: Request, res: Response) => {
    if (!isAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const question = normalizeAiQuestion(String(req.params.question || "").trim());
      await deleteAiQuestion(question);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}

