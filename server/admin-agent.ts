import { storage } from "./storage";

const SYSTEM_PROMPT = `Ты — AI-ассистент администратора интернет-магазина BMGBRAND (booomerangs.ru).
Ты получаешь команды на русском и выполняешь операции с данными магазина.

Отвечай ТОЛЬКО валидным JSON без пояснений и кода вокруг него.

ИНСТРУМЕНТЫ ЧТЕНИЯ (выполняются автоматически, без подтверждения):
- search_products — поиск товаров. params: { query: string }
- get_orders — список заказов. params: { limit?: number, status?: string, search?: string }
- get_promo_codes — список промокодов. params: {}
- get_stats — статистика магазина. params: {}

ИНСТРУМЕНТЫ ИЗМЕНЕНИЙ (требуют подтверждения администратора):
- update_product — обновить поля товара.
  params: { id: number, fields: { name?, description?, price?, wholesalePrice?, discountPercent?, isHidden?, composition?, badgeText?, category?, subcategory?, sizeStock? } }
  ВАЖНО: цены в КОПЕЙКАХ. 4500 руб = 450000 копеек. Всегда конвертируй.
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

async function executeReadTool(tool: string, params: any): Promise<string> {
  switch (tool) {
    case "search_products": {
      const all = (await storage.getProducts()) as any[];
      const q = (params.query || "").toLowerCase();
      const found = all
        .filter(
          (p: any) =>
            p.name?.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q) ||
            String(p.id) === q.trim()
        )
        .slice(0, 15);
      if (!found.length) return `Товары по запросу «${params.query}» не найдены.`;
      return (
        `Найдено ${found.length} товар(ов):\n` +
        found
          .map(
            (p: any) =>
              `• [ID: ${p.id}] ${p.name}${p.isHidden ? " 🚫" : ""} — ${Math.round((p.price || 0) / 100).toLocaleString("ru-RU")} ₽, SKU: ${p.sku || "—"}`
          )
          .join("\n")
      );
    }

    case "get_orders": {
      const STATUS_LABELS: Record<string, string> = {
        paid: "Оплачен",
        processing: "В обработке",
        shipped: "Отправлен",
        delivered: "Доставлен",
        cancelled: "Отменён",
        awaiting_payment: "Ожидает оплаты",
      };
      let orders = (await storage.getOrders()) as any[];
      if (params.status) orders = orders.filter((o: any) => o.status === params.status);
      if (params.search) {
        const s = params.search.toLowerCase();
        orders = orders.filter(
          (o: any) =>
            String(o.id).includes(s) ||
            o.customerEmail?.toLowerCase().includes(s) ||
            o.customerName?.toLowerCase().includes(s)
        );
      }
      orders = orders.slice(0, params.limit || 10);
      if (!orders.length) return "Заказов по данным критериям не найдено.";
      return (
        `Заказы (${orders.length}):\n` +
        orders
          .map(
            (o: any) =>
              `• №${o.id} — ${o.customerName || "—"}, ${STATUS_LABELS[o.status] || o.status}, ${Math.round((o.total || 0) / 100).toLocaleString("ru-RU")} ₽, ${o.customerEmail || "—"}`
          )
          .join("\n")
      );
    }

    case "get_promo_codes": {
      const codes = (await storage.getPromoCodes()) as any[];
      if (!codes.length) return "Промокоды не найдены.";
      return (
        `Промокоды (${codes.length}):\n` +
        codes
          .map((c: any) => {
            const disc = c.discountPercent
              ? `${c.discountPercent}%`
              : c.discountAmount
                ? `${Math.round(c.discountAmount / 100)} ₽`
                : "—";
            const status = c.isActive ? "✅ активен" : "❌ неактивен";
            const uses =
              c.usedCount != null
                ? `, использован: ${c.usedCount}${c.maxUses ? `/${c.maxUses}` : ""} раз`
                : "";
            const exp = c.expiresAt ? `, до ${new Date(c.expiresAt).toLocaleDateString("ru-RU")}` : "";
            return `• [ID: ${c.id}] ${c.code} — скидка ${disc}, ${status}${uses}${exp}`;
          })
          .join("\n")
      );
    }

    case "get_stats": {
      const [products, orders, promos] = await Promise.all([
        storage.getProducts(),
        storage.getOrders(),
        storage.getPromoCodes(),
      ]);
      const allP = products as any[];
      const allO = orders as any[];
      const visible = allP.filter((p: any) => !p.isHidden).length;
      const paidO = allO.filter((o: any) =>
        ["paid", "shipped", "delivered"].includes(o.status)
      );
      const revenue = paidO.reduce((s: number, o: any) => s + (o.total || 0), 0);
      const today = new Date().toDateString();
      const todayO = allO.filter(
        (o: any) => o.createdAt && new Date(String(o.createdAt)).toDateString() === today
      );
      return (
        `📊 Статистика магазина:\n` +
        `• Товаров: ${allP.length} (видимых: ${visible}, скрытых: ${allP.length - visible})\n` +
        `• Заказов всего: ${allO.length}\n` +
        `• Заказов сегодня: ${todayO.length}\n` +
        `• Оплаченных (все время): ${paidO.length}\n` +
        `• Общая выручка: ${Math.round(revenue / 100).toLocaleString("ru-RU")} ₽\n` +
        `• Промокодов: ${(promos as any[]).length} (активных: ${(promos as any[]).filter((p: any) => p.isActive).length})`
      );
    }

    default:
      return `Неизвестный инструмент чтения: ${tool}`;
  }
}

export async function executeWriteTool(tool: string, params: any): Promise<string> {
  switch (tool) {
    case "update_product": {
      const updated = await storage.updateProduct(params.id, params.fields);
      const fieldNames = Object.keys(params.fields).join(", ");
      return `✅ Товар №${params.id} («${updated.name}») обновлён. Изменены поля: ${fieldNames}.`;
    }

    case "hide_product": {
      await storage.updateProduct(params.id, { isHidden: params.hidden } as any);
      return `✅ Товар №${params.id} ${params.hidden ? "скрыт с сайта" : "снова виден на сайте"}.`;
    }

    case "create_promo_code": {
      const promo = await storage.createPromoCode({
        code: String(params.code).toUpperCase(),
        discountPercent: params.discountPercent ?? null,
        discountAmount: params.discountAmount ?? null,
        isActive: params.isActive ?? true,
        startsAt: params.startsAt ? new Date(params.startsAt) : null,
        expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
        maxUses: params.maxUses ?? null,
        minOrderAmount: params.minOrderAmount ?? null,
        usedCount: 0,
        applicableCategories: params.applicableCategories ?? null,
      } as any);
      const disc = promo.discountPercent
        ? `${promo.discountPercent}%`
        : promo.discountAmount
          ? `${Math.round(Number(promo.discountAmount) / 100)} ₽`
          : "";
      return `✅ Промокод **${promo.code}** создан${disc ? ` — скидка ${disc}` : ""}.`;
    }

    case "update_promo_code": {
      const updated = await storage.updatePromoCode(params.id, params.fields);
      return `✅ Промокод **${updated.code}** обновлён.`;
    }

    case "delete_promo_code": {
      await storage.deletePromoCode(params.id);
      return `✅ Промокод №${params.id} удалён.`;
    }

    case "update_order_status": {
      await storage.updateOrderStatus(params.id, params.status);
      const STATUS_LABELS: Record<string, string> = {
        paid: "Оплачен",
        processing: "В обработке",
        shipped: "Отправлен",
        delivered: "Доставлен",
        cancelled: "Отменён",
      };
      return `✅ Статус заказа №${params.id} изменён на «${STATUS_LABELS[params.status] || params.status}».`;
    }

    default:
      throw new Error(`Неизвестный инструмент изменения: ${tool}`);
  }
}

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

  const resp = await fetch(`${groqBase}/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: "qwen/qwen3-32b",
      messages,
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!resp.ok) throw new Error(`Groq error: ${resp.status}`);
  const data = (await resp.json()) as any;
  let raw: string = (data.choices?.[0]?.message?.content || "").trim();

  // Strip <think>...</think> tags from Qwen3 reasoning
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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
    const text = await executeReadTool(parsed.tool, parsed.params || {});
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
