// Admin agent tool implementations.
// Each function is pure: (params) → Promise<string>.
// Add new tools here, then add descriptions to SYSTEM_PROMPT in admin-agent.ts.

import { storage } from "./storage";

// ── Shared helpers ──────────────────────────────────────────────────────────

const rubFmt = (k: number) => Math.round((k || 0) / 100).toLocaleString("ru-RU") + " ₽";
const dateFmt = (d: any) => {
  if (!d) return "—";
  return new Date(typeof d === "string" ? d : d).toLocaleDateString("ru-RU");
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Оплачен",
  processing: "В обработке",
  shipped: "Отправлен",
  delivered: "Доставлен",
  cancelled: "Отменён",
  awaiting_payment: "Ожидает оплаты",
};

// ── READ TOOLS ──────────────────────────────────────────────────────────────

export async function searchProducts(params: any): Promise<string> {
  const all = (await storage.getAllProductsForAdmin()) as any[];
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
          `• [ID: ${p.id}] ${p.name}${p.isHidden ? " 🚫" : ""} — ${rubFmt(p.price || 0)}, SKU: ${p.sku || "—"}`
      )
      .join("\n")
  );
}

export async function getOrders(params: any): Promise<string> {
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
          `• №${o.id} — ${o.customerName || "—"}, ${STATUS_LABELS[o.status] || o.status}, ${rubFmt(o.total || 0)}, ${o.customerEmail || "—"}`
      )
      .join("\n")
  );
}

export async function analyzeOrders(params: any): Promise<string> {
  const qRaw = String(params.search || "").toLowerCase().trim();
  const tokens = qRaw ? qRaw.split(/\s+/).filter(Boolean) : [];
  let orders = (await storage.getOrders()) as any[];
  orders = orders.filter(
    (o: any) => !o.isDraft && o.status !== "cancelled" && Array.isArray(o.items)
  );
  if (params.dateFrom || params.dateTo) {
    orders = orders.filter((o: any) => {
      if (!o.createdAt) return false;
      const d = new Date(o.createdAt);
      if (params.dateFrom && d < new Date(params.dateFrom)) return false;
      if (params.dateTo && d > new Date(params.dateTo)) return false;
      return true;
    });
  }
  const agg = new Map<string, { name: string; qty: number; amount: number }>();
  let totalAmount = 0;
  let totalQty = 0;
  const orderIds = new Set<number>();
  for (const o of orders) {
    for (const it of o.items as any[]) {
      const name = String(it.name ?? it.productName ?? "").trim();
      if (!name) continue;
      const lname = name.toLowerCase();
      if (tokens.length && !tokens.every((t) => lname.includes(t))) continue;
      const qtyN = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
      const amount = (Number(it.price) || 0) * qtyN;
      totalAmount += amount;
      totalQty += qtyN;
      orderIds.add(o.id);
      const cur = agg.get(lname) || { name, qty: 0, amount: 0 };
      cur.qty += qtyN;
      cur.amount += amount;
      agg.set(lname, cur);
    }
  }
  if (qRaw && !agg.size)
    return `Продаж по запросу «${qRaw}» не найдено (${orders.length} заказов проанализировано).`;
  const lines: string[] = [
    qRaw
      ? `📊 «${qRaw}»: продано на ${rubFmt(totalAmount)} — ${totalQty} шт., в ${orderIds.size} заказ(ах).`
      : `📊 Продано всего на ${rubFmt(totalAmount)} — ${totalQty} позиций, ${orderIds.size} заказ(ов).`,
  ];
  const top = [...agg.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
  for (const t of top) lines.push(`• ${t.name} — ${t.qty} шт. на ${rubFmt(t.amount)}`);
  if (agg.size > top.length) lines.push(`…и ещё ${agg.size - top.length} поз.`);
  return lines.join("\n");
}

export async function getClients(params: any): Promise<string> {
  const users = (await storage.getUsersWithLoyalty()) as any[];
  const q = String(params.search || "").toLowerCase().trim();
  let list = users;
  if (q)
    list = list.filter(
      (u: any) =>
        u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    );
  list = [...list].sort((a: any, b: any) => (b.totalSpent || 0) - (a.totalSpent || 0));
  const top = list.slice(0, Math.min(Number(params.top) || 10, 50));
  if (!top.length) return "Клиенты по запросу не найдены.";
  return (
    `Клиенты (${list.length}, показано ${top.length}, по сумме покупок):\n` +
    top
      .map(
        (u: any, i: number) =>
          `${i + 1}. ${u.name || "—"} (${u.email}) — купил(а) на ${rubFmt(u.totalSpent)}${
            u.loyaltyDiscount ? `, скидка лояльности ${u.loyaltyDiscount}%` : ""
          }`
      )
      .join("\n")
  );
}

export async function getPromoCodes(_params: any): Promise<string> {
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
        const exp = c.expiresAt ? `, до ${dateFmt(c.expiresAt)}` : "";
        return `• [ID: ${c.id}] ${c.code} — скидка ${disc}, ${status}${uses}${exp}`;
      })
      .join("\n")
  );
}

export async function getStats(_params: any): Promise<string> {
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
    `• Общая выручка: ${rubFmt(revenue)}\n` +
    `• Промокодов: ${(promos as any[]).length} (активных: ${(promos as any[]).filter((p: any) => p.isActive).length})`
  );
}

// ── NEW READ TOOLS ──────────────────────────────────────────────────────────

export async function getProductDetail(params: any): Promise<string> {
  const id = Number(params.id);
  if (!id) return "Укажите id товара.";
  const p = (await storage.getProduct(id)) as any;
  if (!p) return `Товар №${id} не найден.`;
  const stockSum = p.sizeStock && typeof p.sizeStock === "object"
    ? Object.values(p.sizeStock as Record<string, number>).reduce((s: number, v: number) => s + v, 0)
    : p.stock ?? 0;
  const addlCats = (p.additionalCategories || []) as any[];
  return [
    `📦 [ID: ${p.id}] ${p.name}${p.isHidden ? " 🚫 скрыт" : ""}`,
    `Цена: ${rubFmt(p.price || 0)}${p.discountPercent ? ` (−${p.discountPercent}%)` : ""}`,
    `Остаток: ${stockSum} шт.${p.sizeStock && Object.keys(p.sizeStock).length ? ` (размеров: ${Object.keys(p.sizeStock).length})` : ""}`,
    p.description ? `Описание: ${p.description.slice(0, 200)}${p.description.length > 200 ? "…" : ""}` : "",
    p.composition ? `Состав: ${p.composition}` : "",
    p.category ? `Категория: ${p.category}${p.subcategory ? ` → ${p.subcategory}` : ""}` : "",
    addlCats.length ? `Доп. категории: ${addlCats.map((ac: any) => `${ac.subcategory || ac.category || "—"}`).join(", ")}` : "",
    p.seoTitle ? `SEO title: ${p.seoTitle}` : "SEO title: ❌ не заполнен",
    p.seoDescription ? `SEO desc: ${p.seoDescription}` : "SEO desc: ❌ не заполнен",
    p.sku ? `SKU: ${p.sku}` : "",
    `Создан: ${dateFmt(p.createdAt)}`,
  ].filter(Boolean).join("\n");
}

export async function getOrderDetail(params: any): Promise<string> {
  const id = Number(params.id);
  if (!id) return "Укажите id заказа.";
  const o = (await storage.getOrder(id)) as any;
  if (!o) return `Заказ №${id} не найден.`;
  const items = (o.items || []) as any[];
  const itemsLines = items.map((it: any) => {
    const name = it.name || it.productName || "—";
    const qty = it.quantity || 1;
    const price = rubFmt((it.price || 0) * qty);
    const size = it.size ? ` (${it.size})` : "";
    return `  • ${name}${size} ×${qty} = ${price}`;
  });
  return [
    `🧾 Заказ №${o.id} — ${STATUS_LABELS[o.status] || o.status}`,
    `Сумма: ${rubFmt(o.total || 0)}`,
    `Клиент: ${o.customerName || "—"} (${o.customerEmail || "—"})`,
    o.customerPhone ? `Телефон: ${o.customerPhone}` : "",
    `Адрес: ${o.address || "—"}`,
    o.promoCode ? `Промокод: ${o.promoCode}` : "",
    itemsLines.length ? `Товары (${items.length}):\n${itemsLines.join("\n")}` : "",
    `Дата: ${dateFmt(o.createdAt)}`,
  ].filter(Boolean).join("\n");
}

export async function searchClientsByOrders(params: any): Promise<string> {
  const qRaw = String(params.search || "").toLowerCase().trim();
  if (!qRaw) return "Укажите название товара для поиска клиентов.";
  const tokens = qRaw.split(/\s+/).filter(Boolean);
  let orders = (await storage.getOrders()) as any[];
  orders = orders.filter(
    (o: any) => !o.isDraft && o.status !== "cancelled" && Array.isArray(o.items)
  );
  const matched = new Map<string, { name: string; email: string; orderId: number; date: string; itemName: string }>();
  for (const o of orders) {
    for (const it of o.items as any[]) {
      const name = String(it.name ?? it.productName ?? "").toLowerCase();
      if (tokens.every((t) => name.includes(t))) {
        const key = (o.customerEmail || `no-email-${o.id}`).toLowerCase();
        if (!matched.has(key)) {
          matched.set(key, {
            name: o.customerName || "—",
            email: o.customerEmail || "—",
            orderId: o.id,
            date: dateFmt(o.createdAt),
            itemName: it.name || it.productName || "—",
          });
        }
      }
    }
  }
  if (!matched.size) return `Клиентов, купивших «${qRaw}», не найдено.`;
  const list = [...matched.values()].sort((a, b) => b.orderId - a.orderId).slice(0, 20);
  return (
    `🔍 «${qRaw}» — ${list.length} покупателей:\n` +
    list.map((c, i) => `• ${c.name} (${c.email}) — заказ №${c.orderId} от ${c.date}`).join("\n")
  );
}

export async function getAbandonedCarts(params: any): Promise<string> {
  const sessions = await (storage as any).getAbandonedCartUserSessions?.() as string[] ?? [];
  const dates = await (storage as any).getCartSessionDates?.() as Record<string, number> ?? {};
  if (!sessions.length) return "Брошенных корзин не найдено.";

  const topSessions = sessions.slice(0, Math.min(Number(params.limit) || 20, 50));
  const now = Date.now();
  const lines: string[] = [];
  for (const sid of topSessions) {
    const userId = sid.startsWith("user_") ? Number(sid.slice(5)) : 0;
    const user = userId ? await (storage as any).getUserEmailById?.(userId).catch(() => null) : null;
    const ts = dates[sid];
    const age = ts ? Math.round((now - ts) / 3600000) : null;
    const ageStr = age != null ? (age < 24 ? `${age} ч` : `${Math.round(age / 24)} дн`) : "?";
    lines.push(
      `• ${user?.name || "—"} (${user?.email || sid}) — брошена ${ageStr} назад`
    );
  }
  return `Брошенные корзины (${sessions.length}, показано ${topSessions.length}):\n${lines.join("\n")}`;
}

export async function getRevenueByPeriod(params: any): Promise<string> {
  const groupBy = params.groupBy || "day"; // "day" | "week" | "month"
  const daysBack = Number(params.days) || 30;
  let orders = (await storage.getOrders()) as any[];
  orders = orders.filter(
    (o: any) => !o.isDraft && o.status !== "cancelled" && o.createdAt
  );
  const cutoff = new Date(Date.now() - daysBack * 86400000);
  orders = orders.filter((o: any) => new Date(o.createdAt) >= cutoff);

  const buckets = new Map<string, { revenue: number; count: number }>();
  for (const o of orders) {
    const d = new Date(o.createdAt);
    let key: string;
    if (groupBy === "month") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (groupBy === "week") {
      const monday = new Date(d);
      monday.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
      key = monday.toISOString().slice(0, 10);
    } else {
      key = d.toISOString().slice(0, 10);
    }
    const cur = buckets.get(key) || { revenue: 0, count: 0 };
    cur.revenue += o.total || 0;
    cur.count += 1;
    buckets.set(key, cur);
  }

  const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!sorted.length) return "Нет данных за выбранный период.";
  const totalRevenue = sorted.reduce((s, [, v]) => s + v.revenue, 0);
  const totalOrders = sorted.reduce((s, [, v]) => s + v.count, 0);
  const lines = [
    `📈 Выручка за ${daysBack} дн. (${groupBy === "month" ? "по месяцам" : groupBy === "week" ? "по неделям" : "по дням"}):`,
    `Всего: ${rubFmt(totalRevenue)}, ${totalOrders} заказов`,
    ...sorted.map(([k, v]) => `• ${k} — ${rubFmt(v.revenue)} (${v.count} зак.)`),
  ];
  return lines.join("\n");
}

export async function exportOrdersCsv(params: any): Promise<string> {
  const daysBack = Number(params.days) || 90;
  let orders = (await storage.getOrders()) as any[];
  const cutoff = new Date(Date.now() - daysBack * 86400000);
  orders = orders.filter(
    (o: any) => !o.isDraft && o.status !== "cancelled" && o.createdAt && new Date(o.createdAt) >= cutoff
  );
  if (!orders.length) return "Нет заказов за выбранный период.";

  const header = "ID;Дата;Статус;Клиент;Email;Телефон;Адрес;Сумма (₽);Промокод;Товары";
  const rows = orders.map((o: any) => {
    const items = (o.items || []) as any[];
    const itemsStr = items
      .map((it: any) => `${it.name || it.productName || "—"} ×${it.quantity || 1}`)
      .join(" | ");
    return [
      o.id,
      dateFmt(o.createdAt),
      STATUS_LABELS[o.status] || o.status,
      (o.customerName || "").replace(/;/g, ","),
      (o.customerEmail || "").replace(/;/g, ","),
      (o.customerPhone || "").replace(/;/g, ","),
      (o.address || "").replace(/;/g, ","),
      Math.round((o.total || 0) / 100),
      o.promoCode || "",
      itemsStr,
    ].join(";");
  });

  return `CSV (${orders.length} заказов, ${daysBack} дн):\n\`\`\`\n${header}\n${rows.join("\n")}\n\`\`\``;
}

// ── WRITE TOOLS ─────────────────────────────────────────────────────────────

export async function updateProduct(params: any): Promise<string> {
  const updated = await storage.updateProduct(params.id, params.fields);
  const fieldNames = Object.keys(params.fields).join(", ");
  return `✅ Товар №${params.id} («${updated.name}») обновлён. Изменены поля: ${fieldNames}.`;
}

export async function bulkUpdateProducts(params: any): Promise<string> {
  let all = (await storage.getAllProductsForAdmin()) as any[];
  const f = params.filter || {};
  if (Array.isArray(params.ids)) {
    const idSet = new Set(params.ids.map(Number));
    all = all.filter((p: any) => idSet.has(p.id));
  }
  if (f.category)
    all = all.filter(
      (p: any) => String(p.category || "").toLowerCase() === String(f.category).toLowerCase()
    );
  if (f.subcategory)
    all = all.filter(
      (p: any) =>
        String(p.subcategory || "").toLowerCase() === String(f.subcategory).toLowerCase()
    );
  if (f.isHidden === true) all = all.filter((p: any) => p.isHidden);
  if (f.isHidden === false) all = all.filter((p: any) => !p.isHidden);
  if (f.missingSeo) all = all.filter((p: any) => !p.seoTitle || !p.seoDescription);
  if (!all.length) return "Товары по заданному фильтру не найдены.";
  const capped = all.slice(0, Math.max(1, Math.min(Number(params.limit) || 50, 200)));
  for (const p of capped) await storage.updateProduct(p.id, params.fields);
  const preview = capped
    .slice(0, 5)
    .map((p: any) => `[ID: ${p.id}] ${p.name}`)
    .join("; ");
  return `✅ Массово обновлено ${capped.length} товар(ов). Изменённые поля: ${Object.keys(
    params.fields || {}
  ).join(", ")}. Примеры: ${preview}${capped.length > 5 ? "; …" : ""}`;
}

export async function hideProduct(params: any): Promise<string> {
  await storage.updateProduct(params.id, { isHidden: params.hidden } as any);
  return `✅ Товар №${params.id} ${params.hidden ? "скрыт с сайта" : "снова виден на сайте"}.`;
}

export async function createPromoCode(params: any): Promise<string> {
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

export async function updatePromoCode(params: any): Promise<string> {
  const updated = await storage.updatePromoCode(params.id, params.fields);
  return `✅ Промокод **${updated.code}** обновлён.`;
}

export async function deletePromoCode(params: any): Promise<string> {
  await storage.deletePromoCode(params.id);
  return `✅ Промокод №${params.id} удалён.`;
}

export async function updateOrderStatus(params: any): Promise<string> {
  await storage.updateOrderStatus(params.id, params.status);
  return `✅ Статус заказа №${params.id} изменён на «${STATUS_LABELS[params.status] || params.status}».`;
}

export async function updateAiKnowledgeDraft(params: any): Promise<string> {
  const { draftContent, topicWord, suggestedAnswer, targetBlock, question } = params;
  if (suggestedAnswer !== undefined) {
    if (!suggestedAnswer || !suggestedAnswer.trim()) throw new Error("Введите ответ перед сохранением");
    const blockKey = targetBlock || "ai_prompt_base";
    const current = await (storage as any).getBonusSetting(blockKey) ?? "";
    const entry = `\n\n---\n### Вопрос: ${question || "?"}\n${suggestedAnswer.trim()}`;
    await (storage as any).setBonusSetting(blockKey, current + entry);
    return `✅ Ответ сохранён в блок «${blockKey}». При следующем вопросе бот уже будет знать.`;
  }
  if (!draftContent) throw new Error("draftContent required");
  const currentBase = await (storage as any).getBonusSetting("ai_prompt_base") ?? "";
  const separator = `\n\n---\n## Дополнение (тема: ${topicWord || "неизвестная"})\n`;
  const updated = currentBase + separator + draftContent;
  await (storage as any).setBonusSetting("ai_prompt_base", updated);
  return `✅ Черновик по теме «${topicWord}» добавлен в базовый блок знаний. Кэш обновится в течение 5 минут.`;
}

export async function acknowledgeChatInsights(_params: any): Promise<string> {
  return `✅ Отчёт по конверсии чата принят к сведению.`;
}

export async function sendCartPromos(params: any): Promise<string> {
  const { sendEmail, getCartPromoEmailHtml } = await import("./email");
  const users: Array<{ userId: number; name: string; email: string; topItem: string }> = params.users || [];
  const discount: number = params.discount ?? 12;
  const validityHours: number = params.validityHours ?? 48;
  const emailSubject: string = params.emailSubject || `Персональная скидка ${discount}% — специально для вас 🎁`;
  const emailBody: string | undefined = params.emailBody;
  let sent = 0;
  const errors: string[] = [];
  for (const u of users) {
    try {
      const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      const promoCode = `CART-${suffix}`;
      const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);
      await storage.createPromoCode({ code: promoCode, discountPercent: discount, maxUses: 1, expiresAt, isActive: true } as any);
      const resolvedBody = emailBody
        ? emailBody.replace(/\{name\}/g, u.name || "").replace(/\{item\}/g, u.topItem || "")
        : undefined;
      const html = getCartPromoEmailHtml({
        userName: u.name, promoCode, discountPercent: discount, validityHours,
        topItem: u.topItem, customBody: resolvedBody, cartItems: (u as any).cartItems,
      });
      const ok = await sendEmail({ to: u.email, subject: emailSubject, html });
      if (ok) sent++; else errors.push(u.email);
    } catch (e: any) { errors.push(u.email); }
  }
  return `✅ Промокоды отправлены: ${sent} из ${users.length} клиентов.` + (errors.length > 0 ? ` Ошибки: ${errors.join(", ")}` : "");
}

export async function sendFavoritesPromos(params: any): Promise<string> {
  const { sendEmail, getCartPromoEmailHtml } = await import("./email");
  const users: Array<{ userId: number; name: string; email: string; topItem: string; cartItems?: string[] }> = params.users || [];
  const discount: number = params.discount ?? 10;
  const validityHours: number = params.validityHours ?? 72;
  const emailSubject: string = params.emailSubject || `Персональная скидка ${discount}% — для вас 🎁`;
  const emailBody: string | undefined = params.emailBody;
  const siteUrl = "https://www.booomerangs.ru";
  let sent = 0;
  const errors: string[] = [];
  for (const u of users) {
    try {
      const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      const promoCode = `FAV-${suffix}`;
      const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);
      await (storage as any).createPromoCode({ code: promoCode, discountPercent: discount, maxUses: 1, expiresAt, isActive: true });
      const resolvedBody = emailBody
        ? emailBody.replace(/\{name\}/g, u.name || "").replace(/\{item\}/g, u.topItem || "")
        : undefined;
      const html = getCartPromoEmailHtml({
        userName: u.name, promoCode, discountPercent: discount, validityHours,
        topItem: u.topItem, customBody: resolvedBody, cartItems: u.cartItems,
        sectionTitle: "Товары в вашем избранном", ctaText: "Перейти к избранному", ctaUrl: `${siteUrl}/favorites`,
      });
      const ok = await sendEmail({ to: u.email, subject: emailSubject, html });
      if (ok) sent++; else errors.push(u.email);
    } catch (e: any) { errors.push(u.email); }
  }
  return `✅ Промокоды по избранному отправлены: ${sent} из ${users.length} клиентов.` + (errors.length > 0 ? ` Ошибки: ${errors.join(", ")}` : "");
}

export async function applyPriceDropSuggestions(params: any): Promise<string> {
  const { sendPriceDropEmail } = await import("./email");
  const products: Array<{
    productId: number; productName: string; basePrice?: number; currentPrice: number; newPrice: number;
    subscriberCount: number; subscribers: Array<{ id: string; email: string; priceAtSubscription: number }>;
    imageUrl?: string; slug?: string;
  }> = params.products || [];
  const siteUrl = "https://www.booomerangs.ru";
  let totalSent = 0;
  const results: string[] = [];
  for (const p of products) {
    try {
      const base = p.basePrice || p.currentPrice;
      const discountPct = base > 0 ? Math.round((1 - p.newPrice / base) * 100) : 0;
      await storage.updateProduct(p.productId, { discountPercent: discountPct } as any);
      const subs = p.subscribers ?? [];
      const notifiedIds: string[] = [];
      const productUrl = p.slug ? `${siteUrl}/${p.slug}` : `${siteUrl}/product/${p.productId}`;
      let sent = 0;
      for (const sub of subs) {
        try {
          const ok = await sendPriceDropEmail(sub.email, p.productName, sub.priceAtSubscription, p.newPrice, productUrl, p.imageUrl);
          if (ok) { sent++; notifiedIds.push(sub.id); }
        } catch {}
      }
      if (notifiedIds.length > 0) await (storage as any).markPriceDropSubscriptionsNotified?.(notifiedIds, p.newPrice);
      totalSent += sent;
      results.push(`«${p.productName}»: ${Math.round(p.currentPrice / 100)} → ${Math.round(p.newPrice / 100)} ₽, уведомлено ${sent}/${subs.length}`);
    } catch (e: any) { results.push(`«${p.productName}»: ошибка — ${e?.message}`); }
  }
  return `✅ Снижение цен применено: ${products.length} товаров, уведомлено ${totalSent} подписчиков.\n${results.join("\n")}`;
}

export async function sendRetentionOffers(params: any): Promise<string> {
  const { sendEmail, getCartPromoEmailHtml } = await import("./email");
  const segments: Array<{
    segment: string; label: string;
    users: Array<{ email: string; name: string; topItem: string }>;
    discount: number; validityHours: number;
  }> = params.segments ?? [];
  let totalSent = 0;
  const segResults: string[] = [];
  for (const seg of segments) {
    let sent = 0;
    const PREFIX = seg.segment === "hot" ? "HOT" : seg.segment === "at_risk" ? "RISK" : "NEW";
    for (const u of seg.users) {
      try {
        const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
        const promoCode = `RET-${PREFIX}-${suffix}`;
        const expiresAt = new Date(Date.now() + seg.validityHours * 60 * 60 * 1000);
        await (storage as any).createPromoCode({ code: promoCode, discountPercent: seg.discount, maxUses: 1, expiresAt, isActive: true });
        const html = getCartPromoEmailHtml({ userName: u.name, promoCode, discountPercent: seg.discount, validityHours: seg.validityHours, topItem: u.topItem });
        const subjectMap: Record<string, string> = {
          hot: `${u.name ? u.name.split(" ")[0] + ", в" : "В"}ы давно не заходили — держите подарок 🎁`,
          at_risk: `Мы скучаем! Персональная скидка ${seg.discount}% только для вас`,
          new: `Ваша первая покупка была крутой — вот ещё ${seg.discount}% на следующую`,
        };
        const ok = await sendEmail({ to: u.email, subject: subjectMap[seg.segment] ?? `Персональная скидка ${seg.discount}% от BOOOMERANGS`, html });
        if (ok) sent++;
      } catch {}
    }
    totalSent += sent;
    segResults.push(`${seg.label}: ${sent}/${seg.users.length}`);
  }
  return `✅ Retention-рассылка завершена: ${totalSent} писем. Детали по сегментам: ${segResults.join(", ")}.`;
}

// ── DISPATCH TABLES ─────────────────────────────────────────────────────────

export async function executeReadTool(tool: string, params: any): Promise<string> {
  switch (tool) {
    case "search_products":         return searchProducts(params);
    case "get_orders":              return getOrders(params);
    case "analyze_orders":          return analyzeOrders(params);
    case "get_clients":             return getClients(params);
    case "get_promo_codes":         return getPromoCodes(params);
    case "get_stats":               return getStats(params);
    case "get_product_detail":      return getProductDetail(params);
    case "get_order_detail":        return getOrderDetail(params);
    case "search_clients_by_orders": return searchClientsByOrders(params);
    case "get_abandoned_carts":     return getAbandonedCarts(params);
    case "get_revenue_by_period":   return getRevenueByPeriod(params);
    case "export_orders_csv":       return exportOrdersCsv(params);
    default:                        return `Неизвестный инструмент чтения: ${tool}`;
  }
}

export async function executeWriteTool(tool: string, params: any): Promise<string> {
  switch (tool) {
    case "update_product":              return updateProduct(params);
    case "bulk_update_products":        return bulkUpdateProducts(params);
    case "hide_product":                return hideProduct(params);
    case "create_promo_code":           return createPromoCode(params);
    case "update_promo_code":           return updatePromoCode(params);
    case "delete_promo_code":           return deletePromoCode(params);
    case "update_order_status":         return updateOrderStatus(params);
    case "update_ai_knowledge_draft":   return updateAiKnowledgeDraft(params);
    case "acknowledge_chat_insights":   return acknowledgeChatInsights(params);
    case "send_cart_promos":            return sendCartPromos(params);
    case "send_favorites_promos":       return sendFavoritesPromos(params);
    case "apply_price_drop_suggestions": return applyPriceDropSuggestions(params);
    case "send_retention_offers":       return sendRetentionOffers(params);
    default:                            throw new Error(`Неизвестный инструмент изменения: ${tool}`);
  }
}