import { storage } from "./storage";
import {
  addToQueue,
  addLogEntry,
  getAgentSettings,
} from "./agent-queue";
import { notifyAgentQueueItem, sendAgentAlert, sendAgentDigest } from "./telegram";
import { vkNotifyAgentAlert, vkNotifyAgentDigest } from "./vk";

const MAX_SEO_PER_RUN = 20;          // снижено с 50 — меньше нагрузка на Groq
const MAX_QUEUE_PER_RUN = 20;
const LOW_STOCK_THRESHOLD = 2;
const STALE_DAYS = 14;
const DESCRIPTION_MIN_LENGTH = 40;

// Groq лимит: 30 RPM на бесплатном тарифе.
// Безопасный темп: 12 RPM (один запрос каждые 5 секунд) — в 2.5× ниже лимита.
// При 429: минимальное ожидание 3 минуты перед повтором.
const GROQ_SAFE_RPM = 12;
const GROQ_DELAY_MS = Math.ceil(60_000 / GROQ_SAFE_RPM); // 5 000 мс между запросами
const GROQ_429_WAIT_MS = 3 * 60_000;                      // 3 минуты при rate limit

// ── Groq helpers ──────────────────────────────────────────────────────────

let requestsThisRun = 0;
let requestsThisMinute = 0;
let minuteWindowStart = 0;

function resetRequestCounter() {
  requestsThisRun = 0;
  requestsThisMinute = 0;
  minuteWindowStart = Date.now();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function groqComplete(
  userPrompt: string,
  systemPrompt: string,
  maxTokens = 512
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  const proxyUrl = process.env.GROQ_PROXY_URL;
  if (!apiKey && !proxyUrl) throw new Error("Groq not configured");

  const groqBase = proxyUrl
    ? proxyUrl.replace(/\/$/, "")
    : "https://api.groq.com";

  // Счётчик скользящего окна — сбрасываем каждую минуту
  const now = Date.now();
  if (now - minuteWindowStart >= 60_000) {
    requestsThisMinute = 0;
    minuteWindowStart = now;
  }

  // Если уже достигли безопасного лимита — ждём начала следующей минуты
  if (requestsThisMinute >= GROQ_SAFE_RPM) {
    const waitMs = 60_000 - (now - minuteWindowStart) + 1_000;
    console.log(`[AutonomousAgent] Groq safe RPM reached (${requestsThisMinute}), waiting ${Math.round(waitMs / 1000)}s…`);
    await sleep(waitMs);
    requestsThisMinute = 0;
    minuteWindowStart = Date.now();
  }

  // До 3 попыток при 429. При каждом 429 ждём GROQ_429_WAIT_MS (3 мин).
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${groqBase}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });

    if (resp.status === 429) {
      const retryAfterSec = Number(resp.headers.get("retry-after") || "0");
      const waitMs = Math.max(retryAfterSec * 1_000, GROQ_429_WAIT_MS);
      lastError = new Error(`Groq 429 rate limit — stopping run until tomorrow`);
      console.warn(`[AutonomousAgent] Groq 429 (attempt ${attempt + 1}/3) — waiting ${Math.round(waitMs / 1000)}s…`);
      await sleep(waitMs);
      requestsThisMinute = 0;
      minuteWindowStart = Date.now();
      if (attempt === 2) {
        // 3-й раз подряд 429 — останавливаем весь батч до следующей ночи
        throw new Error("Groq 429: три попытки подряд — батч остановлен до следующей ночи");
      }
      continue;
    }

    if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`);

    const data: any = await resp.json();
    let text: string = data.choices?.[0]?.message?.content || "";
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    requestsThisRun++;
    requestsThisMinute++;

    // Пауза после каждого успешного запроса (5 секунд)
    await sleep(GROQ_DELAY_MS);
    return text;
  }

  throw lastError ?? new Error("Groq: all retries failed");
}

// ── Message chunking ──────────────────────────────────────────────────────
// Telegram лимит ~4096 символов, VK ~4096, режем по 3000 с запасом

const TG_CHUNK_CHARS = 3_000;

async function sendAlertChunked(header: string, lines: string[]): Promise<void> {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = header.length;

  for (const line of lines) {
    if (currentLen + line.length + 1 > TG_CHUNK_CHARS && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = header.length;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length > 0) chunks.push(current);

  const totalChunks = chunks.length;
  for (let i = 0; i < totalChunks; i++) {
    const partLabel = totalChunks > 1 ? ` (часть ${i + 1}/${totalChunks})` : "";
    const text = `${header}${partLabel}\n\n${chunks[i].join("\n")}`;
    await sendAgentAlert(text);
    vkNotifyAgentAlert(text);
    if (i < totalChunks - 1) await sleep(500);
  }
}

// ── Product classification ─────────────────────────────────────────────────

const DESIGN_KEYWORDS = /["«»]|CHAOS|LOVE|HATE|FEAR|RAGE|EVIL|TOXIC|ANGEL|DEMON|GHOST|SKULL|ROSE|DOOM|HELL|VIBE|WAVE|HAZE|STAR|MOON|DARK|NEON|ACID|VOID|AURA|FLAME|GLOOM|MYTH|ECHO|NOVA|FLUX|BOOM|RIOT|FADE|GLOW|DUSK|DAWN/i;

function hasUniqueDesign(name: string): boolean {
  return DESIGN_KEYWORDS.test(name);
}

// ── SEO Job ───────────────────────────────────────────────────────────────

const SEO_SYSTEM = `Ты SEO-копирайтер для российского стритвир-бренда BMGBRAND (booomerangs.ru).
Пиши на русском языке. Возвращай ТОЛЬКО JSON без пояснений.

Формат ответа:
{"seoTitle":"...","seoDescription":"..."}

Правила:
- seoTitle: до 60 символов, включай название товара + бренд, ключевые слова
- seoDescription: до 155 символов, привлекательное описание с ключевыми словами для поиска
- Тон: молодёжный, живой, но не кричащий
- Не используй восклицательные знаки подряд
- Не упоминай конкретные цены`;

export async function runSeoJob(): Promise<{ processed: number; skipped: number; errors: number }> {
  console.log("[AutonomousAgent] Starting SEO job...");
  const settings = await getAgentSettings();
  if (!settings.enabled || !settings.seoEnabled) {
    console.log("[AutonomousAgent] SEO job disabled, skipping.");
    return { processed: 0, skipped: 0, errors: 0 };
  }

  resetRequestCounter();
  const allProducts = (await storage.getProducts()) as any[];
  const needsSeo = allProducts.filter(
    (p) =>
      !p.isHidden &&
      (!p.seoTitle || p.seoTitle.trim() === "" || !p.seoDescription || p.seoDescription.trim() === "")
  );

  console.log(`[AutonomousAgent] Products needing SEO: ${needsSeo.length}`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  const toProcess = needsSeo.slice(0, MAX_SEO_PER_RUN);

  for (const product of toProcess) {
    if (requestsThisRun >= MAX_SEO_PER_RUN) break;

    try {
      const isDesign = hasUniqueDesign(product.name);
      const descSnippet = product.description
        ? product.description.slice(0, 200)
        : "";
      const composition = product.composition || "";
      const priceRub = product.price ? Math.round(product.price / 100) : 0;

      const prompt = `Товар: ${product.name}
Категория: ${product.category || "—"}${product.subcategory ? " / " + product.subcategory : ""}
Цена: ${priceRub} ₽
Состав: ${composition || "—"}
Описание: ${descSnippet || "—"}
${isDesign ? "ВАЖНО: это товар с уникальным принтом, упомяни дизайн в общих чертах" : ""}

Сгенерируй seoTitle и seoDescription.`;

      const raw = await groqComplete(prompt, SEO_SYSTEM, 1024);

      console.log(`[AutonomousAgent] SEO raw for ${product.id}: ${raw.slice(0, 120)}`);

      let parsed: { seoTitle?: string; seoDescription?: string } = {};
      try {
        const jsonMatch = raw.match(/\{[\s\S]*?\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        console.warn(`[AutonomousAgent] SEO JSON parse failed for ${product.id}, raw: ${raw.slice(0, 100)}`);
        errors++;
        continue;
      }

      if (!parsed.seoTitle && !parsed.seoDescription) {
        console.warn(`[AutonomousAgent] SEO empty result for ${product.id}`);
        errors++;
        continue;
      }

      const updateFields: any = {};
      if (parsed.seoTitle) updateFields.seoTitle = parsed.seoTitle.slice(0, 80);
      if (parsed.seoDescription) updateFields.seoDescription = parsed.seoDescription.slice(0, 200);

      await storage.updateProduct(product.id, updateFields);
      processed++;

      await addLogEntry({
        type: "seo",
        action: `SEO сгенерирован для товара #${product.id}`,
        summary: `«${product.name}» → title: «${updateFields.seoTitle?.slice(0, 40) || "—"}»`,
        isAuto: true,
      });
    } catch (e: any) {
      console.error(`[AutonomousAgent] SEO error for product ${product.id}:`, e?.message);
      errors++;
    }
  }

  skipped = needsSeo.length - toProcess.length;
  console.log(`[AutonomousAgent] SEO job done: processed=${processed}, skipped=${skipped}, errors=${errors}`);

  if (processed > 0) {
    await addLogEntry({
      type: "seo_batch",
      action: "Ночной SEO-батч завершён",
      summary: `Обработано: ${processed} товаров, пропущено: ${skipped}, ошибок: ${errors}`,
      isAuto: true,
    });
  }

  return { processed, skipped, errors };
}

// ── Alerts Job (только по понедельникам) ──────────────────────────────────

export async function runAlertsJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting alerts job...");
  const settings = await getAgentSettings();
  if (!settings.enabled || !settings.alertsEnabled) return;

  const allProducts = (await storage.getProducts()) as any[];
  const visibleProducts = allProducts.filter((p) => !p.isHidden);

  // Low stock alert
  const lowStock: Array<{ name: string; id: number; total: number }> = [];
  for (const p of visibleProducts) {
    const sizeStock = p.sizeStock as Record<string, number> | null;
    if (!sizeStock) continue;
    const total = Object.values(sizeStock).reduce(
      (s: number, v: unknown) => s + (Number(v) || 0),
      0
    );
    if (total > 0 && total <= LOW_STOCK_THRESHOLD) {
      lowStock.push({ name: p.name, id: p.id, total });
    }
  }

  if (lowStock.length > 0) {
    const lines = lowStock.map(
      (p) => `• <b>${p.name}</b> — осталось ${p.total} шт. (ID: ${p.id})`
    );
    await sendAlertChunked("⚠️ <b>BOOOM AI: Заканчивается товар</b>", lines);
    console.log(`[AutonomousAgent] Low stock alert: ${lowStock.length} products`);
  }

  // No photos alert
  const noPhoto = visibleProducts.filter((p) => {
    const imgs = p.images as string[] | null;
    return !imgs || imgs.length === 0;
  });

  if (noPhoto.length > 0) {
    const lines = noPhoto.map(
      (p: any) => `• <b>${p.name}</b> (ID: ${p.id})`
    );
    await sendAlertChunked("📷 <b>BOOOM AI: Товары без фото</b>", lines);
    console.log(`[AutonomousAgent] No-photo alert: ${noPhoto.length} products`);
  }

  // Отмечаем что уже отправляли сегодня
  await markMondaySentToday();
}

// ── Stale Products Job (dangerous → queue) ────────────────────────────────

export async function runStaleProductsJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting stale products job...");
  const settings = await getAgentSettings();
  if (!settings.enabled) return;

  const allProducts = (await storage.getProducts()) as any[];
  const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const staleCandidates = allProducts.filter((p) => {
    if (p.isHidden) return false;
    const sizeStock = p.sizeStock as Record<string, number> | null;
    if (!sizeStock) return false;
    const total = Object.values(sizeStock).reduce(
      (s: number, v: unknown) => s + (Number(v) || 0),
      0
    );
    if (total > 0) return false;
    const updatedAt = p.updatedAt ? new Date(String(p.updatedAt)) : null;
    return !updatedAt || updatedAt < staleDate;
  });

  let queued = 0;
  for (const p of staleCandidates.slice(0, MAX_QUEUE_PER_RUN)) {
    try {
      const item = await addToQueue({
        type: "hide_product",
        title: `Скрыть товар без остатка: «${p.name}»`,
        description: `Товар «${p.name}» (ID: ${p.id}) имеет нулевой остаток. Рекомендую скрыть с сайта до появления товара.`,
        params: { id: p.id, hidden: true },
        tool: "hide_product",
      });

      await notifyAgentQueueItem(item);
      queued++;

      await sleep(500);
    } catch (e: any) {
      console.error(`[AutonomousAgent] Stale queue error for ${p.id}:`, e?.message);
    }
  }

  if (queued > 0) {
    console.log(`[AutonomousAgent] Stale products queued: ${queued}`);
  }
}

// ── Description Improvement Job (dangerous → queue) ───────────────────────

const DESC_SYSTEM = `Ты копирайтер для российского стритвир-бренда BMGBRAND (booomerangs.ru).
Пиши на русском, живым молодёжным языком. Возвращай ТОЛЬКО текст описания без JSON, заголовков и лишних символов.

Описание: 3-5 предложений. Расскажи о товаре, его настроении, как носить, из чего сделан.
Если это товар с принтом — упомяни характер дизайна в общих чертах (дерзкий, минималистичный и т.д.).
Не придумывай конкретные детали принта — только атмосферу.`;

export async function runDescriptionJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting description job...");
  const settings = await getAgentSettings();
  if (!settings.enabled) return;

  const allProducts = (await storage.getProducts()) as any[];
  const needsDesc = allProducts.filter(
    (p) =>
      !p.isHidden &&
      (!p.description || p.description.trim().length < DESCRIPTION_MIN_LENGTH)
  );

  console.log(`[AutonomousAgent] Products needing description: ${needsDesc.length}`);

  let queued = 0;
  for (const product of needsDesc.slice(0, MAX_QUEUE_PER_RUN)) {
    if (requestsThisRun >= MAX_QUEUE_PER_RUN) break;

    try {
      const isDesign = hasUniqueDesign(product.name);
      const priceRub = product.price ? Math.round(product.price / 100) : 0;

      const prompt = `Товар: ${product.name}
Категория: ${product.category || "—"}${product.subcategory ? " / " + product.subcategory : ""}
Цена: ${priceRub} ₽
Состав: ${product.composition || "—"}
${isDesign ? "Это товар с уникальным принтом." : ""}

Напиши описание товара для сайта.`;

      const description = await groqComplete(prompt, DESC_SYSTEM, 400);
      if (!description || description.length < 20) continue;

      const flagForReview = isDesign;
      const item = await addToQueue({
        type: "description",
        title: `Описание для «${product.name}»${flagForReview ? " ⚠️ проверь принт" : ""}`,
        description: `Предлагаю описание для товара #${product.id}:\n\n${description}`,
        params: { id: product.id, fields: { description } },
        tool: "update_product",
      });

      await notifyAgentQueueItem(item);
      queued++;
    } catch (e: any) {
      console.error(`[AutonomousAgent] Description error for ${product.id}:`, e?.message);
    }
  }

  console.log(`[AutonomousAgent] Description job done: queued=${queued}`);
}

// ── Weekly Digest ─────────────────────────────────────────────────────────

const DIGEST_AI_SYSTEM = `Ты аналитик для российского стритвир-магазина BOOOMERANGS.
Тебе дадут сводку по продажам за неделю. Напиши 2-3 коротких наблюдения на русском языке — что важно, на что обратить внимание, что радует или настораживает.
Пиши живо, по-человечески, без воды. Только факты и выводы. Не повторяй цифры из сводки дословно.
Верни только текст наблюдений без заголовков и маркеров.`;

export async function runWeeklyDigest(): Promise<void> {
  console.log("[AutonomousAgent] Starting weekly digest...");
  const settings = await getAgentSettings();
  if (!settings.enabled || !settings.digestEnabled) return;

  try {
    const [products, orders] = await Promise.all([
      storage.getProducts() as Promise<any[]>,
      storage.getOrders() as Promise<any[]>,
    ]);

    const visibleProducts = products.filter((p: any) => !p.isHidden);
    const hiddenProducts = products.filter((p: any) => p.isHidden);

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

    const weekOrders = orders.filter(
      (o: any) => o.createdAt && new Date(String(o.createdAt)).getTime() > oneWeekAgo
    );
    const weekPaid = weekOrders.filter((o: any) =>
      ["paid", "shipped", "delivered"].includes(o.status)
    );
    const weekCancelled = weekOrders.filter((o: any) => o.status === "cancelled");
    const weekRevenue = weekPaid.reduce((s: number, o: any) => s + (o.total || 0), 0);
    const cancelledRevenue = weekCancelled.reduce((s: number, o: any) => s + (o.total || 0), 0);
    const avgCheck = weekPaid.length > 0 ? Math.round(weekRevenue / weekPaid.length / 100) : 0;
    const conversion = weekOrders.length > 0
      ? Math.round((weekPaid.length / weekOrders.length) * 100)
      : 0;

    // Зависшие заказы: статус "paid" больше 3 дней
    const stuckPaid = orders.filter((o: any) => {
      if (o.status !== "paid") return false;
      const created = o.createdAt ? new Date(String(o.createdAt)).getTime() : 0;
      return created < threeDaysAgo;
    });

    // Новые vs повторные покупатели
    const weekUserIds = weekPaid
      .map((o: any) => o.userId)
      .filter((id: any) => id != null && id !== 0);
    const allPrevUserIds = new Set(
      orders
        .filter((o: any) => {
          const created = o.createdAt ? new Date(String(o.createdAt)).getTime() : 0;
          return created <= oneWeekAgo && ["paid", "shipped", "delivered"].includes(o.status);
        })
        .map((o: any) => o.userId)
        .filter((id: any) => id != null)
    );
    const newBuyers = weekUserIds.filter((id: any) => !allPrevUserIds.has(id)).length;
    const returningBuyers = weekUserIds.length - newBuyers;

    // Топ товаров по количеству и выручке
    const productSales = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const order of weekPaid) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const key = String(item.productId || item.name || "?");
        const name = item.productName || item.name || `Товар ${key}`;
        const qty = Number(item.quantity) || 1;
        const rev = (Number(item.price) || 0) * qty;
        const existing = productSales.get(key);
        if (existing) {
          existing.qty += qty;
          existing.revenue += rev;
        } else {
          productSales.set(key, { name, qty, revenue: rev });
        }
      }
    }
    const sortedByQty = [...productSales.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const sortedByRev = [...productSales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // Состояние магазина
    const noSeo = products.filter(
      (p: any) => !p.isHidden && (!p.seoTitle || !p.seoDescription)
    ).length;
    const noDesc = products.filter(
      (p: any) => !p.isHidden && (!p.description || p.description.trim().length < DESCRIPTION_MIN_LENGTH)
    ).length;
    const criticalStock = visibleProducts.filter((p: any) => {
      const ss = p.sizeStock as Record<string, number> | null;
      if (!ss) return false;
      const total = Object.values(ss).reduce((s: number, v: unknown) => s + (Number(v) || 0), 0);
      return total === 1;
    }).length;
    const lowStockCount = visibleProducts.filter((p: any) => {
      const ss = p.sizeStock as Record<string, number> | null;
      if (!ss) return false;
      const total = Object.values(ss).reduce((s: number, v: unknown) => s + (Number(v) || 0), 0);
      return total > 1 && total <= LOW_STOCK_THRESHOLD;
    }).length;

    // Топ по количеству
    const topQtyLines = sortedByQty.length > 0
      ? sortedByQty.map((p, i) => `  ${i + 1}. ${p.name.slice(0, 35)} — ${p.qty} шт.`).join("\n")
      : "  нет данных";

    // Топ по выручке
    const topRevLines = sortedByRev.length > 0
      ? sortedByRev.map((p, i) => `  ${i + 1}. ${p.name.slice(0, 35)} — ${Math.round(p.revenue / 100).toLocaleString("ru-RU")} ₽`).join("\n")
      : "  нет данных";

    // Пробуем получить AI-комментарий (если Groq доступен — +1 запрос)
    let aiComment = "";
    try {
      const digestSummaryForAi =
        `Заказов: ${weekOrders.length}, оплачено: ${weekPaid.length}, выручка: ${Math.round(weekRevenue / 100).toLocaleString("ru-RU")} ₽, ` +
        `средний чек: ${avgCheck} ₽, конверсия: ${conversion}%, ` +
        `отмен: ${weekCancelled.length}, зависших заказов: ${stuckPaid.length}, ` +
        `новых покупателей: ${newBuyers}, повторных: ${returningBuyers}. ` +
        `Топ товар по продажам: ${sortedByQty[0]?.name || "—"} (${sortedByQty[0]?.qty || 0} шт.). ` +
        `Критический остаток (1 шт.): ${criticalStock} товаров.`;
      aiComment = await groqComplete(digestSummaryForAi, DIGEST_AI_SYSTEM, 200);
    } catch {
      // AI-комментарий необязателен — продолжаем без него
    }

    const dateStr = new Date().toLocaleDateString("ru-RU", {
      day: "numeric", month: "long", year: "numeric",
    });

    const text =
      `📊 <b>BOOOM AI — Дайджест</b> · ${dateStr}\n\n` +

      `<b>💰 Продажи за неделю</b>\n` +
      `• Заказов: ${weekOrders.length} → оплачено: ${weekPaid.length} (${conversion}%)\n` +
      `• Выручка: ${Math.round(weekRevenue / 100).toLocaleString("ru-RU")} ₽\n` +
      `• Средний чек: ${avgCheck.toLocaleString("ru-RU")} ₽\n` +
      `• Новых покупателей: ${newBuyers} / повторных: ${returningBuyers}\n` +

      (weekCancelled.length > 0
        ? `• ⚠️ Отменено: ${weekCancelled.length} заказов (${Math.round(cancelledRevenue / 100).toLocaleString("ru-RU")} ₽)\n`
        : "") +
      (stuckPaid.length > 0
        ? `• 🔴 Не отправлено >3 дней: ${stuckPaid.length} заказов!\n`
        : "") +

      `\n<b>🏆 Топ-5 по количеству</b>\n${topQtyLines}\n` +
      `\n<b>💵 Топ-5 по выручке</b>\n${topRevLines}\n` +

      `\n<b>🏪 Магазин</b>\n` +
      `• Товаров: ${visibleProducts.length} видимых / ${hiddenProducts.length} скрытых\n` +
      `• Без SEO: ${noSeo} · Без описания: ${noDesc}\n` +
      (criticalStock > 0 ? `• 🔴 Остаток 1 шт.: ${criticalStock} товаров\n` : "") +
      (lowStockCount > 0 ? `• ⚠️ Заканчивается (2 шт.): ${lowStockCount} товаров\n` : "") +

      (aiComment ? `\n<b>🤖 Наблюдение</b>\n${aiComment}` : "");

    await sendAgentDigest(text);
    vkNotifyAgentDigest(text);

    await addLogEntry({
      type: "digest",
      action: "Еженедельный дайджест отправлен",
      summary: `Заказов: ${weekOrders.length}, выручка: ${Math.round(weekRevenue / 100).toLocaleString("ru-RU")} ₽, топ: ${sortedByQty[0]?.name || "—"}`,
      isAuto: true,
    });
  } catch (e: any) {
    console.error("[AutonomousAgent] Weekly digest error:", e?.message);
  }
}

// ── Master runner ─────────────────────────────────────────────────────────

let lastRunStatus: { lastRun: string; lastResult: string } = {
  lastRun: "никогда",
  lastResult: "—",
};

export function getAgentStatus() {
  return lastRunStatus;
}

export async function runAutonomousAgent(): Promise<void> {
  console.log("[AutonomousAgent] Master run started");
  resetRequestCounter();

  const startTime = Date.now();

  try {
    await runSeoJob();
    await runStaleProductsJob();
    await runDescriptionJob();

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    lastRunStatus = {
      lastRun: new Date().toISOString(),
      lastResult: `Успешно за ${elapsed}с, Groq-запросов: ${requestsThisRun}`,
    };

    console.log(`[AutonomousAgent] Master run done in ${elapsed}s, Groq requests: ${requestsThisRun}`);
  } catch (e: any) {
    lastRunStatus = {
      lastRun: new Date().toISOString(),
      lastResult: `Ошибка: ${e?.message}`,
    };
    console.error("[AutonomousAgent] Master run error:", e?.message);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────

export function initAutonomousAgent(): void {
  const nowMs = Date.now();
  const now = new Date();

  // Ночной SEO + анализ — каждые 24ч, стартует в ~03:00 МСК (00:00 UTC)
  const nextRun = new Date(now);
  nextRun.setUTCHours(0, 0, 0, 0);
  if (nextRun.getTime() <= nowMs) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  const seoDelayMs = nextRun.getTime() - nowMs;

  const runSeoSafe = () =>
    runAutonomousAgent().catch((e: any) =>
      console.error("[AutonomousAgent] SEO job unhandled error:", e?.message)
    );

  setTimeout(() => {
    runSeoSafe();
    setInterval(runSeoSafe, 24 * 60 * 60 * 1000);
  }, seoDelayMs);

  // Алерты + дайджест — каждый понедельник в 09:00 МСК (06:00 UTC)
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(6, 0, 0, 0); // 09:00 МСК
  const mondayDelayMs = nextMonday.getTime() - nowMs;

  const runMondaySafe = () =>
    runAlertsJob()
      .then(() => runWeeklyDigest())
      .catch((e: any) =>
        console.error("[AutonomousAgent] Monday job unhandled error:", e?.message)
      );

  setTimeout(() => {
    runMondaySafe();
    setInterval(runMondaySafe, 7 * 24 * 60 * 60 * 1000);
  }, mondayDelayMs);

  console.log(
    `[AutonomousAgent] Scheduled: SEO in ${Math.round(seoDelayMs / 60000)}min, alerts+digest next Monday in ${Math.round(mondayDelayMs / 60000 / 60)}h`
  );
}
