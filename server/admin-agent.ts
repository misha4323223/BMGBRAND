import { executeReadTool, executeWriteTool as _write } from "./admin-tools";

// Re-export for backwards compatibility (ai-chat.ts imports from here)
export { executeReadTool, executeWriteTool } from "./admin-tools";
import { groqCompleteStream } from "./groq-utils";

const SYSTEM_PROMPT = `Ты — BOOOM AI, AI-ассистент администратора магазина booomerangs.ru. Понимаешь русскую речь, сам выбираешь действие и его params.

БЕЗОПАСНОСТЬ:
- write-действия НЕ выполняются сразу — верни их с description, админ подтвердит кнопкой «Выполнить».
- При массовых операциях укажи масштаб («затронет 47 товаров»).
- Не выдумывай факты. Если не знаешь — скажи честно.

ОБЩЕНИЕ:
- Запрос нечёткий или не хватает данных → задай уточняющий вопрос (type:"answer").
- НО: если в запросе есть конкретное название (товар, артист, кампания) — НЕ уточняй, сразу выполняй поиск. Названия могут быть необычными: «Молодость внутри», «Людмил Огурченко», «TMNV» — ищи как есть.
- Не умеешь → честно скажи: «Я не могу X, но могу Y и Z».
- «Что ты умеешь?»/help → перечисли возможности, не вызывай действия.
- Можешь вызывать read-действия несколько раз подряд для сложных вопросов; результат придёт в следующем сообщении как «[Результат действия ...]».

КАКИЕ ЗАПРОСЫ К КАКИМ ДЕЙСТВИЯМ:
- «отчёт продаж», «сколько продалось», «на какую сумму», «выручка по товару/артисту» → analyze_orders{search: название}
- «найди/покажи товар» → search_products{query: название}
- «кто купил X» → search_clients_by_orders{search}
- «лучшие клиенты», «топ покупателей», «найди клиента» → get_clients
- «статистика», «общие цифры» → get_stats
- «выручка за неделю/месяц/период» → get_revenue_by_period
- «брошенные корзины» → get_abandoned_carts

READ-ДЕЙСТВИЯ (без подтверждения):
search_products{query}, get_product_detail{id}, get_orders{limit,status,search}, get_order_detail{id}, analyze_orders{search,dateFrom,dateTo}, get_clients{top,search}, search_clients_by_orders{search}, get_abandoned_carts{limit,dateFrom,dateTo,sort}, get_revenue_by_period{groupBy,days,dateFrom,dateTo}, get_stats{}, get_promo_codes{}, export_orders_csv{days,dateFrom,dateTo}

WRITE-ДЕЙСТВИЯ (с подтверждением):
update_product{id,fields}, bulk_update_products{ids|filter:{category,subcategory,isHidden,missingSeo},fields,limit}, hide_product{id,hidden}, create_promo_code{code,discountPercent,discountAmount,startsAt,expiresAt,isActive,maxUses,minOrderAmount}, update_promo_code{id,fields}, delete_promo_code{id}, update_order_status{id,status:paid|processing|shipped|delivered|cancelled}, update_ai_knowledge_draft{draftContent,topicWord}, send_cart_promos, send_favorites_promos, apply_price_drop_suggestions, send_retention_offers

ЦЕНЫ И СУММЫ — ВСЕГДА В КОПЕЙКАХ (4500 ₽ = 450000).

ФОРМАТ ОТВЕТА — только JSON, один из трёх:
{"type":"read","action":"имя","params":{...}}
{"type":"write","action":"имя","params":{...},"description":"кратко: что и сколько затронуто"}
{"type":"answer","text":"..."}`;

export interface AgentWriteAction {
  type: "write";
  tool: string;   // kept as "tool" for backwards compat with ai-chat.ts
  params: any;
  description: string;
}

export interface AgentReadResult {
  type: "read_result";
  text: string;
}

export interface AgentAnswer {
  type: "answer";
  text: string;
}

export type AgentResponse = AgentWriteAction | AgentReadResult | AgentAnswer;

const MAX_ITERATIONS = 5;

// Model is configurable via env (e.g. ADMIN_AGENT_MODEL=openai/gpt-oss-120b)
const ADMIN_AGENT_MODEL = process.env.ADMIN_AGENT_MODEL || "openai/gpt-oss-20b";

// Parse "Please try again in X.XXs" from Groq 429 message
function groqRetryDelayMs(err: any): number | null {
  const m = String(err?.message || "").match(/try again in ([\d.]+)s/i);
  if (!m) return null;
  const sec = parseFloat(m[1]);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.min(Math.ceil(sec * 1000) + 500, 35_000); // cap at 35s
}

async function callGroq(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY_3;
  const proxyUrl = process.env.GROQ_PROXY_URL;
  if (!apiKey && !proxyUrl) throw new Error("AI service not configured");
  const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, "") : "https://api.groq.com";

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      return await groqCompleteStream({
        baseUrl: groqBase,
        apiKey,
        model: ADMIN_AGENT_MODEL,
        messages,
        temperature: 0.6,
        maxTokens: 4096,
        signal: ctrl.signal,
      });
    } catch (err: any) {
      lastErr = err;
      if (err?.status === 429) {
        const delay = groqRetryDelayMs(err) ?? 4000 * (attempt + 1);
        if (attempt < 2) {
          console.log(`[AdminAgent] 429 rate limit, retrying in ${Math.round(delay / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      if (err?.name === "AbortError") throw new Error("Groq не ответил за 90 секунд — попробуйте ещё раз");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function parseGroqJson(raw: string): { parsed: any; wasMarkdown: boolean; fallbackText: string | null } | null {
  raw = raw.trim();
  let wasMarkdown = false;

  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    wasMarkdown = true;
    raw = codeBlock[1].trim();
  }

  try {
    return { parsed: JSON.parse(raw), wasMarkdown, fallbackText: null };
  } catch {
    if (raw.length > 0 && !raw.startsWith("{") && !raw.startsWith("[")) {
      return { parsed: null, wasMarkdown: false, fallbackText: raw };
    }
    return null;
  }
}

export async function processAdminCommand(
  command: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AgentResponse> {
  const nowLine = `Сегодня: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "full", timeStyle: "short" })} (МСК). Относительные периоды («вчера», «за неделю», «в этом месяце») переводи в ISO-даты от этой даты.`;
  const systemMsg = SYSTEM_PROMPT + "\n\n" + nowLine;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemMsg },
    ...history.slice(-15).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: command },
  ];

  let lastActionCall: string | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const raw = await callGroq(messages);
    const parseResult = parseGroqJson(raw);

    // Plain text from model → return as answer
    if (parseResult && parseResult.fallbackText) {
      return { type: "answer", text: parseResult.fallbackText };
    }

    // Not JSON → return raw text as answer
    if (!parseResult || !parseResult.parsed) {
      return { type: "answer", text: raw.slice(0, 2000) || "Не удалось распознать команду. Попробуйте переформулировать запрос." };
    }

    const parsed = parseResult.parsed;

    // Write → return for client confirmation. Model sends "action", we map to "tool" for backwards compat.
    if (parsed.type === "write") {
      return {
        type: "write",
        tool: parsed.action || parsed.tool,
        params: parsed.params || {},
        description: parsed.description || "Выполнить операцию?",
      };
    }

    // Answer → return immediately
    if (parsed.type === "answer") {
      const text = parsed.text || "";
      if (text.trim().length < 2) {
        return { type: "answer", text: "Не удалось сформулировать ответ. Попробуйте переформулировать запрос." };
      }
      return { type: "answer", text };
    }

    // Read → execute on server, feed result back
    if (parsed.type === "read") {
      const actionName = parsed.action || parsed.tool;
      const params = parsed.params || {};

      // Loop protection
      const callFingerprint = `${actionName}:${JSON.stringify(params)}`;
      if (callFingerprint === lastActionCall) {
        return {
          type: "answer",
          text: "Похоже, я зациклился на одном и том же запросе. Попробуйте уточнить, что именно нужно найти или проанализировать.",
        };
      }
      lastActionCall = callFingerprint;

      const actionResult = await executeReadTool(actionName, params);
      messages.push({ role: "assistant", content: JSON.stringify(parsed) });
      messages.push({ role: "user", content: `[Результат действия ${actionName}]:\n${actionResult}` });
      continue;
    }

    return { type: "answer", text: parsed.text || raw || "Не удалось распознать команду." };
  }

  return {
    type: "answer",
    text: "Достигнут лимит шагов (5). Попробуйте разбить запрос на более простые или уточнить, что именно нужно.",
  };
}