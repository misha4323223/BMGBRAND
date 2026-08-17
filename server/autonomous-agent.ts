import { storage } from "./storage";
import { authStorage } from "./auth-storage";
import {
  addToQueue,
  addLogEntry,
  getAgentSettings,
} from "./agent-queue";
import { notifyAgentQueueItem, sendAgentAlert, sendAgentDigest } from "./telegram";
import { vkNotifyAgentAlert, vkNotifyAgentDigest } from "./vk";
import { sendPushToAdmins } from "./push-service";
import { groqCompleteStream } from "./groq-utils";

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
  maxTokens = 1500
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY;
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
    try {
      const text = await groqCompleteStream({
        baseUrl: groqBase,
        apiKey,
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens,
      });

      requestsThisRun++;
      requestsThisMinute++;

      // Пауза после каждого успешного запроса (5 секунд)
      await sleep(GROQ_DELAY_MS);
      return text;
    } catch (err: any) {
      if (err?.status === 429) {
        const waitMs = GROQ_429_WAIT_MS;
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
      throw err;
    }
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

// Категории и названия, у которых НИКОГДА нет принта
const BOTTOM_PATTERN   = /брюк|шорт|джинс|леггинс|лосин|юбк|карго|трек|jogger|пант/i;
const SOCK_PATTERN     = /носк|sock/i;
const ACCESSORY_PATTERN = /шапк|кепк|панам|бейсбол|сумк|рюкзак|кружк|чашк|стакан|бутылк|упаковк|пакет|bag|hat|cup|mug/i;
const TOP_PATTERN      = /футболк|тишерт|t-shirt|лонгслив|худи|свитшот|толстовк|олимпийк|куртк|ветровк|анорак|жакет|бомбер|пальто/i;

type ProductType = "top" | "bottom" | "socks" | "accessory" | "other";

function getProductType(product: { name?: string; category?: string; subcategory?: string }): ProductType {
  const text = `${product.name || ""} ${product.category || ""} ${product.subcategory || ""}`.toLowerCase();
  if (SOCK_PATTERN.test(text)) return "socks";
  if (BOTTOM_PATTERN.test(text)) return "bottom";
  if (ACCESSORY_PATTERN.test(text)) return "accessory";
  if (TOP_PATTERN.test(text)) return "top";
  return "other";
}

function hasUniqueDesign(name: string): boolean {
  return DESIGN_KEYWORDS.test(name);
}

// Есть ли принт — только для верха, носков и аксессуаров
function hasPrint(product: { name?: string; category?: string; subcategory?: string }): boolean {
  const type = getProductType(product);
  if (type === "bottom") return false;          // у брюк/шорт принтов нет
  return hasUniqueDesign(product.name || "");
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
      const isPrint     = hasPrint(product);
      const descSnippet = product.description ? product.description.slice(0, 200) : "";
      const composition = product.composition || "";
      const priceRub = product.price ? Math.round(product.price / 100) : 0;

      const prompt = `Товар: ${product.name}
Категория: ${product.category || "—"}${product.subcategory ? " / " + product.subcategory : ""}
Цена: ${priceRub} ₽
Состав: ${composition || "—"}
Описание: ${descSnippet || "—"}
${isPrint ? "ВАЖНО: это товар с авторским принтом, можно упомянуть характер дизайна" : ""}

Сгенерируй seoTitle и seoDescription.`;

      const raw = await groqComplete(prompt, SEO_SYSTEM, 1500);

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
  if (!await acquireJobLock('job_lock_stale_products', 6 * 24 * 60 * 60 * 1000)) return;

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

const DESC_SYSTEM = `Ты копирайтер для российского бренда BMGBRAND (booomerangs.ru).
Пиши на русском, живым молодёжным языком. Возвращай ТОЛЬКО текст описания — без JSON, заголовков и лишних символов.

Описание: 3-5 предложений. Используй ТОЛЬКО данные из промпта — не придумывай то, чего там нет.
Расскажи о товаре: что это, настроение/посадка, из чего сделан, как и с чем носить.
Никогда не упоминай принт, дизайн или рисунок, если это явно не указано в промпте.`;

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
      const productType = getProductType(product);
      const isPrint     = hasPrint(product);
      const priceRub    = product.price ? Math.round(product.price / 100) : 0;

      // Инструкция под тип изделия
      const typeHint: Record<ProductType, string> = {
        top:       isPrint
          ? "Это верх одежды с авторским принтом. Опиши настроение/атмосферу дизайна в общих чертах (дерзкий, минималистичный, графичный и т.д.) — без конкретных деталей рисунка. Расскажи о крое и посадке."
          : "Это верх одежды без принта (базовая/однотонная). Акцент на крой, посадку, комфорт, универсальность образа. Не упоминай принт или дизайн.",
        bottom:    "Это низ одежды (брюки, шорты, карго и т.п.). Никаких принтов — только крой, посадка, ткань, удобство и с чем носить.",
        socks:     isPrint
          ? "Это носки с принтом. Можно упомянуть характер дизайна (яркий, забавный, графичный). Без конкретных деталей рисунка — только атмосфера."
          : "Это базовые носки. Акцент на материал, комфорт и универсальность.",
        accessory: "Это аксессуар. Расскажи о функции, материале, дизайне и как впишется в образ.",
        other:     "Расскажи о товаре: что это, из чего, как носить/использовать.",
      };

      const prompt = `Товар: ${product.name}
Категория: ${product.category || "—"}${product.subcategory ? " / " + product.subcategory : ""}
Цена: ${priceRub} ₽
Состав: ${product.composition || "—"}

Задание: ${typeHint[productType]}`;

      const description = await groqComplete(prompt, DESC_SYSTEM, 1500);
      if (!description || description.length < 20) continue;

      // Флаг «проверь принт» только когда принт реально детектирован
      const flagForReview = isPrint;
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

export async function runWeeklyDigest(force = false): Promise<void> {
  console.log("[AutonomousAgent] Starting weekly digest...");
  const settings = await getAgentSettings();
  if (!settings.enabled || !settings.digestEnabled) return;
  if (!force && !await acquireJobLock('job_lock_weekly_digest', 6 * 24 * 60 * 60 * 1000)) return;
  if (force) console.log("[AutonomousAgent] Weekly digest: force=true, bypassing duplicate guard");

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
      aiComment = await groqComplete(digestSummaryForAi, DIGEST_AI_SYSTEM, 1500);
    } catch (aiErr: any) {
      console.warn("[AutonomousAgent] Weekly digest: AI comment failed —", aiErr?.message);
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
      const raw = await groqComplete(inputLines.join("\n"), CART_ANALYSIS_AI_SYSTEM, 1200);
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

// ── Chat Gap Analysis Job ────────────────────────────────────────────────────

const CHAT_TOPIC_LOG_KEY = "chat_topic_log";

const GAP_SYSTEM = `Ты эксперт по базам знаний для интернет-магазина BOOOMERANGS (российский стритвир-бренд).
Тебе дадут список вопросов, которые покупатели задавали в чате, но на которые у ИИ не было готового ответа.
Сгенерируй КРАТКИЙ информационный блок (3-5 предложений) который поможет ИИ отвечать на эти вопросы в будущем.
Пиши на русском, конкретно, без лишних слов. Верни только текст блока — без заголовков и метаданных.`;

export async function runChatGapAnalysisJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting chat gap analysis job...");
  if (!await acquireJobLock('job_lock_chat_gap', 6 * 24 * 60 * 60 * 1000)) {
    console.log("[AutonomousAgent] Chat gap: skipped (lock active).");
    return;
  }

  try {
    const raw = await storage.getBonusSetting(CHAT_TOPIC_LOG_KEY);
    if (!raw) {
      console.log("[AutonomousAgent] Chat gap: no log data yet.");
      return;
    }

    const log: Array<{ q: string; topic: string | null; ts: number }> = JSON.parse(raw);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = log.filter(e => e.ts >= sevenDaysAgo && !e.topic);

    if (recent.length < 3) {
      console.log(`[AutonomousAgent] Chat gap: only ${recent.length} unmatched queries, skipping.`);
      return;
    }

    // Кластеризация по частоте значимых слов
    const stopWords = new Set(["что", "как", "где", "когда", "сколько", "можно", "есть", "это", "хочу", "нужно", "нужен", "нужна", "скажи", "расскажи", "помоги", "подскажи", "ваш", "вас", "мне", "вы", "я", "а", "и", "или", "не", "ли", "про", "о", "об", "бы", "же"]);

    const wordFreq = new Map<string, { count: number; queries: string[] }>();
    for (const entry of recent) {
      const words = entry.q.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
      for (const word of words) {
        const existing = wordFreq.get(word);
        if (existing) {
          existing.count++;
          if (!existing.queries.includes(entry.q)) existing.queries.push(entry.q);
        } else {
          wordFreq.set(word, { count: 1, queries: [entry.q] });
        }
      }
    }

    // Берём кластеры с 3+ повторениями, сортируем по частоте
    const clusters = [...wordFreq.entries()]
      .filter(([, v]) => v.count >= 3)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    if (clusters.length === 0) {
      console.log("[AutonomousAgent] Chat gap: no significant clusters found.");
      await addLogEntry({
        type: "chat_gap",
        action: "Анализ пробелов в знаниях",
        summary: `Проанализировано ${recent.length} неизвестных запросов за 7 дней — значимых кластеров не найдено.`,
        isAuto: true,
      });
      return;
    }

    let queued = 0;
    for (const [word, data] of clusters) {
      const sampleQueries = data.queries.slice(0, 5).map(q => `• "${q}"`).join("\n");
      const prompt = `Покупатели ${data.count} раз за неделю задавали похожие вопросы. Примеры:\n${sampleQueries}\n\nСоздай блок знаний для ИИ-ассистента.`;

      try {
        const draftContent = await groqComplete(prompt, GAP_SYSTEM, 1200);
        if (!draftContent || draftContent.length < 20) continue;

        await addToQueue({
          type: "knowledge_gap",
          title: `Пробел в знаниях: «${word}» (${data.count} вопросов за неделю)`,
          description: `Покупатели часто спрашивали о теме «${word}», но в базе знаний нет подходящего блока.\n\nПримеры вопросов:\n${sampleQueries}\n\n---\nЧерновик нового блока знаний:\n\n${draftContent}`,
          params: { draftContent, topicWord: word, queryCount: data.count },
          tool: "update_ai_knowledge_draft",
        });
        queued++;
      } catch (e: any) {
        console.error(`[AutonomousAgent] Chat gap draft error for "${word}":`, e?.message);
      }
    }

    await addLogEntry({
      type: "chat_gap",
      action: "Анализ пробелов в знаниях завершён",
      summary: `Неизвестных запросов: ${recent.length}, кластеров: ${clusters.length}, добавлено в очередь: ${queued}`,
      isAuto: true,
    });

    if (queued > 0) {
      const gapMsg =
        `🧠 <b>BOOOM AI — Пробелы в знаниях</b>\n\n` +
        `За неделю покупатели ${recent.length} раз задавали вопросы вне базы знаний.\n` +
        `Найдено ${queued} новых тем. Черновики ждут в очереди модерации.`;
      await sendAgentAlert(gapMsg);
      vkNotifyAgentAlert(gapMsg);
    }

    console.log(`[AutonomousAgent] Chat gap done. Unmatched: ${recent.length}, queued: ${queued}`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Chat gap analysis error:", e?.message);
  }
}

// ── Chat Conversion Analysis Job ─────────────────────────────────────────────

const CONVERSION_SYSTEM = `Ты аналитик интернет-магазина BOOOMERANGS (российский стритвир-бренд).
Тебе дадут статистику по чату: сколько сессий с чатом привели к покупке, а сколько нет.
Также — список тем, которые обсуждались в чате за этот период.
Напиши КРАТКИЙ отчёт (5-7 предложений) с конкретными выводами и 2-3 действиями для улучшения конверсии.
Пиши на русском, конкретно, без воды. Не придумывай цифры — используй только те, что переданы.`;

export async function runChatConversionAnalysisJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting chat conversion analysis job...");
  if (!await acquireJobLock('job_lock_chat_conversion', 6 * 24 * 60 * 60 * 1000)) {
    console.log("[AutonomousAgent] Chat conversion: skipped (lock active).");
    return;
  }

  try {
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

    // 1. Получаем все оплаченные заказы за 14 дней
    const allOrders = await storage.getOrders() as any[];
    const recentPaid = allOrders.filter((o: any) => {
      const ts = new Date(o.createdAt || 0).getTime();
      return ts >= fourteenDaysAgo && o.status !== 'pending' && !o.isWholesale && o.sessionId;
    });

    if (recentPaid.length === 0) {
      console.log("[AutonomousAgent] Chat conversion: no paid orders in last 14 days.");
      return;
    }

    // 2. Получаем все сессии с чатом → строим Set session_id
    const chatSessions = await storage.getChatSessions();
    const chatSessionIds = new Set(chatSessions.map((s: any) => s.sessionId));

    // 3. Кросс-матч: заказы из сессий с чатом vs без
    const ordersWithChat = recentPaid.filter((o: any) => chatSessionIds.has(o.sessionId));
    const ordersWithoutChat = recentPaid.filter((o: any) => !chatSessionIds.has(o.sessionId));

    const totalChatSessions = chatSessions.length;
    const convertedSessions = ordersWithChat.length;
    const conversionRate = totalChatSessions > 0
      ? ((convertedSessions / totalChatSessions) * 100).toFixed(1)
      : "0";

    // 4. Темы из лога чата за 14 дней
    const raw = await storage.getBonusSetting(CHAT_TOPIC_LOG_KEY);
    const topicLog: Array<{ q: string; topic: string | null; ts: number }> = raw ? JSON.parse(raw) : [];
    const recentTopics = topicLog.filter(e => e.ts >= fourteenDaysAgo);
    const topicCounts = new Map<string, number>();
    for (const e of recentTopics) {
      const t = e.topic || "неизвестная тема";
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([t, c]) => `${t}: ${c} запросов`)
      .join(", ");

    // 5. Генерируем инсайт через AI
    const statsText =
      `За 14 дней:\n` +
      `— Всего сессий с чатом: ${totalChatSessions}\n` +
      `— Оплаченных заказов: ${recentPaid.length} (из них ${convertedSessions} из сессий с чатом, ${ordersWithoutChat.length} без чата)\n` +
      `— Конверсия чат→покупка: ${conversionRate}%\n` +
      `— Топ тем в чате: ${topTopics || "данных нет"}`;

    const insight = await groqComplete(statsText, CONVERSION_SYSTEM, 1200);
    if (!insight || insight.length < 20) {
      console.log("[AutonomousAgent] Chat conversion: AI returned empty insight.");
      return;
    }

    // 6. Кладём в очередь
    await addToQueue({
      type: "chat_conversion_insight",
      title: `📈 Конверсия чата: ${conversionRate}% (${convertedSessions} из ${totalChatSessions} сессий → покупка)`,
      description: `${statsText}\n\n---\n🤖 Анализ ИИ:\n\n${insight}`,
      params: { conversionRate, convertedSessions, totalChatSessions, ordersWithChat: convertedSessions, ordersWithoutChat: ordersWithoutChat.length, insight },
      tool: "acknowledge_chat_insights",
    });

    await addLogEntry({
      type: "chat_conversion",
      action: "Анализ конверсии чата завершён",
      summary: `Сессий с чатом: ${totalChatSessions}, конверсия: ${conversionRate}%, заказов: ${recentPaid.length}`,
      isAuto: true,
    });

    // 7. Уведомление
    const alertMsg =
      `📈 <b>BOOOM AI — Конверсия чата</b>\n\n` +
      `За 14 дней: ${totalChatSessions} сессий с чатом\n` +
      `Конверсия в покупку: <b>${conversionRate}%</b> (${convertedSessions} заказов)\n\n` +
      `Отчёт ждёт в очереди агента.`;
    await sendAgentAlert(alertMsg);
    vkNotifyAgentAlert(alertMsg);

    console.log(`[AutonomousAgent] Chat conversion done. Sessions: ${totalChatSessions}, rate: ${conversionRate}%`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Chat conversion analysis error:", e?.message);
  }
}

// ── Predictive Retention Job ─────────────────────────────────────────────────

interface RetentionUser {
  email: string;
  name: string;
  topItem: string;
  daysSinceLast: number;
  avgInterval: number;
  orderCount: number;
}

const RETENTION_SEGMENT_LABELS: Record<string, string> = {
  hot: "🔥 Готовы купить",
  at_risk: "⚠️ Уходят",
  new: "💫 Вернуть после 1-й покупки",
};

export async function runPredictiveRetentionJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting predictive retention job...");
  if (!await acquireJobLock('job_lock_retention', 6 * 24 * 60 * 60 * 1000)) {
    console.log("[AutonomousAgent] Retention: skipped (lock active).");
    return;
  }

  try {
    const allOrders = await storage.getOrders() as any[];
    const paidOrders = allOrders.filter((o: any) =>
      ["paid", "shipped", "delivered"].includes(o.status) && !o.isWholesale
    );

    if (paidOrders.length < 5) {
      console.log("[AutonomousAgent] Retention: not enough orders, skipping.");
      return;
    }

    // Группируем по email
    const byEmail = new Map<string, { name: string; orders: Array<{ ts: number; topItem: string }> }>();
    for (const order of paidOrders) {
      const email = (order.customerEmail || "").toLowerCase().trim();
      if (!email || !email.includes("@")) continue;
      const ts = order.createdAt ? new Date(String(order.createdAt)).getTime() : 0;
      if (!ts) continue;
      const items = Array.isArray(order.items) ? order.items : [];
      const topItem = (items[0]?.name || items[0]?.productName || "товар").slice(0, 50);
      const existing = byEmail.get(email);
      if (existing) {
        existing.orders.push({ ts, topItem });
      } else {
        byEmail.set(email, { name: order.customerName || "", orders: [{ ts, topItem }] });
      }
    }

    const now = Date.now();
    const hotUsers: RetentionUser[] = [];
    const atRiskUsers: RetentionUser[] = [];
    const newUsers: RetentionUser[] = [];

    for (const [email, data] of byEmail) {
      const sorted = data.orders.sort((a, b) => b.ts - a.ts);
      const daysSinceLast = (now - sorted[0].ts) / (24 * 60 * 60 * 1000);
      if (daysSinceLast < 14) continue; // слишком свежие

      const topItem = sorted[0].topItem;
      const name = data.name;
      const orderCount = sorted.length;

      if (orderCount >= 2) {
        // Считаем средний интервал
        const intervals: number[] = [];
        for (let i = 0; i < sorted.length - 1; i++) {
          intervals.push((sorted[i].ts - sorted[i + 1].ts) / (24 * 60 * 60 * 1000));
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avgInterval < 5) continue; // аномально частые покупки — пропускаем

        const user: RetentionUser = { email, name, topItem, daysSinceLast: Math.round(daysSinceLast), avgInterval: Math.round(avgInterval), orderCount };

        if (daysSinceLast >= avgInterval * 0.85 && daysSinceLast <= avgInterval * 1.4) {
          hotUsers.push(user);
        } else if (daysSinceLast > avgInterval * 1.5 && daysSinceLast < avgInterval * 3) {
          atRiskUsers.push(user);
        }
      } else if (orderCount === 1) {
        // Один заказ 30–75 дней назад → попробовать вернуть
        if (daysSinceLast >= 30 && daysSinceLast <= 75) {
          newUsers.push({ email, name, topItem, daysSinceLast: Math.round(daysSinceLast), avgInterval: 45, orderCount: 1 });
        }
      }
    }

    const segments: Array<{ segment: string; label: string; users: RetentionUser[]; discount: number; validityHours: number }> = [];
    if (hotUsers.length > 0) segments.push({ segment: "hot", label: RETENTION_SEGMENT_LABELS.hot, users: hotUsers.slice(0, 50), discount: 10, validityHours: 72 });
    if (atRiskUsers.length > 0) segments.push({ segment: "at_risk", label: RETENTION_SEGMENT_LABELS.at_risk, users: atRiskUsers.slice(0, 50), discount: 15, validityHours: 48 });
    if (newUsers.length > 0) segments.push({ segment: "new", label: RETENTION_SEGMENT_LABELS.new, users: newUsers.slice(0, 30), discount: 12, validityHours: 72 });

    if (segments.length === 0) {
      console.log("[AutonomousAgent] Retention: no actionable segments.");
      await addLogEntry({ type: "retention", action: "Предиктивный анализ клиентов", summary: `Проанализировано ${byEmail.size} покупателей — нет подходящих для рассылки.`, isAuto: true });
      return;
    }

    const totalUsers = segments.reduce((s, seg) => s + seg.users.length, 0);
    const segSummary = segments.map(s => `${s.label}: ${s.users.length} чел.`).join("\n");

    await addToQueue({
      type: "retention_offer",
      title: `Удержание клиентов: ${totalUsers} чел. (${segments.map(s => `${s.label.replace(/^[^\s]+ /, "")} ${s.users.length}`).join(", ")})`,
      description: `Предиктивный анализ выявил ${totalUsers} клиентов:\n${segSummary}\n\nСкидки и сроки настраиваются перед отправкой.`,
      params: { segments },
      tool: "send_retention_offers",
    });

    await addLogEntry({ type: "retention", action: "Предиктивный анализ клиентов завершён", summary: `Проанализировано ${byEmail.size} покупателей, в очередь: ${totalUsers} чел. по ${segments.length} сегментам.`, isAuto: true });

    const retMsg =
      `🎯 <b>BOOOM AI — Предиктивный движок</b>\n\n` +
      `Проанализировано ${byEmail.size} покупателей.\n\n${segSummary}\n\n` +
      `Итого ${totalUsers} чел. ждут в очереди — зайди и подтверди рассылку.`;
    await sendAgentAlert(retMsg);
    vkNotifyAgentAlert(retMsg);

    console.log(`[AutonomousAgent] Retention done: ${totalUsers} users in ${segments.length} segments.`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Retention job error:", e?.message);
  }
}

// ── Favorites Analysis Job ───────────────────────────────────────────────────

const FAVORITES_AI_SYSTEM = `Ты аналитик для российского стритвир-магазина BOOOMERANGS.
Тебе дадут список товаров которые покупатели добавили в избранное, но не купили — с количеством уникальных пользователей, ценой и данными о складе.
Для КАЖДОГО товара напиши ОДНУ краткую рекомендацию (макс. 10 слов): что делать — снизить цену, запустить акцию, пополнить склад, улучшить фото, или другое.
Формат ответа — строго JSON-массив строк, без пояснений, без markdown:
["рекомендация для товара 1","рекомендация для товара 2",...]
Количество элементов должно строго совпадать с количеством товаров на входе.`;

const CROSS_JOB_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня

export async function runFavoritesAnalysisJob(): Promise<void> {
  console.log("[AutonomousAgent] Starting favorites analysis job...");
  const db = storage as any;

  if (typeof db.getUserEmailById !== "function") {
    console.log("[AutonomousAgent] Favorites: YDB not available, skipping.");
    return;
  }
  if (!await acquireJobLock('job_lock_favorites', 6 * 24 * 60 * 60 * 1000)) {
    console.log("[AutonomousAgent] Favorites: skipped (lock active).");
    return;
  }

  try {
    // 1. Все пары {userId, productId} из избранного
    const allFavorites = await authStorage.getAllFavorites();
    if (allFavorites.length === 0) {
      console.log("[AutonomousAgent] Favorites: no favorites found.");
      return;
    }

    // 2. Группируем по userId
    const userFavMap = new Map<number, Set<number>>();
    for (const { userId, productId } of allFavorites) {
      if (!userFavMap.has(userId)) userFavMap.set(userId, new Set());
      userFavMap.get(userId)!.add(productId);
    }

    // 3. Оплаченные заказы → email → Set<productId> (купленные)
    const allOrders = await storage.getOrders() as any[];
    const purchasedByEmail = new Map<string, Set<number>>();
    for (const order of allOrders) {
      if (!["paid", "shipped", "delivered"].includes(order.status)) continue;
      const email = (order.customerEmail || "").toLowerCase().trim();
      if (!email) continue;
      const set = purchasedByEmail.get(email) ?? new Set<number>();
      for (const item of (Array.isArray(order.items) ? order.items : [])) {
        const pid = Number(item.productId || 0);
        if (pid) set.add(pid);
      }
      purchasedByEmail.set(email, set);
    }

    // 4. Агрегируем товары из избранного и кандидатов на рассылку
    const favCountMap = new Map<number, { name: string; price: number; favCount: number; sizeStock: Record<string, number> | null }>();
    const promoTargets: Array<{ userId: number; name: string; email: string; topItem: string; cartItems: string[] }> = [];

    for (const [userId, productIds] of userFavMap.entries()) {
      try {
        const userInfo = await db.getUserEmailById(userId);
        if (!userInfo?.email) continue;

        // Кросс-джоб cooldown: если получал marketing-письмо в последние 3 дня — пропустить
        if (typeof db.getCartReminder === "function") {
          const lastReminder = await db.getCartReminder(userId);
          if (lastReminder?.sentAt) {
            const sentAt = typeof lastReminder.sentAt === 'number'
              ? lastReminder.sentAt * 1000
              : new Date(lastReminder.sentAt).getTime();
            if (Date.now() - sentAt < CROSS_JOB_COOLDOWN_MS) continue;
          }
        }

        const purchased = purchasedByEmail.get(userInfo.email.toLowerCase()) ?? new Set<number>();
        const unpurchasedIds = [...productIds].filter(pid => !purchased.has(pid));
        if (unpurchasedIds.length === 0) continue;

        const favItemNames: string[] = [];
        let topItemName = "";
        for (const pid of unpurchasedIds) {
          try {
            const product = await storage.getProduct(pid);
            if (!product || (product as any).isHidden) continue;
            const name = (product.name || `Товар ${pid}`).slice(0, 60);
            const existing = favCountMap.get(pid);
            if (existing) {
              existing.favCount++;
            } else {
              favCountMap.set(pid, {
                name,
                price: product.price ?? 0,
                favCount: 1,
                sizeStock: (product as any).sizeStock ?? null,
              });
            }
            favItemNames.push(name);
            if (!topItemName) topItemName = name;
          } catch { /* skip */ }
        }

        if (favItemNames.length === 0) continue;
        promoTargets.push({
          userId,
          name: userInfo.name || "Покупатель",
          email: userInfo.email,
          topItem: topItemName,
          cartItems: favItemNames,
        });
      } catch { /* skip user */ }
      await sleep(60);
    }

    if (favCountMap.size === 0) {
      await addLogEntry({ type: "favorites_promo", action: "Анализ избранного: нет данных", summary: "Нет товаров в избранном без покупки.", isAuto: true });
      return;
    }

    // 5. Топ-10 по количеству добавлений
    const sorted = [...favCountMap.entries()]
      .sort((a, b) => b[1].favCount - a[1].favCount)
      .slice(0, 10);

    // 6. AI рекомендации
    let aiRecs: string[] = [];
    try {
      const inputLines = sorted.map(([, p]) =>
        `${p.name} (${p.favCount} в избранном, ${Math.round(p.price / 100)} ₽)`
      );
      const raw = await groqComplete(inputLines.join("\n"), FAVORITES_AI_SYSTEM, 1200);
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) aiRecs = parsed.map(String);
    } catch { /* без AI */ }

    // 7. Telegram дайджест
    const dateStr = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const lines = sorted.map(([, p], i) => {
      const priceRub = Math.round(p.price / 100).toLocaleString("ru-RU");
      let stockLabel = "";
      if (p.sizeStock) {
        const total = Object.values(p.sizeStock).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
        if (total === 0) stockLabel = " · 🚫 нет в наличии";
        else if (total <= 3) stockLabel = ` · ⚠️ осталось ${total} шт.`;
        else stockLabel = ` · 📦 ${total} шт.`;
      }
      const rec = aiRecs[i] ? `\n   💡 ${aiRecs[i]}` : "";
      return `${i + 1}. <b>${p.name}</b>\n   ❤️ ${p.favCount} в избранном · ${priceRub} ₽${stockLabel}${rec}`;
    });

    const text =
      `❤️ <b>BOOOM AI — Избранное без покупки</b> · ${dateStr}\n\n` +
      `Товары которые добавляют в избранное, но не покупают:\n\n` +
      lines.join("\n\n") +
      `\n\n<b>👥 Уникальных пользователей:</b> ${promoTargets.length}`;

    await sendAgentDigest(text);
    vkNotifyAgentDigest(text);
    sendPushToAdmins({
      title: '❤️ BOOOM AI: Анализ избранного',
      body: `${promoTargets.length} клиентов добавили в избранное, но не купили. Топ: «${sorted[0]?.[1].name ?? '—'}»`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-favorites-analysis',
    }).catch(() => {});

    // 8. Задача в очередь (если есть кандидаты для рассылки)
    if (promoTargets.length > 0) {
      const topName = sorted[0]?.[1].name ?? "—";
      const queueItem = await addToQueue({
        type: "favorites_promo",
        title: `Разослать промокоды по избранному (${promoTargets.length} клиентов)`,
        description:
          `Клиенты с товарами в избранном без покупки:\n` +
          promoTargets.slice(0, 10).map(u => `• ${u.name} — ${u.topItem}`).join("\n") +
          (promoTargets.length > 10 ? `\n...и ещё ${promoTargets.length - 10}` : "") +
          `\n\nБудет отправлен персональный промокод FAV-XXXXX на скидку 10% на 72 часа.`,
        params: {
          users: promoTargets.map(u => ({
            userId: u.userId,
            name: u.name,
            email: u.email,
            topItem: u.topItem,
            cartItems: u.cartItems,
          })),
          discount: 10,
          validityHours: 72,
          emailSubject: `«${topName}» всё ещё в вашем избранном — скидка 10% 🎁`,
          emailBody: `{name}, мы заметили что <b>{item}</b> до сих пор в вашем избранном. Держите персональный промокод — только для вас.`,
          isFavorites: true,
        },
        tool: "send_favorites_promos",
      });
      await notifyAgentQueueItem(queueItem);
    }

    await addLogEntry({
      type: "favorites_promo",
      action: "Анализ избранного завершён",
      summary: `Пользователей с избранным: ${userFavMap.size}, кандидатов на промо: ${promoTargets.length}, топ товар: «${sorted[0]?.[1].name ?? "—"}»`,
      isAuto: true,
    });

    console.log(`[AutonomousAgent] Favorites analysis done. Users: ${userFavMap.size}, promo targets: ${promoTargets.length}`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Favorites analysis error:", e?.message);
  }
}

// ── Price Drop Analysis Job ──────────────────────────────────────────────────

const PRICE_DROP_AI_SYSTEM = `Ты аналитик для российского стритвир-магазина BOOOMERANGS.
Тебе дадут список товаров с количеством подписчиков ожидающих снижения цены, текущей ценой и ценой на которую подписались (максимальной желаемой).
Для КАЖДОГО товара напиши ОДНУ краткую рекомендацию (макс. 12 слов): стоит ли снизить цену, на сколько примерно, и почему.
Формат ответа — строго JSON-массив строк, без пояснений, без markdown:
["рекомендация для товара 1","рекомендация для товара 2",...]
Количество элементов должно строго совпадать с количеством товаров на входе.`;

export async function runPriceDropAnalysisJob(force = false): Promise<void> {
  console.log("[AutonomousAgent] Starting price drop analysis job...");
  if (!force && !await acquireJobLock('job_lock_price_drop_analysis', 6 * 24 * 60 * 60 * 1000)) {
    console.log("[AutonomousAgent] Price drop: skipped (lock active).");
    return;
  }
  if (force) console.log("[AutonomousAgent] Price drop: force=true, bypassing lock");

  try {
    const allSubs = await storage.getAllPriceDropSubscriptions();
    const activeSubs = allSubs.filter(s => !s.notified);

    if (activeSubs.length === 0) {
      console.log("[AutonomousAgent] Price drop: no active subscriptions.");
      return;
    }

    // Группируем по productId
    const byProduct = new Map<number, {
      productName: string;
      subs: Array<{ id: string; email: string; priceAtSubscription: number }>;
    }>();

    for (const sub of activeSubs) {
      const pid = Number(sub.productId);
      if (!pid) continue;
      const entry = byProduct.get(pid);
      if (entry) {
        entry.subs.push({ id: sub.id, email: sub.email, priceAtSubscription: sub.priceAtSubscription });
      } else {
        byProduct.set(pid, {
          productName: sub.productName,
          subs: [{ id: sub.id, email: sub.email, priceAtSubscription: sub.priceAtSubscription }],
        });
      }
    }

    // Обогащаем текущей ценой, фильтруем реально ожидающих
    const enriched: Array<{
      productId: number;
      productName: string;
      basePrice: number;
      currentPrice: number;
      suggestedPrice: number;
      subscriberCount: number;
      subs: Array<{ id: string; email: string; priceAtSubscription: number }>;
      imageUrl?: string;
      slug?: string;
    }> = [];

    for (const [pid, data] of byProduct.entries()) {
      try {
        const product = await storage.getProduct(pid);
        if (!product || (product as any).isHidden) continue;

        const basePrice = product.price ?? 0;
        const discountPct = (product as any).discountPercent ?? 0;
        const effectivePrice = discountPct > 0
          ? Math.round(basePrice * (1 - discountPct / 100))
          : basePrice;

        // Подписчики, которым текущая цена ещё не подходит (ждут снижения)
        // <= включает тех, у кого цена не изменилась с момента подписки
        const waiting = data.subs.filter(s => s.priceAtSubscription <= effectivePrice);
        if (waiting.length === 0) continue; // уже дешевле чем все хотят

        // Минимальная желаемая цена — чтобы разблокировать всех ожидающих
        const minWanted = Math.min(...waiting.map(s => s.priceAtSubscription));

        enriched.push({
          productId: pid,
          productName: data.productName,
          basePrice,
          currentPrice: effectivePrice,
          suggestedPrice: minWanted,
          subscriberCount: waiting.length,
          subs: waiting,
          imageUrl: (product as any).imageUrl || undefined,
          slug: (product as any).slug || undefined,
        });
      } catch { /* skip */ }
      await sleep(40);
    }

    if (enriched.length === 0) {
      console.log("[AutonomousAgent] Price drop: no actionable subscriptions.");
      await addLogEntry({
        type: "price_drop_analysis",
        action: "Анализ подписок на снижение цены",
        summary: "Нет товаров с активными подписчиками ожидающими снижения цены.",
        isAuto: true,
      });
      return;
    }

    // Сортируем по количеству подписчиков, берём топ-10
    enriched.sort((a, b) => b.subscriberCount - a.subscriberCount);
    const top = enriched.slice(0, 10);

    // AI рекомендации
    let aiRecs: string[] = [];
    try {
      const inputLines = top.map(p => {
        const curRub = Math.round(p.currentPrice / 100);
        const wantRub = Math.round(p.suggestedPrice / 100);
        const dropPct = Math.round((1 - p.suggestedPrice / p.currentPrice) * 100);
        return `${p.productName} (${p.subscriberCount} подписчиков, цена ${curRub} ₽, ждут ${wantRub} ₽, скидка ~${dropPct}%)`;
      });
      const raw = await groqComplete(inputLines.join("\n"), PRICE_DROP_AI_SYSTEM, 1200);
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) aiRecs = parsed.map(String);
    } catch { /* без AI */ }

    // Telegram дайджест
    const dateStr = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const lines = top.map((p, i) => {
      const curRub = Math.round(p.currentPrice / 100).toLocaleString("ru-RU");
      const wantRub = Math.round(p.suggestedPrice / 100).toLocaleString("ru-RU");
      const dropPct = Math.round((1 - p.suggestedPrice / p.currentPrice) * 100);
      const rec = aiRecs[i] ? `\n   💡 ${aiRecs[i]}` : "";
      return `${i + 1}. <b>${p.productName}</b>\n   🔔 ${p.subscriberCount} подписчиков · ${curRub} ₽ → ${wantRub} ₽ (−${dropPct}%)${rec}`;
    });

    const totalSubs = top.reduce((s, p) => s + p.subscriberCount, 0);
    const text =
      `🔔 <b>BOOOM AI — Подписки на снижение цены</b> · ${dateStr}\n\n` +
      `Товары с активными ожидающими подписчиками:\n\n` +
      lines.join("\n\n") +
      `\n\n<b>📊 Всего подписчиков в очереди:</b> ${totalSubs}`;

    await sendAgentDigest(text);
    vkNotifyAgentDigest(text);
    sendPushToAdmins({
      title: '🔔 BOOOM AI: Подписки на снижение цены',
      body: `${totalSubs} подписчиков ждут снижения цен. Топ: «${top[0].productName}» — ${top[0].subscriberCount} чел.`,
      url: 'https://booomerangs.ru/admin',
      tag: 'booom-price-drop-analysis',
    }).catch(() => {});

    // Задача в очередь для одобрения администратором
    const queueItem = await addToQueue({
      type: "price_drop_analysis",
      title: `Снизить цены и уведомить ${totalSubs} подписчиков (${top.length} товаров)`,
      description:
        `Товары с активными подписчиками ожидающими снижения:\n` +
        top.slice(0, 8).map(p => {
          const cur = Math.round(p.currentPrice / 100);
          const want = Math.round(p.suggestedPrice / 100);
          const drop = Math.round((1 - p.suggestedPrice / p.currentPrice) * 100);
          return `• ${p.productName} — ${p.subscriberCount} подписчиков, −${drop}% (${cur} → ${want} ₽)`;
        }).join("\n") +
        (top.length > 8 ? `\n...и ещё ${top.length - 8} товаров` : ""),
      params: {
        products: top.map(p => ({
          productId: p.productId,
          productName: p.productName,
          basePrice: p.basePrice,
          currentPrice: p.currentPrice,
          newPrice: p.suggestedPrice,
          subscriberCount: p.subscriberCount,
          subscribers: p.subs,
          imageUrl: p.imageUrl,
          slug: p.slug,
        })),
      },
      tool: "apply_price_drop_suggestions",
    });
    await notifyAgentQueueItem(queueItem);

    await addLogEntry({
      type: "price_drop_analysis",
      action: "Анализ подписок на снижение цены завершён",
      summary: `Товаров с подписчиками: ${enriched.length}, в очередь: ${top.length} товаров, подписчиков: ${totalSubs}`,
      isAuto: true,
    });

    console.log(`[AutonomousAgent] Price drop analysis done. Products: ${top.length}, subscribers: ${totalSubs}`);
  } catch (e: any) {
    console.error("[AutonomousAgent] Price drop analysis error:", e?.message);
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

  // Алерты + дайджест — каждый понедельник в 10:00 МСК (07:00 UTC)
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(7, 0, 0, 0); // 10:00 МСК
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
  const nextSundayCart = new Date(now);
  nextSundayCart.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSundayCart.setUTCHours(8, 0, 0, 0); // 11:00 МСК = 08:00 UTC
  if (nextSundayCart.getTime() <= nowMs) nextSundayCart.setUTCDate(nextSundayCart.getUTCDate() + 7);
  const sundayCartDelayMs = nextSundayCart.getTime() - nowMs;

  const runCartSafe = () =>
    runCartAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Sunday cart analysis unhandled error:", e?.message)
    );

  setTimeout(() => {
    runCartSafe();
    setInterval(runCartSafe, 7 * 24 * 60 * 60 * 1000);
  }, sundayCartDelayMs);

  // Уведомление о нулевых остатках — каждое воскресенье в 11:00 МСК (08:00 UTC)
  const nextSundayStale = new Date(now);
  nextSundayStale.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSundayStale.setUTCHours(8, 0, 0, 0); // 11:00 МСК = 08:00 UTC
  if (nextSundayStale.getTime() <= nowMs) nextSundayStale.setUTCDate(nextSundayStale.getUTCDate() + 7);
  const sundayStaleDelayMs = nextSundayStale.getTime() - nowMs;

  const runStaleSafe = () =>
    runStaleProductsJob().catch((e: any) =>
      console.error("[AutonomousAgent] Sunday stale products unhandled error:", e?.message)
    );

  setTimeout(() => {
    runStaleSafe();
    setInterval(runStaleSafe, 7 * 24 * 60 * 60 * 1000);
  }, sundayStaleDelayMs);

  // Анализ пробелов в знаниях чата — каждое воскресенье в 12:00 МСК (09:00 UTC)
  const nextSundayGap = new Date(now);
  nextSundayGap.setUTCDate(now.getUTCDate() + (daysUntilSunday || 7));
  nextSundayGap.setUTCHours(9, 0, 0, 0); // 12:00 МСК = 09:00 UTC
  if (nextSundayGap.getTime() <= nowMs) nextSundayGap.setUTCDate(nextSundayGap.getUTCDate() + 7);
  const sundayGapDelayMs = nextSundayGap.getTime() - nowMs;

  const runGapSafe = () =>
    runChatGapAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Chat gap analysis unhandled error:", e?.message)
    );

  setTimeout(() => {
    runGapSafe();
    setInterval(runGapSafe, 7 * 24 * 60 * 60 * 1000);
  }, sundayGapDelayMs);

  // Предиктивный retention — каждый четверг в 12:30 МСК (09:30 UTC)
  const daysUntilThursday = (4 - now.getUTCDay() + 7) % 7 || 7;
  const nextThursday = new Date(now);
  nextThursday.setUTCDate(now.getUTCDate() + daysUntilThursday);
  nextThursday.setUTCHours(9, 30, 0, 0); // 12:30 МСК = 09:30 UTC
  if (nextThursday.getTime() <= nowMs) nextThursday.setUTCDate(nextThursday.getUTCDate() + 7);
  const thursdayDelayMs = nextThursday.getTime() - nowMs;

  const runRetentionSafe = () =>
    runPredictiveRetentionJob().catch((e: any) =>
      console.error("[AutonomousAgent] Retention job unhandled error:", e?.message)
    );

  setTimeout(() => {
    runRetentionSafe();
    setInterval(runRetentionSafe, 7 * 24 * 60 * 60 * 1000);
  }, thursdayDelayMs);

  // Анализ конверсии чата — каждую среду в 13:00 МСК (10:00 UTC)
  const daysUntilWednesday = (3 - now.getUTCDay() + 7) % 7 || 7;
  const nextWednesday = new Date(now);
  nextWednesday.setUTCDate(now.getUTCDate() + daysUntilWednesday);
  nextWednesday.setUTCHours(10, 0, 0, 0); // 13:00 МСК = 10:00 UTC
  if (nextWednesday.getTime() <= nowMs) nextWednesday.setUTCDate(nextWednesday.getUTCDate() + 7);
  const wednesdayDelayMs = nextWednesday.getTime() - nowMs;

  const runConversionSafe = () =>
    runChatConversionAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Chat conversion unhandled error:", e?.message)
    );

  setTimeout(() => {
    runConversionSafe();
    setInterval(runConversionSafe, 7 * 24 * 60 * 60 * 1000);
  }, wednesdayDelayMs);

  // Анализ избранного без покупки — каждый вторник в 10:00 МСК (07:00 UTC)
  const daysUntilTuesday = (2 - now.getUTCDay() + 7) % 7 || 7;
  const nextTuesday = new Date(now);
  nextTuesday.setUTCDate(now.getUTCDate() + daysUntilTuesday);
  nextTuesday.setUTCHours(7, 0, 0, 0); // 10:00 МСК = 07:00 UTC
  if (nextTuesday.getTime() <= nowMs) nextTuesday.setUTCDate(nextTuesday.getUTCDate() + 7);
  const tuesdayDelayMs = nextTuesday.getTime() - nowMs;

  const runFavoritesSafe = () =>
    runFavoritesAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Favorites analysis unhandled error:", e?.message)
    );

  setTimeout(() => {
    runFavoritesSafe();
    setInterval(runFavoritesSafe, 7 * 24 * 60 * 60 * 1000);
  }, tuesdayDelayMs);

  // Анализ подписок на снижение цены — каждую пятницу в 11:00 МСК (08:00 UTC)
  const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7 || 7;
  const nextFriday = new Date(now);
  nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
  nextFriday.setUTCHours(8, 0, 0, 0); // 11:00 МСК = 08:00 UTC
  if (nextFriday.getTime() <= nowMs) nextFriday.setUTCDate(nextFriday.getUTCDate() + 7);
  const fridayDelayMs = nextFriday.getTime() - nowMs;

  const runPriceDropSafe = () =>
    runPriceDropAnalysisJob().catch((e: any) =>
      console.error("[AutonomousAgent] Price drop analysis unhandled error:", e?.message)
    );

  setTimeout(() => {
    runPriceDropSafe();
    setInterval(runPriceDropSafe, 7 * 24 * 60 * 60 * 1000);
  }, fridayDelayMs);

  console.log(
    `[AutonomousAgent] Scheduled: SEO in ${Math.round(seoDelayMs / 60000)}min, alerts+digest next Monday in ${Math.round(mondayDelayMs / 60000 / 60)}h, cart analysis next Sunday in ${Math.round(sundayCartDelayMs / 60000 / 60)}h, stale products next Sunday in ${Math.round(sundayStaleDelayMs / 60000 / 60)}h, chat gap analysis next Sunday 12:00 МСК in ${Math.round(sundayGapDelayMs / 60000 / 60)}h, retention next Thursday 12:00 МСК in ${Math.round(thursdayDelayMs / 60000 / 60)}h, chat conversion next Wednesday 13:00 МСК in ${Math.round(wednesdayDelayMs / 60000 / 60)}h, favorites next Tuesday 10:00 МСК in ${Math.round(tuesdayDelayMs / 60000 / 60)}h, price drop next Friday 11:00 МСК in ${Math.round(fridayDelayMs / 60000 / 60)}h`
  );
}
