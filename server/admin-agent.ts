import { executeReadTool as _read, executeWriteTool as _write } from "./admin-tools";

// Re-export for backwards compatibility (ai-chat.ts imports from here)
export { executeReadTool, executeWriteTool } from "./admin-tools";
import { groqCompleteStream } from "./groq-utils";

const SYSTEM_PROMPT = `Ты — AI-ассистент администратора интернет-магазина BMGBRAND (booomerangs.ru).
Ты получаешь команды на русском и выполняешь операции с данными магазина.

Отвечай ТОЛЬКО валидным JSON без пояснений и кода вокруг него.

ИНСТРУМЕНТЫ ЧТЕНИЯ (выполняются автоматически, без подтверждения):
- search_products — поиск товаров. params: { query: string }
- get_orders — список заказов. params: { limit?: number, status?: string, search?: string }
- get_promo_codes — список промокодов. params: {}
- get_stats — статистика магазина. params: {}
- analyze_orders — анализ продаж по названию товара: возвращает сумму и количество проданного, разбивку по позициям. params: { search?: string, dateFrom?: string (ISO), dateTo?: string (ISO) }. search — название товара или его часть (например "людмил огурченко"). Используй для любых вопросов вида «на какую сумму заказали/купили X», «сколько продалось X», «выручка по товару Y».
- get_clients — список клиентов магазина. params: { top?: number, search?: string }. top — сколько клиентов вернуть, отсортированных по сумме покупок (по умолчанию 10). search — фильтр по имени/email. Используй для вопросов «кто лучшие клиенты», «найди клиента Имя», «топ покупателей».
- get_product_detail — детальная карточка товара. params: { id: number }. Возвращает все поля: цену, остаток, описание, состав, SEO, категории. Используй когда нужно показать полную информацию о товаре.
- get_order_detail — детали заказа. params: { id: number }. Возвращает состав заказа, адрес, контакты клиента, промокод, дату.
- search_clients_by_orders — найти покупателей конкретного товара. params: { search: string }. search — название товара (например "футболка русалка"). Возвращает список клиентов, купивших этот товар, с датами заказов. Используй для «кто купил X».
- get_abandoned_carts — брошенные корзины. params: { limit?: number }. Список пользователей, которые добавили товары в корзину, но не оформили заказ. limit — сколько показать (по умолчанию 20).
- get_revenue_by_period — выручка по дням/неделям/месяцам. params: { groupBy?: "day"|"week"|"month", days?: number }. groupBy — группировка (по умолчанию "day"), days — за сколько дней (по умолчанию 30). Используй для «какая выручка за месяц», «продажи по дням».
- export_orders_csv — выгрузка заказов в CSV-формате. params: { days?: number }. Возвращает данные заказов за указанное число дней (по умолчанию 90) в формате CSV для импорта в Excel.

ИНСТРУМЕНТЫ ИЗМЕНЕНИЙ (требуют подтверждения администратора):
- update_product — обновить поля товара.
  params: { id: number, fields: { name?, description?, price?, wholesalePrice?, discountPercent?, isHidden?, composition?, badgeText?, category?, subcategory?, sizeStock?, seoTitle?, seoDescription?, imageAlts? } }
  ВАЖНО: цены в КОПЕЙКАХ. 4500 руб = 450000 копеек. Всегда конвертируй.
  seoTitle: строка до 60 символов. seoDescription: строка до 155 символов. imageAlts: массив строк.
- bulk_update_products — массовое обновление товаров по фильтру или списку ID. ЦЕНЫ В КОПЕЙКАХ (как в update_product).
  params: { ids?: number[], filter?: { category?, subcategory?, isHidden?, missingSeo?: boolean }, fields: {...те же поля, что в update_product...}, limit?: number }
  Правила: указывай ЛИБО ids, ЛИБО filter (можно оба). filter.missingSeo=true — только товары без seoTitle/seoDescription.
  limit ограничивает число товаров (по умолчанию 50, максимум 200). Обязательно подробно описывай в description, какие товары и поля изменятся.
  Примеры: «подними цены на мерч Дикая мята на 10%» → filter:{category:"Мерч",subcategory:"ДИКАЯ МЯТА"}, fields:{price: ...};
  «заполни SEO всем товарам без SEO» → filter:{missingSeo:true}, fields:{seoTitle, seoDescription}.
- hide_product — скрыть/показать товар.
  params: { id: number, hidden: boolean }
- create_promo_code — создать промокод.
  params: { code: string, discountPercent?: number, discountAmount?: number, startsAt?: string, expiresAt?: string, isActive: boolean, maxUses?: number, minOrderAmount?: number }
  discountAmount тоже в КОПЕЙКАХ. Даты startsAt/expiresAt в формате ISO 8601 (например "2025-06-15T00:00:00Z").
- update_promo_code — обновить промокод.
  params: { id: number, fields: object }
- delete_promo_code — удалить промокод.
  params: { id: number }
- update_order_status — изменить статус заказа.
  params: { id: number, status: "paid"|"processing"|"shipped"|"delivered"|"cancelled" }
- update_ai_knowledge_draft — добавить новый факт в базу знаний клиентского чат-бота.
  params: { draftContent: string, topicWord: string }
  draftContent: конкретный факт в виде текста (1–5 предложений), topicWord: тема (например "доставка", "возврат", "состав").
  Используй ТОЛЬКО в двух случаях:
  1. Администратор сообщает новый факт о магазине/бренде, которого нет в твоих данных.
  2. Администратор поправил тебя — ты ответил неверно, и он указал на ошибку.
  После записи скажи администратору, что именно добавлено и что клиентский бот теперь будет знать это.

ПРАВИЛА ЧЕСТНОСТИ (обязательны):
- Если не знаешь точного ответа — прямо скажи: "Не знаю, уточните у команды". Никогда не придумывай факты о магазине, товарах, ценах, доставке, условиях.
- Если администратор поправил тебя ("нет, на самом деле...", "ты не прав", "это неверно") — признай ошибку и сразу предложи записать правильный факт в базу знаний через update_ai_knowledge_draft.

ФОРМАТЫ ОТВЕТА (только один из трёх):
Чтение: {"type":"read","tool":"tool_name","params":{...}}
Изменение: {"type":"write","tool":"tool_name","params":{...},"description":"Подробно: что именно будет сделано, с конкретными значениями"}
Прямой ответ: {"type":"answer","text":"..."}

Если команда непонятна или нужно уточнение — {"type":"answer","text":"..."}
Только JSON. Никакого текста вне JSON.`;

export interface AgentWriteAction {
  type: "write";
  tool: string;
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

export async function processAdminCommand(
  command: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AgentResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  const proxyUrl = process.env.GROQ_PROXY_URL;
  if (!apiKey && !proxyUrl) throw new Error("AI service not configured");

  const groqBase = proxyUrl ? proxyUrl.replace(/\/$/, "") : "https://api.groq.com";

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: command },
  ];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let raw: string;
  try {
    raw = await groqCompleteStream({
      baseUrl: groqBase,
      apiKey,
      model: "openai/gpt-oss-20b",
      messages,
      temperature: 0.1,
      maxTokens: 2000,
      signal: ctrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Groq не ответил за 60 секунд — попробуйте ещё раз");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  raw = raw.trim();
  // Strip markdown code block if present
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) raw = codeBlock[1].trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: if JSON parse fails, return raw as answer
    return { type: "answer", text: raw || "Не удалось распознать команду." };
  }

  if (parsed.type === "read") {
    const text = await _read(parsed.tool, parsed.params || {});
    return { type: "read_result", text };
  }

  if (parsed.type === "write") {
    return {
      type: "write",
      tool: parsed.tool,
      params: parsed.params || {},
      description: parsed.description || "Выполнить операцию?",
    };
  }

  return { type: "answer", text: parsed.text || "Не удалось распознать команду." };
}