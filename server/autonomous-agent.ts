import { storage } from "./storage";
import {
  addToQueue,
  addLogEntry,
  getAgentSettings,
} from "./agent-queue";
import { notifyAgentQueueItem, sendAgentAlert, sendAgentDigest } from "./telegram";
import { vkNotifyAgentAlert, vkNotifyAgentDigest } from "./vk";
import { sendPushToAdmins } from "./push-service";

const MONDAY_SENT_KEY = "agent_monday_sent_date";

async function markMondaySentToday(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await (storage as any).setBonusSetting(MONDAY_SENT_KEY, today);
}

// Distributed job lock via YDB bonus_settings.
// Returns true  → lock acquired, job should proceed.
// Returns false → another server already ran this job within windowMs, skip.
// Fail-open: if YDB is unavailable, returns true so the job still runs.
async function acquireJobLock(key: string, windowMs: number): Promise<boolean> {
  try {
    const raw = await (storage as any).getBonusSetting(key);
    if (raw) {
      const lastRun = new Date(raw).getTime();
      if (!isNaN(lastRun) && (Date.now() - lastRun) < windowMs) {
        console.log(
          `[AutonomousAgent] Job lock "${key}": already ran ${Math.round((Date.now() - lastRun) / 60000)} min ago — skipping (duplicate guard)`
        );
        return false;
      }
    }
    await (storage as any).setBonusSetting(key, new Date().toISOString());
    return true;
  } catch (err: any) {
    console.warn(`[AutonomousAgent] Job lock "${key}" error (proceeding anyway):`, err?.message);
    return true; // fail-open: не блокируем джоб если YDB недоступна
  }
}

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
    // Убираем <think>...</think> блоки (Qwen3 reasoning), включая незакрытые теги
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    text = text.replace(/<think>[\s\S]*/gi, "");
    text = text.trim();
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

const SEO_SYSTEM = `Ты SEO-копирайтер для российского бренда одежды BMGBRAND (booomerangs.ru).
Пиши на русском языке. Возвращай ТОЛЬКО JSON без пояснений.

Формат ответа:
{"seoTitle":"...","seoDescription":"..."}

Правила для seoTitle (до 60 символов):
- Формула: [Тип товара] [Бренд] — [ключевое слово покупки]
- Используй ключевые слова: «купить», «оригинал», «официальный сайт», «молодёжная», «базовая», «оверсайз», «Россия»
- ЗАПРЕЩЕНО использовать слова: стритвир, уличная одежда, уличная мода, уличный стиль

Правила для seoDescription (до 155 символов):
- Включи: тип вещи + бренд BMGBRAND или Booomerangs + призыв (купить, заказать, выбрать) + характеристику (материал, крой, цвет)
- ЗАПРЕЩЕНО использовать слова: стритвир, уличная одежда, уличная мода, уличный стиль

Общие правила:
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
  if (!await acquireJobLock('job_lock_seo', 20 * 60 * 60 * 1000)) return { processed: 0, skipped: 0, errors: 0 };

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
  if (!await acquireJobLock('job_lock_alerts', 6 * 24 * 60 * 60 * 1000)) return;

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
    sendPushToAdmins({
      title: '⚠️ BOOOM AI: Заканчивается товар',
      body: `${lowStock.length} поз. на критическом остатке. Топ: «${lowStock[0].name}» — ${lowStock[0].total} шт.`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-low-stock',
    }).catch(() => {});
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
    sendPushToAdmins({
      title: '📷 BOOOM AI: Товары без фото',
      body: `${noPhoto.length} товаров опубликованы без фотографий`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-no-photo',
    }).catch(() => {});
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
  if (!await acquireJobLock('job_lock_stale_products', 20 * 60 * 60 * 1000)) return;

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
      await addToQueue({
        type: "hide_product",
        title: `Скрыть товар без остатка: «${p.name}»`,
        description: `Товар «${p.name}» (ID: ${p.id}) имеет нулевой остаток. Рекомендую скрыть с сайта до появления товара.`,
        params: { id: p.id, hidden: true },
        tool: "hide_product",
      });

      queued++;

      await sleep(500);
    } catch (e: any) {
      console.error(`[AutonomousAgent] Stale queue error for ${p.id}:`, e?.message);
    }
  }

  if (queued > 0) {
    console.log(`[AutonomousAgent] Stale products queued: ${queued}`);
    await sendAgentAlert(`👁 <b>BOOOM AI:</b> Найдено ${queued} товаров с нулевым остатком — ожидают проверки в очереди.`);
    sendPushToAdmins({
      title: '👁 BOOOM AI: Залежавшиеся товары',
      body: `${queued} товаров с нулевым остатком ожидают проверки в очереди`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-stale',
    }).catch(() => {});
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
  if (!await acquireJobLock('job_lock_description', 20 * 60 * 60 * 1000)) return;

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
      await addToQueue({
        type: "description",
        title: `Описание для «${product.name}»${flagForReview ? " ⚠️ проверь принт" : ""}`,
        description: `Предлагаю описание для товара #${product.id}:\n\n${description}`,
        params: { id: product.id, fields: { description } },
        tool: "update_product",
      });

      queued++;
    } catch (e: any) {
      console.error(`[AutonomousAgent] Description error for ${product.id}:`, e?.message);
    }
  }

  console.log(`[AutonomousAgent] Description job done: queued=${queued}`);
  if (queued > 0) {
    await sendAgentAlert(`📝 <b>BOOOM AI:</b> Готово ${queued} описаний для товаров — ожидают проверки в очереди.`);
    sendPushToAdmins({
      title: '📝 BOOOM AI: Описания готовы',
      body: `${queued} AI-описаний товаров ожидают проверки в очереди`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-descriptions',
    }).catch(() => {});
  }
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
  if (!await acquireJobLock('job_lock_weekly_digest', 6 * 24 * 60 * 60 * 1000)) return;

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
    sendPushToAdmins({
      title: '📊 BOOOM AI: Дайджест готов',
      body: `Заказов: ${weekOrders.length}, выручка: ${Math.round(weekRevenue / 100).toLocaleString('ru-RU')} ₽, конверсия: ${conversion}%`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-digest',
    }).catch(() => {});

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

// ── Cart Abandonment Analysis Job (каждое воскресенье 11:00 МСК) ──────────

const CART_ANALYSIS_AI_SYSTEM = `Ты аналитик для российского стритвир-магазина BOOOMERANGS.
Тебе дадут список товаров которые покупатели добавляют в корзину, но не покупают.
Для КАЖДОГО товара напиши ОДНУ краткую рекомендацию (макс. 10 слов): что делать — снизить цену, запустить акцию, пополнить склад, улучшить фото, или другое.
Формат ответа — строго JSON-массив строк, без пояснений, без markdown:
["рекомендация для товара 1","рекомендация для товара 2",...]
Количество элементов = количеству товаров на входе.`;

function cartAgeLabel(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return "сегодня";
  if (days === 1) return "1 день";
  if (days < 7) return `${days} дн.`;
  if (days < 30) return `${Math.floor(days / 7)} нед.`;
  return `${Math.floor(days / 30)} мес.`;
}

export async function runCartAnalysisJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting cart analysis job...");
  const db = storage as any;
  if (typeof db.getAbandonedCartUserSessions !== "function") {
    console.log("[AutonomousAgent] Cart analysis: YDB not available, skipping.");
    return;
  }
  if (!await acquireJobLock('job_lock_cart_analysis', 6 * 24 * 60 * 60 * 1000)) return;

  try {
    // 1. Получаем все сессии пользователей с товарами в корзине
    const sessions: string[] = await db.getAbandonedCartUserSessions();
    if (sessions.length === 0) {
      console.log("[AutonomousAgent] Cart analysis: no sessions with items.");
      await addLogEntry({
        type: "cart_analysis",
        action: "Анализ брошенных корзин: корзины пусты",
        summary: "Нет сессий с товарами в корзине — брошенных корзин не обнаружено.",
        isAuto: false,
      });
      return;
    }

    // 2. Получаем возраст корзин (когда добавлен первый товар)
    let sessionDates: Record<string, number> = {};
    if (typeof db.getCartSessionDates === "function") {
      sessionDates = await db.getCartSessionDates();
    }

    // 3. Агрегируем товары из всех корзин + собираем кто именно держит товар
    const cartMap = new Map<string, {
      name: string;
      price: number;
      cartCount: number;
      totalQty: number;
      sizeStock: Record<string, number> | null;
    }>();
    // sessionId → userId для рассылки
    const sessionUserIds = new Map<string, number>();

    for (const sessionId of sessions) {
      try {
        const userId = parseInt(sessionId.replace("user_", ""), 10);
        if (!isNaN(userId)) sessionUserIds.set(sessionId, userId);

        const items = await storage.getCartItems(sessionId);
        for (const item of items) {
          const key = String(item.productId);
          const name = (item.product?.name || `Товар ${key}`).slice(0, 50);
          const price = item.product?.price ?? 0;
          const sizeStock = (item.product as any)?.sizeStock ?? null;
          const existing = cartMap.get(key);
          if (existing) {
            existing.cartCount += 1;
            existing.totalQty += item.quantity;
          } else {
            cartMap.set(key, { name, price, cartCount: 1, totalQty: item.quantity, sizeStock });
          }
        }
        await sleep(80);
      } catch (e: any) {
        console.warn(`[AutonomousAgent] Cart analysis: error reading session ${sessionId}:`, e?.message);
      }
    }

    if (cartMap.size === 0) {
      console.log("[AutonomousAgent] Cart analysis: no products found in carts.");
      await addLogEntry({
        type: "cart_analysis",
        action: "Анализ брошенных корзин: нет товаров",
        summary: "Сессии найдены, но корзины оказались пустыми.",
        isAuto: false,
      });
      return;
    }

    // 4. Оплаченные заказы за 30 дней — сколько раз купили каждый товар
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const allOrders = (await storage.getOrders()) as any[];
    const recentPaid = allOrders.filter((o: any) => {
      if (!["paid", "shipped", "delivered"].includes(o.status)) return false;
      const created = o.createdAt ? new Date(String(o.createdAt)).getTime() : 0;
      return created >= thirtyDaysAgo;
    });

    const purchaseMap = new Map<string, number>();
    for (const order of recentPaid) {
      for (const item of (Array.isArray(order.items) ? order.items : [])) {
        const key = String(item.productId || "");
        if (!key) continue;
        purchaseMap.set(key, (purchaseMap.get(key) ?? 0) + (Number(item.quantity) || 1));
      }
    }

    // 5. Топ-15 по количеству корзин
    const sorted = [...cartMap.entries()]
      .sort((a, b) => b[1].cartCount - a[1].cartCount)
      .slice(0, 15);

    // 6. AI-рекомендации на каждый товар одним запросом
    let aiRecs: string[] = [];
    try {
      const inputLines = sorted.map(([id, p]) => {
        const bought = purchaseMap.get(id) ?? 0;
        return `${p.name} (${p.cartCount} корзин, ${bought} покупок за 30 дн., ${Math.round(p.price / 100)} ₽)`;
      });
      const raw = await groqComplete(inputLines.join("\n"), CART_ANALYSIS_AI_SYSTEM, 600);
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) aiRecs = parsed.map(String);
    } catch {
      // продолжаем без AI-рекомендаций
    }

    // 7. Возраст корзин — средний по сессиям содержащим данный товар (упрощение: средний по всем сессиям)
    const now = Date.now();
    const sessionAges = sessions.map(s => sessionDates[s] ? now - sessionDates[s] : 0).filter(Boolean);
    const avgAgeMs = sessionAges.length > 0 ? sessionAges.reduce((a, b) => a + b, 0) / sessionAges.length : 0;

    // 8. Формируем Telegram-сообщение
    const dateStr = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

    const lines = sorted.map(([id, p], i) => {
      const bought = purchaseMap.get(id) ?? 0;
      const priceRub = Math.round(p.price / 100).toLocaleString("ru-RU");
      const boughtLabel = bought === 0 ? "❌ 0 покупок" : `✅ ${bought} покупок`;

      // Остатки на складе
      let stockLabel = "";
      if (p.sizeStock) {
        const totalStock = Object.values(p.sizeStock).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
        stockLabel = totalStock === 0 ? " · 🚫 нет в наличии" : totalStock <= 3 ? ` · ⚠️ осталось ${totalStock} шт.` : ` · 📦 ${totalStock} шт.`;
      }

      const rec = aiRecs[i] ? `\n   💡 ${aiRecs[i]}` : "";
      return `${i + 1}. <b>${p.name}</b>\n   🛒 ${p.cartCount} корзин · ${boughtLabel} за 30 дн. · ${priceRub} ₽${stockLabel}${rec}`;
    });

    const text =
      `🛒 <b>BOOOM AI — Анализ брошенных корзин</b> · ${dateStr}\n\n` +
      `Товары которые добавляют, но не покупают:\n\n` +
      lines.join("\n\n") +
      `\n\n<b>📦 Сессий с товарами:</b> ${sessions.length}` +
      (avgAgeMs > 0 ? `  ·  <b>⏱ Средний возраст корзины:</b> ${cartAgeLabel(avgAgeMs)}` : "");

    await sendAgentDigest(text);
    vkNotifyAgentDigest(text);
    sendPushToAdmins({
      title: '🛒 BOOOM AI: Анализ корзин',
      body: `${sessions.length} брошенных корзин. Топ: «${sorted[0]?.[1].name ?? '—'}» (${sorted[0]?.[1].cartCount ?? 0} корзин)`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-cart-analysis',
    }).catch(() => {});

    // 9. Собираем список клиентов с email — дедупликация по userId (один человек = одно письмо)
    const userSessionsMap = new Map<number, string[]>();
    for (const [sessionId, userId] of sessionUserIds.entries()) {
      const arr = userSessionsMap.get(userId) ?? [];
      arr.push(sessionId);
      userSessionsMap.set(userId, arr);
    }

    const promoTargets: Array<{ userId: number; name: string; email: string; topItem: string; cartItems: string[] }> = [];
    for (const [userId, userSessions] of userSessionsMap.entries()) {
      try {
        const userInfo = await db.getUserEmailById(userId);
        if (!userInfo?.email) continue;

        // Собираем все уникальные товары из всех сессий пользователя
        const seenNames = new Set<string>();
        const cartItems: string[] = [];
        let topItemName = "";
        for (const sid of userSessions) {
          const items = await storage.getCartItems(sid);
          for (const it of items) {
            const name: string = (it as any).product?.name ?? String(it.productId);
            if (!name || seenNames.has(name)) continue;
            seenNames.add(name);
            cartItems.push(name);
            // topItem — первый товар из топа брошенных
            if (!topItemName && sorted.some(([id]) => String(it.productId) === id)) {
              topItemName = name;
            }
          }
        }
        if (!topItemName && cartItems.length > 0) topItemName = cartItems[0];
        if (!topItemName) topItemName = sorted[0]?.[1].name ?? "";

        promoTargets.push({ userId, name: userInfo.name || "Покупатель", email: userInfo.email, topItem: topItemName, cartItems });
      } catch { /* пропускаем */ }
      await sleep(30);
    }

    // 10. Добавляем задачу рассылки промокодов в очередь (если есть кому слать)
    if (promoTargets.length > 0) {
      const queueItem = await addToQueue({
        type: "cart_promo",
        title: `Разослать промокоды по брошенным корзинам (${promoTargets.length} клиентов)`,
        description:
          `Клиенты с товарами в корзине:\n` +
          promoTargets.slice(0, 10).map(u => `• ${u.name} — ${u.topItem}`).join("\n") +
          (promoTargets.length > 10 ? `\n...и ещё ${promoTargets.length - 10}` : "") +
          `\n\nБудет отправлен персональный промокод на скидку 12% на 48 часов.`,
        params: {
          users: promoTargets,
          discount: 12,
          validityHours: 48,
          emailSubject: `Персональная скидка 12% — специально для вас 🎁`,
          emailBody: `{name}, мы заметили, что вы присматривались к {item}. Держите персональный промокод — только для вас.`,
        },
        tool: "send_cart_promos",
      });
      await notifyAgentQueueItem(queueItem);
    }

    await addLogEntry({
      type: "cart_analysis",
      action: "Анализ брошенных корзин отправлен",
      summary: `Сессий: ${sessions.length}, товаров: ${cartMap.size}, топ: «${sorted[0]?.[1].name ?? "—"}» (${sorted[0]?.[1].cartCount ?? 0} корзин), к рассылке: ${promoTargets.length}`,
      isAuto: true,
    });

    console.log(`[AutonomousAgent] Cart analysis done. Sessions: ${sessions.length}, products: ${cartMap.size}, promo targets: ${promoTargets.length}`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Cart analysis error:", e?.message);
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

    // Пауза 30 минут после SEO — даём Groq остыть и сбрасываем счётчик
    console.log("[AutonomousAgent] Waiting 30 min before description job...");
    await sleep(30 * 60 * 1000);
    resetRequestCounter();

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

  // Анализ брошенных корзин — каждое воскресенье в 11:00 МСК (08:00 UTC)
  const daysUntilSunday = (7 - now.getUTCDay()) % 7;
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(8, 0, 0, 0); // 11:00 МСК = 08:00 UTC
  if (nextSunday.getTime() <= nowMs) nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  const sundayDelayMs = nextSunday.getTime() - nowMs;

  const runSundaySafe = () =>
    runCartAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Sunday cart analysis unhandled error:", e?.message)
    );

  setTimeout(() => {
    runSundaySafe();
    setInterval(runSundaySafe, 7 * 24 * 60 * 60 * 1000);
  }, sundayDelayMs);

  console.log(
    `[AutonomousAgent] Scheduled: SEO in ${Math.round(seoDelayMs / 60000)}min, alerts+digest next Monday in ${Math.round(mondayDelayMs / 60000 / 60)}h, cart analysis next Sunday in ${Math.round(sundayDelayMs / 60000 / 60)}h`
  );
}
