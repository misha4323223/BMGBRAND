import type { Express } from "express";
import { z } from "zod";
import { storage, warmRatingsCache } from "./storage";
import { authMiddleware, type AuthRequest } from "./auth-routes";
import { sendAgentAlert, answerCallbackQuery, editMessageText } from "./telegram";
import { vkNotifyAgentAlert } from "./vk";
import {
  getQueue,
  getQueueItemById,
  updateQueueItemStatus,
  addLogEntry,
  getAgentSettings,
  getLog,
  saveAgentSettings,
} from "./agent-queue";
import { executeWriteTool, processAdminCommand } from "./admin-agent";
import {
  getAgentStatus,
  runAutonomousAgent,
  runSeoJob,
  runAlertsJob,
  runWeeklyDigest,
  runDescriptionJob,
  runCartAnalysisJob,
  runFavoritesAnalysisJob,
  runPriceDropAnalysisJob,
  runStaleProductsJob,
  runChatGapAnalysisJob,
  runChatConversionAnalysisJob,
  runPredictiveRetentionJob,
} from "./autonomous-agent";
import { randomUUID } from "crypto";

// ─── AI Knowledge Constants ───────────────────────────────────────────────────

const AI_KNOWLEDGE_CACHE_TTL = 5 * 60 * 1000;

export const AI_KNOWLEDGE_KEYS = [
  'ai_prompt_base',
  'ai_block_delivery',
  'ai_block_payment',
  'ai_block_returns',
  'ai_block_sizing',
  'ai_block_merch_order',
  'ai_block_partner',
  'ai_block_artist',
  'ai_block_wholesale',
  'ai_block_giftcards',
  'ai_block_predrop',
  'ai_block_loyalty',
  'ai_block_promo',
  'ai_block_account',
  'ai_block_vacancies',
] as const;

export type AiKnowledgeKey = typeof AI_KNOWLEDGE_KEYS[number];

export const AI_KNOWLEDGE_DEFAULTS: Record<AiKnowledgeKey, string> = {
  ai_prompt_base: `Ты представляешь бренд BOOOMERANGS.

Твоя задача не просто отвечать на вопросы, а помогать пользователю находить подходящие товары и знакомить его с философией бренда.

BOOOMERANGS создаёт вещи, которые мы носим сами: одежду, аксессуары и лимитированные коллекции с авторским дизайном и вниманием к качеству.

Контакты: info@booomerangs.ru | Telegram: @bmg_booomerangs

## Как ты общаешься
- Будь полезным, кратким и уверенным — 2–4 предложения, не лекции
- НИКОГДА не начинай ответ с приветствия («привет», «здравствуйте», «добрый день» и т.п.) если разговор уже идёт — приветствие уместно только в самом первом сообщении диалога
- Если вопрос размытый («хочу что-то крутое», «посоветуй») — задай 1 уточняющий вопрос: для кого, какой стиль, размер, бюджет. Не угадывай — спроси
- Когда знаешь что товара мало (остаток ≤ 3 шт. в нужном размере) — скажи об этом ненавязчиво: «кстати, этого размера осталось совсем мало»
- Когда пользователь просит что-то посоветовать или предложить ещё — используй ТОЛЬКО товары, которые явно перечислены в разделе «Похожие товары» или «Каталог» этого промта. НИКОГДА не называй конкретные названия товаров, которых нет в переданных данных — даже если кажется что они могут быть в магазине
- Отвечай только на вопросы о магазине и бренде. Не по теме — вежливо скажи и предложи написать менеджеру
- НИКОГДА не придумывай ссылки на товары — карточки показываются автоматически
- НИКОГДА не упоминай промокоды, скидки, акции или распродажи, которых нет в этом промте. Если спрашивают об акциях — отвечай: «Актуальные акции смотри на сайте или уточни у менеджера»

## Используй данные системы
Используй ТОЛЬКО данные, которые тебе переданы в этом промте: текущий товар, каталог, заказы пользователя. Если информации нет в переданных данных — честно скажи «не знаю» или «уточните у менеджера». НИКОГДА не придумывай товары, категории, бренды, скидки, акции или характеристики — даже если кажется что это логично или очевидно.`,

  ai_block_delivery: `## Доставка
- **СДЭК**: курьером до двери или в пункт выдачи (ПВЗ) по всей России
- **Яндекс Доставка NDD**: доставка до пунктов выдачи
- Сроки: зависят от региона, обычно 3–7 рабочих дней (от 1 до 10 дней)
- Стоимость рассчитывается автоматически при оформлении заказа
- Бесплатная доставка при заказе от 5 000 ₽
- Отслеживание заказа: через личный кабинет или трек-номер СДЭК
- Оплата при получении недоступна — только предоплата онлайн`,

  ai_block_payment: `## Оплата
- **ЮKassa**: банковские карты (Visa, MasterCard, МИР), SberPay, YooMoney, СБП
- **Т-Банк (Tinkoff)**: карты, Т-Pay, рассрочка "Долями" (без переплат)
- **Ozon Pay**: оплата через экосистему Ozon
- Оплата при получении недоступна — только предоплата
- Все платежи защищены SSL-шифрованием`,

  ai_block_returns: `## Возврат и обмен
- Возврат и обмен в течение 14 дней с момента получения
- Товар должен быть в первоначальном виде: с бирками, без следов носки
- Для оформления возврата — написать менеджеру в чат или на email info@booomerangs.ru
- Бракованный товар принимается к возврату независимо от срока
- Деньги возвращаются на карту в течение 3–10 рабочих дней`,

  ai_block_sizing: `## Размеры
- Размерная сетка есть на странице каждого товара (замеры в сантиметрах)
- Одежда BOOOMERANGS часто оверсайз-силуэта — если сомневаешься, бери свой размер
- Если между двумя размерами — бери меньший для облегания, больший для оверсайз-вида
- Носки: универсальный размер 36–45, отдельные модели — по размерной сетке
- Если сомневаешься — напиши менеджеру, помогут с выбором`,

  ai_block_merch_order: `## Мерч на заказ
BOOOMERANGS производит корпоративный и персональный мерч для брендов, артистов и мероприятий.

Что делаем: футболки (от 1 шт), худи и свитшоты, носки с принтом (от 50 пар, 200+ дизайнов), брюки и шорты, аксессуары (шапки, сумки, кружки), брендированная упаковка.

Как это работает:
1. Заявка на booomerangs.ru/merch-na-zakaz — описание идеи и тираж
2. Менеджер связывается в течение 24 часов
3. Разрабатываем дизайн с нуля или адаптируем ваш макет
4. Производство на собственных мощностях, доставка по всей России

Сроки: одежда от 3 дней, носки от 14 рабочих дней.
Работаем с физлицами, ИП, ООО, блогерами, музыкантами, организаторами мероприятий.`,

  ai_block_partner: `## Партнёрская программа
Реферальная программа для самозанятых, ИП и ООО.

Как работает:
- Регистрация: booomerangs.ru/partner/register
- После одобрения — личный кабинет, реферальная ссылка (/r/ваш-slug) и именной промокод
- Комиссия 15–25% с каждой покупки по ссылке или промокоду
- Hold 14 дней (период возвратов), затем доступно к выводу
- Вывод через личный кабинет по акту, договор с ЭЦП онлайн (63-ФЗ)

Инструменты: аналитика в реальном времени, HTML-виджет для встраивания витрины, QR-код ссылки.
Для артистов и блогеров доступна персональная страница — см. ниже.`,

  ai_block_artist: `## Платформа для артистов и блогеров
Медийным партнёрам доступны персональные страницы на сайте.

Что это: лендинг по адресу booomerangs.ru/@ваш-slug — настраиваемые секции: hero с видео/фото, галерея, цитата, описание, соцсети, витрина мерча.

Кому подходит: музыкантам, блогерам, инфлюенсерам, сообществам, художникам, брендам.

Как начать:
1. Регистрация: booomerangs.ru/partner/register (поставить галочку "Я артист или блогер")
2. После одобрения — настроить страницу в личном кабинете
3. Адрес страницы: booomerangs.ru/@ваш-slug

Возможности: именной промокод для подписчиков, витрина авторских и выбранных товаров, аналитика просмотров и продаж. Комиссия — договорная.`,

  ai_block_wholesale: `## Оптовые закупки
Специальные условия для юридических лиц и предпринимателей.

**Кому доступно:** ООО, ИП, физлицам с подтверждёнными объёмами.

**Минимальный заказ:** 5 000 ₽.

**Условия:** оптовые цены, доступ к оптовому каталогу и предзаказам, XML-фид для интеграции на свой сайт, персональный менеджер. Скидок от объёма нет — цены фиксированы оптовые.

**Как подключиться:** регистрация на booomerangs.ru/wholesale/register → заполнить данные компании → ждать одобрения (до 24 часов).

**Предзаказы:** доступны в оптовом кабинете. Работают по предоплате 50% от суммы заказа — счёт выставляется после оформления. Сроки производства и отгрузки указаны на странице конкретного предзаказа. Остаток оплачивается перед отгрузкой.

**Оплата:** безналичный расчёт, оплата по счёту на расчётный счёт. Работаем с НДС — НДС включён в цену, берём на себя.

**Документы:** договор поставки, счёт-фактура, УПД — предоставляются по запросу. Маркировку на товары предоставляем.

**Доставка:** оплачивается оптовиком. Доступные транспортные компании: СДЭК, ПЭК, Почта России, Яндекс Доставка, Байкал Сервис. По другим ТК — уточняйте у менеджера.

**Связаться с менеджером:** через чат на сайте, Telegram или ВКонтакте.`,

  ai_block_giftcards: `## Подарочные сертификаты
Электронные подарочные сертификаты BOOOMERANGS.

Как работает: выбрать номинал и дизайн → указать email получателя и пожелание → оплатить → сертификат придёт на email. Код вводится при оформлении заказа.

Особенности: сертификат не сгорает, можно использовать частично (остаток сохраняется), оплата через ЮKassa.

Ссылка: booomerangs.ru/gift-cards`,

  ai_block_loyalty: `## Программа лояльности
Постоянные покупатели получают скидку на все заказы автоматически — она рассчитывается по сумме всех оплаченных покупок.

**Уровни:**
- **Серебро** — от 5 000 ₽ суммарных покупок → скидка **5%**
- **Золото** — от 15 000 ₽ суммарных покупок → скидка **7%**

**Как работает:**
- Скидка применяется автоматически при оформлении заказа — ничего делать не нужно
- Текущий уровень и скидка видны в личном кабинете
- Совмещается с промокодами
- Не распространяется на оптовые заказы`,

  ai_block_promo: `## Промокоды
Промокод вводится на странице оформления заказа в поле «Промокод».

**Совмещение:**
- Промокод + скидка по лояльности — **можно совмещать**
- Промокод + подарочный сертификат — **можно совмещать**

**Ограничения:** у каждого промокода могут быть свои условия — минимальная сумма заказа, ограниченное количество использований или срок действия. Если промокод не применяется — возможно, условия не выполнены или срок истёк.`,

  ai_block_account: `## Личный кабинет
Личный кабинет доступен после регистрации на сайте.

**Что есть в кабинете:**
- **История заказов** — статусы, трек-номера, повторный заказ
- **Отслеживание** — статус доставки СДЭК прямо в кабинете
- **Избранное** — сохранённые товары
- **Профиль** — имя, email, телефон, адрес доставки
- **Скидка лояльности** — текущий уровень и процент скидки
- **Подарочные сертификаты** — баланс и история использования

Зарегистрироваться или войти: кнопка «Войти» в правом верхнем углу сайта.`,

  ai_block_vacancies: `## Вакансии
BOOOMERANGS регулярно ищет людей в команду. Актуальные вакансии — на странице booomerangs.ru/vacancies.

Если подходящей вакансии нет — можно отправить резюме напрямую: hr@booomerangs.ru. Мы рассматриваем все заявки.`,

  ai_block_predrop: `## Pre-drop (Предзаказ)
Pre-drop — это возможность заказать вещь ещё до старта производства, по цене ниже, чем будет при продаже готового товара. Все оформившие предзаказ получат его гарантированно — сбор не может сорвать выпуск для уже оплативших.

**Как это работает:**
1. Перейти на страницу предзаказа: booomerangs.ru/concept
2. Выбрать товар, размер и способ доставки
3. Оплатить полную стоимость сразу (ЮKassa или Т-Банк)
4. Дождаться производства и отгрузки — прогресс видно в личном кабинете

**Цена:** ниже, чем будет у готового товара в обычном магазине. Дополнительных скидок нет.

**Сроки:** у каждого предзаказа своя дата окончания сбора, ориентировочная дата производства и дата отгрузки — всё указано на странице конкретного товара.

**Статусы заказа:** Сбор → Производство → Отправка → Доставлено.

**Доставка:** СДЭК (курьер или ПВЗ), а также специальные точки самовывоза если предусмотрены для конкретного предзаказа.

**Отмена:** самостоятельно отменить предзаказ нельзя. Для отмены нужно связаться с менеджером через чат на сайте, Telegram или ВКонтакте.

**Минимальный заказ:** без ограничений, можно заказать 1 единицу.`,
};

// ─── AI Knowledge Version ─────────────────────────────────────────────────────
// Bump this string any time you update AI_KNOWLEDGE_DEFAULTS — on next server
// start it will overwrite all knowledge blocks in the DB with the new defaults.
const AI_KNOWLEDGE_VERSION = "v5";

// ─── AI Knowledge Cache ───────────────────────────────────────────────────────

const aiKnowledgeCache = new Map<AiKnowledgeKey, string>();
let aiKnowledgeCacheLastLoad = 0;

export function resetAiKnowledgeCache(): void {
  aiKnowledgeCacheLastLoad = 0;
}

export async function migrateAiKnowledgeDefaults(): Promise<void> {
  try {
    const stored = await storage.getBonusSetting("ai_knowledge_version");
    if (stored === AI_KNOWLEDGE_VERSION) return;
    console.log(`[AI Knowledge] Migrating defaults to ${AI_KNOWLEDGE_VERSION}…`);
    await Promise.all(
      AI_KNOWLEDGE_KEYS.map((k) =>
        storage.setBonusSetting(k, AI_KNOWLEDGE_DEFAULTS[k]).catch((e) =>
          console.error(`[AI Knowledge] Failed to migrate ${k}:`, e.message)
        )
      )
    );
    await storage.setBonusSetting("ai_knowledge_version", AI_KNOWLEDGE_VERSION);
    console.log(`[AI Knowledge] Migration complete — all ${AI_KNOWLEDGE_KEYS.length} blocks updated.`);
    invalidateAiKnowledgeCache();
  } catch (e: any) {
    console.error("[AI Knowledge] Migration error:", e.message);
  }
}

export async function loadAiKnowledgeIfNeeded(): Promise<void> {
  if (Date.now() - aiKnowledgeCacheLastLoad <= AI_KNOWLEDGE_CACHE_TTL) return;
  await Promise.all(
    AI_KNOWLEDGE_KEYS.map(async (k) => {
      try {
        const val = await storage.getBonusSetting(k);
        aiKnowledgeCache.set(k, val ?? AI_KNOWLEDGE_DEFAULTS[k]);
      } catch {
        aiKnowledgeCache.set(k, AI_KNOWLEDGE_DEFAULTS[k]);
      }
    })
  );
  aiKnowledgeCacheLastLoad = Date.now();
}

export function getAiKnowledgeCached(key: AiKnowledgeKey): string {
  return aiKnowledgeCache.get(key) ?? AI_KNOWLEDGE_DEFAULTS[key];
}

export function invalidateAiKnowledgeCache(): void {
  aiKnowledgeCacheLastLoad = 0;
}

/** Admin routes: write a single entry into the in-memory cache and mark it stale. */
export function setAiKnowledgeCacheEntry(key: AiKnowledgeKey, value: string): void {
  aiKnowledgeCache.set(key, value);
  invalidateAiKnowledgeCache();
}

// ─── Topic Detection ──────────────────────────────────────────────────────────

const AI_TOPIC_MAP: Array<{ key: AiKnowledgeKey; kw: string[] }> = [
  { key: 'ai_block_delivery',    kw: ['доставк', 'доставля', 'сдэк', 'cdek', 'курьер', 'пвз', 'трек', 'отслеж', 'когда придёт', 'сколько идёт', 'отправ', 'посылк', 'получить заказ', 'забрать заказ'] },
  { key: 'ai_block_payment',     kw: ['оплат', 'юkassa', 'юкасса', 'тинькофф', 't-банк', 'ozon pay', 'карт', 'sbp', 'сбп', 'рассрочк', 'долями', 'т-пэй', 'платёж', 'платеж'] },
  { key: 'ai_block_returns',     kw: ['возврат', 'обмен', 'вернут', 'обменят', 'бракован', ' брак'] },
  { key: 'ai_block_sizing',      kw: ['размер', 'size', 'таблиц', 'подобрать', 'маломерит', 'большемерит', 'xs', 'xxl', 'мерк', 'замер', 'подойдёт', 'подойдет', 'велик', 'велика', 'маловат', 'сядет', 'сидит', 'как сидит', 'оверсайз', 'ростовк', 'какой взять', 'какой брать', 'нужен xl', 'нужен l', 'нужен m', 'нужен s'] },
  { key: 'ai_block_merch_order', kw: ['мерч', 'тираж', 'производств', 'печат', 'для группы', 'для бренда', 'корпоратив', 'нанесен', 'merch', 'заказ одежд', 'корпорат'] },
  { key: 'ai_block_partner',     kw: ['партнёр', 'партнер', 'реферал', 'комисс', 'зарабат', 'реклам', 'affiliate', 'партнерк'] },
  { key: 'ai_block_artist',      kw: ['артист', 'блогер', 'страниц', '/@', 'медийн', 'лендинг', 'инфлюенс', 'свою страницу'] },
  { key: 'ai_block_wholesale',   kw: ['оптов', ' опт ', 'b2b', 'юрлиц', 'ооо ', ' ип ', 'закупк', 'дистрибьют'] },
  { key: 'ai_block_giftcards',   kw: ['сертификат', 'подарк', 'gift', 'подарочн'] },
  { key: 'ai_block_predrop',     kw: ['предзаказ', 'pre-drop', 'predrop', 'пре-дроп', 'предзаказе', 'предзаказов', 'концепт', 'concept', 'pre drop', 'задепонир', 'коллекци'] },
  { key: 'ai_block_loyalty',     kw: ['лояльност', 'скидк', 'уровень', 'серебро', 'золото', 'накопи', 'баллы', 'кэшбэк', 'постоян', 'сколько трачу', 'за покупк'] },
  { key: 'ai_block_promo',       kw: ['промокод', 'promo', 'купон', 'код скидк', 'скидочный код', 'ввести код', 'применить код'] },
  { key: 'ai_block_account',     kw: ['кабинет', 'профил', 'личный', 'аккаунт', 'войти', 'регистрац', 'история заказ', 'мои заказ', 'избранн', 'войти в'] },
  { key: 'ai_block_vacancies',   kw: ['вакансии', 'вакансия', 'работа', 'трудоустройство', 'резюме', 'устроиться', 'набираете', 'ищете сотрудник', 'в команду'] },
];

export function detectAiTopic(query: string): AiKnowledgeKey | null {
  const q = ' ' + query.toLowerCase() + ' ';
  for (const { key, kw } of AI_TOPIC_MAP) {
    if (kw.some(k => q.includes(k))) return key;
  }
  return null;
}

// ─── Chat Topic Logging ───────────────────────────────────────────────────────

const CHAT_TOPIC_LOG_KEY = "chat_topic_log";
const MAX_CHAT_LOG_ENTRIES = 1000;

function logChatTopic(query: string, topic: string | null): void {
  const entry = { q: query.slice(0, 100), topic, ts: Date.now() };
  Promise.resolve().then(async () => {
    try {
      const raw = await storage.getBonusSetting(CHAT_TOPIC_LOG_KEY);
      const log: typeof entry[] = raw ? JSON.parse(raw) : [];
      log.push(entry);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const trimmed = log.filter(e => e.ts >= cutoff);
      if (trimmed.length > MAX_CHAT_LOG_ENTRIES) trimmed.splice(0, trimmed.length - MAX_CHAT_LOG_ENTRIES);
      await storage.setBonusSetting(CHAT_TOPIC_LOG_KEY, JSON.stringify(trimmed));
    } catch {}
  });
}

// ─── Shared Measurement Row Helpers ──────────────────────────────────────────

/** Full row string with units (cm) — used in size advisor prompts and page context. */
function buildMRowStr(m: any): string {
  const parts: string[] = [`${m.size}:`];
  if (m.chest) parts.push(`грудь ${m.chest} см`);
  if (m.waist) parts.push(`талия/пояс ${m.waist} см`);
  if (m.hips) parts.push(`бёдра ${m.hips} см`);
  if (m.shoulders) parts.push(`плечи ${m.shoulders} см`);
  if (m.sleeves) parts.push(`рукав ${m.sleeves} см`);
  if (m.length) parts.push(`длина ${m.length} см`);
  if (m.sideLength) parts.push(`дл. по боку ${m.sideLength} см`);
  if (m.bottomWidth) parts.push(`шир. низа ${m.bottomWidth} см`);
  return parts.join(" ");
}

/** Compact row string without units — used in visited products history (shorter prompt). */
function buildMRowCompact(m: any): string {
  const parts: string[] = [`${m.size}:`];
  if (m.chest) parts.push(`грудь ${m.chest}`);
  if (m.waist) parts.push(`талия ${m.waist}`);
  if (m.hips) parts.push(`бёдра ${m.hips}`);
  if (m.shoulders) parts.push(`плечи ${m.shoulders}`);
  if (m.sleeves) parts.push(`рукав ${m.sleeves}`);
  if (m.length) parts.push(`длина ${m.length}`);
  if (m.sideLength) parts.push(`бок ${m.sideLength}`);
  if (m.bottomWidth) parts.push(`низ ${m.bottomWidth}`);
  return parts.join(" ");
}

// ─── AI Chat Route ────────────────────────────────────────────────────────────

export function registerAiChatRoute(app: Express): void {
  app.post("/api/ai/chat", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { messages, productId: sizeProductId, pageContext, visitedProducts } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages required" });
      }
      const apiKey = process.env.GROQ_API_KEY;
      const proxyUrl = process.env.GROQ_PROXY_URL;
      if (!apiKey && !proxyUrl) {
        return res.status(503).json({ error: "AI service not configured" });
      }
      const groqBase = proxyUrl
        ? proxyUrl.replace(/\/$/, "")
        : "https://api.groq.com";

      // --- Size advisor: product measurements context ---
      let sizeAdvisorContext = "";
      if (sizeProductId) {
        const allProducts = await storage.getProducts() as any[];
        const targetProduct = allProducts.find((p: any) => String(p.id) === String(sizeProductId));
        if (targetProduct) {
          const productName = targetProduct.name || "товар";
          const measurements = (targetProduct.measurements || []) as any[];
          const measurementSections = (targetProduct.measurementSections || []) as any[];
          if (measurementSections.length > 0) {
            const tableStr = measurementSections.map((sec: any) =>
              `### ${sec.title}:\n${(sec.rows || []).map(buildMRowStr).join("\n")}`
            ).join("\n\n");
            sizeAdvisorContext = `\n\n## Подбор размера — активен\nТовар: "${productName}"\n\nЭТО КОСТЮМ — подбирай ДВА размера отдельно: верх и низ. Если совпадают — скажи один (например, M), если нет — укажи оба (например, верх M / низ L).\n\nПРАВИЛА:\n1. Если параметры тела уже указаны — сразу называй размеры верха и низа.\n2. Если нет — попроси обхват груди, талии, бёдер и рост.\n3. Замеры в таблице — это ИЗДЕЛИЕ (не тело). Верх: грудь тела + 10–15 см. Низ: талия тела + 4–6 см (или бёдра + 6–8 см).\n\n${tableStr}`;
          } else if (measurements.length > 0) {
            const rows = measurements.map(buildMRowStr).join("\n");
            sizeAdvisorContext = `\n\n## Подбор размера — активен\nТовар: "${productName}"\n\nПРАВИЛА (строго соблюдай):\n1. Если покупатель уже указал параметры тела (рост, грудь, талия и т.п.) — НЕ задавай дополнительных вопросов, сразу называй конкретный размер.\n2. Если параметры ещё не указаны — попроси только обхват груди и рост.\n3. НЕ перенаправляй к менеджеру, если таблица замеров доступна.\n\nКАК ПОДБИРАТЬ (замеры в таблице — это замеры ИЗДЕЛИЯ, а не тела):\n- Найди строку, где обхват груди изделия = обхват груди тела + 10–15 см (стандартный свободный крой, streetwear)\n- Если изделие явно оверсайз — прибавляй 15–25 см\n- Если покупатель не уточнил силуэт — рекомендуй размер для свободного кроя (+12 см) и кратко поясни\n- Всегда называй КОНКРЕТНЫЙ размер и объясни выбор в 1–2 предложениях\n\n### Таблица замеров изделия:\n${rows}`;
          } else {
            // No size table — only block if user is actually asking about sizes
            const clientQuestion = ([...messages].reverse().find((m: any) => m.role === "user") as any)?.content || "";
            const sizeKeywords = ["размер", "подбер", "мерк", "грудь", "обхват", "рост", "cm", "см", "xxl", "xl ", " xl", "подойдёт", "подойдет", "велик", "мал", "сядет", "сидит", "оверсайз", "велика", "размера", "таблиц", "замер"];
            const isActuallySizeQuestion = sizeKeywords.some(kw => clientQuestion.toLowerCase().includes(kw));
            if (isActuallySizeQuestion) {
              const noTableReply = "К сожалению, таблица замеров для этого товара пока не заполнена — напишите менеджеру, он поможет подобрать размер.";
              const alertText = `📏 *Таблица замеров не заполнена*\n\nТовар: ${productName}\nВопрос клиента: ${clientQuestion}`;
              sendAgentAlert(alertText).catch(() => {});
              vkNotifyAgentAlert(alertText);
              import("./agent-queue").then(({ addToQueue }) => {
                addToQueue({
                  type: "knowledge_gap",
                  title: `📏 Нет таблицы замеров: ${productName.slice(0, 60)}`,
                  description: `Клиент запросил подбор размера для "${productName}", но таблица замеров не заполнена.\nВопрос: ${clientQuestion}`,
                  tool: "update_product_measurements",
                  params: { productId: sizeProductId, productName },
                }).catch(() => {});
              }).catch(() => {});
              if (req.body.stream) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.write(`data: ${JSON.stringify({ chunk: noTableReply })}\n\n`);
                res.write(`data: ${JSON.stringify({ done: true, products: [] })}\n\n`);
                res.end();
              } else {
                res.json({ reply: noTableReply, products: [] });
              }
              return;
            }
            // Not a size question — let AI answer normally without size advisor context
          }
        }
      }

      // --- Visited products context (multi-product session) ---
      let visitedProductsStr = "";
      if (Array.isArray(visitedProducts) && visitedProducts.length > 1) {
        const vpLines: string[] = ["\n\n## Товары, которые пользователь смотрел в этой сессии"];
        for (const vp of visitedProducts as any[]) {
          const vpPrice = vp.price ? `${Number(vp.price).toLocaleString("ru-RU")} ₽` : "цена не указана";
          const vpStock: Record<string, number> = vp.sizeStock || {};
          const vpStockStr = Object.entries(vpStock).filter(([, q]) => (q as number) > 0).map(([s, q]) => `${s}: ${q} шт.`).join(", ") || "нет в наличии";
          const isCurrent = pageContext?.product?.id === vp.id;
          vpLines.push(`\n### ${vp.name}${isCurrent ? " ← (смотрит сейчас)" : ""}${vp.slug ? ` (/${vp.slug})` : ""}`);
          vpLines.push(`- Цена: ${vpPrice}`);
          if (vp.color) vpLines.push(`- Цвет: ${vp.color}`);
          if (vp.composition) vpLines.push(`- Состав: ${vp.composition}`);
          if (vp.description) vpLines.push(`- Описание: ${String(vp.description).slice(0, 300)}`);
          vpLines.push(`- Наличие по размерам: ${vpStockStr}`);
          if (vp.category) vpLines.push(`- Категория: ${vp.subcategory || vp.category}`);
          const sections: any[] = Array.isArray(vp.measurementSections) ? vp.measurementSections : [];
          const rows: any[] = Array.isArray(vp.measurements) ? vp.measurements : [];
          if (sections.length > 0) {
            vpLines.push(`- Таблица замеров:\n${sections.map((sec: any) => `  ${sec.title}: ${(sec.rows || []).map(buildMRowCompact).join(" | ")}`).join("\n")}`);
          } else if (rows.length > 0) {
            vpLines.push(`- Таблица замеров: ${rows.map(buildMRowCompact).join(" | ")}`);
          }
        }
        vpLines.push(`\nИНСТРУКЦИЯ ПО СРАВНЕНИЮ: Если пользователь спрашивает "какой лучше", "что выбрать", "сравни" или упоминает предыдущий товар — используй данные выше и ДАЙ КОНКРЕТНЫЙ ВЫВОД на основе цены, состава, описания, наличия и таблицы замеров. Никогда не говори "сравните сами на карточках" или "уточните параметры" — все данные есть, используй их.`);
        visitedProductsStr = vpLines.join("\n");
      }

      // --- Current product page context ---
      let pageContextStr = "";
      if (pageContext?.pageType === "product" && pageContext.product) {
        const p = pageContext.product;
        const priceStr = p.price ? `${Number(p.price).toLocaleString("ru-RU")} ₽` : "цена не указана";
        const sizeStock: Record<string, number> = p.sizeStock || {};
        const stockLines = Object.entries(sizeStock).filter(([, q]) => (q as number) > 0).map(([s, q]) => `${s}: ${q} шт.`);
        const stockStr = stockLines.length > 0 ? stockLines.join(", ") : (p.stock > 0 ? `в наличии ${p.stock} шт.` : "нет в наличии");
        const triggerNote = pageContext?.activeTrigger === "product_outofstock"
          ? `\n\nВАЖНО: пользователь видит что нужный ему размер/цвет НЕДОСТУПЕН. Предложи оформить уведомление о поступлении (кнопка на странице товара) или подскажи доступные альтернативы.`
          : pageContext?.activeTrigger === "product_time"
          ? `\n\nВАЖНО: пользователь рассматривает этот товар уже больше 30 секунд и не добавляет в корзину — видимо, сомневается. Помоги развеять сомнения: уточни что интересует (размер, состав, как сидит), дай конкретный совет.`
          : "";
        const lowStockSizes = Object.entries(sizeStock).filter(([, q]) => (q as number) > 0 && (q as number) <= 3).map(([s, q]) => `${s} (${q} шт.)`);
        const lowStockNote = lowStockSizes.length > 0 ? `\n\nОСТАТКИ: размеры с малым количеством — ${lowStockSizes.join(", ")}. Если пользователь выбирает один из этих размеров — ненавязчиво упомяни что осталось мало.` : "";
        const category = p.subcategory || p.category || "";
        const crossSellHint = category.toLowerCase().includes("толстовк") || category.toLowerCase().includes("свитшот") || category.toLowerCase().includes("футболк")
          ? `\n\nДОПРОДАЖА: если пользователь определился с этим товаром или добавил в корзину — предложи посмотреть носки BOOOMERANGS как дополнение к образу (одна короткая фраза, без давления).`
          : "";
        let preorderNote = "";
        if (p.preorderEnabled) {
          const statusMap: Record<string, string> = { collecting: "сбор заявок", production: "в производстве", shipping: "отгружается", completed: "завершён" };
          const statusLabel = statusMap[p.preorderStatus] || "предзаказ";
          const deadlinePart = p.preorderDeadline ? `, дедлайн: ${p.preorderDeadline}` : "";
          const progressPart = (p.preorderGoal && p.preorderGoal > 0) ? `, собрано заявок: ${p.preorderCurrent || 0} из ${p.preorderGoal}` : "";
          preorderNote = `\n\nВАЖНО: это товар ПРЕДЗАКАЗА (статус: ${statusLabel}${deadlinePart}${progressPart}). Покупатель оформляет заявку заранее и ждёт производства. Если спрашивают про сроки, как это работает, или когда придёт — объясни схему предзаказа. Не говори что карточка пустая — это нормально для предзаказного товара.`;
        }
        // Build size table section if measurements are available
        // Skip if sizeAdvisorContext already contains the size table — avoid duplicate tables in prompt
        const pageMeasurements = (p.measurements || []) as any[];
        const pageMeasurementSections = (p.measurementSections || []) as any[];
        let pageSizeTableStr = "";
        if (!sizeAdvisorContext) {
          if (pageMeasurementSections.length > 0) {
            const tableStr = pageMeasurementSections.map((sec: any) =>
              `#### ${sec.title}:\n${(sec.rows || []).map(buildMRowStr).join("\n")}`
            ).join("\n\n");
            pageSizeTableStr = `\n\n### Таблицы замеров изделия (КОСТЮМ — верх и низ отдельно):\n${tableStr}\n\nПРАВИЛА подбора размера:\n1. Это костюм — нужно подобрать ДВА размера: для верха и для низа отдельно.\n2. Если совпадают — скажи один (например M); если нет — укажи оба (верх M / низ L).\n3. Замеры — это ИЗДЕЛИЕ (не тело). Верх: грудь тела + 10–15 см. Низ: талия + 4–6 см или бёдра + 6–8 см.\n4. Если параметры уже известны — СРАЗУ называй размеры, не задавай лишних вопросов.`;
          } else if (pageMeasurements.length > 0) {
            const rows = pageMeasurements.map(buildMRowStr).join("\n");
            pageSizeTableStr = `\n\n### Таблица замеров изделия (замеры самой вещи, НЕ тела):\n${rows}\n\nПРАВИЛА подбора размера:\n1. Если покупатель уже дал свои параметры (рост, грудь и т.п.) — СРАЗУ называй конкретный размер, не задавай дополнительных вопросов.\n2. Обхват груди изделия = обхват груди тела + 10–15 см (streetwear, свободный крой). Оверсайз — +15–25 см.\n3. НЕ отправляй к менеджеру — таблица доступна, используй её.\n4. Всегда называй конкретный размер и объясни выбор в 1–2 предложениях.`;
          }
        }
        pageContextStr = `\n\n## Текущий товар (пользователь смотрит эту карточку прямо сейчас)\n- Название: ${p.name}\n- Цена: ${priceStr}\n- Цвет: ${p.color || "не указан"}\n- Состав: ${p.composition || "не указан"}\n- Описание: ${(p.description || "").slice(0, 400)}\n- Наличие по размерам: ${stockStr}\n- Категория: ${category}${pageSizeTableStr}\n\nЕсли пользователь спрашивает про этот товар (состав, размеры, цвет, наличие) — отвечай на основе этих данных.${triggerNote}${lowStockNote}${crossSellHint}${preorderNote}`;
      } else if (pageContext?.pageType === "cart_remove" && pageContext.removedProductName) {
        pageContextStr = `\n\n## Контекст\nПользователь только что удалил товар «${pageContext.removedProductName}» из корзины. Ты написал ему проактивное сообщение с предложением помочь подобрать замену. Теперь пользователь отвечает на это предложение. Помоги ему найти похожие товары или ответь на его вопрос, зная что он искал что-то похожее на «${pageContext.removedProductName}».`;
      } else if (pageContext?.pageType === "cart") {
        const cartNote = pageContext?.activeTrigger === "cart_time"
          ? " Пользователь находится в корзине уже больше минуты и не оформляет заказ — вероятно, сомневается. Предложи помощь с оформлением, уточни нет ли вопросов по доставке или оплате."
          : "";
        pageContextStr = `\n\n## Текущая страница\nПользователь сейчас находится в корзине.${cartNote}`;
      } else if (pageContext?.pageType === "checkout") {
        const checkoutNote = pageContext?.activeTrigger === "checkout_time"
          ? " Пользователь застрял на странице оформления заказа более 90 секунд — вероятно, столкнулся с проблемой при вводе данных, выборе доставки или оплаты. Предложи конкретную помощь."
          : "";
        pageContextStr = `\n\n## Текущая страница\nПользователь сейчас оформляет заказ.${checkoutNote}`;
      } else if (pageContext?.pageType === "home") {
        const homeNote = pageContext?.activeTrigger === "home_newuser"
          ? " Это новый посетитель, который впервые зашёл на сайт. Поприветствуй его, кратко расскажи о бренде BOOOMERANGS и предложи помочь с выбором."
          : "";
        pageContextStr = `\n\n## Текущая страница\nПользователь сейчас на главной странице сайта.${homeNote}`;
      } else if (pageContext?.pageType === "catalog") {
        const catalogNote = pageContext?.activeTrigger === "catalog_browse"
          ? " Пользователь уже несколько минут листает каталог и не может найти нужное. Спроси что именно ищет — стиль, тип вещи, размер, бюджет — и предложи конкретные варианты."
          : "";
        pageContextStr = `\n\n## Текущая страница\nПользователь просматривает каталог товаров.${catalogNote}`;
      } else if (pageContext?.pageType === "artist" && pageContext.artist) {
        const a = pageContext.artist;
        const productLines = (a.products || []).map((p: any) => `${p.name} — ${Number(p.price).toLocaleString("ru-RU")} ₽`).join(", ");
        pageContextStr = `\n\n## Страница артиста (пользователь сейчас здесь)\n- Имя: ${a.name}${a.role ? ` (${a.role})` : ""}\n${a.description ? `- Описание: ${a.description}\n` : ""}- Товары в коллаборации: ${productLines || "загружаются"}\n\nЕсли пользователь спрашивает об этом артисте, его истории, коллаборации или товарах — отвечай на основе этих данных.`;
      }

      // Overlay for exit_intent trigger — works on any page
      if (pageContext?.activeTrigger === "exit_intent") {
        pageContextStr += `\n\nВАЖНО: пользователь собирался покинуть сайт (навёл мышь к закрытию вкладки), но решил написать. Постарайся удержать его — расскажи про текущие акции, промокоды или предложи помощь с тем что он искал. Будь особенно приветливым и конкретным.`;
      }

      // --- Similar products suggestions (when on a product page and user asks for more) ---
      let similarProductsStr = "";
      if (pageContext?.pageType === "product" && pageContext.product) {
        const lastMsg = [...messages].reverse().find((m: any) => m.role === "user");
        const similarKw = ["ещё", "еще", "похожи", "подобн", "альтернатив", "другой", "другие", "что ещё", "покажи ещё", "есть ещё", "больше", "варианты", "варианты есть", "предложи", "посоветуй", "посоветуешь", "посоветова", "рекоменд", "что можешь", "что есть ещё", "что ещё есть", "что посмотреть", "что подойдёт", "что подойдет"];
        const isSimilarQuery = lastMsg?.content && similarKw.some((kw: string) => (lastMsg.content as string).toLowerCase().includes(kw));
        if (isSimilarQuery) {
          const currentSub = pageContext.product.subcategory || pageContext.product.category || "";
          const currentId = pageContext.product.id;
          const allP = await storage.getProducts() as any[];
          const similar = allP.filter((p: any) => {
            if (p.isHidden || p.id === currentId) return false;
            const img = (p.imageUrl || "").trim();
            if (!img || !img.startsWith("https://")) return false;
            if (!p.price || Number(p.price) <= 0) return false;
            const totalStock = p.stock != null ? Number(p.stock) : Object.values(p.sizeStock || {}).reduce((s: number, q) => s + Number(q), 0);
            if (totalStock <= 0) return false;
            return (p.subcategory || p.category || "") === currentSub;
          }).slice(0, 3);
          if (similar.length > 0) {
            const lines = similar.map((p: any) => {
              const pr = `${Number(p.price / 100).toLocaleString("ru-RU")} ₽`;
              const stock = Object.entries(p.sizeStock || {}).filter(([, q]) => (q as number) > 0).map(([s]) => s).join(", ") || "нет в наличии";
              return `- ${p.name} — ${pr}, размеры: ${stock}${p.slug ? ` (/${p.slug})` : ""}`;
            }).join("\n");
            similarProductsStr = `\n\n## Похожие товары из той же категории\n${lines}\n\nЕсли пользователь просит предложить ещё варианты — упомяни эти товары и скажи что их карточки покажутся ниже.`;
          }
        }
      }

      // --- Product search by keywords from the last user message ---
      // Skip keyword search when user is already on a product page — context already injected above
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
      let productContext = "";
      let fullInventoryStr = "";
      let matched: any[] = [];
      if (lastUserMsg?.content && pageContext?.pageType !== "product" && pageContext?.pageType !== "artist") {
        const query = (lastUserMsg.content as string).toLowerCase();

        const subcategoryKeywords: Array<{ kw: string; sub: string }> = [
          { kw: "худи",      sub: "Толстовки" },
          { kw: "толстов",   sub: "Толстовки" },
          { kw: "свитшот",   sub: "Свитшоты" },
          { kw: "свитер",    sub: "Свитшоты" },
          { kw: "футболк",   sub: "Футболки" },
          { kw: "лонгслив",  sub: "Лонгсливы" },
          { kw: "шорт",      sub: "Шорты" },
          { kw: "брюк",      sub: "Брюки" },
          { kw: "штан",      sub: "Брюки" },
          { kw: "бомбер",    sub: "Бомберы" },
          { kw: "куртк",     sub: "Куртки" },
          { kw: "носк",      sub: "Носки" },
          { kw: "sock",      sub: "Носки" },
          { kw: "кепк",      sub: "Головные уборы" },
          { kw: "шапк",      sub: "Головные уборы" },
          { kw: "бейсболк",  sub: "Головные уборы" },
          { kw: "сумк",      sub: "Сумки" },
          { kw: "рюкзак",    sub: "Рюкзаки" },
          { kw: "аксессуар", sub: "" },
        ];

        const categoryKeywords: Array<{ kw: string; cat: string }> = [
          { kw: "одежд",   cat: "clothing" },
          { kw: "носк",    cat: "socks" },
          { kw: "аксессуар", cat: "accessories" },
          { kw: "скидк",   cat: "sale" },
          { kw: "распродаж", cat: "sale" },
          { kw: "sale",    cat: "sale" },
        ];

        const stopWords = new Set(["есть", "ли", "у", "вас", "мне", "что", "как", "где", "какие", "какой", "какая", "хочу", "можно", "нужен", "нужна", "покажи", "покажите", "дай", "дайте", "расскажи", "помоги", "хотел", "хотела", "про", "при", "для", "под", "над", "без", "все", "это", "этот", "эту", "эта", "эти", "той", "тот", "там", "тут", "еще", "ещё", "уже", "очень", "весь", "вся", "всё", "они", "она", "оно", "его", "её", "их", "мой", "твой", "свой"]);

        const nameKeywords = query
          .split(/[\s,.!?;:()[\]]+/)
          .map(w => w.trim())
          .filter(w => w.length >= 3 && !stopWords.has(w));

        // Collect ALL matching stems with their position in the query text (not array index).
        // Sorted by position so "шорты" in "подбери шорты к футболке" comes before "футболк".
        const foundStems: Array<{ kw: string; sub: string; pos: number }> = [];
        for (const { kw, sub } of subcategoryKeywords) {
          const pos = query.indexOf(kw);
          if (pos !== -1) foundStems.push({ kw, sub, pos });
        }
        foundStems.sort((a, b) => a.pos - b.pos);

        // Prepositions that signal "I have Y, looking for X" — appear between stem1 and stem2.
        const ctxPreps = ["к ", "с ", "под ", "для "];
        let targetSubs: string[] = [];
        let contextHint = "";

        if (foundStems.length === 1) {
          if (foundStems[0].sub) targetSubs = [foundStems[0].sub];
        } else if (foundStems.length >= 2) {
          const first = foundStems[0];
          const second = foundStems[1];
          const between = query.slice(first.pos + first.kw.length, second.pos);
          const hasCtxPrep = ctxPreps.some(p => between.includes(p));
          if (hasCtxPrep) {
            // "подбери X к Y" → X is target, Y is context
            if (first.sub) targetSubs = [first.sub];
            if (second.sub) contextHint = ` для сочетания с «${second.sub.toLowerCase()}»`;
          } else {
            // "хочу X и Y" → both are targets
            targetSubs = [...new Set(foundStems.map(s => s.sub).filter(Boolean))];
          }
        }

        let matchedCatSlug: string | null = null;
        for (const { kw, cat } of categoryKeywords) {
          if (query.includes(kw)) { matchedCatSlug = cat; break; }
        }

        const allProducts = await storage.getProducts() as any[];
        const MAX_PRODUCTS = 20;

        const clothingStems = ["футболк", "толстов", "худи", "свитшот", "свитер", "лонгслив", "шорт", "брюк", "штан", "бомбер", "куртк", "носк", "sock", "кепк", "шапк", "бейсболк", "сумк", "рюкзак", "аксессуар"];
        const specificKeywords = nameKeywords.filter(kw =>
          !clothingStems.some(stem => kw.includes(stem) || stem.includes(kw))
        );

        const isAiVisible = (p: any) => {
          if (p.isHidden) return false;
          const img = (p.imageUrl || "").trim();
          if (!img || !img.startsWith("https://")) return false;
          if (!p.price || Number(p.price) <= 0) return false;
          const totalStock = p.stock != null
            ? Number(p.stock)
            : Object.values(p.sizeStock || {}).reduce((s: number, q) => s + Number(q), 0);
          if (totalStock <= 0) return false;
          return true;
        };

        // Stem Russian word: strip last 3 chars from words ≥7 to handle case endings.
        // "вельветовую" → "вельветов", "вельветовая" → "вельветов" → both match.
        const ruStem = (w: string) => w.length >= 7 ? w.slice(0, w.length - 3) : w;
        const nameMatches = (nameLower: string, kws: string[]) => {
          // Split product name into individual words for root-prefix matching
          const nameWords = nameLower.split(/[\s\-_"«»()/]+/).filter(w => w.length >= 5);
          return kws.some(kw => {
            if (nameLower.includes(kw)) return true;
            if (kw.length >= 7 && nameLower.includes(ruStem(kw))) return true;
            // "вельветовые".startsWith("вельвет") → query word is inflected form of product name root
            return nameWords.some(nw => kw.startsWith(nw));
          });
        };

        if (nameKeywords.length > 0 || targetSubs.length > 0 || matchedCatSlug) {
          // Step 1: AND — keyword within target subcategory ("вельветовую футболку" → Футболки ∩ вельвет)
          if (specificKeywords.length > 0 && targetSubs.length > 0) {
            matched = allProducts.filter((p: any) => {
              if (!isAiVisible(p)) return false;
              const nameLower = (p.name || "").toLowerCase();
              const subLower  = (p.subcategory || "").toLowerCase();
              return targetSubs.some(s => subLower.includes(s.toLowerCase()))
                  && nameMatches(nameLower, specificKeywords);
            }).slice(0, MAX_PRODUCTS);
          }

          // Step 2: keyword across all products — only when NO category/subcategory was detected.
          // If targetSubs or matchedCatSlug is set, skip to Step 3 (category fallback)
          // to avoid "классные шорты" → finds "Классика" socks/hats instead of Shorts category.
          if (matched.length === 0 && specificKeywords.length > 0 && targetSubs.length === 0 && !matchedCatSlug) {
            matched = allProducts.filter((p: any) => {
              if (!isAiVisible(p)) return false;
              const nameLower = (p.name || "").toLowerCase();
              return nameMatches(nameLower, specificKeywords);
            }).slice(0, MAX_PRODUCTS);
          }

          // Step 3: category-only fallback
          if (matched.length === 0) {
            matched = allProducts.filter((p: any) => {
              if (!isAiVisible(p)) return false;
              const nameLower = (p.name || "").toLowerCase();
              const subLower  = (p.subcategory || "").toLowerCase();
              if (targetSubs.length > 0 && targetSubs.some(s => subLower.includes(s.toLowerCase()))) return true;
              if (targetSubs.length === 0 && matchedCatSlug && p.category === matchedCatSlug) return true;
              return nameMatches(nameLower, nameKeywords);
            }).slice(0, MAX_PRODUCTS);
          }
        }

        // Follow-up detection: if nothing found yet and query looks like a continuation
        // ("покажи", "какие модели", "что за", etc.) — restore category context from
        // recent conversation history and load those products.
        if (matched.length === 0 && targetSubs.length === 0 && !matchedCatSlug) {
          const followUpStems = ["покаж", "какие", "что за", "другие", "смотр", "перечисли", "назови", "ещё есть", "есть ещё", "хочу увид", "хочу посм"];
          const isFollowUp = followUpStems.some(kw => query.includes(kw));
          if (isFollowUp) {
            const prevUserMessages = [...messages]
              .filter((m: any) => m.role === "user")
              .slice(-5, -1)
              .map((m: any) => (m.content as string).toLowerCase());
            for (const prevQ of prevUserMessages) {
              const prevSubs: string[] = [];
              let prevCat: string | null = null;
              for (const { kw, sub } of subcategoryKeywords) {
                if (prevQ.indexOf(kw) !== -1 && sub) prevSubs.push(sub);
              }
              if (prevSubs.length === 0) {
                for (const { kw, cat } of categoryKeywords) {
                  if (prevQ.includes(kw)) { prevCat = cat; break; }
                }
              }
              if (prevSubs.length > 0 || prevCat) {
                const candidates = allProducts.filter((p: any) => {
                  if (!isAiVisible(p)) return false;
                  const subLower = (p.subcategory || "").toLowerCase();
                  if (prevSubs.length > 0) return prevSubs.some(s => subLower.includes(s.toLowerCase()));
                  return p.category === prevCat;
                }).slice(0, MAX_PRODUCTS);
                if (candidates.length > 0) {
                  matched = candidates;
                  targetSubs = prevSubs;
                  matchedCatSlug = prevCat;
                  contextHint = ` (показываю из предыдущего запроса)`;
                  console.log(`[AI Chat] Follow-up: restored context → subs=[${prevSubs.join(",")}] cat=${prevCat}, ${candidates.length} products`);
                  break;
                }
              }
            }
          }
        }

        if (matched.length > 0) {
          const productNames = matched.map((p: any) => `${p.name}${p.artistOnly ? " (артист)" : ""}`).join(", ");
          const multiCatHint = contextHint || (targetSubs.length > 1 ? ` (категории: ${targetSubs.join(", ")})` : "");
          productContext = `\n\n## Найденные товары\nПо запросу пользователя найдены товары${multiCatHint}: ${productNames}. Карточки этих товаров будут показаны автоматически — НЕ включай ссылки в текст ответа. Просто упомяни что нашёл товары и предложи посмотреть.`;

          // Auto-inject size table if user is asking about sizing and no explicit sizeProductId
          if (!sizeAdvisorContext) {
            const sizeKeywords = ["размер", "подбер", "мерк", "грудь", "обхват", "рост", "cm", "см", "xxl", "xl ", " xl", "подойдёт", "подойдет", "велик", "мал", "сядет", "сидит", "оверсайз", "велика", "размера"];
            const queryLow = query.toLowerCase();
            const isSizeQuery = sizeKeywords.some(kw => queryLow.includes(kw));
            if (isSizeQuery) {
              const withSections = matched.find((p: any) => Array.isArray(p.measurementSections) && p.measurementSections.length > 0);
              const withMeasurements = matched.find((p: any) => Array.isArray(p.measurements) && p.measurements.length > 0);
              const sizeTarget = withSections || withMeasurements || matched[0];
              const productName = sizeTarget.name || "товар";
              const measurements = (sizeTarget.measurements || []) as any[];
              const measurementSections = (sizeTarget.measurementSections || []) as any[];
              if (measurementSections.length > 0) {
                const tableStr = measurementSections.map((sec: any) =>
                  `### ${sec.title}:\n${(sec.rows || []).map(buildMRowStr).join("\n")}`
                ).join("\n\n");
                sizeAdvisorContext = `\n\n## Подбор размера — активен\nТовар: "${productName}"\n\nЭТО КОСТЮМ — подбирай ДВА размера отдельно: верх и низ. Если совпадают — скажи один (например, M), если нет — укажи оба (верх M / низ L).\n\nПРАВИЛА:\n1. Если параметры тела уже указаны — сразу называй размеры верха и низа.\n2. Если нет — попроси обхват груди, талии, бёдер и рост.\n3. Замеры — это ИЗДЕЛИЕ (не тело). Верх: грудь + 10–15 см. Низ: талия + 4–6 см или бёдра + 6–8 см.\n\n⚠️ ЗАПРЕЩЕНО использовать [NO_ANSWER] — таблица замеров предоставлена, у тебя есть все данные для ответа.\n\n${tableStr}`;
                console.log(`[AI Chat] Auto-injected suit size sections for "${productName}" (${measurementSections.length} sections)`);
              } else if (measurements.length > 0) {
                const rows = measurements.map(buildMRowStr).join("\n");
                sizeAdvisorContext = `\n\n## Подбор размера — активен\nТовар: "${productName}"\n\nПРАВИЛА (строго соблюдай):\n1. Если покупатель уже указал параметры тела (рост, грудь, талия и т.п.) — НЕ задавай дополнительных вопросов, сразу называй конкретный размер.\n2. Если параметры ещё не указаны — попроси только обхват груди и рост.\n3. НЕ перенаправляй к менеджеру, если таблица замеров доступна.\n\nКАК ПОДБИРАТЬ (замеры в таблице — это замеры ИЗДЕЛИЯ, а не тела):\n- Найди строку, где обхват груди изделия = обхват груди тела + 10–15 см (стандартный свободный крой, streetwear)\n- Если изделие явно оверсайз — прибавляй 15–25 см\n- Если покупатель не уточнил силуэт — рекомендуй размер для свободного кроя (+12 см) и кратко поясни\n- Всегда называй КОНКРЕТНЫЙ размер и объясни выбор в 1–2 предложениях\n\n⚠️ ЗАПРЕЩЕНО использовать [NO_ANSWER] — таблица замеров предоставлена, у тебя есть все данные для ответа.\n\n### Таблица замеров изделия:\n${rows}`;
                console.log(`[AI Chat] Auto-injected size table for "${productName}" (${measurements.length} rows)`);
              } else {
                sizeAdvisorContext = `\n\n## Подбор размера — активен\nТовар: "${productName}"\nТаблица замеров для этого товара не заполнена. Начни ответ с [NO_ANSWER] и сообщи клиенту дословно: "К сожалению, таблица замеров для этого товара пока не заполнена — напишите менеджеру, он поможет подобрать размер."`;
              }
            }
          }
        }

        // Build full category inventory so AI knows ALL products in scope, not just the 20 cards
        if (targetSubs.length > 0 || matchedCatSlug) {
          const cardIds = new Set(matched.map((p: any) => p.id));
          const allInScope = allProducts.filter((p: any) => {
            if (!isAiVisible(p) || cardIds.has(p.id)) return false;
            const subLower = (p.subcategory || "").toLowerCase();
            if (targetSubs.length > 0) return targetSubs.some(s => subLower.includes(s.toLowerCase()));
            return p.category === matchedCatSlug;
          });
          if (allInScope.length > 0) {
            const label = targetSubs.length > 0 ? targetSubs.join(" / ") : matchedCatSlug!;
            const names = allInScope.slice(0, 150).map((p: any) => p.name).join(", ");
            const total = allInScope.length;
            fullInventoryStr = `\n\n## Полный ассортимент «${label}» (${total} позиций не показаны как карточки, но есть в наличии):\n${names}`;
            console.log(`[AI Chat] fullInventory injected: "${label}" +${total} products`);
          }
        }
      }

      // --- Authenticated user context ---
      let userContextStr = "";
      if (req.user) {
        try {
          const u = req.user;
          const lines: string[] = [`## Текущий пользователь (авторизован)`];
          if (u.name) lines.push(`- Имя: ${u.name}`);
          if (u.wholesaleApproved) {
            lines.push(`- Тип: Оптовый покупатель`);
          } else if ((u.loyaltyDiscount ?? 0) > 0) {
            lines.push(`- Скидка по программе лояльности: ${u.loyaltyDiscount}%`);
          }

          const orders = await storage.getOrdersByUserId(u.id);
          const statusMap: Record<string, string> = {
            paid: "Оплачен", processing: "В обработке", shipped: "Отправлен",
            delivered: "Доставлен", cancelled: "Отменён",
            pending: "Ожидает оплаты", awaiting_payment: "Ожидает оплаты",
          };
          if (orders.length > 0) {
            lines.push(`\n### Заказы:`);
            for (const o of orders.slice(0, 3)) {
              const status = statusMap[o.status] || o.status;
              const total = `${Math.round(o.total / 100).toLocaleString("ru-RU")} ₽`;
              const date = o.createdAt ? new Date(String(o.createdAt)).toLocaleDateString("ru-RU") : "—";
              let line = `- №${o.id} от ${date}: ${status}, ${total}`;
              if (o.transportCompany) line += `, доставка: ${o.transportCompany}`;
              if (o.cdekData) {
                try {
                  const cd = typeof o.cdekData === "string" ? JSON.parse(o.cdekData) : o.cdekData;
                  if (cd.trackingNumber || cd.cdekId) line += ` (трек: ${cd.trackingNumber || cd.cdekId})`;
                  if (cd.statusName) line += `, статус СДЭК: ${cd.statusName}`;
                } catch {}
              }
              lines.push(line);
            }
          } else {
            lines.push(`\n### Заказов пока нет`);
          }

          try {
            const sub = await storage.getNewsletterSubscription(u.email.toLowerCase());
            if (sub?.promoCodeGiven) {
              const promo = await storage.getPromoCodeByCode(sub.promoCodeGiven);
              if (promo?.isActive) {
                const disc = promo.discountPercent
                  ? `${promo.discountPercent}%`
                  : promo.discountAmount
                    ? `${Math.round(Number(promo.discountAmount) / 100)} ₽`
                    : "";
                lines.push(`\n### Промокод: ${promo.code}${disc ? ` — скидка ${disc}` : ""} (активен)`);
              }
            }
          } catch {}

          userContextStr = "\n\n" + lines.join("\n");
          userContextStr += "\n\nОбращайся к пользователю по имени. Называй конкретные номера заказов и их статусы. НЕ раскрывай email пользователя в ответе.";
        } catch (e: any) {
          console.error("[AI Chat] User context error:", e?.message);
        }
      }

      await loadAiKnowledgeIfNeeded();
      // Detect topic from last 3 user messages — handles follow-up questions that don't repeat the topic word
      const recentUserContents = [...messages]
        .filter((m: any) => m.role === "user")
        .slice(-3)
        .map((m: any) => m.content as string)
        .join(' ');
      const topicKey = detectAiTopic(recentUserContents);
      console.log(`[AI Chat] query="${(lastUserMsg?.content || '').substring(0, 60)}" topic=${topicKey || 'none'}`);
      logChatTopic(lastUserMsg?.content || '', topicKey);
      let systemPrompt = getAiKnowledgeCached('ai_prompt_base');
      if (topicKey) {
        const topicBlock = getAiKnowledgeCached(topicKey);
        if (topicBlock) systemPrompt += '\n\n' + topicBlock;
      }
      if (userContextStr) systemPrompt += userContextStr;
      if (visitedProductsStr) systemPrompt += visitedProductsStr;
      if (pageContextStr) systemPrompt += pageContextStr;
      if (similarProductsStr) systemPrompt += similarProductsStr;
      if (productContext) systemPrompt += productContext;
      if (fullInventoryStr) systemPrompt += fullInventoryStr;
      if (sizeAdvisorContext) systemPrompt += sizeAdvisorContext;
      // Inject [PRODUCTS: ...] tag instruction when catalog items are in context
      if (productContext || fullInventoryStr) {
        systemPrompt += `\n\n## Тег [PRODUCTS] — выбор карточек товаров\nЕсли рекомендуешь конкретные товары из каталога — ОБЯЗАТЕЛЬНО начни ответ с тега (ДО любого другого текста, тег невидим покупателю):\n[PRODUCTS: Точное название товара 1|Точное название товара 2|...]\nПиши точные названия из списка выше (не более 8 штук). Если вопрос общий и конкретных рекомендаций нет — НЕ используй тег.`;
      }
      systemPrompt += `\n\n## ВАЖНО: тег [NO_ANSWER]\nИспользуй [NO_ANSWER] ТОЛЬКО если пользователь спрашивает конкретный факт о магазине или товаре (условия акции, точный срок доставки в регион, статус заказа и т.п.) которого нет в данных выше. Формат: начни ответ ровно с [NO_ANSWER] без пробела, затем вежливый ответ. Пример: "[NO_ANSWER]Уточните у менеджера — он ответит быстро."\nНЕ используй [NO_ANSWER] для субъективных вопросов ("что лучше", "что выбрать", "что посоветуешь", сравнение товаров) — на них отвечай самостоятельно на основе имеющихся данных. НЕ используй если информация есть в данных выше.`;

      const groqHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) groqHeaders["Authorization"] = `Bearer ${apiKey}`;

      // Product cards: keyword-matched + similar (from product page context)
      const allProductsCached = await storage.getProducts() as any[];
      // Fuzzy-match AI-written product name to a real catalog entry using word-overlap scoring.
      // "Футболка махра чёрный" → finds "Футболка BMGBRAND (МАХРА) Черный" even with case/bracket differences.
      const fuzzyFindProduct = (aiName: string): any | null => {
        const aiWords = aiName.toLowerCase().split(/[\s\-_()"«»()/]+/).filter(w => w.length >= 3);
        if (aiWords.length === 0) return null;
        let best: any = null;
        let bestScore = 0;
        for (const p of allProductsCached) {
          if (p.isHidden || !p.price || Number(p.price) <= 0) continue;
          const pWords = (p.name || "").toLowerCase().split(/[\s\-_()"«»()/]+/).filter((w: string) => w.length >= 3);
          const matchCount = aiWords.filter(aw =>
            pWords.some((pw: string) => pw === aw || pw.startsWith(aw) || aw.startsWith(pw))
          ).length;
          const score = matchCount / Math.max(aiWords.length, 1);
          if (score > bestScore && score >= 0.4) { bestScore = score; best = p; }
        }
        return best;
      };
      const toCard = (p: any) => ({ id: p.id, name: p.name, price: p.price ? Math.round(p.price / 100) : null, imageUrl: p.imageUrl || null, url: `/${p.slug || p.id}` });
      const similarCards = similarProductsStr ? (await storage.getProducts() as any[]).filter((p: any) => {
        const sub = pageContext?.product?.subcategory || pageContext?.product?.category || "";
        return !p.isHidden && p.id !== pageContext?.product?.id && (p.subcategory || p.category || "") === sub && p.price > 0 && (p.imageUrl || "").startsWith("https://");
      }).slice(0, 3).map(toCard) : [];
      const productCards = matched.length > 0 ? matched.map(toCard) : similarCards;

      // Size advisor needs more tokens — qwen3 thinking takes ~400 tokens before visible output
      // FIX #5: raised from 600 → 1000 for regular questions so think-tokens don't eat the answer
      const isSizeAdvisor = !!sizeAdvisorContext;
      const groqBody = {
        model: "qwen/qwen3-32b",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-10),
        ],
        max_tokens: isSizeAdvisor ? 1500 : 1000,
        temperature: 0.6,
      };

      // ── SSE streaming path ──────────────────────────────────────────────────
      if (req.body.stream === true) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const streamRes = await fetch(`${groqBase}/openai/v1/chat/completions`, {
          method: "POST",
          headers: groqHeaders,
          body: JSON.stringify({ ...groqBody, stream: true }),
        });

        if (!streamRes.ok || !streamRes.body) {
          console.error(`[AI Chat] Groq stream error: status=${streamRes.status}`);
          const errCode = streamRes.status === 429 ? "rate_limit" : "ai_unavailable";
          res.write(`data: ${JSON.stringify({ error: errCode })}\n\n`);
          res.end();
          return;
        }

        const reader = (streamRes.body as any).getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        // Think-tag filter state
        let inThink = false;
        let thinkBuf = "";
        // [NO_ANSWER] detection — runs on VISIBLE output (after think-strip)
        let fullText = "";
        let outputBuf = "";
        let noAnswerDetected = false;
        let noAnswerOutputChecked = false;
        const NO_ANSWER_TAG = "[NO_ANSWER]";
        const PRODUCTS_TAG_START = "[PRODUCTS:";
        // AI-selected products from [PRODUCTS: ...] tag — override keyword-matched cards
        let aiSelectedProducts: any[] = [];

        // pushChunk: buffers beginning of visible output to detect special tags,
        // then streams to client.
        // Handles two tags at the START of visible output (after think-strip):
        //   [PRODUCTS: name1|name2|...]  — AI selects exact product cards (variable length, wait for ']')
        //   [NO_ANSWER]                  — AI signals it can't answer (fixed 11 chars)
        // NOTE: model (Qwen3) emits "\n" after </think> before tags, so we trimStart().
        const pushChunk = (text: string) => {
          if (!text) return;
          outputBuf += text;
          if (!noAnswerOutputChecked) {
            const trimmed = outputBuf.trimStart();
            // Case 1: might be [PRODUCTS: ...] — buffer until closing ']' found
            if (trimmed.startsWith(PRODUCTS_TAG_START)) {
              const closeIdx = trimmed.indexOf("]");
              if (closeIdx === -1) {
                // Safety valve: if no ']' after 800 chars, give up and flush as-is
                if (trimmed.length > 800) {
                  noAnswerOutputChecked = true;
                  res.write(`data: ${JSON.stringify({ chunk: outputBuf })}\n\n`);
                }
                return; // keep buffering
              }
              // Full [PRODUCTS: ...] tag received — parse, fuzzy-match, strip
              noAnswerOutputChecked = true;
              const tagContent = trimmed.slice(PRODUCTS_TAG_START.length, closeIdx).trim();
              const names = tagContent.split("|").map((n: string) => n.trim()).filter(Boolean);
              const found = names.map(fuzzyFindProduct).filter(Boolean);
              if (found.length > 0) {
                aiSelectedProducts = found;
                console.log(`[AI Chat] [PRODUCTS] tag: AI selected ${found.length} products: ${found.map((p: any) => p.name).join(", ")}`);
              }
              // Send the rest of the buffer (text after the tag), skipping leading newline
              const rest = trimmed.slice(closeIdx + 1).replace(/^\n/, "");
              if (rest) res.write(`data: ${JSON.stringify({ chunk: rest })}\n\n`);
              return;
            }
            // Case 2: not [PRODUCTS: — need enough chars to rule it out and check [NO_ANSWER]
            if (trimmed.length < PRODUCTS_TAG_START.length) return; // buffer more
            if (trimmed.length < NO_ANSWER_TAG.length) return;      // buffer more
            noAnswerOutputChecked = true;
            if (trimmed.startsWith(NO_ANSWER_TAG)) {
              noAnswerDetected = true;
              const rest = trimmed.slice(NO_ANSWER_TAG.length);
              if (rest) res.write(`data: ${JSON.stringify({ chunk: rest })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ chunk: outputBuf })}\n\n`);
            }
            return;
          }
          res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        };

        const filterAndSend = (raw: string) => {
          fullText += raw;
          thinkBuf += raw;
          while (thinkBuf.length > 0) {
            if (inThink) {
              const end = thinkBuf.indexOf("</think>");
              if (end === -1) {
                if (thinkBuf.length > 8) thinkBuf = thinkBuf.slice(-8);
                break;
              }
              inThink = false;
              thinkBuf = thinkBuf.slice(end + 8);
            } else {
              const start = thinkBuf.indexOf("<think>");
              if (start === -1) {
                const safe = thinkBuf.length > 7 ? thinkBuf.slice(0, -7) : "";
                if (safe) pushChunk(safe);
                thinkBuf = thinkBuf.slice(safe.length);
                break;
              }
              if (start > 0) pushChunk(thinkBuf.slice(0, start));
              inThink = true;
              thinkBuf = thinkBuf.slice(start + 7);
            }
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;
              try {
                const chunk = JSON.parse(payload);
                const content: string = chunk.choices?.[0]?.delta?.content ?? "";
                if (content) filterAndSend(content);
              } catch {}
            }
          }
          // Flush remaining lookahead buffer
          if (!inThink && thinkBuf) pushChunk(thinkBuf);

          // FIX #1: If the total visible output was shorter than NO_ANSWER_TAG (11 chars),
          // pushChunk kept buffering and never wrote anything. Force-flush now so the client
          // always receives at least some text instead of a silent empty response.
          if (!noAnswerOutputChecked && outputBuf.length > 0) {
            noAnswerOutputChecked = true;
            res.write(`data: ${JSON.stringify({ chunk: outputBuf })}\n\n`);
          }

          // If [NO_ANSWER] was detected — notify admin
          if (noAnswerDetected) {
            const question = lastUserMsg?.content || "(вопрос не определён)";
            const botReply = outputBuf.replace(NO_ANSWER_TAG, "").trim();
            const alertText = `❓ *Бот не смог ответить клиенту*\n\nВопрос: ${question}\n\nОтвет бота: ${botReply}`;
            sendAgentAlert(alertText).catch(() => {});
            vkNotifyAgentAlert(alertText);
            import("./agent-queue").then(({ addToQueue }) => {
              addToQueue({
                type: "knowledge_gap",
                title: `❓ Бот не знает: ${question.slice(0, 80)}`,
                description: `Клиент спросил: ${question}\n\nБот ответил: ${botReply}`,
                tool: "update_ai_knowledge_draft",
                params: { question, botReply, suggestedAnswer: "", targetBlock: topicKey || "ai_block_delivery" },
              }).catch(() => {});
            }).catch(() => {});
          }
        } catch (streamErr: any) {
          console.error("[AI Chat] Stream read error:", streamErr.message);
        }

        const finalProductCards = aiSelectedProducts.length > 0 ? aiSelectedProducts.map(toCard) : productCards;
        res.write(`data: ${JSON.stringify({ done: true, products: finalProductCards })}\n\n`);
        res.end();
        return;
      }

      // ── Non-streaming path ─────────────────────────────────────────────────
      const response = await fetch(`${groqBase}/openai/v1/chat/completions`, {
        method: "POST",
        headers: groqHeaders,
        body: JSON.stringify(groqBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[AI Chat] Groq API error:", response.status, errText);
        if (response.status === 429) {
          return res.status(429).json({ error: "rate_limit" });
        }
        return res.status(502).json({ error: "ai_unavailable" });
      }

      const data = await response.json() as any;
      const rawReply = data.choices?.[0]?.message?.content || "Извините, не могу ответить прямо сейчас. Напишите нашему менеджеру.";
      const cleanedReply = rawReply
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*/gi, "")
        .trim();

      // Parse [PRODUCTS: ...] tag from non-streaming AI response
      let nonStreamReply = cleanedReply.trimStart();
      let nonStreamCards = productCards;
      if (nonStreamReply.startsWith("[PRODUCTS:")) {
        const closeIdx = nonStreamReply.indexOf("]");
        if (closeIdx !== -1) {
          const tagContent = nonStreamReply.slice("[PRODUCTS:".length, closeIdx).trim();
          const names = tagContent.split("|").map((n: string) => n.trim()).filter(Boolean);
          const found = names.map(fuzzyFindProduct).filter(Boolean);
          if (found.length > 0) {
            nonStreamCards = found.map(toCard);
            console.log(`[AI Chat] [PRODUCTS] tag (non-stream): AI selected ${found.length} products: ${found.map((p: any) => p.name).join(", ")}`);
          }
          nonStreamReply = nonStreamReply.slice(closeIdx + 1).replace(/^\n/, "").trim();
        }
      }

      let reply = nonStreamReply;
      if (reply.trimStart().startsWith("[NO_ANSWER]")) {
        reply = reply.trimStart().slice("[NO_ANSWER]".length).trim();
        const question = lastUserMsg?.content || "(вопрос не определён)";
        const alertText = `❓ *Бот не смог ответить клиенту*\n\nВопрос: ${question}\n\nОтвет бота: ${reply}`;
        sendAgentAlert(alertText).catch(() => {});
        vkNotifyAgentAlert(alertText);
        import("./agent-queue").then(({ addToQueue }) => {
          addToQueue({
            type: "knowledge_gap",
            title: `❓ Бот не знает: ${question.slice(0, 80)}`,
            description: `Клиент спросил: ${question}\n\nБот ответил: ${reply}`,
            tool: "update_ai_knowledge_draft",
            params: { question, botReply: reply, suggestedAnswer: "", targetBlock: topicKey || "ai_block_delivery" },
          }).catch(() => {});
        }).catch(() => {});
      }

      res.json({ reply, products: nonStreamCards });
    } catch (err: any) {
      console.error("[AI Chat] Error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });
}

// ─── Admin AI Agent Routes ────────────────────────────────────────────────────

export function registerAdminAgentRoutes(
  app: Express,
  checkAdminKey: (key: string | undefined) => boolean
): void {

  // POST /api/admin/agent/chat — чат с агентом
  app.post("/api/admin/agent/chat", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const { command, history } = req.body;
      if (!command?.trim()) return res.status(400).json({ error: "command required" });
      const result = await processAdminCommand(command, history || []);
      res.json(result);
    } catch (e: any) {
      console.error("[AdminAgent] chat error:", e?.message);
      res.status(500).json({ error: e?.message || "Agent error" });
    }
  });

  // POST /api/admin/agent/execute — выполнить write-инструмент
  app.post("/api/admin/agent/execute", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const { tool, params } = req.body;
      if (!tool) return res.status(400).json({ error: "tool required" });
      const result = await executeWriteTool(tool, params || {});
      res.json({ result });
    } catch (e: any) {
      console.error("[AdminAgent] execute error:", e?.message);
      res.status(500).json({ error: e?.message || "Execute error" });
    }
  });
}
// ─── End Admin AI Agent Routes ────────────────────────────────────────────────

// ─── Autonomous Agent Queue Routes ────────────────────────────────────────────

// In-memory mutex: prevents double-execution when two requests
// approve the same queue item simultaneously
const approveLocks = new Set<string>();

const VALID_JOBS = [
  "seo",
  "alerts",
  "digest",
  "descriptions",
  "cart_analysis",
  "favorites_analysis",
  "price_drop_analysis",
  "stale_products",
  "chat_gap",
  "chat_conversion",
  "retention",
  "all",
] as const;
type ValidJob = (typeof VALID_JOBS)[number];

const agentSettingsSchema = z.object({
  enabled: z.boolean(),
  seoEnabled: z.boolean(),
  alertsEnabled: z.boolean(),
  digestEnabled: z.boolean(),
}).partial();

export function registerAgentQueueRoutes(
  app: Express,
  checkAdminKey: (key: string | undefined) => boolean,
  resetAiKnowledgeCacheFn: () => void
): void {

  // GET /api/admin/agent-queue
  app.get("/api/admin/agent-queue", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const status = req.query.status as string | undefined;
      const items = await getQueue(status as any);
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // POST /api/admin/agent-queue/:id/approve
  app.post("/api/admin/agent-queue/:id/approve", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;

    // Mutex: block double-execution if two requests arrive simultaneously
    if (approveLocks.has(id)) {
      return res.status(409).json({ error: "Already processing — try again in a moment" });
    }
    approveLocks.add(id);

    try {
      const item = await getQueueItemById(id);
      if (!item) return res.status(404).json({ error: "Not found" });
      if (item.status !== "pending") {
        return res.status(400).json({ error: `Already ${item.status}` });
      }

      await updateQueueItemStatus(id, "approved");

      try {
        const bodyData = req.body as any;
        const paramsToUse = bodyData?.paramsOverride
          ? { ...item.params, ...bodyData.paramsOverride }
          : item.params;
        const result = await executeWriteTool(item.tool, paramsToUse);
        await updateQueueItemStatus(id, "executed", { executedAt: new Date().toISOString() });
        await addLogEntry({
          type: item.type,
          action: `Подтверждено: ${item.title}`,
          summary: result.slice(0, 100),
          isAuto: false,
        });
        if (item.tool === "update_ai_knowledge_draft") resetAiKnowledgeCacheFn();
        res.json({ ok: true, result });
      } catch (execErr: any) {
        // Reset to "pending" so the admin can retry — don't leave stuck in "approved"
        await updateQueueItemStatus(id, "pending", { error: execErr.message });
        res.status(500).json({ error: execErr.message });
      }
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    } finally {
      approveLocks.delete(id);
    }
  });

  // POST /api/admin/agent-queue/:id/reject
  app.post("/api/admin/agent-queue/:id/reject", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const { id } = req.params;
      const item = await getQueueItemById(id);
      if (!item) return res.status(404).json({ error: "Not found" });
      if (item.status !== "pending") {
        return res.status(400).json({ error: `Already ${item.status}` });
      }
      await updateQueueItemStatus(id, "rejected");
      await addLogEntry({
        type: item.type,
        action: `Отклонено: ${item.title}`,
        summary: item.description.slice(0, 100),
        isAuto: false,
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/admin/autonomous-agent/status
  app.get("/api/admin/autonomous-agent/status", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const [status, settings, pendingItems] = await Promise.all([
        getAgentStatus(),
        getAgentSettings(),
        getQueue("pending"),
      ]);
      res.json({ status, settings, pendingCount: pendingItems.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // GET /api/admin/autonomous-agent/log
  app.get("/api/admin/autonomous-agent/log", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const log = await getLog();
      res.json({ log });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // PUT /api/admin/autonomous-agent/settings
  app.put("/api/admin/autonomous-agent/settings", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    try {
      const parsed = agentSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
      }
      const settings = await saveAgentSettings(parsed.data);
      res.json({ ok: true, settings });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // POST /api/admin/autonomous-agent/run
  app.post("/api/admin/autonomous-agent/run", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });

    const { job } = req.body;
    if (!job || !VALID_JOBS.includes(job as ValidJob)) {
      return res.status(400).json({ error: `Unknown job: "${job}". Valid: ${VALID_JOBS.join(", ")}` });
    }

    res.json({ ok: true, message: "Запущено в фоне" });

    const label = `[AutonomousAgent] manual ${job} error:`;
    if (job === "seo")                  runSeoJob().catch(e => console.error(label, e?.message));
    else if (job === "alerts")          runAlertsJob().catch(e => console.error(label, e?.message));
    else if (job === "digest")          runWeeklyDigest(true).catch(e => console.error(label, e?.message));
    else if (job === "descriptions")    runDescriptionJob().catch(e => console.error(label, e?.message));
    else if (job === "cart_analysis")   runCartAnalysisJob().catch(e => console.error(label, e?.message));
    else if (job === "favorites_analysis") runFavoritesAnalysisJob().catch(e => console.error(label, e?.message));
    else if (job === "price_drop_analysis") runPriceDropAnalysisJob(true).catch(e => console.error(label, e?.message));
    else if (job === "stale_products")  runStaleProductsJob().catch(e => console.error(label, e?.message));
    else if (job === "chat_gap")        runChatGapAnalysisJob().catch(e => console.error(label, e?.message));
    else if (job === "chat_conversion") runChatConversionAnalysisJob().catch(e => console.error(label, e?.message));
    else if (job === "retention")       runPredictiveRetentionJob().catch(e => console.error(label, e?.message));
    else if (job === "all")             runAutonomousAgent().catch(e => console.error(label, e?.message));
  });
}
// ─── End Autonomous Agent Queue Routes ────────────────────────────────────────

// ─── AI Knowledge Admin Routes ────────────────────────────────────────────────

export function registerAiKnowledgeRoutes(
  app: Express,
  checkAdminKey: (key: string | undefined) => boolean
): void {

  // GET /api/admin/ai-knowledge — все блоки знаний
  app.get("/api/admin/ai-knowledge", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    await loadAiKnowledgeIfNeeded();
    const result: Record<string, string> = {};
    for (const k of AI_KNOWLEDGE_KEYS) {
      result[k] = getAiKnowledgeCached(k);
    }
    res.json({ blocks: result, defaults: AI_KNOWLEDGE_DEFAULTS });
  });

  // POST /api/admin/ai-knowledge/:key — обновить блок знаний
  app.post("/api/admin/ai-knowledge/:key", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    const key = req.params.key as AiKnowledgeKey;
    if (!(AI_KNOWLEDGE_KEYS as readonly string[]).includes(key)) {
      return res.status(400).json({ error: "Unknown knowledge key" });
    }
    const { value } = req.body;
    if (typeof value !== "string") return res.status(400).json({ error: "value required" });
    try {
      await storage.setBonusSetting(key, value);
      setAiKnowledgeCacheEntry(key, value);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ai-knowledge/:key/reset — сбросить до дефолта
  app.post("/api/admin/ai-knowledge/:key/reset", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    const key = req.params.key as AiKnowledgeKey;
    if (!(AI_KNOWLEDGE_KEYS as readonly string[]).includes(key)) {
      return res.status(400).json({ error: "Unknown knowledge key" });
    }
    try {
      const def = AI_KNOWLEDGE_DEFAULTS[key];
      await storage.setBonusSetting(key, def);
      setAiKnowledgeCacheEntry(key, def);
      res.json({ ok: true, value: def });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
// ─── End AI Knowledge Admin Routes ───────────────────────────────────────────

// ─── Proactive AI Stats ──────────────────────────────────────────────────────

const PROACTIVE_STATS_KEY = 'proactive_stats';
let _proactiveStats: Record<string, { shown: number; clicked: number; dismissed: number }> = {};
let _proactiveStatsLoaded = false;

async function loadProactiveStatsOnce(): Promise<void> {
  if (_proactiveStatsLoaded) return;
  _proactiveStatsLoaded = true;
  try {
    const raw = await storage.getBonusSetting(PROACTIVE_STATS_KEY);
    if (raw) _proactiveStats = JSON.parse(raw);
  } catch {}
}

function persistProactiveStats(): void {
  storage.setBonusSetting(PROACTIVE_STATS_KEY, JSON.stringify(_proactiveStats)).catch(() => {});
}

export function registerProactiveStatsRoutes(
  app: Express,
  checkAdminKey: (key: string | undefined) => boolean
): void {
  // POST /api/ai/proactive-event — track peek shown/clicked/dismissed
  app.post("/api/ai/proactive-event", async (req, res) => {
    const { trigger, event } = req.body;
    if (!trigger || !['shown', 'clicked', 'dismissed'].includes(event)) {
      return res.status(400).json({ error: "trigger and event required" });
    }
    await loadProactiveStatsOnce();
    if (!_proactiveStats[trigger]) _proactiveStats[trigger] = { shown: 0, clicked: 0, dismissed: 0 };
    (_proactiveStats[trigger] as any)[event]++;
    persistProactiveStats();
    res.json({ ok: true });
  });

  // GET /api/admin/ai-proactive-stats
  app.get("/api/admin/ai-proactive-stats", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    await loadProactiveStatsOnce();
    res.json({ stats: _proactiveStats });
  });

  // POST /api/admin/ai-proactive-stats/reset
  app.post("/api/admin/ai-proactive-stats/reset", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.query.key;
    if (!checkAdminKey(apiKey as string)) return res.status(403).json({ error: "Forbidden" });
    _proactiveStats = {};
    persistProactiveStats();
    res.json({ ok: true });
  });
}
// ─── End Proactive AI Stats ───────────────────────────────────────────────────

// ─── Telegram Chat Webhook ────────────────────────────────────────────────────

export function registerTelegramChatWebhook(
  app: Express,
  chatCacheInvalidate: (sessionId: string) => void
): void {
  // Telegram webhook for retail bot — receives admin replies
  app.post("/api/telegram/chat-webhook", async (req, res) => {
    try {
      res.sendStatus(200);
      const update = req.body;

      // Handle inline button callbacks for review moderation
      const callbackQuery = update?.callback_query;
      if (callbackQuery) {
        const callbackId = callbackQuery.id;
        const data: string = callbackQuery.data || '';
        const chatId = String(callbackQuery.message?.chat?.id || '');
        const messageId: number = callbackQuery.message?.message_id;
        const originalText: string = callbackQuery.message?.text || '';
        const retailToken = process.env.TELEGRAM_BOT_TOKEN || '';

        if (data.startsWith('review_approve:')) {
          const reviewId = parseInt(data.split(':')[1]);
          if (!isNaN(reviewId)) {
            try {
              await storage.updateReview(reviewId, { isApproved: true });
              console.log(`[Telegram] Review ${reviewId} approved via Telegram button`);
              warmRatingsCache(storage).catch(() => {});
              await answerCallbackQuery(callbackId, '✅ Отзыв одобрен!', retailToken);
              await editMessageText(chatId, messageId, originalText + '\n\n✅ <b>Одобрен</b> (через Telegram)', retailToken);
            } catch (e: any) {
              await answerCallbackQuery(callbackId, '❌ Ошибка при одобрении', retailToken);
              console.error('[Telegram] Error approving review:', e.message);
            }
          }
        } else if (data.startsWith('review_reject:')) {
          const reviewId = parseInt(data.split(':')[1]);
          if (!isNaN(reviewId)) {
            try {
              await storage.deleteReview(reviewId);
              console.log(`[Telegram] Review ${reviewId} rejected via Telegram button`);
              await answerCallbackQuery(callbackId, '❌ Отзыв отклонён', retailToken);
              await editMessageText(chatId, messageId, originalText + '\n\n❌ <b>Отклонён</b> (через Telegram)', retailToken);
            } catch (e: any) {
              await answerCallbackQuery(callbackId, '❌ Ошибка при отклонении', retailToken);
              console.error('[Telegram] Error rejecting review:', e.message);
            }
          }
        } else if (data.startsWith('agent_approve:')) {
          const itemId = data.slice('agent_approve:'.length);
          try {
            const item = await getQueueItemById(itemId);
            if (!item) {
              await answerCallbackQuery(callbackId, '⚠️ Действие не найдено', retailToken);
            } else if (item.status !== 'pending') {
              await answerCallbackQuery(callbackId, `⚠️ Уже обработано: ${item.status}`, retailToken);
            } else {
              await updateQueueItemStatus(itemId, 'approved');
              try {
                await executeWriteTool(item.tool, item.params);
                await updateQueueItemStatus(itemId, 'executed', { executedAt: new Date().toISOString() });
                await addLogEntry({ type: item.type, action: `Подтверждено: ${item.title}`, summary: item.description.slice(0, 100), isAuto: false });
                await answerCallbackQuery(callbackId, '✅ Выполнено!', retailToken);
                await editMessageText(chatId, messageId, originalText + '\n\n✅ <b>Подтверждено и выполнено</b>', retailToken);
                console.log(`[Telegram] Agent action ${itemId} approved & executed`);
              } catch (execErr: any) {
                await updateQueueItemStatus(itemId, 'approved', { error: execErr.message });
                await answerCallbackQuery(callbackId, '⚠️ Одобрено, но выполнить не удалось', retailToken);
                await editMessageText(chatId, messageId, originalText + `\n\n⚠️ <b>Одобрено, ошибка выполнения:</b> ${execErr.message}`, retailToken);
              }
            }
          } catch (e: any) {
            await answerCallbackQuery(callbackId, '❌ Ошибка', retailToken);
            console.error('[Telegram] Agent approve error:', e.message);
          }
        } else if (data.startsWith('agent_reject:')) {
          const itemId = data.slice('agent_reject:'.length);
          try {
            const item = await updateQueueItemStatus(itemId, 'rejected');
            if (!item) {
              await answerCallbackQuery(callbackId, '⚠️ Действие не найдено', retailToken);
            } else {
              await addLogEntry({ type: item.type, action: `Отклонено: ${item.title}`, summary: item.description.slice(0, 100), isAuto: false });
              await answerCallbackQuery(callbackId, '❌ Отклонено', retailToken);
              await editMessageText(chatId, messageId, originalText + '\n\n❌ <b>Отклонено</b>', retailToken);
              console.log(`[Telegram] Agent action ${itemId} rejected`);
            }
          } catch (e: any) {
            await answerCallbackQuery(callbackId, '❌ Ошибка', retailToken);
            console.error('[Telegram] Agent reject error:', e.message);
          }
        }
        return;
      }

      // Handle text replies from admin (live chat)
      const message = update?.message;
      console.log(`[Chat] Webhook received: message=${!!message}, text=${!!message?.text}, reply_to=${!!message?.reply_to_message}`);
      if (!message?.text) {
        if (message) console.log(`[Chat] Skipping: no text (possible photo/sticker/voice reply from admin)`);
        return;
      }
      // Only process replies (admin replying to bot messages)
      const replyToId = message?.reply_to_message?.message_id;
      if (!replyToId) {
        console.log(`[Chat] Skipping: admin message is not a reply (from: ${message.from?.first_name})`);
        return;
      }
      // Find which chat session this reply belongs to
      const sessionId = await storage.getSessionIdByTgMessageId(replyToId);
      if (!sessionId) {
        console.warn(`[Chat] Session not found for tgMessageId=${replyToId} — message may have been saved without tgMessageId`);
        return;
      }
      // Save admin reply
      const adminName = message.from?.first_name || 'Менеджер';
      await storage.saveChatMessage({
        messageId: randomUUID(),
        sessionId,
        sender: 'admin',
        text: message.text,
        timestamp: Date.now(),
        userName: adminName,
      });
      chatCacheInvalidate(sessionId);
      console.log(`[Chat] Admin reply saved for session ${sessionId.slice(0, 8)}, from: ${adminName}`);
    } catch (err: any) {
      console.error("[Chat] Webhook error:", err.message);
    }
  });
}
// ─── End Telegram Chat Webhook ────────────────────────────────────────────────
